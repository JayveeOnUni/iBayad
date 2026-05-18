import { Request, Response } from 'express'
import pool from '../utils/db'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { LeaveApprovalService } from '../services/leaveApprovalService'
import { LeaveBalanceService } from '../services/leaveBalanceService'
import { LeaveCarryOverService } from '../services/leaveCarryOverService'
import { LeavePolicyService } from '../services/leavePolicyService'
import { LeaveRequestService } from '../services/leaveRequestService'
import { LeavePayrollImpactService } from '../services/leavePayrollImpactService'

function actor(req: Request) {
  return {
    userId: req.user?.userId,
    employeeId: req.user?.employeeId,
    role: req.user?.role,
  }
}

function isLeaveAdmin(req: Request): boolean {
  return req.user?.role === 'admin' || req.user?.role === 'super_admin'
}

function assertLeaveSelfServiceOrAdmin(req: Request): void {
  if (req.user?.role === 'employee') {
    if (!req.user.employeeId) throw createError('No employee profile is linked to this account', 403)
    return
  }
  if (isLeaveAdmin(req)) return
  throw createError('This account is not allowed to perform leave actions', 403)
}

function assertLeaveAdmin(req: Request): void {
  if (!isLeaveAdmin(req)) throw createError('This account is not allowed to manage leave requests', 403)
}

function normalizeLeaveBody(req: Request, employeeId: string) {
  return {
    employeeId,
    leaveTypeId: String(req.body.leaveTypeId ?? ''),
    startDate: String(req.body.startDate ?? ''),
    endDate: String(req.body.endDate ?? ''),
    reason: String(req.body.reason ?? ''),
    emergencyReasonCategory: req.body.emergencyReasonCategory,
    notificationAt: req.body.notificationAt,
    notificationMethod: req.body.notificationMethod,
    emailFollowUpAt: req.body.emailFollowUpAt,
    isContagious: Boolean(req.body.isContagious),
    deliveryDate: req.body.deliveryDate,
    deliveryCount: req.body.deliveryCount == null ? undefined : Number(req.body.deliveryCount),
    spouseDeliveryCount: req.body.spouseDeliveryCount == null ? undefined : Number(req.body.spouseDeliveryCount),
    relationshipToDeceased: req.body.relationshipToDeceased,
    acknowledgedPolicy: Boolean(req.body.acknowledgedPolicy),
    documentTypes: Array.isArray(req.body.documentTypes) ? req.body.documentTypes.map(String) : undefined,
  }
}

function operationalError(error: unknown, fallbackStatus = 400) {
  if (error instanceof Error) return createError(error.message, fallbackStatus)
  return createError('Leave operation failed', fallbackStatus)
}

