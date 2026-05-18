import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import {
  cancelLeaveRequest,
  previewLeaveRequest,
  uploadLeaveDocument,
} from '../src/controllers/leaveController'
import { errorHandler } from '../src/middleware/errorHandler'
import { LeaveBalanceService } from '../src/services/leaveBalanceService'
import { LeavePolicyService, type LeaveCode, type LeaveValidationResult } from '../src/services/leavePolicyService'
import { LeaveRequestService } from '../src/services/leaveRequestService'
import { LeaveApprovalService } from '../src/services/leaveApprovalService'
import pool from '../src/utils/db'

type QueryResult = { rows: unknown[]; rowCount?: number }
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>

const employeeId = '11111111-1111-4111-8111-111111111111'
const otherEmployeeId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const leaveRequestId = '44444444-4444-4444-8444-444444444444'
const leaveTypeId = '55555555-5555-4555-8555-555555555555'

const originals = {
  poolQuery: pool.query.bind(pool),
  poolConnect: pool.connect.bind(pool),
  getAvailable: LeaveBalanceService.getAvailable,
  getEmployee: LeavePolicyService.getEmployee,
  validate: LeavePolicyService.validate,
  getById: LeaveRequestService.getById,
  approvalCancel: LeaveApprovalService.cancel,
}

function restoreAll() {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  ;(pool as unknown as { connect: typeof originals.poolConnect }).connect = originals.poolConnect
  LeaveBalanceService.getAvailable = originals.getAvailable
  LeavePolicyService.getEmployee = originals.getEmployee
  LeavePolicyService.validate = originals.validate
  LeaveRequestService.getById = originals.getById
  LeaveApprovalService.cancel = originals.approvalCancel
}

afterEach(restoreAll)

function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => void,
  req: Partial<Request>
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(payload: Record<string, unknown>) {
        resolve({ statusCode: this.statusCode, body: payload })
        return this
      },
    } as Response

    const next: NextFunction = (error?: unknown) => {
      if (error) {
        errorHandler(error as never, {} as Request, res, (() => undefined) as NextFunction)
      }
    }

    handler(req as Request, res, next)
  })
}

function rawRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: leaveRequestId,
    employee_id: employeeId,
    start_date: new Date('2026-05-18T00:00:00.000Z'),
    end_date: new Date('2026-05-19T00:00:00.000Z'),
    total_days: '2',
    day_count_type: 'working_days',
    status: 'pending',
    is_contagious: false,
    leave_type_code: 'VACATION',
    leave_type_name: 'Vacation Leave',
    leave_type_is_paid: true,
    leave_type_requires_balance: true,
    ...overrides,
  }
}

