import { Request, Response } from 'express'
import type { PoolClient } from 'pg'
import pool from '../utils/db'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { processBatchPayroll } from '../services/payrollService'
import { computeDeductions } from '../utils/taxComputation'
import { buildPayrollValidationReport } from '../services/payrollValidationService'
import { listStatutoryRuleVersions } from '../utils/statutoryDeductions'
import { hasPayrollPermission } from '../middleware/auth'
import {
  buildPayslipPayload,
  buildPayrollReport,
  generatePayslipPdf,
  reportToCsv,
  type PayrollReportType,
} from '../services/payrollReportingService'

const payrollStatuses = [
  'draft',
  'processing',
  'processed',
  'validation_failed',
  'ready_for_approval',
  'needs_correction',
  'approved',
  'released',
  'locked',
  'cancelled',
] as const
const payFrequencies = ['weekly', 'semi-monthly', 'monthly'] as const
const payrollReportTypes = ['summary', 'employees', 'government-contributions', 'tax', 'loans', 'attendance'] as const
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
    throw createError(`status must be one of: ${payrollStatuses.join(', ')}`, 400)
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
       COUNT(pr.id) FILTER (WHERE pr.status IN ('processing', 'processed', 'validation_failed', 'ready_for_approval', 'needs_correction'))::int AS processing_record_count,
       COUNT(pr.id) FILTER (WHERE pr.status = 'approved')::int AS approved_record_count,
       COUNT(pr.id) FILTER (WHERE pr.status IN ('released', 'locked'))::int AS released_record_count,
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
              COUNT(*) FILTER (WHERE status IN ('processing', 'processed', 'validation_failed', 'ready_for_approval', 'needs_correction'))::int AS processing_record_count,
              COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_record_count,
              COUNT(*) FILTER (WHERE status IN ('released', 'locked'))::int AS released_record_count,
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
  const periodResult = await pool.query(
    `SELECT start_date, end_date FROM payroll_periods WHERE id = $1`,
    [periodId]
  )
  const period = periodResult.rows[0]
  if (!period) return 0
  const result = await pool.query(
    `SELECT COUNT(*)::int AS pending_count
     FROM payroll_leave_adjustments pla
     LEFT JOIN leave_requests lr ON lr.id = pla.leave_request_id
     WHERE (pla.payroll_period_id = $1 OR pla.payroll_period_id IS NULL)
       AND pla.status = 'pending'
       AND (
         lr.id IS NULL
         OR (lr.start_date <= $3::date AND lr.end_date >= $2::date)
       )`,
    [periodId, period.start_date, period.end_date]
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
      severity: 'danger',
      count: missingAttendanceCount,
      message: `${missingAttendanceCount} expected employee workday${missingAttendanceCount === 1 ? ' has' : 's have'} unrecorded attendance for this cutoff and will block approval.`,
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
    `SELECT al.id, al.action, al.entity_type AS entity, al.entity_id,
            al.old_value_json AS old_values, al.new_value_json AS new_values,
            al.reason, al.payroll_record_id, al.employee_id,
            al.ip_address, al.user_agent, al.created_at,
            u.email AS actor_email
     FROM payroll_audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.payroll_period_id = $1
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
    userRole?: string
    action: string
    periodId: string
    recordId?: string
    employeeId?: string
    entityType?: string
    entityId?: string
    oldValues?: unknown
    newValues?: unknown
    reason?: string
    reportType?: string
    filtersUsed?: unknown
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
  await db.query(
    `INSERT INTO payroll_audit_logs (
       user_id, user_role, action, entity_type, entity_id, payroll_period_id,
       payroll_record_id, employee_id, old_value_json, new_value_json,
       reason, report_type, filters_used_json, ip_address, user_agent
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      params.userId ?? null,
      params.userRole ?? null,
      params.action,
      params.entityType ?? 'payroll_period',
      params.entityId ?? params.periodId,
      params.periodId,
      params.recordId ?? null,
      params.employeeId ?? null,
      params.oldValues ? JSON.stringify(params.oldValues) : null,
      params.newValues ? JSON.stringify(params.newValues) : null,
      params.reason ?? null,
      params.reportType ?? null,
      params.filtersUsed ? JSON.stringify(params.filtersUsed) : null,
      params.ipAddress ?? null,
      params.userAgent ?? null,
    ]
  )
}

function auditContext(req: Request) {
  return {
    userId: req.user?.userId,
    userRole: req.user?.role,
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  }
}

