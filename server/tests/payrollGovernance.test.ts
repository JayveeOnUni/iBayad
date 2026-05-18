import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import pool from '../src/utils/db'
import { errorHandler } from '../src/middleware/errorHandler'

type QueryResult = { rows: unknown[]; rowCount?: number }
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>

const periodId = '11111111-1111-4111-8111-111111111111'
const recordId = '22222222-2222-4222-8222-222222222222'
const employeeId = '33333333-3333-4333-8333-333333333333'
const userId = '44444444-4444-4444-8444-444444444444'

const originals = {
  poolQuery: pool.query.bind(pool),
  poolConnect: pool.connect.bind(pool),
}

function restoreAll() {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  ;(pool as unknown as { connect: typeof originals.poolConnect }).connect = originals.poolConnect
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
      getHeader: () => undefined,
      setHeader: () => undefined,
    } as unknown as Response

    const next: NextFunction = (error?: unknown) => {
      if (error) {
        errorHandler(error as never, {} as Request, res, (() => undefined) as NextFunction)
      }
    }

    handler(req as Request, res, next)
  })
}

function req(body: Record<string, unknown> = {}, params: Record<string, string> = { id: periodId }) {
  return {
    params,
    body,
    ip: '127.0.0.1',
    get: () => 'node-test',
    user: { userId, role: 'payroll_preparer' },
  } as Partial<Request>
}

