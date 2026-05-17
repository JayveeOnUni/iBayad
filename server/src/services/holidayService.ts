import { createError } from '../middleware/errorHandler'
import pool from '../utils/db'

export const holidayTypes = ['regular', 'special_non_working', 'special_working'] as const
export type HolidayType = typeof holidayTypes[number]

export interface AdminHoliday {
  id: string
  name: string
  date: string
  holidayDate: string
  type: HolidayType
  holidayType: HolidayType
  isRecurring: boolean
  country: string
  cityOrProvince: string | null
  isWorkingHoliday: boolean
  source: string | null
  createdAt: string
  updatedAt: string
}

export interface HolidayMutationInput {
  name: string
  holidayDate: string
  holidayType: HolidayType
  isRecurring: boolean
  country: string
  cityOrProvince: string | null
  isWorkingHoliday: boolean
  source: string | null
}

export type DeleteHolidayResult =
  | { status: 'deleted'; deletedHolidayId: string }
  | { status: 'not_found' }

type ValidationErrors = Record<string, string[]>

interface HolidayRow {
  id: string
  name: string
  date: string
  type: string
  holiday_date: string
  holiday_type: string
  is_recurring: boolean | null
  country: string | null
  city_or_province: string | null
  is_working_holiday: boolean | null
  source: string | null
  created_at: Date | string
  updated_at: Date | string
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/

function addFieldError(errors: ValidationErrors, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message]
}

