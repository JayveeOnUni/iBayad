import { Router } from 'express'
import {
  createAdminHoliday,
  deleteAdminHoliday,
  listHolidays,
  updateAdminHoliday,
} from '../controllers/holidayController'
import {
  createAdminAnnouncement,
  createAdminDepartment,
  createWorkShift,
  deleteAdminAnnouncement,
  deleteAdminDepartment,
  deleteWorkShift,
  listActiveDepartments,
  listActivePositions,
  listActiveShifts,
  listAnnouncements,
  listDepartments,
  listShifts,
  toggleAdminDepartmentActive,
  updateAdminAnnouncement,
  toggleWorkShiftActive,
  updateAdminDepartment,
  updateWorkShift,
} from '../controllers/referenceDataController'
import {
  getAdminGeneralSettings,
  getAdminPayrollSettings,
  updateAdminGeneralSettings,
  updateAdminPayrollSettings,
} from '../controllers/settingsController'
import { authenticate, requireRole } from '../middleware/auth'

const router = Router()

router.use(authenticate, requireRole('admin'))

router.get('/settings/general', getAdminGeneralSettings)
router.put('/settings/general', updateAdminGeneralSettings)
router.get('/settings/payroll', getAdminPayrollSettings)
router.put('/settings/payroll', updateAdminPayrollSettings)
router.get('/departments/active', listActiveDepartments)
router.get('/departments', listDepartments)
router.post('/departments', createAdminDepartment)
router.put('/departments/:id', updateAdminDepartment)
router.patch('/departments/:id/toggle-active', toggleAdminDepartmentActive)
router.delete('/departments/:id', deleteAdminDepartment)
router.get('/announcements', listAnnouncements)
router.post('/announcements', createAdminAnnouncement)
router.put('/announcements/:id', updateAdminAnnouncement)
router.delete('/announcements/:id', deleteAdminAnnouncement)
router.get('/holidays', listHolidays)
router.post('/holidays', createAdminHoliday)
router.put('/holidays/:id', updateAdminHoliday)
router.delete('/holidays/:id', deleteAdminHoliday)
router.get('/positions/active', listActivePositions)
router.get('/shifts/active', listActiveShifts)
router.get('/shifts', listShifts)
router.post('/shifts', createWorkShift)
router.put('/shifts/:id', updateWorkShift)
router.patch('/shifts/:id/toggle-active', toggleWorkShiftActive)
router.delete('/shifts/:id', deleteWorkShift)

export default router
