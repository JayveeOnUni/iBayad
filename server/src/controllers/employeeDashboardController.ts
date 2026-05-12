import { Request, Response } from 'express'
import pool from '../utils/db'
import { asyncHandler, createError } from '../middleware/errorHandler'

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

interface EmployeeDashboardRow extends Record<string, unknown> {
  id: string
  employee_number: string
  first_name: string
  last_name: string
  email: string
  department_name: string | null
  position_title: string | null
  work_days_per_month: number | string
  shift_start: string
  shift_end: string
  scheduled_hours: number | string
}

interface AttendanceTodayRow extends Record<string, unknown> {
  id: string
  time_in: Date | string | null
  time_out: Date | string | null
  status: string | null
  late_minutes: number | string | null
  offset_earned_minutes: number | string | null
  offset_used_minutes: number | string | null
  excess_minutes: number | string | null
  overtime_hours: number | string | null
  total_worked_minutes: number | string | null
}

interface MonthlyAttendanceRow extends Record<string, unknown> {
  present_days: number | string
  absent_days: number | string
  late_days: number | string
  half_days: number | string
  leave_days: number | string
  late_minutes: number | string
  offset_earned_minutes: number | string
  offset_used_minutes: number | string
  undertime_minutes: number | string
  overtime_hours: number | string
  worked_minutes: number | string
}

interface LeaveBalanceRow extends Record<string, unknown> {
  id: string
  name: string
  code: string
  is_paid: boolean
  allowance: number | string
  taken: number | string
  pending: number | string
  balance: number | string
}

interface LeaveBalanceItem {
  id: string
  name: string
  code: string
  isPaid: boolean
  allowance: number
  taken: number
  pending: number
  balance: number
}

interface AnnouncementRow extends Record<string, unknown> {
  id: string
  title: string
  message: string
  start_date: Date | string | null
  end_date: Date | string | null
  is_pinned: boolean
  created_at: Date | string
}

