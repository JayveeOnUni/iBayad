import { Request, Response } from 'express'
import type { PoolClient } from 'pg'
import pool from '../utils/db'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { processBatchPayroll } from '../services/payrollService'
import { computeDeductions } from '../utils/taxComputation'

const payrollStatuses = ['draft', 'processing', 'approved', 'released', 'cancelled'] as const
const payFrequencies = ['weekly', 'semi-monthly', 'monthly'] as const
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type PayrollStatus = typeof payrollStatuses[number]
type PayFrequency = typeof payFrequencies[number]
type Queryable = typeof pool | PoolClient
type WarningSeverity = 'info' | 'warning' | 'danger'

interface PayrollWarning {
  code: string
  severity: WarningSeverity
  message: string
  count?: number
}

interface CreatePeriodInput {
  name: string
  startDate: string
  endDate: string
  payDate: string
  payFrequency: PayFrequency
}

interface EnrichedPeriodRow extends Record<string, unknown> {
  id: string
  status: PayrollStatus
  active_employee_count: number
  record_count: number
  processing_record_count: number
  approved_record_count: number
  released_record_count: number
  total_gross_pay: number
  total_deductions: number
  total_net_pay: number
  negative_net_count: number
  pending_attendance_request_count: number
  pending_leave_request_count: number
}

interface PeriodFilters {
  where: string
  values: unknown[]
}

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function toInt(value: unknown): number {
  return Math.trunc(toNumber(value))
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue <= 0) return fallback
  return Math.min(numberValue, max)
}

function assertUuid(id: string, label = 'id'): void {
  if (!uuidPattern.test(id)) throw createError(`Invalid ${label}`, 400)
}

function normalizeStatus(value: unknown): PayrollStatus | undefined {
  if (!value || value === 'all') return undefined
  const status = String(value)
  if (!payrollStatuses.includes(status as PayrollStatus)) {
    throw createError('status must be draft, processing, approved, released, or cancelled', 400)
  }
  return status as PayrollStatus
}

function normalizePayFrequency(value: unknown): PayFrequency {
  const frequency = value === 'semi_monthly' ? 'semi-monthly' : String(value ?? 'semi-monthly')
  if (!payFrequencies.includes(frequency as PayFrequency)) {
    throw createError('payFrequency must be weekly, semi-monthly, or monthly', 400)
  }
  return frequency as PayFrequency
}

function parseDateOnly(value: unknown, label: string): Date {
  const text = String(value ?? '').trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!match) throw createError(`${label} must use YYYY-MM-DD format`, 400)

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw createError(`${label} is not a valid calendar date`, 400)
  }
  return date
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

function daysInclusive(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
}

function normalizeCreatePeriodInput(body: Record<string, unknown>): CreatePeriodInput {
  const name = String(body.name ?? '').trim()
  if (!name) throw createError('Payroll period name is required', 400)
  if (name.length > 100) throw createError('Payroll period name must be 100 characters or fewer', 400)

  const startDate = String(body.startDate ?? body.start_date ?? '').trim()
  const endDate = String(body.endDate ?? body.end_date ?? '').trim()
  const payDate = String(body.payDate ?? body.pay_date ?? '').trim()
  if (!startDate || !endDate || !payDate) {
    throw createError('startDate, endDate, and payDate are required', 400)
  }

  const start = parseDateOnly(startDate, 'startDate')
  const end = parseDateOnly(endDate, 'endDate')
  const pay = parseDateOnly(payDate, 'payDate')

  if (start > end) throw createError('Start date must be on or before end date', 400)
  if (pay < end) throw createError('Pay date cannot be before the payroll period end date', 400)

  const payFrequency = normalizePayFrequency(body.payFrequency ?? body.frequency)
  const periodDays = daysInclusive(start, end)
  const maxDaysByFrequency: Record<PayFrequency, number> = {
    weekly: 7,
    'semi-monthly': 16,
    monthly: 31,
  }
  if (periodDays > maxDaysByFrequency[payFrequency]) {
    throw createError(`${payFrequency} payroll periods cannot be longer than ${maxDaysByFrequency[payFrequency]} calendar days`, 400)
  }

  return { name, startDate, endDate, payDate, payFrequency }
}

