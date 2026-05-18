import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import { computeEmployeeTax } from '../src/controllers/payrollController'
import { errorHandler } from '../src/middleware/errorHandler'
import {
  computeGovernmentDeductions,
  computeGovernmentDeductionsForPeriod,
  computeWithholdingTax,
  validateStatutoryRuleCoverage,
  type PayFrequency,
} from '../src/utils/statutoryDeductions'
import { computePayroll } from '../src/services/payrollService'
import { logger } from '../src/utils/logger'
import pool from '../src/utils/db'

type QueryResult = { rows: unknown[]; rowCount?: number }

const periodId = '11111111-1111-4111-8111-111111111111'
const employeeId = '22222222-2222-4222-8222-222222222222'

const originals = {
  warn: logger.warn,
  poolQuery: pool.query.bind(pool),
}

afterEach(() => {
  logger.warn = originals.warn
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
})

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

const taxCases: Record<PayFrequency, Array<[number, number]>> = {
  weekly: [
    [4808, 0],
    [4809, 0.15],
    [7691, 432.45],
    [7692, 432.60],
    [15384, 1971.00],
    [15385, 1971.20],
    [38461, 7740.20],
    [38462, 7740.45],
    [153845, 42355.35],
    [153846, 42355.65],
    [200000, 58509.55],
  ],
  'semi-monthly': [
    [10417, 0],
    [10418, 0.15],
    [16666, 937.35],
    [16667, 937.50],
    [33332, 4270.50],
    [33333, 4270.70],
    [83332, 16770.45],
    [83333, 16770.70],
    [333332, 91770.40],
    [333333, 91770.70],
    [500000, 150104.15],
  ],
  monthly: [
    [20833, 0],
    [20834, 0.15],
    [33332, 1874.85],
    [33333, 1875.00],
    [66666, 8541.60],
    [66667, 8541.80],
    [166666, 33541.55],
    [166667, 33541.80],
    [666666, 183541.50],
    [666667, 183541.80],
    [1000000, 300208.35],
  ],
}

for (const [payFrequency, cases] of Object.entries(taxCases) as Array<[PayFrequency, Array<[number, number]>]>) {
  test(`computes ${payFrequency} TRAIN withholding tax brackets effective 2023 onward`, () => {
    for (const [taxableIncome, expectedTax] of cases) {
      assert.equal(
        computeWithholdingTax(taxableIncome, payFrequency, '2026-05-15'),
        expectedTax,
        `${payFrequency} taxable income ${taxableIncome}`
      )
    }
  })
}

test('computes taxable income after mandatory employee contributions and pre-tax deductions', () => {
  const deductions = computeGovernmentDeductions({
    monthlyBasicSalary: 50000,
    taxableGrossForPeriod: 50000,
    payFrequency: 'monthly',
    periodEndDate: '2026-05-31',
    expectedWorkDays: 22,
    workDaysPerMonth: 22,
    preTaxDeductions: 1234.56,
  })

  assert.equal(deductions.sss.employee, 1750)
  assert.equal(deductions.philHealth.employee, 1250)
  assert.equal(deductions.pagIBIG.employee, 200)
  assert.equal(deductions.taxableIncome, 45565.44)
  assert.equal(deductions.withholdingTax, 4321.49)
})