export const getEmployeeDashboard = asyncHandler(async (req: Request, res: Response) => {
  const employeeId = req.user!.employeeId
  if (!employeeId) throw createError('No employee profile is linked to this account', 403)

  const now = new Date()
  const today = localDateString(now)
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const employeeResult = await pool.query<EmployeeDashboardRow>(
    `SELECT e.id, e.employee_number, e.first_name, e.last_name, e.email,
            d.name AS department_name,
            p.title AS position_title,
            COALESCE(e.work_days_per_month, 22) AS work_days_per_month,
            COALESCE(ws.start_time, TIME '08:00') AS shift_start,
            COALESCE(ws.end_time, TIME '17:00') AS shift_end,
            COALESCE(ws.work_hours, e.work_hours_per_day, 8) AS scheduled_hours
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN positions p ON p.id = e.position_id
     LEFT JOIN work_shifts ws ON ws.id = e.shift_id AND ws.is_active = true
     WHERE e.id = $1`,
    [employeeId]
  )

  const employee = employeeResult.rows[0]
  if (!employee) throw createError('Employee profile not found', 404)

  const [todayResult, monthlyResult, leaveResult, announcementsResult] = await Promise.all([
    pool.query<AttendanceTodayRow>(
      `SELECT id, date, time_in, time_out, status, late_minutes,
              offset_earned_minutes, offset_used_minutes, excess_minutes,
              overtime_hours, total_worked_minutes, created_at, updated_at
       FROM attendance
       WHERE employee_id = $1 AND date = $2`,
      [employeeId, today]
    ),
    pool.query<MonthlyAttendanceRow>(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('present', 'late')) AS present_days,
         COUNT(*) FILTER (WHERE status = 'absent') AS absent_days,
         COUNT(*) FILTER (WHERE status = 'late') AS late_days,
         COUNT(*) FILTER (WHERE status = 'half_day') AS half_days,
         COUNT(*) FILTER (WHERE status = 'on_leave') AS leave_days,
         COALESCE(SUM(late_minutes), 0) AS late_minutes,
         COALESCE(SUM(offset_earned_minutes), 0) AS offset_earned_minutes,
         COALESCE(SUM(offset_used_minutes), 0) AS offset_used_minutes,
         COALESCE(SUM(undertime_minutes), 0) AS undertime_minutes,
         COALESCE(SUM(overtime_hours), 0) AS overtime_hours,
         COALESCE(SUM(total_worked_minutes), 0) AS worked_minutes
       FROM attendance
       WHERE employee_id = $1
         AND EXTRACT(YEAR FROM date) = $2
         AND EXTRACT(MONTH FROM date) = $3`,
      [employeeId, year, month]
    ),
    pool.query<LeaveBalanceRow>(
      `SELECT lt.id, lt.name, lt.code, lt.is_paid, lt.days_per_year AS allowance,
              COALESCE(SUM(CASE WHEN lr.status = 'approved' THEN lr.total_days ELSE 0 END), 0) AS taken,
              COALESCE(SUM(CASE WHEN lr.status = 'pending' THEN lr.total_days ELSE 0 END), 0) AS pending,
              lt.days_per_year - COALESCE(SUM(CASE WHEN lr.status = 'approved' THEN lr.total_days ELSE 0 END), 0) AS balance
       FROM leave_types lt
       LEFT JOIN leave_requests lr ON lr.leave_type_id = lt.id
         AND lr.employee_id = $1
         AND EXTRACT(YEAR FROM lr.start_date) = $2
       WHERE lt.is_active = true
       GROUP BY lt.id, lt.name, lt.code, lt.is_paid, lt.days_per_year
       ORDER BY lt.name`,
      [employeeId, year]
    ),
    pool.query<AnnouncementRow>(
      `SELECT id, title, content AS message, start_date, end_date, is_pinned, created_at
       FROM announcements
       WHERE (start_date IS NULL OR start_date <= $1)
         AND (end_date IS NULL OR end_date >= $1)
       ORDER BY is_pinned DESC, created_at DESC
       LIMIT 10`,
      [today]
    ),
  ])

  const attendance = todayResult.rows[0] ?? null
  const workedHours = attendance?.total_worked_minutes
    ? Number(attendance.total_worked_minutes) / 60
    : 0
  const scheduledHours = Number(employee.scheduled_hours ?? 8)
  const monthly = monthlyResult.rows[0]
  const totalHours = Number(monthly.worked_minutes ?? 0) / 60
  const offsetUsedHours = Number(monthly.offset_used_minutes ?? 0) / 60
  const effectiveHours = totalHours + offsetUsedHours
  const expectedHours = Number(employee.scheduled_hours ?? 8) * Number(employee.work_days_per_month ?? 22)
  const leaveItems: LeaveBalanceItem[] = leaveResult.rows.map((row: LeaveBalanceRow): LeaveBalanceItem => ({
    id: row.id,
    name: row.name,
    code: row.code,
    isPaid: Boolean(row.is_paid),
    allowance: Number(row.allowance ?? 0),
    taken: Number(row.taken ?? 0),
    pending: Number(row.pending ?? 0),
    balance: Number(row.balance ?? 0),
  }))

  const vacationLeave = leaveItems.find((item) => item.code === 'VL')?.balance ?? 0
  const sickLeave = leaveItems.find((item) => item.code === 'SL')?.balance ?? 0
  const emergencyLeave = leaveItems.find((item) => item.code === 'EL')?.balance ?? 0

  res.json({
    success: true,
    data: {
      employee: {
        id: employee.id,
        employeeNumber: employee.employee_number,
        name: `${employee.first_name} ${employee.last_name}`,
        firstName: employee.first_name,
        lastName: employee.last_name,
        email: employee.email,
        department: employee.department_name,
        position: employee.position_title,
      },
      attendanceToday: {
        id: attendance?.id ?? null,
        status: attendance?.time_out ? 'Timed Out' : attendance?.time_in ? 'Timed In' : 'Not Timed In',
        attendanceStatus: attendance?.status ?? null,
        date: today,
        timeIn: attendance?.time_in ?? null,
        timeOut: attendance?.time_out ?? null,
        totalHours: round(workedHours),
        scheduledStart: employee.shift_start,
        scheduledEnd: employee.shift_end,
        scheduledHours,
        lateMinutes: Number(attendance?.late_minutes ?? 0),
        offsetEarnedMinutes: Number(attendance?.offset_earned_minutes ?? 0),
        offsetUsedMinutes: Number(attendance?.offset_used_minutes ?? 0),
        excessMinutes: Number(attendance?.excess_minutes ?? 0),
        overtimeHours: Number(attendance?.overtime_hours ?? 0),
      },
      monthlyAttendance: {
        presentDays: Number(monthly.present_days ?? 0),
        lateDays: Number(monthly.late_days ?? 0),
        absentDays: Number(monthly.absent_days ?? 0),
        halfDays: Number(monthly.half_days ?? 0),
        leaveDays: Number(monthly.leave_days ?? 0),
        totalHours: round(totalHours),
        expectedHours: round(expectedHours),
        shortageHours: round(Math.max(0, expectedHours - effectiveHours)),
        offsetEarnedHours: round(Number(monthly.offset_earned_minutes ?? 0) / 60),
        offsetUsedHours: round(offsetUsedHours),
        undertimeHours: round(Number(monthly.undertime_minutes ?? 0) / 60),
        overtimeHours: round(Number(monthly.overtime_hours ?? 0)),
        lateMinutes: Number(monthly.late_minutes ?? 0),
      },
      leaveBalance: {
        vacationLeave,
        sickLeave,
        emergencyLeave,
        totalAllowance: round(leaveItems.reduce((sum: number, item: LeaveBalanceItem): number => sum + item.allowance, 0), 1),
        totalTaken: round(leaveItems.reduce((sum: number, item: LeaveBalanceItem): number => sum + item.taken, 0), 1),
        totalAvailable: round(leaveItems.reduce((sum: number, item: LeaveBalanceItem): number => sum + item.balance, 0), 1),
        pendingRequests: round(leaveItems.reduce((sum: number, item: LeaveBalanceItem): number => sum + item.pending, 0), 1),
        items: leaveItems,
      },
      announcements: announcementsResult.rows.map((row: AnnouncementRow) => ({
        id: row.id,
        title: row.title,
        message: row.message,
        startDate: row.start_date,
        endDate: row.end_date,
        isPinned: Boolean(row.is_pinned),
        createdAt: row.created_at,
      })),
      generatedAt: now.toISOString(),
    },
  })
})
