import pool from '../utils/db'
import { computeGovernmentDeductionsForPeriod, type PayFrequency } from '../utils/statutoryDeductions'
import { getDailyRate, getHourlyRate, countWorkingDays } from '../utils/dateHelpers'
import { createError } from '../middleware/errorHandler'
import type { Pool, PoolClient } from 'pg'
import crypto from 'crypto'
import { getPayrollPolicySettings } from './settingsService'
import {
  getPayrollComputationWindow,
  payrollComputationEndExpression,
  payrollEligibleEmployeeCondition,
} from './payrollEmployeeEligibility'

type Queryable = Pool | PoolClient

export interface PayrollInput {
  employeeId: string
  payrollPeriodId: string
  basicSalary: number
  payFrequency: PayFrequency
  periodEndDate: Date | string
  expectedWorkDays: number
  daysWorked: number
  absenceDays: number
  paidLeaveDays: number
  unpaidLeaveDays: number
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
  nonTaxableEarnings?: number
  preTaxDeductions?: number
  leaveAdjustmentDeductions?: number
  leaveAdjustmentEarnings?: number
  leaveAdjustmentUnpaidDays?: number
  leaveAdjustmentIds?: string[]
  leaveAdjustmentItems?: Array<Record<string, unknown>>
  loanDeductionItems?: PayrollLoanDeductionDraft[]
  otherEarnings: number
  loanDeductions: number
  otherDeductions: number
  workDaysPerMonth?: number
  workHoursPerDay?: number
  regularHolidayRate?: number
  nightDifferentialEnabled?: boolean
}

export interface PayrollResult {
  employeeId: string
  payrollPeriodId: string
  basicSalary: number
  dailyRate: number
  hourlyRate: number
  expectedWorkDays: number
  daysWorked: number
  paidLeaveDays: number
  unpaidLeaveDays: number
  lateMinutes: number
  // Earnings
  regularPay: number
  overtimePay: number
  holidayPay: number
  nightDiffPay: number
  allowances: number
  taxableEarnings: number
  nonTaxableEarnings: number
  paidLeaveAmount: number
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
  undertimeDeduction: number
  leaveDeduction: number
  sssEmployee: number
  philHealthEmployee: number
  pagIBIGEmployee: number
  preTaxDeductions: number
  statutoryDeductions: number
  postTaxDeductions: number
  taxableIncome: number
  withholdingTax: number
  loanDeductions: number
  otherDeductions: number
  totalDeductions: number
  // Employer contributions
  sssEmployer: number
  philHealthEmployer: number
  pagIBIGEmployer: number
  employerContributions: number
  // Net
  netPay: number
  statutoryRuleVersion: string
  statutoryRuleVersions: Record<string, unknown>
  computationBreakdown: Record<string, unknown>
  leaveAdjustmentIds: string[]
  loanDeductionItems: PayrollLoanDeductionDraft[]
}

export interface PayrollLoanDeductionDraft {
  employeeId: string
  loanId: string
  payrollPeriodId: string
  scheduledAmount: number
  deductedAmount: number
  remainingBalanceBefore: number
  remainingBalanceAfter: number
  deductionDate: string
}

interface PayrollSnapshotContext {
  payrollRecordId: string
  payrollPeriodId: string
  payrollFrequency: PayFrequency
  periodStart: Date | string
  periodEnd: Date | string
  computedBy?: string
}

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