function enrichPeriodRow(row: Record<string, unknown>): EnrichedPeriodRow {
  return {
    ...row,
    id: String(row.id ?? ''),
    status: String(row.status ?? 'draft') as PayrollStatus,
    active_employee_count: toInt(row.active_employee_count),
    record_count: toInt(row.record_count),
    processing_record_count: toInt(row.processing_record_count),
    approved_record_count: toInt(row.approved_record_count),
    released_record_count: toInt(row.released_record_count),
    total_gross_pay: toNumber(row.total_gross_pay),
    total_deductions: toNumber(row.total_deductions),
    total_net_pay: toNumber(row.total_net_pay),
    negative_net_count: toInt(row.negative_net_count),
    pending_attendance_request_count: toInt(row.pending_attendance_request_count),
    pending_leave_request_count: toInt(row.pending_leave_request_count),
  }
}

function countListWarnings(row: ReturnType<typeof enrichPeriodRow>): number {
  let count = 0
  const missingRecordCount = Math.max(row.active_employee_count - row.record_count, 0)
  if (row.active_employee_count === 0) count += 1
  if (row.status !== 'draft' && missingRecordCount > 0) count += 1
  count += row.negative_net_count
  if (row.pending_attendance_request_count > 0) count += 1
  if (row.pending_leave_request_count > 0) count += 1
  return count
}

function buildPeriodFilters(req: Request): PeriodFilters {
  const conditions: string[] = []
  const values: unknown[] = []
  let i = 1

  const status = normalizeStatus(req.query.status)
  if (status) {
    conditions.push(`pp.status = $${i++}`)
    values.push(status)
  }

  if (req.query.year && req.query.year !== 'all') {
    const year = Number(req.query.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw createError('year must be a valid four-digit year', 400)
    }
    conditions.push(`(EXTRACT(YEAR FROM pp.start_date) = $${i} OR EXTRACT(YEAR FROM pp.pay_date) = $${i})`)
    values.push(year)
    i++
  }

  const search = String(req.query.search ?? req.query.q ?? '').trim()
  if (search) {
    conditions.push(`pp.name ILIKE $${i++}`)
    values.push(`%${search}%`)
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  }
}

