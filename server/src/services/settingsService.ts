import pool from '../utils/db'
import { LeaveAuditService } from './leaveAuditService'
import { LeavePolicyService } from './leavePolicyService'

export interface GeneralSettings {
  companyName: string
  address: string
  city: string
  province: string
  zipCode: string
  phone: string
  email: string
  tin: string
  sssEmployerNumber: string
  philhealthEmployerNumber: string
  pagibigEmployerNumber: string
}

export type GeneralSettingsInput = GeneralSettings

export type PayFrequency = 'weekly' | 'semi-monthly' | 'monthly'

export interface PayrollSettings {
  payFrequency: PayFrequency
  semiMonthlyCutoff1: number
  semiMonthlyCutoff2: number
  semiMonthlyPayDay1: number
  semiMonthlyPayDay2: number
  workingHoursPerDay: number
  workingDaysPerWeek: number
  workDaysPerMonth: number
  offsetCreditEnabled: boolean
  offsetRequiresApproval: boolean
  minimumOffsetCreditMinutes: number
  nightDifferentialEnabled: boolean
  regularHolidayRate: number
  specialHolidayRate: number
  thirteenthMonthEnabled: boolean
}

export type PayrollSettingsInput = PayrollSettings

export type LeaveDayCountType = 'working_days' | 'calendar_days'

export interface LeaveTypeSettings {
  id: string
  code: string
  name: string
  description: string | null
  daysPerYear: number
  isPaid: boolean
  isAccrualBased: boolean
  requiresBalance: boolean
  appliesToProbationary: boolean
  appliesToRegular: boolean
  maxDaysPerRequest: number | null
  filingDeadlineDays: number | null
  filingDeadlineType: string | null
  requiresDocument: boolean
  documentRule: string | null
  isCashConvertible: boolean
  isCarryOverAllowed: boolean
  isStatutory: boolean
  dayCountType: LeaveDayCountType
  policyNotes: string | null
  isActive: boolean
  isProtected: boolean
}

export interface LeavePolicySettings {
  id: string
  leaveTypeId: string
  leaveTypeCode: string
  leaveTypeName: string
  effectiveDate: string
  employmentStatus: string
  entitlementDays: number
  monthlyCredit: number
  carryOverLimit: number | null
  cashConversionLimit: number | null
  forfeitureRule: string | null
  notes: string | null
  isProtected: boolean
}

export interface LeaveSettings {
  leaveTypes: LeaveTypeSettings[]
  policies: LeavePolicySettings[]
  globalSettings: Record<string, never>
  clarificationItems: string[]
}

export interface LeaveSettingsInput {
  leaveTypes: LeaveTypeSettings[]
  policies: LeavePolicySettings[]
}

export type LeaveSettingsValidationErrors = Record<string, string[]>

export class LeaveSettingsValidationError extends Error {
  errors: LeaveSettingsValidationErrors

  constructor(errors: LeaveSettingsValidationErrors) {
    super('Leave settings contain invalid values.')
    this.errors = errors
  }
}

export interface PayrollPolicySettings {
  offsetCreditEnabled: boolean
  offsetRequiresApproval: boolean
  minimumOffsetCreditMinutes: number
  nightDifferentialEnabled: boolean
  regularHolidayRate: number
  specialHolidayRate: number
}

interface SettingDefinition {
  field: keyof GeneralSettings
  key: string
  description: string
  defaultValue: string
}

interface PayrollSettingDefinition {
  field: keyof PayrollSettings
  key: string
  description: string
  defaultValue: PayrollSettings[keyof PayrollSettings]
}

interface SystemSettingRow {
  key: string
  value: unknown
}

interface LeaveTypeSettingsRow {
  id: string
  code: string
  name: string
  description: string | null
  days_per_year: string | number | null
  is_paid: boolean | null
  is_accrual_based: boolean | null
  requires_balance: boolean | null
  applies_to_probationary: boolean | null
  applies_to_regular: boolean | null
  max_days_per_request: string | number | null
  filing_deadline_days: number | null
  filing_deadline_type: string | null
  requires_document: boolean | null
  document_rule: string | null
  is_cash_convertible: boolean | null
  is_carry_over_allowed: boolean | null
  is_statutory: boolean | null
  day_count_type: LeaveDayCountType | null
  policy_notes: string | null
  is_active: boolean | null
}

interface LeavePolicySettingsRow {
  id: string
  leave_type_id: string
  leave_type_code: string
  leave_type_name: string
  effective_date: string | Date
  employment_status: string
  entitlement_days: string | number | null
  monthly_credit: string | number | null
  carry_over_limit: string | number | null
  cash_conversion_limit: string | number | null
  forfeiture_rule: string | null
  notes: string | null
}

