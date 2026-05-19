import { Router } from 'express'
import {
  applyPayrollPeriodLeaveAdjustments,
  getPayrollPeriodLeaveImpacts,
} from '../controllers/leaveController'
import {
  getPayrollPeriods,
  getPayrollPeriodById,
  getPayrollPeriodGenerationSettings,
  createPayrollPeriod,
  generatePayrollPeriod,
  getPayrollRecords,
  getPayrollRecordById,
  getPayrollRecordBreakdown,
  getPayrollRecordPayslip,
  getPayrollReport,
  getMyPayrollRecords,
  getStatutoryRuleVersions,
  validatePayrollPeriod,
  processPayroll,
  approvePayroll,
  requestPayrollCorrection,
  releasePayroll,
  voidPayrollRecord,
  unlockPayroll,
  getPayrollAuditLogs,
  getPayrollRecordSnapshots,
  downloadPayslip,
  downloadPayslipPdf,
  exportPayrollReport,
  computeEmployeeTax,
} from '../controllers/payrollController'
import { authenticate, employeeSelfService, requirePayrollPermission } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// Employee
router.get('/my-records', employeeSelfService, getMyPayrollRecords)
router.get('/my-records/:id', employeeSelfService, getPayrollRecordPayslip)
router.get('/my-records/:id/pdf', employeeSelfService, downloadPayslipPdf)
router.get('/compute-tax', computeEmployeeTax)

// Admin/Finance
router.get('/periods', requirePayrollPermission('payroll:view'), getPayrollPeriods)
router.post('/periods', requirePayrollPermission('payroll:create_period'), createPayrollPeriod)
router.get('/periods/generation-settings', requirePayrollPermission('payroll:create_period'), getPayrollPeriodGenerationSettings)
router.post('/periods/generate', requirePayrollPermission('payroll:create_period'), generatePayrollPeriod)
router.get('/periods/:id', requirePayrollPermission('payroll:view'), getPayrollPeriodById)
router.get('/periods/:id/reports/export', requirePayrollPermission('payroll:export_reports'), exportPayrollReport)
router.get('/periods/:id/reports/:reportType', requirePayrollPermission('payroll:view_reports'), getPayrollReport)
router.get('/periods/:id/validation', requirePayrollPermission('payroll:validate'), validatePayrollPeriod)
router.post('/periods/:id/validation', requirePayrollPermission('payroll:validate'), validatePayrollPeriod)
router.get('/periods/:id/audit-logs', requirePayrollPermission('payroll:view_audit_logs'), getPayrollAuditLogs)
router.get('/statutory-rules', requirePayrollPermission('payroll:view'), getStatutoryRuleVersions)
router.get('/periods/:periodId/leave-impacts', requirePayrollPermission('payroll:view'), getPayrollPeriodLeaveImpacts)
router.post('/periods/:periodId/apply-leave-adjustments', requirePayrollPermission('payroll:process'), applyPayrollPeriodLeaveAdjustments)
router.get('/records', requirePayrollPermission('payroll:view'), getPayrollRecords)
router.get('/records/:id', requirePayrollPermission('payroll:view'), getPayrollRecordById)
router.get('/records/:id/breakdown', requirePayrollPermission('payroll:view'), getPayrollRecordBreakdown)
router.get('/records/:id/snapshots', requirePayrollPermission('payroll:view_audit_logs'), getPayrollRecordSnapshots)
router.get('/records/:id/payslip', requirePayrollPermission('payroll:view_payslips'), getPayrollRecordPayslip)
router.get('/records/:id/payslip/pdf', requirePayrollPermission('payroll:view_payslips'), downloadPayslip)
router.post('/records/:id/void', requirePayrollPermission('payroll:void_record'), voidPayrollRecord)
router.post('/process', requirePayrollPermission('payroll:process'), processPayroll)
router.post('/periods/:id/process', requirePayrollPermission('payroll:process'), processPayroll)
router.post('/periods/:id/reprocess', requirePayrollPermission('payroll:reprocess'), processPayroll)
router.post('/periods/:id/approve', requirePayrollPermission('payroll:approve'), approvePayroll)
router.post('/periods/:id/request-correction', requirePayrollPermission('payroll:request_correction'), requestPayrollCorrection)
router.post('/periods/:id/release', requirePayrollPermission('payroll:release'), releasePayroll)
router.post('/periods/:id/unlock', requirePayrollPermission('payroll:unlock'), unlockPayroll)

export default router