async function getPeriodSummary(periodId: string, db: Queryable = pool) {
  const result = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM employees WHERE employment_status = 'active')::int AS active_employee_count,
       COUNT(pr.id)::int AS record_count,
       COUNT(pr.id) FILTER (WHERE pr.status = 'processing')::int AS processing_record_count,
       COUNT(pr.id) FILTER (WHERE pr.status = 'approved')::int AS approved_record_count,
       COUNT(pr.id) FILTER (WHERE pr.status = 'released')::int AS released_record_count,
       COALESCE(SUM(pr.gross_pay), 0) AS total_gross_pay,
       COALESCE(SUM(pr.total_deductions), 0) AS total_deductions,
       COALESCE(SUM(pr.net_pay), 0) AS total_net_pay,
       COUNT(pr.id) FILTER (WHERE pr.net_pay < 0)::int AS negative_net_count
     FROM payroll_periods pp
     LEFT JOIN payroll_records pr ON pr.payroll_period_id = pp.id
     WHERE pp.id = $1
     GROUP BY pp.id`,
    [periodId]
  )

  const row = result.rows[0] ?? {}
  return {
    activeEmployeeCount: toInt(row.active_employee_count),
    recordCount: toInt(row.record_count),
    processingRecordCount: toInt(row.processing_record_count),
    approvedRecordCount: toInt(row.approved_record_count),
    releasedRecordCount: toInt(row.released_record_count),
    totalGrossPay: toNumber(row.total_gross_pay),
    totalDeductions: toNumber(row.total_deductions),
    totalNetPay: toNumber(row.total_net_pay),
    negativeNetCount: toInt(row.negative_net_count),
  }
}

async function findPeriodRowById(periodId: string, db: Queryable = pool) {
  const result = await db.query(
    `WITH active_employees AS (
       SELECT COUNT(*)::int AS active_employee_count
     FROM employees
     WHERE employment_status = 'active'
     ),
     summaries AS (
       SELECT payroll_period_id,
              COUNT(*)::int AS record_count,
              COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_record_count,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_record_count,
              COUNT(*) FILTER (WHERE status = 'released')::int AS released_record_count,
              COALESCE(SUM(gross_pay), 0) AS total_gross_pay,
              COALESCE(SUM(total_deductions), 0) AS total_deductions,
              COALESCE(SUM(net_pay), 0) AS total_net_pay,
              COUNT(*) FILTER (WHERE net_pay < 0)::int AS negative_net_count
       FROM payroll_records
       GROUP BY payroll_period_id
     )
     SELECT pp.*,
            ae.active_employee_count,
            COALESCE(s.record_count, 0)::int AS record_count,
            COALESCE(s.processing_record_count, 0)::int AS processing_record_count,
            COALESCE(s.approved_record_count, 0)::int AS approved_record_count,
            COALESCE(s.released_record_count, 0)::int AS released_record_count,
            COALESCE(s.total_gross_pay, 0) AS total_gross_pay,
            COALESCE(s.total_deductions, 0) AS total_deductions,
            COALESCE(s.total_net_pay, 0) AS total_net_pay,
            COALESCE(s.negative_net_count, 0)::int AS negative_net_count,
            COALESCE((
              SELECT COUNT(*)
              FROM attendance_requests ar
              WHERE ar.status = 'pending'
                AND ar.date BETWEEN pp.start_date AND pp.end_date
            ), 0)::int AS pending_attendance_request_count,
            COALESCE((
              SELECT COUNT(*)
              FROM leave_requests lr
              WHERE lr.status = 'pending'
                AND lr.start_date <= pp.end_date
                AND lr.end_date >= pp.start_date
            ), 0)::int AS pending_leave_request_count
     FROM payroll_periods pp
     CROSS JOIN active_employees ae
     LEFT JOIN summaries s ON s.payroll_period_id = pp.id
     WHERE pp.id = $1`,
    [periodId]
  )

  return result.rows[0] ? enrichPeriodRow(result.rows[0]) : undefined
}

async function countMissingAttendanceRows(period: Record<string, unknown>): Promise<number> {
  const result = await pool.query(
    `WITH work_dates AS (
       SELECT day::date AS work_date
       FROM generate_series($1::date, $2::date, interval '1 day') AS day
       WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 5
     ),
     expected AS (
       SELECT e.id AS employee_id, wd.work_date
       FROM employees e
       CROSS JOIN work_dates wd
       WHERE e.employment_status = 'active'
     )
     SELECT COUNT(*)::int AS missing_count
     FROM expected ex
     LEFT JOIN attendance a
       ON a.employee_id = ex.employee_id
      AND a.date = ex.work_date
     WHERE a.id IS NULL`,
    [dateOnly(period.start_date), dateOnly(period.end_date)]
  )
  return toInt(result.rows[0]?.missing_count)
}

let hasPayrollLeaveAdjustmentsTable: boolean | null = null

async function payrollLeaveAdjustmentsTableExists(): Promise<boolean> {
  if (hasPayrollLeaveAdjustmentsTable !== null) return hasPayrollLeaveAdjustmentsTable
  const result = await pool.query(`SELECT to_regclass('payroll_leave_adjustments') AS table_name`)
  hasPayrollLeaveAdjustmentsTable = Boolean(result.rows[0]?.table_name)
  return hasPayrollLeaveAdjustmentsTable
}

async function countPendingLeaveAdjustments(periodId: string): Promise<number> {
  if (!(await payrollLeaveAdjustmentsTableExists())) return 0
  const result = await pool.query(
    `SELECT COUNT(*)::int AS pending_count
     FROM payroll_leave_adjustments
     WHERE (payroll_period_id = $1 OR payroll_period_id IS NULL)
       AND status = 'pending'`,
    [periodId]
  )
  return toInt(result.rows[0]?.pending_count)
}

async function getPeriodWarnings(period: ReturnType<typeof enrichPeriodRow>): Promise<PayrollWarning[]> {
  const warnings: PayrollWarning[] = []
  const missingRecordCount = Math.max(period.active_employee_count - period.record_count, 0)

  if (period.active_employee_count === 0) {
    warnings.push({
      code: 'no_active_employees',
      severity: 'danger',
      message: 'No active employees are available for this payroll run.',
    })
  }

  if (period.status !== 'draft' && missingRecordCount > 0) {
    warnings.push({
      code: 'missing_payroll_records',
      severity: 'danger',
      count: missingRecordCount,
      message: `${missingRecordCount} active employee${missingRecordCount === 1 ? '' : 's'} do not have payroll records in this period.`,
    })
  }

  if (period.negative_net_count > 0) {
    warnings.push({
      code: 'negative_net_pay',
      severity: 'danger',
      count: period.negative_net_count,
      message: `${period.negative_net_count} payroll record${period.negative_net_count === 1 ? ' has' : 's have'} negative net pay.`,
    })
  }

  const missingAttendanceCount = await countMissingAttendanceRows(period)
  if (missingAttendanceCount > 0) {
    warnings.push({
      code: 'missing_attendance',
      severity: 'warning',
      count: missingAttendanceCount,
      message: `${missingAttendanceCount} expected employee workday${missingAttendanceCount === 1 ? ' is' : 's are'} missing attendance records for this cutoff.`,
    })
  }

  if (period.pending_attendance_request_count > 0) {
    warnings.push({
      code: 'pending_attendance_requests',
      severity: 'warning',
      count: period.pending_attendance_request_count,
      message: `${period.pending_attendance_request_count} attendance correction request${period.pending_attendance_request_count === 1 ? ' is' : 's are'} still pending in this cutoff.`,
    })
  }

  if (period.pending_leave_request_count > 0) {
    warnings.push({
      code: 'pending_leave_requests',
      severity: 'warning',
      count: period.pending_leave_request_count,
      message: `${period.pending_leave_request_count} leave request${period.pending_leave_request_count === 1 ? ' overlaps' : 's overlap'} this cutoff and still need review.`,
    })
  }

  const pendingLeaveAdjustmentCount = await countPendingLeaveAdjustments(String(period.id))
  if (pendingLeaveAdjustmentCount > 0) {
    warnings.push({
      code: 'pending_leave_adjustments',
      severity: 'warning',
      count: pendingLeaveAdjustmentCount,
      message: `${pendingLeaveAdjustmentCount} payroll leave adjustment${pendingLeaveAdjustmentCount === 1 ? ' is' : 's are'} pending for this period.`,
    })
  }

  return warnings
}

async function getAuditHistory(periodId: string) {
  const result = await pool.query(
    `SELECT al.id, al.action, al.entity, al.entity_id, al.old_values, al.new_values,
            al.ip_address, al.user_agent, al.created_at,
            u.email AS actor_email
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.entity = 'payroll_period'
       AND al.entity_id = $1
     ORDER BY al.created_at DESC
     LIMIT 50`,
    [periodId]
  )
  return result.rows
}

async function recordPayrollAudit(
  db: Queryable,
  params: {
    userId?: string
    action: string
    periodId: string
    oldValues?: unknown
    newValues?: unknown
    ipAddress?: string
    userAgent?: string
  }
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, 'payroll_period', $3, $4, $5, $6, $7)`,
    [
      params.userId ?? null,
      params.action,
      params.periodId,
      params.oldValues ? JSON.stringify(params.oldValues) : null,
      params.newValues ? JSON.stringify(params.newValues) : null,
      params.ipAddress ?? null,
      params.userAgent ?? null,
    ]
  )
}

