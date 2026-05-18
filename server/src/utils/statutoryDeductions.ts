import type { Pool, PoolClient } from 'pg'
import pool from './db'
import { logger } from './logger'

export type PayFrequency = 'weekly' | 'semi-monthly' | 'monthly'

type Queryable = Pool | PoolClient

type ContributionShare = {
  employee: number
  employer: number
  total: number
}

type RuleVersionRef = {
  id?: string
  agency: string
  ruleName: string
  versionLabel: string
  effectiveFrom: string
  effectiveTo?: string | null
  source: 'database' | 'code'
}

export interface GovernmentDeductionInput {
  monthlyBasicSalary: number
  taxableGrossForPeriod: number
  payFrequency: PayFrequency
  periodEndDate: Date | string
  expectedWorkDays: number
  workDaysPerMonth: number
  preTaxDeductions?: number
}

export interface GovernmentDeductionResult {
  sss: ContributionShare & {
    monthlySalaryCredit: number
    employeeCompensationEmployer: number
  }
  philHealth: ContributionShare & {
    monthlyPremium: number
  }
  pagIBIG: ContributionShare & {
    monthlyFundSalary: number
  }
  taxableIncome: number
  withholdingTax: number
  totalEmployeeDeductions: number
  totalEmployerContributions: number
  allocationFactor: number
  ruleVersion: string
  ruleVersions: {
    sss: RuleVersionRef
    philHealth: RuleVersionRef
    pagIBIG: RuleVersionRef
    bir: RuleVersionRef
  }
}

type EffectiveRule<T> = T & {
  effectiveFrom: string
  version: string
}

type TaxBracket = {
  min: number
  max: number
  baseTax: number
  rate: number
  excessOver: number
}

type DbRuleVersion = {
  id: string
  agency: string
  rule_name: string
  effective_from: Date | string
  effective_to: Date | string | null
  version_label: string
}

type DbBracket = {
  min_compensation: number | string | null
  max_compensation: number | string | null
  employee_share: number | string | null
  employer_share: number | string | null
  total_contribution: number | string | null
  fixed_amount: number | string | null
  percentage_rate: number | string | null
  formula_type: string
  metadata_json: Record<string, unknown> | null
}

type LoadedContributionRule = {
  version: DbRuleVersion
  bracket: DbBracket
}

type LoadedBirRule = {
  version: DbRuleVersion
  brackets: TaxBracket[]
}

const SSS_RULES: Array<EffectiveRule<{
  minMonthlySalaryCredit: number
  maxMonthlySalaryCredit: number
  salaryCreditStep: number
  employeeRate: number
  employerRate: number
  ecLow: number
  ecHigh: number
  ecHighThreshold: number
}>> = [
  {
    effectiveFrom: '2025-01-01',
    version: 'SSS-2025-01',
    minMonthlySalaryCredit: 5_000,
    maxMonthlySalaryCredit: 35_000,
    salaryCreditStep: 500,
    employeeRate: 0.05,
    employerRate: 0.10,
    ecLow: 10,
    ecHigh: 30,
    ecHighThreshold: 15_000,
  },
]

const PHILHEALTH_RULES: Array<EffectiveRule<{
  floor: number
  ceiling: number
  rate: number
}>> = [
  {
    effectiveFrom: '2025-01-01',
    version: 'PHIC-PA-2025-0002',
    floor: 10_000,
    ceiling: 100_000,
    rate: 0.05,
  },
]

const PAGIBIG_RULES: Array<EffectiveRule<{
  maxFundSalary: number
  lowSalaryThreshold: number
  lowEmployeeRate: number
  highEmployeeRate: number
  employerRate: number
}>> = [
  {
    effectiveFrom: '2024-02-01',
    version: 'HDMF-Circular-460',
    maxFundSalary: 10_000,
    lowSalaryThreshold: 1_500,
    lowEmployeeRate: 0.01,
    highEmployeeRate: 0.02,
    employerRate: 0.02,
  },
]

