import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import { clockIn } from '../src/controllers/attendanceController'
import {
  calculateMonthToDateExpectedHours,
  getEmployeeDashboard,
  mapLeaveBalancesToDashboardItems,
} from '../src/controllers/employeeDashboardController'
import { errorHandler } from '../src/middleware/errorHandler'
import { LeaveBalanceService, type LeaveBalanceSummary } from '../src/services/leaveBalanceService'
import pool from '../src/utils/db'

type QueryResult = { rows: unknown[]; rowCount?: number }
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>

const employeeId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const currentYear = new Date().getFullYear()

const originals = {
  poolQuery: pool.query.bind(pool),
  getBalances: LeaveBalanceService.getBalances,
}

interface DashboardState {
  todayRows: unknown[]
  announcementRows: unknown[]
  leaveBalances: LeaveBalanceSummary[]
  serviceCall?: { employeeId: string; year: number }
}

let dashboardState: DashboardState

function leaveBalance(overrides: Partial<LeaveBalanceSummary>): LeaveBalanceSummary {
  return {
    id: String(overrides.leave_type_id ?? overrides.id ?? 'leave-type'),
    employee_id: employeeId,
    leave_type_id: String(overrides.leave_type_id ?? overrides.id ?? 'leave-type'),
    code: 'VACATION',
    name: 'Vacation Leave',
    is_paid: true,
    year: currentYear,
    opening_balance: 0,
    earned_credits: 0,
    used_credits: 0,
    pending_credits: 0,
    carried_over_credits: 0,
    forfeited_credits: 0,
    converted_to_cash_credits: 0,
    available_balance: 0,
    entitlement_stage: 'test',
    ...overrides,
  } as LeaveBalanceSummary
}

function defaultLeaveBalances(): LeaveBalanceSummary[] {
  return [
    leaveBalance({
      id: 'vacation',
      leave_type_id: 'vacation',
      code: 'VACATION',
      name: 'Vacation Leave',
      opening_balance: 10,
      earned_credits: 2,
      carried_over_credits: 1,
      used_credits: 3,
      pending_credits: 1,
      available_balance: 9,
    }),
    leaveBalance({
      id: 'sick',
      leave_type_id: 'sick',
      code: 'SICK',
      name: 'Sick Leave',
      opening_balance: 5,
      used_credits: 1,
      available_balance: 4,
    }),
    leaveBalance({
      id: 'emergency',
      leave_type_id: 'emergency',
      code: 'EMERGENCY',
      name: 'Emergency Leave',
      used_credits: 1,
      pending_credits: 2,
      available_balance: 2,
    }),
    leaveBalance({
      id: 'maternity',
      leave_type_id: 'maternity',
      code: 'MATERNITY',
      name: 'Maternity Leave',
      used_credits: 10,
      pending_credits: 5,
      available_balance: 105,
    }),
    leaveBalance({
      id: 'paternity',
      leave_type_id: 'paternity',
      code: 'PATERNITY',
      name: 'Paternity Leave',
      used_credits: 1,
      pending_credits: 1,
      available_balance: 6,
    }),
  ]
}

function installDashboardMocks(overrides: Partial<DashboardState> = {}) {
  dashboardState = {
    todayRows: [{
      id: 'attendance-today',
      time_in: '2026-05-18T00:00:00.000Z',
      time_out: null,
      status: 'present',
      late_minutes: 0,
      offset_earned_minutes: 0,
      offset_used_minutes: 0,
      excess_minutes: 0,
      overtime_hours: 0,
      total_worked_minutes: 0,
    }],
    announcementRows: [{
      id: 'announcement-1',
      title: 'Payroll cutoff',
      message: 'Submit corrections by Friday.',
      start_date: null,
      end_date: null,
      is_pinned: true,
      created_at: '2026-05-18T00:00:00.000Z',
    }],
    leaveBalances: defaultLeaveBalances(),
    ...overrides,
  }

  ;(pool as unknown as { query: QueryFn }).query = async (text: string): Promise<QueryResult> => {
    if (text.includes('FROM employees e') && text.includes('WHERE e.id = $1')) {
      return {
        rows: [{
          id: employeeId,
          employee_number: 'EMP-001',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email: 'ada@example.com',
          department_name: 'Engineering',
          position_title: 'Developer',
          work_days_per_month: 22,
          shift_start: '08:00:00',
          shift_end: '17:00:00',
          scheduled_hours: 8,
        }],
      }
    }

    if (text.includes('COUNT(*) FILTER') && text.includes('FROM attendance')) {
      return {
        rows: [{
          present_days: 1,
          absent_days: 0,
          late_days: 0,
          half_days: 0,
          leave_days: 0,
          late_minutes: 0,
          offset_earned_minutes: 0,
          offset_used_minutes: 0,
          undertime_minutes: 0,
          overtime_hours: 0,
          worked_minutes: 480,
        }],
      }
    }

    if (text.includes('FROM attendance') && text.includes('date = $2')) {
      return { rows: dashboardState.todayRows }
    }

    if (text.includes('FROM announcements')) {
      return { rows: dashboardState.announcementRows }
    }

    throw new Error(`Unexpected dashboard query: ${text}`)
  }

  LeaveBalanceService.getBalances = async (calledEmployeeId: string, year: number) => {
    dashboardState.serviceCall = { employeeId: calledEmployeeId, year }
    return dashboardState.leaveBalances
  }
}

function restoreMocks() {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  LeaveBalanceService.getBalances = originals.getBalances
}

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

function invokeDashboard() {
  return invoke(getEmployeeDashboard, {
    user: { employeeId, userId, role: 'employee' },
  } as Partial<Request>)
}