function auditContext(req: Request) {
  return {
    userId: req.user?.userId,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  }
}

export const getPayrollPeriods = asyncHandler(async (req: Request, res: Response) => {
  const page = parsePositiveInt(req.query.page, 1, 10_000)
  const limit = parsePositiveInt(req.query.limit, 10, 100)
  const offset = (page - 1) * limit
  const { where, values } = buildPeriodFilters(req)

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM payroll_periods pp ${where}`, values),
    pool.query(
      `WITH active_employees AS (
         SELECT COUNT(*)::int AS active_employee_count
         FROM employees
         WHERE employment_status = 'active'
       ),
       summaries AS (
         SELECT payroll_period_id,
                COUNT(*)::int AS record_count,
                COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_record_count,
                COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_record_count,
                COUNT(*) FILTER (WHERE status = 'released')::int AS released_record_count,
                COALESCE(SUM(gross_pay), 0) AS total_gross_pay,
                COALESCE(SUM(total_deductions), 0) AS total_deductions,
                COALESCE(SUM(net_pay), 0) AS total_net_pay,
                COUNT(*) FILTER (WHERE net_pay < 0)::int AS negative_net_count
         FROM payroll_records
         GROUP BY payroll_period_id
       )
       SELECT pp.*,
              ae.active_employee_count,
              COALESCE(s.record_count, 0)::int AS record_count,
              COALESCE(s.processing_record_count, 0)::int AS processing_record_count,
              COALESCE(s.approved_record_count, 0)::int AS approved_record_count,
              COALESCE(s.released_record_count, 0)::int AS released_record_count,
              COALESCE(s.total_gross_pay, 0) AS total_gross_pay,
              COALESCE(s.total_deductions, 0) AS total_deductions,
              COALESCE(s.total_net_pay, 0) AS total_net_pay,
              COALESCE(s.negative_net_count, 0)::int AS negative_net_count,
              COALESCE((
                SELECT COUNT(*)
                FROM attendance_requests ar
                WHERE ar.status = 'pending'
                  AND ar.date BETWEEN pp.start_date AND pp.end_date
              ), 0)::int AS pending_attendance_request_count,
              COALESCE((
                SELECT COUNT(*)
                FROM leave_requests lr
                WHERE lr.status = 'pending'
                  AND lr.start_date <= pp.end_date
                  AND lr.end_date >= pp.start_date
              ), 0)::int AS pending_leave_request_count
       FROM payroll_periods pp
       CROSS JOIN active_employees ae
       LEFT JOIN summaries s ON s.payroll_period_id = pp.id
       ${where}
       ORDER BY pp.start_date DESC, pp.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    ),
  ])

  const data = dataResult.rows.map((row: Record<string, unknown>) => {
    const enriched = enrichPeriodRow(row)
    return { ...enriched, warning_count: countListWarnings(enriched) }
  })
  const total = toInt(countResult.rows[0]?.total)

  res.json({
    success: true,
    data,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  })
})

