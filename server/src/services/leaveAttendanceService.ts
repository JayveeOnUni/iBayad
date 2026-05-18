import { addDays, format, isWeekend } from 'date-fns'
import type { Pool, PoolClient } from 'pg'
import pool from '../utils/db'
import { HolidayCalendarService } from './holidayCalendarService'
import { LeaveDayCountType } from './leavePolicyService'

type Queryable = Pool | PoolClient

export class LeaveAttendanceService {
  static async applyApprovedLeave(params: {
    employeeId: string
    startDate: Date
    endDate: Date
    dayCountType: LeaveDayCountType
    unpaidDays: number
    leaveName: string
    userId?: string
  }, db: Queryable = pool): Promise<void> {
    const holidays = params.dayCountType === 'working_days'
      ? await HolidayCalendarService.getNonWorkingHolidayDates({ startDate: params.startDate, endDate: params.endDate }, db)
      : new Set<string>()
    let current = new Date(params.startDate)

    while (current <= params.endDate) {
      const dateKey = format(current, 'yyyy-MM-dd')
      const shouldApply = params.dayCountType === 'calendar_days' || (!isWeekend(current) && !holidays.has(dateKey))
      if (shouldApply) {
        await db.query(
          `INSERT INTO attendance (employee_id, date, status, remarks, created_by)
           VALUES ($1, $2, 'on_leave', $3, $4)
           ON CONFLICT (employee_id, date)
           DO UPDATE SET status = 'on_leave', remarks = EXCLUDED.remarks, updated_at = NOW()`,
          [
            params.employeeId,
            dateKey,
            params.unpaidDays > 0 ? `Approved unpaid/partly unpaid ${params.leaveName}` : `Approved paid ${params.leaveName}`,
            params.userId ?? null,
          ]
        )
      }
      current = addDays(current, 1)
    }
  }

  static async reverseLeave(params: { employeeId: string; startDate: Date; endDate: Date }, db: Queryable = pool): Promise<void> {
    await db.query(
      `UPDATE attendance
       SET status = 'absent', remarks = 'Leave impact reversed', updated_at = NOW()
       WHERE employee_id = $1
         AND date BETWEEN $2 AND $3
         AND status = 'on_leave'`,
      [params.employeeId, format(params.startDate, 'yyyy-MM-dd'), format(params.endDate, 'yyyy-MM-dd')]
    )
  }
}
