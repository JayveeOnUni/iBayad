import pool from '../utils/db'
import { logger } from '../utils/logger'

const CUTOFF_HOUR = 10
const CUTOFF_MINUTE = 0

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function cutoffForDate(date: Date): Date {
  const cutoff = new Date(date)
  cutoff.setHours(CUTOFF_HOUR, CUTOFF_MINUTE, 0, 0)
  return cutoff
}

function nextCutoffFrom(now: Date): Date {
  const cutoff = cutoffForDate(now)
  if (now >= cutoff) cutoff.setDate(cutoff.getDate() + 1)
  return cutoff
}

async function markEmployeesAbsentForDate(date: Date): Promise<number> {
  const dateKey = localDateString(date)
  const result = await pool.query(
    `WITH active_employees AS (
       SELECT id
       FROM employees
       WHERE employment_status = 'active' AND is_deleted = false
     ),
     approved_leave_today AS (
       SELECT DISTINCT employee_id
       FROM leave_requests
       WHERE status = 'approved'
         AND start_date <= $1::date
         AND end_date >= $1::date
     )
     INSERT INTO attendance (employee_id, date, status, remarks, created_by)
    SELECT ae.id, $1::date, 'absent', 'Auto-marked absent after 10:00 AM cutoff', $2
     FROM active_employees ae
     LEFT JOIN approved_leave_today alt ON alt.employee_id = ae.id
     WHERE alt.employee_id IS NULL
     ON CONFLICT (employee_id, date) DO UPDATE
     SET status = 'absent',
         remarks = EXCLUDED.remarks,
         updated_at = NOW()
     WHERE attendance.time_in IS NULL
       AND attendance.time_out IS NULL
       AND attendance.status IS NULL
     RETURNING employee_id`,
    [dateKey, null]
  )

  return result.rowCount
}

async function runAutoAbsentPass(now: Date): Promise<void> {
  if (now < cutoffForDate(now)) return

  const affected = await markEmployeesAbsentForDate(now)
  logger.info('Auto-mark absent after cutoff completed', {
    date: localDateString(now),
    cutoffHour: CUTOFF_HOUR,
    cutoffMinute: CUTOFF_MINUTE,
    affected,
  })
}

export function startAutoAbsentScheduler(): void {
  void runAutoAbsentPass(new Date()).catch((error) => {
    logger.error('Auto-mark absent after cutoff failed', { error })
  })

  const scheduleNext = (): void => {
    const next = nextCutoffFrom(new Date())
    const delayMs = Math.max(next.getTime() - Date.now(), 0)

    setTimeout(() => {
      void runAutoAbsentPass(new Date())
        .catch((error) => {
          logger.error('Auto-mark absent after cutoff failed', { error })
        })
        .finally(() => {
          scheduleNext()
        })
    }, delayMs)
  }

  scheduleNext()
}
