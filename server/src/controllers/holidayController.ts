import { Request, Response } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import {
  createHoliday,
  deleteHoliday,
  getAllHolidays,
  parseHolidayYear,
  updateHoliday,
  validateHolidayMutationInput,
} from '../services/holidayService'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i

function validateUuid(id: string, label: string): void {
  if (!uuidPattern.test(id)) throw createError(`${label} must be a valid UUID`, 400)
}

export const listHolidays = asyncHandler(async (req: Request, res: Response) => {
  const year = parseHolidayYear(req.query.year)
  const data = await getAllHolidays(year)
  res.json({ success: true, data })
})

export const createAdminHoliday = asyncHandler(async (req: Request, res: Response) => {
  const input = validateHolidayMutationInput(req.body as Record<string, unknown>)
  const data = await createHoliday(input)
  res.status(201).json({ success: true, data, message: 'Holiday created.' })
})

export const updateAdminHoliday = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Holiday ID')
  const input = validateHolidayMutationInput(req.body as Record<string, unknown>)
  const data = await updateHoliday(req.params.id, input)

  if (!data) throw createError('Holiday not found', 404)
  res.json({ success: true, data, message: 'Holiday updated.' })
})

export const deleteAdminHoliday = asyncHandler(async (req: Request, res: Response) => {
  validateUuid(req.params.id, 'Holiday ID')
  const result = await deleteHoliday(req.params.id)

  if (result.status === 'not_found') throw createError('Holiday not found', 404)

  res.json({
    success: true,
    data: {
      deletedHolidayId: result.deletedHolidayId,
    },
    message: 'Holiday deleted.',
  })
})