function noteFromBody(body: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = String(body[field] ?? '').trim()
    if (value) return value
  }
  return undefined
}

function requireReason(body: Record<string, unknown>, fields: string[], label: string): string {
  const reason = noteFromBody(body, fields)
  if (!reason) throw createError(`${label} is required`, 400)
  if (reason.length > 2000) throw createError(`${label} must be 2,000 characters or fewer`, 400)
  return reason
}

function isPrivilegedPayrollRole(role?: string): boolean {
  return role === 'admin' || role === 'super_admin'
}

function canBypassSegregation(role?: string): boolean {
  return isPrivilegedPayrollRole(role)
}

function normalizeReportType(value: unknown): PayrollReportType {
  const reportType = String(value ?? '').trim()
  if (!payrollReportTypes.includes(reportType as PayrollReportType)) {
    throw createError(`report type must be one of: ${payrollReportTypes.join(', ')}`, 400)
  }
  return reportType as PayrollReportType
}

function reportFiltersFromRequest(req: Request) {
  const filters: Record<string, string> = {}
  for (const key of ['employeeId', 'departmentId', 'status', 'startDate', 'endDate', 'search']) {
    const value = String(req.query[key] ?? '').trim()
    if (value && value !== 'all') filters[key] = value
  }
  if (filters.employeeId) assertUuid(filters.employeeId, 'employeeId')
  if (filters.departmentId) assertUuid(filters.departmentId, 'departmentId')
  return filters
}

function reportFileName(type: PayrollReportType, period: Record<string, unknown>, extension: string): string {
  const start = dateOnly(period.start_date)
  const end = dateOnly(period.end_date)
  return `${type.replace(/[^a-z0-9]+/g, '-')}-${start}-to-${end}.${extension}`
}