export const GENERAL_SETTING_DEFINITIONS: SettingDefinition[] = [
  { field: 'companyName', key: 'company_name', description: 'Company name', defaultValue: 'iBayad Corporation' },
  { field: 'address', key: 'company_address', description: 'Company street address', defaultValue: '123 Business Park, Ortigas Center' },
  { field: 'city', key: 'company_city', description: 'Company city', defaultValue: 'Pasig' },
  { field: 'province', key: 'company_province', description: 'Company province or region', defaultValue: 'Metro Manila' },
  { field: 'zipCode', key: 'company_zip_code', description: 'Company ZIP code', defaultValue: '1605' },
  { field: 'phone', key: 'company_phone', description: 'Company phone number', defaultValue: '+63 2 8888 0000' },
  { field: 'email', key: 'company_email', description: 'Company HR or payroll email address', defaultValue: 'hr@ibayad.com' },
  { field: 'tin', key: 'company_tin', description: 'Company BIR TIN', defaultValue: '123-456-789-000' },
  { field: 'sssEmployerNumber', key: 'sss_employer_number', description: 'SSS employer number', defaultValue: '03-1234567-8' },
  { field: 'philhealthEmployerNumber', key: 'philhealth_employer_number', description: 'PhilHealth employer number', defaultValue: '12-000000001-2' },
  { field: 'pagibigEmployerNumber', key: 'pagibig_employer_number', description: 'Pag-IBIG employer ID', defaultValue: 'IBAY-0001' },
]

const definitionsByKey = new Map(GENERAL_SETTING_DEFINITIONS.map((definition) => [definition.key, definition]))

const LEGACY_HOLIDAY_RATE_KEY = 'holiday_rate'
const PROTECTED_LEAVE_CODES = new Set(['MATERNITY', 'PATERNITY'])

export const PAYROLL_SETTING_DEFINITIONS: PayrollSettingDefinition[] = [
  { field: 'payFrequency', key: 'pay_frequency', description: 'Default pay frequency', defaultValue: 'semi-monthly' },
  { field: 'semiMonthlyCutoff1', key: 'semi_monthly_cutoff_1', description: 'First semi-monthly cutoff day', defaultValue: 15 },
  { field: 'semiMonthlyCutoff2', key: 'semi_monthly_cutoff_2', description: 'Second semi-monthly cutoff day', defaultValue: 31 },
  { field: 'semiMonthlyPayDay1', key: 'semi_monthly_pay_day_1', description: 'First semi-monthly pay day', defaultValue: 20 },
  { field: 'semiMonthlyPayDay2', key: 'semi_monthly_pay_day_2', description: 'Second semi-monthly pay day', defaultValue: 5 },
  { field: 'workingHoursPerDay', key: 'work_hours_per_day', description: 'Standard working hours per day', defaultValue: 8 },
  { field: 'workingDaysPerWeek', key: 'work_days_per_week', description: 'Standard working days per week', defaultValue: 5 },
  { field: 'workDaysPerMonth', key: 'work_days_per_month', description: 'Standard working days per month', defaultValue: 22 },
  { field: 'offsetCreditEnabled', key: 'offset_credit_enabled', description: 'Convert excess attendance minutes into offset credits', defaultValue: true },
  { field: 'offsetRequiresApproval', key: 'offset_requires_approval', description: 'Offset credits and usage require admin approval', defaultValue: true },
  { field: 'minimumOffsetCreditMinutes', key: 'minimum_offset_credit_minutes', description: 'Minimum excess minutes to create offset credit', defaultValue: 1 },
  { field: 'nightDifferentialEnabled', key: 'night_differential_enabled', description: 'Enable night differential pay from recorded night differential hours', defaultValue: false },
  { field: 'regularHolidayRate', key: 'regular_holiday_rate', description: 'Regular holiday rate multiplier', defaultValue: 2.0 },
  { field: 'specialHolidayRate', key: 'special_holiday_rate', description: 'Special holiday rate multiplier', defaultValue: 1.3 },
  { field: 'thirteenthMonthEnabled', key: 'thirteenth_month_enabled', description: 'Enable 13th month pay policy toggle', defaultValue: true },
]

const payrollDefinitionsByKey = new Map(PAYROLL_SETTING_DEFINITIONS.map((definition) => [definition.key, definition]))

function settingValueToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function settingValueToNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value ?? fallback)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function settingValueToBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  if (typeof value === 'number') return value !== 0
  return fallback
}

function dbNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value ?? fallback)
  return Number.isFinite(numberValue) ? numberValue : fallback
}

function dbNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function dbBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  if (typeof value === 'number') return value !== 0
  return fallback
}

function toDateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return value.slice(0, 10)
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '_')
}

function isProtectedLeaveCode(code: string): boolean {
  return PROTECTED_LEAVE_CODES.has(normalizeCode(code))
}

