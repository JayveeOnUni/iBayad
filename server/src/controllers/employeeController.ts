import { Request, Response } from 'express'
import crypto from 'crypto'
import { EmployeeModel, type EmployeeRow } from '../models/Employee'
import { asyncHandler, createError } from '../middleware/errorHandler'
import pool from '../utils/db'
import { sendActivationEmail, type EmailDeliveryMetadata } from '../services/emailService'
import { buildClientUrl } from '../config/environment'
import { logger } from '../utils/logger'

type PgError = Error & {
  code?: string
  constraint?: string
  column?: string
  table?: string
  detail?: string
}

type ValidationErrors = Record<string, string[]>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_WORK_DAYS_PER_MONTH = 22
const DEFAULT_WORK_HOURS_PER_DAY = 8
const MAX_WORK_DAYS_PER_MONTH = 31
const MAX_WORK_HOURS_PER_DAY = 24
const MAX_BASIC_SALARY = 10000000
const GENDER_VALUES = ['male', 'female', 'other'] as const
const CIVIL_STATUS_VALUES = ['single', 'married', 'widowed', 'separated'] as const
const EMPLOYMENT_TYPE_VALUES = ['regular', 'probationary', 'contractual', 'part_time'] as const
const EMPLOYEE_STATUS_VALUES = ['active', 'inactive', 'terminated', 'resigned', 'end_of_contract'] as const
const SEPARATION_STATUS_VALUES = ['inactive', 'terminated', 'resigned', 'end_of_contract'] as const

type GenderValue = typeof GENDER_VALUES[number]
type CivilStatusValue = typeof CIVIL_STATUS_VALUES[number]
type EmploymentTypeValue = typeof EMPLOYMENT_TYPE_VALUES[number]
type EmployeeStatusValue = typeof EMPLOYEE_STATUS_VALUES[number]
type SeparationStatusValue = typeof SEPARATION_STATUS_VALUES[number]

interface NormalizedEmployeeCreateInput {
  firstName: string
  middleName: string | null
  lastName: string
  email: string
  phone: string | null
  birthDate: string | null
  gender: GenderValue | null
  civilStatus: CivilStatusValue | null
  address: string | null
  city: string | null
  province: string | null
  zipCode: string | null
  departmentId: string
  positionId: string
  shiftId: string | null
  employmentType: EmploymentTypeValue
  employeeStatus: EmployeeStatusValue
  hireDate: string
  basicSalary: number
  dailyRate: number
  hourlyRate: number
  workDaysPerMonth: number
  workHoursPerDay: number
  sssNumber: string | null
  philhealthNumber: string | null
  pagibigNumber: string | null
  tinNumber: string | null
  bankName: string | null
  bankAccountNumber: string | null
}

type EmployeeUpdateData = Partial<EmployeeRow>

function positiveIntegerEnv(name: string, fallback: number, minimum: number): number {
  const rawValue = process.env[name]
  const parsed = rawValue == null || rawValue.trim() === '' ? fallback : Number(rawValue)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback
}

const ACTIVATION_EXPIRES_HOURS = positiveIntegerEnv('ACCOUNT_ACTIVATION_EXPIRES_HOURS', 72, 1)

function addFieldError(errors: ValidationErrors, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message]
}

function hasValidationErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0
}

function throwValidationError(errors: ValidationErrors): never {
  const messages = Object.values(errors).flat()
  const error = createError(
    messages.length === 1 ? messages[0] : 'Please fix the highlighted employee fields and try again.',
    400
  )
  error.details = errors
  throw error
}

function emptyToNull(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

function emptyToNullIfPresent(value: unknown): string | null | undefined {
  return value === undefined ? undefined : emptyToNull(value)
}

function requiredText(value: unknown, field: string, label: string, errors: ValidationErrors): string {
  const normalized = emptyToNull(value)
  if (!normalized) {
    addFieldError(errors, field, `${label} is required`)
    return ''
  }
  return normalized
}

function optionalText(value: unknown): string | null {
  return emptyToNull(value)
}

function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function requiredDateValue(value: unknown, field: string, label: string, errors: ValidationErrors): string {
  const normalized = emptyToNull(value)
  if (!normalized) {
    addFieldError(errors, field, `${label} is required`)
    return ''
  }
  if (!isDateOnly(normalized)) {
    addFieldError(errors, field, `${label} must be a valid date in YYYY-MM-DD format`)
    return ''
  }
  return normalized
}

function optionalDateValue(value: unknown, field: string, label: string, errors: ValidationErrors): string | null {
  const normalized = emptyToNull(value)
  if (!normalized) return null
  if (!isDateOnly(normalized)) {
    addFieldError(errors, field, `${label} must be a valid date in YYYY-MM-DD format`)
    return null
  }
  return normalized
}

function requiredUuid(value: unknown, field: string, label: string, errors: ValidationErrors): string {
  const normalized = requiredText(value, field, label, errors)
  if (normalized && !UUID_PATTERN.test(normalized)) {
    addFieldError(errors, field, `${label} must be a valid UUID`)
  }
  return normalized
}

function optionalUuid(value: unknown, field: string, label: string, errors: ValidationErrors): string | null {
  const normalized = emptyToNull(value)
  if (!normalized) return null
  if (!UUID_PATTERN.test(normalized)) {
    addFieldError(errors, field, `${label} must be a valid UUID`)
  }
  return normalized
}

function normalizeEmail(value: unknown, errors: ValidationErrors): string {
  const normalized = requiredText(value, 'email', 'Email', errors).toLowerCase()
  if (normalized && !EMAIL_PATTERN.test(normalized)) {
    addFieldError(errors, 'email', 'Email must be a valid email address')
  }
  return normalized
}

function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  label: string,
  allowedValues: readonly T[],
  errors: ValidationErrors
): T | null {
  const normalized = emptyToNull(value)
  if (!normalized) return null
  if (!allowedValues.includes(normalized as T)) {
    addFieldError(errors, field, `${label} must be one of: ${allowedValues.join(', ')}`)
    return null
  }
  return normalized as T
}

