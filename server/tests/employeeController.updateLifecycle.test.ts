import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import {
  activateEmployee,
  deactivateEmployee,
  separateEmployee,
  updateEmployee,
} from '../src/controllers/employeeController'
import { errorHandler } from '../src/middleware/errorHandler'
import { EmployeeModel, type EmployeeRow } from '../src/models/Employee'
import pool from '../src/utils/db'

const employeeId = '44444444-4444-4444-8444-444444444444'
const adminUserId = '55555555-5555-4555-8555-555555555555'
const departmentId = '11111111-1111-4111-8111-111111111111'
const positionId = '22222222-2222-4222-8222-222222222222'
const shiftId = '33333333-3333-4333-8333-333333333333'

type QueryResult = { rows: unknown[]; rowCount?: number }
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>

interface MockState {
  employee: EmployeeRow
  updatedData?: Partial<EmployeeRow>
  userDisabled: boolean
  userReactivated: boolean
  userHasPassword: boolean
  userIsActive: boolean
  auditActions: string[]
}

const originals = {
  poolQuery: pool.query.bind(pool),
  poolConnect: pool.connect.bind(pool),
  findById: EmployeeModel.findById,
  update: EmployeeModel.update,
}

let state: MockState

function baseEmployee(overrides: Partial<EmployeeRow> = {}): EmployeeRow {
  return {
    id: employeeId,
    employee_number: 'EMP-001',
    first_name: 'Ada',
    middle_name: null,
    last_name: 'Lovelace',
    email: 'ada@example.com',
    phone: null,
    birth_date: null,
    gender: 'other',
    civil_status: 'single',
    address: null,
    city: null,
    province: null,
    zip_code: null,
    department_id: departmentId,
    position_id: positionId,
    shift_id: shiftId,
    employment_type: 'regular',
    employment_status: 'active',
    hire_date: '2026-05-18',
    basic_salary: 110000,
    daily_rate: 5000,
    hourly_rate: 625,
    work_days_per_month: 22,
    work_hours_per_day: 8,
    sss_number: null,
    philhealth_number: null,
    pagibig_number: null,
    tin_number: null,
    bank_name: null,
    bank_account_number: null,
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
    last_working_day: null,
    separation_date: null,
    separation_reason: null,
    separation_remarks: null,
    separation_processed_by: null,
    separation_processed_at: null,
    created_at: new Date('2026-05-18T00:00:00.000Z'),
    updated_at: new Date('2026-05-18T00:00:00.000Z'),
    ...overrides,
  }
}

function mockPoolQuery(): QueryFn {
  return async (text: string): Promise<QueryResult> => {
    if (text.includes('FROM system_settings')) return { rows: [] }
    if (text.includes('FROM departments')) return { rows: [{ id: departmentId }] }
    if (text.includes('FROM positions')) return { rows: [{ id: positionId, department_id: departmentId }] }
    if (text.includes('FROM work_shifts')) return { rows: [{ id: shiftId, work_hours: 8 }] }
    throw new Error(`Unexpected pool query: ${text}`)
  }
}

