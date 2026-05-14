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
}

function positiveIntegerEnv(name: string, fallback: number, minimum: number): number {
  const rawValue = process.env[name]
  const parsed = rawValue == null || rawValue.trim() === '' ? fallback : Number(rawValue)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback
}

const ACTIVATION_EXPIRES_HOURS = positiveIntegerEnv('ACCOUNT_ACTIVATION_EXPIRES_HOURS', 72, 1)

function emptyToNull(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

function emptyToNullIfPresent(value: unknown): string | null | undefined {
  return value === undefined ? undefined : emptyToNull(value)
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
  return date
}

function optionalNumber(value: unknown): number | null {
  if (value === '' || value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
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

function toEmployeeWriteError(error: unknown): Error {
  if (isDuplicateEmailError(error)) {
    return createError('An employee or user account with that email already exists.', 409)
  }

  if (isPgError(error) && error.code === '42703') {
    logger.error('Employee creation failed because the database schema is out of date', {
      code: error.code,
      column: error.column,
      table: error.table,
      constraint: error.constraint,
    })
    return createError('Database schema is out of date. Please run the latest migrations and try again.', 500)
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
  const {
    firstName, middleName, lastName, email, phone,
    birthDate, gender, civilStatus,
    address, city, province, zipCode,
    departmentId, positionId, employmentType, hireDate,
    basicSalary, sssNumber, philhealthNumber, pagibigNumber, tinNumber,
    bankName, bankAccountNumber, shiftId,
  } = req.body

  const salary = optionalNumber(basicSalary)
  const normalizedHireDate = requiredDate(hireDate, 'hireDate')

  if (!firstName || !lastName || !email || salary == null) {
    throw createError('firstName, lastName, email, hireDate, and basicSalary are required', 400)
  }

  const dailyRate = salary / 22
  const hourlyRate = dailyRate / 8

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
          first_name: emptyToNull(firstName) ?? '',
          middle_name: emptyToNull(middleName),
          last_name: emptyToNull(lastName) ?? '',
          email: emptyToNull(email) ?? '',
          phone: emptyToNull(phone),
          birth_date: emptyToNull(birthDate),
          gender,
          civil_status: civilStatus,
          address: emptyToNull(address),
          city: emptyToNull(city),
          province: emptyToNull(province),
          zip_code: emptyToNull(zipCode),
          department_id: emptyToNull(departmentId),
          position_id: emptyToNull(positionId),
          employment_type: employmentType || 'regular',
          hire_date: normalizedHireDate,
          basic_salary: salary,
          daily_rate: Math.round(dailyRate * 100) / 100,
          hourly_rate: Math.round(hourlyRate * 100) / 100,
          sss_number: optionalGovernmentId(sssNumber, 'SSS Number'),
          philhealth_number: optionalGovernmentId(philhealthNumber, 'PhilHealth Number'),
          pagibig_number: optionalGovernmentId(pagibigNumber, 'Pag-IBIG Number'),
          tin_number: optionalGovernmentId(tinNumber, 'TIN Number'),
          bank_name: emptyToNull(bankName),
          bank_account_number: emptyToNull(bankAccountNumber),
          shift_id: emptyToNull(shiftId),
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