function optionalPositiveNumber(value: unknown, field: string, label: string, errors: ValidationErrors): number | null {
  if (value === undefined || value === null || value === '') return null

  const number = Number(value)
  if (!Number.isFinite(number)) {
    addFieldError(errors, field, `${label} must be a valid number`)
    return null
  }
  if (number <= 0) {
    addFieldError(errors, field, `${label} must be greater than 0`)
    return null
  }
  return number
}

function optionalPositiveInteger(value: unknown, field: string, label: string, errors: ValidationErrors): number | null {
  const number = optionalPositiveNumber(value, field, label, errors)
  if (number != null && !Number.isInteger(number)) {
    addFieldError(errors, field, `${label} must be a whole number`)
    return null
  }
  return number
}

function requiredPositiveNumber(value: unknown, field: string, label: string, errors: ValidationErrors): number {
  const number = optionalPositiveNumber(value, field, label, errors)
  if (number == null && (value === undefined || value === null || value === '')) {
    addFieldError(errors, field, `${label} is required`)
  }
  return number ?? 0
}

function updatePositiveNumber(value: unknown, field: string, label: string, errors: ValidationErrors): number | undefined {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) {
    addFieldError(errors, field, `${label} must be a valid number`)
    return undefined
  }
  if (number <= 0) {
    addFieldError(errors, field, `${label} must be greater than 0`)
    return undefined
  }
  return number
}

function updatePositiveInteger(value: unknown, field: string, label: string, errors: ValidationErrors): number | undefined {
  const number = updatePositiveNumber(value, field, label, errors)
  if (number !== undefined && !Number.isInteger(number)) {
    addFieldError(errors, field, `${label} must be a whole number`)
    return undefined
  }
  return number
}

function optionalGovernmentIdValue(value: unknown, field: string, label: string, errors: ValidationErrors): string | null {
  const normalized = emptyToNull(value)
  if (!normalized) return null
  if (normalized.length > 30) {
    addFieldError(errors, field, `${label} must be 30 characters or fewer`)
  }
  if (!/^[0-9 -]+$/.test(normalized)) {
    addFieldError(errors, field, `${label} must contain only numbers, spaces, or hyphens`)
  }
  return normalized
}

function optionalGovernmentId(value: unknown, fieldName: string): string | null {
  const normalized = emptyToNull(value)
  if (!normalized) return null
  if (normalized.length > 30) throw createError(`${fieldName} must be 30 characters or fewer`, 400)
  if (!/^[0-9 -]+$/.test(normalized)) {
    throw createError(`${fieldName} must contain only numbers, spaces, or hyphens`, 400)
  }
  return normalized
}

function optionalGovernmentIdIfPresent(value: unknown, fieldName: string): string | null | undefined {
  return value === undefined ? undefined : optionalGovernmentId(value, fieldName)
}

function requiredDate(value: unknown, fieldName: string): string {
  const date = emptyToNull(value)
  if (!date) throw createError(`${fieldName} is required`, 400)
  if (!isDateOnly(date)) throw createError(`${fieldName} must be a valid date in YYYY-MM-DD format`, 400)
  return date
}

function optionalDate(value: unknown, fieldName: string): string | null {
  const date = emptyToNull(value)
  if (!date) return null
  if (!isDateOnly(date)) throw createError(`${fieldName} must be a valid date in YYYY-MM-DD format`, 400)
  return date
}

function boolFromQuery(value: unknown): boolean {
  return String(value ?? '').toLowerCase() === 'true'
}

function normalizeSeparationStatus(value: unknown, fallback: SeparationStatusValue): SeparationStatusValue {
  const normalized = emptyToNull(value) ?? fallback
  if (!SEPARATION_STATUS_VALUES.includes(normalized as SeparationStatusValue)) {
    throw createError(`Employee status must be one of: ${SEPARATION_STATUS_VALUES.join(', ')}`, 400)
  }
  return normalized as SeparationStatusValue
}

function requireSeparationText(value: unknown, fieldName: string): string {
  const normalized = emptyToNull(value)
  if (!normalized) throw createError(`${fieldName} is required`, 400)
  return normalized
}

async function employeeHistoryCounts(employeeId: string) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM payroll_records WHERE employee_id = $1) AS payroll_records,
       (SELECT COUNT(*)::int FROM attendance WHERE employee_id = $1) AS attendance_records,
       (SELECT COUNT(*)::int FROM leave_requests WHERE employee_id = $1) AS leave_requests,
       (SELECT COUNT(*)::int FROM loans WHERE employee_id = $1) AS loans,
       (SELECT COUNT(*)::int FROM payroll_loan_deductions WHERE employee_id = $1) AS loan_deductions,
       (SELECT COUNT(*)::int FROM payroll_calculation_snapshots WHERE employee_id = $1) AS payroll_snapshots,
       (SELECT COUNT(*)::int FROM payroll_audit_logs WHERE employee_id = $1) AS payroll_audit_logs,
       (SELECT COUNT(*)::int FROM offset_credits WHERE employee_id = $1) AS offset_credits,
       (SELECT COUNT(*)::int FROM offset_usages WHERE employee_id = $1) AS offset_usages,
       (SELECT COUNT(*)::int FROM profile_update_requests WHERE employee_id = $1) AS profile_update_requests`,
    [employeeId]
  )
  return result.rows[0] as Record<string, number>
}

function hasProtectedHistory(counts: Record<string, number>): boolean {
  return Object.values(counts).some((value) => Number(value) > 0)
}

async function insertEmployeeAuditLog(params: {
  action: string
  employeeId: string
  userId: string
  oldValues: Record<string, unknown>
  newValues: Record<string, unknown>
  req: Request
}, db: Pick<typeof pool, 'query'> = pool) {
  await db.query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, 'employee', $3, $4, $5, $6, $7)`,
    [
      params.userId,
      params.action,
      params.employeeId,
      params.oldValues,
      params.newValues,
      params.req.ip,
      params.req.get('user-agent') ?? null,
    ]
  )
}

