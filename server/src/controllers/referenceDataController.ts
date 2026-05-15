import { Request, Response } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import {
  createShift,
  getActiveDepartments,
  getActivePositions,
  getActiveShifts,
  getAllShifts,
  toggleShiftActive,
  updateShift,
  type ShiftMutationInput,
} from '../services/referenceDataService'

type ValidationErrors = Record<string, string[]>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/

function addFieldError(errors: ValidationErrors, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message]
}

function throwValidationError(errors: ValidationErrors): never {
  const error = createError('Shift details contain invalid values.', 400)
  error.details = { errors }
  throw error
}

function validateUuid(id: string, label: string): void {
  if (!uuidPattern.test(id)) throw createError(`${label} must be a valid UUID`, 400)
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function getShiftDurationMinutes(startTime: string, endTime: string): number {
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)
  const duration = end - start
  return duration > 0 ? duration : duration + 24 * 60
}

function normalizeRequiredString(value: unknown, field: string, label: string, errors: ValidationErrors): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) addFieldError(errors, field, `${label} is required`)
  return normalized
}

function normalizeTime(value: unknown, field: string, label: string, errors: ValidationErrors): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    addFieldError(errors, field, `${label} is required`)
  } else if (!timePattern.test(normalized)) {
    addFieldError(errors, field, `${label} must use HH:MM time`)
  }
  return normalized
}

function normalizeInteger(value: unknown, field: string, label: string, errors: ValidationErrors): number {
  const number = Number(value)
  if (value === undefined || value === null || value === '') {
    addFieldError(errors, field, `${label} is required`)
    return 0
  }
  if (!Number.isInteger(number)) {
    addFieldError(errors, field, `${label} must be a whole number`)
    return 0
  }
  return number
}

function normalizeNumber(value: unknown, field: string, label: string, errors: ValidationErrors): number {
  const number = Number(value)
  if (value === undefined || value === null || value === '') {
    addFieldError(errors, field, `${label} is required`)
    return 0
  }
  if (!Number.isFinite(number)) {
    addFieldError(errors, field, `${label} must be a valid number`)
    return 0
  }
  return Math.round(number * 100) / 100
}

function validateShiftPayload(body: Record<string, unknown>): ShiftMutationInput {
  const errors: ValidationErrors = {}
  const name = normalizeRequiredString(body.name, 'name', 'Shift name', errors)
  const startTime = normalizeTime(body.startTime, 'startTime', 'Start time', errors)
  const endTime = normalizeTime(body.endTime, 'endTime', 'End time', errors)
  const breakMinutes = normalizeInteger(body.breakMinutes, 'breakMinutes', 'Break minutes', errors)
  const workingHoursPerDay = normalizeNumber(
    body.workingHoursPerDay ?? body.workHours,
    'workingHoursPerDay',
    'Working hours per day',
    errors
  )

  if (name.length > 100) addFieldError(errors, 'name', 'Shift name must be 100 characters or fewer')
  if (breakMinutes < 0) addFieldError(errors, 'breakMinutes', 'Break minutes cannot be negative')
  if (workingHoursPerDay <= 0) addFieldError(errors, 'workingHoursPerDay', 'Working hours per day must be greater than 0')
  if (workingHoursPerDay > 24) addFieldError(errors, 'workingHoursPerDay', 'Working hours per day cannot exceed 24')

  if (timePattern.test(startTime) && timePattern.test(endTime)) {
    if (startTime === endTime) addFieldError(errors, 'endTime', 'End time must differ from start time')

    const durationMinutes = getShiftDurationMinutes(startTime, endTime)
    const payableMinutes = durationMinutes - breakMinutes

    if (breakMinutes >= durationMinutes) {
      addFieldError(errors, 'breakMinutes', 'Break must be shorter than the shift duration')
    }
    if (payableMinutes > 0 && workingHoursPerDay * 60 > payableMinutes + 0.5) {
      addFieldError(errors, 'workingHoursPerDay', 'Working hours cannot exceed scheduled time minus break')
    }
  }

  if (Object.keys(errors).length > 0) throwValidationError(errors)

  return {
    name,
    startTime,
    endTime,
    breakMinutes,
    workingHoursPerDay,
  }
}

export const listActiveDepartments = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getActiveDepartments()
  res.json({ success: true, data })
})

export const listActivePositions = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getActivePositions()
  res.json({ success: true, data })
})

export const listActiveShifts = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getActiveShifts()
  res.json({ success: true, data })
})

export const listShifts = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getAllShifts()
  res.json({ success: true, data })
})

export const createWorkShift = asyncHandler(async (req: Request, res: Response) => {
  const input = validateShiftPayload(req.body as Record<string, unknown>)
  const data = await createShift(input)
  res.status(201).json({ success: true, data, message: 'Shift created.' })
})

export const updateWorkShift = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Shift ID')
  const input = validateShiftPayload(req.body as Record<string, unknown>)
  const data = await updateShift(req.params.id, input)
  if (!data) throw createError('Shift not found', 404)
  res.json({ success: true, data, message: 'Shift updated.' })
})

export const toggleWorkShiftActive = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Shift ID')
  const data = await toggleShiftActive(req.params.id)
  if (!data) throw createError('Shift not found', 404)
  res.json({
    success: true,
    data,
    message: `Shift ${data.isActive ? 'activated' : 'deactivated'}.`,
  })
})
