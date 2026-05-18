import { Router } from 'express'
import {
  approveProfileUpdate,
  getProfileUpdateRequest,
  getProfileUpdateRequests,
  rejectProfileUpdate,
} from '../controllers/profileUpdateRequestController'
import { authenticate, requireRole } from '../middleware/auth'

const router = Router()

router.use(authenticate)
router.use(requireRole('admin'))

router.get('/', getProfileUpdateRequests)
router.get('/:id', getProfileUpdateRequest)
router.post('/:id/approve', approveProfileUpdate)
router.post('/:id/reject', rejectProfileUpdate)

export default router