function roundRate(value: number): number {
  return Math.round(value * 10000) / 10000
}

function calculateRates(monthlySalary: number, workDaysPerMonth: number, workHoursPerDay: number) {
  // The employee rate is derived from the saved work schedule. Explicit employee
  // values win, then selected shift hours, then system defaults, with a final
  // conservative fallback only when no configuration exists.
  const dailyRate = monthlySalary / workDaysPerMonth
  const hourlyRate = dailyRate / workHoursPerDay
  return {
    dailyRate: roundRate(dailyRate),
    hourlyRate: roundRate(hourlyRate),
  }
}

function numberFromSetting(value: unknown): number | null {
  if (value == null) return null
  const normalized = typeof value === 'object' && 'value' in value ? (value as { value?: unknown }).value : value
  const number = Number(normalized)
  return Number.isFinite(number) && number > 0 ? number : null
}

async function getRateDefaults(): Promise<{ workDaysPerMonth: number; workHoursPerDay: number }> {
  const result = await pool.query(
    `SELECT key, value
     FROM system_settings
     WHERE key IN ('work_days_per_month', 'work_hours_per_day')`
  )

  const settings = new Map<string, unknown>(result.rows.map((row) => [String(row.key), row.value]))

  return {
    workDaysPerMonth: numberFromSetting(settings.get('work_days_per_month')) ?? DEFAULT_WORK_DAYS_PER_MONTH,
    workHoursPerDay: numberFromSetting(settings.get('work_hours_per_day')) ?? DEFAULT_WORK_HOURS_PER_DAY,
  }
}

async function assertNoDuplicateEmployeeEmail(email: string): Promise<void> {
  const result = await pool.query(
    `SELECT
       EXISTS (SELECT 1 FROM employees WHERE LOWER(email) = LOWER($1)) AS employee_exists,
       EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)) AS user_exists`,
    [email]
  )

  if (result.rows[0]?.employee_exists || result.rows[0]?.user_exists) {
    throw createError('An employee or user account with that email already exists.', 409)
  }
}

async function validateEmployeeReferences(input: {
  departmentId: string
  positionId: string
  shiftId: string | null
}): Promise<{ shiftWorkHours: number | null }> {
  const errors: ValidationErrors = {}

  const [departmentResult, positionResult, shiftResult] = await Promise.all([
    pool.query('SELECT id FROM departments WHERE id = $1 AND is_active = true', [input.departmentId]),
    pool.query('SELECT id, department_id FROM positions WHERE id = $1 AND is_active = true', [input.positionId]),
    input.shiftId
      ? pool.query('SELECT id, work_hours FROM work_shifts WHERE id = $1 AND is_active = true', [input.shiftId])
      : Promise.resolve({ rows: [] as Array<{ work_hours?: unknown }> }),
  ])

  if (!departmentResult.rows[0]) {
    addFieldError(errors, 'departmentId', 'Department must reference an active department')
  }

  const position = positionResult.rows[0] as { department_id?: string | null } | undefined
  if (!position) {
    addFieldError(errors, 'positionId', 'Position must reference an active position')
  } else if (position.department_id && String(position.department_id) !== input.departmentId) {
    addFieldError(errors, 'positionId', 'Position must belong to the selected department')
  }

  const shift = shiftResult.rows[0] as { work_hours?: unknown } | undefined
  if (input.shiftId && !shift) {
    addFieldError(errors, 'shiftId', 'Shift must reference an active shift')
  }

  if (hasValidationErrors(errors)) throwValidationError(errors)

  return {
    shiftWorkHours: shift ? numberFromSetting(shift.work_hours) : null,
  }
}

async function validateEmployeeUpdateReferences(input: {
  existing: EmployeeRow
  data: EmployeeUpdateData
}): Promise<{ shiftWorkHours: number | null }> {
  const referencesChanged = (
    input.data.department_id !== undefined ||
    input.data.position_id !== undefined ||
    input.data.shift_id !== undefined
  )
  if (!referencesChanged) return { shiftWorkHours: null }

  const departmentId = input.data.department_id ?? input.existing.department_id
  const positionId = input.data.position_id ?? input.existing.position_id
  const shiftId = input.data.shift_id ?? input.existing.shift_id ?? null
  const errors: ValidationErrors = {}

  if (!departmentId) addFieldError(errors, 'departmentId', 'Department is required')
  if (!positionId) addFieldError(errors, 'positionId', 'Position is required')
  if (hasValidationErrors(errors)) throwValidationError(errors)

  return validateEmployeeReferences({
    departmentId: String(departmentId),
    positionId: String(positionId),
    shiftId: shiftId ? String(shiftId) : null,
  })
}

async function applyEmployeeRateUpdates(
  data: EmployeeUpdateData,
  existing: EmployeeRow,
  shiftWorkHours: number | null
): Promise<void> {
  const rateInputsChanged = (
    data.basic_salary !== undefined ||
    data.work_days_per_month !== undefined ||
    data.work_hours_per_day !== undefined
  )
  const shiftChangedWithoutExplicitHours = data.shift_id !== undefined && data.work_hours_per_day === undefined
  if (!rateInputsChanged && !shiftChangedWithoutExplicitHours) return

  const defaults = await getRateDefaults()
  const basicSalary = data.basic_salary !== undefined
    ? Number(data.basic_salary)
    : Number(existing.basic_salary)
  const workDaysPerMonth = data.work_days_per_month !== undefined
    ? Number(data.work_days_per_month)
    : numberFromSetting(existing.work_days_per_month) ?? defaults.workDaysPerMonth
  const workHoursPerDay = data.work_hours_per_day !== undefined
    ? Number(data.work_hours_per_day)
    : shiftWorkHours ?? numberFromSetting(existing.work_hours_per_day) ?? defaults.workHoursPerDay
  const rates = calculateRates(basicSalary, workDaysPerMonth, workHoursPerDay)

  data.basic_salary = basicSalary
  data.work_days_per_month = workDaysPerMonth
  data.work_hours_per_day = workHoursPerDay
  data.daily_rate = rates.dailyRate
  data.hourly_rate = rates.hourlyRate
}

