import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { Request, Response, NextFunction } from 'express'
import { createEmployee } from '../src/controllers/employeeController'
import { errorHandler } from '../src/middleware/errorHandler'
import { EmployeeModel, type EmployeeRow } from '../src/models/Employee'
import * as emailService from '../src/services/emailService'
import pool from '../src/utils/db'

const departmentId = '11111111-1111-4111-8111-111111111111'
const positionId = '22222222-2222-4222-8222-222222222222'
const shiftId = '33333333-3333-4333-8333-333333333333'
const employeeId = '44444444-4444-4444-8444-444444444444'
const userId = '55555555-5555-4555-8555-555555555555'

type QueryResult = { rows: unknown[]; rowCount?: number }
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>
type EmployeeCreateInput = Parameters<typeof EmployeeModel.create>[0]

interface MockState {
  activeDepartment: boolean
  activePosition: boolean
  activeShift: boolean
  duplicateEmail: boolean
  emailFails: boolean
  createdEmployee?: EmployeeCreateInput
  insertedUser: boolean
  markedEmailFailed: boolean
}

const originals = {
  poolQuery: pool.query.bind(pool),
  poolConnect: pool.connect.bind(pool),
  generateEmployeeNumber: EmployeeModel.generateEmployeeNumber,
  createEmployee: EmployeeModel.create,
  sendActivationEmail: emailService.sendActivationEmail,
}

let state: MockState

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    firstName: 'Ada',
    middleName: '',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '',
    birthDate: '',
    gender: 'other',
    civilStatus: 'single',
    address: '',
    city: '',
    province: '',
    zipCode: '',
    departmentId,
    positionId,
    shiftId,
    employmentType: 'regular',
    hireDate: '2026-05-18',
    basicSalary: 110000,
    workDaysPerMonth: 22,
    workHoursPerDay: 8,
    sssNumber: '',
    philhealthNumber: '',
    pagibigNumber: '',
    tinNumber: '',
    bankName: '',
    bankAccountNumber: '',
    ...overrides,
  }
}

function employeeRow(input: EmployeeCreateInput): EmployeeRow {
  return {
    id: employeeId,
    employee_number: String(input.employee_number),
    first_name: String(input.first_name),
    middle_name: input.middle_name ?? null,
    last_name: String(input.last_name),
    email: String(input.email),
    phone: input.phone ?? null,
    birth_date: input.birth_date ?? null,
    gender: input.gender ?? null,
    civil_status: input.civil_status ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    province: input.province ?? null,
    zip_code: input.zip_code ?? null,
    department_id: input.department_id ?? null,
    position_id: input.position_id ?? null,
    shift_id: input.shift_id ?? null,
    employment_type: String(input.employment_type),
    employment_status: String(input.employment_status),
    hire_date: String(input.hire_date),
    basic_salary: Number(input.basic_salary),
    daily_rate: Number(input.daily_rate),
    hourly_rate: Number(input.hourly_rate),
    work_days_per_month: Number(input.work_days_per_month),
    work_hours_per_day: Number(input.work_hours_per_day),
    sss_number: input.sss_number ?? null,
    philhealth_number: input.philhealth_number ?? null,
    pagibig_number: input.pagibig_number ?? null,
    tin_number: input.tin_number ?? null,
    bank_name: input.bank_name ?? null,
    bank_account_number: input.bank_account_number ?? null,
    created_at: new Date('2026-05-18T00:00:00.000Z'),
    updated_at: new Date('2026-05-18T00:00:00.000Z'),
  }
}

function mockPoolQuery(): QueryFn {
  return async (text: string): Promise<QueryResult> => {
    if (text.includes('FROM system_settings')) return { rows: [] }
    if (text.includes('FROM departments')) return { rows: state.activeDepartment ? [{ id: departmentId }] : [] }
    if (text.includes('FROM positions')) {
      return {
        rows: state.activePosition ? [{ id: positionId, department_id: departmentId }] : [],
      }
    }
    if (text.includes('FROM work_shifts')) {
      return { rows: state.activeShift ? [{ id: shiftId, work_hours: 8 }] : [] }
    }
    if (text.includes('EXISTS (SELECT 1 FROM employees')) {
      return {
        rows: [{
          employee_exists: state.duplicateEmail,
          user_exists: false,
        }],
      }
    }
    if (text.includes('activation_email_status = \'failed\'')) {
      state.markedEmailFailed = true
      return { rows: [], rowCount: 1 }
    }
    if (text.includes('UPDATE users')) return { rows: [], rowCount: 1 }

    throw new Error(`Unexpected pool query: ${text}`)
  }
}

function mockClientQuery(): QueryFn {
  return async (text: string): Promise<QueryResult> => {
    if (
      text === 'BEGIN' ||
      text === 'COMMIT' ||
      text === 'ROLLBACK' ||
      text === 'SAVEPOINT employee_number_attempt' ||
      text === 'RELEASE SAVEPOINT employee_number_attempt' ||
      text === 'ROLLBACK TO SAVEPOINT employee_number_attempt'
    ) {
      return { rows: [] }
    }

    if (text.includes('INSERT INTO users')) {
      state.insertedUser = true
      return { rows: [{ id: userId }] }
    }

    throw new Error(`Unexpected client query: ${text}`)
  }
}

