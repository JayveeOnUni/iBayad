import { addDays, format, isWeekend } from 'date-fns'
import type { Pool, PoolClient } from 'pg'
import pool from '../utils/db'

type Queryable = Pool | PoolClient

export class HolidayCalendarService {
  static async getNonWorkingHolidayDates(params: {
    startDate: Date
    endDate: Date
    country?: string
    cityOrProvince?: string
  }, db: Queryable = pool): Promise<Set<string>> {
    const result = await db.query(
      `SELECT COALESCE(holiday_date, date) AS holiday_date
       FROM holidays
       WHERE COALESCE(holiday_date, date) BETWEEN $1 AND $2
         AND COALESCE(country, 'Philippines') = COALESCE($3, COALESCE(country, 'Philippines'))
         AND ($4::text IS NULL OR city_or_province IS NULL OR city_or_province = $4)
         AND COALESCE(is_working_holiday, false) = false`,
      [
        format(params.startDate, 'yyyy-MM-dd'),
        format(params.endDate, 'yyyy-MM-dd'),
        params.country ?? 'Philippines',
        params.cityOrProvince ?? null,
      ]
    )

    return new Set(result.rows.map((row: { holiday_date: Date | string }) => format(new Date(row.holiday_date), 'yyyy-MM-dd')))
  }

  static async countWorkingDays(params: {
    startDate: Date
    endDate: Date
    country?: string
    cityOrProvince?: string
  }, db: Queryable = pool): Promise<number> {
    const holidayDates = await this.getNonWorkingHolidayDates(params, db)
    let count = 0
    let current = new Date(params.startDate)

    while (current <= params.endDate) {
      const key = format(current, 'yyyy-MM-dd')
      if (!isWeekend(current) && !holidayDates.has(key)) count++
      current = addDays(current, 1)
    }

    return count
  }
}
