import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { getPayrollComputationWindow } from '../src/services/payrollEmployeeEligibility'
import { processBatchPayroll } from '../src/services/payrollService'
import { logger } from '../src/utils/logger'
import pool from '../src/utils/db'

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number }

const payrollPeriodId = '11111111-1111-4111-8111-111111111111'
const employeeId = '22222222-2222-4222-8222-222222222222'
const payrollRecordId = '33333333-3333-4333-8333-333333333333'
const snapshotId = '44444444-4444-4444-8444-444444444444'

const originals = {
  poolQuery: pool.query.bind(pool),
  warn: logger.warn,
}

afterEach(() => {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  logger.warn = originals.warn
})

function localDateOnly(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

const period = { start_date: '2026-05-01', end_date: '2026-05-15' }

test('active employee is included normally for the full covered payroll period', () => {
  const window = getPayrollComputationWindow({
    employment_status: 'active',
    is_deleted: false,
    hire_date: '2026-04-01',
  }, period)

  assert.ok(window)
  assert.equal(localDateOnly(window.startDate), '2026-05-01')
  assert.equal(localDateOnly(window.endDate), '2026-05-15')
})

test('resigned employee with last working day inside payroll period is included only through that date', () => {
  const window = getPayrollComputationWindow({
    employment_status: 'resigned',
    is_deleted: false,
    hire_date: '2026-04-01',
    last_working_day: '2026-05-10',
    separation_date: '2026-05-12',
  }, period)

  assert.ok(window)
  assert.equal(localDateOnly(window.startDate), '2026-05-01')
  assert.equal(localDateOnly(window.endDate), '2026-05-10')
})

test('resigned employee whose last working day is before payroll period is excluded', () => {
  const window = getPayrollComputationWindow({
    employment_status: 'resigned',
    is_deleted: false,
    hire_date: '2026-04-01',
    last_working_day: '2026-04-30',
  }, period)

  assert.equal(window, null)
})

test('archived employee is excluded even when their dates overlap the payroll period', () => {
  const window = getPayrollComputationWindow({
    employment_status: 'resigned',
    is_deleted: true,
    hire_date: '2026-04-01',
    last_working_day: '2026-05-10',
  }, period)

  assert.equal(window, null)
})

test('final payroll computation caps expected work days at last working day', async () => {
  logger.warn = () => undefined
  ;(pool as unknown as { query: () => Promise<QueryResult> }).query = async () => ({
    rows: [],
    rowCount: 0,
  })

  const inserts: Array<{ expectedWorkDays: number; regularPay: number }> = []
  const snapshots: Array<{ periodStart: string; periodEnd: string }> = []
  let employeeSelectionSql = ''

  const db = {
    query: async (text: string, params?: unknown[]): Promise<QueryResult> => {
      if (text.includes('SELECT start_date, end_date, pay_date, pay_frequency FROM payroll_periods')) {
        return {
          rows: [{
            start_date: '2026-05-01',
            end_date: '2026-05-15',
            pay_date: '2026-05-20',
            pay_frequency: 'semi-monthly',
          }],
        }
      }

      if (text.includes('FROM payroll_records pr') && text.includes('NOT (')) {
        return { rows: [] }
      }

      if (text.includes('FROM employees e') && text.includes('LEFT JOIN attendance a')) {
        employeeSelectionSql = text
        return {
          rows: [{
            id: employeeId,
            basic_salary: 22000,
            work_days_per_month: 22,
            work_hours_per_day: 8,
            hire_date: '2026-04-01',
            employment_status: 'resigned',
            is_deleted: false,
            last_working_day: '2026-05-10',
            separation_date: '2026-05-10',
            payroll_period_end: '2026-05-10',
            days_worked: 6,
            leave_attendance_days: 0,
            absence_days: 0,
            late_mins: 0,
            overtime_hours: 0,
            holiday_hours: 0,
            night_diff_hours: 0,
            excess_minutes: 0,
            offset_earned_minutes: 0,
            offset_used_minutes: 0,
            undertime_minutes: 0,
            offset_balance_minutes: 0,
          }],
        }
      }

      if (text.includes('FROM leave_requests lr')) return { rows: [{ unpaid_leave_days: 0 }] }
      if (text.includes('FROM payroll_leave_adjustments pla')) return { rows: [] }

      if (text.includes('INSERT INTO payroll_records')) {
        inserts.push({
          expectedWorkDays: Number(params?.[5]),
          regularPay: Number(params?.[10]),
        })
        return { rows: [{ id: payrollRecordId }], rowCount: 1 }
      }

      if (text.includes('COUNT(*)::int AS attendance_rows')) {
        return { rows: [{ attendance_rows: 0 }], rowCount: 1 }
      }

      if (text.includes('WITH next_version AS')) {
        snapshots.push({
          periodStart: String(params?.[4]).slice(0, 10),
          periodEnd: String(params?.[5]).slice(0, 10),
        })
        return { rows: [{ id: snapshotId }], rowCount: 1 }
      }

      return { rows: [] }
    },
  }

  const result = await processBatchPayroll(payrollPeriodId, db as never)

  assert.equal(result.processed, 1)
  assert.deepEqual(result.errors, [])
  assert.equal(inserts[0].expectedWorkDays, 6)
  assert.equal(inserts[0].regularPay, 6000)
  assert.deepEqual(snapshots[0], { periodStart: '2026-05-01', periodEnd: '2026-05-10' })
  assert.match(employeeSelectionSql, /e\.is_deleted = false/)
  assert.match(employeeSelectionSql, /e\.hire_date <= pp\.end_date/)
  assert.match(employeeSelectionSql, /COALESCE\(e\.last_working_day, e\.separation_date\) >= pp\.start_date/)
  assert.match(employeeSelectionSql, /a\.date <= LEAST/)
})
