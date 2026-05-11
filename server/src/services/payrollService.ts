import pool from '../utils/db'
import { computeDeductions } from '../utils/taxComputation'
import { getDailyRate, getHourlyRate, countWorkingDays } from '../utils/dateHelpers'
import { createError } from '../middleware/errorHandler'
import type { Pool, PoolClient } from 'pg'

type Queryable = Pool | PoolClient

export interface PayrollInput {
  employeeId: string
  payrollPeriodId: string
  basicSalary: number
  daysWorked: number
  absenceDays: number
  lateMins: number
  overtimeHours: number
  holidayHours: number
  nightDiffHours: number
  excessMinutes: number
  offsetEarnedMinutes: number
  offsetUsedMinutes: number
  undertimeMinutes: number
  offsetBalanceMinutes: number
  allowances: number
  otherEarnings: number
  loanDeductions: number
  otherDeductions: number
  workDaysPerMonth?: number
  workHoursPerDay?: number
}

export interface PayrollResult {
  employeeId: string
  payrollPeriodId: string
  basicSalary: number
  dailyRate: number
  hourlyRate: number
  // Earnings
  regularPay: number
  overtimePay: number
  holidayPay: number
  nightDiffPay: number
  allowances: number
  otherEarnings: number
  grossPay: number
  excessMinutes: number
  offsetEarnedMinutes: number
  offsetUsedMinutes: number
  undertimeMinutes: number
  offsetBalanceMinutes: number
  // Deductions
  absenceDeduction: number
  lateDeduction: number
  sssEmployee: number
  philHealthEmployee: number
  pagIBIGEmployee: number
  withholdingTax: number
  loanDeductions: number
  otherDeductions: number
  totalDeductions: number
  // Employer contributions
  sssEmployer: number
  philHealthEmployer: number
  pagIBIGEmployer: number
  // Net
  netPay: number
}

export function computePayroll(input: PayrollInput): PayrollResult {
  const workDaysPerMonth = input.workDaysPerMonth ?? 22
  const workHoursPerDay = input.workHoursPerDay ?? 8

  const dailyRate = getDailyRate(input.basicSalary, workDaysPerMonth)
  const hourlyRate = getHourlyRate(dailyRate, workHoursPerDay)
  const scheduledWorkDays = input.daysWorked + input.absenceDays
  const deductibleTimeMinutes =
    input.lateMins + Math.max(0, input.undertimeMinutes - input.lateMins)

  // Earnings
  const regularPay = Math.round(dailyRate * scheduledWorkDays * 100) / 100
  const overtimePay = Math.round(hourlyRate * input.overtimeHours * 1.25 * 100) / 100
  const holidayPay = Math.round(hourlyRate * input.holidayHours * 2.0 * 100) / 100
  const nightDiffPay = 0

  const grossPay = regularPay + overtimePay + holidayPay + input.allowances + input.otherEarnings

  // Absence and time-based deductions. Late minutes can also reduce rendered time,
  // so only undertime beyond late minutes is added to avoid double-counting.
  const absenceDeduction = Math.round(dailyRate * input.absenceDays * 100) / 100
  const lateDeduction = Math.round(hourlyRate * (deductibleTimeMinutes / 60) * 100) / 100

  // Government contributions based on basic salary
  const deductions = computeDeductions(input.basicSalary)

  // Total employee deductions
  const totalDeductions =
    absenceDeduction +
    lateDeduction +
    deductions.sss.employee +
    deductions.philHealth.employee +
    deductions.pagIBIG.employee +
    deductions.withholdingTax +
    input.loanDeductions +
    input.otherDeductions

  return {
    employeeId: input.employeeId,
    payrollPeriodId: input.payrollPeriodId,
    basicSalary: input.basicSalary,
    dailyRate,
    hourlyRate,
    regularPay,
    overtimePay,
    holidayPay,
    nightDiffPay,
    allowances: input.allowances,
    otherEarnings: input.otherEarnings,
    grossPay,
    excessMinutes: Math.round(input.excessMinutes),
    offsetEarnedMinutes: Math.round(input.offsetEarnedMinutes),
    offsetUsedMinutes: Math.round(input.offsetUsedMinutes),
    undertimeMinutes: Math.round(input.undertimeMinutes),
    offsetBalanceMinutes: Math.round(input.offsetBalanceMinutes),
    absenceDeduction,
    lateDeduction,
    sssEmployee: deductions.sss.employee,
    philHealthEmployee: deductions.philHealth.employee,
    pagIBIGEmployee: deductions.pagIBIG.employee,
    withholdingTax: deductions.withholdingTax,
    loanDeductions: input.loanDeductions,
    otherDeductions: input.otherDeductions,
    totalDeductions,
    sssEmployer: deductions.sss.employer,
    philHealthEmployer: deductions.philHealth.employer,
    pagIBIGEmployer: deductions.pagIBIG.employer,
    netPay: Math.round((grossPay - totalDeductions) * 100) / 100,
  }
}