async function recordPayrollFailure(
  req: Request,
  params: {
    action: string
    periodId: string
    reason?: string
    error: unknown
    oldValues?: unknown
  }
): Promise<void> {
  await recordPayrollAudit(pool, {
    ...auditContext(req),
    action: params.action,
    periodId: params.periodId,
    oldValues: params.oldValues,
    newValues: { error: params.error instanceof Error ? params.error.message : String(params.error) },
    reason: params.reason,
  }).catch(() => undefined)
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
                COUNT(*) FILTER (WHERE status IN ('processing', 'processed', 'validation_failed', 'ready_for_approval', 'needs_correction'))::int AS processing_record_count,
                COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_record_count,
                COUNT(*) FILTER (WHERE status IN ('released', 'locked'))::int AS released_record_count,
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
  const auditHistory = hasPayrollPermission(req.user?.role, 'payroll:view_audit_logs')
    ? await getAuditHistory(req.params.id)
    : []

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

export const validatePayrollPeriod = asyncHandler(async (req: Request, res: Response) => {
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
    const report = await buildPayrollValidationReport(req.params.id, client)
    const mayTransition = req.method === 'POST' &&
      !period.is_locked &&
      period.status !== 'locked' &&
      ['processed', 'validation_failed', 'ready_for_approval', 'needs_correction', 'processing'].includes(period.status)
    let nextStatus = period.status as PayrollStatus
    if (mayTransition) {
      nextStatus = report.isValid ? 'ready_for_approval' : 'validation_failed'
      await client.query(
        `UPDATE payroll_periods
         SET status = $1,
             validated_by = $2,
             validated_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [nextStatus, req.user!.userId, req.params.id]
      )
      await client.query(
        `UPDATE payroll_records
         SET status = $1,
             updated_at = NOW()
         WHERE payroll_period_id = $2
           AND is_locked = false`,
        [nextStatus, req.params.id]
      )
    }

    if (req.method === 'POST') {
      await recordPayrollAudit(client, {
        ...auditContext(req),
        action: report.isValid ? 'payroll_validated' : 'payroll_validation_failed',
        periodId: req.params.id,
        oldValues: { status: period.status },
        newValues: {
          status: nextStatus,
          isValid: report.isValid,
          criticalIssueCount: report.criticalIssueCount,
          warningCount: report.warningCount,
        },
      })
    }

    await client.query('COMMIT')

    res.json({
      success: true,
      data: { ...report, status: nextStatus },
      message: report.message,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
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

export const getPayrollRecordBreakdown = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  const result = await pool.query(
    `SELECT pr.id, pr.employee_id, pr.payroll_period_id, pr.computation_breakdown,
            pr.statutory_rule_versions, pr.statutory_rule_version,
            COALESCE((
              SELECT JSON_AGG(pld ORDER BY pld.created_at)
              FROM payroll_loan_deductions pld
              WHERE pld.payroll_record_id = pr.id
            ), '[]'::json) AS loan_deductions,
            COALESCE((
              SELECT JSON_AGG(pla ORDER BY pla.created_at)
              FROM payroll_leave_adjustments pla
              WHERE pla.payroll_record_id = pr.id
            ), '[]'::json) AS leave_adjustments
     FROM payroll_records pr
     WHERE pr.id = $1`,
    [req.params.id]
  )

  if (!result.rows[0]) throw createError('Payroll record not found', 404)
  res.json({ success: true, data: result.rows[0] })
})

export const getStatutoryRuleVersions = asyncHandler(async (_req: Request, res: Response) => {
  const versions = await listStatutoryRuleVersions()
  res.json({ success: true, data: versions })
})

export const getPayrollRecordPayslip = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  if (req.user!.role === 'employee' && !req.user!.employeeId) {
    throw createError('No employee profile is linked to this account', 403)
  }
  const payload = await buildPayslipPayload(req.params.id, {
    employeeId: req.user!.role === 'employee' ? req.user!.employeeId : undefined,
    requireReleased: true,
  })

  await recordPayrollAudit(pool, {
    ...auditContext(req),
    action: 'payslip_viewed',
    periodId: String(payload.record.payroll_period_id),
    recordId: String(payload.record.id),
    employeeId: String(payload.record.employee_id),
    entityType: 'payroll_record',
    entityId: String(payload.record.id),
    newValues: { status: payload.record.status, referenceNumber: payload.referenceNumber },
  })

  res.json({ success: true, data: payload })
})

export const downloadPayslipPdf = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  if (req.user!.role === 'employee' && !req.user!.employeeId) {
    throw createError('No employee profile is linked to this account', 403)
  }
  const payload = await buildPayslipPayload(req.params.id, {
    employeeId: req.user!.role === 'employee' ? req.user!.employeeId : undefined,
    requireReleased: true,
  })
  const pdf = await generatePayslipPdf(payload)

  await recordPayrollAudit(pool, {
    ...auditContext(req),
    action: 'payslip_pdf_generated',
    periodId: String(payload.record.payroll_period_id),
    recordId: String(payload.record.id),
    employeeId: String(payload.record.employee_id),
    entityType: 'payroll_record',
    entityId: String(payload.record.id),
    newValues: { referenceNumber: payload.referenceNumber, bytes: pdf.length },
  })
  await recordPayrollAudit(pool, {
    ...auditContext(req),
    action: 'payslip_downloaded',
    periodId: String(payload.record.payroll_period_id),
    recordId: String(payload.record.id),
    employeeId: String(payload.record.employee_id),
    entityType: 'payroll_record',
    entityId: String(payload.record.id),
    newValues: { referenceNumber: payload.referenceNumber, format: 'pdf' },
  })

  const employeeNumber = String(payload.employee.employeeNumber ?? payload.employee.id)
  const payDate = String(payload.period.payDate)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="payslip-${employeeNumber}-${payDate}.pdf"`)
  res.send(pdf)
})

export const downloadPayslip = downloadPayslipPdf

export const getPayrollReport = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id ?? req.params.periodId, 'periodId')
  const periodId = String(req.params.id ?? req.params.periodId)
  const reportType = normalizeReportType(req.params.reportType)
  const filters = reportFiltersFromRequest(req)
  const report = await buildPayrollReport(periodId, reportType, filters)

  const actionByType: Record<PayrollReportType, string> = {
    summary: 'payroll_summary_report_viewed',
    employees: 'payroll_report_viewed',
    'government-contributions': 'government_contribution_report_viewed',
    tax: 'tax_report_viewed',
    loans: 'loan_deduction_report_viewed',
    attendance: 'attendance_payroll_report_viewed',
  }
  await recordPayrollAudit(pool, {
    ...auditContext(req),
    action: actionByType[reportType],
    periodId,
    reportType,
    filtersUsed: filters,
    newValues: { rowCount: report.rows.length },
  })

  res.json({ success: true, data: report })
})