function installPoolQueryMock() {
  ;(pool as unknown as { query: QueryFn }).query = async (text: string): Promise<QueryResult> => {
    if (text.includes('WITH summaries AS') && text.includes('FROM payroll_periods pp')) {
      return {
        rows: [{
          id: periodId,
          name: 'May Payroll',
          status: 'processed',
          start_date: new Date('2026-05-01T00:00:00.000Z'),
          end_date: new Date('2026-05-15T00:00:00.000Z'),
          pay_date: new Date('2026-05-18T00:00:00.000Z'),
          pay_frequency: 'semi-monthly',
          active_employee_count: 1,
          record_count: 1,
          processing_record_count: 1,
          approved_record_count: 0,
          released_record_count: 0,
          total_gross_pay: 1000,
          total_deductions: 100,
          total_net_pay: 900,
          negative_net_count: 0,
          pending_attendance_request_count: 0,
          pending_leave_request_count: 0,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      }
    }
    if (text.includes('generate_series')) return { rows: [{ missing_count: 0 }] }
    if (text.includes("to_regclass('payroll_leave_adjustments')")) return { rows: [{ table_name: null }] }
    if (text.includes('INSERT INTO audit_logs') || text.includes('INSERT INTO payroll_audit_logs')) return { rows: [], rowCount: 1 }
    return { rows: [{ count: 0 }] }
  }
}

function installClientMock(handler: QueryFn) {
  const queries: Array<{ text: string; params?: unknown[] }> = []
  let released = false
  const client = {
    query: async (text: string, params?: unknown[]) => {
      queries.push({ text, params })
      return handler(text, params)
    },
    release: () => {
      released = true
    },
  }
  ;(pool as unknown as { connect: () => Promise<unknown> }).connect = async () => client
  return { queries, released: () => released }
}

test('reprocesses an existing pre-approval payroll period only with a reason and records audit metadata', async () => {
  installPoolQueryMock()
  const payrollService = require('../src/services/payrollService') as { processBatchPayroll: unknown }
  payrollService.processBatchPayroll = async () => ({ processed: 1, errors: [] })
  const { processPayroll } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')

  const state = installClientMock(async (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
    if (text.includes('SELECT * FROM payroll_periods') && text.includes('FOR UPDATE')) {
      return { rows: [{ id: periodId, status: 'processed', is_locked: false }] }
    }
    if (text.includes('SELECT') && text.includes('active_employee_count')) {
      return { rows: [{ active_employee_count: 1, record_count: 1, processing_record_count: 1, approved_record_count: 0, released_record_count: 0, total_gross_pay: 1000, total_deductions: 100, total_net_pay: 900, negative_net_count: 0 }] }
    }
    if (text.includes('SELECT COUNT(*)::int AS count') && text.includes('FROM payroll_records')) return { rows: [{ count: 1 }] }
    if (text.includes('UPDATE payroll_periods')) return { rows: [{ id: periodId, status: 'processed', reprocessed_by: userId }] }
    if (text.includes('UPDATE payroll_records')) return { rows: [], rowCount: 1 }
    if (text.includes('INSERT INTO audit_logs') || text.includes('INSERT INTO payroll_audit_logs')) return { rows: [], rowCount: 1 }
    throw new Error(`Unexpected query: ${text}`)
  })

  const result = await invoke(processPayroll, req({ reason: 'Attendance correction applied' }))

  assert.equal(result.statusCode, 200)
  assert.ok(state.queries.some((query) => query.text.includes('reprocessed_by = CASE WHEN $3 THEN $2 ELSE reprocessed_by END')))
  assert.ok(state.queries.some((query) => query.text.includes('INSERT INTO payroll_audit_logs') && query.params?.includes('payroll_reprocessed')))
  assert.equal(state.released(), true)
})

test('request correction moves approved payroll back to needs_correction and clears approval metadata', async () => {
  const { requestPayrollCorrection } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')
  const state = installClientMock(async (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
    if (text.includes('SELECT * FROM payroll_periods') && text.includes('FOR UPDATE')) {
      return { rows: [{ id: periodId, status: 'approved', is_locked: false, approved_by: userId }] }
    }
    if (text.includes('UPDATE payroll_periods')) return { rows: [{ id: periodId, status: 'needs_correction', approved_by: null }] }
    if (text.includes('UPDATE payroll_records')) return { rows: [], rowCount: 1 }
    if (text.includes('INSERT INTO audit_logs') || text.includes('INSERT INTO payroll_audit_logs')) return { rows: [], rowCount: 1 }
    throw new Error(`Unexpected query: ${text}`)
  })

  const result = await invoke(requestPayrollCorrection, req({ correctionNotes: 'Wrong allowance setup' }))

  assert.equal(result.statusCode, 200)
  assert.ok(state.queries.some((query) => query.text.includes('approved_by = NULL')))
  assert.ok(state.queries.some((query) => query.text.includes("SET status = 'needs_correction'") && query.text.includes('payroll_records')))
  assert.ok(state.queries.some((query) => query.text.includes('INSERT INTO payroll_audit_logs') && query.params?.includes('payroll_correction_requested')))
})

test('voids an individual payroll record with a reason and audit entry', async () => {
  const { voidPayrollRecord } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')
  const state = installClientMock(async (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
    if (text.includes('FROM payroll_records pr') && text.includes('FOR UPDATE')) {
      return { rows: [{ id: recordId, employee_id: employeeId, payroll_period_id: periodId, status: 'processed', period_status: 'processed', is_locked: false, period_is_locked: false, gross_pay: 1000, total_deductions: 100, net_pay: 900 }] }
    }
    if (text.includes("SET status = 'voided'")) return { rows: [{ id: recordId, status: 'voided', void_reason: 'Duplicate record' }] }
    if (text.includes('UPDATE payroll_periods')) return { rows: [], rowCount: 1 }
    if (text.includes('INSERT INTO audit_logs') || text.includes('INSERT INTO payroll_audit_logs')) return { rows: [], rowCount: 1 }
    throw new Error(`Unexpected query: ${text}`)
  })

  const result = await invoke(voidPayrollRecord, req({ reason: 'Duplicate record' }, { id: recordId }))

  assert.equal(result.statusCode, 200)
  assert.equal((result.body.data as Record<string, unknown>).status, 'voided')
  assert.ok(state.queries.some((query) => query.text.includes('voided_by = $2')))
  assert.ok(state.queries.some((query) => query.text.includes('INSERT INTO payroll_audit_logs') && query.params?.includes('payroll_record_voided')))
})

test('blocks void attempts against locked payroll records and writes failure audit', async () => {
  const failureAuditQueries: Array<{ text: string; params?: unknown[] }> = []
  ;(pool as unknown as { query: QueryFn }).query = async (text: string, params?: unknown[]): Promise<QueryResult> => {
    failureAuditQueries.push({ text, params })
    if (text.includes('INSERT INTO audit_logs') || text.includes('INSERT INTO payroll_audit_logs')) return { rows: [], rowCount: 1 }
    throw new Error(`Unexpected pool query: ${text}`)
  }
  const { voidPayrollRecord } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')
  const state = installClientMock(async (text) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
    if (text.includes('FROM payroll_records pr') && text.includes('FOR UPDATE')) {
      return { rows: [{ id: recordId, employee_id: employeeId, payroll_period_id: periodId, status: 'locked', period_status: 'locked', is_locked: true, period_is_locked: true }] }
    }
    if (text.includes('INSERT INTO audit_logs') || text.includes('INSERT INTO payroll_audit_logs')) return { rows: [], rowCount: 1 }
    throw new Error(`Unexpected query: ${text}`)
  })

  const result = await invoke(voidPayrollRecord, req({ reason: 'Late correction' }, { id: recordId }))

  assert.equal(result.statusCode, 409)
  assert.match(String(result.body.message), /cannot be voided/i)
  assert.ok(state.queries.includes(state.queries.find((query) => query.text === 'ROLLBACK')!))
  assert.ok(failureAuditQueries.some((query) => query.text.includes('INSERT INTO payroll_audit_logs') && query.params?.includes('payroll_record_void_failed')))
})

test('rejects loans as an active payroll report type', async () => {
  const { getPayrollReport } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')

  const result = await invoke(getPayrollReport, req({}, { id: periodId, reportType: 'loans' }))

  assert.equal(result.statusCode, 400)
  assert.match(String(result.body.message), /report type must be one of/i)
  assert.doesNotMatch(String(result.body.message), /\bloans\b/i)
})

test('payroll computation treats loan deductions as zero', async () => {
  const { computePayroll } = require('../src/services/payrollService') as typeof import('../src/services/payrollService')
  const db = {
    query: async () => {
      throw new Error('Use statutory fallback rules')
    },
  }

  const withLoanInput = {
    employeeId,
    payrollPeriodId: periodId,
    basicSalary: 50000,
    payFrequency: 'semi-monthly' as const,
    periodEndDate: '2026-05-15',
    expectedWorkDays: 11,
    daysWorked: 11,
    absenceDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    lateMins: 0,
    overtimeHours: 0,
    holidayHours: 0,
    nightDiffHours: 0,
    excessMinutes: 0,
    offsetEarnedMinutes: 0,
    offsetUsedMinutes: 0,
    undertimeMinutes: 0,
    offsetBalanceMinutes: 0,
    allowances: 0,
    otherEarnings: 0,
    loanDeductions: 5000,
    loanDeductionItems: [{
      employeeId,
      loanId: '55555555-5555-4555-8555-555555555555',
      payrollPeriodId: periodId,
      scheduledAmount: 5000,
      deductedAmount: 5000,
      remainingBalanceBefore: 5000,
      remainingBalanceAfter: 0,
      deductionDate: '2026-05-18',
    }],
    otherDeductions: 250,
    workDaysPerMonth: 22,
    workHoursPerDay: 8,
    regularHolidayRate: 2,
    nightDifferentialEnabled: false,
  }

  const result = await computePayroll(withLoanInput, db as never)
  const withoutLoanResult = await computePayroll({ ...withLoanInput, loanDeductions: 0, loanDeductionItems: [] }, db as never)

  assert.equal(result.loanDeductions, 0)
  assert.deepEqual(result.loanDeductionItems, [])
  assert.equal(result.postTaxDeductions, withLoanInput.otherDeductions)
  assert.equal(result.totalDeductions, withoutLoanResult.totalDeductions)
  assert.equal(result.netPay, withoutLoanResult.netPay)
})
