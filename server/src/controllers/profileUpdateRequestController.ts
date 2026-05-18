import { Request, Response } from 'express'
import { asyncHandler } from '../middleware/errorHandler'
import {
  approveProfileUpdateRequest,
  createProfileUpdateRequest,
  getProfileUpdateRequestById,
  listMyProfileUpdateRequests,
  listProfileUpdateRequests,
  rejectProfileUpdateRequest,
} from '../services/profileUpdateRequestService'

export const createMyProfileUpdateRequest = asyncHandler(async (req: Request, res: Response) => {
  const request = await createProfileUpdateRequest(req.user!.employeeId!, req.body)
  res.status(201).json({
    success: true,
    data: request,
    message: 'Profile update request submitted for HR review.',
  })
})

export const getMyProfileUpdateRequests = asyncHandler(async (req: Request, res: Response) => {
  const requests = await listMyProfileUpdateRequests(req.user!.employeeId!)
  res.json({ success: true, data: requests })
})

export const getProfileUpdateRequests = asyncHandler(async (req: Request, res: Response) => {
  const requests = await listProfileUpdateRequests({
    status: req.query.status ? String(req.query.status) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  })
  res.json({ success: true, data: requests })
})

export const getProfileUpdateRequest = asyncHandler(async (req: Request, res: Response) => {
  const request = await getProfileUpdateRequestById(req.params.id)
  res.json({ success: true, data: request })
})

export const approveProfileUpdate = asyncHandler(async (req: Request, res: Response) => {
  const request = await approveProfileUpdateRequest(req.params.id, req.user!.userId)
  res.json({
    success: true,
    data: request,
    message: 'Profile update request approved.',
  })
})

export const rejectProfileUpdate = asyncHandler(async (req: Request, res: Response) => {
  const request = await rejectProfileUpdateRequest(req.params.id, req.user!.userId, req.body?.remarks)
  res.json({
    success: true,
    data: request,
    message: 'Profile update request rejected.',
  })
})
