import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import pool from '../src/utils/db'
import { errorHandler } from '../src/middleware/errorHandler'
import * as settingsService from '../src/services/settingsService'

type QueryResult = { rows: unknown[]; rowCount?: number }
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>

const userId = '44444444-4444-4444-8444-444444444444'

const originals = {
  poolQuery: pool.query.bind(pool),
  poolConnect: pool.connect.bind(pool),
  getPayrollSettings: settingsService.getPayrollSettings,
}

const semiMonthlySettings: settingsService.PayrollSettings = {
  payFrequency: 'semi-monthly',
  semiMonthlyCutoff1: 15,
  semiMonthlyCutoff2: 31,
  semiMonthlyPayDay1: 20,
  semiMonthlyPayDay2: 5,
  workingHoursPerDay: 8,
  workingDaysPerWeek: 5,
  workDaysPerMonth: 22,
  offsetCreditEnabled: true,
  offsetRequiresApproval: true,
  minimumOffsetCreditMinutes: 1,
  nightDifferentialEnabled: false,
  regularHolidayRate: 2,
  specialHolidayRate: 1.3,
  thirteenthMonthEnabled: true,
}

function restoreAll() {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  ;(pool as unknown as { connect: typeof originals.poolConnect }).connect = originals.poolConnect
  ;(settingsService as unknown as { getPayrollSettings: typeof originals.getPayrollSettings }).getPayrollSettings = originals.getPayrollSettings
}

afterEach(restoreAll)

function invoke(
  handler: (req: Request, res: Response, next: NextFunction) => void,
  body: Record<string, unknown>
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

    handler({
      body,
      ip: '127.0.0.1',
      get: () => 'node-test',
      user: { userId, role: 'payroll_preparer' },
    } as Partial<Request> as Request, res, next)
  })
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

test('generates first semi-monthly period dates from payroll settings', () => {
  const { buildGeneratedPayrollPeriodInput } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')

  const input = buildGeneratedPayrollPeriodInput(semiMonthlySettings, { month: '2026-05', period: 'first' })

  assert.deepEqual(input, {
    name: 'May 2026 - 1st Period',
    startDate: '2026-05-01',
    endDate: '2026-05-15',
    payDate: '2026-05-20',
    payFrequency: 'semi-monthly',
  })
})

test('generates second semi-monthly period dates from payroll settings', () => {
  const { buildGeneratedPayrollPeriodInput } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')

  const input = buildGeneratedPayrollPeriodInput(semiMonthlySettings, { month: '2026-05', period: 'second' })

  assert.deepEqual(input, {
    name: 'May 2026 - 2nd Period',
    startDate: '2026-05-16',
    endDate: '2026-05-31',
    payDate: '2026-06-05',
    payFrequency: 'semi-monthly',
  })
})

test('clamps February end-of-month cutoff to the actual last day', () => {
  const { buildGeneratedPayrollPeriodInput } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')

  const input = buildGeneratedPayrollPeriodInput(semiMonthlySettings, { month: '2026-02', period: 'second' })

  assert.equal(input.startDate, '2026-02-16')
  assert.equal(input.endDate, '2026-02-28')
  assert.equal(input.payDate, '2026-03-05')
})

test('uses next-month pay date for second period when configured pay day falls before the cutoff end', () => {
  const { buildGeneratedPayrollPeriodInput } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')

  const input = buildGeneratedPayrollPeriodInput({
    ...semiMonthlySettings,
    semiMonthlyPayDay2: 25,
  }, { month: '2026-05', period: 'second' })

  assert.equal(input.endDate, '2026-05-31')
  assert.equal(input.payDate, '2026-06-25')
})

test('generated period creation keeps duplicate name protection', async () => {
  ;(settingsService as unknown as { getPayrollSettings: () => Promise<settingsService.PayrollSettings> }).getPayrollSettings = async () => semiMonthlySettings
  const { generatePayrollPeriod } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')
  const state = installClientMock(async (text) => {
    if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [] }
    if (text.includes('LOWER(name) = LOWER($1)')) return { rows: [{ id: 'existing-period-id' }] }
    throw new Error(`Unexpected query: ${text}`)
  })

  const result = await invoke(generatePayrollPeriod, { month: '2026-05', period: 'first' })

  assert.equal(result.statusCode, 409)
  assert.match(String(result.body.message), /non-cancelled payroll period/i)
  assert.ok(state.queries.some((query) => query.text === 'ROLLBACK'))
  assert.equal(state.released(), true)
})

test('generated period creation keeps overlap protection for the generated date range', async () => {
  ;(settingsService as unknown as { getPayrollSettings: () => Promise<settingsService.PayrollSettings> }).getPayrollSettings = async () => semiMonthlySettings
  const { generatePayrollPeriod } = require('../src/controllers/payrollController') as typeof import('../src/controllers/payrollController')
  const state = installClientMock(async (text) => {
    if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [] }
    if (text.includes('LOWER(name) = LOWER($1)')) return { rows: [] }
    if (text.includes('daterange(start_date, end_date')) {
      return { rows: [{ id: 'existing-period-id', name: 'Existing May 2nd Period' }] }
    }
    throw new Error(`Unexpected query: ${text}`)
  })

  const result = await invoke(generatePayrollPeriod, { month: '2026-05', period: 'second' })

  assert.equal(result.statusCode, 409)
  assert.match(String(result.body.message), /overlaps with existing payroll period/i)
  const overlapQuery = state.queries.find((query) => query.text.includes('daterange(start_date, end_date'))
  assert.deepEqual(overlapQuery?.params, ['semi-monthly', '2026-05-16', '2026-05-31'])
})
