export const SEPARATED_EMPLOYEE_STATUSES = ['resigned', 'terminated', 'end_of_contract', 'inactive'] as const

export type PayrollEmploymentStatus = 'active' | typeof SEPARATED_EMPLOYEE_STATUSES[number]

const separatedStatusSql = SEPARATED_EMPLOYEE_STATUSES.map((status) => `'${status}'`).join(', ')

export function payrollEligibleEmployeeCondition(employeeAlias = 'e', periodAlias = 'pp'): string {
  return `${employeeAlias}.is_deleted = false
         AND ${employeeAlias}.hire_date <= ${periodAlias}.end_date
         AND (
           ${employeeAlias}.employment_status::text = 'active'
           OR (
             ${employeeAlias}.employment_status::text IN (${separatedStatusSql})
             AND COALESCE(${employeeAlias}.last_working_day, ${employeeAlias}.separation_date) >= ${periodAlias}.start_date
           )
         )`
}

export function payrollComputationEndExpression(employeeAlias = 'e', periodAlias = 'pp'): string {
  return `LEAST(
           CASE
             WHEN ${employeeAlias}.employment_status::text IN (${separatedStatusSql})
               THEN COALESCE(${employeeAlias}.last_working_day, ${employeeAlias}.separation_date, ${periodAlias}.end_date)
             ELSE ${periodAlias}.end_date
           END,
           ${periodAlias}.end_date
         )`
}

function dateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

function parseDateOnly(value: Date | string): Date {
  const [year, month, day] = dateOnly(value).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function maxDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right
}

export function getPayrollComputationWindow(
  employee: {
    employment_status: string
    is_deleted: boolean
    hire_date: Date | string
    last_working_day?: Date | string | null
    separation_date?: Date | string | null
  },
  period: { start_date: Date | string; end_date: Date | string }
): { startDate: Date; endDate: Date } | null {
  if (employee.is_deleted) return null

  const periodStart = parseDateOnly(period.start_date)
  const periodEnd = parseDateOnly(period.end_date)
  const hireDate = parseDateOnly(employee.hire_date)
  if (hireDate > periodEnd) return null

  let computationEnd = periodEnd
  if (employee.employment_status !== 'active') {
    if (!SEPARATED_EMPLOYEE_STATUSES.includes(employee.employment_status as typeof SEPARATED_EMPLOYEE_STATUSES[number])) return null
    const finalWorkDate = employee.last_working_day ?? employee.separation_date
    if (!finalWorkDate) return null

    const separatedThrough = parseDateOnly(finalWorkDate)
    if (separatedThrough < periodStart) return null
    computationEnd = minDate(separatedThrough, periodEnd)
  }

  const startDate = maxDate(hireDate, periodStart)
  if (startDate > computationEnd) return null
  return { startDate, endDate: computationEnd }
}
