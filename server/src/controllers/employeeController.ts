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
const EMPLOYEE_STATUS_VALUES = ['active', 'inactive', 'terminated', 'resigned'] as const

type GenderValue = typeof GENDER_VALUES[number]
type CivilStatusValue = typeof CIVIL_STATUS_VALUES[number]
type EmploymentTypeValue = typeof EMPLOYMENT_TYPE_VALUES[number]
type EmployeeStatusValue = typeof EMPLOYEE_STATUS_VALUES[number]

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
  } | undefined
  let activationLink = ''
  let activationEmailTrackingSaved = false

  try {
    await client.query('BEGIN')

    const result = await client.query(
      `SELECT u.id AS user_id, u.activated_at, u.password_hash,
              e.first_name, e.last_name, e.email
       FROM employees e
       JOIN users u ON u.employee_id = e.id
       WHERE e.id = $1 AND u.role = 'employee'
       FOR UPDATE OF u`,
      [req.params.id]
    )

    account = result.rows[0]
    if (!account) throw createError('Employee account not found', 404)
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

  const body = req.body
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
    basic_salary: body.basicSalary,
    sss_number: optionalGovernmentIdIfPresent(body.sssNumber, 'SSS Number'),
    philhealth_number: optionalGovernmentIdIfPresent(body.philhealthNumber, 'PhilHealth Number'),
    pagibig_number: optionalGovernmentIdIfPresent(body.pagibigNumber, 'Pag-IBIG Number'),
    tin_number: optionalGovernmentIdIfPresent(body.tinNumber, 'TIN Number'),
    bank_name: emptyToNullIfPresent(body.bankName),
    bank_account_number: emptyToNullIfPresent(body.bankAccountNumber),
    shift_id: emptyToNullIfPresent(body.shiftId),
  }
  const sanitized = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
  const updated = await EmployeeModel.update(req.params.id, sanitized as never)
  res.json({ success: true, data: updated })
})

export const deactivateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const employee = await EmployeeModel.findById(req.params.id)
  if (!employee) throw createError('Employee not found', 404)

  const updated = await EmployeeModel.update(req.params.id, {
    employment_status: 'inactive',
  } as never)
  res.json({ success: true, data: updated })
})

export const activateEmployee = asyncHandler(async (req: Request, res: Response) => {
  const employee = await EmployeeModel.findById(req.params.id)
  if (!employee) throw createError('Employee not found', 404)

  const updated = await EmployeeModel.update(req.params.id, {
    employment_status: 'active',
  } as never)
  res.json({ success: true, data: updated })
})