function leaveTypeRowToSettings(row: LeaveTypeSettingsRow): LeaveTypeSettings {
  const code = normalizeCode(row.code)

  return {
    id: row.id,
    code,
    name: row.name,
    description: row.description,
    daysPerYear: dbNumber(row.days_per_year),
    isPaid: dbBoolean(row.is_paid, true),
    isAccrualBased: dbBoolean(row.is_accrual_based),
    requiresBalance: dbBoolean(row.requires_balance),
    appliesToProbationary: dbBoolean(row.applies_to_probationary),
    appliesToRegular: dbBoolean(row.applies_to_regular, true),
    maxDaysPerRequest: dbNullableNumber(row.max_days_per_request),
    filingDeadlineDays: row.filing_deadline_days,
    filingDeadlineType: row.filing_deadline_type,
    requiresDocument: dbBoolean(row.requires_document),
    documentRule: row.document_rule,
    isCashConvertible: dbBoolean(row.is_cash_convertible),
    isCarryOverAllowed: dbBoolean(row.is_carry_over_allowed),
    isStatutory: dbBoolean(row.is_statutory),
    dayCountType: row.day_count_type ?? 'working_days',
    policyNotes: row.policy_notes,
    isActive: dbBoolean(row.is_active, true),
    isProtected: isProtectedLeaveCode(code) || dbBoolean(row.is_statutory),
  }
}

function leavePolicyRowToSettings(row: LeavePolicySettingsRow): LeavePolicySettings {
  const code = normalizeCode(row.leave_type_code)

  return {
    id: row.id,
    leaveTypeId: row.leave_type_id,
    leaveTypeCode: code,
    leaveTypeName: row.leave_type_name,
    effectiveDate: toDateOnly(row.effective_date),
    employmentStatus: row.employment_status,
    entitlementDays: dbNumber(row.entitlement_days),
    monthlyCredit: dbNumber(row.monthly_credit),
    carryOverLimit: dbNullableNumber(row.carry_over_limit),
    cashConversionLimit: dbNullableNumber(row.cash_conversion_limit),
    forfeitureRule: row.forfeiture_rule,
    notes: row.notes,
    isProtected: isProtectedLeaveCode(code),
  }
}

function emptyGeneralSettings(): GeneralSettings {
  return GENERAL_SETTING_DEFINITIONS.reduce((settings, definition) => ({
    ...settings,
    [definition.field]: definition.defaultValue,
  }), {} as GeneralSettings)
}

function emptyPayrollSettings(): PayrollSettings {
  return PAYROLL_SETTING_DEFINITIONS.reduce((settings, definition) => ({
    ...settings,
    [definition.field]: definition.defaultValue,
  }), {} as PayrollSettings)
}

export async function seedMissingGeneralSettings(): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, description)
     SELECT key, value::jsonb, description
     FROM UNNEST($1::text[], $2::text[], $3::text[]) AS defaults(key, value, description)
     ON CONFLICT (key) DO UPDATE
       SET description = EXCLUDED.description
       WHERE system_settings.description IS DISTINCT FROM EXCLUDED.description`,
    [
      GENERAL_SETTING_DEFINITIONS.map((definition) => definition.key),
      GENERAL_SETTING_DEFINITIONS.map((definition) => JSON.stringify(definition.defaultValue)),
      GENERAL_SETTING_DEFINITIONS.map((definition) => definition.description),
    ]
  )
}

export async function seedMissingPayrollSettings(): Promise<void> {
  const existingHolidayRate = await pool.query<SystemSettingRow>(
    `SELECT value FROM system_settings WHERE key = $1`,
    [LEGACY_HOLIDAY_RATE_KEY]
  )
  const legacyHolidayRate = settingValueToNumber(existingHolidayRate.rows[0]?.value, 2.0)

  const keys = PAYROLL_SETTING_DEFINITIONS.map((definition) => definition.key)
  const values = PAYROLL_SETTING_DEFINITIONS.map((definition) => (
    definition.field === 'regularHolidayRate' ? JSON.stringify(legacyHolidayRate) : JSON.stringify(definition.defaultValue)
  ))
  const descriptions = PAYROLL_SETTING_DEFINITIONS.map((definition) => definition.description)

  keys.push(LEGACY_HOLIDAY_RATE_KEY)
  values.push(JSON.stringify(legacyHolidayRate))
  descriptions.push('Legacy regular holiday rate multiplier')

  await pool.query(
    `INSERT INTO system_settings (key, value, description)
     SELECT key, value::jsonb, description
     FROM UNNEST($1::text[], $2::text[], $3::text[]) AS defaults(key, value, description)
     ON CONFLICT (key) DO UPDATE
       SET description = EXCLUDED.description
       WHERE system_settings.description IS DISTINCT FROM EXCLUDED.description`,
    [keys, values, descriptions]
  )
}

export async function getGeneralSettings(): Promise<GeneralSettings> {
  await seedMissingGeneralSettings()

  const result = await pool.query<SystemSettingRow>(
    `SELECT key, value
     FROM system_settings
     WHERE key = ANY($1::text[])`,
    [GENERAL_SETTING_DEFINITIONS.map((definition) => definition.key)]
  )

  const settings = emptyGeneralSettings()

  for (const row of result.rows) {
    const definition = definitionsByKey.get(row.key)
    if (definition) {
      settings[definition.field] = settingValueToString(row.value)
    }
  }

  return settings
}

export async function getPayrollSettings(): Promise<PayrollSettings> {
  await seedMissingPayrollSettings()

  const result = await pool.query<SystemSettingRow>(
    `SELECT key, value
     FROM system_settings
     WHERE key = ANY($1::text[])`,
    [[
      ...PAYROLL_SETTING_DEFINITIONS.map((definition) => definition.key),
      LEGACY_HOLIDAY_RATE_KEY,
    ]]
  )

  const rowsByKey = new Map(result.rows.map((row) => [row.key, row.value]))
  const settings = emptyPayrollSettings()

  for (const row of result.rows) {
    const definition = payrollDefinitionsByKey.get(row.key)
    if (!definition) continue

    const defaultValue = definition.defaultValue
    if (typeof defaultValue === 'boolean') {
      settings[definition.field] = settingValueToBoolean(row.value, defaultValue) as never
    } else if (typeof defaultValue === 'number') {
      settings[definition.field] = settingValueToNumber(row.value, defaultValue) as never
    } else {
      settings[definition.field] = settingValueToString(row.value) as never
    }
  }

  if (!rowsByKey.has('regular_holiday_rate') && rowsByKey.has(LEGACY_HOLIDAY_RATE_KEY)) {
    settings.regularHolidayRate = settingValueToNumber(rowsByKey.get(LEGACY_HOLIDAY_RATE_KEY), 2.0)
  }

  return settings
}

export async function updateGeneralSettings(
  input: GeneralSettingsInput,
  updatedBy: string | null
): Promise<GeneralSettings> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    for (const definition of GENERAL_SETTING_DEFINITIONS) {
      await client.query(
        `INSERT INTO system_settings (key, value, description, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, $4::uuid, NOW())
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             description = EXCLUDED.description,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
        [
          definition.key,
          JSON.stringify(input[definition.field]),
          definition.description,
          updatedBy,
        ]
      )
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return getGeneralSettings()
}

