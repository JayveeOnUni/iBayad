/**
 * Formatting-only payroll utility.
 *
 * Final payroll, statutory deductions, taxable income, and net pay are computed
 * by the backend payroll APIs. Keeping this file free of tax formulas prevents
 * the client from drifting from stored payroll records.
 */
export function formatPeso(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(amount)
}