export const getLeaveTypes = asyncHandler(async (_req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT id, code, name, description, is_paid, is_accrual_based, requires_balance,
            applies_to_probationary, applies_to_regular, max_days_per_request,
            filing_deadline_days, filing_deadline_type, requires_document, document_rule,
            is_cash_convertible, is_carry_over_allowed, is_statutory, day_count_type,
            policy_notes
     FROM leave_types
     WHERE is_active = true
     ORDER BY CASE code
       WHEN 'VACATION' THEN 1 WHEN 'SICK' THEN 2 WHEN 'EMERGENCY' THEN 3
       WHEN 'BEREAVEMENT' THEN 4 WHEN 'NON_PAID' THEN 5 WHEN 'MATERNITY' THEN 6
       WHEN 'PATERNITY' THEN 7 ELSE 99 END, name`
  )
  res.json({ success: true, data: result.rows, clarificationItems: LeavePolicyService.clarificationItems })
})

export const getLeaveRequests = asyncHandler(async (req: Request, res: Response) => {
  const data = await LeaveRequestService.list({
    status: req.query.status ? String(req.query.status) : undefined,
    employeeId: req.query.employeeId ? String(req.query.employeeId) : undefined,
    leaveTypeId: req.query.leaveTypeId ? String(req.query.leaveTypeId) : undefined,
    departmentId: req.query.departmentId ? String(req.query.departmentId) : undefined,
    startDate: req.query.startDate ? String(req.query.startDate) : undefined,
    endDate: req.query.endDate ? String(req.query.endDate) : undefined,
    payrollPeriodId: req.query.payrollPeriodId ? String(req.query.payrollPeriodId) : undefined,
  })
  res.json({ success: true, data })
})

export const getMyLeaveRequests = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.employeeId) throw createError('No employee profile is linked to this account', 403)
  const data = await LeaveRequestService.list({
    employeeId: req.user.employeeId,
    status: req.query.status ? String(req.query.status) : undefined,
  })
  res.json({ success: true, data })
})

export const getLeaveRequestById = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveSelfServiceOrAdmin(req)
  const data = await LeaveRequestService.getById(req.params.id)
  if (!data) throw createError('Leave request not found', 404)
  if (req.user?.role === 'employee' && data.employee_id !== req.user.employeeId) {
    throw createError('Employees can only view their own leave requests', 403)
  }
  res.json({ success: true, data })
})

export const getLeaveBalance = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveSelfServiceOrAdmin(req)
  const requestedEmployeeId = req.params.employeeId
  const employeeId = requestedEmployeeId || req.user?.employeeId
  if (!employeeId) throw createError('employeeId is required', 400)
  if (req.user?.role === 'employee' && employeeId !== req.user.employeeId) {
    throw createError('Employees can only view their own leave balance', 403)
  }
  const requestedYear = Number(req.query.year)
  const year = Number.isInteger(requestedYear) && requestedYear > 0 ? requestedYear : new Date().getFullYear()
  const data = await LeaveBalanceService.getBalances(employeeId, year)
  res.json({ success: true, data })
})

export const previewLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveSelfServiceOrAdmin(req)
  const requestedEmployeeId = req.body.employeeId ? String(req.body.employeeId) : undefined
  const canRequestForOthers = isLeaveAdmin(req)
  const employeeId = canRequestForOthers && requestedEmployeeId ? requestedEmployeeId : req.user?.employeeId
  if (!employeeId) throw createError('No employee profile is linked to this user', 400)
  if (req.user?.role === 'employee' && requestedEmployeeId && requestedEmployeeId !== req.user.employeeId) {
    throw createError('Employees can only preview leave requests for themselves', 403)
  }
  const data = await LeaveRequestService.preview(normalizeLeaveBody(req, employeeId))
  res.json({ success: true, data })
})

export const createLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveSelfServiceOrAdmin(req)
  const requestedEmployeeId = req.body.employeeId ? String(req.body.employeeId) : undefined
  const canRequestForOthers = isLeaveAdmin(req)
  const employeeId = canRequestForOthers && requestedEmployeeId ? requestedEmployeeId : req.user?.employeeId
  if (!employeeId) throw createError('No employee profile is linked to this user', 400)
  if (req.user?.role === 'employee' && requestedEmployeeId && requestedEmployeeId !== req.user.employeeId) {
    throw createError('Employees can only file leave requests for themselves', 403)
  }
  if (!req.body.leaveTypeId || !req.body.startDate || !req.body.endDate || !req.body.reason) {
    throw createError('leaveTypeId, startDate, endDate, and reason are required', 400)
  }

  try {
    const data = await LeaveRequestService.create(normalizeLeaveBody(req, employeeId), actor(req))
    res.status(201).json({ success: true, data })
  } catch (error) {
    throw operationalError(error)
  }
})

export const approveLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveAdmin(req)
  try {
    const data = await LeaveApprovalService.approve(req.params.id, actor(req), req.body.remarks)
    res.json({ success: true, data })
  } catch (error) {
    throw operationalError(error, error instanceof Error && error.message.includes('not found') ? 404 : 400)
  }
})

export const rejectLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveAdmin(req)
  try {
    const data = await LeaveApprovalService.reject(req.params.id, actor(req), String(req.body.remarks ?? req.body.reason ?? ''))
    res.json({ success: true, data })
  } catch (error) {
    throw operationalError(error, error instanceof Error && error.message.includes('not found') ? 404 : 400)
  }
})

export const reviewLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveAdmin(req)
  const action = String(req.body.action ?? '')
  if (action === 'approve') {
    const data = await LeaveApprovalService.approve(req.params.id, actor(req), req.body.remarks)
    res.json({ success: true, data })
    return
  }
  if (action === 'reject') {
    const data = await LeaveApprovalService.reject(req.params.id, actor(req), String(req.body.remarks ?? ''))
    res.json({ success: true, data })
    return
  }
  throw createError('action must be approve or reject', 400)
})

export const cancelLeaveRequest = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveSelfServiceOrAdmin(req)
  if (req.user?.role === 'employee') {
    const request = await LeaveRequestService.getById(req.params.id)
    if (!request) throw createError('Leave request not found', 404)
    if (request.employee_id !== req.user.employeeId) {
      throw createError('Employees can only cancel their own leave requests', 403)
    }
  }
  try {
    const data = await LeaveApprovalService.cancel(req.params.id, actor(req), req.body.remarks)
    res.json({ success: true, data })
  } catch (error) {
    throw operationalError(error, error instanceof Error && error.message.includes('not found') ? 404 : 400)
  }
})

export const uploadLeaveDocument = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveSelfServiceOrAdmin(req)
  if (!req.body.documentType || !req.body.fileName || !req.body.fileUrl) {
    throw createError('documentType, fileName, and fileUrl are required', 400)
  }
  if (String(req.body.fileUrl).startsWith('metadata://')) {
    throw createError('Declared document placeholders cannot be uploaded as files', 400)
  }
  const request = await LeaveRequestService.getById(req.params.id)
  if (!request) throw createError('Leave request not found', 404)
  if (req.user?.role === 'employee' && request.employee_id !== req.user.employeeId) {
    throw createError('Employees can only upload documents for their own leave requests', 403)
  }
  const data = await LeaveRequestService.attachDocument({
    leaveRequestId: req.params.id,
    documentType: String(req.body.documentType),
    fileName: String(req.body.fileName),
    fileUrl: String(req.body.fileUrl),
    mimeType: req.body.mimeType ? String(req.body.mimeType) : undefined,
    uploadedBy: req.user?.userId,
  })
  res.status(201).json({ success: true, data })
})

export const adjustLeaveBalance = asyncHandler(async (req: Request, res: Response) => {
  assertLeaveAdmin(req)
  const { leaveTypeId, year, field, amount, remarks } = req.body
  if (!leaveTypeId || !year || !field || amount == null) {
    throw createError('leaveTypeId, year, field, and amount are required', 400)
  }
  const allowedFields = ['opening_balance', 'earned_credits', 'carried_over_credits', 'forfeited_credits', 'converted_to_cash_credits']
  if (!allowedFields.includes(field)) throw createError('Invalid balance adjustment field', 400)
  await LeaveBalanceService.adjustBalance({
    employeeId: req.params.employeeId,
    leaveTypeId: String(leaveTypeId),
    year: Number(year),
    field,
    amount: Number(amount),
  })
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, new_values)
     VALUES ($1, 'leave_balance_adjusted', 'leave_balances', $2, $3)`,
    [req.user?.userId ?? null, req.params.employeeId, JSON.stringify({ leaveTypeId, year, field, amount, remarks })]
  )
  res.json({ success: true, data: { adjusted: true } })
})

