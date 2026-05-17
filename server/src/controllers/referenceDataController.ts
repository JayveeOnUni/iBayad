import { Request, Response } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import {
  createAnnouncement,
  createDepartment,
  createShift,
  deleteAnnouncement,
  deleteDepartment,
  deleteShift,
  getAllAnnouncements,
  getActiveDepartments,
  getActivePositions,
  getActiveShifts,
  getAllDepartments,
  getAllShifts,
  isDepartmentCodeTaken,
  toggleDepartmentActive,
  toggleShiftActive,
  updateAnnouncement,
  updateDepartment,
  updateShift,
  type AnnouncementMutationInput,
  type DepartmentMutationInput,
  type ShiftMutationInput,
} from '../services/referenceDataService'

type ValidationErrors = Record<string, string[]>

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function addFieldError(errors: ValidationErrors, field: string, message: string): void {
  errors[field] = [...(errors[field] ?? []), message]
}

function throwValidationError(errors: ValidationErrors, message = 'Details contain invalid values.'): never {
  const error = createError(message, 400)
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

  if (Object.keys(errors).length > 0) throwValidationError(errors, 'Shift details contain invalid values.')

  return {
    name,
    startTime,
    endTime,
    breakMinutes,
    workingHoursPerDay,
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function normalizeOptionalDate(value: unknown, field: string, label: string, errors: ValidationErrors): string | null {
  if (value === undefined || value === null || value === '') return null
  const normalized = typeof value === 'string' ? value.trim() : ''

  if (!datePattern.test(normalized)) {
    addFieldError(errors, field, `${label} must use YYYY-MM-DD date format`)
    return null
  }

  const [year, month, day] = normalized.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const isValidDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day

  if (!isValidDate) {
    addFieldError(errors, field, `${label} must be a valid date`)
    return null
  }

  return normalized
}

function validateDepartmentPayload(body: Record<string, unknown>): DepartmentMutationInput {
  const errors: ValidationErrors = {}
  const name = normalizeRequiredString(body.name, 'name', 'Department name', errors)
  const code = normalizeRequiredString(body.code, 'code', 'Department code', errors)
  const description = normalizeOptionalString(body.description)

  if (name.length > 100) addFieldError(errors, 'name', 'Department name must be 100 characters or fewer')
  if (code.length > 20) addFieldError(errors, 'code', 'Department code must be 20 characters or fewer')

  if (Object.keys(errors).length > 0) {
    throwValidationError(errors, 'Department details contain invalid values.')
  }

  return {
    name,
    code,
    description,
  }
}

function validateAnnouncementPayload(body: Record<string, unknown>): AnnouncementMutationInput {
  const errors: ValidationErrors = {}
  const title = normalizeRequiredString(body.title, 'title', 'Title', errors)
  const content = normalizeRequiredString(body.content, 'content', 'Content', errors)
  const startDate = normalizeOptionalDate(body.startDate ?? body.start_date, 'startDate', 'Start date', errors)
  const endDate = normalizeOptionalDate(body.endDate ?? body.end_date, 'endDate', 'End date', errors)
  const isPinned = typeof body.isPinned === 'boolean'
    ? body.isPinned
    : typeof body.is_pinned === 'boolean'
      ? body.is_pinned
      : false

  if (title.length > 255) addFieldError(errors, 'title', 'Title must be 255 characters or fewer')
  if (startDate && endDate && endDate < startDate) {
    addFieldError(errors, 'endDate', 'End date cannot be earlier than start date')
  }

  if (Object.keys(errors).length > 0) {
    throwValidationError(errors, 'Announcement details contain invalid values.')
  }

  return {
    title,
    content,
    startDate,
    endDate,
    isPinned,
  }
}

export const listActiveDepartments = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getActiveDepartments()
  res.json({ success: true, data })
})

export const listDepartments = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getAllDepartments()
  res.json({ success: true, data })
})