function mockClientQuery(): QueryFn {
  return async (text: string, params?: unknown[]): Promise<QueryResult> => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }

    if (text.includes('SELECT *') && text.includes('FROM employees')) {
      return { rows: [state.employee] }
    }

    if (text.includes('UPDATE employees') && text.includes("employment_status = 'active'")) {
      state.employee = {
        ...state.employee,
        employment_status: 'active',
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        last_working_day: null,
        separation_date: null,
        separation_reason: null,
        separation_remarks: null,
        separation_processed_by: params?.[1] as string,
      }
      return { rows: [state.employee], rowCount: 1 }
    }

    if (text.includes('UPDATE employees') && text.includes('employment_status')) {
      const status = String(params?.[1] ?? state.employee.employment_status)
      state.employee = {
        ...state.employee,
        employment_status: status,
        last_working_day: params?.[2] as string | null,
        separation_date: params?.[3] as string | null,
        separation_reason: params?.[4] as string | null,
        separation_remarks: params?.[5] as string | null,
        separation_processed_by: params?.[6] as string | null,
        is_deleted: text.includes('is_deleted = true') ? true : state.employee.is_deleted,
      }
      return { rows: [state.employee], rowCount: 1 }
    }

    if (text.includes('WITH existing_users') && text.includes('UPDATE users')) {
      const wasActive = state.userIsActive
      const hasPassword = state.userHasPassword
      state.userIsActive = hasPassword
      state.userReactivated = hasPassword && !wasActive && state.userIsActive
      return {
        rows: [{
          has_password: hasPassword,
          is_active: state.userIsActive,
          was_active: wasActive,
        }],
        rowCount: 1,
      }
    }

    if (text.includes('UPDATE users')) {
      if (text.includes('is_active = false')) state.userDisabled = true
      if (text.includes('is_active = false')) state.userIsActive = false
      return { rows: [], rowCount: 1 }
    }

    if (text.includes('INSERT INTO audit_logs')) {
      state.auditActions.push(String(params?.[1] ?? ''))
      return { rows: [], rowCount: 1 }
    }

    throw new Error(`Unexpected client query: ${text}`)
  }
}

function installMocks() {
  state = {
    employee: baseEmployee(),
    userDisabled: false,
    userReactivated: false,
    userHasPassword: true,
    userIsActive: true,
    auditActions: [],
  }

  ;(pool as unknown as { query: QueryFn }).query = mockPoolQuery()
  ;(pool as unknown as { connect: () => Promise<unknown> }).connect = async () => ({
    query: mockClientQuery(),
    release: () => undefined,
  })

  EmployeeModel.findById = async () => state.employee
  EmployeeModel.update = async (_id: string, data: Partial<EmployeeRow>) => {
    state.updatedData = data
    state.employee = { ...state.employee, ...data }
    return state.employee
  }
}

function restoreMocks() {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  ;(pool as unknown as { connect: typeof originals.poolConnect }).connect = originals.poolConnect
  EmployeeModel.findById = originals.findById
  EmployeeModel.update = originals.update
}

function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => void,
  body: Record<string, unknown> = {}
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

    const req = {
      params: { id: employeeId },
      body,
      user: { userId: adminUserId },
      ip: '127.0.0.1',
      get: () => 'node-test',
    } as unknown as Request

    const next: NextFunction = (error?: unknown) => {
      if (error) errorHandler(error as never, req, res, (() => undefined) as NextFunction)
    }

    handler(req, res, next)
  })
}

beforeEach(installMocks)
afterEach(restoreMocks)

test('updates salary and work schedule with recalculated rates', async () => {
  const result = await invoke(updateEmployee, {
    basicSalary: 96000,
    workDaysPerMonth: 24,
    workHoursPerDay: 6,
  })

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.success, true)
  assert.equal(state.updatedData?.basic_salary, 96000)
  assert.equal(state.updatedData?.work_days_per_month, 24)
  assert.equal(state.updatedData?.work_hours_per_day, 6)
  assert.equal(state.updatedData?.daily_rate, 4000)
  assert.equal(state.updatedData?.hourly_rate, 666.6667)
})

test('rejects invalid update salary and schedule values', async () => {
  const result = await invoke(updateEmployee, {
    basicSalary: 10000001,
    workDaysPerMonth: 32,
    workHoursPerDay: 25,
  })

  assert.equal(result.statusCode, 400)
  assert.equal(result.body.success, false)
  const details = result.body.details as Record<string, string[]>
  assert.deepEqual(details.basicSalary, ['Monthly salary must not exceed 10,000,000'])
  assert.deepEqual(details.workDaysPerMonth, ['Work days per month must not exceed 31'])
  assert.deepEqual(details.workHoursPerDay, ['Work hours per day must not exceed 24'])
  assert.equal(state.updatedData, undefined)
})