const BIR_WITHHOLDING_TABLES: Record<PayFrequency, Array<EffectiveRule<{
  brackets: TaxBracket[]
}>>> = {
  weekly: [
    {
      effectiveFrom: '2023-01-01',
      version: 'BIR-RR-11-2018-2023-weekly',
      brackets: [
        { min: 0, max: 4_808, baseTax: 0, rate: 0, excessOver: 0 },
        { min: 4_808.01, max: 7_691, baseTax: 0, rate: 0.15, excessOver: 4_808 },
        { min: 7_692, max: 15_384, baseTax: 432.60, rate: 0.20, excessOver: 7_692 },
        { min: 15_385, max: 38_461, baseTax: 1_971.20, rate: 0.25, excessOver: 15_385 },
        { min: 38_462, max: 153_845, baseTax: 7_740.45, rate: 0.30, excessOver: 38_462 },
        { min: 153_846, max: Infinity, baseTax: 42_355.65, rate: 0.35, excessOver: 153_846 },
      ],
    },
  ],
  'semi-monthly': [
    {
      effectiveFrom: '2023-01-01',
      version: 'BIR-RR-11-2018-2023-semi-monthly',
      brackets: [
        { min: 0, max: 10_417, baseTax: 0, rate: 0, excessOver: 0 },
        { min: 10_417.01, max: 16_666, baseTax: 0, rate: 0.15, excessOver: 10_417 },
        { min: 16_667, max: 33_332, baseTax: 937.50, rate: 0.20, excessOver: 16_667 },
        { min: 33_333, max: 83_332, baseTax: 4_270.70, rate: 0.25, excessOver: 33_333 },
        { min: 83_333, max: 333_332, baseTax: 16_770.70, rate: 0.30, excessOver: 83_333 },
        { min: 333_333, max: Infinity, baseTax: 91_770.70, rate: 0.35, excessOver: 333_333 },
      ],
    },
  ],
  monthly: [
    {
      effectiveFrom: '2023-01-01',
      version: 'BIR-RR-11-2018-2023-monthly',
      brackets: [
        { min: 0, max: 20_833, baseTax: 0, rate: 0, excessOver: 0 },
        { min: 20_833.01, max: 33_332, baseTax: 0, rate: 0.15, excessOver: 20_833 },
        { min: 33_333, max: 66_666, baseTax: 1_875, rate: 0.20, excessOver: 33_333 },
        { min: 66_667, max: 166_666, baseTax: 8_541.80, rate: 0.25, excessOver: 66_667 },
        { min: 166_667, max: 666_666, baseTax: 33_541.80, rate: 0.30, excessOver: 166_667 },
        { min: 666_667, max: Infinity, baseTax: 183_541.80, rate: 0.35, excessOver: 666_667 },
      ],
    },
  ],
}

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

function toNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value ?? fallback)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function asDateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function activeRule<T extends { effectiveFrom: string }>(rules: T[], periodEndDate: Date | string): T {
  const date = asDateOnly(periodEndDate)
  return [...rules]
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    .find((rule) => rule.effectiveFrom <= date) ?? rules[0]
}

function frequencyAllocationFactor(
  payFrequency: PayFrequency,
  expectedWorkDays: number,
  workDaysPerMonth: number
): number {
  if (payFrequency === 'monthly') return 1
  if (payFrequency === 'semi-monthly') return 0.5

  return Math.min(1, Math.max(0, expectedWorkDays / Math.max(1, workDaysPerMonth)))
}

function allocateMonthly(value: number, factor: number): number {
  return round2(value * factor)
}

function ruleRef(
  agency: string,
  ruleName: string,
  versionLabel: string,
  effectiveFrom: string,
  source: 'database' | 'code',
  id?: string,
  effectiveTo?: string | null
): RuleVersionRef {
  return { id, agency, ruleName, versionLabel, effectiveFrom, effectiveTo, source }
}

function dbRuleRef(version: DbRuleVersion): RuleVersionRef {
  return ruleRef(
    version.agency,
    version.rule_name,
    version.version_label,
    asDateOnly(version.effective_from),
    'database',
    version.id,
    version.effective_to == null ? null : asDateOnly(version.effective_to)
  )
}

