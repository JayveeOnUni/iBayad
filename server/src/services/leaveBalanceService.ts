import pool from '../utils/db'
import { LeaveCode, LeaveEmployeeRow, LeavePolicyService } from './leavePolicyService'

export interface LeaveBalanceSummary {
  id: string
  employee_id: string
  leave_type_id: string
  code: LeaveCode
  name: string
  year: number
  opening_balance: number
  earned_credits: number
  used_credits: number
  pending_credits: number
  carried_over_credits: number
  forfeited_credits: number
  converted_to_cash_credits: number
  available_balance: number
  entitlement_stage: string
}

interface LeaveBalanceTypeRow {
  id: string
  code: LeaveCode
  name: string
  days_per_year: unknown
}

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

export class LeaveBalanceService {
  static async getBalances(employeeId: string, year: number, asOf = new Date()): Promise<LeaveBalanceSummary[]> {
    const employee = await LeavePolicyService.getEmployee(employeeId)
    if (!employee) throw new Error('Employee not found')

    const typeResult = await pool.query(
      `SELECT id, code, name, days_per_year FROM leave_types
       WHERE is_active = true
         AND code IN ('VACATION', 'SICK', 'EMERGENCY', 'BEREAVEMENT', 'NON_PAID', 'MATERNITY', 'PATERNITY')
       ORDER BY CASE code
         WHEN 'VACATION' THEN 1 WHEN 'SICK' THEN 2 WHEN 'EMERGENCY' THEN 3
         WHEN 'BEREAVEMENT' THEN 4 WHEN 'NON_PAID' THEN 5 WHEN 'MATERNITY' THEN 6
         WHEN 'PATERNITY' THEN 7 ELSE 99 END`
    )

    return Promise.all(
      typeResult.rows.map((row: LeaveBalanceTypeRow) =>
        this.getBalanceFor(employee, row.id, row.code, row.name, toNumber(row.days_per_year), year, asOf)
      )
    )
  }

  static async getAvailable(employeeId: string, code: LeaveCode, year: number, asOf = new Date()): Promise<number> {
    const employee = await LeavePolicyService.getEmployee(employeeId)
    const leaveType = await LeavePolicyService.getLeaveTypeByCode(code)
    if (!employee || !leaveType) return 0
    const typeRow = await pool.query<{ days_per_year: unknown }>(
      `SELECT days_per_year FROM leave_types WHERE id = $1`,
      [leaveType.id]
    )
    const balance = await this.getBalanceFor(
      employee,
      leaveType.id,
      code,
      leaveType.name,
      toNumber(typeRow.rows[0]?.days_per_year),
      year,
      asOf
    )
    return balance.available_balance
  }

  private static async getBalanceFor(
    employee: LeaveEmployeeRow,
    leaveTypeId: string,
    code: LeaveCode,
    name: string,
    daysPerYear: number,
    year: number,
    asOf: Date
  ): Promise<LeaveBalanceSummary> {
    const entitlement = await LeavePolicyService.configuredEntitlementFor(employee, year, code)
    const earned = await LeavePolicyService.configuredEarnedCreditsFor(employee, year, code, asOf)

    const stored = await pool.query(
      `SELECT opening_balance, carried_over_credits, forfeited_credits, converted_to_cash_credits
       FROM leave_balances
       WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
      [employee.id, leaveTypeId, year]
    )
    const storedRow = stored.rows[0] as Record<string, unknown> | undefined
    const opening = toNumber(storedRow?.opening_balance)
    const carried = code === 'VACATION' ? toNumber(storedRow?.carried_over_credits) : 0
    const forfeited = toNumber(storedRow?.forfeited_credits)
    const converted = toNumber(storedRow?.converted_to_cash_credits)

    const usage = await this.getUsage(employee.id, code, year)
    const nonAccrualOpening = ['EMERGENCY', 'NON_PAID'].includes(code) ? 0 : daysPerYear
    const baseCredits = code === 'VACATION' || code === 'SICK' ? opening + carried + earned : nonAccrualOpening
    const available = Math.max(0, Math.round((baseCredits - usage.used - usage.pending - forfeited - converted) * 100) / 100)

    return {
      id: leaveTypeId,
      employee_id: employee.id,
      leave_type_id: leaveTypeId,
      code,
      name,
      year,
      opening_balance: opening,
      earned_credits: earned,
      used_credits: usage.used,
      pending_credits: usage.pending,
      carried_over_credits: carried,
      forfeited_credits: forfeited,
      converted_to_cash_credits: converted,
      available_balance: available,
      entitlement_stage: entitlement.stage,
    }
  }

  private static async getUsage(employeeId: string, code: LeaveCode, year: number): Promise<{ used: number; pending: number }> {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(CASE
           WHEN lr.status = 'approved' AND lt.code = $2 THEN lr.total_days
           WHEN lr.status = 'approved' AND $2 = 'SICK' THEN lr.deducted_sick_days
           WHEN lr.status = 'approved' AND $2 = 'VACATION' THEN lr.deducted_vacation_days
           WHEN lr.status = 'approved' AND $2 = 'NON_PAID' THEN lr.unpaid_days
           ELSE 0 END), 0) AS used,
         COALESCE(SUM(CASE
           WHEN lr.status = 'pending' AND lt.code = $2 THEN lr.total_days
           ELSE 0 END), 0) AS pending
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.employee_id = $1
         AND EXTRACT(YEAR FROM lr.start_date) = $3`,
      [employeeId, code, year]
    )

    return {
      used: toNumber(result.rows[0]?.used),
      pending: toNumber(result.rows[0]?.pending),
    }
  }

  static async adjustBalance(params: {
    employeeId: string
    leaveTypeId: string
    year: number
    field: 'opening_balance' | 'earned_credits' | 'carried_over_credits' | 'forfeited_credits' | 'converted_to_cash_credits'
    amount: number
  }): Promise<void> {
    await pool.query(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, ${params.field})
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (employee_id, leave_type_id, year)
       DO UPDATE SET ${params.field} = leave_balances.${params.field} + EXCLUDED.${params.field}, updated_at = NOW()`,
      [params.employeeId, params.leaveTypeId, params.year, params.amount]
    )
  }
}