function throwValidationError(errors: ValidationErrors): never {
  const error = createError('Holiday details contain invalid values.', 400)
  error.details = { errors }
  throw error
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeDate(value: unknown, field: string, label: string, errors: ValidationErrors): string {
  const normalized = typeof value === 'string' ? value.trim() : ''

  if (!normalized) {
    addFieldError(errors, field, `${label} is required`)
    return normalized
  }

  if (!datePattern.test(normalized)) {
    addFieldError(errors, field, `${label} must use YYYY-MM-DD date format`)
    return normalized
  }

  const [year, month, day] = normalized.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const isValidDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day

  if (!isValidDate) addFieldError(errors, field, `${label} must be a valid date`)
  return normalized
}

function normalizeHolidayType(value: unknown, errors: ValidationErrors): HolidayType {
  const normalized = typeof value === 'string' ? value.trim() : ''

  if (!normalized) {
    addFieldError(errors, 'holidayType', 'Holiday type is required')
    return 'regular'
  }

  if (!holidayTypes.includes(normalized as HolidayType)) {
    addFieldError(errors, 'holidayType', 'Holiday type is not supported')
    return 'regular'
  }

  return normalized as HolidayType
}

function normalizeBoolean(value: unknown, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue
}

export function validateHolidayMutationInput(body: Record<string, unknown>): HolidayMutationInput {
  const errors: ValidationErrors = {}
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const holidayDate = normalizeDate(body.holidayDate ?? body.holiday_date ?? body.date, 'holidayDate', 'Holiday date', errors)
  const holidayType = normalizeHolidayType(body.holidayType ?? body.holiday_type ?? body.type, errors)
  const country = normalizeOptionalString(body.country) ?? 'Philippines'
  const cityOrProvince = normalizeOptionalString(body.cityOrProvince ?? body.city_or_province)
  const source = normalizeOptionalString(body.source)
  const isRecurring = normalizeBoolean(body.isRecurring ?? body.is_recurring, true)
  const isWorkingHoliday = holidayType === 'special_working'

  if (!name) addFieldError(errors, 'name', 'Holiday name is required')
  if (name.length > 100) addFieldError(errors, 'name', 'Holiday name must be 100 characters or fewer')
  if (country.length > 80) addFieldError(errors, 'country', 'Country must be 80 characters or fewer')
  if (cityOrProvince && cityOrProvince.length > 120) {
    addFieldError(errors, 'cityOrProvince', 'City or province must be 120 characters or fewer')
  }

  if (Object.keys(errors).length > 0) throwValidationError(errors)

  return {
    name,
    holidayDate,
    holidayType,
    isRecurring,
    country,
    cityOrProvince,
    isWorkingHoliday,
    source,
  }
}

function mapHolidayRow(row: HolidayRow): AdminHoliday {
  const errors: ValidationErrors = {}
  const holidayType = normalizeHolidayType(row.holiday_type ?? row.type, errors)
  const holidayDate = row.holiday_date ?? row.date

  return {
    id: String(row.id),
    name: String(row.name),
    date: holidayDate,
    holidayDate,
    type: holidayType,
    holidayType,
    isRecurring: Boolean(row.is_recurring),
    country: row.country ?? 'Philippines',
    cityOrProvince: row.city_or_province,
    isWorkingHoliday: holidayType === 'special_working' || Boolean(row.is_working_holiday),
    source: row.source,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

export async function getAllHolidays(year?: number): Promise<AdminHoliday[]> {
  const params: Array<string | number> = []
  const where = Number.isInteger(year)
    ? 'WHERE COALESCE(holiday_date, date) >= $1::date AND COALESCE(holiday_date, date) < $2::date'
    : ''

  if (Number.isInteger(year)) {
    params.push(`${year}-01-01`, `${Number(year) + 1}-01-01`)
  }

  const result = await pool.query<HolidayRow>(
    `SELECT
       id,
       name,
       TO_CHAR(date, 'YYYY-MM-DD') AS date,
       type,
       TO_CHAR(COALESCE(holiday_date, date), 'YYYY-MM-DD') AS holiday_date,
       COALESCE(holiday_type, type) AS holiday_type,
       is_recurring,
       COALESCE(country, 'Philippines') AS country,
       city_or_province,
       COALESCE(is_working_holiday, false) AS is_working_holiday,
       source,
       created_at,
       updated_at
     FROM holidays
     ${where}
     ORDER BY COALESCE(holiday_date, date), name`,
    params
  )

  return result.rows.map(mapHolidayRow)
}

export async function getHolidayById(id: string): Promise<AdminHoliday | null> {
  const result = await pool.query<HolidayRow>(
    `SELECT
       id,
       name,
       TO_CHAR(date, 'YYYY-MM-DD') AS date,
       type,
       TO_CHAR(COALESCE(holiday_date, date), 'YYYY-MM-DD') AS holiday_date,
       COALESCE(holiday_type, type) AS holiday_type,
       is_recurring,
       COALESCE(country, 'Philippines') AS country,
       city_or_province,
       COALESCE(is_working_holiday, false) AS is_working_holiday,
       source,
       created_at,
       updated_at
     FROM holidays
     WHERE id = $1`,
    [id]
  )

  return result.rows[0] ? mapHolidayRow(result.rows[0]) : null
}

export async function createHoliday(input: HolidayMutationInput): Promise<AdminHoliday> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO holidays (
       name,
       date,
       type,
       is_recurring,
       holiday_date,
       holiday_type,
       country,
       city_or_province,
       is_working_holiday,
       source
     )
     VALUES ($1, $2::date, $3, $4, $2::date, $3, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.name,
      input.holidayDate,
      input.holidayType,
      input.isRecurring,
      input.country,
      input.cityOrProvince,
      input.isWorkingHoliday,
      input.source,
    ]
  )

  const holiday = await getHolidayById(result.rows[0].id)
  if (!holiday) throw new Error('Holiday was not found after creation.')
  return holiday
}

export async function updateHoliday(id: string, input: HolidayMutationInput): Promise<AdminHoliday | null> {
  const result = await pool.query<{ id: string }>(
    `UPDATE holidays
     SET name = $2,
         date = $3::date,
         type = $4,
         is_recurring = $5,
         holiday_date = $3::date,
         holiday_type = $4,
         country = $6,
         city_or_province = $7,
         is_working_holiday = $8,
         source = $9,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [
      id,
      input.name,
      input.holidayDate,
      input.holidayType,
      input.isRecurring,
      input.country,
      input.cityOrProvince,
      input.isWorkingHoliday,
      input.source,
    ]
  )

  if (!result.rows[0]) return null
  return getHolidayById(result.rows[0].id)
}

export async function deleteHoliday(id: string): Promise<DeleteHolidayResult> {
  const result = await pool.query(
    `DELETE FROM holidays
     WHERE id = $1`,
    [id]
  )

  if (!result.rowCount) return { status: 'not_found' }
  return { status: 'deleted', deletedHolidayId: id }
}

export function parseHolidayYear(value: unknown): number | undefined {
  if (value === undefined) return undefined
  const year = Number(value)
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw createError('Year must be a valid four-digit year.', 400)
  }
  return year
}