export async function savePayrollRecord(record: PayrollResult, db: Queryable = pool): Promise<string> {
  const result = await db.query(
    `INSERT INTO payroll_records (
      employee_id, payroll_period_id,
      basic_salary, daily_rate, hourly_rate,
      regular_pay, overtime_pay, holiday_pay, night_diff_pay, allowances, other_earnings, gross_pay,
      excess_minutes, offset_earned_minutes, offset_used_minutes, undertime_minutes, offset_balance_minutes,
      absence_deduction, late_deduction,
      sss_employee, phil_health_employee, pag_ibig_employee, withholding_tax,
      loan_deductions, other_deductions, total_deductions,
      sss_employer, phil_health_employer, pag_ibig_employer,
      net_pay, status
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,'draft'
    )
    ON CONFLICT (employee_id, payroll_period_id)
    DO UPDATE SET
      basic_salary = EXCLUDED.basic_salary,
      daily_rate = EXCLUDED.daily_rate,
      hourly_rate = EXCLUDED.hourly_rate,
      regular_pay = EXCLUDED.regular_pay,
      overtime_pay = EXCLUDED.overtime_pay,
      holiday_pay = EXCLUDED.holiday_pay,
      night_diff_pay = EXCLUDED.night_diff_pay,
      allowances = EXCLUDED.allowances,
      other_earnings = EXCLUDED.other_earnings,
      gross_pay = EXCLUDED.gross_pay,
      excess_minutes = EXCLUDED.excess_minutes,
      offset_earned_minutes = EXCLUDED.offset_earned_minutes,
      offset_used_minutes = EXCLUDED.offset_used_minutes,
      undertime_minutes = EXCLUDED.undertime_minutes,
      offset_balance_minutes = EXCLUDED.offset_balance_minutes,
      absence_deduction = EXCLUDED.absence_deduction,
      late_deduction = EXCLUDED.late_deduction,
      sss_employee = EXCLUDED.sss_employee,
      phil_health_employee = EXCLUDED.phil_health_employee,
      pag_ibig_employee = EXCLUDED.pag_ibig_employee,
      withholding_tax = EXCLUDED.withholding_tax,
      loan_deductions = EXCLUDED.loan_deductions,
      other_deductions = EXCLUDED.other_deductions,
      total_deductions = EXCLUDED.total_deductions,
      sss_employer = EXCLUDED.sss_employer,
      phil_health_employer = EXCLUDED.phil_health_employer,
      pag_ibig_employer = EXCLUDED.pag_ibig_employer,
      net_pay = EXCLUDED.net_pay,
      updated_at = NOW()
    RETURNING id`,
    [
      record.employeeId, record.payrollPeriodId,
      record.basicSalary, record.dailyRate, record.hourlyRate,
      record.regularPay, record.overtimePay, record.holidayPay, record.nightDiffPay,
      record.allowances, record.otherEarnings, record.grossPay,
      record.excessMinutes, record.offsetEarnedMinutes, record.offsetUsedMinutes,
      record.undertimeMinutes, record.offsetBalanceMinutes,
      record.absenceDeduction, record.lateDeduction,
      record.sssEmployee, record.philHealthEmployee, record.pagIBIGEmployee,
      record.withholdingTax, record.loanDeductions, record.otherDeductions,
      record.totalDeductions,
      record.sssEmployer, record.philHealthEmployer, record.pagIBIGEmployer,
      record.netPay,
    ]
  )
  return result.rows[0].id
}

