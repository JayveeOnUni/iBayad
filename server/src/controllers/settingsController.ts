import { Request, Response } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import {
  getGeneralSettings,
  updateGeneralSettings,
  type GeneralSettingsInput,
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

export const getAdminGeneralSettings = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getGeneralSettings()
  res.json({ success: true, data })
})

export const updateAdminGeneralSettings = asyncHandler(async (req: Request, res: Response) => {
  const input = validateGeneralSettingsPayload(req.body as Record<string, unknown>)
  const data = await updateGeneralSettings(input, req.user?.userId ?? null)
  res.json({ success: true, data, message: 'General settings updated.' })
})