test('payroll computation stores taxable income and withholding tax from the statutory utility path', async () => {
  const warnings: Array<{ message: string; meta?: Record<string, unknown> }> = []
  logger.warn = (message, meta) => warnings.push({ message, meta })
  const db = {
    query: async (): Promise<QueryResult> => {
      throw new Error('statutory tables unavailable')
    },
  }

  const result = await computePayroll({
    employeeId,
    payrollPeriodId: periodId,
    basicSalary: 50000,
    payFrequency: 'monthly',
    periodEndDate: '2026-05-31',
    expectedWorkDays: 22,
    daysWorked: 22,
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
    nonTaxableEarnings: 0,
    preTaxDeductions: 1234.56,
    otherEarnings: 0,
    loanDeductions: 0,
    otherDeductions: 0,
    workDaysPerMonth: 22,
    workHoursPerDay: 8,
    regularHolidayRate: 2,
    nightDifferentialEnabled: false,
  }, db as never)

  assert.equal(result.taxableIncome, 45565.50)
  assert.equal(result.withholdingTax, 4321.50)
  assert.equal(result.computationBreakdown.governmentDeductions.withholdingTax, 4321.50)
  assert.ok(String(result.statutoryRuleVersion).includes('BIR-RR-11-2018-2023-monthly'))
  assert.ok(warnings.some((warning) => warning.message.includes('using code fallback rules')))
})

test('compute-tax preview accepts pay frequency and period end date while defaulting to backend statutory rules', async () => {
  const warnings: Array<{ message: string; meta?: Record<string, unknown> }> = []
  logger.warn = (message, meta) => warnings.push({ message, meta })
  ;(pool as unknown as { query: () => Promise<QueryResult> }).query = async () => {
    throw new Error('statutory tables unavailable')
  }

  const result = await invoke(computeEmployeeTax, {
    query: {
      monthlyBasicSalary: '50000',
      payFrequency: 'semi-monthly',
      periodEndDate: '2026-05-15',
    },
  } as Partial<Request>)

  const data = result.body.data as Record<string, unknown>

  assert.equal(result.statusCode, 200)
  assert.equal(data.allocationFactor, 0.5)
  assert.equal(data.taxableIncome, 23400)
  assert.equal(data.withholdingTax, 2284.10)
  assert.ok(String(data.ruleVersion).includes('BIR-RR-11-2018-2023-semi-monthly'))
  assert.ok(warnings.some((warning) => warning.message.includes('using code fallback rules')))
})

test('statutory DB fallback preserves code rule metadata and emits a warning', async () => {
  const warnings: Array<{ message: string; meta?: Record<string, unknown> }> = []
  logger.warn = (message, meta) => warnings.push({ message, meta })
  const db = {
    query: async (): Promise<QueryResult> => ({ rows: [] }),
  }

  const result = await computeGovernmentDeductionsForPeriod({
    monthlyBasicSalary: 30000,
    taxableGrossForPeriod: 15000,
    payFrequency: 'semi-monthly',
    periodEndDate: '2026-05-15',
    expectedWorkDays: 11,
    workDaysPerMonth: 22,
  }, db as never)

  assert.equal(result.ruleVersions.bir.source, 'code')
  assert.equal(result.ruleVersions.bir.versionLabel, 'BIR-RR-11-2018-2023-semi-monthly')
  assert.ok(result.ruleVersion.includes('BIR-RR-11-2018-2023-semi-monthly'))
  assert.equal(warnings.length, 1)
  assert.deepEqual(warnings[0].meta?.missingRules, {
    sss: true,
    philHealth: true,
    pagIBIG: true,
    bir: true,
  })
})

test('statutory setup validation flags missing BIR table coverage for the payroll frequency', async () => {
  const db = {
    query: async (text: string, params?: unknown[]): Promise<QueryResult> => {
      if (text.includes('FROM statutory_rule_versions')) {
        return {
          rows: [{
            id: `${params?.[0]}-version`,
            agency: params?.[0],
            rule_name: params?.[1],
            effective_from: '2026-01-01',
            effective_to: null,
            version_label: `${params?.[0]}-test-version`,
          }],
        }
      }
      if (text.includes('FROM withholding_tax_brackets')) return { rows: [] }
      throw new Error(`Unexpected query: ${text}`)
    },
  }

  const coverage = await validateStatutoryRuleCoverage('2026-05-15', 'weekly', db as never)

  assert.equal(coverage.isComplete, false)
  assert.deepEqual(coverage.missing, [{
    agency: 'BIR',
    ruleName: 'withholding_tax_compensation:weekly',
  }])
})