export async function updatePayrollSettings(
  input: PayrollSettingsInput,
  updatedBy: string | null
): Promise<PayrollSettings> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    for (const definition of PAYROLL_SETTING_DEFINITIONS) {
      await client.query(
        `INSERT INTO system_settings (key, value, description, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, $4::uuid, NOW())
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             description = EXCLUDED.description,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
        [
          definition.key,
          JSON.stringify(input[definition.field]),
          definition.description,
          updatedBy,
        ]
      )
    }

    await client.query(
      `INSERT INTO system_settings (key, value, description, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, $4::uuid, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           description = EXCLUDED.description,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
      [
        LEGACY_HOLIDAY_RATE_KEY,
        JSON.stringify(input.regularHolidayRate),
        'Legacy regular holiday rate multiplier',
        updatedBy,
      ]
    )

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return getPayrollSettings()
}

async function readLeaveTypeSettings(): Promise<LeaveTypeSettings[]> {
  const result = await pool.query<LeaveTypeSettingsRow>(
    `SELECT id, code, name, description, days_per_year, is_paid,
            COALESCE(is_accrual_based, false) AS is_accrual_based,
            COALESCE(requires_balance, false) AS requires_balance,
            COALESCE(applies_to_probationary, false) AS applies_to_probationary,
            COALESCE(applies_to_regular, true) AS applies_to_regular,
            max_days_per_request,
            filing_deadline_days,
            filing_deadline_type,
            COALESCE(requires_document, requires_docs, false) AS requires_document,
            document_rule,
            COALESCE(is_cash_convertible, is_convertible, false) AS is_cash_convertible,
            COALESCE(is_carry_over_allowed, false) AS is_carry_over_allowed,
            COALESCE(is_statutory, false) AS is_statutory,
            COALESCE(day_count_type, 'working_days') AS day_count_type,
            policy_notes,
            COALESCE(is_active, true) AS is_active
     FROM leave_types
     ORDER BY CASE code
       WHEN 'VACATION' THEN 1 WHEN 'SICK' THEN 2 WHEN 'EMERGENCY' THEN 3
       WHEN 'BEREAVEMENT' THEN 4 WHEN 'NON_PAID' THEN 5 WHEN 'MATERNITY' THEN 6
       WHEN 'PATERNITY' THEN 7 ELSE 99 END, name`
  )

  return result.rows.map(leaveTypeRowToSettings)
}

async function readLeavePolicySettings(): Promise<LeavePolicySettings[]> {
  const result = await pool.query<LeavePolicySettingsRow>(
    `SELECT lp.id,
            lp.leave_type_id,
            lt.code AS leave_type_code,
            lt.name AS leave_type_name,
            lp.effective_date,
            lp.employment_status,
            lp.entitlement_days,
            lp.monthly_credit,
            lp.carry_over_limit,
            lp.cash_conversion_limit,
            lp.forfeiture_rule,
            lp.notes
     FROM leave_policies lp
     JOIN leave_types lt ON lt.id = lp.leave_type_id
     ORDER BY CASE lt.code
       WHEN 'VACATION' THEN 1 WHEN 'SICK' THEN 2 WHEN 'EMERGENCY' THEN 3
       WHEN 'BEREAVEMENT' THEN 4 WHEN 'NON_PAID' THEN 5 WHEN 'MATERNITY' THEN 6
       WHEN 'PATERNITY' THEN 7 ELSE 99 END,
       lp.effective_date DESC,
       lp.employment_status`
  )

  return result.rows.map(leavePolicyRowToSettings)
}

export async function getLeaveSettings(): Promise<LeaveSettings> {
  const [leaveTypes, policies] = await Promise.all([
    readLeaveTypeSettings(),
    readLeavePolicySettings(),
  ])

  return {
    leaveTypes,
    policies,
    globalSettings: {},
    clarificationItems: LeavePolicyService.clarificationItems,
  }
}

function addLeaveSettingsError(errors: LeaveSettingsValidationErrors, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message]
}

function readInputObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function normalizeInputString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeInputNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function normalizeInputBoolean(
  value: unknown,
  fallback: boolean,
  field: string,
  errors: LeaveSettingsValidationErrors
): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  addLeaveSettingsError(errors, field, 'Must be true or false')
  return fallback
}

function normalizeInputNumber(
  value: unknown,
  field: string,
  errors: LeaveSettingsValidationErrors,
  options: { nullable?: boolean; min?: number; positive?: boolean } = {}
): number | null {
  if (value === undefined || value === null || value === '') {
    return options.nullable ? null : 0
  }

  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) {
    addLeaveSettingsError(errors, field, 'Must be a valid number')
    return options.nullable ? null : 0
  }
  if (options.positive && numberValue <= 0) {
    addLeaveSettingsError(errors, field, 'Must be greater than 0')
  }
  if (options.min !== undefined && numberValue < options.min) {
    addLeaveSettingsError(errors, field, `Must be ${options.min} or greater`)
  }
  return Math.round(numberValue * 100) / 100
}

function nullableNumbersEqual(left: number | null, right: number | null): boolean {
  if (left === null && right === null) return true
  if (left === null || right === null) return false
  return Math.abs(left - right) < 0.001
}

function nullableStringsEqual(left: string | null, right: string | null): boolean {
  return (left ?? null) === (right ?? null)
}

function leaveTypeSettingsEqual(left: LeaveTypeSettings | undefined, right: LeaveTypeSettings): boolean {
  if (!left) return false

  return left.code === right.code &&
    left.name === right.name &&
    nullableStringsEqual(left.description, right.description) &&
    nullableNumbersEqual(left.daysPerYear, right.daysPerYear) &&
    left.isPaid === right.isPaid &&
    left.isAccrualBased === right.isAccrualBased &&
    left.requiresBalance === right.requiresBalance &&
    left.appliesToProbationary === right.appliesToProbationary &&
    left.appliesToRegular === right.appliesToRegular &&
    nullableNumbersEqual(left.maxDaysPerRequest, right.maxDaysPerRequest) &&
    left.filingDeadlineDays === right.filingDeadlineDays &&
    nullableStringsEqual(left.filingDeadlineType, right.filingDeadlineType) &&
    left.requiresDocument === right.requiresDocument &&
    nullableStringsEqual(left.documentRule, right.documentRule) &&
    left.isCashConvertible === right.isCashConvertible &&
    left.isCarryOverAllowed === right.isCarryOverAllowed &&
    left.isStatutory === right.isStatutory &&
    left.dayCountType === right.dayCountType &&
    nullableStringsEqual(left.policyNotes, right.policyNotes) &&
    left.isActive === right.isActive
}

function leavePolicySettingsEqual(left: LeavePolicySettings | undefined, right: LeavePolicySettings): boolean {
  if (!left) return false

  return left.leaveTypeId === right.leaveTypeId &&
    left.leaveTypeCode === right.leaveTypeCode &&
    left.leaveTypeName === right.leaveTypeName &&
    left.effectiveDate === right.effectiveDate &&
    left.employmentStatus === right.employmentStatus &&
    nullableNumbersEqual(left.entitlementDays, right.entitlementDays) &&
    nullableNumbersEqual(left.monthlyCredit, right.monthlyCredit) &&
    nullableNumbersEqual(left.carryOverLimit, right.carryOverLimit) &&
    nullableNumbersEqual(left.cashConversionLimit, right.cashConversionLimit) &&
    nullableStringsEqual(left.forfeitureRule, right.forfeitureRule) &&
    nullableStringsEqual(left.notes, right.notes)
}

function protectedLeaveTypeChanged(current: LeaveTypeSettings, next: LeaveTypeSettings): boolean {
  return current.code !== next.code ||
    current.name !== next.name ||
    !nullableNumbersEqual(current.daysPerYear, next.daysPerYear) ||
    current.isPaid !== next.isPaid ||
    current.isAccrualBased !== next.isAccrualBased ||
    current.requiresBalance !== next.requiresBalance ||
    current.appliesToProbationary !== next.appliesToProbationary ||
    current.appliesToRegular !== next.appliesToRegular ||
    !nullableNumbersEqual(current.maxDaysPerRequest, next.maxDaysPerRequest) ||
    current.filingDeadlineDays !== next.filingDeadlineDays ||
    current.filingDeadlineType !== next.filingDeadlineType ||
    current.requiresDocument !== next.requiresDocument ||
    current.isCashConvertible !== next.isCashConvertible ||
    current.isCarryOverAllowed !== next.isCarryOverAllowed ||
    current.isStatutory !== next.isStatutory ||
    current.dayCountType !== next.dayCountType ||
    current.isActive !== next.isActive
}

