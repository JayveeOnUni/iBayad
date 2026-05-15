import {
  computeGovernmentDeductions,
  computeWithholdingTax,
  type PayFrequency,
} from './statutoryDeductions'

export interface DeductionSummary {
  sss: { employee: number; employer: number }
  philHealth: { employee: number; employer: number }
  pagIBIG: { employee: number; employer: number }
  taxableIncome: number
  withholdingTax: number
  totalEmployeeDeductions: number
  totalEmployerContributions: number
  netPay: number
  ruleVersion: string
}

/**
 * Backward-compatible monthly statutory summary.
 * New payroll runs should call computeGovernmentDeductions directly so the
 * deduction allocation follows the payroll frequency and cutoff dates.
 */
export function computeDeductions(
  grossMonthlyPay: number,
  payFrequency: PayFrequency = 'monthly',
  periodEndDate: Date | string = new Date()
): DeductionSummary {
  const deductions = computeGovernmentDeductions({
    monthlyBasicSalary: grossMonthlyPay,
    taxableGrossForPeriod: grossMonthlyPay,
    payFrequency,
    periodEndDate,
    expectedWorkDays: 22,
    workDaysPerMonth: 22,
  })

  return {
    sss: { employee: deductions.sss.employee, employer: deductions.sss.employer },
    philHealth: { employee: deductions.philHealth.employee, employer: deductions.philHealth.employer },
    pagIBIG: { employee: deductions.pagIBIG.employee, employer: deductions.pagIBIG.employer },
    taxableIncome: deductions.taxableIncome,
    withholdingTax: deductions.withholdingTax,
    totalEmployeeDeductions: deductions.totalEmployeeDeductions,
    totalEmployerContributions: deductions.totalEmployerContributions,
    netPay: Math.round((grossMonthlyPay - deductions.totalEmployeeDeductions) * 100) / 100,
    ruleVersion: deductions.ruleVersion,
  }
}

export { computeGovernmentDeductions, computeWithholdingTax }

export function formatPeso(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(amount)
}
