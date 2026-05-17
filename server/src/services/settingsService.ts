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

interface SettingDefinition {
  field: keyof GeneralSettings
  key: string
  description: string
  defaultValue: string
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

function settingValueToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function emptyGeneralSettings(): GeneralSettings {
  return GENERAL_SETTING_DEFINITIONS.reduce((settings, definition) => ({
    ...settings,
    [definition.field]: definition.defaultValue,
  }), {} as GeneralSettings)
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
