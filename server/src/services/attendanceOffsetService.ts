import { PoolClient } from 'pg'
import pool from '../utils/db'
import { createError } from '../middleware/errorHandler'
import { getPayrollPolicySettings } from './settingsService'

export type OffsetReviewAction = 'approve' | 'reject'

export interface ShiftSchedule {
  id?: string
  name: string
  start_time: string
  end_time: string
  break_minutes: number
  work_hours: number
}

interface AttendanceMetricsInput {
  attendanceDate: Date | string
  timeIn?: Date | string | null
  timeOut?: Date | string | null
  shift: ShiftSchedule
  approvedOffsetMinutes?: number
  currentStatus?: string | null
}

interface AttendanceMetrics {
  scheduledShiftId?: string
  scheduledStart: Date
  scheduledEnd: Date
  requiredWorkMinutes: number
  actualRenderedMinutes: number
  lateMinutes: number
  undertimeMinutes: number
  excessMinutes: number
  offsetEarnedMinutes: number
  offsetUsedMinutes: number
  totalWorkedMinutes: number
  status: string
}

interface AttendanceRowForMetrics {
  id: string
  employee_id: string
  date: Date | string
  time_in?: Date | string | null
  time_out?: Date | string | null
  status?: string | null
}

interface OffsetCreditAllocationRow extends Record<string, unknown> {
  id: string
  minutes_remaining: number | string
}

function normalizeDate(value: Date | string): Date {
  if (value instanceof Date) return new Date(value)
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toDate(value?: Date | string | null): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000))
}

function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

export function isProtectedAttendanceStatus(status?: string | null): boolean {
  return Boolean(status && ['absent', 'holiday', 'rest_day', 'on_leave'].includes(status))
}

export function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function scheduledTime(date: Date | string, time: string): Date {
  const base = normalizeDate(date)
  const [hours, minutes, seconds = '0'] = time.split(':')
  base.setHours(Number(hours), Number(minutes), Number(seconds), 0)
  return base
}

export async function getEmployeeShift(employeeId: string): Promise<ShiftSchedule> {
  const result = await pool.query(
    `SELECT ws.id, ws.name, ws.start_time, ws.end_time, ws.break_minutes, ws.work_hours
     FROM employees e
     LEFT JOIN work_shifts ws ON ws.id = e.shift_id AND ws.is_active = true
     WHERE e.id = $1`,
    [employeeId]
  )

  if (!result.rows[0]) throw createError('Employee profile not found', 404)

  if (result.rows[0].id) {
    return {
      id: result.rows[0].id,
      name: result.rows[0].name ?? 'Regular Shift',
      start_time: result.rows[0].start_time ?? '08:00:00',
      end_time: result.rows[0].end_time ?? '17:00:00',
      break_minutes: Number(result.rows[0].break_minutes ?? 60),
      work_hours: Number(result.rows[0].work_hours ?? 8),
    }
  }

  const fallback = await pool.query(
    `SELECT id, name, start_time, end_time, break_minutes, work_hours
     FROM work_shifts
     WHERE is_active = true
     ORDER BY CASE WHEN name = 'Regular Shift' THEN 0 ELSE 1 END, start_time
     LIMIT 1`
  )

  return {
    id: fallback.rows[0]?.id ?? undefined,
    name: fallback.rows[0]?.name ?? 'Regular Shift',
    start_time: fallback.rows[0]?.start_time ?? '08:00:00',
    end_time: fallback.rows[0]?.end_time ?? '17:00:00',
    break_minutes: Number(fallback.rows[0]?.break_minutes ?? 60),
    work_hours: Number(fallback.rows[0]?.work_hours ?? 8),
  }
}

