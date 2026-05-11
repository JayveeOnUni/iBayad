import { Request, Response } from 'express'
import pool from '../utils/db'
import { asyncHandler, createError } from '../middleware/errorHandler'
import {
  calculateAttendanceMetrics,
  createOffsetAdjustment,
  createOffsetUsageRequest,
  getEmployeeShift,
  getOffsetBalances,
  listOffsetCredits,
  listOffsetUsages,
  localDateString,
  recomputeAttendanceForEmployeeDate,
  recomputeAttendanceRecord,
  reviewOffsetCredit,
  reviewOffsetUsage,
} from '../services/attendanceOffsetService'

export const getAttendanceLogs = asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, startDate, endDate, status } = req.query
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (employeeId) { conditions.push(`a.employee_id = $${i++}`); params.push(employeeId) }
  if (startDate) { conditions.push(`a.date >= $${i++}`); params.push(startDate) }
  if (endDate) { conditions.push(`a.date <= $${i++}`); params.push(endDate) }
  if (status) { conditions.push(`a.status = $${i++}`); params.push(status) }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

  const result = await pool.query(
    `SELECT a.*, e.first_name, e.last_name, e.employee_number,
            ws.name AS scheduled_shift_name
     FROM attendance a
     JOIN employees e ON a.employee_id = e.id
     LEFT JOIN work_shifts ws ON ws.id = a.scheduled_shift_id
     ${where}
     ORDER BY a.date DESC, e.last_name`,
    params
  )
  res.json({ success: true, data: result.rows })
})

export const getMyAttendance = asyncHandler(async (req: Request, res: Response) => {
  const { startDate, endDate } = req.query
  const conditions = ['a.employee_id = $1']
  const params: unknown[] = [req.user!.employeeId]
  let i = 2

  if (startDate) { conditions.push(`a.date >= $${i++}`); params.push(startDate) }
  if (endDate) { conditions.push(`a.date <= $${i++}`); params.push(endDate) }

  const result = await pool.query(
    `SELECT a.*, ws.name AS scheduled_shift_name
     FROM attendance a
     LEFT JOIN work_shifts ws ON ws.id = a.scheduled_shift_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.date DESC`,
    params
  )
  res.json({ success: true, data: result.rows })
})

export const clockIn = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date()
  const today = localDateString(now)

  // Check if already clocked in today
  const existing = await pool.query(
    `SELECT id, time_in FROM attendance WHERE employee_id = $1 AND date = $2`,
    [req.user!.employeeId, today]
  )

  if (existing.rows[0]?.time_in) {
    throw createError('Already clocked in today', 400)
  }

  const employeeId = req.user!.employeeId!
  const shift = await getEmployeeShift(employeeId)
  const metrics = calculateAttendanceMetrics({
    attendanceDate: today,
    timeIn: now,
    shift,
  })

  const result = await pool.query(
    `INSERT INTO attendance (
       employee_id, date, time_in, late_minutes, status,
       scheduled_shift_id, scheduled_start, scheduled_end, required_work_minutes, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (employee_id, date) DO UPDATE
     SET time_in = $3,
         late_minutes = $4,
         status = $5,
         scheduled_shift_id = $6,
         scheduled_start = $7,
         scheduled_end = $8,
         required_work_minutes = $9,
         updated_at = NOW()
     RETURNING *`,
    [
      employeeId,
      today,
      now.toISOString(),
      metrics.lateMinutes,
      metrics.status,
      metrics.scheduledShiftId ?? null,
      metrics.scheduledStart.toISOString(),
      metrics.scheduledEnd.toISOString(),
      metrics.requiredWorkMinutes,
      req.user!.userId,
    ]
  )
  res.json({ success: true, data: result.rows[0] })
})

export const clockOut = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date()
  const today = localDateString(now)

  const existing = await pool.query(
    `SELECT * FROM attendance WHERE employee_id = $1 AND date = $2`,
    [req.user!.employeeId, today]
  )

  if (!existing.rows[0]) throw createError('No clock-in record found for today', 400)
  if (existing.rows[0].time_out) throw createError('Already clocked out today', 400)

  const result = await pool.query(
    `UPDATE attendance
     SET time_out = $1, updated_at = NOW()
     WHERE employee_id = $2 AND date = $3
     RETURNING *`,
    [now.toISOString(), req.user!.employeeId, today]
  )
  const recomputed = await recomputeAttendanceRecord(result.rows[0].id, req.user!.userId)
  res.json({ success: true, data: recomputed })
})

