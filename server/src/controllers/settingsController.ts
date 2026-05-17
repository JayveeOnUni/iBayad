import { Request, Response } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import {
  getGeneralSettings,
  getPayrollSettings,
  updateGeneralSettings,
  updatePayrollSettings,
  type GeneralSettingsInput,
  type PayrollSettingsInput,
  type PayFrequency,
} from '../services/settingsService'

type ValidationErrors = Record<string, string[]>

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const maxLengths: Record<keyof GeneralSettingsInput, number> = {
  companyName: 150,
  address: 255,
  city: 100,
  province: 100,
  zipCode: 20,
  phone: 50,
  email: 150,
  tin: 50,
  sssEmployerNumber: 50,
  philhealthEmployerNumber: 50,
  pagibigEmployerNumber: 50,
}

function addFieldError(errors: ValidationErrors, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message]
}

function throwValidationError(errors: ValidationErrors): never {
  const error = createError('General settings contain invalid values.', 400)
  error.details = { errors }
  throw error
}

function throwPayrollValidationError(errors: ValidationErrors): never {
  const error = createError('Payroll settings contain invalid values.', 400)
  error.details = { errors }
  throw error
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function validateGeneralSettingsPayload(body: Record<string, unknown>): GeneralSettingsInput {
  const errors: ValidationErrors = {}
  const input: GeneralSettingsInput = {
    companyName: normalizeString(body.companyName),
    address: normalizeString(body.address),
    city: normalizeString(body.city),
    province: normalizeString(body.province),
    zipCode: normalizeString(body.zipCode),
    phone: normalizeString(body.phone),
    email: normalizeString(body.email),
    tin: normalizeString(body.tin),
    sssEmployerNumber: normalizeString(body.sssEmployerNumber),
    philhealthEmployerNumber: normalizeString(body.philhealthEmployerNumber),
    pagibigEmployerNumber: normalizeString(body.pagibigEmployerNumber),
  }

  if (!input.companyName) addFieldError(errors, 'companyName', 'Company name is required')
  if (!input.address) addFieldError(errors, 'address', 'Address is required')
  if (input.email && !emailPattern.test(input.email)) addFieldError(errors, 'email', 'Enter a valid email address')

  for (const [field, maxLength] of Object.entries(maxLengths) as Array<[keyof GeneralSettingsInput, number]>) {
    if (input[field].length > maxLength) {
      addFieldError(errors, field, `${field} must be ${maxLength} characters or fewer`)
    }
  }

  if (Object.keys(errors).length > 0) throwValidationError(errors)

  return input
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return Boolean(value)
}

function validateWholeNumberRange(
  errors: ValidationErrors,
  field: keyof PayrollSettingsInput,
  value: number,
  min: number,
  max: number,
  label: string
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    addFieldError(errors, field, `${label} must be a whole number from ${min} to ${max}`)
  }
}