export function calculateAttendanceMetrics(input: AttendanceMetricsInput): AttendanceMetrics {
  const timeIn = toDate(input.timeIn)
  const timeOut = toDate(input.timeOut)
  const scheduledStart = scheduledTime(input.attendanceDate, input.shift.start_time)
  const scheduledEnd = scheduledTime(input.attendanceDate, input.shift.end_time)

  if (scheduledEnd <= scheduledStart) {
    scheduledEnd.setDate(scheduledEnd.getDate() + 1)
  }

  const requiredWorkMinutes = Math.round(Number(input.shift.work_hours) * 60)
  const elapsedMinutes = timeIn && timeOut ? minutesBetween(timeIn, timeOut) : 0
  const actualRenderedMinutes = timeOut
    ? Math.max(0, elapsedMinutes - Number(input.shift.break_minutes ?? 0))
    : 0
  const approvedOffsetMinutes = Math.max(0, Number(input.approvedOffsetMinutes ?? 0))
  const offsetUsedMinutes = timeOut ? approvedOffsetMinutes : 0
  const effectiveRenderedMinutes = actualRenderedMinutes + offsetUsedMinutes
  const lateMinutes = timeIn && timeIn > scheduledStart ? minutesBetween(scheduledStart, timeIn) : 0
  const undertimeMinutes = timeOut ? Math.max(0, requiredWorkMinutes - effectiveRenderedMinutes) : 0
  const excessMinutes = timeOut ? Math.max(0, actualRenderedMinutes - requiredWorkMinutes) : 0

  let status = input.currentStatus ?? 'present'
  if (!isProtectedAttendanceStatus(status) || timeIn || timeOut) {
    if (timeOut && effectiveRenderedMinutes < requiredWorkMinutes / 2) {
      status = 'half_day'
    } else if (lateMinutes > 0) {
      status = 'late'
    } else {
      status = 'present'
    }
  }

  return {
    scheduledShiftId: input.shift.id,
    scheduledStart,
    scheduledEnd,
    requiredWorkMinutes,
    actualRenderedMinutes,
    lateMinutes,
    undertimeMinutes,
    excessMinutes,
    offsetEarnedMinutes: excessMinutes,
    offsetUsedMinutes,
    totalWorkedMinutes: actualRenderedMinutes,
    status,
  }
}

async function getApprovedOffsetUsageMinutes(employeeId: string, date: Date | string): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(SUM(approved_minutes), 0) AS minutes
     FROM offset_usages
     WHERE employee_id = $1 AND usage_date = $2 AND status = 'approved'`,
    [employeeId, localDateString(normalizeDate(date))]
  )

  return Number(result.rows[0]?.minutes ?? 0)
}

async function findAttendanceForMetrics(attendanceId: string): Promise<AttendanceRowForMetrics | undefined> {
  const result = await pool.query(
    `SELECT id, employee_id, date, time_in, time_out, status
     FROM attendance
     WHERE id = $1`,
    [attendanceId]
  )

  return result.rows[0] as AttendanceRowForMetrics | undefined
}

export async function recomputeAttendanceRecord(attendanceId: string, actorUserId?: string) {
  const attendance = await findAttendanceForMetrics(attendanceId)
  if (!attendance) throw createError('Attendance record not found', 404)

  const [shift, approvedOffsetMinutes] = await Promise.all([
    getEmployeeShift(attendance.employee_id),
    getApprovedOffsetUsageMinutes(attendance.employee_id, attendance.date),
  ])
  const metrics = calculateAttendanceMetrics({
    attendanceDate: attendance.date,
    timeIn: attendance.time_in,
    timeOut: attendance.time_out,
    currentStatus: attendance.status,
    shift,
    approvedOffsetMinutes,
  })

  const result = await pool.query(
    `UPDATE attendance
     SET scheduled_shift_id = $2,
         scheduled_start = $3,
         scheduled_end = $4,
         required_work_minutes = $5,
         actual_rendered_minutes = $6,
         total_worked_minutes = $6,
         late_minutes = $7,
         undertime_minutes = $8,
         excess_minutes = $9,
         offset_earned_minutes = $10,
         offset_used_minutes = $11,
         overtime_hours = 0,
         night_diff_hours = 0,
         status = $12,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      attendanceId,
      metrics.scheduledShiftId ?? null,
      metrics.scheduledStart.toISOString(),
      metrics.scheduledEnd.toISOString(),
      metrics.requiredWorkMinutes,
      metrics.actualRenderedMinutes,
      metrics.lateMinutes,
      metrics.undertimeMinutes,
      metrics.excessMinutes,
      metrics.offsetEarnedMinutes,
      metrics.offsetUsedMinutes,
      metrics.status,
    ]
  )

  await syncPendingOffsetCredit(attendanceId, actorUserId)
  return result.rows[0]
}

export async function recomputeAttendanceForEmployeeDate(employeeId: string, date: Date | string, actorUserId?: string) {
  const result = await pool.query(
    `SELECT id FROM attendance WHERE employee_id = $1 AND date = $2`,
    [employeeId, localDateString(normalizeDate(date))]
  )

  if (!result.rows[0]) return undefined
  return recomputeAttendanceRecord(result.rows[0].id, actorUserId)
}