function installApprovalClientMock(options: { failPayrollStatus?: boolean; documentRows?: unknown[]; raw?: Record<string, unknown> } = {}) {
  const queries: string[] = []
  let released = false

  const client = {
    query: async (text: string, params?: unknown[]): Promise<QueryResult> => {
      queries.push(text)
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
      if (text.includes('FROM leave_requests lr') && text.includes('FOR UPDATE')) {
        return { rows: [rawRequest(options.raw)] }
      }
      if (text.includes('FROM leave_documents')) return { rows: options.documentRows ?? [] }
      if (text.includes('UPDATE leave_requests') && text.includes("SET status = 'approved'")) {
        return { rows: [{ ...rawRequest(options.raw), status: 'approved', reviewed_by: userId }] }
      }
      if (text.includes('FROM holidays')) return { rows: [] }
      if (text.includes('INSERT INTO attendance')) return { rows: [], rowCount: 1 }
      if (text.includes('SELECT basic_salary')) {
        return { rows: [{ basic_salary: 44000, daily_rate: 2000, work_days_per_month: 22 }] }
      }
      if (text.includes('UPDATE leave_requests') && text.includes('payroll_impact_status')) {
        if (options.failPayrollStatus) throw new Error('payroll status failed')
        return { rows: [], rowCount: 1 }
      }
      if (text.includes('UPDATE leave_requests') && text.includes('attendance_impact_status')) {
        return { rows: [{ ...rawRequest(options.raw), status: 'approved', attendance_impact_status: 'applied' }] }
      }
      if (text.includes('INSERT INTO leave_approval_history')) return { rows: [], rowCount: 1 }
      if (text.includes('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 }
      throw new Error(`Unexpected approval query: ${text}`)
    },
    release: () => {
      released = true
    },
  }

  ;(pool as unknown as { connect: () => Promise<unknown> }).connect = async () => client
  LeaveBalanceService.getAvailable = async () => 10

  return { queries, released: () => released }
}

test('approval rolls back when an impact step fails', async () => {
  const state = installApprovalClientMock({ failPayrollStatus: true })

  await assert.rejects(
    LeaveRequestService.approve(leaveRequestId, { userId, employeeId, role: 'admin' }, 'ok'),
    /payroll status failed/
  )

  assert.ok(state.queries.includes('BEGIN'))
  assert.ok(state.queries.includes('ROLLBACK'))
  assert.equal(state.queries.includes('COMMIT'), false)
  assert.equal(state.released(), true)
})

test('employee cannot access or modify another employee leave request', async () => {
  LeaveRequestService.getById = async () => ({ id: leaveRequestId, employee_id: otherEmployeeId })
  LeaveApprovalService.cancel = async () => ({ id: leaveRequestId, status: 'cancelled' })

  const viewResult = await invoke(uploadLeaveDocument, {
    params: { id: leaveRequestId },
    body: { documentType: 'MEDICAL_CERTIFICATE', fileName: 'cert.pdf', fileUrl: 'https://files.test/cert.pdf' },
    user: { userId, employeeId, role: 'employee' },
  } as Partial<Request>)
  const cancelResult = await invoke(cancelLeaveRequest, {
    params: { id: leaveRequestId },
    body: {},
    user: { userId, employeeId, role: 'employee' },
  } as Partial<Request>)
  const roleResult = await invoke(previewLeaveRequest, {
    body: {},
    user: { userId, role: 'payroll_preparer' },
  } as Partial<Request>)

  assert.equal(viewResult.statusCode, 403)
  assert.match(String(viewResult.body.message), /own leave requests/i)
  assert.equal(cancelResult.statusCode, 403)
  assert.match(String(cancelResult.body.message), /own leave requests/i)
  assert.equal(roleResult.statusCode, 403)
})

test('pending emergency leave reserves sick and vacation credits', async () => {
  const usageQueries: string[] = []
  ;(pool as unknown as { query: QueryFn }).query = async (text: string, params?: unknown[]): Promise<QueryResult> => {
    if (text.includes('FROM employees e')) {
      return {
        rows: [{
          id: employeeId,
          employment_type: 'regular',
          regularization_date: new Date('2021-01-01T00:00:00.000Z'),
        }],
      }
    }
    if (text.includes('WHERE code = $1')) {
      return {
        rows: [{
          id: leaveTypeId,
          code: params?.[0],
          name: `${params?.[0]} Leave`,
          is_paid: true,
          requires_balance: true,
          is_accrual_based: true,
          applies_to_probationary: false,
          applies_to_regular: true,
          day_count_type: 'working_days',
        }],
      }
    }
    if (text.includes('SELECT days_per_year')) return { rows: [{ days_per_year: 15 }] }
    if (text.includes('FROM leave_policies')) return { rows: [] }
    if (text.includes('FROM leave_balances')) return { rows: [{ opening_balance: 0, carried_over_credits: 0, forfeited_credits: 0, converted_to_cash_credits: 0 }] }
    if (text.includes('FROM leave_requests lr')) {
      usageQueries.push(text)
      return { rows: [{ used: 0, pending: params?.[1] === 'SICK' ? 3 : 2 }] }
    }
    throw new Error(`Unexpected balance query: ${text}`)
  }

  const sick = await LeaveBalanceService.getAvailable(employeeId, 'SICK', 2026, new Date('2026-12-31T00:00:00.000Z'))
  const vacation = await LeaveBalanceService.getAvailable(employeeId, 'VACATION', 2026, new Date('2026-12-31T00:00:00.000Z'))

  assert.equal(sick, 12)
  assert.equal(vacation, 13)
  assert.ok(usageQueries.some((query) => query.includes("$2 = 'SICK' THEN lr.deducted_sick_days")))
  assert.ok(usageQueries.some((query) => query.includes("$2 = 'VACATION' THEN lr.deducted_vacation_days")))
})

test('employee can cancel an owned pending leave request', async () => {
  LeaveRequestService.getById = async () => ({ id: leaveRequestId, employee_id: employeeId, status: 'pending' })
  LeaveApprovalService.cancel = async () => ({ id: leaveRequestId, employee_id: employeeId, status: 'cancelled' })

  const result = await invoke(cancelLeaveRequest, {
    params: { id: leaveRequestId },
    body: {},
    user: { userId, employeeId, role: 'employee' },
  } as Partial<Request>)

  assert.equal(result.statusCode, 200)
  assert.equal((result.body.data as Record<string, unknown>).status, 'cancelled')
})

test('approval does not treat declared document placeholders as uploaded documents', async () => {
  const state = installApprovalClientMock({
    raw: {
      leave_type_code: 'SICK',
      leave_type_name: 'Sick Leave',
      total_days: '3',
      is_contagious: false,
    },
    documentRows: [],
  })

  await assert.rejects(
    LeaveRequestService.approve(leaveRequestId, { userId, employeeId, role: 'admin' }, 'ok'),
    /medical certificate/i
  )

  assert.ok(state.queries.includes('ROLLBACK'))
  assert.equal(state.queries.some((query) => query.includes("SET status = 'approved'")), false)
})

test('maternity uses calendar days while paternity uses working days for payroll input', async () => {
  ;(pool as unknown as { query: QueryFn }).query = async (text: string): Promise<QueryResult> => {
    if (text.includes('FROM holidays')) return { rows: [{ holiday_date: '2026-05-20' }] }
    if (text.includes('SELECT basic_salary')) {
      return { rows: [{ basic_salary: 44000, daily_rate: 2000, work_days_per_month: 22 }] }
    }
    if (text.includes('INSERT INTO payroll_leave_adjustments')) return { rows: [], rowCount: 1 }
    if (text.includes('UPDATE leave_requests')) return { rows: [], rowCount: 1 }
    throw new Error(`Unexpected statutory query: ${text}`)
  }

  const employee = {
    id: employeeId,
    employee_number: 'EMP-001',
    first_name: 'Ada',
    last_name: 'Lovelace',
    employment_type: 'regular',
    hire_date: new Date('2020-01-01T00:00:00.000Z'),
    regularization_date: new Date('2020-07-01T00:00:00.000Z'),
    gender: 'female',
    civil_status: 'married',
    basic_salary: '44000',
    daily_rate: '2000',
    work_days_per_month: 22,
    city: null,
    province: null,
    nationality: 'Filipino',
    shift_start_time: '08:00:00',
  }
  const maternityDays = await LeavePolicyService.countLeaveDays(
    { id: leaveTypeId, code: 'MATERNITY', name: 'Maternity Leave', is_paid: true, is_accrual_based: false, requires_balance: false, applies_to_probationary: true, applies_to_regular: true, max_days_per_request: '105', filing_deadline_days: null, filing_deadline_type: null, requires_document: false, document_rule: null, is_statutory: true, day_count_type: 'calendar_days' },
    employee,
    new Date('2026-05-18T00:00:00.000Z'),
    new Date('2026-05-24T00:00:00.000Z')
  )
  const paternityDays = await LeavePolicyService.countLeaveDays(
    { id: leaveTypeId, code: 'PATERNITY', name: 'Paternity Leave', is_paid: true, is_accrual_based: false, requires_balance: false, applies_to_probationary: true, applies_to_regular: true, max_days_per_request: '7', filing_deadline_days: null, filing_deadline_type: null, requires_document: false, document_rule: null, is_statutory: true, day_count_type: 'working_days' },
    { ...employee, gender: 'male' },
    new Date('2026-05-18T00:00:00.000Z'),
    new Date('2026-05-24T00:00:00.000Z')
  )

  assert.equal(maternityDays, 7)
  assert.equal(paternityDays, 4)
})

test('vacation, sick, and emergency previews still compute credit splits', async () => {
  LeavePolicyService.validate = async (input): Promise<LeaveValidationResult> => {
    const code = input.leaveTypeId as LeaveCode
    return {
      employee: {
        id: employeeId,
        employee_number: 'EMP-001',
        first_name: 'Ada',
        last_name: 'Lovelace',
        employment_type: 'regular',
        hire_date: new Date('2020-01-01T00:00:00.000Z'),
        regularization_date: new Date('2020-07-01T00:00:00.000Z'),
        gender: 'female',
        civil_status: 'married',
        basic_salary: '44000',
        daily_rate: '2000',
        work_days_per_month: 22,
        city: null,
        province: null,
        nationality: 'Filipino',
        shift_start_time: '08:00:00',
      },
      leaveType: {
        id: leaveTypeId,
        code,
        name: `${code} Leave`,
        is_paid: true,
        is_accrual_based: code !== 'EMERGENCY',
        requires_balance: code !== 'EMERGENCY',
        applies_to_probationary: false,
        applies_to_regular: true,
        max_days_per_request: null,
        filing_deadline_days: null,
        filing_deadline_type: null,
        requires_document: false,
        document_rule: null,
        is_statutory: false,
        day_count_type: 'working_days',
      },
      totalDays: code === 'EMERGENCY' ? 7 : 2,
      dayCountType: 'working_days',
      warnings: [],
      errors: [],
    }
  }
  LeavePolicyService.getEmployee = async () => ({
    id: employeeId,
    employee_number: 'EMP-001',
    first_name: 'Ada',
    last_name: 'Lovelace',
    employment_type: 'regular',
    hire_date: new Date('2020-01-01T00:00:00.000Z'),
    regularization_date: new Date('2020-07-01T00:00:00.000Z'),
    gender: 'female',
    civil_status: 'married',
    basic_salary: '44000',
    daily_rate: '2000',
    work_days_per_month: 22,
    city: null,
    province: null,
    nationality: 'Filipino',
    shift_start_time: '08:00:00',
  })
  LeaveBalanceService.getAvailable = async (_employeeId, code) => {
    if (code === 'SICK') return 4
    if (code === 'VACATION') return 2
    return 0
  }

  const vacation = await LeaveRequestService.preview({ employeeId, leaveTypeId: 'VACATION', startDate: '2026-05-18', endDate: '2026-05-19', reason: 'rest' })
  const sick = await LeaveRequestService.preview({ employeeId, leaveTypeId: 'SICK', startDate: '2026-05-18', endDate: '2026-05-19', reason: 'illness' })
  const emergency = await LeaveRequestService.preview({ employeeId, leaveTypeId: 'EMERGENCY', startDate: '2026-05-18', endDate: '2026-05-26', reason: 'urgent' })

  assert.deepEqual(vacation.deduction, { deductedSickDays: 0, deductedVacationDays: 2, deductedOtherDays: 0, unpaidDays: 0 })
  assert.deepEqual(sick.deduction, { deductedSickDays: 2, deductedVacationDays: 0, deductedOtherDays: 0, unpaidDays: 0 })
  assert.deepEqual(emergency.deduction, { deductedSickDays: 4, deductedVacationDays: 2, deductedOtherDays: 0, unpaidDays: 1 })
})
