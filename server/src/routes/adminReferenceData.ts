import { Router } from 'express'
import {
  createWorkShift,
  listActiveDepartments,
  listActivePositions,
  listActiveShifts,
  listShifts,
  toggleWorkShiftActive,
  updateWorkShift,
} from '../controllers/referenceDataController'
import { authenticate, requireRole } from '../middleware/auth'

const router = Router()

router.use(authenticate, requireRole('admin'))

router.get('/departments/active', listActiveDepartments)
router.get('/positions/active', listActivePositions)
router.get('/shifts/active', listActiveShifts)
router.get('/shifts', listShifts)
router.post('/shifts', createWorkShift)
router.put('/shifts/:id', updateWorkShift)
router.patch('/shifts/:id/toggle-active', toggleWorkShiftActive)

export default router