export async function processBatchPayroll(payrollPeriodId: string, db: Queryable = pool): Promise<{
  processed: number
  errors: Array<{ employeeId: string; error: string }>
}> {
  const period = await db.query(
    `SELECT start_date, end_date FROM payroll_periods WHERE id = $1`,
    [payrollPeriodId]
  )
  if (!period.rows[0]) {
    throw createError('Payroll period not found', 404)
  }

  // Fetch all active employees for this period
  const employees = await db.query(
    `SELECT e.id, e.basic_salary, e.work_days_per_month, e.work_hours_per_day,
            COALESCE(SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END), 0) AS absence_days,
            COALESCE(SUM(CASE WHEN a.status = 'late' THEN a.late_minutes ELSE 0 END), 0) AS late_mins,
            COALESCE(SUM(a.overtime_hours), 0) AS overtime_hours,
            COALESCE(SUM(a.holiday_hours), 0) AS holiday_hours,
            0 AS night_diff_hours,
            COALESCE(SUM(a.excess_minutes), 0) AS excess_minutes,
            COALESCE(SUM(a.offset_earned_minutes), 0) AS offset_earned_minutes,
            COALESCE(SUM(a.offset_used_minutes), 0) AS offset_used_minutes,
            COALESCE(SUM(a.undertime_minutes), 0) AS undertime_minutes,
            COALESCE((
              SELECT SUM(oc.minutes_remaining)
              FROM offset_credits oc
              WHERE oc.employee_id = e.id AND oc.status = 'approved'
            ), 0) AS offset_balance_minutes,
            (SELECT COALESCE(SUM(monthly_payment), 0) FROM loans l WHERE l.employee_id = e.id AND l.is_active = true) AS loan_deductions
     FROM employees e
     LEFT JOIN payroll_periods pp ON pp.id = $1
     LEFT JOIN attendance a ON a.employee_id = e.id
       AND a.date BETWEEN pp.start_date AND pp.end_date
     WHERE e.employment_status = 'active'
     GROUP BY e.id, e.basic_salary, e.work_days_per_month, e.work_hours_per_day`,
    [payrollPeriodId]
  )

  const errors: Array<{ employeeId: string; error: string }> = []
  let processed = 0

  for (const emp of employees.rows) {
    try {
      const workDaysPerMonth = emp.work_days_per_month ?? 22
      const totalWorkDays = period.rows[0]
        ? countWorkingDays(new Date(period.rows[0].start_date), new Date(period.rows[0].end_date))
        : workDaysPerMonth
      const daysWorked = Math.max(0, totalWorkDays - Number(emp.absence_days))

      const result = computePayroll({
        employeeId: emp.id,
        payrollPeriodId,
        basicSalary: Number(emp.basic_salary),
        daysWorked,
        absenceDays: Number(emp.absence_days),
        lateMins: Number(emp.late_mins),
        overtimeHours: Number(emp.overtime_hours),
        holidayHours: Number(emp.holiday_hours),
        nightDiffHours: Number(emp.night_diff_hours),
        excessMinutes: Number(emp.excess_minutes),
        offsetEarnedMinutes: Number(emp.offset_earned_minutes),
        offsetUsedMinutes: Number(emp.offset_used_minutes),
        undertimeMinutes: Number(emp.undertime_minutes),
        offsetBalanceMinutes: Number(emp.offset_balance_minutes),
        allowances: 0,
        otherEarnings: 0,
        loanDeductions: Number(emp.loan_deductions),
        otherDeductions: 0,
        workDaysPerMonth,
        workHoursPerDay: emp.work_hours_per_day ?? 8,
      })

      await savePayrollRecord(result, db)
      processed++
    } catch (err) {
      errors.push({ employeeId: emp.id, error: (err as Error).message })
    }
  }

  return { processed, errors }
}
