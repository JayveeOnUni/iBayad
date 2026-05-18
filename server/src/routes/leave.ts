import { Router } from 'express'
import {
  adjustLeaveBalance,
  applyPayrollPeriodLeaveAdjustments,
  approveLeaveRequest,
  cancelLeaveRequest,
  createLeaveRequest,
  getLeaveBalance,
  getLeaveCalendar,
  getLeavePayrollImpact,
  getLeaveReports,
  getLeaveRequestById,
  getLeaveRequests,
  getLeaveTypes,
  getMyLeaveRequests,
  getPayrollPeriodLeaveImpacts,
  previewLeaveRequest,
  processCarryOver,
  processCashConversion,
  processYearEnd,
  rejectLeaveRequest,
  reviewLeaveRequest,
  uploadLeaveDocument,
} from '../controllers/leaveController'
import { authenticate, employeeSelfService, leaveSelfServiceOrAdmin, requireRole } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Shared
router.get('/types', getLeaveTypes)
router.get('/calendar', leaveSelfServiceOrAdmin, getLeaveCalendar)
router.post('/requests/preview', leaveSelfServiceOrAdmin, previewLeaveRequest)

// Employee self-service
router.get('/my-requests', employeeSelfService, getMyLeaveRequests)
router.get('/requests/me', employeeSelfService, getMyLeaveRequests)
router.get('/balance/:employeeId?', leaveSelfServiceOrAdmin, getLeaveBalance)
router.get('/balances/me', employeeSelfService, getLeaveBalance)
router.post('/requests', leaveSelfServiceOrAdmin, createLeaveRequest)
router.patch('/requests/:id/cancel', leaveSelfServiceOrAdmin, cancelLeaveRequest)
router.put('/requests/:id/cancel', leaveSelfServiceOrAdmin, cancelLeaveRequest)
router.post('/requests/:id/documents', leaveSelfServiceOrAdmin, uploadLeaveDocument)
router.get('/requests/:id', leaveSelfServiceOrAdmin, getLeaveRequestById)

// Admin/HR
router.get('/admin/requests', requireRole('admin'), getLeaveRequests)
router.get('/requests', requireRole('admin'), getLeaveRequests)
router.patch('/admin/requests/:id/approve', requireRole('admin'), approveLeaveRequest)
router.patch('/admin/requests/:id/reject', requireRole('admin'), rejectLeaveRequest)
router.patch('/admin/requests/:id/cancel', requireRole('admin'), cancelLeaveRequest)
router.put('/requests/:id/review', requireRole('admin'), reviewLeaveRequest)
router.patch('/requests/:id/approve', requireRole('admin'), approveLeaveRequest)
router.patch('/requests/:id/reject', requireRole('admin'), rejectLeaveRequest)
router.patch('/balances/:employeeId/adjust', requireRole('admin'), adjustLeaveBalance)
router.patch('/admin/balances/:employeeId/adjust', requireRole('admin'), adjustLeaveBalance)
router.post('/admin/year-end/process', requireRole('admin'), processYearEnd)
router.post('/admin/carry-over/process', requireRole('admin'), processCarryOver)
router.post('/admin/cash-conversion/process', requireRole('admin'), processCashConversion)
router.get('/admin/reports', requireRole('admin'), getLeaveReports)
router.get('/admin/payroll-impact', requireRole('admin'), getLeavePayrollImpact)

// Payroll integration aliases.
router.get('/payroll/periods/:periodId/leave-impacts', requireRole('admin'), getPayrollPeriodLeaveImpacts)
router.post('/payroll/periods/:periodId/apply-leave-adjustments', requireRole('admin'), applyPayrollPeriodLeaveAdjustments)

export default router