function protectedPolicyChanged(current: LeavePolicySettings, next: LeavePolicySettings): boolean {
  return current.leaveTypeId !== next.leaveTypeId ||
    current.leaveTypeCode !== next.leaveTypeCode ||
    current.effectiveDate !== next.effectiveDate ||
    current.employmentStatus !== next.employmentStatus ||
    !nullableNumbersEqual(current.entitlementDays, next.entitlementDays) ||
    !nullableNumbersEqual(current.monthlyCredit, next.monthlyCredit) ||
    !nullableNumbersEqual(current.carryOverLimit, next.carryOverLimit) ||
    !nullableNumbersEqual(current.cashConversionLimit, next.cashConversionLimit)
}

function validateLeaveTypeInput(
  rawValue: unknown,
  index: number,
  currentById: Map<string, LeaveTypeSettings>,
  errors: LeaveSettingsValidationErrors
): LeaveTypeSettings | null {
  const raw = readInputObject(rawValue)
  const id = normalizeInputString(raw.id)
  const fieldPrefix = id ? `leaveTypes.${id}` : `leaveTypes.${index}`
  const current = currentById.get(id)

  if (!id || !current) {
    addLeaveSettingsError(errors, `${fieldPrefix}.id`, 'Leave type was not found')
    return null
  }

  const code = normalizeCode(normalizeInputString(raw.code))
  const name = normalizeInputString(raw.name)
  const dayCountType = normalizeInputString(raw.dayCountType) as LeaveDayCountType
  const filingDeadlineDays = normalizeInputNumber(
    raw.filingDeadlineDays,
    `${fieldPrefix}.filingDeadlineDays`,
    errors,
    { nullable: true, min: 0 }
  )

  if (!name) addLeaveSettingsError(errors, `${fieldPrefix}.name`, 'Leave type name is required')
  if (!code) addLeaveSettingsError(errors, `${fieldPrefix}.code`, 'Leave type code is required')
  if (code !== current.code) addLeaveSettingsError(errors, `${fieldPrefix}.code`, 'Existing leave type codes cannot be changed')
  if (dayCountType !== 'working_days' && dayCountType !== 'calendar_days') {
    addLeaveSettingsError(errors, `${fieldPrefix}.dayCountType`, 'Day count type must be working_days or calendar_days')
  }
  if (filingDeadlineDays !== null && !Number.isInteger(filingDeadlineDays)) {
    addLeaveSettingsError(errors, `${fieldPrefix}.filingDeadlineDays`, 'Filing deadline days must be a whole number')
  }

  const next: LeaveTypeSettings = {
    id,
    code: code || current.code,
    name,
    description: normalizeInputNullableString(raw.description),
    daysPerYear: normalizeInputNumber(raw.daysPerYear, `${fieldPrefix}.daysPerYear`, errors, { min: 0 }) ?? 0,
    isPaid: normalizeInputBoolean(raw.isPaid, current.isPaid, `${fieldPrefix}.isPaid`, errors),
    isAccrualBased: normalizeInputBoolean(raw.isAccrualBased, current.isAccrualBased, `${fieldPrefix}.isAccrualBased`, errors),
    requiresBalance: normalizeInputBoolean(raw.requiresBalance, current.requiresBalance, `${fieldPrefix}.requiresBalance`, errors),
    appliesToProbationary: normalizeInputBoolean(raw.appliesToProbationary, current.appliesToProbationary, `${fieldPrefix}.appliesToProbationary`, errors),
    appliesToRegular: normalizeInputBoolean(raw.appliesToRegular, current.appliesToRegular, `${fieldPrefix}.appliesToRegular`, errors),
    maxDaysPerRequest: normalizeInputNumber(raw.maxDaysPerRequest, `${fieldPrefix}.maxDaysPerRequest`, errors, { nullable: true, positive: true }),
    filingDeadlineDays: filingDeadlineDays === null ? null : Math.trunc(filingDeadlineDays),
    filingDeadlineType: normalizeInputNullableString(raw.filingDeadlineType),
    requiresDocument: normalizeInputBoolean(raw.requiresDocument, current.requiresDocument, `${fieldPrefix}.requiresDocument`, errors),
    documentRule: normalizeInputNullableString(raw.documentRule),
    isCashConvertible: normalizeInputBoolean(raw.isCashConvertible, current.isCashConvertible, `${fieldPrefix}.isCashConvertible`, errors),
    isCarryOverAllowed: normalizeInputBoolean(raw.isCarryOverAllowed, current.isCarryOverAllowed, `${fieldPrefix}.isCarryOverAllowed`, errors),
    isStatutory: normalizeInputBoolean(raw.isStatutory, current.isStatutory, `${fieldPrefix}.isStatutory`, errors),
    dayCountType: dayCountType === 'calendar_days' ? 'calendar_days' : 'working_days',
    policyNotes: normalizeInputNullableString(raw.policyNotes),
    isActive: normalizeInputBoolean(raw.isActive, current.isActive, `${fieldPrefix}.isActive`, errors),
    isProtected: current.isProtected,
  }

  if (current.isProtected && protectedLeaveTypeChanged(current, next)) {
    addLeaveSettingsError(errors, fieldPrefix, 'Statutory leave rules are protected and cannot be changed here')
  }

  return next
}

