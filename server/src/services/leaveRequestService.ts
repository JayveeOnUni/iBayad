import { format } from 'date-fns'
import type { Pool, PoolClient } from 'pg'
import pool from '../utils/db'
import { LeaveAttendanceService } from './leaveAttendanceService'
import { LeaveAuditService } from './leaveAuditService'
import { LeaveBalanceService } from './leaveBalanceService'
import { LeavePayrollImpactService } from './leavePayrollImpactService'
import { LeaveCode, LeavePolicyService, LeaveRequestInput } from './leavePolicyService'
import { createError } from '../middleware/errorHandler'

type Queryable = Pool | PoolClient

export class LeaveRequestService {
  static async list(params: {
    employeeId?: string
    status?: string
    leaveTypeId?: string
    departmentId?: string
    startDate?: string
    endDate?: string
    payrollPeriodId?: string
  }): Promise<Record<string, unknown>[]> {
    const conditions: string[] = []
    const values: unknown[] = []
    let index = 1

    if (params.employeeId) {
      conditions.push(`lr.employee_id = $${index++}`)
      values.push(params.employeeId)
    }
    if (params.status) {
      conditions.push(`lr.status = $${index++}`)
      values.push(params.status)
    }
    if (params.leaveTypeId) {
      conditions.push(`lr.leave_type_id = $${index++}`)
      values.push(params.leaveTypeId)
    }
    if (params.departmentId) {
      conditions.push(`e.department_id = $${index++}`)
      values.push(params.departmentId)
    }
    if (params.startDate) {
      conditions.push(`lr.end_date >= $${index++}`)
      values.push(params.startDate)
    }
    if (params.endDate) {
      conditions.push(`lr.start_date <= $${index++}`)
      values.push(params.endDate)
    }
    if (params.payrollPeriodId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM payroll_periods pp
        WHERE pp.id = $${index++}
          AND daterange(lr.start_date, lr.end_date, '[]') && daterange(pp.start_date, pp.end_date, '[]')
      )`)
      values.push(params.payrollPeriodId)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const result = await pool.query(
      `SELECT lr.*, e.first_name, e.last_name, e.employee_number, e.department_id,
              lt.name AS leave_type_name, lt.code AS leave_type_code,
              COALESCE(json_agg(DISTINCT jsonb_build_object(
                'id', ld.id, 'document_type', ld.document_type, 'file_name', ld.file_name,
                'file_url', ld.file_url,
                'status', CASE WHEN ld.file_url LIKE 'metadata://%' THEN 'declared' ELSE ld.status::text END
              )) FILTER (WHERE ld.id IS NOT NULL), '[]') AS documents
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN leave_documents ld ON ld.leave_request_id = lr.id
       ${where}
       GROUP BY lr.id, e.first_name, e.last_name, e.employee_number, e.department_id, lt.name, lt.code
       ORDER BY lr.created_at DESC`,
      values
    )
    return result.rows
  }

  static async getById(id: string): Promise<Record<string, unknown> | undefined> {
    const result = await pool.query(
      `SELECT lr.*, e.first_name, e.last_name, e.employee_number, e.department_id,
              lt.name AS leave_type_name, lt.code AS leave_type_code,
              COALESCE(json_agg(DISTINCT jsonb_build_object(
                'id', ld.id, 'document_type', ld.document_type, 'file_name', ld.file_name,
                'file_url', ld.file_url,
                'status', CASE WHEN ld.file_url LIKE 'metadata://%' THEN 'declared' ELSE ld.status::text END
              )) FILTER (WHERE ld.id IS NOT NULL), '[]') AS documents
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       LEFT JOIN leave_documents ld ON ld.leave_request_id = lr.id
       WHERE lr.id = $1
       GROUP BY lr.id, e.first_name, e.last_name, e.employee_number, e.department_id, lt.name, lt.code`,
      [id]
    )
    return result.rows[0]
  }

  static async create(input: LeaveRequestInput, actor: { userId?: string; employeeId?: string; role?: string }): Promise<Record<string, unknown>> {
    const validation = await LeavePolicyService.validate(input)
    if (validation.errors.length) {
      const error = new Error(validation.errors.join(' '))
      error.name = 'LeaveValidationError'
      throw error
    }

    const year = LeavePolicyService.parseDate(input.startDate).getFullYear()
    const split = await this.computeDeductionSplit(input.employeeId, validation.leaveType, validation.totalDays, year)

    if (validation.leaveType.requires_balance && validation.leaveType.is_paid && split.unpaidDays > 0) {
      throw createError(`Insufficient ${validation.leaveType.name.toLowerCase()} credits.`, 400)
    }

    const result = await pool.query(
      `INSERT INTO leave_requests (
         employee_id, leave_type_id, start_date, end_date, total_days, day_count_type, reason,
         emergency_reason_category, status, is_paid, unpaid_days, deducted_sick_days,
         deducted_vacation_days, deducted_other_days, payroll_impact_status, attendance_impact_status,
         notification_at, notification_method, email_follow_up_at, is_contagious,
         delivery_date, delivery_count, spouse_delivery_count, relationship_to_deceased,
         acknowledged_policy, is_half_day
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10, $11, $12, $13,
         'not_applied', 'not_applied', $14, $15, $16, $17, $18, $19, $20, $21, $22, false
       ) RETURNING *`,
      [
        input.employeeId,
        input.leaveTypeId,
        input.startDate,
        input.endDate,
        validation.totalDays,
        validation.dayCountType,
        input.reason,
        input.emergencyReasonCategory ?? null,
        split.unpaidDays < validation.totalDays,
        split.unpaidDays,
        split.deductedSickDays,
        split.deductedVacationDays,
        split.deductedOtherDays,
        input.notificationAt ?? null,
        input.notificationMethod ?? null,
        input.emailFollowUpAt ?? null,
        input.isContagious ?? false,
        input.deliveryDate ?? null,
        input.deliveryCount ?? null,
        input.spouseDeliveryCount ?? null,
        input.relationshipToDeceased ?? null,
        input.acknowledgedPolicy ?? false,
      ]
    )

    const request = result.rows[0] as Record<string, unknown>
    await this.createDocumentPlaceholders(String(request.id), input.documentTypes, actor.userId)
    await LeaveAuditService.record({
      leaveRequestId: String(request.id),
      action: 'submitted',
      previousStatus: null,
      newStatus: 'pending',
      remarks: validation.warnings.join(' '),
      userId: actor.userId,
      employeeId: actor.employeeId,
      role: actor.role,
    })
    await LeaveAuditService.recordEntityAudit({
      userId: actor.userId,
      action: 'leave_request_submitted',
      entity: 'leave_requests',
      entityId: String(request.id),
      newValues: request,
    })

    return { ...request, validation_warnings: validation.warnings }
  }

  static async approve(id: string, actor: { userId?: string; employeeId?: string; role?: string }, remarks?: string): Promise<Record<string, unknown>> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const approved = await this.approveInTransaction(id, actor, remarks, client)
      await client.query('COMMIT')
      return approved
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private static async approveInTransaction(
    id: string,
    actor: { userId?: string; employeeId?: string; role?: string },
    remarks: string | undefined,
    db: PoolClient
  ): Promise<Record<string, unknown>> {
    const existing = await this.getRawRequest(id, db, true)
    if (!existing) throw new Error('Request not found')
    if (existing.status !== 'pending') throw new Error('Request not found or already reviewed')

    await this.validateApprovalDocuments(existing, db)

    const year = new Date(existing.start_date).getFullYear()
    const split = await this.computeDeductionSplit(existing.employee_id, {
      code: existing.leave_type_code,
      is_paid: existing.leave_type_is_paid,
      requires_balance: existing.leave_type_requires_balance,
    }, Number(existing.total_days), year, { excludeLeaveRequestId: id, db })
    if (existing.leave_type_requires_balance && existing.leave_type_is_paid && split.unpaidDays > 0) {
      throw createError(`Insufficient ${existing.leave_type_name.toLowerCase()} credits.`, 400)
    }

    const update = await db.query(
      `UPDATE leave_requests
       SET status = 'approved',
           reviewed_by = $2,
           reviewed_at = NOW(),
           review_remarks = $3,
           approved_at = NOW(),
           unpaid_days = $4,
           deducted_sick_days = $5,
           deducted_vacation_days = $6,
           is_paid = $7,
           deducted_other_days = $8,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        actor.userId ?? null,
        remarks ?? null,
        split.unpaidDays,
        split.deductedSickDays,
        split.deductedVacationDays,
        split.unpaidDays < Number(existing.total_days),
        split.deductedOtherDays,
      ]
    )
    let approved = update.rows[0] as Record<string, unknown>

    await LeaveAttendanceService.applyApprovedLeave({
      employeeId: existing.employee_id,
      startDate: new Date(existing.start_date),
      endDate: new Date(existing.end_date),
      dayCountType: existing.day_count_type,
      unpaidDays: split.unpaidDays,
      leaveName: existing.leave_type_name,
      userId: actor.userId,
    }, db)
    await LeavePayrollImpactService.createForApprovedLeave({
      employeeId: existing.employee_id,
      leaveRequestId: id,
      unpaidDays: split.unpaidDays,
      paidDays: Number(existing.total_days) - split.unpaidDays,
      leaveCode: existing.leave_type_code,
    }, db)
    const finalStatus = await db.query(
      `UPDATE leave_requests
       SET attendance_impact_status = 'applied', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    )
    approved = finalStatus.rows[0] as Record<string, unknown>

    await LeaveAuditService.record({
      leaveRequestId: id,
      action: 'approved',
      previousStatus: existing.status,
      newStatus: 'approved',
      remarks,
      userId: actor.userId,
      employeeId: actor.employeeId,
      role: actor.role,
    }, db)
    await LeaveAuditService.recordEntityAudit({
      userId: actor.userId,
      action: 'leave_request_approved',
      entity: 'leave_requests',
      entityId: id,
      oldValues: existing,
      newValues: approved,
    }, db)

    return approved
  }

  static async reject(id: string, actor: { userId?: string; employeeId?: string; role?: string }, remarks: string): Promise<Record<string, unknown>> {
    if (!remarks) throw new Error('Rejection requires remarks.')
    const existing = await this.getRawRequest(id)
    if (!existing) throw new Error('Request not found')
    if (existing.status !== 'pending') throw new Error('Request not found or already reviewed')

    const result = await pool.query(
      `UPDATE leave_requests
       SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(),
           review_remarks = $3, rejected_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, actor.userId ?? null, remarks]
    )
    await LeaveAuditService.record({
      leaveRequestId: id,
      action: 'rejected',
      previousStatus: existing.status,
      newStatus: 'rejected',
      remarks,
      userId: actor.userId,
      employeeId: actor.employeeId,
      role: actor.role,
    })
    return result.rows[0] as Record<string, unknown>
  }

  static async cancel(id: string, actor: { userId?: string; employeeId?: string; role?: string }, remarks?: string): Promise<Record<string, unknown>> {
    const existing = await this.getRawRequest(id)
    if (!existing) throw new Error('Request not found')
    if (actor.role === 'employee' && existing.employee_id !== actor.employeeId) throw new Error('Employees can only cancel their own leave requests')
    if (!['pending', 'approved'].includes(existing.status)) throw new Error('Request cannot be cancelled')

    if (existing.status === 'approved') {
      await LeaveAttendanceService.reverseLeave({
        employeeId: existing.employee_id,
        startDate: new Date(existing.start_date),
        endDate: new Date(existing.end_date),
      })
    }

    const result = await pool.query(
      `UPDATE leave_requests
       SET status = 'cancelled', cancelled_at = NOW(), review_remarks = COALESCE($2, review_remarks),
           attendance_impact_status = CASE WHEN attendance_impact_status = 'applied' THEN 'reversed' ELSE attendance_impact_status END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, remarks ?? null]
    )
    await LeaveAuditService.record({
      leaveRequestId: id,
      action: 'cancelled',
      previousStatus: existing.status,
      newStatus: 'cancelled',
      remarks,
      userId: actor.userId,
      employeeId: actor.employeeId,
      role: actor.role,
    })
    return result.rows[0] as Record<string, unknown>
  }

  static async attachDocument(params: {
    leaveRequestId: string
    documentType: string
    fileName: string
    fileUrl: string
    mimeType?: string
    uploadedBy?: string
  }): Promise<Record<string, unknown>> {
    const result = await pool.query(
      `INSERT INTO leave_documents (leave_request_id, document_type, file_name, file_url, mime_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        params.leaveRequestId,
        params.documentType,
        params.fileName,
        params.fileUrl,
        params.mimeType ?? null,
        params.uploadedBy ?? null,
      ]
    )
    await LeaveAuditService.record({
      leaveRequestId: params.leaveRequestId,
      action: 'document_uploaded',
      newStatus: null,
      userId: params.uploadedBy,
    })
    return result.rows[0] as Record<string, unknown>
  }

  static async preview(input: LeaveRequestInput): Promise<Record<string, unknown>> {
    const validation = await LeavePolicyService.validate(input)
    const year = LeavePolicyService.parseDate(input.startDate).getFullYear()
    const split = await this.computeDeductionSplit(input.employeeId, validation.leaveType, validation.totalDays, year)
    if (validation.leaveType.requires_balance && validation.leaveType.is_paid && split.unpaidDays > 0) {
      validation.errors.push(`Insufficient ${validation.leaveType.name.toLowerCase()} credits.`)
    }
    return {
      leaveType: validation.leaveType,
      totalDays: validation.totalDays,
      dayCountType: validation.dayCountType,
      warnings: validation.warnings,
      errors: validation.errors,
      deduction: split,
      approvalRoute: this.approvalRoute(validation.leaveType.code, validation.totalDays),
      clarificationItems: LeavePolicyService.clarificationItems,
    }
  }

  private static async computeDeductionSplit(employeeId: string, leaveType: {
    code: LeaveCode
    is_paid: boolean
    requires_balance: boolean
  }, totalDays: number, year: number, options: { excludeLeaveRequestId?: string; db?: Queryable } = {}): Promise<{
    deductedSickDays: number
    deductedVacationDays: number
    deductedOtherDays: number
    unpaidDays: number
  }> {
    const code = leaveType.code
    const emptyPaid = { deductedSickDays: 0, deductedVacationDays: 0, deductedOtherDays: 0, unpaidDays: 0 }
    const unpaid = { deductedSickDays: 0, deductedVacationDays: 0, deductedOtherDays: 0, unpaidDays: totalDays }

    if (code === 'NON_PAID') return unpaid
    if (code !== 'MATERNITY' && code !== 'PATERNITY' && !leaveType.is_paid) return unpaid
    if (!leaveType.requires_balance && code !== 'EMERGENCY') return emptyPaid

    if (code === 'VACATION') {
      const available = await LeaveBalanceService.getAvailable(employeeId, 'VACATION', year, new Date(), options)
      return { deductedSickDays: 0, deductedVacationDays: Math.min(totalDays, available), deductedOtherDays: 0, unpaidDays: Math.max(0, totalDays - available) }
    }
    if (code === 'SICK') {
      const available = await LeaveBalanceService.getAvailable(employeeId, 'SICK', year, new Date(), options)
      return { deductedSickDays: Math.min(totalDays, available), deductedVacationDays: 0, deductedOtherDays: 0, unpaidDays: Math.max(0, totalDays - available) }
    }
    if (code === 'EMERGENCY') {
      const employee = await LeavePolicyService.getEmployee(employeeId, options.db)
      if (!employee || LeavePolicyService.isProbationary(employee)) {
        return unpaid
      }
      const sick = await LeaveBalanceService.getAvailable(employeeId, 'SICK', year, new Date(), options)
      const deductedSickDays = Math.min(totalDays, sick)
      const remainingAfterSick = totalDays - deductedSickDays
      const vacation = await LeaveBalanceService.getAvailable(employeeId, 'VACATION', year, new Date(), options)
      const deductedVacationDays = Math.min(remainingAfterSick, vacation)
      return {
        deductedSickDays,
        deductedVacationDays,
        deductedOtherDays: 0,
        unpaidDays: Math.max(0, remainingAfterSick - deductedVacationDays),
      }
    }
    if (leaveType.requires_balance) {
      const available = await LeaveBalanceService.getAvailable(employeeId, code, year, new Date(), options)
      const deductedOtherDays = Math.min(totalDays, available)
      return { deductedSickDays: 0, deductedVacationDays: 0, deductedOtherDays, unpaidDays: Math.max(0, totalDays - available) }
    }
    return emptyPaid
  }

  private static approvalRoute(code: LeaveCode, totalDays: number): string[] {
    if (code === 'VACATION' && totalDays > 3) return ['department_head', 'hr_admin']
    if (code === 'VACATION') return ['immediate_supervisor', 'hr_admin']
    return ['immediate_supervisor', 'hr_admin']
  }

  private static async getRawRequest(id: string, db: Queryable = pool, forUpdate = false): Promise<{
    id: string
    employee_id: string
    start_date: Date
    end_date: Date
    total_days: string
    day_count_type: 'working_days' | 'calendar_days'
    status: string
    is_contagious: boolean
    leave_type_is_paid: boolean
    leave_type_requires_balance: boolean
    leave_type_code: LeaveCode
    leave_type_name: string
  } | undefined> {
    const result = await db.query(
      `SELECT lr.*, lt.code AS leave_type_code, lt.name AS leave_type_name,
              COALESCE(lt.is_paid, true) AS leave_type_is_paid,
              COALESCE(lt.requires_balance, false) AS leave_type_requires_balance
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.id = $1
       ${forUpdate ? 'FOR UPDATE OF lr' : ''}`,
      [id]
    )
    return result.rows[0]
  }

  private static async validateApprovalDocuments(request: {
    id: string
    total_days: string
    is_contagious: boolean
    leave_type_code: LeaveCode
  }, db: Queryable = pool): Promise<void> {
    if (request.leave_type_code !== 'SICK') return
    const docs = await db.query(
      `SELECT document_type
       FROM leave_documents
       WHERE leave_request_id = $1
         AND status IN ('pending', 'verified')
         AND file_url NOT LIKE 'metadata://%'`,
      [request.id]
    )
    const documentTypes = new Set(docs.rows.map((row: { document_type: string }) => row.document_type))
    if (Number(request.total_days) > 2 && !documentTypes.has('MEDICAL_CERTIFICATE')) {
      throw new Error('Sick leave of more than 2 days requires a medical certificate.')
    }
    if (request.is_contagious && !documentTypes.has('MEDICAL_CLEARANCE')) {
      throw new Error('A medical clearance is required before returning to work for contagious disease.')
    }
  }

  private static async createDocumentPlaceholders(leaveRequestId: string, documentTypes?: string[], uploadedBy?: string): Promise<void> {
    if (!documentTypes?.length) return
    for (const documentType of documentTypes) {
      await pool.query(
        `INSERT INTO leave_documents (leave_request_id, document_type, file_name, file_url, mime_type, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          leaveRequestId,
          documentType,
          `${documentType.toLowerCase()}-declared-${format(new Date(), 'yyyyMMddHHmmss')}.txt`,
          `metadata://${documentType.toLowerCase()}`,
          'text/plain',
          uploadedBy ?? null,
        ]
      )
      await LeaveAuditService.record({
        leaveRequestId,
        action: 'document_declared',
        newStatus: null,
        userId: uploadedBy,
      })
    }
  }
}