export const listAnnouncements = asyncHandler(async (_req: Request, res: Response) => {
  const data = await getAllAnnouncements()
  res.json({ success: true, data })
})

export const createAdminAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  const input = validateAnnouncementPayload(req.body as Record<string, unknown>)
  const data = await createAnnouncement(input, req.user?.userId ?? null)
  res.status(201).json({ success: true, data, message: 'Announcement created.' })
})

export const updateAdminAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Announcement ID')
  const input = validateAnnouncementPayload(req.body as Record<string, unknown>)
  const data = await updateAnnouncement(req.params.id, input)
  if (!data) throw createError('Announcement not found', 404)
  res.json({ success: true, data, message: 'Announcement updated.' })
})

export const deleteAdminAnnouncement = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Announcement ID')
  const result = await deleteAnnouncement(req.params.id)

  if (result.status === 'not_found') throw createError('Announcement not found', 404)

  res.json({
    success: true,
    data: {
      deletedAnnouncementId: result.deletedAnnouncementId,
    },
    message: 'Announcement deleted.',
  })
})

export const createAdminDepartment = asyncHandler(async (req: Request, res: Response) => {
  const input = validateDepartmentPayload(req.body as Record<string, unknown>)

  if (await isDepartmentCodeTaken(input.code)) {
    const error = createError('A department with this code already exists.', 409)
    error.details = { errors: { code: ['Department code must be unique'] } }
    throw error
  }

  const data = await createDepartment(input)
  res.status(201).json({ success: true, data, message: 'Department created.' })
})

export const updateAdminDepartment = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Department ID')
  const input = validateDepartmentPayload(req.body as Record<string, unknown>)

  if (await isDepartmentCodeTaken(input.code, req.params.id)) {
    const error = createError('A department with this code already exists.', 409)
    error.details = { errors: { code: ['Department code must be unique'] } }
    throw error
  }

  const data = await updateDepartment(req.params.id, input)
  if (!data) throw createError('Department not found', 404)
  res.json({ success: true, data, message: 'Department updated.' })
})

export const toggleAdminDepartmentActive = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Department ID')
  const data = await toggleDepartmentActive(req.params.id)
  if (!data) throw createError('Department not found', 404)
  res.json({
    success: true,
    data,
    message: `Department ${data.isActive ? 'activated' : 'deactivated'}.`,
  })
})

export const deleteAdminDepartment = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Department ID')
  const result = await deleteDepartment(req.params.id)

  if (result.status === 'not_found') throw createError('Department not found', 404)
  if (result.status === 'has_related_records') {
    const parts = [
      result.employeeCount > 0 ? (result.employeeCount === 1 ? '1 employee' : `${result.employeeCount} employees`) : null,
      result.positionCount > 0 ? (result.positionCount === 1 ? '1 position' : `${result.positionCount} positions`) : null,
    ].filter(Boolean)
    throw createError(
      `This department has ${parts.join(' and ')} assigned and cannot be deleted. Deactivate it instead.`,
      409
    )
  }

  res.json({
    success: true,
    data: {
      deletedDepartmentId: result.deletedDepartmentId,
    },
    message: 'Department deleted.',
  })
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

export const deleteWorkShift = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Shift ID')
  const result = await deleteShift(req.params.id)

  if (result.status === 'not_found') throw createError('Shift not found', 404)
  if (result.status === 'regular_shift') throw createError('Regular Shift cannot be deleted.', 400)
  if (result.status === 'missing_regular_shift') {
    throw createError('Regular Shift was not found. No shift was deleted.', 409)
  }
  if (result.status === 'has_attendance_history') {
    throw createError('This shift has attendance history and cannot be deleted. Deactivate it instead.', 409)
  }

  res.json({
    success: true,
    data: {
      deletedShiftId: result.deletedShiftId,
      reassignedEmployees: result.reassignedEmployees,
    },
    message: 'Shift deleted.',
  })
})