function validateLeavePolicyInput(
  rawValue: unknown,
  index: number,
  currentById: Map<string, LeavePolicySettings>,
  errors: LeaveSettingsValidationErrors
): LeavePolicySettings | null {
  const raw = readInputObject(rawValue)
  const id = normalizeInputString(raw.id)
  const fieldPrefix = id ? `policies.${id}` : `policies.${index}`
  const current = currentById.get(id)

  if (!id || !current) {
    addLeaveSettingsError(errors, `${fieldPrefix}.id`, 'Leave policy was not found')
    return null
  }

  const entitlementDays = normalizeInputNumber(raw.entitlementDays, `${fieldPrefix}.entitlementDays`, errors, { min: 0 }) ?? 0
  const monthlyCredit = normalizeInputNumber(raw.monthlyCredit, `${fieldPrefix}.monthlyCredit`, errors, { min: 0 }) ?? 0
  const carryOverLimit = normalizeInputNumber(raw.carryOverLimit, `${fieldPrefix}.carryOverLimit`, errors, { nullable: true, min: 0 })
  const cashConversionLimit = normalizeInputNumber(raw.cashConversionLimit, `${fieldPrefix}.cashConversionLimit`, errors, { nullable: true, min: 0 })
  const leaveTypeId = normalizeInputString(raw.leaveTypeId)
  const leaveTypeCode = normalizeCode(normalizeInputString(raw.leaveTypeCode))
  const effectiveDate = normalizeInputString(raw.effectiveDate)
  const employmentStatus = normalizeInputString(raw.employmentStatus)

  if (leaveTypeId !== current.leaveTypeId) {
    addLeaveSettingsError(errors, `${fieldPrefix}.leaveTypeId`, 'Policy leave type cannot be changed')
  }
  if (leaveTypeCode !== current.leaveTypeCode) {
    addLeaveSettingsError(errors, `${fieldPrefix}.leaveTypeCode`, 'Policy leave type code cannot be changed')
  }
  if (effectiveDate !== current.effectiveDate) {
    addLeaveSettingsError(errors, `${fieldPrefix}.effectiveDate`, 'Policy effective date cannot be changed here')
  }
  if (employmentStatus !== current.employmentStatus) {
    addLeaveSettingsError(errors, `${fieldPrefix}.employmentStatus`, 'Policy employment status cannot be changed here')
  }

  const next: LeavePolicySettings = {
    id,
    leaveTypeId: current.leaveTypeId,
    leaveTypeCode: current.leaveTypeCode,
    leaveTypeName: current.leaveTypeName,
    effectiveDate: current.effectiveDate,
    employmentStatus: current.employmentStatus,
    entitlementDays,
    monthlyCredit,
    carryOverLimit,
    cashConversionLimit,
    forfeitureRule: normalizeInputNullableString(raw.forfeitureRule),
    notes: normalizeInputNullableString(raw.notes),
    isProtected: current.isProtected,
  }

  if (current.isProtected && protectedPolicyChanged(current, next)) {
    addLeaveSettingsError(errors, fieldPrefix, 'Statutory leave policy rows are protected and cannot be changed here')
  }

  return next
}

function validateLeaveSettingsPayload(
  input: unknown,
  current: LeaveSettings
): LeaveSettingsInput {
  const errors: LeaveSettingsValidationErrors = {}
  const payload = readInputObject(input)
  const rawLeaveTypes = payload.leaveTypes
  const rawPolicies = payload.policies

  if (!Array.isArray(rawLeaveTypes)) {
    addLeaveSettingsError(errors, 'leaveTypes', 'Leave types are required')
  }
  if (!Array.isArray(rawPolicies)) {
    addLeaveSettingsError(errors, 'policies', 'Leave policies are required')
  }

  const currentLeaveTypesById = new Map(current.leaveTypes.map((item) => [item.id, item]))
  const currentPoliciesById = new Map(current.policies.map((item) => [item.id, item]))
  const leaveTypes = Array.isArray(rawLeaveTypes)
    ? rawLeaveTypes
      .map((item, index) => validateLeaveTypeInput(item, index, currentLeaveTypesById, errors))
      .filter((item): item is LeaveTypeSettings => item !== null)
    : []
  const policies = Array.isArray(rawPolicies)
    ? rawPolicies
      .map((item, index) => validateLeavePolicyInput(item, index, currentPoliciesById, errors))
      .filter((item): item is LeavePolicySettings => item !== null)
    : []

  if (Object.keys(errors).length > 0) {
    throw new LeaveSettingsValidationError(errors)
  }

  return { leaveTypes, policies }
}

