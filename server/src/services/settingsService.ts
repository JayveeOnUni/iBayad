import pool from '../utils/db'

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
