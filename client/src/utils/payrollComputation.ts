import type { PayrollRecord } from '../types'

export interface PayrollPreviewBreakdown {
  grossPay: number
  basicPay: number
  overtimePay: number
  lateDeductions: number
  undertimeDeductions: number
  absenceDeductions: number
  leaveDeductions: number
  loanDeductions: number
  governmentDeductions: number
  statutoryDeductions: number
  employerContributions: number
  nonTaxableEarnings: number
  taxableIncome: number
  withholdingTax: number
  totalDeductions: number
  netPay: number
}

/**
 * Client payroll computation is intentionally preview-only.
 * It derives display totals from a backend payroll record and never computes
 * final pay from salary, attendance, leave, loan, or statutory formulas.
 */
export function previewPayrollRecord(record: PayrollRecord): PayrollPreviewBreakdown {
  return {
    grossPay: record.grossPay,
    basicPay: record.basicPay,
    overtimePay: record.overtimePay,
    lateDeductions: record.lateDeduction,
    undertimeDeductions: record.undertimeDeduction,
    absenceDeductions: record.absenceDeduction,
    leaveDeductions: record.leaveDeduction,
    loanDeductions: record.loanDeductions,
    governmentDeductions: record.contributions.totalEmployee,
    statutoryDeductions: record.statutoryDeductions,
    employerContributions: record.employerContributions,
    nonTaxableEarnings: record.nonTaxableEarnings,
    taxableIncome: record.taxableIncome,
    withholdingTax: record.withholdingTax,
    totalDeductions: record.totalDeductions,
    netPay: record.netPay,
  }
}
