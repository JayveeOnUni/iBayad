import pool from '../utils/db'
import { LeaveAuditService } from './leaveAuditService'
import { LeaveBalanceService } from './leaveBalanceService'
import { LeavePolicyService } from './leavePolicyService'

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

export class LeaveCarryOverService {
  static async processYearEnd(year: number, actorUserId?: string): Promise<{ processed: number; forfeited: number; carriedOver: number }> {
    const vacationType = await LeavePolicyService.getLeaveTypeByCode('VACATION')
    const sickType = await LeavePolicyService.getLeaveTypeByCode('SICK')
    if (!vacationType || !sickType) throw new Error('Vacation and sick leave types must be seeded first.')

    const employees = await pool.query(`SELECT id FROM employees WHERE employment_status = 'active' AND is_deleted = false`)
    let processed = 0
    let forfeited = 0
    let carriedOver = 0

    for (const row of employees.rows as Array<{ id: string }>) {
      const employee = await LeavePolicyService.getEmployee(row.id)
      if (!employee) continue
      const balance = (await LeaveBalanceService.getBalances(row.id, year, new Date(year, 11, 31)))
        .find((item) => item.code === 'VACATION')
      if (!balance) continue

      const carryOverLimit = await LeavePolicyService.configuredCarryOverLimitFor(employee, year, 'VACATION') ?? 0
      const carry = Math.min(carryOverLimit, balance.available_balance)
      const forfeit = Math.max(0, balance.available_balance - carryOverLimit)
      carriedOver += carry
      forfeited += forfeit

      await pool.query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, year, carried_over_credits, available_balance)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (employee_id, leave_type_id, year)
         DO UPDATE SET carried_over_credits = EXCLUDED.carried_over_credits,
                       available_balance = EXCLUDED.available_balance,
                       updated_at = NOW()`,
        [row.id, vacationType.id, year + 1, carry]
      )
      if (forfeit > 0) {
        await pool.query(
          `INSERT INTO leave_balances (employee_id, leave_type_id, year, forfeited_credits)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (employee_id, leave_type_id, year)
           DO UPDATE SET forfeited_credits = leave_balances.forfeited_credits + EXCLUDED.forfeited_credits,
                         updated_at = NOW()`,
          [row.id, vacationType.id, year, forfeit]
        )
      }

      await pool.query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, year, available_balance)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (employee_id, leave_type_id, year)
         DO UPDATE SET available_balance = 0, updated_at = NOW()`,
        [row.id, sickType.id, year + 1]
      )
      processed++
    }

    await LeaveAuditService.recordEntityAudit({
      userId: actorUserId,
      action: 'leave_year_end_processed',
      entity: 'leave_balances',
      entityId: vacationType.id,
      newValues: { year, processed, carriedOver, forfeited },
    })

    return { processed, carriedOver, forfeited }
  }

  static async processCashConversion(year: number, actorUserId?: string): Promise<{ processed: number; converted: number; forfeited: number }> {
    const vacationType = await LeavePolicyService.getLeaveTypeByCode('VACATION')
    if (!vacationType) throw new Error('Vacation leave type must be seeded first.')

    const balances = await pool.query(
      `SELECT lb.employee_id, lb.leave_type_id, lb.carried_over_credits, lb.converted_to_cash_credits,
              e.basic_salary, e.daily_rate, e.work_days_per_month
       FROM leave_balances lb
       JOIN employees e ON e.id = lb.employee_id
       WHERE lb.year = $1 AND lb.leave_type_id = $2`,
      [year, vacationType.id]
    )

    let processed = 0
    let converted = 0
    let forfeited = 0

    for (const row of balances.rows as Array<Record<string, unknown>>) {
      const employee = await LeavePolicyService.getEmployee(String(row.employee_id))
      if (!employee) continue
      const carried = toNumber(row.carried_over_credits)
      const alreadyConverted = toNumber(row.converted_to_cash_credits)
      const conversionLimit = await LeavePolicyService.configuredCashConversionLimitFor(employee, year, 'VACATION') ?? 0
      const convertible = Math.max(0, Math.min(conversionLimit - alreadyConverted, carried))
      const forfeit = Math.max(0, carried - convertible - alreadyConverted)
      const dailyRate = toNumber(row.daily_rate) || toNumber(row.basic_salary) / (toNumber(row.work_days_per_month) || 22)

      if (convertible > 0) {
        await pool.query(
          `INSERT INTO payroll_leave_adjustments (
             employee_id, adjustment_type, days, amount, description, status
           ) VALUES ($1, 'VACATION_LEAVE_CASH_CONVERSION', $2, $3, 'Vacation leave cash conversion from carried-over credits', 'pending')`,
          [row.employee_id, convertible, Math.round(dailyRate * convertible * 100) / 100]
        )
      }

      await pool.query(
        `UPDATE leave_balances
         SET converted_to_cash_credits = converted_to_cash_credits + $3,
             forfeited_credits = forfeited_credits + $4,
             carried_over_credits = GREATEST(0, carried_over_credits - $3 - $4),
             updated_at = NOW()
         WHERE employee_id = $1 AND leave_type_id = $2 AND year = $5`,
        [row.employee_id, vacationType.id, convertible, forfeit, year]
      )

      converted += convertible
      forfeited += forfeit
      processed++
    }

    await LeaveAuditService.recordEntityAudit({
      userId: actorUserId,
      action: 'leave_cash_conversion_processed',
      entity: 'leave_balances',
      entityId: vacationType.id,
      newValues: { year, processed, converted, forfeited },
    })

    return { processed, converted, forfeited }
  }
}