export const getPayrollPeriodById = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  const period = await findPeriodRowById(req.params.id)
  if (!period) throw createError('Payroll period not found', 404)

  const warnings = await getPeriodWarnings(period)
  const auditHistory = await getAuditHistory(req.params.id)

  res.json({
    success: true,
    data: {
      ...period,
      warning_count: warnings.length,
      warnings,
      audit_history: auditHistory,
    },
  })
})

export const createPayrollPeriod = asyncHandler(async (req: Request, res: Response) => {
  const input = normalizeCreatePeriodInput(req.body)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const duplicateName = await client.query(
      `SELECT id
       FROM payroll_periods
       WHERE LOWER(name) = LOWER($1)
         AND status <> 'cancelled'
       LIMIT 1`,
      [input.name]
    )
    if (duplicateName.rows[0]) throw createError('A non-cancelled payroll period with this name already exists', 409)

    const overlap = await client.query(
      `SELECT id, name
       FROM payroll_periods
       WHERE status <> 'cancelled'
         AND pay_frequency = $1
         AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
       LIMIT 1`,
      [input.payFrequency, input.startDate, input.endDate]
    )
    if (overlap.rows[0]) {
      throw createError(`This cutoff overlaps with existing payroll period "${overlap.rows[0].name}"`, 409)
    }

    const result = await client.query(
      `INSERT INTO payroll_periods (name, start_date, end_date, pay_date, pay_frequency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.name, input.startDate, input.endDate, input.payDate, input.payFrequency, req.user!.userId]
    )
    const period = result.rows[0]

    await recordPayrollAudit(client, {
      ...auditContext(req),
      action: 'payroll_period_created',
      periodId: period.id,
      newValues: {
        name: input.name,
        startDate: input.startDate,
        endDate: input.endDate,
        payDate: input.payDate,
        payFrequency: input.payFrequency,
        status: period.status,
      },
    })

    await client.query('COMMIT')

    const data = await findPeriodRowById(period.id)
    res.status(201).json({ success: true, data, message: 'Payroll period created.' })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export const getPayrollRecords = asyncHandler(async (req: Request, res: Response) => {
  const page = parsePositiveInt(req.query.page, 1, 10_000)
  const limit = parsePositiveInt(req.query.limit, 25, 100)
  const offset = (page - 1) * limit
  const conditions: string[] = []
  const params: unknown[] = []
  let i = 1

  if (req.query.periodId) {
    const periodId = String(req.query.periodId)
    assertUuid(periodId, 'periodId')
    conditions.push(`pr.payroll_period_id = $${i++}`)
    params.push(periodId)
  }

  if (req.query.employeeId) {
    const employeeId = String(req.query.employeeId)
    assertUuid(employeeId, 'employeeId')
    conditions.push(`pr.employee_id = $${i++}`)
    params.push(employeeId)
  }

  const status = normalizeStatus(req.query.status)
  if (status) {
    conditions.push(`pr.status = $${i++}`)
    params.push(status)
  }

  const search = String(req.query.search ?? req.query.q ?? '').trim()
  if (search) {
    conditions.push(`(e.first_name ILIKE $${i} OR e.last_name ILIKE $${i} OR e.employee_number ILIKE $${i})`)
    params.push(`%${search}%`)
    i++
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countResult, dataResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       ${where}`,
      params
    ),
    pool.query(
      `SELECT pr.*, pp.name AS period_name, pp.start_date, pp.end_date, pp.pay_date,
              pp.pay_frequency, pp.status AS period_status,
              e.first_name, e.last_name, e.employee_number, e.email, e.department_id, e.position_id,
              e.employment_status, e.employment_type, e.hire_date, e.basic_salary AS employee_basic_salary,
              d.name AS department_name, d.name AS department,
              p.title AS position_title
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       JOIN employees e ON pr.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       ${where}
       ORDER BY e.last_name, e.first_name
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    ),
  ])

  const total = toInt(countResult.rows[0]?.total)
  res.json({
    success: true,
    data: dataResult.rows,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  })
})

export const getPayrollRecordById = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  const result = await pool.query(
    `SELECT pr.*, pp.name AS period_name, pp.start_date, pp.end_date, pp.pay_date,
            pp.pay_frequency, pp.status AS period_status,
            e.first_name, e.last_name, e.employee_number, e.email, e.department_id, e.position_id,
            e.employment_status, e.employment_type, e.hire_date, e.basic_salary AS employee_basic_salary,
            d.name AS department_name, d.name AS department,
            p.title AS position_title
     FROM payroll_records pr
     JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
     JOIN employees e ON pr.employee_id = e.id
     LEFT JOIN departments d ON e.department_id = d.id
     LEFT JOIN positions p ON e.position_id = p.id
     WHERE pr.id = $1`,
    [req.params.id]
  )

  if (!result.rows[0]) throw createError('Payroll record not found', 404)
  res.json({ success: true, data: result.rows[0] })
})

export const downloadPayslip = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  const params: unknown[] = [req.params.id]
  const employeeFilter = req.user!.role === 'employee'
    ? `AND pr.employee_id = $2 AND pr.status = 'released' AND pp.status = 'released'`
    : ''
  if (employeeFilter) {
    if (!req.user!.employeeId) throw createError('No employee profile is linked to this account', 403)
    params.push(req.user!.employeeId)
  }

  const result = await pool.query(
    `SELECT pr.*, pp.name AS period_name, pp.start_date, pp.end_date, pp.pay_date,
            e.first_name, e.last_name, e.employee_number
     FROM payroll_records pr
     JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
     JOIN employees e ON e.id = pr.employee_id
     WHERE pr.id = $1 ${employeeFilter}`,
    params
  )

  const record = result.rows[0]
  if (!record) throw createError('Payslip not found or not released yet', 404)

  const lines = [
    'iBayad Payslip',
    `Employee: ${record.first_name} ${record.last_name} (${record.employee_number})`,
    `Period: ${record.period_name}`,
    `Pay date: ${dateOnly(record.pay_date)}`,
    '',
    `Regular pay: ${record.regular_pay}`,
    `Overtime pay: ${record.overtime_pay}`,
    `Holiday pay: ${record.holiday_pay}`,
    `Gross pay: ${record.gross_pay}`,
    `Absence deduction: ${record.absence_deduction}`,
    `Late/undertime deduction: ${record.late_deduction}`,
    `Offset earned: ${record.offset_earned_minutes ?? 0} minutes`,
    `Offset used: ${record.offset_used_minutes ?? 0} minutes`,
    `Offset balance after period: ${record.offset_balance_minutes ?? 0} minutes`,
    `Total deductions: ${record.total_deductions}`,
    `Net pay: ${record.net_pay}`,
  ]

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="payslip-${record.employee_number}-${dateOnly(record.pay_date)}.txt"`)
  res.send(lines.join('\n'))
})