test('records employee separation and disables login access', async () => {
  const result = await invoke(separateEmployee, {
    status: 'resigned',
    lastWorkingDay: '2026-05-20',
    separationDate: '2026-05-21',
    reasonForLeaving: 'Voluntary resignation',
    remarks: 'Cleared',
  })

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.success, true)
  assert.equal(state.employee.employment_status, 'resigned')
  assert.equal(state.employee.separation_reason, 'Voluntary resignation')
  assert.equal(state.userDisabled, true)
  assert.deepEqual(state.auditActions, ['employee_separated'])
})

test('reactivates an inactive employee account and restores login when a password exists', async () => {
  state.employee = baseEmployee({
    employment_status: 'inactive',
    last_working_day: '2026-05-20',
    separation_date: '2026-05-21',
    separation_reason: 'Inactive account',
    separation_remarks: 'Paused',
  })
  state.userIsActive = false

  const result = await invoke(activateEmployee)

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.success, true)
  assert.equal(state.employee.employment_status, 'active')
  assert.equal(state.employee.is_deleted, false)
  assert.equal(state.employee.last_working_day, null)
  assert.equal(state.employee.separation_date, null)
  assert.equal(state.employee.separation_reason, null)
  assert.equal(state.userIsActive, true)
  assert.equal(result.body.loginAccessRestored, true)
  assert.equal(result.body.activationRequired, false)
  assert.deepEqual(state.auditActions, ['employee_reactivated'])
})

test('reactivates a separated employee account and clears separation fields', async () => {
  state.employee = baseEmployee({
    employment_status: 'resigned',
    last_working_day: '2026-05-20',
    separation_date: '2026-05-21',
    separation_reason: 'Voluntary resignation',
    separation_remarks: 'Cleared',
  })
  state.userIsActive = false

  const result = await invoke(activateEmployee)

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.success, true)
  assert.equal(state.employee.employment_status, 'active')
  assert.equal(state.employee.last_working_day, null)
  assert.equal(state.employee.separation_date, null)
  assert.equal(state.employee.separation_reason, null)
  assert.equal(state.employee.separation_remarks, null)
  assert.equal(result.body.loginAccessRestored, true)
  assert.equal(result.body.activationRequired, false)
})

test('archives and restores an employee account', async () => {
  const archiveResult = await invoke(deactivateEmployee)

  assert.equal(archiveResult.statusCode, 200)
  assert.equal(archiveResult.body.success, true)
  assert.equal(state.employee.is_deleted, true)
  assert.equal(state.userDisabled, true)
  assert.deepEqual(state.auditActions, ['employee_archived'])

  const restoreResult = await invoke(activateEmployee)

  assert.equal(restoreResult.statusCode, 200)
  assert.equal(restoreResult.body.success, true)
  assert.equal(state.employee.employment_status, 'active')
  assert.equal(state.employee.is_deleted, false)
  assert.equal(state.userReactivated, true)
  assert.equal(restoreResult.body.loginAccessRestored, true)
  assert.equal(restoreResult.body.activationRequired, false)
  assert.deepEqual(state.auditActions, ['employee_archived', 'employee_reactivated'])
})

test('does not restore user login access when activation setup is still required', async () => {
  state.employee = baseEmployee({
    employment_status: 'terminated',
    last_working_day: '2026-05-20',
    separation_date: '2026-05-21',
    separation_reason: 'Terminated',
  })
  state.userHasPassword = false
  state.userIsActive = false

  const result = await invoke(activateEmployee)

  assert.equal(result.statusCode, 200)
  assert.equal(result.body.success, true)
  assert.equal(state.employee.employment_status, 'active')
  assert.equal(state.userIsActive, false)
  assert.equal(state.userReactivated, false)
  assert.equal(result.body.loginAccessRestored, false)
  assert.equal(result.body.activationRequired, true)
})