export const createAttendanceRecord = asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, date, timeIn, timeOut, status, remarks } = req.body
  if (!employeeId || !date) throw createError('employeeId and date are required', 400)

  const result = await pool.query(
    `INSERT INTO attendance (employee_id, date, time_in, time_out, status, remarks, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (employee_id, date) DO UPDATE
     SET time_in = $3,
         time_out = $4,
         status = $5,
         remarks = $6,
         updated_at = NOW()
     RETURNING *`,
    [employeeId, date, timeIn, timeOut, status ?? 'present', remarks, req.user!.userId]
  )
  const recomputed = await recomputeAttendanceRecord(result.rows[0].id, req.user!.userId)
  res.status(201).json({ success: true, data: recomputed })
})

export const getAttendanceSummary = asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, year, month } = req.query
  if (!employeeId || !year || !month) throw createError('employeeId, year, and month are required', 400)

  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'present') AS present_days,
       COUNT(*) FILTER (WHERE status = 'absent') AS absent_days,
       COUNT(*) FILTER (WHERE status = 'late') AS late_days,
       COUNT(*) FILTER (WHERE status = 'half_day') AS half_days,
       COALESCE(SUM(late_minutes), 0) AS total_late_minutes,
       COALESCE(SUM(excess_minutes), 0) AS total_excess_minutes,
       COALESCE(SUM(offset_earned_minutes), 0) AS total_offset_earned_minutes,
       COALESCE(SUM(offset_used_minutes), 0) AS total_offset_used_minutes,
       ROUND(COALESCE(SUM(offset_earned_minutes), 0) / 60.0, 2) AS total_offset_earned_hours,
       ROUND(COALESCE(SUM(offset_used_minutes), 0) / 60.0, 2) AS total_offset_used_hours,
       ROUND(COALESCE(SUM(overtime_hours), 0), 2) AS total_overtime_hours,
       COALESCE(SUM(total_worked_minutes), 0) AS total_worked_minutes
     FROM attendance
     WHERE employee_id = $1
       AND EXTRACT(YEAR FROM date) = $2
       AND EXTRACT(MONTH FROM date) = $3`,
    [employeeId, year, month]
  )
  res.json({ success: true, data: result.rows[0] })
})

export const getAttendanceRequests = asyncHandler(async (req: Request, res: Response) => {
  const params: unknown[] = []
  const where = req.query.status ? 'WHERE ar.status = $1' : ''
  if (req.query.status) params.push(req.query.status)

  const result = await pool.query(
    `SELECT ar.*, e.first_name, e.last_name, e.employee_number
     FROM attendance_requests ar
     JOIN employees e ON ar.employee_id = e.id
     ${where}
     ORDER BY ar.created_at DESC`,
    params
  )
  res.json({ success: true, data: result.rows })
})

export const createAttendanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const { date, requestedStatus, requestedTimeIn, requestedTimeOut, reason } = req.body
  if (!req.user!.employeeId) throw createError('Only employee-linked accounts can submit attendance requests', 400)
  if (!date || !reason) throw createError('date and reason are required', 400)

  const result = await pool.query(
    `INSERT INTO attendance_requests (
       employee_id, date, requested_status, requested_time_in, requested_time_out, reason, status
     ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING *`,
    [
      req.user!.employeeId,
      date,
      requestedStatus ?? 'present',
      requestedTimeIn || null,
      requestedTimeOut || null,
      reason,
    ]
  )

  res.status(201).json({ success: true, data: result.rows[0] })
})

export const approveAttendanceRequest = asyncHandler(async (req: Request, res: Response) => {
  const { action, remarks } = req.body // action: 'approve' | 'reject'
  if (!action) throw createError('action is required', 400)
  if (action !== 'approve' && action !== 'reject') throw createError('action must be approve or reject', 400)

  const status = action === 'approve' ? 'approved' : 'rejected'
  const result = await pool.query(
    `UPDATE attendance_requests
     SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_remarks = $3
     WHERE id = $4 RETURNING *`,
    [status, req.user!.userId, remarks, req.params.id]
  )
  if (!result.rows[0]) throw createError('Request not found', 404)

  // If approved, update the actual attendance record
  if (action === 'approve') {
    const request = result.rows[0]
    await pool.query(
      `INSERT INTO attendance (employee_id, date, status, time_in, time_out, created_by)
       VALUES ($4, $5, $1, $2, $3, $6)
       ON CONFLICT (employee_id, date) DO UPDATE
       SET status = EXCLUDED.status,
           time_in = COALESCE(EXCLUDED.time_in, attendance.time_in),
           time_out = COALESCE(EXCLUDED.time_out, attendance.time_out),
           updated_at = NOW()
       RETURNING id`,
      [request.requested_status, request.requested_time_in, request.requested_time_out,
       request.employee_id, request.date, req.user!.userId]
    )
    await recomputeAttendanceForEmployeeDate(request.employee_id, request.date, req.user!.userId)
  }

  res.json({ success: true, data: result.rows[0] })
})

export const getOffsetBalancesReport = asyncHandler(async (req: Request, res: Response) => {
  const employeeId = req.user!.role === 'employee'
    ? req.user!.employeeId
    : req.query.employeeId ? String(req.query.employeeId) : undefined

  if (req.user!.role === 'employee' && !employeeId) {
    throw createError('No employee profile is linked to this account', 403)
  }

  const data = await getOffsetBalances(employeeId)
  res.json({ success: true, data: req.user!.role === 'employee' ? data[0] ?? null : data })
})

export const getOffsetCreditsReport = asyncHandler(async (req: Request, res: Response) => {
  const data = await listOffsetCredits({
    employeeId: req.query.employeeId ? String(req.query.employeeId) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    startDate: req.query.startDate ? String(req.query.startDate) : undefined,
    endDate: req.query.endDate ? String(req.query.endDate) : undefined,
  })
  res.json({ success: true, data })
})

export const reviewOffsetCreditRequest = asyncHandler(async (req: Request, res: Response) => {
  const { action, remarks } = req.body
  if (action !== 'approve' && action !== 'reject') {
    throw createError('action must be approve or reject', 400)
  }

  const data = await reviewOffsetCredit(req.params.id, action, req.user!.userId, remarks)
  res.json({ success: true, data })
})

export const getOffsetUsagesReport = asyncHandler(async (req: Request, res: Response) => {
  const data = await listOffsetUsages({
    employeeId: req.query.employeeId ? String(req.query.employeeId) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    startDate: req.query.startDate ? String(req.query.startDate) : undefined,
    endDate: req.query.endDate ? String(req.query.endDate) : undefined,
  })
  res.json({ success: true, data })
})

export const submitOffsetUsage = asyncHandler(async (req: Request, res: Response) => {
  const employeeId = req.user!.role === 'employee'
    ? req.user!.employeeId
    : req.body.employeeId
  const { usageDate, requestedMinutes, reason } = req.body

  if (!employeeId) throw createError('employeeId is required', 400)
  if (!usageDate || !requestedMinutes || !reason) {
    throw createError('usageDate, requestedMinutes, and reason are required', 400)
  }

  const data = await createOffsetUsageRequest({
    employeeId,
    usageDate,
    requestedMinutes: Number(requestedMinutes),
    reason,
    createdBy: req.user!.userId,
  })
  res.status(201).json({ success: true, data })
})

export const reviewOffsetUsageRequest = asyncHandler(async (req: Request, res: Response) => {
  const { action, approvedMinutes, remarks } = req.body
  if (action !== 'approve' && action !== 'reject') {
    throw createError('action must be approve or reject', 400)
  }

  const data = await reviewOffsetUsage(
    req.params.id,
    action,
    req.user!.userId,
    approvedMinutes == null ? undefined : Number(approvedMinutes),
    remarks
  )
  res.json({ success: true, data })
})

export const createOffsetAdjustmentRecord = asyncHandler(async (req: Request, res: Response) => {
  const { employeeId, minutes, reason, date } = req.body
  if (!employeeId || !minutes || !reason) throw createError('employeeId, minutes, and reason are required', 400)

  const data = await createOffsetAdjustment({
    employeeId,
    minutes: Number(minutes),
    reason,
    date,
    actorUserId: req.user!.userId,
  })
  res.status(201).json({ success: true, data })
})