export const exportPayrollReport = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id ?? req.params.periodId, 'periodId')
  const periodId = String(req.params.id ?? req.params.periodId)
  const reportType = normalizeReportType(req.query.type ?? req.params.reportType ?? 'summary')
  const format = String(req.query.format ?? 'csv').toLowerCase()
  if (format !== 'csv') throw createError('Only CSV report export is currently available.', 400)

  const filters = reportFiltersFromRequest(req)
  const report = await buildPayrollReport(periodId, reportType, filters)
  const csv = reportToCsv(report)

  const actionByType: Record<PayrollReportType, string> = {
    summary: 'payroll_report_exported',
    employees: 'payroll_report_exported',
    'government-contributions': 'government_contribution_report_exported',
    tax: 'tax_report_exported',
    loans: 'loan_deduction_report_exported',
    attendance: 'attendance_payroll_report_exported',
  }
  await recordPayrollAudit(pool, {
    ...auditContext(req),
    action: actionByType[reportType],
    periodId,
    reportType,
    filtersUsed: filters,
    newValues: { rowCount: report.rows.length, format },
  })

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${reportFileName(reportType, report.period, 'csv')}"`)
  res.send(csv)
})

export const getMyPayrollRecords = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.employeeId) throw createError('No employee profile is linked to this account', 403)
  const page = parsePositiveInt(req.query.page, 1, 10_000)
  const limit = parsePositiveInt(req.query.limit, 12, 100)
  const offset = (page - 1) * limit
  const conditions = [
    'pr.employee_id = $1',
    `pr.status IN ('released', 'locked')`,
    `pp.status IN ('released', 'locked')`,
  ]
  const values: unknown[] = [req.user.employeeId]
  let i = 2

  if (req.query.year && req.query.year !== 'all') {
    const year = Number(req.query.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw createError('year must be valid', 400)
    conditions.push(`(EXTRACT(YEAR FROM pp.start_date) = $${i} OR EXTRACT(YEAR FROM pp.pay_date) = $${i})`)
    values.push(year)
    i++
  }
  if (req.query.month && req.query.month !== 'all') {
    const month = Number(req.query.month)
    if (!Number.isInteger(month) || month < 1 || month > 12) throw createError('month must be 1-12', 400)
    conditions.push(`(EXTRACT(MONTH FROM pp.start_date) = $${i} OR EXTRACT(MONTH FROM pp.pay_date) = $${i})`)
    values.push(month)
    i++
  }
  if (req.query.frequency && req.query.frequency !== 'all') {
    const frequency = normalizePayFrequency(req.query.frequency)
    conditions.push(`pp.pay_frequency = $${i++}`)
    values.push(frequency)
  }
  const search = String(req.query.search ?? req.query.q ?? '').trim()
  if (search) {
    conditions.push(`pp.name ILIKE $${i++}`)
    values.push(`%${search}%`)
  }

  const where = `WHERE ${conditions.join(' AND ')}`

  const [countResult, dataResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM payroll_records pr
       JOIN payroll_periods pp ON pr.payroll_period_id = pp.id
       ${where}`,
      values
    ),
    pool.query(
      `SELECT pr.*, pp.name AS period_name, pp.start_date, pp.end_date, pp.pay_date,
              pp.pay_frequency, pp.status AS period_status
       FROM payroll_records pr
       JOIN payroll_periods pp ON pr.payroll_period_id = pp.id
       ${where}
       ORDER BY pp.pay_date DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
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
  const payrollPeriodId = String(req.params.id ?? req.body.payrollPeriodId ?? req.body.periodId ?? '')
  if (!payrollPeriodId) throw createError('payrollPeriodId is required', 400)
  assertUuid(payrollPeriodId, 'payrollPeriodId')
  const actionReason = noteFromBody(req.body, ['reason', 'reprocessReason', 'reprocess_reason'])

  const client = await pool.connect()
  let periodForFailure: Record<string, unknown> | undefined
  try {
    await client.query('BEGIN')

    const periodResult = await client.query(
      `SELECT * FROM payroll_periods WHERE id = $1 FOR UPDATE`,
      [payrollPeriodId]
    )
    const period = periodResult.rows[0]
    periodForFailure = period
    if (!period) throw createError('Payroll period not found', 404)
    if (period.is_locked || ['approved', 'released', 'locked', 'cancelled'].includes(period.status)) {
      throw createError(`Payroll period ${period.status} cannot be processed or overwritten through normal payroll actions.`, 409)
    }
    if (!['draft', 'processing', 'processed', 'validation_failed', 'needs_correction'].includes(period.status)) {
      throw createError(`Only draft, processed, validation-failed, or correction payroll periods can be processed. Current status: ${period.status}`, 409)
    }

    const summaryBefore = await getPeriodSummary(payrollPeriodId, client)
    if (summaryBefore.activeEmployeeCount === 0) {
      throw createError('No active employees are available for this payroll run', 400)
    }
    const isReprocess = summaryBefore.recordCount > 0 || period.status !== 'draft'
    if (isReprocess && !actionReason) {
      throw createError('A reprocessing reason is required before recalculating an existing payroll period.', 400)
    }

    const { processed, errors } = await processBatchPayroll(payrollPeriodId, client, { computedBy: req.user!.userId })
    if (processed === 0) throw createError('No payroll records were processed', 400)
    if (errors.length > 0) {
      const err = createError(`Payroll processing failed for ${errors.length} employee${errors.length === 1 ? '' : 's'}. No payroll records were committed.`, 409)
      err.details = { errors }
      throw err
    }

    await client.query(
      `UPDATE payroll_periods
       SET status = 'processed',
           processed_by = COALESCE(processed_by, $2),
           processed_at = COALESCE(processed_at, NOW()),
           reprocessed_by = CASE WHEN $3 THEN $2 ELSE reprocessed_by END,
           reprocessed_at = CASE WHEN $3 THEN NOW() ELSE reprocessed_at END,
           reprocess_reason = CASE WHEN $3 THEN $4 ELSE reprocess_reason END,
           validated_by = NULL,
           validated_at = NULL,
           approved_by = NULL,
           approved_at = NULL,
           released_by = NULL,
           released_at = NULL,
           locked_by = NULL,
           locked_at = NULL,
           approval_notes = NULL,
           correction_notes = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [payrollPeriodId, req.user!.userId, isReprocess, actionReason ?? null]
    )
    await client.query(
      `UPDATE payroll_records
       SET status = 'processed',
           updated_at = NOW()
       WHERE payroll_period_id = $1`,
      [payrollPeriodId]
    )

    await recordPayrollAudit(client, {
      ...auditContext(req),
      action: isReprocess ? 'payroll_reprocessed' : 'payroll_processed',
      periodId: payrollPeriodId,
      oldValues: { status: period.status, recordCount: summaryBefore.recordCount },
      newValues: { status: 'processed', processed, errors },
      reason: actionReason,
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
    await recordPayrollFailure(req, {
      action: 'payroll_processing_failed',
      periodId: payrollPeriodId,
      reason: actionReason,
      error: err,
      oldValues: periodForFailure ? { status: periodForFailure.status } : undefined,
    })
    throw err
  } finally {
    client.release()
  }
})

export const approvePayroll = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  const approvalNotes = noteFromBody(req.body, ['approvalNotes', 'approval_notes', 'notes'])
  const client = await pool.connect()
  let periodForFailure: Record<string, unknown> | undefined

  try {
    await client.query('BEGIN')

    const periodResult = await client.query(
      `SELECT * FROM payroll_periods WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    )
    const period = periodResult.rows[0]
    periodForFailure = period
    if (!period) throw createError('Payroll period not found', 404)
    if (period.is_locked || period.status === 'locked') {
      throw createError('Locked payroll periods cannot be approved or changed.', 409)
    }
    if (period.status !== 'ready_for_approval') {
      throw createError(`Payroll must pass validation and be ready for approval before approval. Current status: ${period.status}`, 409)
    }
    if (period.processed_by && period.processed_by === req.user!.userId && !canBypassSegregation(req.user!.role)) {
      throw createError('Segregation of duties prevents the payroll processor from approving the same payroll period.', 403)
    }

    const summary = await getPeriodSummary(req.params.id, client)
    if (summary.recordCount === 0) throw createError('Cannot approve a payroll period with no payroll records', 400)
    const validation = await buildPayrollValidationReport(req.params.id, client)
    if (!validation.isValid) {
      const err = createError(validation.issues[0]?.message ?? validation.message, 409)
      err.details = { validation }
      throw err
    }

    const updated = await client.query(
      `UPDATE payroll_periods
       SET status = 'approved',
           approved_by = $1,
           approved_at = NOW(),
           approval_notes = $3,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [req.user!.userId, req.params.id, approvalNotes ?? null]
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
      newValues: { status: 'approved', recordCount: summary.recordCount, totalNetPay: summary.totalNetPay, approvalNotes },
      reason: approvalNotes,
    })

    await client.query('COMMIT')
    res.json({ success: true, data: updated.rows[0], message: 'Payroll approved.' })
  } catch (err) {
    await client.query('ROLLBACK')
    await recordPayrollFailure(req, {
      action: 'payroll_approval_failed',
      periodId: req.params.id,
      reason: approvalNotes,
      error: err,
      oldValues: periodForFailure ? { status: periodForFailure.status } : undefined,
    })
    throw err
  } finally {
    client.release()
  }
})

export const releasePayroll = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  const releaseReason = noteFromBody(req.body, ['releaseNotes', 'release_notes', 'reason'])
  const client = await pool.connect()
  let periodForFailure: Record<string, unknown> | undefined

  try {
    await client.query('BEGIN')

    const periodResult = await client.query(
      `SELECT * FROM payroll_periods WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    )
    const period = periodResult.rows[0]
    periodForFailure = period
    if (!period) throw createError('Payroll period not found', 404)
    if (period.is_locked || period.status === 'locked') {
      throw createError('This payroll period is already locked and cannot be released again.', 409)
    }
    if (period.status !== 'approved') {
      throw createError(`Only approved payroll periods can be released. Current status: ${period.status}`, 409)
    }
    if (period.approved_by && period.approved_by === req.user!.userId && !canBypassSegregation(req.user!.role)) {
      throw createError('Segregation of duties prevents the payroll approver from releasing the same payroll period.', 403)
    }

    const summary = await getPeriodSummary(req.params.id, client)
    if (summary.recordCount === 0) throw createError('Cannot release a payroll period with no payroll records', 400)

    const updated = await client.query(
      `UPDATE payroll_periods
       SET status = 'locked',
           released_by = $2,
           released_at = NOW(),
           locked_by = $2,
           locked_at = NOW(),
           locked_reason = COALESCE($3, 'Automatically locked after payroll release'),
           is_locked = true,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, req.user!.userId, releaseReason ?? null]
    )
    await client.query(
      `UPDATE payroll_records
       SET status = 'locked',
           is_locked = true,
           locked_by = $2,
           locked_at = NOW(),
           updated_at = NOW()
       WHERE payroll_period_id = $1`,
      [req.params.id, req.user!.userId]
    )
    await client.query(
      `UPDATE loans l
       SET balance = GREATEST(0, l.balance - deductions.total_deducted),
           status = CASE WHEN GREATEST(0, l.balance - deductions.total_deducted) <= 0 THEN 'paid'::loan_status ELSE l.status END,
           is_active = CASE WHEN GREATEST(0, l.balance - deductions.total_deducted) <= 0 THEN false ELSE l.is_active END,
           updated_at = NOW()
       FROM (
         SELECT loan_id, SUM(deducted_amount) AS total_deducted
         FROM payroll_loan_deductions
         WHERE payroll_period_id = $1
         GROUP BY loan_id
       ) deductions
       WHERE l.id = deductions.loan_id`,
      [req.params.id]
    )

    await recordPayrollAudit(client, {
      ...auditContext(req),
      action: 'payroll_released',
      periodId: req.params.id,
      oldValues: { status: period.status },
      newValues: { status: 'locked', releasedStatus: 'released', recordCount: summary.recordCount, totalNetPay: summary.totalNetPay },
      reason: releaseReason,
    })
    await recordPayrollAudit(client, {
      ...auditContext(req),
      action: 'payroll_locked',
      periodId: req.params.id,
      oldValues: { isLocked: Boolean(period.is_locked), status: period.status },
      newValues: { isLocked: true, status: 'locked', lockedReason: releaseReason ?? 'Automatically locked after payroll release' },
      reason: releaseReason,
    })

    await client.query('COMMIT')
    res.json({ success: true, data: updated.rows[0], message: 'Payroll released and locked.' })
  } catch (err) {
    await client.query('ROLLBACK')
    await recordPayrollFailure(req, {
      action: 'payroll_release_failed',
      periodId: req.params.id,
      reason: releaseReason,
      error: err,
      oldValues: periodForFailure ? { status: periodForFailure.status } : undefined,
    })
    throw err
  } finally {
    client.release()
  }
})

export const requestPayrollCorrection = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id)
  const correctionNotes = requireReason(req.body, ['correctionNotes', 'correction_notes', 'reason'], 'Correction notes')
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const periodResult = await client.query(
      `SELECT * FROM payroll_periods WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    )
    const period = periodResult.rows[0]
    if (!period) throw createError('Payroll period not found', 404)
    if (period.is_locked || ['released', 'locked'].includes(period.status)) {
      throw createError('Released or locked payroll cannot be sent for correction through the normal workflow.', 409)
    }
    if (!['processed', 'validation_failed', 'ready_for_approval', 'approved'].includes(period.status)) {
      throw createError(`Payroll cannot be marked for correction from status ${period.status}.`, 409)
    }

    const updated = await client.query(
      `UPDATE payroll_periods
       SET status = 'needs_correction',
           correction_notes = $2,
           correction_requested_by = $3,
           correction_requested_at = NOW(),
           approved_by = NULL,
           approved_at = NULL,
           approval_notes = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, correctionNotes, req.user!.userId]
    )
    await client.query(
      `UPDATE payroll_records
       SET status = 'needs_correction',
           updated_at = NOW()
       WHERE payroll_period_id = $1
         AND is_locked = false`,
      [req.params.id]
    )

    await recordPayrollAudit(client, {
      ...auditContext(req),
      action: 'payroll_correction_requested',
      periodId: req.params.id,
      oldValues: { status: period.status },
      newValues: { status: 'needs_correction', correctionNotes },
      reason: correctionNotes,
    })

    await client.query('COMMIT')
    res.json({ success: true, data: updated.rows[0], message: 'Payroll marked for correction.' })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export const getPayrollAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id, 'periodId')
  const conditions = ['pal.payroll_period_id = $1']
  const values: unknown[] = [req.params.id]
  let i = 2

  if (req.query.action) {
    conditions.push(`pal.action = $${i++}`)
    values.push(String(req.query.action))
  }
  if (req.query.employeeId) {
    const employeeId = String(req.query.employeeId)
    assertUuid(employeeId, 'employeeId')
    conditions.push(`pal.employee_id = $${i++}`)
    values.push(employeeId)
  }
  if (req.query.from) {
    conditions.push(`pal.created_at >= $${i++}::timestamptz`)
    values.push(String(req.query.from))
  }
  if (req.query.to) {
    conditions.push(`pal.created_at <= $${i++}::timestamptz`)
    values.push(String(req.query.to))
  }

  const result = await pool.query(
    `SELECT pal.*, u.email AS actor_email,
            e.employee_number,
            CONCAT(e.first_name, ' ', e.last_name) AS employee_name
     FROM payroll_audit_logs pal
     LEFT JOIN users u ON u.id = pal.user_id
     LEFT JOIN employees e ON e.id = pal.employee_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY pal.created_at DESC
     LIMIT 200`,
    values
  )
  res.json({ success: true, data: result.rows })
})

export const getPayrollRecordSnapshots = asyncHandler(async (req: Request, res: Response) => {
  assertUuid(req.params.id, 'recordId')
  const result = await pool.query(
    `SELECT pcs.*
     FROM payroll_calculation_snapshots pcs
     JOIN payroll_records pr ON pr.id = pcs.payroll_record_id
     WHERE pcs.payroll_record_id = $1
     ORDER BY pcs.snapshot_version DESC, pcs.created_at DESC`,
    [req.params.id]
  )
  res.json({ success: true, data: result.rows })
})

export const unlockPayroll = asyncHandler(async (req: Request, _res: Response) => {
  assertUuid(req.params.id)
  const reason = requireReason(req.body, ['reason', 'unlockReason', 'unlock_reason'], 'Unlock reason')
  await recordPayrollAudit(pool, {
    ...auditContext(req),
    action: 'payroll_unlock_attempted',
    periodId: req.params.id,
    reason,
    newValues: { allowed: false, policy: 'permanent_lock_after_release' },
  })
  throw createError('Payroll unlock is not enabled. Released payroll is permanently locked by policy.', 403)
})

export const computeEmployeeTax = asyncHandler(async (req: Request, res: Response) => {
  const { monthlyBasicSalary } = req.query
  if (!monthlyBasicSalary) throw createError('monthlyBasicSalary is required', 400)

  const salary = Number(monthlyBasicSalary)
  if (isNaN(salary) || salary <= 0) throw createError('Invalid salary amount', 400)

  const deductions = computeDeductions(salary)
  res.json({ success: true, data: deductions })
})