export const getMyPayrollRecords = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.employeeId) throw createError('No employee profile is linked to this account', 403)
  const page = parsePositiveInt(req.query.page, 1, 10_000)
  const limit = parsePositiveInt(req.query.limit, 12, 100)
  const offset = (page - 1) * limit

  const [countResult, dataResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM payroll_records pr
       JOIN payroll_periods pp ON pr.payroll_period_id = pp.id
       WHERE pr.employee_id = $1
         AND pr.status = 'released'
         AND pp.status = 'released'`,
      [req.user.employeeId]
    ),
    pool.query(
      `SELECT pr.*, pp.name AS period_name, pp.start_date, pp.end_date, pp.pay_date,
              pp.pay_frequency, pp.status AS period_status
       FROM payroll_records pr
       JOIN payroll_periods pp ON pr.payroll_period_id = pp.id
       WHERE pr.employee_id = $1
         AND pr.status = 'released'
         AND pp.status = 'released'
       ORDER BY pp.pay_date DESC
       LIMIT $2 OFFSET $3`,
      [req.user.employeeId, limit, offset]
    ),
  ])

  const total = toInt(countResult.rows[0]?.total)
  res.json({
    success: true,
    data: dataResult.rows,
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  })
})

export const processPayroll = asyncHandler(async (req: Request, res: Response) => {
  const payrollPeriodId = String(req.body.payrollPeriodId ?? req.body.periodId ?? '')
  if (!payrollPeriodId) throw createError('payrollPeriodId is required', 400)
  assertUuid(payrollPeriodId, 'payrollPeriodId')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const periodResult = await client.query(
      `SELECT * FROM payroll_periods WHERE id = $1 FOR UPDATE`,
      [payrollPeriodId]
    )
    const period = periodResult.rows[0]
    if (!period) throw createError('Payroll period not found', 404)
    if (!['draft', 'processing'].includes(period.status)) {
      throw createError(`Only draft or processing payroll periods can be processed. Current status: ${period.status}`, 409)
    }

    const summaryBefore = await getPeriodSummary(payrollPeriodId, client)
    if (summaryBefore.activeEmployeeCount === 0) {
      throw createError('No active employees are available for this payroll run', 400)
    }

    const { processed, errors } = await processBatchPayroll(payrollPeriodId, client)
    if (processed === 0) throw createError('No payroll records were processed', 400)

    await client.query(
      `UPDATE payroll_periods
       SET status = 'processing',
           updated_at = NOW()
       WHERE id = $1`,
      [payrollPeriodId]
    )
    await client.query(
      `UPDATE payroll_records
       SET status = 'processing',
           updated_at = NOW()
       WHERE payroll_period_id = $1`,
      [payrollPeriodId]
    )

    await recordPayrollAudit(client, {
      ...auditContext(req),
      action: period.status === 'processing' ? 'payroll_reprocessed' : 'payroll_processed',
      periodId: payrollPeriodId,
      oldValues: { status: period.status, recordCount: summaryBefore.recordCount },
      newValues: { status: 'processing', processed, errors },
    })

    await client.query('COMMIT')

    const updatedPeriod = await findPeriodRowById(payrollPeriodId)
    if (!updatedPeriod) throw createError('Payroll period not found after processing', 404)
    const warnings = await getPeriodWarnings(updatedPeriod)
    const message = errors.length
      ? `Processed ${processed} payroll records with ${errors.length} employee error${errors.length === 1 ? '' : 's'}.`
      : `Processed ${processed} payroll records.`

    res.json({
      success: true,
      data: { period: updatedPeriod, processed, errors, warnings, warningCount: warnings.length, message },
      message,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export const approvePayroll = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const periodResult = await client.query(
      `SELECT * FROM payroll_periods WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    )
    const period = periodResult.rows[0]
    if (!period) throw createError('Payroll period not found', 404)
    if (period.status !== 'processing') {
      throw createError(`Only processing payroll periods can be approved. Current status: ${period.status}`, 409)
    }

    const summary = await getPeriodSummary(req.params.id, client)
    if (summary.recordCount === 0) throw createError('Cannot approve a payroll period with no payroll records', 400)
    if (summary.activeEmployeeCount > summary.recordCount) {
      throw createError('Cannot approve while active employees are missing payroll records', 400)
    }
    if (summary.negativeNetCount > 0) {
      throw createError('Cannot approve while payroll records have negative net pay', 400)
    }

    const updated = await client.query(
      `UPDATE payroll_periods
       SET status = 'approved',
           approved_by = $1,
           approved_at = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.user!.userId, req.params.id]
    )
    await client.query(
      `UPDATE payroll_records
       SET status = 'approved',
           updated_at = NOW()
       WHERE payroll_period_id = $1`,
      [req.params.id]
    )

    await recordPayrollAudit(client, {
      ...auditContext(req),
      action: 'payroll_approved',
      periodId: req.params.id,
      oldValues: { status: period.status },
      newValues: { status: 'approved', recordCount: summary.recordCount, totalNetPay: summary.totalNetPay },
    })

    await client.query('COMMIT')
    res.json({ success: true, data: updated.rows[0], message: 'Payroll approved.' })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export const releasePayroll = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const periodResult = await client.query(
      `SELECT * FROM payroll_periods WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    )
    const period = periodResult.rows[0]
    if (!period) throw createError('Payroll period not found', 404)
    if (period.status !== 'approved') {
      throw createError(`Only approved payroll periods can be released. Current status: ${period.status}`, 409)
    }

    const summary = await getPeriodSummary(req.params.id, client)
    if (summary.recordCount === 0) throw createError('Cannot release a payroll period with no payroll records', 400)

    const updated = await client.query(
      `UPDATE payroll_periods
       SET status = 'released',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    )
    await client.query(
      `UPDATE payroll_records
       SET status = 'released',
           updated_at = NOW()
       WHERE payroll_period_id = $1`,
      [req.params.id]
    )

    await recordPayrollAudit(client, {
      ...auditContext(req),
      action: 'payroll_released',
      periodId: req.params.id,
      oldValues: { status: period.status },
      newValues: { status: 'released', recordCount: summary.recordCount, totalNetPay: summary.totalNetPay },
    })

    await client.query('COMMIT')
    res.json({ success: true, data: updated.rows[0], message: 'Payroll released.' })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export const computeEmployeeTax = asyncHandler(async (req: Request, res: Response) => {
  const { monthlyBasicSalary } = req.query
  if (!monthlyBasicSalary) throw createError('monthlyBasicSalary is required', 400)

  const salary = Number(monthlyBasicSalary)
  if (isNaN(salary) || salary <= 0) throw createError('Invalid salary amount', 400)

  const deductions = computeDeductions(salary)
  res.json({ success: true, data: deductions })
})