export async function updateLeaveSettings(
  input: unknown,
  updatedBy: string | null
): Promise<LeaveSettings> {
  const current = await getLeaveSettings()
  const validated = validateLeaveSettingsPayload(input, current)
  const currentLeaveTypesById = new Map(current.leaveTypes.map((item) => [item.id, item]))
  const currentPoliciesById = new Map(current.policies.map((item) => [item.id, item]))
  const client = await pool.connect()
  const auditEntries: Array<{
    action: string
    entity: string
    entityId: string
    oldValues?: unknown
    newValues?: unknown
  }> = []

  try {
    await client.query('BEGIN')

    for (const leaveType of validated.leaveTypes) {
      const before = currentLeaveTypesById.get(leaveType.id)
      if (leaveTypeSettingsEqual(before, leaveType)) continue

      await client.query(
        `UPDATE leave_types
         SET name = $2,
             description = $3,
             days_per_year = $4,
             is_paid = $5,
             is_accrual_based = $6,
             requires_balance = $7,
             applies_to_probationary = $8,
             applies_to_regular = $9,
             max_days_per_request = $10,
             filing_deadline_days = $11,
             filing_deadline_type = $12,
             requires_document = $13,
             requires_docs = $13,
             document_rule = $14,
             is_cash_convertible = $15,
             is_convertible = $15,
             is_carry_over_allowed = $16,
             is_statutory = $17,
             day_count_type = $18,
             policy_notes = $19,
             is_active = $20,
             updated_at = NOW()
         WHERE id = $1`,
        [
          leaveType.id,
          leaveType.name,
          leaveType.description,
          leaveType.daysPerYear,
          leaveType.isPaid,
          leaveType.isAccrualBased,
          leaveType.requiresBalance,
          leaveType.appliesToProbationary,
          leaveType.appliesToRegular,
          leaveType.maxDaysPerRequest,
          leaveType.filingDeadlineDays,
          leaveType.filingDeadlineType,
          leaveType.requiresDocument,
          leaveType.documentRule,
          leaveType.isCashConvertible,
          leaveType.isCarryOverAllowed,
          leaveType.isStatutory,
          leaveType.dayCountType,
          leaveType.policyNotes,
          leaveType.isActive,
        ]
      )
      auditEntries.push({
        action: 'leave_type_settings_updated',
        entity: 'leave_types',
        entityId: leaveType.id,
        oldValues: before,
        newValues: leaveType,
      })
    }

    for (const policy of validated.policies) {
      const before = currentPoliciesById.get(policy.id)
      if (leavePolicySettingsEqual(before, policy)) continue

      await client.query(
        `UPDATE leave_policies
         SET entitlement_days = $2,
             monthly_credit = $3,
             carry_over_limit = $4,
             cash_conversion_limit = $5,
             forfeiture_rule = $6,
             notes = $7,
             updated_at = NOW()
         WHERE id = $1`,
        [
          policy.id,
          policy.entitlementDays,
          policy.monthlyCredit,
          policy.carryOverLimit,
          policy.cashConversionLimit,
          policy.forfeitureRule,
          policy.notes,
        ]
      )
      auditEntries.push({
        action: 'leave_policy_settings_updated',
        entity: 'leave_policies',
        entityId: policy.id,
        oldValues: before,
        newValues: policy,
      })
    }

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  for (const entry of auditEntries) {
    await LeaveAuditService.recordEntityAudit({
      userId: updatedBy ?? undefined,
      ...entry,
    })
  }

  return getLeaveSettings()
}

export async function getPayrollPolicySettings(): Promise<PayrollPolicySettings> {
  const result = await pool.query<SystemSettingRow>(
    `SELECT key, value
     FROM system_settings
     WHERE key = ANY($1::text[])`,
    [[
      'offset_credit_enabled',
      'offset_requires_approval',
      'minimum_offset_credit_minutes',
      'night_differential_enabled',
      'regular_holiday_rate',
      'special_holiday_rate',
      LEGACY_HOLIDAY_RATE_KEY,
    ]]
  )
  const rowsByKey = new Map(result.rows.map((row) => [row.key, row.value]))

  return {
    offsetCreditEnabled: settingValueToBoolean(rowsByKey.get('offset_credit_enabled'), true),
    offsetRequiresApproval: settingValueToBoolean(rowsByKey.get('offset_requires_approval'), true),
    minimumOffsetCreditMinutes: settingValueToNumber(rowsByKey.get('minimum_offset_credit_minutes'), 1),
    nightDifferentialEnabled: settingValueToBoolean(rowsByKey.get('night_differential_enabled'), false),
    regularHolidayRate: rowsByKey.has('regular_holiday_rate')
      ? settingValueToNumber(rowsByKey.get('regular_holiday_rate'), 2.0)
      : settingValueToNumber(rowsByKey.get(LEGACY_HOLIDAY_RATE_KEY), 2.0),
    specialHolidayRate: settingValueToNumber(rowsByKey.get('special_holiday_rate'), 1.3),
  }
}