async function normalizeCreateEmployeeInput(body: Record<string, unknown>): Promise<NormalizedEmployeeCreateInput> {
  const errors: ValidationErrors = {}
  const salaryInput = body.basicSalary === undefined ? body.monthlySalary : body.basicSalary

  const firstName = requiredText(body.firstName, 'firstName', 'First name', errors)
  const lastName = requiredText(body.lastName, 'lastName', 'Last name', errors)
  const email = normalizeEmail(body.email, errors)
  const departmentId = requiredUuid(body.departmentId, 'departmentId', 'Department', errors)
  const positionId = requiredUuid(body.positionId, 'positionId', 'Position', errors)
  const shiftId = optionalUuid(body.shiftId, 'shiftId', 'Shift', errors)
  const hireDate = requiredDateValue(body.hireDate, 'hireDate', 'Hire date', errors)
  const basicSalary = requiredPositiveNumber(salaryInput, 'basicSalary', 'Monthly salary', errors)
  const workDaysPerMonth = optionalPositiveInteger(
    body.workDaysPerMonth ?? body.work_days_per_month,
    'workDaysPerMonth',
    'Work days per month',
    errors
  )
  const providedWorkHoursPerDay = optionalPositiveNumber(
    body.workHoursPerDay ?? body.work_hours_per_day,
    'workHoursPerDay',
    'Work hours per day',
    errors
  )

  if (basicSalary > MAX_BASIC_SALARY) {
    addFieldError(errors, 'basicSalary', `Monthly salary must not exceed ${MAX_BASIC_SALARY.toLocaleString('en-US')}`)
  }
  if (workDaysPerMonth != null && workDaysPerMonth > MAX_WORK_DAYS_PER_MONTH) {
    addFieldError(errors, 'workDaysPerMonth', `Work days per month must not exceed ${MAX_WORK_DAYS_PER_MONTH}`)
  }
  if (providedWorkHoursPerDay != null && providedWorkHoursPerDay > MAX_WORK_HOURS_PER_DAY) {
    addFieldError(errors, 'workHoursPerDay', `Work hours per day must not exceed ${MAX_WORK_HOURS_PER_DAY}`)
  }

  const gender = optionalEnum(body.gender, 'gender', 'Gender', GENDER_VALUES, errors)
  const civilStatus = optionalEnum(body.civilStatus, 'civilStatus', 'Civil status', CIVIL_STATUS_VALUES, errors)
  const employmentType = optionalEnum(
    body.employmentType,
    'employmentType',
    'Employment type',
    EMPLOYMENT_TYPE_VALUES,
    errors
  ) ?? 'regular'
  const employeeStatus = optionalEnum(
    body.employeeStatus ?? body.employmentStatus,
    'employeeStatus',
    'Employee status',
    EMPLOYEE_STATUS_VALUES,
    errors
  ) ?? 'active'

  const normalized = {
    firstName,
    middleName: optionalText(body.middleName),
    lastName,
    email,
    phone: optionalText(body.phone),
    birthDate: optionalDateValue(body.birthDate, 'birthDate', 'Birth date', errors),
    gender,
    civilStatus,
    address: optionalText(body.address),
    city: optionalText(body.city),
    province: optionalText(body.province),
    zipCode: optionalText(body.zipCode),
    departmentId,
    positionId,
    shiftId,
    employmentType,
    employeeStatus,
    hireDate,
    basicSalary,
    workDaysPerMonth,
    providedWorkHoursPerDay,
    sssNumber: optionalGovernmentIdValue(body.sssNumber, 'sssNumber', 'SSS Number', errors),
    philhealthNumber: optionalGovernmentIdValue(body.philhealthNumber, 'philhealthNumber', 'PhilHealth Number', errors),
    pagibigNumber: optionalGovernmentIdValue(body.pagibigNumber, 'pagibigNumber', 'Pag-IBIG Number', errors),
    tinNumber: optionalGovernmentIdValue(body.tinNumber, 'tinNumber', 'TIN Number', errors),
    bankName: optionalText(body.bankName),
    bankAccountNumber: optionalText(body.bankAccountNumber),
  }

  if (hasValidationErrors(errors)) throwValidationError(errors)

  const [{ shiftWorkHours }, rateDefaults] = await Promise.all([
    validateEmployeeReferences({ departmentId, positionId, shiftId }),
    getRateDefaults(),
  ])
  await assertNoDuplicateEmployeeEmail(email)

  const finalWorkDaysPerMonth = workDaysPerMonth ?? rateDefaults.workDaysPerMonth
  const finalWorkHoursPerDay = providedWorkHoursPerDay ?? shiftWorkHours ?? rateDefaults.workHoursPerDay

  if (!Number.isFinite(finalWorkDaysPerMonth) || finalWorkDaysPerMonth <= 0) {
    addFieldError(errors, 'workDaysPerMonth', 'Work days per month must be greater than 0')
  } else if (!Number.isInteger(finalWorkDaysPerMonth)) {
    addFieldError(errors, 'workDaysPerMonth', 'Work days per month must be a whole number')
  } else if (finalWorkDaysPerMonth > MAX_WORK_DAYS_PER_MONTH) {
    addFieldError(errors, 'workDaysPerMonth', `Work days per month must not exceed ${MAX_WORK_DAYS_PER_MONTH}`)
  }
  if (!Number.isFinite(finalWorkHoursPerDay) || finalWorkHoursPerDay <= 0) {
    addFieldError(errors, 'workHoursPerDay', 'Work hours per day must be greater than 0')
  } else if (finalWorkHoursPerDay > MAX_WORK_HOURS_PER_DAY) {
    addFieldError(errors, 'workHoursPerDay', `Work hours per day must not exceed ${MAX_WORK_HOURS_PER_DAY}`)
  }
  if (hasValidationErrors(errors)) throwValidationError(errors)

  const rates = calculateRates(basicSalary, finalWorkDaysPerMonth, finalWorkHoursPerDay)

  return {
    ...normalized,
    workDaysPerMonth: finalWorkDaysPerMonth,
    workHoursPerDay: finalWorkHoursPerDay,
    dailyRate: rates.dailyRate,
    hourlyRate: rates.hourlyRate,
  }
}