function localDateOnly(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export async function computePayroll(input: PayrollInput, db: Queryable = pool): Promise<PayrollResult> {
  const policy = input.regularHolidayRate === undefined || input.nightDifferentialEnabled === undefined
    ? await getPayrollPolicySettings()
    : null
  const workDaysPerMonth = input.workDaysPerMonth ?? 22
  const workHoursPerDay = input.workHoursPerDay ?? 8
  const regularHolidayRate = input.regularHolidayRate ?? policy?.regularHolidayRate ?? 2.0
  const nightDifferentialEnabled = input.nightDifferentialEnabled ?? policy?.nightDifferentialEnabled ?? false

  const dailyRate = getDailyRate(input.basicSalary, workDaysPerMonth)
  const hourlyRate = getHourlyRate(dailyRate, workHoursPerDay)
  const expectedWorkDays = Math.max(0, input.expectedWorkDays)
  const daysWorked = Math.max(0, input.daysWorked)
  const absenceDays = Math.max(0, input.absenceDays)
  const paidLeaveDays = Math.max(0, input.paidLeaveDays)
  const unpaidLeaveDays = Math.max(0, input.unpaidLeaveDays)
  const undertimeOnlyMinutes = Math.max(0, input.undertimeMinutes - input.lateMins)

  // Earnings
  const regularPay = Math.round(dailyRate * expectedWorkDays * 100) / 100
  const overtimePay = Math.round(hourlyRate * input.overtimeHours * 1.25 * 100) / 100
  const holidayPay = round2(hourlyRate * input.holidayHours * regularHolidayRate)
  const nightDiffHours = nightDifferentialEnabled ? Math.max(0, input.nightDiffHours) : 0
  const nightDiffPay = round2(hourlyRate * nightDiffHours * 0.10)

  const paidLeaveAmount = round2(dailyRate * paidLeaveDays)
  const leaveAdjustmentEarnings = round2(input.leaveAdjustmentEarnings ?? 0)
  const taxableEarnings = round2(
    regularPay + overtimePay + holidayPay + nightDiffPay + input.allowances + input.otherEarnings + leaveAdjustmentEarnings
  )
  const nonTaxableEarnings = round2(input.nonTaxableEarnings ?? 0)
  const grossPay = round2(taxableEarnings + nonTaxableEarnings)

  // Absence and time-based deductions. Late minutes can also reduce rendered time,
  // so only undertime beyond late minutes is added to avoid double-counting.
  const absenceDeduction = Math.round(dailyRate * absenceDays * 100) / 100
  const lateDeduction = Math.round(hourlyRate * (input.lateMins / 60) * 100) / 100
  const undertimeDeduction = Math.round(hourlyRate * (undertimeOnlyMinutes / 60) * 100) / 100
  const adjustmentUnpaidValue = dailyRate * (input.leaveAdjustmentUnpaidDays ?? 0)
  const adjustmentDeductionDelta = Math.max(0, (input.leaveAdjustmentDeductions ?? 0) - adjustmentUnpaidValue)
  const leaveDeduction = round2((dailyRate * unpaidLeaveDays) + adjustmentDeductionDelta)
  const preTaxDeductions = round2(input.preTaxDeductions ?? 0)
  const taxableGrossForPeriod = round2(Math.max(
    0,
    taxableEarnings - absenceDeduction - lateDeduction - undertimeDeduction - leaveDeduction
  ))

  const statutory = await computeGovernmentDeductionsForPeriod({
    monthlyBasicSalary: input.basicSalary,
    taxableGrossForPeriod,
    payFrequency: input.payFrequency,
    periodEndDate: input.periodEndDate,
    expectedWorkDays,
    workDaysPerMonth,
    preTaxDeductions,
  }, db)

  const statutoryDeductions = round2(
    statutory.sss.employee +
    statutory.philHealth.employee +
    statutory.pagIBIG.employee +
    statutory.withholdingTax
  )
  const loanDeductions = 0
  const loanDeductionItems: PayrollLoanDeductionDraft[] = []
  const postTaxDeductions = round2(loanDeductions + input.otherDeductions)
  const employerContributions = round2(
    statutory.sss.employer +
    statutory.philHealth.employer +
    statutory.pagIBIG.employer
  )

  // Total employee deductions
  const totalDeductions =
    absenceDeduction +
    lateDeduction +
    undertimeDeduction +
    leaveDeduction +
    preTaxDeductions +
    statutoryDeductions +
    postTaxDeductions

  const netPay = round2(grossPay - totalDeductions)
  const computationBreakdown = {
    earnings: {
      basicPay: regularPay,
      overtimePay,
      holidayPay,
      nightDiffPay,
      paidLeaveAmount,
      regularHolidayRate,
      nightDifferentialEnabled,
      nightDiffHours,
      taxableAllowances: input.allowances,
      otherTaxableEarnings: input.otherEarnings,
      nonTaxableEarnings,
      taxableEarnings,
      grossPay,
    },
    deductions: {
      absenceDeduction,
      lateDeduction,
      undertimeDeduction,
      unpaidLeaveDeduction: leaveDeduction,
      preTaxDeductions,
      loanDeductions,
      otherDeductions: input.otherDeductions,
      statutoryDeductions,
      totalDeductions: round2(totalDeductions),
    },
    governmentDeductions: {
      sssEmployee: statutory.sss.employee,
      philHealthEmployee: statutory.philHealth.employee,
      pagIBIGEmployee: statutory.pagIBIG.employee,
      withholdingTax: statutory.withholdingTax,
      taxableIncome: statutory.taxableIncome,
    },
    employerContributions: {
      sssEmployer: statutory.sss.employer,
      philHealthEmployer: statutory.philHealth.employer,
      pagIBIGEmployer: statutory.pagIBIG.employer,
      total: employerContributions,
    },
    leaveAdjustments: input.leaveAdjustmentItems ?? [],
    leaveAdjustmentIds: input.leaveAdjustmentIds ?? [],
    loanDeductions: loanDeductionItems,
    statutoryRuleVersions: statutory.ruleVersions,
    netPay,
  }

  return {
    employeeId: input.employeeId,
    payrollPeriodId: input.payrollPeriodId,
    basicSalary: input.basicSalary,
    dailyRate,
    hourlyRate,
    expectedWorkDays,
    daysWorked,
    paidLeaveDays,
    unpaidLeaveDays,
    lateMinutes: Math.round(input.lateMins),
    regularPay,
    overtimePay,
    holidayPay,
    nightDiffPay,
    allowances: input.allowances,
    taxableEarnings,
    nonTaxableEarnings,
    paidLeaveAmount,
    otherEarnings: input.otherEarnings,
    grossPay,
    excessMinutes: Math.round(input.excessMinutes),
    offsetEarnedMinutes: Math.round(input.offsetEarnedMinutes),
    offsetUsedMinutes: Math.round(input.offsetUsedMinutes),
    undertimeMinutes: Math.round(input.undertimeMinutes),
    offsetBalanceMinutes: Math.round(input.offsetBalanceMinutes),
    absenceDeduction,
    lateDeduction,
    undertimeDeduction,
    leaveDeduction,
    sssEmployee: statutory.sss.employee,
    philHealthEmployee: statutory.philHealth.employee,
    pagIBIGEmployee: statutory.pagIBIG.employee,
    preTaxDeductions,
    statutoryDeductions,
    postTaxDeductions,
    taxableIncome: statutory.taxableIncome,
    withholdingTax: statutory.withholdingTax,
    loanDeductions,
    otherDeductions: input.otherDeductions,
    totalDeductions,
    sssEmployer: statutory.sss.employer,
    philHealthEmployer: statutory.philHealth.employer,
    pagIBIGEmployer: statutory.pagIBIG.employer,
    employerContributions,
    netPay,
    statutoryRuleVersion: statutory.ruleVersion,
    statutoryRuleVersions: statutory.ruleVersions,
    computationBreakdown,
    leaveAdjustmentIds: input.leaveAdjustmentIds ?? [],
    loanDeductionItems,
  }
}

export async function savePayrollRecord(record: PayrollResult, db: Queryable = pool): Promise<string> {
  const result = await db.query(
    `INSERT INTO payroll_records (
      employee_id, payroll_period_id,
      basic_salary, daily_rate, hourly_rate,
      expected_work_days, days_worked, paid_leave_days, unpaid_leave_days, late_minutes,
      regular_pay, overtime_pay, holiday_pay, night_diff_pay, allowances, other_earnings,
      taxable_earnings, non_taxable_earnings, paid_leave_amount, gross_pay,
      excess_minutes, offset_earned_minutes, offset_used_minutes, undertime_minutes, offset_balance_minutes,
      absence_deduction, late_deduction, undertime_deduction, leave_deduction,
      sss_employee, phil_health_employee, pag_ibig_employee, taxable_income, withholding_tax,
      pre_tax_deductions, statutory_deductions, post_tax_deductions,
      loan_deductions, other_deductions, total_deductions,
      sss_employer, phil_health_employer, pag_ibig_employer,
      employer_contributions, net_pay, statutory_rule_version, statutory_rule_versions, computation_breakdown, status
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,'processed'
    )
    ON CONFLICT (employee_id, payroll_period_id)
    DO UPDATE SET
      basic_salary = EXCLUDED.basic_salary,
      daily_rate = EXCLUDED.daily_rate,
      hourly_rate = EXCLUDED.hourly_rate,
      expected_work_days = EXCLUDED.expected_work_days,
      days_worked = EXCLUDED.days_worked,
      paid_leave_days = EXCLUDED.paid_leave_days,
      unpaid_leave_days = EXCLUDED.unpaid_leave_days,
      late_minutes = EXCLUDED.late_minutes,
      regular_pay = EXCLUDED.regular_pay,
      overtime_pay = EXCLUDED.overtime_pay,
      holiday_pay = EXCLUDED.holiday_pay,
      night_diff_pay = EXCLUDED.night_diff_pay,
      allowances = EXCLUDED.allowances,
      other_earnings = EXCLUDED.other_earnings,
      taxable_earnings = EXCLUDED.taxable_earnings,
      non_taxable_earnings = EXCLUDED.non_taxable_earnings,
      paid_leave_amount = EXCLUDED.paid_leave_amount,
      gross_pay = EXCLUDED.gross_pay,
      excess_minutes = EXCLUDED.excess_minutes,
      offset_earned_minutes = EXCLUDED.offset_earned_minutes,
      offset_used_minutes = EXCLUDED.offset_used_minutes,
      undertime_minutes = EXCLUDED.undertime_minutes,
      offset_balance_minutes = EXCLUDED.offset_balance_minutes,
      absence_deduction = EXCLUDED.absence_deduction,
      late_deduction = EXCLUDED.late_deduction,
      undertime_deduction = EXCLUDED.undertime_deduction,
      leave_deduction = EXCLUDED.leave_deduction,
      sss_employee = EXCLUDED.sss_employee,
      phil_health_employee = EXCLUDED.phil_health_employee,
      pag_ibig_employee = EXCLUDED.pag_ibig_employee,
      taxable_income = EXCLUDED.taxable_income,
      withholding_tax = EXCLUDED.withholding_tax,
      pre_tax_deductions = EXCLUDED.pre_tax_deductions,
      statutory_deductions = EXCLUDED.statutory_deductions,
      post_tax_deductions = EXCLUDED.post_tax_deductions,
      loan_deductions = EXCLUDED.loan_deductions,
      other_deductions = EXCLUDED.other_deductions,
      total_deductions = EXCLUDED.total_deductions,
      sss_employer = EXCLUDED.sss_employer,
      phil_health_employer = EXCLUDED.phil_health_employer,
      pag_ibig_employer = EXCLUDED.pag_ibig_employer,
      employer_contributions = EXCLUDED.employer_contributions,
      net_pay = EXCLUDED.net_pay,
      statutory_rule_version = EXCLUDED.statutory_rule_version,
      statutory_rule_versions = EXCLUDED.statutory_rule_versions,
      computation_breakdown = EXCLUDED.computation_breakdown,
      updated_at = NOW()
    WHERE payroll_records.is_locked = false
      AND payroll_records.status::text NOT IN ('cancelled', 'voided')
    RETURNING id`,
    [
      record.employeeId, record.payrollPeriodId,
      record.basicSalary, record.dailyRate, record.hourlyRate,
      record.expectedWorkDays, record.daysWorked, record.paidLeaveDays, record.unpaidLeaveDays, record.lateMinutes,
      record.regularPay, record.overtimePay, record.holidayPay, record.nightDiffPay,
      record.allowances, record.otherEarnings, record.taxableEarnings,
      record.nonTaxableEarnings, record.paidLeaveAmount, record.grossPay,
      record.excessMinutes, record.offsetEarnedMinutes, record.offsetUsedMinutes,
      record.undertimeMinutes, record.offsetBalanceMinutes,
      record.absenceDeduction, record.lateDeduction, record.undertimeDeduction, record.leaveDeduction,
      record.sssEmployee, record.philHealthEmployee, record.pagIBIGEmployee,
      record.taxableIncome, record.withholdingTax, record.preTaxDeductions, record.statutoryDeductions,
      record.postTaxDeductions, record.loanDeductions, record.otherDeductions,
      record.totalDeductions,
      record.sssEmployer, record.philHealthEmployer, record.pagIBIGEmployer,
      record.employerContributions, record.netPay, record.statutoryRuleVersion,
      JSON.stringify(record.statutoryRuleVersions), JSON.stringify(record.computationBreakdown),
    ]
  )
  if (!result.rows[0]) {
    throw createError('Locked payroll records cannot be recalculated or overwritten.', 409)
  }
  return result.rows[0].id
}

async function createPayrollCalculationSnapshot(
  record: PayrollResult,
  context: PayrollSnapshotContext,
  db: Queryable = pool
): Promise<string> {
  const attendanceResult = await db.query(
    `SELECT
       COUNT(*)::int AS attendance_rows,
       COALESCE(SUM(CASE WHEN status IN ('present', 'late', 'half_day') THEN 1 ELSE 0 END), 0) AS days_worked,
       COALESCE(SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END), 0) AS absence_days,
       COALESCE(SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END), 0) AS leave_days,
       COALESCE(SUM(late_minutes), 0) AS late_minutes,
       COALESCE(SUM(undertime_minutes), 0) AS undertime_minutes,
       COALESCE(SUM(overtime_hours), 0) AS overtime_hours,
       COALESCE(SUM(holiday_hours), 0) AS holiday_hours,
       COALESCE(SUM(excess_minutes), 0) AS excess_minutes,
       COALESCE(SUM(offset_earned_minutes), 0) AS offset_earned_minutes,
       COALESCE(SUM(offset_used_minutes), 0) AS offset_used_minutes
     FROM attendance
     WHERE employee_id = $1
       AND date BETWEEN $2::date AND $3::date`,
    [record.employeeId, dateOnly(context.periodStart), dateOnly(context.periodEnd)]
  )

  const breakdown = record.computationBreakdown ?? {}
  const earningsBreakdown = (breakdown.earnings ?? {}) as Record<string, unknown>
  const deductionsBreakdown = (breakdown.deductions ?? {}) as Record<string, unknown>
  const employerBreakdown = (breakdown.employerContributions ?? {}) as Record<string, unknown>
  const loanDeductionIds = record.loanDeductionItems.map((item) => item.loanId)
  const snapshotPayload = {
    payrollRecordId: context.payrollRecordId,
    payrollPeriodId: context.payrollPeriodId,
    employeeId: record.employeeId,
    formulaVersion: 'phase3-v1',
    payrollFrequency: context.payrollFrequency,
    periodStart: dateOnly(context.periodStart),
    periodEnd: dateOnly(context.periodEnd),
    attendanceSummary: attendanceResult.rows[0] ?? {},
    leaveAdjustmentIds: record.leaveAdjustmentIds,
    loanDeductionIds,
    statutoryRuleVersions: record.statutoryRuleVersions,
    earningsBreakdown,
    deductionsBreakdown,
    employerBreakdown,
    taxableIncome: record.taxableIncome,
    nonTaxableEarnings: record.nonTaxableEarnings,
    grossPay: record.grossPay,
    totalDeductions: record.totalDeductions,
    netPay: record.netPay,
  }
  const snapshotHash = crypto
    .createHash('sha256')
    .update(stableStringify(snapshotPayload))
    .digest('hex')

  const result = await db.query(
    `WITH next_version AS (
       SELECT COALESCE(MAX(snapshot_version), 0) + 1 AS version
       FROM payroll_calculation_snapshots
       WHERE payroll_record_id = $1
     ),
     inserted AS (
       INSERT INTO payroll_calculation_snapshots (
         payroll_record_id, payroll_period_id, employee_id, snapshot_version,
         formula_version, payroll_frequency, payroll_period_start, payroll_period_end,
         attendance_summary_json, leave_adjustment_ids_json, loan_deduction_ids_json,
         statutory_rule_versions_json, earnings_breakdown_json, deductions_breakdown_json,
         employer_contributions_json, taxable_income, non_taxable_earnings, gross_pay,
         total_deductions, net_pay, computed_by, snapshot_hash
       )
       SELECT
         $1, $2, $3, version, 'phase3-v1', $4::pay_frequency, $5::date, $6::date,
         $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
         $13::jsonb, $14, $15, $16, $17, $18, $19, $20
       FROM next_version
       RETURNING id
     )
     UPDATE payroll_records
     SET current_snapshot_id = inserted.id,
         updated_at = NOW()
     FROM inserted
     WHERE payroll_records.id = $1
     RETURNING inserted.id`,
    [
      context.payrollRecordId,
      context.payrollPeriodId,
      record.employeeId,
      context.payrollFrequency,
      dateOnly(context.periodStart),
      dateOnly(context.periodEnd),
      JSON.stringify(attendanceResult.rows[0] ?? {}),
      JSON.stringify(record.leaveAdjustmentIds),
      JSON.stringify(loanDeductionIds),
      JSON.stringify(record.statutoryRuleVersions),
      JSON.stringify(earningsBreakdown),
      JSON.stringify(deductionsBreakdown),
      JSON.stringify(employerBreakdown),
      record.taxableIncome,
      record.nonTaxableEarnings,
      record.grossPay,
      record.totalDeductions,
      record.netPay,
      context.computedBy ?? null,
      snapshotHash,
    ]
  )
  return result.rows[0].id
}

async function getLeavePayrollImpact(
  db: Queryable,
  params: {
    employeeId: string
    payrollPeriodId: string
    periodStart: Date | string
    periodEnd: Date | string
    paidLeaveAttendanceDays: number
    dailyRate: number
  }
) {
  const directLeaveResult = await db.query(
    `SELECT COALESCE(SUM(
              CASE
                WHEN COALESCE(lr.unpaid_days, 0) <= 0 THEN 0
                ELSE LEAST(
                  COALESCE(lr.unpaid_days, 0),
                  GREATEST(0, (LEAST(lr.end_date, $3::date) - GREATEST(lr.start_date, $2::date) + 1))::numeric
                )
              END
            ), 0) AS unpaid_leave_days
     FROM leave_requests lr
     WHERE lr.employee_id = $1
       AND lr.status = 'approved'
       AND lr.start_date <= $3::date
       AND lr.end_date >= $2::date
       AND NOT EXISTS (
         SELECT 1
         FROM payroll_leave_adjustments pla
         WHERE pla.leave_request_id = lr.id
           AND pla.status IN ('pending', 'applied')
       )`,
    [params.employeeId, dateOnly(params.periodStart), dateOnly(params.periodEnd)]
  )

  const adjustmentsResult = await db.query(
    `SELECT pla.id, pla.leave_request_id, pla.adjustment_type, pla.days, pla.amount,
            pla.description, pla.status
     FROM payroll_leave_adjustments pla
     WHERE pla.employee_id = $1
       AND (
         pla.status = 'pending'
         OR (pla.status = 'applied' AND pla.payroll_period_id = $2)
       )
       AND (pla.payroll_period_id = $2 OR pla.payroll_period_id IS NULL)
     ORDER BY pla.created_at`,
    [params.employeeId, params.payrollPeriodId]
  )

  const adjustmentItems = adjustmentsResult.rows.map((row) => ({
    id: row.id,
    leaveRequestId: row.leave_request_id,
    type: row.adjustment_type,
    days: toNumber(row.days),
    amount: toNumber(row.amount),
    status: row.status,
    description: row.description,
  }))
  const adjustmentDeduction = adjustmentItems
    .filter((item) => String(item.type).includes('DEDUCTION'))
    .reduce((sum, item) => sum + Math.abs(item.amount), 0)
  const adjustmentEarnings = adjustmentItems
    .filter((item) => !String(item.type).includes('DEDUCTION'))
    .reduce((sum, item) => sum + Math.max(0, item.amount), 0)
  const adjustmentUnpaidDays = adjustmentItems
    .filter((item) => String(item.type).includes('UNPAID'))
    .reduce((sum, item) => sum + item.days, 0)
  const directUnpaidDays = toNumber(directLeaveResult.rows[0]?.unpaid_leave_days)
  const unpaidLeaveDays = round2(directUnpaidDays + adjustmentUnpaidDays)
  const paidLeaveDays = Math.max(0, params.paidLeaveAttendanceDays - unpaidLeaveDays)

  return {
    paidLeaveDays,
    unpaidLeaveDays,
    adjustmentDeduction: round2(adjustmentDeduction),
    adjustmentEarnings: round2(adjustmentEarnings),
    adjustmentUnpaidDays: round2(adjustmentUnpaidDays),
    adjustmentIds: adjustmentItems.map((item) => String(item.id)),
    adjustmentItems,
    paidLeaveAmount: round2(paidLeaveDays * params.dailyRate),
  }
}

async function markLeaveAdjustmentsApplied(
  db: Queryable,
  params: {
    payrollRecordId: string
    payrollPeriodId: string
    adjustmentIds: string[]
  }
): Promise<void> {
  if (!params.adjustmentIds.length) return
  await db.query(
    `UPDATE payroll_leave_adjustments
     SET payroll_period_id = $1,
         payroll_record_id = $2,
         status = 'applied',
         applied_at = COALESCE(applied_at, NOW()),
         updated_at = NOW()
     WHERE id = ANY($3::uuid[])`,
    [params.payrollPeriodId, params.payrollRecordId, params.adjustmentIds]
  )
}

async function cancelRecordsForIneligibleEmployees(
  db: Queryable,
  payrollPeriodId: string
): Promise<void> {
  const eligibilityCondition = payrollEligibleEmployeeCondition('e', 'pp')
  const records = await db.query(
    `SELECT pr.id
     FROM payroll_records pr
     JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
     JOIN employees e ON e.id = pr.employee_id
     WHERE pr.payroll_period_id = $1
       AND pr.is_locked = false
       AND NOT (${eligibilityCondition})`,
    [payrollPeriodId]
  )
  const recordIds = records.rows.map((row) => row.id)
  if (!recordIds.length) return

  await db.query(
    `DELETE FROM payroll_loan_deductions
     WHERE payroll_record_id = ANY($1::uuid[])`,
    [recordIds]
  )
  await db.query(
    `UPDATE payroll_records
     SET expected_work_days = 0,
         days_worked = 0,
         paid_leave_days = 0,
         unpaid_leave_days = 0,
         late_minutes = 0,
         regular_pay = 0,
         overtime_pay = 0,
         holiday_pay = 0,
         night_diff_pay = 0,
         allowances = 0,
         other_earnings = 0,
         taxable_earnings = 0,
         non_taxable_earnings = 0,
         paid_leave_amount = 0,
         gross_pay = 0,
         excess_minutes = 0,
         offset_earned_minutes = 0,
         offset_used_minutes = 0,
         undertime_minutes = 0,
         offset_balance_minutes = 0,
         absence_deduction = 0,
         late_deduction = 0,
         undertime_deduction = 0,
         leave_deduction = 0,
         sss_employee = 0,
         phil_health_employee = 0,
         pag_ibig_employee = 0,
         taxable_income = 0,
         withholding_tax = 0,
         pre_tax_deductions = 0,
         statutory_deductions = 0,
         post_tax_deductions = 0,
         loan_deductions = 0,
         other_deductions = 0,
         total_deductions = 0,
         sss_employer = 0,
         phil_health_employer = 0,
         pag_ibig_employer = 0,
         employer_contributions = 0,
         net_pay = 0,
         statutory_rule_version = NULL,
         statutory_rule_versions = '{}'::jsonb,
         computation_breakdown = '{"status":"cancelled","reason":"Employee is not eligible for this payroll period."}'::jsonb,
         current_snapshot_id = NULL,
         status = 'cancelled',
         updated_at = NOW()
     WHERE id = ANY($1::uuid[])
       AND is_locked = false`,
    [recordIds]
  )
}

export async function processBatchPayroll(
  payrollPeriodId: string,
  db: Queryable = pool,
  options: { computedBy?: string } = {}
): Promise<{
  processed: number
  errors: Array<{ employeeId: string; error: string }>
}> {
  const period = await db.query(
    `SELECT start_date, end_date, pay_date, pay_frequency FROM payroll_periods WHERE id = $1`,
    [payrollPeriodId]
  )
  if (!period.rows[0]) {
    throw createError('Payroll period not found', 404)
  }

  const periodRow = period.rows[0]
  const payFrequency = periodRow.pay_frequency as PayFrequency
  const payrollPolicy = await getPayrollPolicySettings()
  const nightDifferentialHoursExpression = payrollPolicy.nightDifferentialEnabled
    ? 'COALESCE(SUM(a.night_diff_hours), 0)'
    : '0'

  await cancelRecordsForIneligibleEmployees(db, payrollPeriodId)

  const eligibilityCondition = payrollEligibleEmployeeCondition('e', 'pp')
  const computationEndExpression = payrollComputationEndExpression('e', 'pp')

  // Fetch payroll-eligible employees and summarize backend-owned payroll inputs
  // inside each employee's covered part of the cutoff.
  const employees = await db.query(
    `SELECT e.id, e.basic_salary, e.work_days_per_month, e.work_hours_per_day, e.hire_date,
            e.employment_status, e.is_deleted, e.last_working_day, e.separation_date,
            ${computationEndExpression} AS payroll_period_end,
            COALESCE(SUM(CASE WHEN a.status IN ('present', 'late', 'half_day') THEN 1 ELSE 0 END), 0) AS days_worked,
            COALESCE(SUM(CASE WHEN a.status = 'on_leave' THEN 1 ELSE 0 END), 0) AS leave_attendance_days,
            COALESCE(SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END), 0) AS absence_days,
            COALESCE(SUM(CASE WHEN a.status = 'late' THEN a.late_minutes ELSE 0 END), 0) AS late_mins,
            COALESCE(SUM(a.overtime_hours), 0) AS overtime_hours,
            COALESCE(SUM(a.holiday_hours), 0) AS holiday_hours,
            ${nightDifferentialHoursExpression} AS night_diff_hours,
            COALESCE(SUM(a.excess_minutes), 0) AS excess_minutes,
            COALESCE(SUM(a.offset_earned_minutes), 0) AS offset_earned_minutes,
            COALESCE(SUM(a.offset_used_minutes), 0) AS offset_used_minutes,
            COALESCE(SUM(a.undertime_minutes), 0) AS undertime_minutes,
            COALESCE((
              SELECT SUM(oc.minutes_remaining)
              FROM offset_credits oc
              WHERE oc.employee_id = e.id AND oc.status = 'approved'
            ), 0) AS offset_balance_minutes,
            0 AS unpaid_leave_days
     FROM employees e
     LEFT JOIN payroll_periods pp ON pp.id = $1
     LEFT JOIN attendance a ON a.employee_id = e.id
       AND a.date BETWEEN pp.start_date AND pp.end_date
       AND a.date >= GREATEST(e.hire_date, pp.start_date)
       AND a.date <= ${computationEndExpression}
     WHERE ${eligibilityCondition}
       AND NOT EXISTS (
         SELECT 1
         FROM payroll_records excluded_pr
         WHERE excluded_pr.payroll_period_id = $1
           AND excluded_pr.employee_id = e.id
           AND excluded_pr.status::text IN ('cancelled', 'voided')
       )
     GROUP BY e.id, e.basic_salary, e.work_days_per_month, e.work_hours_per_day, e.hire_date,
              e.employment_status, e.is_deleted, e.last_working_day, e.separation_date, pp.end_date`,
    [payrollPeriodId]
  )

  const errors: Array<{ employeeId: string; error: string }> = []
  let processed = 0

  for (const emp of employees.rows) {
    try {
      const workDaysPerMonth = Number(emp.work_days_per_month ?? 22) || 22
      const dailyRate = getDailyRate(Number(emp.basic_salary), workDaysPerMonth)
      const computationWindow = getPayrollComputationWindow({
        employment_status: emp.employment_status,
        is_deleted: Boolean(emp.is_deleted),
        hire_date: emp.hire_date,
        last_working_day: emp.last_working_day,
        separation_date: emp.separation_date,
      }, {
        start_date: periodRow.start_date,
        end_date: periodRow.end_date,
      })
      if (!computationWindow) continue

      const employeePeriodStart = computationWindow.startDate
      const employeePeriodEnd = computationWindow.endDate
      const employeePeriodStartDate = localDateOnly(employeePeriodStart)
      const employeePeriodEndDate = localDateOnly(employeePeriodEnd)
      const employeeExpectedWorkDays = countWorkingDays(employeePeriodStart, employeePeriodEnd)
      const leaveImpact = await getLeavePayrollImpact(db, {
        employeeId: emp.id,
        payrollPeriodId,
        periodStart: employeePeriodStartDate,
        periodEnd: employeePeriodEndDate,
        paidLeaveAttendanceDays: Number(emp.leave_attendance_days),
        dailyRate,
      })
      const unpaidLeaveDays = Math.min(employeeExpectedWorkDays, leaveImpact.unpaidLeaveDays)
      const paidLeaveDays = Math.max(0, leaveImpact.paidLeaveDays)
      const daysWorked = Number(emp.days_worked)

      const result = await computePayroll({
        employeeId: emp.id,
        payrollPeriodId,
        basicSalary: Number(emp.basic_salary),
        payFrequency,
        periodEndDate: employeePeriodEndDate,
        expectedWorkDays: employeeExpectedWorkDays,
        daysWorked,
        absenceDays: Number(emp.absence_days),
        paidLeaveDays,
        unpaidLeaveDays,
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
        nonTaxableEarnings: 0,
        preTaxDeductions: 0,
        leaveAdjustmentDeductions: leaveImpact.adjustmentDeduction,
        leaveAdjustmentEarnings: leaveImpact.adjustmentEarnings,
        leaveAdjustmentUnpaidDays: leaveImpact.adjustmentUnpaidDays,
        leaveAdjustmentIds: leaveImpact.adjustmentIds,
        leaveAdjustmentItems: leaveImpact.adjustmentItems,
        otherEarnings: 0,
        loanDeductions: 0,
        loanDeductionItems: [],
        otherDeductions: 0,
        workDaysPerMonth,
        workHoursPerDay: emp.work_hours_per_day ?? 8,
        regularHolidayRate: payrollPolicy.regularHolidayRate,
        nightDifferentialEnabled: payrollPolicy.nightDifferentialEnabled,
      }, db)

      const payrollRecordId = await savePayrollRecord(result, db)
      await markLeaveAdjustmentsApplied(db, {
        payrollRecordId,
        payrollPeriodId,
        adjustmentIds: result.leaveAdjustmentIds,
      })
      await createPayrollCalculationSnapshot(result, {
        payrollRecordId,
        payrollPeriodId,
        payrollFrequency: payFrequency,
        periodStart: employeePeriodStartDate,
        periodEnd: employeePeriodEndDate,
        computedBy: options.computedBy,
      }, db)
      processed++
    } catch (err) {
      errors.push({ employeeId: emp.id, error: (err as Error).message })
    }
  }

  return { processed, errors }
}
