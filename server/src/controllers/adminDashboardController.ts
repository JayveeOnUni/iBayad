import { Request, Response } from 'express'
import pool from '../utils/db'
import { asyncHandler } from '../middleware/errorHandler'

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateOnly(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return localDateString(value)
  return String(value).slice(0, 10)
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function daysBetween(startDate: string, endDate: string): number {
  const diff = parseDateOnly(endDate).getTime() - parseDateOnly(startDate).getTime()
  return Math.round(diff / 86_400_000)
}

function completionRate(completed: number, expected: number): number {
  if (expected <= 0) return 100
  return round((completed / expected) * 100)
}

function periodFromRow(row: Record<string, unknown> | undefined) {
  if (!row) return null

  return {
    id: String(row.id),
    name: String(row.name),
    frequency: String(row.pay_frequency ?? 'semi-monthly'),
    startDate: dateOnly(row.start_date) ?? '',
    endDate: dateOnly(row.end_date) ?? '',
    payDate: dateOnly(row.pay_date) ?? '',
    status: String(row.status ?? 'draft'),
    recordCount: numberValue(row.record_count),
    processedRecordCount: numberValue(row.processed_record_count),
    totalGrossPay: numberValue(row.total_gross_pay),
    totalNetPay: numberValue(row.total_net_pay),
  }
}

export const getAdminDashboard = asyncHandler(async (_req: Request, res: Response) => {
  const now = new Date()
  const today = localDateString(now)

  const currentPeriodResult = await pool.query(
    `SELECT pp.*,
            COUNT(pr.id) AS record_count,
            COUNT(pr.id) FILTER (WHERE pr.status IN ('processing', 'processed', 'validation_failed', 'ready_for_approval', 'needs_correction', 'approved', 'released', 'locked')) AS processed_record_count,
            COALESCE(SUM(pr.gross_pay), 0) AS total_gross_pay,
            COALESCE(SUM(pr.net_pay), 0) AS total_net_pay
     FROM payroll_periods pp
     LEFT JOIN payroll_records pr ON pr.payroll_period_id = pp.id
     WHERE pp.start_date <= $1::date AND pp.end_date >= $1::date
     GROUP BY pp.id
     ORDER BY pp.start_date DESC
     LIMIT 1`,
    [today]
  )

  const currentPeriodRow = currentPeriodResult.rows[0] as Record<string, unknown> | undefined
  const periodStart = dateOnly(currentPeriodRow?.start_date) ?? today
  const periodEndRaw = dateOnly(currentPeriodRow?.end_date) ?? today
  const periodEnd = periodEndRaw > today ? today : periodEndRaw

  const [
    workforceResult,
    attendanceTodayResult,
    readinessResult,
    approvalsResult,
    attentionEmployeesResult,
    pendingLeaveResult,
    pendingAttendanceResult,
    payrollApprovalQueueResult,
    nextPayDateResult,
    announcementsResult,
  ] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) AS total_employees,
         COUNT(*) FILTER (WHERE employment_status = 'active') AS active_employees,
         COUNT(*) FILTER (WHERE employment_status <> 'active') AS inactive_employees
       FROM employees`
    ),
    pool.query(
      `WITH active_employees AS (
         SELECT id FROM employees WHERE employment_status = 'active'
       ),
       approved_leave_today AS (
         SELECT DISTINCT employee_id
         FROM leave_requests
         WHERE status = 'approved'
           AND start_date <= $1::date
           AND end_date >= $1::date
       )
       SELECT
         COUNT(ae.id) AS active_employees,
         COUNT(*) FILTER (WHERE a.id IS NOT NULL OR alt.employee_id IS NOT NULL) AS recorded_employees,
         COUNT(*) FILTER (WHERE a.status IN ('present', 'late', 'half_day') OR a.time_in IS NOT NULL) AS present_today,
         COUNT(*) FILTER (WHERE a.status = 'late') AS late_today,
         COUNT(*) FILTER (WHERE a.status = 'absent') AS absent_today,
         COUNT(*) FILTER (WHERE a.status = 'on_leave' OR alt.employee_id IS NOT NULL) AS on_leave_today,
         COUNT(*) FILTER (WHERE a.id IS NULL AND alt.employee_id IS NULL) AS missing_attendance,
         COUNT(*) FILTER (WHERE a.time_in IS NOT NULL AND a.time_out IS NULL) AS incomplete_punches
       FROM active_employees ae
       LEFT JOIN attendance a ON a.employee_id = ae.id AND a.date = $1::date
       LEFT JOIN approved_leave_today alt ON alt.employee_id = ae.id`,
      [today]
    ),
    pool.query(
      `WITH active_employees AS (
         SELECT id FROM employees WHERE employment_status = 'active'
       ),
       workdays AS (
         SELECT day::date AS attendance_date
         FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS day
         WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 5
       ),
       expected_days AS (
         SELECT ae.id AS employee_id, w.attendance_date
         FROM active_employees ae
         CROSS JOIN workdays w
       ),
       completed_days AS (
         SELECT a.employee_id, a.date AS attendance_date
         FROM attendance a
         JOIN active_employees ae ON ae.id = a.employee_id
         JOIN workdays w ON w.attendance_date = a.date
         UNION
         SELECT lr.employee_id, w.attendance_date
         FROM leave_requests lr
         JOIN active_employees ae ON ae.id = lr.employee_id
         JOIN workdays w ON w.attendance_date BETWEEN lr.start_date AND lr.end_date
         WHERE lr.status = 'approved'
       )
       SELECT
         COUNT(ed.employee_id) AS expected_employee_days,
         COUNT(cd.employee_id) AS completed_employee_days,
         GREATEST(COUNT(ed.employee_id) - COUNT(cd.employee_id), 0) AS missing_employee_days
       FROM expected_days ed
       LEFT JOIN completed_days cd
         ON cd.employee_id = ed.employee_id
        AND cd.attendance_date = ed.attendance_date`,
      [periodStart, periodEnd]
    ),
    pool.query(
      `SELECT
         (SELECT COUNT(*) FROM leave_requests WHERE status = 'pending') AS pending_leave_requests,
         (SELECT COUNT(*) FROM attendance_requests WHERE status = 'pending') AS pending_attendance_requests,
         (SELECT COUNT(*) FROM payroll_periods WHERE status = 'ready_for_approval') AS payroll_periods_for_approval`
    ),
    pool.query(
      `WITH approved_leave_today AS (
         SELECT DISTINCT employee_id
         FROM leave_requests
         WHERE status = 'approved'
           AND start_date <= $1::date
           AND end_date >= $1::date
       )
       SELECT e.id, e.employee_number, e.first_name, e.last_name,
              d.name AS department_name,
              p.title AS position_title,
              a.status,
              a.time_in,
              a.time_out,
              a.late_minutes,
              CASE
                WHEN a.status = 'absent' THEN 'absent'
                WHEN a.time_in IS NOT NULL AND a.time_out IS NULL THEN 'incomplete_punch'
                WHEN a.id IS NULL THEN 'missing_time_in'
                WHEN a.status = 'late' THEN 'late'
                ELSE 'attention'
              END AS attention_type
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN positions p ON p.id = e.position_id
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1::date
       LEFT JOIN approved_leave_today alt ON alt.employee_id = e.id
       WHERE e.employment_status = 'active'
         AND (
           a.status = 'absent'
           OR (a.time_in IS NOT NULL AND a.time_out IS NULL)
           OR (a.id IS NULL AND alt.employee_id IS NULL)
           OR a.status = 'late'
         )
       ORDER BY
         CASE
           WHEN a.status = 'absent' THEN 1
           WHEN a.time_in IS NOT NULL AND a.time_out IS NULL THEN 2
           WHEN a.id IS NULL THEN 3
           WHEN a.status = 'late' THEN 4
           ELSE 5
         END,
         e.last_name,
         e.first_name
       LIMIT 8`,
      [today]
    ),
    pool.query(
      `SELECT lr.id, lr.start_date, lr.end_date, lr.total_days, lr.created_at,
              lt.name AS leave_type_name,
              e.first_name, e.last_name, e.employee_number
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.status = 'pending'
       ORDER BY lr.created_at ASC
       LIMIT 5`
    ),
    pool.query(
      `SELECT ar.id, ar.date, ar.requested_status, ar.reason, ar.created_at,
              e.first_name, e.last_name, e.employee_number
       FROM attendance_requests ar
       JOIN employees e ON e.id = ar.employee_id
       WHERE ar.status = 'pending'
       ORDER BY ar.created_at ASC
       LIMIT 5`
    ),
    pool.query(
      `SELECT id, name, start_date, end_date, pay_date, status, updated_at
       FROM payroll_periods
       WHERE status = 'ready_for_approval'
       ORDER BY pay_date ASC, updated_at ASC
       LIMIT 3`
    ),
    pool.query(
      `SELECT id, name, pay_date
       FROM payroll_periods
       WHERE pay_date >= $1::date
       ORDER BY pay_date ASC
       LIMIT 1`,
      [today]
    ),
    pool.query(
      `SELECT id, title, content AS message, start_date, end_date, is_pinned, created_at
       FROM announcements
       WHERE (start_date IS NULL OR start_date <= $1::date)
         AND (end_date IS NULL OR end_date >= $1::date)
       ORDER BY is_pinned DESC, created_at DESC
       LIMIT 10`,
      [today]
    ),
  ])

  const workforce = workforceResult.rows[0]
  const attendanceToday = attendanceTodayResult.rows[0]
  const readiness = readinessResult.rows[0]
  const approvals = approvalsResult.rows[0]
  const currentPeriod = periodFromRow(currentPeriodRow)
  const nextPayDateRow = nextPayDateResult.rows[0] as Record<string, unknown> | undefined
  const nextPayDate = dateOnly(nextPayDateRow?.pay_date)

  const activeEmployees = numberValue(workforce.active_employees)
  const recordedEmployees = numberValue(attendanceToday.recorded_employees)
  const expectedEmployeeDays = numberValue(readiness.expected_employee_days)
  const completedEmployeeDays = numberValue(readiness.completed_employee_days)
  const missingEmployeeDays = numberValue(readiness.missing_employee_days)
  const pendingLeaveRequests = numberValue(approvals.pending_leave_requests)
  const pendingAttendanceRequests = numberValue(approvals.pending_attendance_requests)
  const payrollPeriodsForApproval = numberValue(approvals.payroll_periods_for_approval)

  const attentionItems = [
    {
      id: 'missing-attendance',
      title: 'Unrecorded attendance today',
      description: 'Active employees without an attendance record or approved leave today.',
      count: numberValue(attendanceToday.missing_attendance),
      severity: 'warning',
      actionLabel: 'Review daily log',
      actionPath: '/admin/attendance/daily',
    },
    {
      id: 'incomplete-punches',
      title: 'Incomplete punches',
      description: 'Employees who timed in but have not timed out yet.',
      count: numberValue(attendanceToday.incomplete_punches),
      severity: 'warning',
      actionLabel: 'Check time logs',
      actionPath: '/admin/attendance/daily',
    },
    {
      id: 'pending-leave',
      title: 'Leave approvals pending',
      description: 'Leave requests waiting for HR review.',
      count: pendingLeaveRequests,
      severity: 'danger',
      actionLabel: 'Open leave requests',
      actionPath: '/admin/leave/status',
    },
    {
      id: 'attendance-requests',
      title: 'Attendance requests pending',
      description: 'Corrections or time offset requests blocking clean attendance data.',
      count: pendingAttendanceRequests,
      severity: 'danger',
      actionLabel: 'Open requests',
      actionPath: '/admin/attendance/requests',
    },
    {
      id: 'payroll-approval',
      title: 'Payroll periods for approval',
      description: 'Processed payroll periods waiting for approval.',
      count: payrollPeriodsForApproval,
      severity: 'danger',
      actionLabel: 'Open payroll',
      actionPath: '/admin/payroll',
    },
  ].filter((item) => item.count > 0)

  const employeesNeedingAttention = attentionEmployeesResult.rows.map((row) => {
    const type = String(row.attention_type)
    const title = `${row.first_name} ${row.last_name}`
    const descriptions: Record<string, string> = {
      absent: 'Marked absent today.',
      incomplete_punch: 'Timed in without a time out.',
      missing_time_in: 'No attendance record or approved leave today.',
      late: `${numberValue(row.late_minutes)} minutes late today.`,
    }

    return {
      id: row.id,
      employeeNumber: row.employee_number,
      name: title,
      department: row.department_name,
      position: row.position_title,
      type,
      severity: type === 'absent' ? 'danger' : 'warning',
      description: descriptions[type] ?? 'Needs HR review today.',
    }
  })

  const leaveQueue = pendingLeaveResult.rows.map((row) => ({
    id: row.id,
    type: 'leave',
    title: `${row.leave_type_name} request`,
    employeeName: `${row.first_name} ${row.last_name}`,
    employeeNumber: row.employee_number,
    detail: `${dateOnly(row.start_date)} to ${dateOnly(row.end_date)} (${numberValue(row.total_days)} day${numberValue(row.total_days) === 1 ? '' : 's'})`,
    requestedAt: row.created_at,
    actionPath: '/admin/leave/status',
  }))

  const attendanceQueue = pendingAttendanceResult.rows.map((row) => ({
    id: row.id,
    type: 'attendance',
    title: 'Attendance correction',
    employeeName: `${row.first_name} ${row.last_name}`,
    employeeNumber: row.employee_number,
    detail: `${dateOnly(row.date)}${row.requested_status ? `: ${String(row.requested_status).replace(/_/g, ' ')}` : ''}`,
    requestedAt: row.created_at,
    actionPath: '/admin/attendance/requests',
  }))

  const payrollQueue = payrollApprovalQueueResult.rows.map((row) => ({
    id: row.id,
    type: 'payroll',
    title: 'Payroll approval',
    employeeName: null,
    employeeNumber: null,
    detail: `${row.name}: ${dateOnly(row.start_date)} to ${dateOnly(row.end_date)}, pay date ${dateOnly(row.pay_date)}`,
    requestedAt: row.updated_at,
    actionPath: '/admin/payroll',
  }))

  res.json({
    success: true,
    data: {
      today,
      generatedAt: now.toISOString(),
      workforce: {
        totalEmployees: numberValue(workforce.total_employees),
        activeEmployees,
        inactiveEmployees: numberValue(workforce.inactive_employees),
      },
      attendanceToday: {
        date: today,
        activeEmployees,
        recordedEmployees,
        presentToday: numberValue(attendanceToday.present_today),
        lateToday: numberValue(attendanceToday.late_today),
        absentToday: numberValue(attendanceToday.absent_today),
        onLeaveToday: numberValue(attendanceToday.on_leave_today),
        missingAttendance: numberValue(attendanceToday.missing_attendance),
        incompletePunches: numberValue(attendanceToday.incomplete_punches),
        completionRate: completionRate(recordedEmployees, activeEmployees),
      },
      attendanceReadiness: {
        periodStart,
        periodEnd: periodEndRaw,
        evaluatedThrough: periodEnd,
        expectedEmployeeDays,
        completedEmployeeDays,
        missingEmployeeDays,
        completionRate: completionRate(completedEmployeeDays, expectedEmployeeDays),
        isPayrollReady: missingEmployeeDays === 0,
      },
      approvals: {
        pendingLeaveRequests,
        pendingAttendanceRequests,
        payrollPeriodsForApproval,
        totalPending: pendingLeaveRequests + pendingAttendanceRequests + payrollPeriodsForApproval,
      },
      payroll: {
        currentPeriod,
        nextPayDate,
        nextPayDatePeriodId: nextPayDateRow?.id ?? null,
        nextPayDatePeriodName: nextPayDateRow?.name ?? null,
        daysUntilPayDate: nextPayDate ? daysBetween(today, nextPayDate) : null,
      },
      attentionItems,
      employeesNeedingAttention,
      approvalQueue: [...payrollQueue, ...leaveQueue, ...attendanceQueue]
        .sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime())
        .slice(0, 8),
      announcements: announcementsResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        message: row.message,
        startDate: dateOnly(row.start_date),
        endDate: dateOnly(row.end_date),
        isPinned: Boolean(row.is_pinned),
        createdAt: row.created_at,
      })),
    },
  })
})