function isEmployeeNumberDuplicateError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'constraint' in error &&
    error.code === '23505' &&
    error.constraint === 'employees_employee_number_key'
  )
}

function isPgError(error: unknown): error is PgError {
  return typeof error === 'object' && error !== null && 'code' in error
}

function isDuplicateEmailError(error: unknown): boolean {
  return (
    isPgError(error) &&
    error.code === '23505' &&
    (error.constraint?.includes('email') ?? false)
  )
}

function isDuplicateEmployeeNumberError(error: unknown): boolean {
  return (
    isPgError(error) &&
    error.code === '23505' &&
    error.constraint === 'employees_employee_number_key'
  )
}

function toEmployeeWriteError(error: unknown): Error {
  if (isDuplicateEmailError(error)) {
    return createError('An employee or user account with that email already exists.', 409)
  }

  if (isDuplicateEmployeeNumberError(error)) {
    return createError('An employee with that employee number already exists. Please try again.', 409)
  }

  if (isPgError(error)) {
    if (error.code === '22P02') {
      if (error.message.includes('uuid')) {
        return createError('One of the submitted IDs is not a valid UUID.', 400)
      }
      if (error.message.includes('enum')) {
        return createError('One of the submitted employee option values is invalid.', 400)
      }
      return createError('One of the submitted employee values is invalid.', 400)
    }

    if (error.code === '22007' || error.code === '22008') {
      return createError('One of the submitted dates is invalid.', 400)
    }

    if (error.code === '23503') {
      const constraint = error.constraint ?? ''
      if (constraint.includes('department_id')) {
        return createError('Department must reference an existing department.', 400)
      }
      if (constraint.includes('position_id')) {
        return createError('Position must reference an existing position.', 400)
      }
      if (constraint.includes('shift_id')) {
        return createError('Shift must reference an existing shift.', 400)
      }
      return createError('One of the submitted employee references does not exist.', 400)
    }

    if (error.code === '23505') {
      return createError('A duplicate employee record already exists.', 409)
    }

    if (error.code === '42703') {
      logger.error('Employee creation failed because the database schema is out of date', {
        code: error.code,
        column: error.column,
        table: error.table,
        constraint: error.constraint,
      })
      return createError('Database schema is out of date. Please run the latest migrations and try again.', 500)
    }
  }

  return error instanceof Error ? error : createError('Unable to create employee account', 500)
}

function createActivationToken() {
  const token = crypto.randomBytes(32).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + ACTIVATION_EXPIRES_HOURS * 60 * 60 * 1000)
  return { token, tokenHash, expiresAt }
}

async function sendEmployeeActivationLink(employee: Pick<EmployeeRow, 'first_name' | 'last_name' | 'email'>, token: string) {
  const activationLink = buildClientUrl('/account/activate', { token })
  try {
    const delivery = await sendActivationEmail({
      to: employee.email,
      name: `${employee.first_name} ${employee.last_name}`.trim(),
      activationLink,
      expiresHours: ACTIVATION_EXPIRES_HOURS,
    })
    return { activationLink, delivery }
  } catch (error) {
    logger.error('Unable to send activation email', {
      employeeEmail: employee.email,
      error,
    })
    throw createError(
      'Activation email could not be sent. Check email provider settings, then try again.',
      502
    )
  }
}

