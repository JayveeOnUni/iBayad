import type { Pool, PoolClient } from 'pg'
import pool from '../utils/db'
import { createError } from '../middleware/errorHandler'
import { validateStatutoryRuleCoverage, type PayFrequency } from '../utils/statutoryDeductions'

type Queryable = Pool | PoolClient

type IssueSeverity = 'critical' | 'warning'

export interface PayrollValidationIssue {
  code: string
  severity: IssueSeverity
  message: string
  count?: number
}

export interface PayrollValidationEmployeeIssue {
  employeeId: string
  employeeNumber: string
  employeeName: string
  count?: number
  dates?: string[]
  amount?: number
}

export interface PayrollValidationReport {
  periodId: string
  status: string
  isValid: boolean
  criticalIssueCount: number
  warningCount: number
  message: string
  issues: PayrollValidationIssue[]
  attendance: {
    totalEmployees: number
    expectedWorkdays: number
    expectedEmployeeDays: number
    completeEmployees: number
    employeesWithMissingAttendance: number
    missingEmployeeDays: number
    pendingCorrections: number
    missingAttendance: PayrollValidationEmployeeIssue[]
  }
  payroll: {
    employeesWithPayrollRecords: number
    employeesWithoutPayrollRecords: number
    employeesWithMissingSalarySetup: number
    employeesWithNegativeNetPay: number
    missingPayrollRecords: PayrollValidationEmployeeIssue[]
    missingSalarySetup: PayrollValidationEmployeeIssue[]
    negativeNetPay: PayrollValidationEmployeeIssue[]
    employeesWithIncompleteBreakdown: number
    employeesWithInconsistentTotals: number
    employeesWithInvalidTaxableIncome: number
    incompleteBreakdown: PayrollValidationEmployeeIssue[]
    inconsistentTotals: PayrollValidationEmployeeIssue[]
    invalidTaxableIncome: PayrollValidationEmployeeIssue[]
  }
  leaveAdjustments: {
    pendingLeaveRequests: number
    unappliedLeaveAdjustments: number
    unpaidLeaveRecords: number
  }
  statutory: {
    isComplete: boolean
    versions: Record<string, unknown>
    missingRules: Array<{ agency: string; ruleName: string }>
  }
}

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function toInt(value: unknown): number {
  return Math.trunc(toNumber(value))
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

let hasPayrollLeaveAdjustmentsTable: boolean | null = null

async function payrollLeaveAdjustmentsTableExists(db: Queryable): Promise<boolean> {
  if (hasPayrollLeaveAdjustmentsTable !== null) return hasPayrollLeaveAdjustmentsTable
  const result = await db.query(`SELECT to_regclass('payroll_leave_adjustments') AS table_name`)
  hasPayrollLeaveAdjustmentsTable = Boolean(result.rows[0]?.table_name)
  return hasPayrollLeaveAdjustmentsTable
}

function employeeIssue(row: Record<string, unknown>): PayrollValidationEmployeeIssue {
  return {
    employeeId: String(row.employee_id ?? row.id ?? ''),
    employeeNumber: String(row.employee_number ?? ''),
    employeeName: String(row.employee_name ?? `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim()),
    count: row.count == null ? undefined : toInt(row.count),
    dates: Array.isArray(row.dates) ? row.dates.map(dateOnly) : undefined,
    amount: row.amount == null ? undefined : toNumber(row.amount),
  }
}

export async function buildPayrollValidationReport(
  payrollPeriodId: string,
  db: Queryable = pool
): Promise<PayrollValidationReport> {
  const periodResult = await db.query(
    `SELECT id, start_date, end_date, pay_frequency, status
     FROM payroll_periods
     WHERE id = $1`,
    [payrollPeriodId]
  )
  const period = periodResult.rows[0]
  if (!period) {
    throw createError('Payroll period not found', 404)
  }

  const summaryResult = await db.query(
    `WITH work_dates AS (
       SELECT day::date AS work_date
       FROM generate_series($2::date, $3::date, interval '1 day') AS day
       WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 5
     ),
     active_employees AS (
       SELECT id, employee_number, first_name, last_name, hire_date, basic_salary, work_days_per_month, work_hours_per_day
       FROM employees
       WHERE employment_status = 'active'
         AND hire_date <= $3::date
         AND NOT EXISTS (
           SELECT 1
           FROM payroll_records excluded_pr
           WHERE excluded_pr.payroll_period_id = $1
             AND excluded_pr.employee_id = employees.id
             AND excluded_pr.status::text IN ('cancelled', 'voided')
         )
     ),
     expected AS (
       SELECT ae.id AS employee_id, wd.work_date
       FROM active_employees ae
       CROSS JOIN work_dates wd
       WHERE wd.work_date >= GREATEST(ae.hire_date, $2::date)
     ),
     missing_attendance AS (
       SELECT ex.employee_id, ex.work_date
       FROM expected ex
       LEFT JOIN attendance a
         ON a.employee_id = ex.employee_id
        AND a.date = ex.work_date
       WHERE a.id IS NULL
     ),
     missing_by_employee AS (
       SELECT ae.id AS employee_id,
              ae.employee_number,
              CONCAT(ae.first_name, ' ', ae.last_name) AS employee_name,
              COUNT(ma.work_date)::int AS count,
              ARRAY_AGG(ma.work_date ORDER BY ma.work_date) AS dates
       FROM active_employees ae
       JOIN missing_attendance ma ON ma.employee_id = ae.id
       GROUP BY ae.id, ae.employee_number, ae.first_name, ae.last_name
     ),
     payroll_records_for_period AS (
       SELECT employee_id, net_pay, gross_pay, total_deductions, taxable_income,
              statutory_rule_version, computation_breakdown,
              absence_deduction, late_deduction, undertime_deduction, leave_deduction,
              pre_tax_deductions, statutory_deductions, post_tax_deductions
       FROM payroll_records
       WHERE payroll_period_id = $1
         AND status::text NOT IN ('cancelled', 'voided')
     ),
     missing_payroll AS (
       SELECT ae.id AS employee_id,
              ae.employee_number,
              CONCAT(ae.first_name, ' ', ae.last_name) AS employee_name
       FROM active_employees ae
       LEFT JOIN payroll_records_for_period pr ON pr.employee_id = ae.id
       WHERE pr.employee_id IS NULL
     ),
     missing_salary AS (
       SELECT ae.id AS employee_id,
              ae.employee_number,
              CONCAT(ae.first_name, ' ', ae.last_name) AS employee_name
       FROM active_employees ae
       WHERE COALESCE(ae.basic_salary, 0) <= 0
          OR COALESCE(ae.work_days_per_month, 0) <= 0
          OR COALESCE(ae.work_hours_per_day, 0) <= 0
     ),
     negative_net AS (
       SELECT e.id AS employee_id,
              e.employee_number,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              pr.net_pay AS amount
       FROM payroll_records_for_period pr
       JOIN employees e ON e.id = pr.employee_id
       WHERE pr.net_pay < 0
     ),
     incomplete_breakdown AS (
       SELECT e.id AS employee_id,
              e.employee_number,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name
       FROM payroll_records_for_period pr
       JOIN employees e ON e.id = pr.employee_id
       WHERE pr.statutory_rule_version IS NULL
          OR pr.statutory_rule_version = ''
          OR pr.computation_breakdown IS NULL
          OR pr.computation_breakdown = '{}'::jsonb
          OR NOT (pr.computation_breakdown ? 'earnings')
          OR NOT (pr.computation_breakdown ? 'deductions')
          OR NOT (pr.computation_breakdown ? 'governmentDeductions')
          OR NOT (pr.computation_breakdown ? 'employerContributions')
     ),
     inconsistent_totals AS (
       SELECT e.id AS employee_id,
              e.employee_number,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              pr.net_pay AS amount
       FROM payroll_records_for_period pr
       JOIN employees e ON e.id = pr.employee_id
       WHERE ABS(
         pr.net_pay - (
           pr.gross_pay - (
             COALESCE(pr.absence_deduction, 0) +
             COALESCE(pr.late_deduction, 0) +
             COALESCE(pr.undertime_deduction, 0) +
             COALESCE(pr.leave_deduction, 0) +
             COALESCE(pr.pre_tax_deductions, 0) +
             COALESCE(pr.statutory_deductions, 0) +
             COALESCE(pr.post_tax_deductions, 0)
           )
         )
       ) > 0.02
     ),
     invalid_taxable AS (
       SELECT e.id AS employee_id,
              e.employee_number,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              pr.taxable_income AS amount
       FROM payroll_records_for_period pr
       JOIN employees e ON e.id = pr.employee_id
       WHERE pr.taxable_income IS NULL OR pr.taxable_income < 0
     )
     SELECT
       (SELECT COUNT(*) FROM active_employees)::int AS total_employees,
       (SELECT COUNT(*) FROM work_dates)::int AS expected_workdays,
       (SELECT COUNT(*) FROM expected)::int AS expected_employee_days,
       (SELECT COUNT(*) FROM missing_attendance)::int AS missing_employee_days,
       (SELECT COUNT(*) FROM missing_by_employee)::int AS employees_with_missing_attendance,
       (SELECT COUNT(*) FROM payroll_records_for_period)::int AS employees_with_payroll_records,
       (SELECT COUNT(*) FROM missing_payroll)::int AS employees_without_payroll_records,
       (SELECT COUNT(*) FROM missing_salary)::int AS employees_with_missing_salary_setup,
       (SELECT COUNT(*) FROM negative_net)::int AS employees_with_negative_net_pay,
       (SELECT COUNT(*) FROM incomplete_breakdown)::int AS employees_with_incomplete_breakdown,
       (SELECT COUNT(*) FROM inconsistent_totals)::int AS employees_with_inconsistent_totals,
       (SELECT COUNT(*) FROM invalid_taxable)::int AS employees_with_invalid_taxable_income,
       COALESCE((SELECT JSON_AGG(missing_by_employee ORDER BY employee_name) FROM missing_by_employee), '[]'::json) AS missing_attendance,
       COALESCE((SELECT JSON_AGG(missing_payroll ORDER BY employee_name) FROM missing_payroll), '[]'::json) AS missing_payroll_records,
       COALESCE((SELECT JSON_AGG(missing_salary ORDER BY employee_name) FROM missing_salary), '[]'::json) AS missing_salary_setup,
       COALESCE((SELECT JSON_AGG(negative_net ORDER BY employee_name) FROM negative_net), '[]'::json) AS negative_net_pay,
       COALESCE((SELECT JSON_AGG(incomplete_breakdown ORDER BY employee_name) FROM incomplete_breakdown), '[]'::json) AS incomplete_breakdown,
       COALESCE((SELECT JSON_AGG(inconsistent_totals ORDER BY employee_name) FROM inconsistent_totals), '[]'::json) AS inconsistent_totals,
       COALESCE((SELECT JSON_AGG(invalid_taxable ORDER BY employee_name) FROM invalid_taxable), '[]'::json) AS invalid_taxable_income`,
    [payrollPeriodId, period.start_date, period.end_date]
  )

  const row = summaryResult.rows[0] as Record<string, unknown>
  const pendingAttendanceResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM attendance_requests
     WHERE status = 'pending'
       AND date BETWEEN $1::date AND $2::date`,
    [period.start_date, period.end_date]
  )
  const pendingLeaveResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM leave_requests
     WHERE status = 'pending'
       AND start_date <= $2::date
       AND end_date >= $1::date`,
    [period.start_date, period.end_date]
  )
  const unpaidLeaveResult = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM leave_requests
     WHERE status = 'approved'
       AND COALESCE(unpaid_days, 0) > 0
       AND start_date <= $2::date
       AND end_date >= $1::date`,
    [period.start_date, period.end_date]
  )

  let unappliedLeaveAdjustments = 0
  if (await payrollLeaveAdjustmentsTableExists(db)) {
    const result = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM payroll_leave_adjustments pla
       LEFT JOIN leave_requests lr ON lr.id = pla.leave_request_id
       WHERE (pla.payroll_period_id = $1 OR pla.payroll_period_id IS NULL)
         AND pla.status = 'pending'
         AND (
           lr.id IS NULL
           OR (lr.start_date <= $3::date AND lr.end_date >= $2::date)
         )`,
      [payrollPeriodId, period.start_date, period.end_date]
    )
    unappliedLeaveAdjustments = toInt(result.rows[0]?.count)
  }

  const statutoryCoverage = await validateStatutoryRuleCoverage(
    period.end_date,
    String(period.pay_frequency ?? 'semi-monthly') as PayFrequency,
    db
  )

  const totalEmployees = toInt(row.total_employees)
  const employeesWithMissingAttendance = toInt(row.employees_with_missing_attendance)
  const missingEmployeeDays = toInt(row.missing_employee_days)
  const employeesWithoutPayrollRecords = toInt(row.employees_without_payroll_records)
  const employeesWithMissingSalarySetup = toInt(row.employees_with_missing_salary_setup)
  const employeesWithNegativeNetPay = toInt(row.employees_with_negative_net_pay)
  const employeesWithIncompleteBreakdown = toInt(row.employees_with_incomplete_breakdown)
  const employeesWithInconsistentTotals = toInt(row.employees_with_inconsistent_totals)
  const employeesWithInvalidTaxableIncome = toInt(row.employees_with_invalid_taxable_income)
  const pendingCorrections = toInt(pendingAttendanceResult.rows[0]?.count)
  const pendingLeaveRequests = toInt(pendingLeaveResult.rows[0]?.count)

  const issues: PayrollValidationIssue[] = []
  if (totalEmployees === 0) {
    issues.push({ code: 'no_active_employees', severity: 'critical', message: 'No active employees are available for this payroll period.' })
  }
  if (!['weekly', 'semi-monthly', 'monthly'].includes(String(period.pay_frequency))) {
    issues.push({
      code: 'invalid_payroll_frequency',
      severity: 'critical',
      message: 'Payroll frequency is missing or invalid.',
    })
  }
  if (!statutoryCoverage.isComplete) {
    issues.push({
      code: 'missing_statutory_rule_version',
      severity: 'critical',
      count: statutoryCoverage.missing.length,
      message: 'Statutory rule versions are missing for this payroll period.',
    })
  }
  if (employeesWithMissingSalarySetup > 0) {
    issues.push({
      code: 'missing_salary_setup',
      severity: 'critical',
      count: employeesWithMissingSalarySetup,
      message: `${employeesWithMissingSalarySetup} employee${employeesWithMissingSalarySetup === 1 ? ' has' : 's have'} missing salary setup.`,
    })
  }
  if (employeesWithoutPayrollRecords > 0) {
    issues.push({
      code: 'missing_payroll_records',
      severity: 'critical',
      count: employeesWithoutPayrollRecords,
      message: `${employeesWithoutPayrollRecords} employee${employeesWithoutPayrollRecords === 1 ? ' is' : 's are'} missing payroll records.`,
    })
  }
  if (employeesWithMissingAttendance > 0) {
    issues.push({
      code: 'missing_attendance',
      severity: 'critical',
      count: employeesWithMissingAttendance,
      message: `Payroll cannot be approved because ${employeesWithMissingAttendance} employee${employeesWithMissingAttendance === 1 ? ' has' : 's have'} unrecorded attendance within this payroll period.`,
    })
  }
  if (pendingCorrections > 0) {
    issues.push({
      code: 'pending_attendance_corrections',
      severity: 'critical',
      count: pendingCorrections,
      message: `${pendingCorrections} attendance correction request${pendingCorrections === 1 ? ' is' : 's are'} still pending.`,
    })
  }
  if (pendingLeaveRequests > 0) {
    issues.push({
      code: 'pending_leave_requests',
      severity: 'critical',
      count: pendingLeaveRequests,
      message: `${pendingLeaveRequests} leave request${pendingLeaveRequests === 1 ? ' is' : 's are'} pending in this payroll period.`,
    })
  }
  if (unappliedLeaveAdjustments > 0) {
    issues.push({
      code: 'unapplied_leave_adjustments',
      severity: 'critical',
      count: unappliedLeaveAdjustments,
      message: `${unappliedLeaveAdjustments} leave payroll adjustment${unappliedLeaveAdjustments === 1 ? ' is' : 's are'} not yet applied.`,
    })
  }
  if (employeesWithNegativeNetPay > 0) {
    issues.push({
      code: 'negative_net_pay',
      severity: 'critical',
      count: employeesWithNegativeNetPay,
      message: `${employeesWithNegativeNetPay} employee${employeesWithNegativeNetPay === 1 ? ' has' : 's have'} negative net pay.`,
    })
  }
  if (employeesWithIncompleteBreakdown > 0) {
    issues.push({
      code: 'incomplete_payroll_breakdown',
      severity: 'critical',
      count: employeesWithIncompleteBreakdown,
      message: `${employeesWithIncompleteBreakdown} payroll record${employeesWithIncompleteBreakdown === 1 ? ' has' : 's have'} incomplete computation breakdowns.`,
    })
  }
  if (employeesWithInconsistentTotals > 0) {
    issues.push({
      code: 'inconsistent_payroll_totals',
      severity: 'critical',
      count: employeesWithInconsistentTotals,
      message: `${employeesWithInconsistentTotals} payroll record${employeesWithInconsistentTotals === 1 ? ' has' : 's have'} inconsistent gross, deduction, or net pay totals.`,
    })
  }
  if (employeesWithInvalidTaxableIncome > 0) {
    issues.push({
      code: 'invalid_taxable_income',
      severity: 'critical',
      count: employeesWithInvalidTaxableIncome,
      message: `${employeesWithInvalidTaxableIncome} payroll record${employeesWithInvalidTaxableIncome === 1 ? ' has' : 's have'} missing or invalid taxable income.`,
    })
  }
  const criticalIssueCount = issues.filter((issue) => issue.severity === 'critical').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const isValid = criticalIssueCount === 0

  return {
    periodId: payrollPeriodId,
    status: String(period.status),
    isValid,
    criticalIssueCount,
    warningCount,
    message: isValid
      ? 'Validation passed. Payroll is ready for approval.'
      : 'Fix critical payroll validation issues before approval.',
    issues,
    attendance: {
      totalEmployees,
      expectedWorkdays: toInt(row.expected_workdays),
      expectedEmployeeDays: toInt(row.expected_employee_days),
      completeEmployees: Math.max(0, totalEmployees - employeesWithMissingAttendance),
      employeesWithMissingAttendance,
      missingEmployeeDays,
      pendingCorrections,
      missingAttendance: (row.missing_attendance as Record<string, unknown>[]).map(employeeIssue),
    },
    payroll: {
      employeesWithPayrollRecords: toInt(row.employees_with_payroll_records),
      employeesWithoutPayrollRecords,
      employeesWithMissingSalarySetup,
      employeesWithNegativeNetPay,
      employeesWithIncompleteBreakdown,
      employeesWithInconsistentTotals,
      employeesWithInvalidTaxableIncome,
      missingPayrollRecords: (row.missing_payroll_records as Record<string, unknown>[]).map(employeeIssue),
      missingSalarySetup: (row.missing_salary_setup as Record<string, unknown>[]).map(employeeIssue),
      negativeNetPay: (row.negative_net_pay as Record<string, unknown>[]).map(employeeIssue),
      incompleteBreakdown: (row.incomplete_breakdown as Record<string, unknown>[]).map(employeeIssue),
      inconsistentTotals: (row.inconsistent_totals as Record<string, unknown>[]).map(employeeIssue),
      invalidTaxableIncome: (row.invalid_taxable_income as Record<string, unknown>[]).map(employeeIssue),
    },
    leaveAdjustments: {
      pendingLeaveRequests,
      unappliedLeaveAdjustments,
      unpaidLeaveRecords: toInt(unpaidLeaveResult.rows[0]?.count),
    },
    statutory: {
      isComplete: statutoryCoverage.isComplete,
      versions: statutoryCoverage.versions,
      missingRules: statutoryCoverage.missing,
    },
  }
}