export async function syncPendingOffsetCredit(attendanceId: string, actorUserId?: string): Promise<void> {
  const result = await pool.query(
    `SELECT id, employee_id, date, offset_earned_minutes, excess_minutes
     FROM attendance
     WHERE id = $1`,
    [attendanceId]
  )
  const attendance = result.rows[0]
  if (!attendance) return

  const policy = await getPayrollPolicySettings()
  const minutes = Number(attendance.offset_earned_minutes ?? attendance.excess_minutes ?? 0)
  const existing = await pool.query(
    `SELECT id, status
     FROM offset_credits
     WHERE attendance_id = $1 AND source IN ('excess_hours', 'attendance_correction')
     ORDER BY created_at DESC
     LIMIT 1`,
    [attendanceId]
  )

  if (policy.offsetCreditEnabled && minutes >= policy.minimumOffsetCreditMinutes && minutes > 0) {
    const status = policy.offsetRequiresApproval ? 'pending' : 'approved'
    if (!existing.rows[0]) {
      await pool.query(
        `INSERT INTO offset_credits (
           employee_id, attendance_id, date_earned, source, minutes_earned, minutes_remaining,
           status, reason, reviewed_by, reviewed_at, created_by
         ) VALUES ($1, $2, $3, 'excess_hours', $4, $4, $5::offset_credit_status, $6, $7, CASE WHEN $5 = 'approved' THEN NOW() ELSE NULL END, $7)`,
        [
          attendance.employee_id,
          attendanceId,
          attendance.date,
          minutes,
          status,
          'Generated from attendance excess minutes.',
          actorUserId ?? null,
        ]
      )
      return
    }

    if (existing.rows[0].status === 'pending') {
      await pool.query(
        `UPDATE offset_credits
         SET minutes_earned = $2,
             minutes_remaining = $2,
             status = $3::offset_credit_status,
             reviewed_by = CASE WHEN $3 = 'approved' THEN $4 ELSE reviewed_by END,
             reviewed_at = CASE WHEN $3 = 'approved' THEN NOW() ELSE reviewed_at END,
             updated_at = NOW()
         WHERE id = $1`,
        [existing.rows[0].id, minutes, status, actorUserId ?? null]
      )
    }
    return
  }

  if (existing.rows[0]?.status === 'pending') {
    await pool.query(
      `UPDATE offset_credits
       SET status = 'cancelled',
           minutes_remaining = 0,
           review_remarks = COALESCE(review_remarks, 'Attendance no longer has excess minutes.'),
           updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id]
    )
  }
}

export async function listOffsetCredits(params: {
  employeeId?: string
  status?: string
  startDate?: string
  endDate?: string
}) {
  const conditions: string[] = []
  const values: unknown[] = []
  let i = 1

  if (params.employeeId) {
    conditions.push(`oc.employee_id = $${i++}`)
    values.push(params.employeeId)
  }
  if (params.status) {
    conditions.push(`oc.status = $${i++}`)
    values.push(params.status)
  }
  if (params.startDate) {
    conditions.push(`oc.date_earned >= $${i++}`)
    values.push(params.startDate)
  }
  if (params.endDate) {
    conditions.push(`oc.date_earned <= $${i++}`)
    values.push(params.endDate)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query(
    `SELECT oc.*, e.first_name, e.last_name, e.employee_number,
            a.time_in, a.time_out, a.excess_minutes
     FROM offset_credits oc
     JOIN employees e ON e.id = oc.employee_id
     LEFT JOIN attendance a ON a.id = oc.attendance_id
     ${where}
     ORDER BY oc.created_at DESC`,
    values
  )

  return result.rows
}

export async function reviewOffsetCredit(
  id: string,
  action: OffsetReviewAction,
  actorUserId: string,
  remarks?: string
) {
  const status = action === 'approve' ? 'approved' : 'rejected'
  const result = await pool.query(
    `UPDATE offset_credits
     SET status = $2,
         minutes_remaining = CASE WHEN $2 = 'approved' THEN minutes_earned ELSE 0 END,
         reviewed_by = $3,
         reviewed_at = NOW(),
         review_remarks = $4,
         updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING *`,
    [id, status, actorUserId, remarks ?? null]
  )

  if (!result.rows[0]) throw createError('Pending offset credit not found', 404)

  await pool.query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_values)
     VALUES ($1, $2, 'offset_credit', $3, $4)`,
    [actorUserId, `offset_credit_${status}`, id, JSON.stringify({ status, remarks: remarks ?? null })]
  )

  return result.rows[0]
}

export async function listOffsetUsages(params: {
  employeeId?: string
  status?: string
  startDate?: string
  endDate?: string
}) {
  const conditions: string[] = []
  const values: unknown[] = []
  let i = 1

  if (params.employeeId) {
    conditions.push(`ou.employee_id = $${i++}`)
    values.push(params.employeeId)
  }
  if (params.status) {
    conditions.push(`ou.status = $${i++}`)
    values.push(params.status)
  }
  if (params.startDate) {
    conditions.push(`ou.usage_date >= $${i++}`)
    values.push(params.startDate)
  }
  if (params.endDate) {
    conditions.push(`ou.usage_date <= $${i++}`)
    values.push(params.endDate)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await pool.query(
    `SELECT ou.*, e.first_name, e.last_name, e.employee_number,
            a.time_in, a.time_out, a.undertime_minutes
     FROM offset_usages ou
     JOIN employees e ON e.id = ou.employee_id
     LEFT JOIN attendance a ON a.id = ou.attendance_id
     ${where}
     ORDER BY ou.created_at DESC`,
    values
  )

  return result.rows
}

export async function createOffsetUsageRequest(input: {
  employeeId: string
  usageDate: string
  requestedMinutes: number
  reason: string
  createdBy?: string
}) {
  if (input.requestedMinutes <= 0) {
    throw createError('requestedMinutes must be greater than zero', 400)
  }

  const attendance = await pool.query(
    `SELECT id FROM attendance WHERE employee_id = $1 AND date = $2`,
    [input.employeeId, input.usageDate]
  )

  const result = await pool.query(
    `INSERT INTO offset_usages (
       employee_id, attendance_id, usage_date, requested_minutes, approved_minutes,
       status, reason, created_by
     ) VALUES ($1, $2, $3, $4, 0, 'pending', $5, $6)
     RETURNING *`,
    [
      input.employeeId,
      attendance.rows[0]?.id ?? null,
      input.usageDate,
      Math.round(input.requestedMinutes),
      input.reason,
      input.createdBy ?? null,
    ]
  )

  return result.rows[0]
}

async function allocateOffsetMinutes(
  client: PoolClient,
  employeeId: string,
  usageId: string,
  minutes: number
): Promise<void> {
  const credits = await client.query<OffsetCreditAllocationRow>(
    `SELECT id, minutes_remaining
     FROM offset_credits
     WHERE employee_id = $1
       AND status = 'approved'
       AND minutes_remaining > 0
     ORDER BY date_earned ASC, created_at ASC
     FOR UPDATE`,
    [employeeId]
  )

  const available = credits.rows.reduce((sum: number, row: OffsetCreditAllocationRow): number => sum + Number(row.minutes_remaining), 0)
  if (available < minutes) {
    throw createError('Insufficient approved offset credits', 400)
  }

  let remaining = minutes
  for (const credit of credits.rows) {
    if (remaining <= 0) break
    const applied = Math.min(remaining, Number(credit.minutes_remaining))
    await client.query(
      `UPDATE offset_credits
       SET minutes_remaining = minutes_remaining - $2,
           updated_at = NOW()
       WHERE id = $1`,
      [credit.id, applied]
    )
    await client.query(
      `INSERT INTO offset_usage_allocations (offset_usage_id, offset_credit_id, minutes_applied)
       VALUES ($1, $2, $3)`,
      [usageId, credit.id, applied]
    )
    remaining -= applied
  }
}

export async function reviewOffsetUsage(
  id: string,
  action: OffsetReviewAction,
  actorUserId: string,
  approvedMinutes?: number,
  remarks?: string
) {
  if (action === 'reject') {
    const result = await pool.query(
      `UPDATE offset_usages
       SET status = 'rejected',
           approved_minutes = 0,
           reviewed_by = $2,
           reviewed_at = NOW(),
           review_remarks = $3,
           updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, actorUserId, remarks ?? null]
    )
    if (!result.rows[0]) throw createError('Pending offset usage request not found', 404)
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_values)
       VALUES ($1, 'offset_usage_rejected', 'offset_usage', $2, $3)`,
      [actorUserId, id, JSON.stringify({ remarks: remarks ?? null })]
    )
    return result.rows[0]
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const usageResult = await client.query(
      `SELECT *
       FROM offset_usages
       WHERE id = $1 AND status = 'pending'
       FOR UPDATE`,
      [id]
    )
    const usage = usageResult.rows[0]
    if (!usage) throw createError('Pending offset usage request not found', 404)

    const minutes = Math.round(Number(approvedMinutes ?? usage.requested_minutes))
    if (minutes <= 0) throw createError('approvedMinutes must be greater than zero', 400)

    await allocateOffsetMinutes(client, usage.employee_id, id, minutes)
    const result = await client.query(
      `UPDATE offset_usages
       SET status = 'approved',
           approved_minutes = $2,
           reviewed_by = $3,
           reviewed_at = NOW(),
           review_remarks = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, minutes, actorUserId, remarks ?? null]
    )
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_values)
       VALUES ($1, 'offset_usage_approved', 'offset_usage', $2, $3)`,
      [actorUserId, id, JSON.stringify({ approvedMinutes: minutes, remarks: remarks ?? null })]
    )
    await client.query('COMMIT')

    await recomputeAttendanceForEmployeeDate(usage.employee_id, usage.usage_date, actorUserId)
    return result.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getOffsetBalances(employeeId?: string) {
  const values: unknown[] = []
  const where = employeeId ? 'WHERE e.id = $1' : `WHERE e.employment_status = 'active' AND e.is_deleted = false`
  if (employeeId) values.push(employeeId)

  const result = await pool.query(
    `SELECT e.id AS employee_id, e.first_name, e.last_name, e.employee_number,
            COALESCE((
              SELECT SUM(minutes_earned)
              FROM offset_credits oc
              WHERE oc.employee_id = e.id AND oc.status = 'pending'
            ), 0) AS pending_minutes,
            COALESCE((
              SELECT SUM(minutes_remaining)
              FROM offset_credits oc
              WHERE oc.employee_id = e.id AND oc.status = 'approved'
            ), 0) AS available_minutes,
            COALESCE((
              SELECT SUM(approved_minutes)
              FROM offset_usages ou
              WHERE ou.employee_id = e.id AND ou.status = 'approved'
            ), 0) AS used_minutes,
            COALESCE((
              SELECT SUM(requested_minutes)
              FROM offset_usages ou
              WHERE ou.employee_id = e.id AND ou.status = 'pending'
            ), 0) AS pending_usage_minutes
     FROM employees e
     ${where}
     ORDER BY e.last_name, e.first_name`,
    values
  )

  return result.rows
}

export async function createOffsetAdjustment(input: {
  employeeId: string
  minutes: number
  reason: string
  actorUserId: string
  date?: string
}) {
  const minutes = Math.round(Number(input.minutes))
  if (minutes === 0) throw createError('minutes must not be zero', 400)

  if (minutes > 0) {
    const result = await pool.query(
      `INSERT INTO offset_credits (
         employee_id, date_earned, source, minutes_earned, minutes_remaining,
         status, reason, reviewed_by, reviewed_at, created_by
       ) VALUES ($1, $2, 'manual_adjustment', $3, $3, 'approved', $4, $5, NOW(), $5)
       RETURNING *`,
      [input.employeeId, input.date ?? localDateString(new Date()), minutes, input.reason, input.actorUserId]
    )

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_values)
       VALUES ($1, 'offset_credit_adjusted', 'offset_credit', $2, $3)`,
      [input.actorUserId, result.rows[0].id, JSON.stringify({ minutes, reason: input.reason })]
    )

    return result.rows[0]
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const usage = await client.query(
      `INSERT INTO offset_usages (
         employee_id, usage_date, requested_minutes, approved_minutes,
         status, source, reason, reviewed_by, reviewed_at, created_by
       ) VALUES ($1, $2, $3, $3, 'approved', 'manual_adjustment', $4, $5, NOW(), $5)
       RETURNING *`,
      [
        input.employeeId,
        input.date ?? localDateString(new Date()),
        Math.abs(minutes),
        input.reason,
        input.actorUserId,
      ]
    )
    await allocateOffsetMinutes(client, input.employeeId, usage.rows[0].id, Math.abs(minutes))
    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_values)
       VALUES ($1, 'offset_usage_adjusted', 'offset_usage', $2, $3)`,
      [input.actorUserId, usage.rows[0].id, JSON.stringify({ minutes, reason: input.reason })]
    )
    await client.query('COMMIT')
    return usage.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export function minutesAsHours(minutes: number): number {
  return minutesToHours(minutes)
}