function validatePayrollSettingsPayload(body: Record<string, unknown>): PayrollSettingsInput {
  const errors: ValidationErrors = {}
  const payFrequency = body.payFrequency
  const input: PayrollSettingsInput = {
    payFrequency: payFrequency === 'weekly' || payFrequency === 'semi-monthly' || payFrequency === 'monthly'
      ? payFrequency as PayFrequency
      : 'semi-monthly',
    semiMonthlyCutoff1: normalizeNumber(body.semiMonthlyCutoff1),
    semiMonthlyCutoff2: normalizeNumber(body.semiMonthlyCutoff2),
    semiMonthlyPayDay1: normalizeNumber(body.semiMonthlyPayDay1),
    semiMonthlyPayDay2: normalizeNumber(body.semiMonthlyPayDay2),
    workingHoursPerDay: normalizeNumber(body.workingHoursPerDay),
    workingDaysPerWeek: normalizeNumber(body.workingDaysPerWeek),
    workDaysPerMonth: normalizeNumber(body.workDaysPerMonth),
    offsetCreditEnabled: normalizeBoolean(body.offsetCreditEnabled),
    offsetRequiresApproval: normalizeBoolean(body.offsetRequiresApproval),
    minimumOffsetCreditMinutes: normalizeNumber(body.minimumOffsetCreditMinutes),
    nightDifferentialEnabled: normalizeBoolean(body.nightDifferentialEnabled),
    regularHolidayRate: normalizeNumber(body.regularHolidayRate),
    specialHolidayRate: normalizeNumber(body.specialHolidayRate),
    thirteenthMonthEnabled: normalizeBoolean(body.thirteenthMonthEnabled),
  }

  if (payFrequency !== 'weekly' && payFrequency !== 'semi-monthly' && payFrequency !== 'monthly') {
    addFieldError(errors, 'payFrequency', 'Pay frequency must be weekly, semi-monthly, or monthly')
  }

  validateWholeNumberRange(errors, 'semiMonthlyCutoff1', input.semiMonthlyCutoff1, 1, 31, 'First cutoff day')
  validateWholeNumberRange(errors, 'semiMonthlyCutoff2', input.semiMonthlyCutoff2, 1, 31, 'Second cutoff day')
  validateWholeNumberRange(errors, 'semiMonthlyPayDay1', input.semiMonthlyPayDay1, 1, 31, 'First pay day')
  validateWholeNumberRange(errors, 'semiMonthlyPayDay2', input.semiMonthlyPayDay2, 1, 31, 'Second pay day')
  if (
    Number.isInteger(input.semiMonthlyCutoff1) &&
    Number.isInteger(input.semiMonthlyCutoff2) &&
    input.semiMonthlyCutoff1 >= input.semiMonthlyCutoff2
  ) {
    addFieldError(errors, 'semiMonthlyCutoff1', 'First cutoff day must be less than second cutoff day')
  }

  if (!Number.isFinite(input.workingHoursPerDay) || input.workingHoursPerDay <= 0 || input.workingHoursPerDay > 24) {
    addFieldError(errors, 'workingHoursPerDay', 'Working hours per day must be greater than 0 and no more than 24')
  }
  validateWholeNumberRange(errors, 'workingDaysPerWeek', input.workingDaysPerWeek, 1, 7, 'Working days per week')
  validateWholeNumberRange(errors, 'workDaysPerMonth', input.workDaysPerMonth, 1, 31, 'Work days per month')
  if (!Number.isInteger(input.minimumOffsetCreditMinutes) || input.minimumOffsetCreditMinutes < 0) {
    addFieldError(errors, 'minimumOffsetCreditMinutes', 'Minimum offset credit minutes must be a non-negative whole number')
  }
  if (!Number.isFinite(input.regularHolidayRate) || input.regularHolidayRate <= 0) {
    addFieldError(errors, 'regularHolidayRate', 'Regular holiday rate must be a positive number')
  }
  if (!Number.isFinite(input.specialHolidayRate) || input.specialHolidayRate <= 0) {
    addFieldError(errors, 'specialHolidayRate', 'Special holiday rate must be a positive number')
  }

  if (Object.keys(errors).length > 0) throwPayrollValidationError(errors)

  return input
}

export const getAdminGeneralSettings = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getGeneralSettings()
  res.json({ success: true, data })
})

export const updateAdminGeneralSettings = asyncHandler(async (req: Request, res: Response) => {
  const input = validateGeneralSettingsPayload(req.body as Record<string, unknown>)
  const data = await updateGeneralSettings(input, req.user?.userId ?? null)
  res.json({ success: true, data, message: 'General settings updated.' })
})

export const getAdminPayrollSettings = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getPayrollSettings()
  res.json({ success: true, data })
})

export const updateAdminPayrollSettings = asyncHandler(async (req: Request, res: Response) => {
  const input = validatePayrollSettingsPayload(req.body as Record<string, unknown>)
  const data = await updatePayrollSettings(input, req.user?.userId ?? null)
  res.json({ success: true, data, message: 'Payroll settings updated.' })
})