async function saveActivationEmailTracking(userId: string, delivery: EmailDeliveryMetadata): Promise<boolean> {
  try {
    await pool.query(
      `UPDATE users
       SET activation_sent_at = $1,
           activation_email_sent_at = $1,
           activation_email_message_id = $2,
           activation_email_provider = $3,
           activation_email_status = 'sent',
           updated_at = NOW()
       WHERE id = $4`,
      [delivery.sentAt, delivery.messageId ?? null, delivery.provider, userId]
    )
    return true
  } catch (error) {
    logger.error('Activation email was sent, but delivery tracking could not be saved', {
      userId,
      messageId: delivery.messageId,
      error,
    })

    if (isPgError(error) && error.code === '42703') {
      try {
        await pool.query(
          `UPDATE users
           SET activation_sent_at = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [delivery.sentAt, userId]
        )
        return false
      } catch (fallbackError) {
        logger.error('Fallback activation_sent_at tracking update also failed', {
          userId,
          error: fallbackError,
        })
      }
    }

    return false
  }
}

async function markActivationEmailFailed(userId: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE users
       SET activation_email_provider = 'resend',
           activation_email_status = 'failed',
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    )
  } catch (error) {
    logger.error('Activation email failure status could not be saved', {
      userId,
      error,
    })
  }
}

export const listEmployees = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20)

  const result = await EmployeeModel.findAll({
    page,
    limit,
    search: req.query.search as string | undefined,
    departmentId: req.query.departmentId as string | undefined,
    status: req.query.status as string | undefined,
    includeArchived: boolFromQuery(req.query.includeArchived),
    includeFormer: boolFromQuery(req.query.includeFormer) || boolFromQuery(req.query.includeArchived),
  })

  res.json({
    success: true,
    data: result.data,
    total: result.total,
    page,
    limit,
    totalPages: Math.ceil(result.total / limit),
  })
})

export const getEmployee = asyncHandler(async (req: Request, res: Response) => {
  const employee = await EmployeeModel.findById(req.params.id)
  if (!employee) throw createError('Employee not found', 404)
  res.json({ success: true, data: employee })
})

export const createEmployee = asyncHandler(async (req: Request, res: Response) => {
  const input = await normalizeCreateEmployeeInput(req.body as Record<string, unknown>)

  const client = await pool.connect()
  let employee: EmployeeRow | undefined
  let userId: string | undefined
  const activation = createActivationToken()
  let activationLink = ''
  let activationEmailSent = false
  let activationEmailTrackingSaved = false
  try {
    await client.query('BEGIN')

    for (let attempt = 1; attempt <= 3; attempt++) {
      const employeeNumber = await EmployeeModel.generateEmployeeNumber(client)

      try {
        await client.query('SAVEPOINT employee_number_attempt')
        employee = await EmployeeModel.create({
          employee_number: employeeNumber,
          first_name: input.firstName,
          middle_name: input.middleName,
          last_name: input.lastName,
          email: input.email,
          phone: input.phone,
          birth_date: input.birthDate,
          gender: input.gender,
          civil_status: input.civilStatus,
          address: input.address,
          city: input.city,
          province: input.province,
          zip_code: input.zipCode,
          department_id: input.departmentId,
          position_id: input.positionId,
          shift_id: input.shiftId,
          employment_type: input.employmentType,
          employment_status: input.employeeStatus,
          hire_date: input.hireDate,
          basic_salary: input.basicSalary,
          daily_rate: input.dailyRate,
          hourly_rate: input.hourlyRate,
          work_days_per_month: input.workDaysPerMonth,
          work_hours_per_day: input.workHoursPerDay,
          sss_number: input.sssNumber,
          philhealth_number: input.philhealthNumber,
          pagibig_number: input.pagibigNumber,
          tin_number: input.tinNumber,
          bank_name: input.bankName,
          bank_account_number: input.bankAccountNumber,
        }, client)
        await client.query('RELEASE SAVEPOINT employee_number_attempt')
        break
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT employee_number_attempt')
        if (attempt === 3 || !isEmployeeNumberDuplicateError(error)) throw error
      }
    }

    if (!employee) throw createError('Unable to generate a unique employee number', 500)

    const userResult = await client.query(
      `INSERT INTO users (
         employee_id, email, password_hash, role, is_active,
         activation_token_hash, activation_token_expires_at
       )
       VALUES ($1, $2, NULL, 'employee', false, $3, $4)
       RETURNING id`,
      [employee.id, employee.email, activation.tokenHash, activation.expiresAt]
    )
    userId = userResult.rows[0]?.id

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw toEmployeeWriteError(error)
  } finally {
    client.release()
  }

  if (!employee || !userId) throw createError('Unable to create employee account', 500)

  try {
    const delivery = await sendEmployeeActivationLink(employee, activation.token)
    activationLink = delivery.activationLink
    activationEmailSent = true
    activationEmailTrackingSaved = await saveActivationEmailTracking(userId, delivery.delivery)
  } catch (error) {
    await markActivationEmailFailed(userId)
    logger.error('Employee account was created, but activation email delivery failed', {
      employeeId: employee.id,
      userId,
      employeeEmail: employee.email,
      error,
    })
  }

  res.status(201).json({
    success: true,
    data: employee,
    message: activationEmailSent
      ? `Employee account created. Activation email sent to ${employee.email}.`
      : `Employee account created, but activation email could not be sent to ${employee.email}. Use resend activation after checking email provider settings.`,
    activationEmailSent,
    activationEmailTrackingSaved,
    ...(process.env.NODE_ENV !== 'production' ? { activationLink } : {}),
  })
})

export const resendEmployeeActivation = asyncHandler(async (req: Request, res: Response) => {
  const client = await pool.connect()
  const activation = createActivationToken()
  let account: {
    user_id: string
    activated_at: Date | null
    password_hash: string | null
    first_name: string
    last_name: string
    email: string
    employment_status: string
    is_deleted: boolean
  } | undefined
  let activationLink = ''
  let activationEmailTrackingSaved = false

  try {
    await client.query('BEGIN')

    const result = await client.query(
      `SELECT u.id AS user_id, u.activated_at, u.password_hash,
              e.first_name, e.last_name, e.email, e.employment_status, e.is_deleted
       FROM employees e
       JOIN users u ON u.employee_id = e.id
       WHERE e.id = $1 AND u.role = 'employee'
       FOR UPDATE OF u`,
      [req.params.id]
    )

    account = result.rows[0]
    if (!account) throw createError('Employee account not found', 404)
    if (account.is_deleted || account.employment_status !== 'active') {
      throw createError('Activation cannot be resent for inactive, separated, or archived employees.', 400)
    }
    if (account.activated_at || account.password_hash) throw createError('Employee account is already activated', 400)

    await client.query(
      `UPDATE users
       SET activation_token_hash = $1,
           activation_token_expires_at = $2,
           activation_sent_at = NULL,
           is_active = false,
           updated_at = NOW()
       WHERE id = $3`,
      [activation.tokenHash, activation.expiresAt, account.user_id]
    )

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw toEmployeeWriteError(error)
  } finally {
    client.release()
  }

  if (!account) throw createError('Employee account not found', 404)

  try {
    const delivery = await sendEmployeeActivationLink({
      first_name: account.first_name,
      last_name: account.last_name,
      email: account.email,
    }, activation.token)
    activationLink = delivery.activationLink
    activationEmailTrackingSaved = await saveActivationEmailTracking(account.user_id, delivery.delivery)
  } catch (error) {
    await markActivationEmailFailed(account.user_id)
    throw error
  }

  res.json({
    success: true,
    message: `Activation email sent to ${account.email}.`,
    activationEmailSent: true,
    activationEmailTrackingSaved,
    ...(process.env.NODE_ENV !== 'production' ? { activationLink } : {}),
  })
})

export const updateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const existing = await EmployeeModel.findById(req.params.id)
  if (!existing) throw createError('Employee not found', 404)

  const body = (req.body ?? {}) as Record<string, unknown>
  const errors: ValidationErrors = {}
  const salaryInput = body.basicSalary === undefined ? body.monthlySalary ?? body.basic_salary : body.basicSalary
  const workDaysInput = body.workDaysPerMonth === undefined ? body.work_days_per_month : body.workDaysPerMonth
  const workHoursInput = body.workHoursPerDay === undefined ? body.work_hours_per_day : body.workHoursPerDay
  const basicSalary = updatePositiveNumber(salaryInput, 'basicSalary', 'Monthly salary', errors)
  const workDaysPerMonth = updatePositiveInteger(workDaysInput, 'workDaysPerMonth', 'Work days per month', errors)
  const workHoursPerDay = updatePositiveNumber(workHoursInput, 'workHoursPerDay', 'Work hours per day', errors)

  if (basicSalary !== undefined && basicSalary > MAX_BASIC_SALARY) {
    addFieldError(errors, 'basicSalary', `Monthly salary must not exceed ${MAX_BASIC_SALARY.toLocaleString('en-US')}`)
  }
  if (workDaysPerMonth !== undefined && workDaysPerMonth > MAX_WORK_DAYS_PER_MONTH) {
    addFieldError(errors, 'workDaysPerMonth', `Work days per month must not exceed ${MAX_WORK_DAYS_PER_MONTH}`)
  }
  if (workHoursPerDay !== undefined && workHoursPerDay > MAX_WORK_HOURS_PER_DAY) {
    addFieldError(errors, 'workHoursPerDay', `Work hours per day must not exceed ${MAX_WORK_HOURS_PER_DAY}`)
  }
  if (hasValidationErrors(errors)) throwValidationError(errors)

  const data = {
    first_name: body.firstName,
    middle_name: body.middleName,
    last_name: body.lastName,
    email: body.email,
    phone: emptyToNullIfPresent(body.phone),
    birth_date: emptyToNullIfPresent(body.birthDate),
    gender: body.gender,
    civil_status: body.civilStatus,
    address: emptyToNullIfPresent(body.address),
    city: emptyToNullIfPresent(body.city),
    province: emptyToNullIfPresent(body.province),
    zip_code: emptyToNullIfPresent(body.zipCode),
    department_id: emptyToNullIfPresent(body.departmentId),
    position_id: emptyToNullIfPresent(body.positionId),
    employment_type: body.employmentType,
    hire_date: body.hireDate === undefined ? undefined : requiredDate(body.hireDate, 'hireDate'),
    basic_salary: basicSalary,
    work_days_per_month: workDaysPerMonth,
    work_hours_per_day: workHoursPerDay,
    sss_number: optionalGovernmentIdIfPresent(body.sssNumber, 'SSS Number'),
    philhealth_number: optionalGovernmentIdIfPresent(body.philhealthNumber, 'PhilHealth Number'),
    pagibig_number: optionalGovernmentIdIfPresent(body.pagibigNumber, 'Pag-IBIG Number'),
    tin_number: optionalGovernmentIdIfPresent(body.tinNumber, 'TIN Number'),
    bank_name: emptyToNullIfPresent(body.bankName),
    bank_account_number: emptyToNullIfPresent(body.bankAccountNumber),
    shift_id: emptyToNullIfPresent(body.shiftId),
  }
  const sanitized = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
  const shiftValidation = await validateEmployeeUpdateReferences({
    existing,
    data: sanitized as EmployeeUpdateData,
  })
  await applyEmployeeRateUpdates(sanitized as EmployeeUpdateData, existing, shiftValidation.shiftWorkHours)

  if (Object.keys(sanitized).length > 0) {
    await EmployeeModel.update(req.params.id, sanitized as EmployeeUpdateData)
  }
  const updated = await EmployeeModel.findById(req.params.id)
  res.json({ success: true, data: updated })
})

export const deactivateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const status = normalizeSeparationStatus(body.status ?? body.employeeStatus, 'inactive')
  const reason = emptyToNull(body.reasonForLeaving ?? body.reason) ?? 'Archived employee account'
  const remarks = emptyToNull(body.remarks)
  const lastWorkingDay = optionalDate(body.lastWorkingDay, 'lastWorkingDay')
  const separationDate = optionalDate(body.separationDate, 'separationDate') ?? lastWorkingDay

  const client = await pool.connect()
  let updated: EmployeeRow | undefined
  let oldValues: Record<string, unknown> | undefined
  try {
    await client.query('BEGIN')

    const existing = await client.query(
      `SELECT *
       FROM employees
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id]
    )
    const employee = existing.rows[0] as EmployeeRow | undefined
    if (!employee) throw createError('Employee not found', 404)

    oldValues = {
      employment_status: employee.employment_status,
      is_deleted: employee.is_deleted,
      deleted_at: employee.deleted_at,
      deleted_by: employee.deleted_by,
      last_working_day: employee.last_working_day,
      separation_date: employee.separation_date,
      separation_reason: employee.separation_reason,
      separation_remarks: employee.separation_remarks,
    }

    const archiveResult = await client.query(
      `UPDATE employees
       SET employment_status = $2,
           last_working_day = COALESCE($3, last_working_day),
           separation_date = COALESCE($4, separation_date),
           separation_reason = COALESCE($5, separation_reason),
           separation_remarks = COALESCE($6, separation_remarks),
           separation_processed_by = $7,
           separation_processed_at = NOW(),
           is_deleted = true,
           deleted_at = NOW(),
           deleted_by = $7,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, status, lastWorkingDay, separationDate, reason, remarks, req.user!.userId]
    )
    updated = archiveResult.rows[0]

    await client.query(
      `UPDATE users
       SET is_active = false,
           refresh_token_hash = NULL,
           activation_token_hash = NULL,
           activation_token_expires_at = NULL,
           password_reset_token_hash = NULL,
           password_reset_token_expires_at = NULL,
           updated_at = NOW()
       WHERE employee_id = $1`,
      [req.params.id]
    )

    await insertEmployeeAuditLog({
      action: 'employee_archived',
      employeeId: req.params.id,
      userId: req.user!.userId,
      oldValues,
      newValues: {
        employment_status: status,
        is_deleted: true,
        reason,
        remarks,
        last_working_day: lastWorkingDay,
        separation_date: separationDate,
      },
      req,
    }, client)

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  updated = await EmployeeModel.findById(req.params.id)
  res.json({
    success: true,
    data: updated,
    message: 'Employee archived. Login access has been disabled and history remains available for audit.',
  })
})

export const activateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const client = await pool.connect()
  let updated: EmployeeRow | undefined
  let oldValues: Record<string, unknown> | undefined
  let loginAccessRestored = false
  let activationRequired = false
  try {
    await client.query('BEGIN')

    const existing = await client.query(
      `SELECT *
       FROM employees
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id]
    )
    const employee = existing.rows[0] as EmployeeRow | undefined
    if (!employee) throw createError('Employee not found', 404)

    oldValues = {
      employment_status: employee.employment_status,
      is_deleted: employee.is_deleted,
      deleted_at: employee.deleted_at,
      deleted_by: employee.deleted_by,
      last_working_day: employee.last_working_day,
      separation_date: employee.separation_date,
      separation_reason: employee.separation_reason,
      separation_remarks: employee.separation_remarks,
    }

    const result = await client.query(
      `UPDATE employees
       SET employment_status = 'active',
           is_deleted = false,
           deleted_at = NULL,
           deleted_by = NULL,
           last_working_day = NULL,
           separation_date = NULL,
           separation_reason = NULL,
           separation_remarks = NULL,
           separation_processed_by = $2,
           separation_processed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, req.user!.userId]
    )
    updated = result.rows[0]

    const userResult = await client.query(
      `WITH existing_users AS (
         SELECT id, password_hash, is_active
         FROM users
         WHERE employee_id = $1
       ),
       updated_users AS (
         UPDATE users u
         SET is_active = u.password_hash IS NOT NULL,
             refresh_token_hash = NULL,
             updated_at = NOW()
         FROM existing_users eu
         WHERE u.id = eu.id
         RETURNING u.password_hash IS NOT NULL AS has_password,
                   u.is_active,
                   eu.is_active AS was_active
       )
       SELECT has_password, is_active, was_active
       FROM updated_users`,
      [req.params.id]
    )
    const userRows = userResult.rows as Array<{
      has_password: boolean
      is_active: boolean
      was_active: boolean
    }>
    loginAccessRestored = userRows.some((row) => row.has_password && row.is_active && !row.was_active)
    activationRequired = userRows.some((row) => !row.has_password)

    await insertEmployeeAuditLog({
      action: 'employee_reactivated',
      employeeId: req.params.id,
      userId: req.user!.userId,
      oldValues,
      newValues: { employment_status: 'active', is_deleted: false },
      req,
    }, client)

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  updated = await EmployeeModel.findById(req.params.id)
  res.json({
    success: true,
    data: updated,
    message: 'Employee reactivated.',
    loginAccessRestored,
    activationRequired,
  })
})

export const separateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const status = normalizeSeparationStatus(body.status ?? body.employeeStatus, 'resigned')
  const lastWorkingDay = requiredDate(body.lastWorkingDay, 'lastWorkingDay')
  const separationDate = requiredDate(body.separationDate, 'separationDate')
  const reason = requireSeparationText(body.reasonForLeaving ?? body.reason, 'reasonForLeaving')
  const remarks = emptyToNull(body.remarks)

  const client = await pool.connect()
  let updated: EmployeeRow | undefined
  let oldValues: Record<string, unknown> | undefined
  try {
    await client.query('BEGIN')

    const existing = await client.query(
      `SELECT *
       FROM employees
       WHERE id = $1
       FOR UPDATE`,
      [req.params.id]
    )
    const employee = existing.rows[0] as EmployeeRow | undefined
    if (!employee) throw createError('Employee not found', 404)

    oldValues = {
      employment_status: employee.employment_status,
      is_deleted: employee.is_deleted,
      last_working_day: employee.last_working_day,
      separation_date: employee.separation_date,
      separation_reason: employee.separation_reason,
      separation_remarks: employee.separation_remarks,
    }

    const result = await client.query(
      `UPDATE employees
       SET employment_status = $2,
           last_working_day = $3,
           separation_date = $4,
           separation_reason = $5,
           separation_remarks = $6,
           separation_processed_by = $7,
           separation_processed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, status, lastWorkingDay, separationDate, reason, remarks, req.user!.userId]
    )
    updated = result.rows[0]

    await client.query(
      `UPDATE users
       SET is_active = false,
           refresh_token_hash = NULL,
           activation_token_hash = NULL,
           activation_token_expires_at = NULL,
           password_reset_token_hash = NULL,
           password_reset_token_expires_at = NULL,
           updated_at = NOW()
       WHERE employee_id = $1`,
      [req.params.id]
    )

    await insertEmployeeAuditLog({
      action: 'employee_separated',
      employeeId: req.params.id,
      userId: req.user!.userId,
      oldValues,
      newValues: {
        employment_status: status,
        last_working_day: lastWorkingDay,
        separation_date: separationDate,
        separation_reason: reason,
        separation_remarks: remarks,
      },
      req,
    }, client)

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  updated = await EmployeeModel.findById(req.params.id)
  res.json({
    success: true,
    data: updated,
    message: 'Employee offboarding recorded. Login access has been disabled and payroll history remains available.',
  })
})

export const permanentlyDeleteEmployee = asyncHandler(async (req: Request, res: Response) => {
  const employee = await EmployeeModel.findById(req.params.id)
  if (!employee) throw createError('Employee not found', 404)

  const counts = await employeeHistoryCounts(req.params.id)
  if (hasProtectedHistory(counts)) {
    const error = createError(
      'Permanent deletion is blocked because this employee has payroll, attendance, leave, loan, or other employee history. Archive the employee instead.',
      409
    )
    error.details = { historyCounts: counts }
    throw error
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM users WHERE employee_id = $1', [req.params.id])
    await client.query('DELETE FROM employees WHERE id = $1', [req.params.id])
    await insertEmployeeAuditLog({
      action: 'employee_permanently_deleted',
      employeeId: req.params.id,
      userId: req.user!.userId,
      oldValues: employee as unknown as Record<string, unknown>,
      newValues: {},
      req,
    }, client)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  res.json({ success: true, message: 'Employee permanently deleted.' })
})
