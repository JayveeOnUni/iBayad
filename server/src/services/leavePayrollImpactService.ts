import pool from '../utils/db'

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

export class LeavePayrollImpactService {
  static async createForApprovedLeave(params: {
    employeeId: string
    leaveRequestId: string
    unpaidDays: number
    paidDays: number
    leaveCode: string
  }): Promise<void> {
    const employee = await pool.query(
      `SELECT basic_salary, daily_rate, work_days_per_month
       FROM employees
       WHERE id = $1`,
      [params.employeeId]
    )
    const employeeRow = employee.rows[0] as Record<string, unknown> | undefined
    if (!employeeRow) return

    const dailyRate = toNumber(employeeRow.daily_rate) || toNumber(employeeRow.basic_salary) / (toNumber(employeeRow.work_days_per_month) || 22)

    if (params.unpaidDays > 0) {
      await pool.query(
        `INSERT INTO payroll_leave_adjustments (
           employee_id, leave_request_id, adjustment_type, days, amount, description, status
         ) VALUES ($1, $2, 'UNPAID_LEAVE_DEDUCTION', $3, $4, $5, 'pending')`,
        [
          params.employeeId,
          params.leaveRequestId,
          params.unpaidDays,
          Math.round(dailyRate * params.unpaidDays * 100) / 100,
          `Unpaid leave deduction from ${params.leaveCode} request`,
        ]
      )
    }

    if (params.leaveCode === 'MATERNITY') {
      await pool.query(
        `INSERT INTO payroll_leave_adjustments (
           employee_id, leave_request_id, adjustment_type, days, amount, description, status
         ) VALUES ($1, $2, 'MATERNITY_ALLOWANCE', $3, $4, 'SSS-reimbursable maternity allowance advanced by company', 'pending')`,
        [params.employeeId, params.leaveRequestId, params.paidDays, Math.round(dailyRate * params.paidDays * 100) / 100]
      )
    }

    if (params.leaveCode === 'PATERNITY') {
      await pool.query(
        `INSERT INTO payroll_leave_adjustments (
           employee_id, leave_request_id, adjustment_type, days, amount, description, status
         ) VALUES ($1, $2, 'PATERNITY_PAID_LEAVE', $3, $4, 'Paid statutory paternity leave', 'pending')`,
        [params.employeeId, params.leaveRequestId, params.paidDays, Math.round(dailyRate * params.paidDays * 100) / 100]
      )
    }

    await pool.query(
      `UPDATE leave_requests
       SET payroll_impact_status = $2, updated_at = NOW()
       WHERE id = $1`,
      [params.leaveRequestId, params.unpaidDays > 0 || params.leaveCode === 'MATERNITY' || params.leaveCode === 'PATERNITY' ? 'pending_adjustment' : 'paid_no_deduction']
    )
  }

  static async getPeriodImpacts(payrollPeriodId: string): Promise<Record<string, unknown>[]> {
    const result = await pool.query(
      `SELECT pla.*, e.first_name, e.last_name, e.employee_number, lt.code AS leave_type_code, lt.name AS leave_type_name
       FROM payroll_leave_adjustments pla
       LEFT JOIN employees e ON e.id = pla.employee_id
       LEFT JOIN leave_requests lr ON lr.id = pla.leave_request_id
       LEFT JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE pla.payroll_period_id = $1 OR pla.payroll_period_id IS NULL
       ORDER BY pla.created_at DESC`,
      [payrollPeriodId]
    )
    return result.rows
  }

  static async applyPeriodAdjustments(payrollPeriodId: string): Promise<number> {
    const result = await pool.query(
      `UPDATE payroll_leave_adjustments
       SET payroll_period_id = $1, updated_at = NOW()
       WHERE (payroll_period_id = $1 OR payroll_period_id IS NULL)
         AND status = 'pending'
       RETURNING id`,
      [payrollPeriodId]
    )
    return result.rowCount ?? 0
  }
}