export const processYearEnd = asyncHandler(async (req: Request, res: Response) => {
  const year = Number(req.body.year ?? new Date().getFullYear())
  const data = await LeaveCarryOverService.processYearEnd(year, req.user?.userId)
  res.json({ success: true, data })
})

export const processCarryOver = processYearEnd

export const processCashConversion = asyncHandler(async (req: Request, res: Response) => {
  const year = Number(req.body.year ?? new Date().getFullYear())
  const data = await LeaveCarryOverService.processCashConversion(year, req.user?.userId)
  res.json({ success: true, data })
})

export const getLeaveReports = asyncHandler(async (req: Request, res: Response) => {
  const year = Number(req.query.year ?? new Date().getFullYear())
  const result = await pool.query(
    `SELECT lt.code, lt.name, lr.status,
            COUNT(lr.id) AS request_count,
            COALESCE(SUM(lr.total_days), 0) AS total_days,
            COALESCE(SUM(lr.unpaid_days), 0) AS unpaid_days
     FROM leave_types lt
     LEFT JOIN leave_requests lr ON lr.leave_type_id = lt.id
       AND EXTRACT(YEAR FROM lr.start_date) = $1
     WHERE lt.is_active = true
     GROUP BY lt.code, lt.name, lr.status
     ORDER BY lt.name, lr.status`,
    [year]
  )
  res.json({ success: true, data: result.rows })
})

export const getLeavePayrollImpact = asyncHandler(async (_req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT pla.*, e.first_name, e.last_name, e.employee_number
     FROM payroll_leave_adjustments pla
     JOIN employees e ON e.id = pla.employee_id
     ORDER BY pla.created_at DESC`
  )
  res.json({ success: true, data: result.rows })
})

export const getPayrollPeriodLeaveImpacts = asyncHandler(async (req: Request, res: Response) => {
  const data = await LeavePayrollImpactService.getPeriodImpacts(req.params.periodId)
  res.json({ success: true, data })
})

export const applyPayrollPeriodLeaveAdjustments = asyncHandler(async (req: Request, res: Response) => {
  const applied = await LeavePayrollImpactService.applyPeriodAdjustments(req.params.periodId)
  res.json({ success: true, data: { applied } })
})

export const getLeaveCalendar = asyncHandler(async (req: Request, res: Response) => {
  const year = req.query.year ? Number(req.query.year) : undefined
  const month = req.query.month ? Number(req.query.month) : undefined
  const monthStart = year && month ? `${year}-${String(month).padStart(2, '0')}-01` : undefined
  const monthEnd = year && month ? `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}` : undefined
  const data = await LeaveRequestService.list({
    employeeId: req.user?.role === 'employee' ? req.user.employeeId : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    startDate: monthStart,
    endDate: monthEnd,
  })
  res.json({ success: true, data })
})