beforeEach(() => installDashboardMocks())
afterEach(restoreMocks)

test('dashboard leave summary only sums vacation and sick balances', async () => {
  const result = await invokeDashboard()
  const data = result.body.data as Record<string, unknown>
  const leave = data.leaveBalance as Record<string, unknown>

  assert.equal(result.statusCode, 200)
  assert.deepEqual(dashboardState.serviceCall, { employeeId, year: currentYear })
  assert.equal(leave.totalAllowance, 18)
  assert.equal(leave.totalTaken, 4)
  assert.equal(leave.totalAvailable, 13)
  assert.equal(leave.pendingRequests, 1)
})

test('dashboard leave items still include non-summary leave types', async () => {
  const result = await invokeDashboard()
  const data = result.body.data as Record<string, unknown>
  const leave = data.leaveBalance as Record<string, unknown>
  const items = leave.items as Array<Record<string, unknown>>

  assert.ok(items.some((item) => item.code === 'EMERGENCY'))
  assert.ok(items.some((item) => item.code === 'MATERNITY'))
  assert.ok(items.some((item) => item.code === 'PATERNITY'))
})

test('probationary zero paid credits are not inflated by special leave balances', async () => {
  installDashboardMocks({
    leaveBalances: [
      leaveBalance({
        id: 'vacation',
        leave_type_id: 'vacation',
        code: 'VACATION',
        name: 'Vacation Leave',
        entitlement_stage: 'probationary',
      }),
      leaveBalance({
        id: 'sick',
        leave_type_id: 'sick',
        code: 'SICK',
        name: 'Sick Leave',
        entitlement_stage: 'probationary',
      }),
      leaveBalance({
        id: 'emergency',
        leave_type_id: 'emergency',
        code: 'EMERGENCY',
        name: 'Emergency Leave',
        used_credits: 2,
        pending_credits: 1,
        available_balance: 3,
      }),
      leaveBalance({
        id: 'maternity',
        leave_type_id: 'maternity',
        code: 'MATERNITY',
        name: 'Maternity Leave',
        available_balance: 105,
      }),
    ],
  })

  const result = await invokeDashboard()
  const data = result.body.data as Record<string, unknown>
  const leave = data.leaveBalance as Record<string, unknown>

  assert.equal(result.statusCode, 200)
  assert.equal(leave.totalAllowance, 0)
  assert.equal(leave.totalTaken, 0)
  assert.equal(leave.totalAvailable, 0)
  assert.equal(leave.pendingRequests, 0)
})

test('VACATION, SICK, and EMERGENCY normalized codes map correctly', async () => {
  const items = mapLeaveBalancesToDashboardItems(defaultLeaveBalances())
  const result = await invokeDashboard()
  const data = result.body.data as Record<string, unknown>
  const leave = data.leaveBalance as Record<string, unknown>

  assert.equal(items.find((item) => item.code === 'VACATION')?.balance, 9)
  assert.equal(items.find((item) => item.code === 'VACATION')?.remaining, 9)
  assert.equal(items.find((item) => item.code === 'VACATION')?.pendingCredits, 1)
  assert.equal(items.find((item) => item.code === 'VACATION')?.used, 3)
  assert.equal(items.find((item) => item.code === 'VACATION')?.openingBalance, 10)
  assert.equal(items.find((item) => item.code === 'VACATION')?.earnedCredits, 2)
  assert.equal(items.find((item) => item.code === 'VACATION')?.carriedOverCredits, 1)
  assert.equal(items.find((item) => item.code === 'SICK')?.balance, 4)
  assert.equal(items.find((item) => item.code === 'EMERGENCY')?.balance, 2)
  assert.equal(leave.vacationLeave, 9)
  assert.equal(leave.sickLeave, 4)
  assert.equal(leave.emergencyLeave, 2)
})

test('month-to-date expected hours does not use the full month early in the month', () => {
  const expected = calculateMonthToDateExpectedHours(new Date('2026-05-05T08:00:00+08:00'), 8, 22)

  assert.ok(expected > 0)
  assert.ok(expected < 176)
  assert.equal(Math.round(expected * 100) / 100, 28.39)
})

test('clock-in is blocked for protected attendance statuses', async () => {
  for (const status of ['on_leave', 'holiday', 'rest_day', 'absent']) {
    ;(pool as unknown as { query: QueryFn }).query = async (text: string): Promise<QueryResult> => {
      if (text.includes('FROM attendance') && text.includes('date = $2')) {
        return { rows: [{ id: 'attendance-today', time_in: null, status }] }
      }
      throw new Error(`Unexpected clock-in query: ${text}`)
    }

    const result = await invoke(clockIn, {
      user: { employeeId, userId, role: 'employee' },
    } as Partial<Request>)

    assert.equal(result.statusCode, 400)
    assert.match(String(result.body.message), new RegExp(`already marked as ${status.replace('_', ' ')}`, 'i'))
  }
})

test('dashboard loads when the employee has no attendance record today', async () => {
  installDashboardMocks({ todayRows: [] })

  const result = await invokeDashboard()
  const data = result.body.data as Record<string, unknown>
  const attendanceToday = data.attendanceToday as Record<string, unknown>

  assert.equal(result.statusCode, 200)
  assert.equal(attendanceToday.id, null)
  assert.equal(attendanceToday.status, 'Not Timed In')
})

test('dashboard loads when there are no active announcements', async () => {
  installDashboardMocks({ announcementRows: [] })

  const result = await invokeDashboard()
  const data = result.body.data as Record<string, unknown>

  assert.equal(result.statusCode, 200)
  assert.deepEqual(data.announcements, [])
})