function installMocks() {
  state = {
    activeDepartment: true,
    activePosition: true,
    activeShift: true,
    duplicateEmail: false,
    emailFails: false,
    insertedUser: false,
    markedEmailFailed: false,
  }

  ;(pool as unknown as { query: QueryFn }).query = mockPoolQuery()
  ;(pool as unknown as { connect: () => Promise<unknown> }).connect = async () => ({
    query: mockClientQuery(),
    release: () => undefined,
  })

  EmployeeModel.generateEmployeeNumber = async () => 'EMP-001'
  EmployeeModel.create = async (input: EmployeeCreateInput) => {
    state.createdEmployee = input
    return employeeRow(input)
  }

  ;(emailService as unknown as {
    sendActivationEmail: typeof emailService.sendActivationEmail
  }).sendActivationEmail = async () => {
    if (state.emailFails) throw new Error('Email provider unavailable')
    return {
      provider: 'resend',
      messageId: 'message-1',
      sentAt: new Date('2026-05-18T00:00:00.000Z'),
    }
  }
}

function restoreMocks() {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  ;(pool as unknown as { connect: typeof originals.poolConnect }).connect = originals.poolConnect
  EmployeeModel.generateEmployeeNumber = originals.generateEmployeeNumber
  EmployeeModel.create = originals.createEmployee
  ;(emailService as unknown as {
    sendActivationEmail: typeof emailService.sendActivationEmail
  }).sendActivationEmail = originals.sendActivationEmail
}

function invokeCreate(body: Record<string, unknown>): Promise<{ statusCode: number; body: Record<string, unknown> }> {
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

    createEmployee({ body } as Request, res, next)
  })
}

beforeEach(installMocks)
afterEach(restoreMocks)

test('creates an employee and sends activation email', async () => {
  const result = await invokeCreate(basePayload())

  assert.equal(result.statusCode, 201)
  assert.equal(result.body.success, true)
  assert.equal(result.body.activationEmailSent, true)
  assert.match(String(result.body.message), /Activation email sent to ada@example\.com/)
  assert.equal(state.insertedUser, true)
  assert.equal(state.createdEmployee?.employment_type, 'regular')
  assert.equal(state.createdEmployee?.daily_rate, 5000)
  assert.equal(state.createdEmployee?.hourly_rate, 625)
})

test('rejects duplicate employee email', async () => {
  state.duplicateEmail = true

  const result = await invokeCreate(basePayload())

  assert.equal(result.statusCode, 409)
  assert.equal(result.body.success, false)
  assert.match(String(result.body.message), /email already exists/i)
  assert.equal(state.createdEmployee, undefined)
})

test('rejects inactive department', async () => {
  state.activeDepartment = false

  const result = await invokeCreate(basePayload())

  assert.equal(result.statusCode, 400)
  assert.match(String(result.body.message), /active department/i)
  assert.deepEqual((result.body.details as Record<string, string[]>).departmentId, [
    'Department must reference an active department',
  ])
})

test('rejects inactive position', async () => {
  state.activePosition = false

  const result = await invokeCreate(basePayload())

  assert.equal(result.statusCode, 400)
  assert.match(String(result.body.message), /active position/i)
  assert.deepEqual((result.body.details as Record<string, string[]>).positionId, [
    'Position must reference an active position',
  ])
})

test('rejects inactive shift', async () => {
  state.activeShift = false

  const result = await invokeCreate(basePayload())

  assert.equal(result.statusCode, 400)
  assert.match(String(result.body.message), /active shift/i)
  assert.deepEqual((result.body.details as Record<string, string[]>).shiftId, [
    'Shift must reference an active shift',
  ])
})

test('rejects invalid work schedule and salary values', async () => {
  const result = await invokeCreate(basePayload({
    basicSalary: 10000001,
    workDaysPerMonth: 32,
    workHoursPerDay: 25,
  }))

  assert.equal(result.statusCode, 400)
  assert.match(String(result.body.message), /highlighted employee fields/i)
  const details = result.body.details as Record<string, string[]>
  assert.deepEqual(details.basicSalary, ['Monthly salary must not exceed 10,000,000'])
  assert.deepEqual(details.workDaysPerMonth, ['Work days per month must not exceed 31'])
  assert.deepEqual(details.workHoursPerDay, ['Work hours per day must not exceed 24'])
})

test('rejects unsupported intern employment type', async () => {
  const result = await invokeCreate(basePayload({ employmentType: 'intern' }))

  assert.equal(result.statusCode, 400)
  assert.match(String(result.body.message), /employment type/i)
  assert.deepEqual((result.body.details as Record<string, string[]>).employmentType, [
    'Employment type must be one of: regular, probationary, contractual, part_time',
  ])
})

test('returns created employee when activation email delivery fails', async () => {
  state.emailFails = true

  const result = await invokeCreate(basePayload())

  assert.equal(result.statusCode, 201)
  assert.equal(result.body.success, true)
  assert.equal(result.body.activationEmailSent, false)
  assert.match(String(result.body.message), /created, but activation email could not be sent/i)
  assert.equal((result.body.data as EmployeeRow).id, employeeId)
  assert.equal(state.insertedUser, true)
  assert.ok(state.createdEmployee)
  assert.equal(state.markedEmailFailed, true)
})
