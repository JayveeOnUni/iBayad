import { Router } from 'express'
import {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  activateEmployee,
  resendEmployeeActivation,
} from '../controllers/employeeController'
import { getEmployeeDashboard } from '../controllers/employeeDashboardController'
import {
  downloadPayslipPdf,
  getMyPayrollRecords,
  getPayrollRecordPayslip,
} from '../controllers/payrollController'
import { authenticate, employeeSelfService, requireRole } from '../middleware/auth'
import { asyncHandler, createError } from '../middleware/errorHandler'
import pool from '../utils/db'

const router = Router()

router.use(authenticate)

// Employee self-service: my profile
router.get('/me', employeeSelfService, asyncHandler(async (req, res) => {
  const result = await pool.query(
    `SELECT e.*, d.name AS department_name, p.title AS position_title
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.id
     LEFT JOIN positions p ON e.position_id = p.id
     WHERE e.id = $1`,
    [req.user!.employeeId]
  )
  if (!result.rows[0]) throw createError('Profile not found', 404)
  res.json({ success: true, data: result.rows[0] })
}))

router.get('/dashboard', employeeSelfService, getEmployeeDashboard)
router.get('/me/payslips', employeeSelfService, getMyPayrollRecords)
router.get('/me/payslips/:id', employeeSelfService, getPayrollRecordPayslip)
router.get('/me/payslips/:id/pdf', employeeSelfService, downloadPayslipPdf)

// Admin routes
router.get('/', requireRole('admin'), listEmployees)
router.post('/', requireRole('admin'), createEmployee)
router.get('/:id', requireRole('admin'), getEmployee)
router.put('/:id', requireRole('admin'), updateEmployee)
router.post('/:id/resend-activation', requireRole('admin'), resendEmployeeActivation)
router.put('/:id/activate', requireRole('admin'), activateEmployee)
router.delete('/:id', requireRole('admin'), deactivateEmployee)

export default router