async function loadRuleVersion(
  db: Queryable,
  agency: string,
  ruleName: string,
  periodEndDate: Date | string
): Promise<DbRuleVersion | null> {
  const result = await db.query(
    `SELECT id, agency, rule_name, effective_from, effective_to, version_label
     FROM statutory_rule_versions
     WHERE agency = $1
       AND rule_name = $2
       AND is_active = true
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR effective_to >= $3::date)
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [agency, ruleName, asDateOnly(periodEndDate)]
  )
  return result.rows[0] ?? null
}

async function loadContributionRule(
  db: Queryable,
  agency: string,
  ruleName: string,
  periodEndDate: Date | string
): Promise<LoadedContributionRule | null> {
  const version = await loadRuleVersion(db, agency, ruleName, periodEndDate)
  if (!version) return null

  const bracketResult = await db.query(
    `SELECT min_compensation, max_compensation, employee_share, employer_share,
            total_contribution, fixed_amount, percentage_rate, formula_type, metadata_json
     FROM statutory_brackets
     WHERE rule_version_id = $1
     ORDER BY min_compensation NULLS FIRST
     LIMIT 1`,
    [version.id]
  )
  const bracket = bracketResult.rows[0]
  return bracket ? { version, bracket } : null
}

async function loadBirRule(
  db: Queryable,
  payFrequency: PayFrequency,
  periodEndDate: Date | string
): Promise<LoadedBirRule | null> {
  const version = await loadRuleVersion(db, 'BIR', 'withholding_tax_compensation', periodEndDate)
  if (!version) return null

  const result = await db.query(
    `SELECT min_taxable_income, max_taxable_income, base_tax, excess_over, tax_rate
     FROM withholding_tax_brackets
     WHERE rule_version_id = $1
       AND payroll_frequency = $2
     ORDER BY min_taxable_income`,
    [version.id, payFrequency]
  )
  if (!result.rows.length) return null

  return {
    version,
    brackets: result.rows.map((row) => ({
      min: toNumber(row.min_taxable_income),
      max: row.max_taxable_income == null ? Infinity : toNumber(row.max_taxable_income),
      baseTax: toNumber(row.base_tax),
      excessOver: toNumber(row.excess_over),
      rate: toNumber(row.tax_rate),
    })),
  }
}

function computeMonthlySSSFromConfig(
  monthlyBasicSalary: number,
  config: Record<string, unknown>,
  version: string
) {
  const minMonthlySalaryCredit = toNumber(config.minMonthlySalaryCredit, 5_000)
  const maxMonthlySalaryCredit = toNumber(config.maxMonthlySalaryCredit, 35_000)
  const salaryCreditStep = toNumber(config.salaryCreditStep, 500)
  const employeeRate = toNumber(config.employeeRate, 0.05)
  const employerRate = toNumber(config.employerRate, 0.10)
  const ecLow = toNumber(config.ecLow, 10)
  const ecHigh = toNumber(config.ecHigh, 30)
  const ecHighThreshold = toNumber(config.ecHighThreshold, 15_000)
  const clampedSalary = Math.min(
    maxMonthlySalaryCredit,
    Math.max(minMonthlySalaryCredit, monthlyBasicSalary)
  )
  const msc = Math.min(
    maxMonthlySalaryCredit,
    Math.max(
      minMonthlySalaryCredit,
      Math.round(clampedSalary / salaryCreditStep) * salaryCreditStep
    )
  )
  const employee = round2(msc * employeeRate)
  const employer = round2(msc * employerRate)
  const ec = msc >= ecHighThreshold ? ecHigh : ecLow
  return { employee, employer, total: round2(employee + employer), monthlySalaryCredit: msc, ec, version }
}

function computeMonthlyPhilHealthFromConfig(
  monthlyBasicSalary: number,
  config: Record<string, unknown>,
  version: string
) {
  const floor = toNumber(config.floor, 10_000)
  const ceiling = toNumber(config.ceiling, 100_000)
  const rate = toNumber(config.rate, 0.05)
  const salary = Math.min(ceiling, Math.max(floor, monthlyBasicSalary))
  const monthlyPremium = round2(salary * rate)
  const employee = round2(monthlyPremium / 2)
  const employer = round2(monthlyPremium - employee)
  return { employee, employer, total: monthlyPremium, monthlyPremium, version }
}

function computeMonthlyPagIBIGFromConfig(
  monthlyBasicSalary: number,
  config: Record<string, unknown>,
  version: string
) {
  const maxFundSalary = toNumber(config.maxFundSalary, 10_000)
  const lowSalaryThreshold = toNumber(config.lowSalaryThreshold, 1_500)
  const lowEmployeeRate = toNumber(config.lowEmployeeRate, 0.01)
  const highEmployeeRate = toNumber(config.highEmployeeRate, 0.02)
  const employerRate = toNumber(config.employerRate, 0.02)
  const monthlyFundSalary = Math.min(maxFundSalary, Math.max(0, monthlyBasicSalary))
  const employeeRate = monthlyBasicSalary <= lowSalaryThreshold ? lowEmployeeRate : highEmployeeRate
  const employee = round2(monthlyFundSalary * employeeRate)
  const employer = round2(monthlyFundSalary * employerRate)
  return { employee, employer, total: round2(employee + employer), monthlyFundSalary, version }
}

function computeMonthlySSS(monthlyBasicSalary: number, periodEndDate: Date | string) {
  const rule = activeRule(SSS_RULES, periodEndDate)
  return computeMonthlySSSFromConfig(monthlyBasicSalary, rule, rule.version)
}

function computeMonthlyPhilHealth(monthlyBasicSalary: number, periodEndDate: Date | string) {
  const rule = activeRule(PHILHEALTH_RULES, periodEndDate)
  return computeMonthlyPhilHealthFromConfig(monthlyBasicSalary, rule, rule.version)
}

function computeMonthlyPagIBIG(monthlyBasicSalary: number, periodEndDate: Date | string) {
  const rule = activeRule(PAGIBIG_RULES, periodEndDate)
  return computeMonthlyPagIBIGFromConfig(monthlyBasicSalary, rule, rule.version)
}

function computeTaxFromBrackets(taxableIncome: number, brackets: TaxBracket[]): number {
  if (taxableIncome <= 0) return 0
  const bracket = brackets.find((item) => taxableIncome >= item.min && taxableIncome <= item.max)
    ?? brackets[brackets.length - 1]

  return round2(Math.max(0, bracket.baseTax + (taxableIncome - bracket.excessOver) * bracket.rate))
}

export function computeWithholdingTax(
  taxableIncome: number,
  payFrequency: PayFrequency,
  periodEndDate: Date | string = new Date()
): number {
  if (taxableIncome <= 0) return 0
  const rule = activeRule(BIR_WITHHOLDING_TABLES[payFrequency], periodEndDate)
  return computeTaxFromBrackets(taxableIncome, rule.brackets)
}

function composeResult(
  input: GovernmentDeductionInput,
  monthlySSS: ReturnType<typeof computeMonthlySSS>,
  monthlyPhilHealth: ReturnType<typeof computeMonthlyPhilHealth>,
  monthlyPagIBIG: ReturnType<typeof computeMonthlyPagIBIG>,
  birBrackets: TaxBracket[],
  ruleVersions: GovernmentDeductionResult['ruleVersions']
): GovernmentDeductionResult {
  const allocationFactor = frequencyAllocationFactor(
    input.payFrequency,
    input.expectedWorkDays,
    input.workDaysPerMonth
  )

  const sssEmployee = allocateMonthly(monthlySSS.employee, allocationFactor)
  const sssEmployer = allocateMonthly(monthlySSS.employer + monthlySSS.ec, allocationFactor)
  const philHealthEmployee = allocateMonthly(monthlyPhilHealth.employee, allocationFactor)
  const philHealthEmployer = allocateMonthly(monthlyPhilHealth.employer, allocationFactor)
  const pagIBIGEmployee = allocateMonthly(monthlyPagIBIG.employee, allocationFactor)
  const pagIBIGEmployer = allocateMonthly(monthlyPagIBIG.employer, allocationFactor)
  const preTaxDeductions = round2(input.preTaxDeductions ?? 0)

  const taxableIncome = round2(Math.max(
    0,
    input.taxableGrossForPeriod - preTaxDeductions - sssEmployee - philHealthEmployee - pagIBIGEmployee
  ))
  const withholdingTax = computeTaxFromBrackets(taxableIncome, birBrackets)

  return {
    sss: {
      employee: sssEmployee,
      employer: sssEmployer,
      total: round2(sssEmployee + sssEmployer),
      monthlySalaryCredit: monthlySSS.monthlySalaryCredit,
      employeeCompensationEmployer: allocateMonthly(monthlySSS.ec, allocationFactor),
    },
    philHealth: {
      employee: philHealthEmployee,
      employer: philHealthEmployer,
      total: round2(philHealthEmployee + philHealthEmployer),
      monthlyPremium: allocateMonthly(monthlyPhilHealth.monthlyPremium, allocationFactor),
    },
    pagIBIG: {
      employee: pagIBIGEmployee,
      employer: pagIBIGEmployer,
      total: round2(pagIBIGEmployee + pagIBIGEmployer),
      monthlyFundSalary: monthlyPagIBIG.monthlyFundSalary,
    },
    taxableIncome,
    withholdingTax,
    totalEmployeeDeductions: round2(sssEmployee + philHealthEmployee + pagIBIGEmployee + withholdingTax),
    totalEmployerContributions: round2(sssEmployer + philHealthEmployer + pagIBIGEmployer),
    allocationFactor: round2(allocationFactor),
    ruleVersion: [
      ruleVersions.sss.versionLabel,
      ruleVersions.philHealth.versionLabel,
      ruleVersions.pagIBIG.versionLabel,
      `${ruleVersions.bir.versionLabel}-${input.payFrequency}`,
    ].join('|'),
    ruleVersions,
  }
}

export function computeGovernmentDeductions(input: GovernmentDeductionInput): GovernmentDeductionResult {
  const sssRule = activeRule(SSS_RULES, input.periodEndDate)
  const philHealthRule = activeRule(PHILHEALTH_RULES, input.periodEndDate)
  const pagIBIGRule = activeRule(PAGIBIG_RULES, input.periodEndDate)
  const birRule = activeRule(BIR_WITHHOLDING_TABLES[input.payFrequency], input.periodEndDate)

  return composeResult(
    input,
    computeMonthlySSS(input.monthlyBasicSalary, input.periodEndDate),
    computeMonthlyPhilHealth(input.monthlyBasicSalary, input.periodEndDate),
    computeMonthlyPagIBIG(input.monthlyBasicSalary, input.periodEndDate),
    birRule.brackets,
    {
      sss: ruleRef('SSS', 'employee_employer_contribution', sssRule.version, sssRule.effectiveFrom, 'code'),
      philHealth: ruleRef('PHILHEALTH', 'direct_contributor_premium', philHealthRule.version, philHealthRule.effectiveFrom, 'code'),
      pagIBIG: ruleRef('PAGIBIG', 'monthly_membership_savings', pagIBIGRule.version, pagIBIGRule.effectiveFrom, 'code'),
      bir: ruleRef('BIR', 'withholding_tax_compensation', birRule.version, birRule.effectiveFrom, 'code'),
    }
  )
}

export async function computeGovernmentDeductionsForPeriod(
  input: GovernmentDeductionInput,
  db: Queryable = pool
): Promise<GovernmentDeductionResult> {
  try {
    const [sssRule, philHealthRule, pagIBIGRule, birRule] = await Promise.all([
      loadContributionRule(db, 'SSS', 'employee_employer_contribution', input.periodEndDate),
      loadContributionRule(db, 'PHILHEALTH', 'direct_contributor_premium', input.periodEndDate),
      loadContributionRule(db, 'PAGIBIG', 'monthly_membership_savings', input.periodEndDate),
      loadBirRule(db, input.payFrequency, input.periodEndDate),
    ])

    if (!sssRule || !philHealthRule || !pagIBIGRule || !birRule) {
      logger.warn('Statutory rule database lookup incomplete; using code fallback rules.', {
        periodEndDate: asDateOnly(input.periodEndDate),
        payFrequency: input.payFrequency,
        missingRules: {
          sss: !sssRule,
          philHealth: !philHealthRule,
          pagIBIG: !pagIBIGRule,
          bir: !birRule,
        },
      })
      return computeGovernmentDeductions(input)
    }

    return composeResult(
      input,
      computeMonthlySSSFromConfig(input.monthlyBasicSalary, sssRule.bracket.metadata_json ?? {}, sssRule.version.version_label),
      computeMonthlyPhilHealthFromConfig(input.monthlyBasicSalary, philHealthRule.bracket.metadata_json ?? {}, philHealthRule.version.version_label),
      computeMonthlyPagIBIGFromConfig(input.monthlyBasicSalary, pagIBIGRule.bracket.metadata_json ?? {}, pagIBIGRule.version.version_label),
      birRule.brackets,
      {
        sss: dbRuleRef(sssRule.version),
        philHealth: dbRuleRef(philHealthRule.version),
        pagIBIG: dbRuleRef(pagIBIGRule.version),
        bir: dbRuleRef(birRule.version),
      }
    )
  } catch (err) {
    logger.warn('Statutory rule database lookup failed; using code fallback rules.', {
      periodEndDate: asDateOnly(input.periodEndDate),
      payFrequency: input.payFrequency,
      error: err,
    })
    return computeGovernmentDeductions(input)
  }
}

export async function listStatutoryRuleVersions(db: Queryable = pool) {
  const result = await db.query(
    `SELECT srv.*,
            COALESCE((
              SELECT COUNT(*)::int FROM statutory_brackets sb WHERE sb.rule_version_id = srv.id
            ), 0) AS contribution_bracket_count,
            COALESCE((
              SELECT COUNT(*)::int FROM withholding_tax_brackets wtb WHERE wtb.rule_version_id = srv.id
            ), 0) AS withholding_bracket_count
     FROM statutory_rule_versions srv
     ORDER BY srv.agency, srv.effective_from DESC, srv.version_label`
  )
  return result.rows
}

export async function validateStatutoryRuleCoverage(
  periodEndDate: Date | string,
  payFrequency: PayFrequency,
  db: Queryable = pool
): Promise<{
  isComplete: boolean
  missing: Array<{ agency: string; ruleName: string }>
  versions: Record<string, RuleVersionRef>
}> {
  const lookups = [
    ['SSS', 'employee_employer_contribution'],
    ['PHILHEALTH', 'direct_contributor_premium'],
    ['PAGIBIG', 'monthly_membership_savings'],
    ['BIR', 'withholding_tax_compensation'],
  ] as const
  const missing: Array<{ agency: string; ruleName: string }> = []
  const versions: Record<string, RuleVersionRef> = {}

  try {
    for (const [agency, ruleName] of lookups) {
      const version = await loadRuleVersion(db, agency, ruleName, periodEndDate)
      if (!version) {
        missing.push({ agency, ruleName })
      } else {
        versions[agency.toLowerCase()] = dbRuleRef(version)
      }
    }

    if (versions.bir) {
      const bir = await loadBirRule(db, payFrequency, periodEndDate)
      if (!bir) missing.push({ agency: 'BIR', ruleName: `withholding_tax_compensation:${payFrequency}` })
    }
  } catch (err) {
    return {
      isComplete: false,
      missing: lookups.map(([agency, ruleName]) => ({ agency, ruleName })),
      versions,
    }
  }

  return { isComplete: missing.length === 0, missing, versions }
}
