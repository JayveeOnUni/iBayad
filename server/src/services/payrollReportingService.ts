import PDFDocument from 'pdfkit'
import pool from '../utils/db'
import type { Pool, PoolClient } from 'pg'
import { createError } from '../middleware/errorHandler'

type Queryable = Pool | PoolClient

export type PayrollReportType =
  | 'summary'
  | 'employees'
  | 'government-contributions'
  | 'tax'
  | 'attendance'

export interface PayrollReportFilters {
  employeeId?: string
  departmentId?: string
  status?: string
  employmentStatus?: string
  startDate?: string
  endDate?: string
  search?: string
}

export interface PayrollReportResult {
  reportType: PayrollReportType
  period: Record<string, unknown>
  generatedAt: string
  filters: PayrollReportFilters
  totals: Record<string, number>
  rows: Array<Record<string, unknown>>
}

export interface PayslipPayload {
  company: {
    name: string
    address: string
    contact: string
  }
  referenceNumber: string
  generatedAt: string
  record: Record<string, unknown>
  period: Record<string, unknown>
  employee: Record<string, unknown>
  earnings: Record<string, number>
  attendance: Record<string, number>
  deductions: Record<string, number>
  employerContributions: Record<string, number>
  summary: Record<string, number | string>
  metadata: Record<string, unknown>
  leaveAdjustments: Array<Record<string, unknown>>
}

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function dateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value ?? '').slice(0, 10)
}

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return value ? new Date(String(value)).toISOString() : new Date().toISOString()
}

export function formatPeso(value: unknown): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(toNumber(value))
}

function parseSetting(value: unknown): string {
  if (value == null) return ''
  try {
    const parsed = JSON.parse(String(value))
    return parsed == null ? '' : String(parsed)
  } catch {
    return String(value)
  }
}

async function getCompanyProfile(db: Queryable = pool) {
  const result = await db.query(
    `SELECT key, value
     FROM system_settings
     WHERE key IN (
       'company_name',
       'company_address',
       'company_city',
       'company_province',
       'company_zip_code',
       'company_phone',
       'company_email'
     )`
  )
  const settings = Object.fromEntries(result.rows.map((row) => [row.key, parseSetting(row.value)]))
  const addressParts = [
    settings.company_address,
    settings.company_city,
    settings.company_province,
    settings.company_zip_code,
  ].filter(Boolean)
  const contactParts = [settings.company_phone, settings.company_email].filter(Boolean)
  return {
    name: settings.company_name || 'iBayad Payroll Management System',
    address: addressParts.join(', '),
    contact: contactParts.join(' | '),
  }
}

function payslipReference(record: Record<string, unknown>): string {
  if (record.payslip_reference_number) return String(record.payslip_reference_number)
  const employeeNumber = String(record.employee_number ?? record.employee_id ?? '').replace(/[^A-Za-z0-9]/g, '').slice(-8)
  const period = dateOnly(record.end_date).replace(/-/g, '')
  const id = String(record.id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase()
  return `PS-${period}-${employeeNumber || id}`
}

function amountInWords(value: unknown): string {
  const pesos = Math.floor(toNumber(value))
  const centavos = Math.round((toNumber(value) - pesos) * 100)
  if (pesos === 0) return `Zero pesos${centavos ? ` and ${centavos}/100` : ''}`

  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
  const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
  const belowThousand = (n: number): string => {
    const parts: string[] = []
    if (n >= 100) {
      parts.push(`${ones[Math.floor(n / 100)]} hundred`)
      n %= 100
    }
    if (n >= 20) {
      parts.push(`${tens[Math.floor(n / 10)]}${n % 10 ? `-${ones[n % 10]}` : ''}`)
    } else if (n >= 10) {
      parts.push(teens[n - 10])
    } else if (n > 0) {
      parts.push(ones[n])
    }
    return parts.join(' ')
  }
  const groups = [
    { value: 1_000_000_000, label: 'billion' },
    { value: 1_000_000, label: 'million' },
    { value: 1_000, label: 'thousand' },
    { value: 1, label: '' },
  ]
  let remaining = pesos
  const parts: string[] = []
  for (const group of groups) {
    const count = Math.floor(remaining / group.value)
    if (count > 0) {
      parts.push(`${belowThousand(count)} ${group.label}`.trim())
      remaining %= group.value
    }
  }
  const words = parts.join(' ').replace(/\s+/g, ' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} pesos${centavos ? ` and ${centavos}/100` : ''}`
}

export async function buildPayslipPayload(
  recordId: string,
  options: { employeeId?: string; requireReleased?: boolean } = {},
  db: Queryable = pool
): Promise<PayslipPayload> {
  const params: unknown[] = [recordId]
  const conditions = ['pr.id = $1']
  if (options.employeeId) {
    params.push(options.employeeId)
    conditions.push(`pr.employee_id = $${params.length}`)
  }
  if (options.requireReleased !== false) {
    conditions.push(`pr.status IN ('released', 'locked')`)
    conditions.push(`pp.status IN ('released', 'locked')`)
  }

  const result = await db.query(
    `SELECT pr.*, pp.name AS period_name, pp.start_date, pp.end_date, pp.pay_date,
            pp.pay_frequency, pp.status AS period_status, pp.approved_by, pp.released_by,
            pp.approved_at, pp.released_at, pp.locked_at, pp.is_locked AS period_is_locked,
            e.first_name, e.last_name, e.employee_number, e.email, e.employment_type,
            d.name AS department_name, p.title AS position_title,
            pcs.id AS snapshot_id, pcs.snapshot_hash, pcs.formula_version,
            pcs.snapshot_version, pcs.attendance_summary_json,
            pcs.earnings_breakdown_json, pcs.deductions_breakdown_json,
            pcs.employer_contributions_json, pcs.computed_at,
            approver.email AS approved_by_email,
            releaser.email AS released_by_email,
            COALESCE((
              SELECT JSON_AGG(pla ORDER BY pla.created_at)
              FROM payroll_leave_adjustments pla
              WHERE pla.payroll_record_id = pr.id
            ), '[]'::json) AS leave_adjustments
     FROM payroll_records pr
     JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
     JOIN employees e ON e.id = pr.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN positions p ON p.id = e.position_id
     LEFT JOIN payroll_calculation_snapshots pcs ON pcs.id = pr.current_snapshot_id
     LEFT JOIN users approver ON approver.id = pp.approved_by
     LEFT JOIN users releaser ON releaser.id = pp.released_by
     WHERE ${conditions.join(' AND ')}`,
    params
  )

  const record = result.rows[0]
  if (!record) throw createError('Payslip not found or not released yet', 404)

  const company = await getCompanyProfile(db)
  const attendanceSummary = (record.attendance_summary_json ?? {}) as Record<string, unknown>
  const earningsSnapshot = (record.earnings_breakdown_json ?? {}) as Record<string, unknown>
  const deductionsSnapshot = (record.deductions_breakdown_json ?? {}) as Record<string, unknown>
  const employerSnapshot = (record.employer_contributions_json ?? {}) as Record<string, unknown>
  const totalEmployer = toNumber(record.employer_contributions) ||
    toNumber(record.sss_employer) + toNumber(record.phil_health_employer) + toNumber(record.pag_ibig_employer)

  const earnings = {
    basicPay: toNumber(record.regular_pay),
    holidayPay: toNumber(record.holiday_pay),
    nightDifferential: toNumber(record.night_diff_pay),
    paidLeaveAmount: toNumber(record.paid_leave_amount ?? earningsSnapshot.paidLeaveAmount),
    allowances: toNumber(record.allowances),
    bonusesAndIncentives: toNumber(earningsSnapshot.bonusesAndIncentives),
    otherTaxableEarnings: toNumber(record.other_earnings),
    otherNonTaxableEarnings: toNumber(record.non_taxable_earnings),
    grossPay: toNumber(record.gross_pay),
  }
  const deductions = {
    lateDeduction: toNumber(record.late_deduction),
    undertimeDeduction: toNumber(record.undertime_deduction),
    absenceDeduction: toNumber(record.absence_deduction),
    unpaidLeaveDeduction: toNumber(record.leave_deduction ?? deductionsSnapshot.unpaidLeaveDeduction),
    sssEmployee: toNumber(record.sss_employee),
    philHealthEmployee: toNumber(record.phil_health_employee),
    pagIbigEmployee: toNumber(record.pag_ibig_employee),
    withholdingTax: toNumber(record.withholding_tax),
    otherDeductions: toNumber(record.other_deductions),
    totalDeductions: toNumber(record.total_deductions),
  }
  const attendance = {
    expectedWorkdays: toNumber(record.expected_work_days),
    daysPresent: toNumber(record.days_worked),
    daysAbsent: toNumber(attendanceSummary.absence_days),
    lateMinutes: toNumber(record.late_minutes ?? attendanceSummary.late_minutes),
    undertimeMinutes: toNumber(record.undertime_minutes ?? attendanceSummary.undertime_minutes),
    offsetEarnedMinutes: toNumber(record.offset_earned_minutes ?? attendanceSummary.offset_earned_minutes),
    offsetUsedMinutes: toNumber(record.offset_used_minutes ?? attendanceSummary.offset_used_minutes),
    offsetBalanceMinutes: toNumber(record.offset_balance_minutes),
    paidLeaveDays: toNumber(record.paid_leave_days),
    unpaidLeaveDays: toNumber(record.unpaid_leave_days),
    leaveWithoutPayDeduction: deductions.unpaidLeaveDeduction,
  }
  const employerContributions = {
    sssEmployer: toNumber(record.sss_employer ?? employerSnapshot.sssEmployer),
    philHealthEmployer: toNumber(record.phil_health_employer ?? employerSnapshot.philHealthEmployer),
    pagIbigEmployer: toNumber(record.pag_ibig_employer ?? employerSnapshot.pagIBIGEmployer),
    otherEmployerPaidBenefits: toNumber(employerSnapshot.otherEmployerPaidBenefits),
    totalEmployerContributions: totalEmployer,
  }

  return {
    company,
    referenceNumber: payslipReference(record),
    generatedAt: new Date().toISOString(),
    record,
    period: {
      id: record.payroll_period_id,
      name: record.period_name,
      startDate: dateOnly(record.start_date),
      endDate: dateOnly(record.end_date),
      payDate: dateOnly(record.pay_date),
      frequency: record.pay_frequency,
      status: record.period_status,
      isLocked: Boolean(record.period_is_locked),
    },
    employee: {
      id: record.employee_id,
      name: `${record.first_name} ${record.last_name}`.trim(),
      employeeNumber: record.employee_number,
      department: record.department_name,
      position: record.position_title,
      employmentType: record.employment_type,
    },
    earnings,
    attendance,
    deductions,
    employerContributions,
    summary: {
      grossPay: toNumber(record.gross_pay),
      taxableIncome: toNumber(record.taxable_income),
      nonTaxableEarnings: toNumber(record.non_taxable_earnings),
      totalDeductions: toNumber(record.total_deductions),
      netPay: toNumber(record.net_pay),
      amountInWords: amountInWords(record.net_pay),
    },
    metadata: {
      payrollStatus: record.status,
      approvedBy: record.approved_by_email,
      releasedBy: record.released_by_email,
      releasedDate: record.released_at ? timestamp(record.released_at) : null,
      calculationSnapshotId: record.snapshot_id ?? record.current_snapshot_id,
      snapshotHash: record.snapshot_hash,
      snapshotVersion: record.snapshot_version,
      formulaVersion: record.formula_version ?? record.statutory_rule_version ?? 'not recorded',
      statutoryRuleVersion: record.statutory_rule_version ?? 'not recorded',
      statutoryRuleVersions: record.statutory_rule_versions ?? {},
      generatedDateTime: new Date().toISOString(),
      isLocked: Boolean(record.is_locked),
    },
    leaveAdjustments: Array.isArray(record.leave_adjustments) ? record.leave_adjustments : [],
  }
}

function buildRecordFilters(
  filters: PayrollReportFilters,
  values: unknown[],
  alias = 'pr'
): string[] {
  const conditions: string[] = []
  if (filters.employeeId) {
    values.push(filters.employeeId)
    conditions.push(`${alias}.employee_id = $${values.length}`)
  }
  if (filters.departmentId) {
    values.push(filters.departmentId)
    conditions.push(`e.department_id = $${values.length}`)
  }
  if (filters.status && filters.status !== 'all') {
    values.push(filters.status)
    conditions.push(`${alias}.status = $${values.length}`)
  }
  if (filters.employmentStatus && filters.employmentStatus !== 'all') {
    values.push(filters.employmentStatus)
    conditions.push(`e.employment_status = $${values.length}`)
  }
  if (filters.search) {
    values.push(`%${filters.search}%`)
    conditions.push(`(e.first_name ILIKE $${values.length} OR e.last_name ILIKE $${values.length} OR e.employee_number ILIKE $${values.length})`)
  }
  if (filters.startDate) {
    values.push(filters.startDate)
    conditions.push(`pp.start_date >= $${values.length}::date`)
  }
  if (filters.endDate) {
    values.push(filters.endDate)
    conditions.push(`pp.end_date <= $${values.length}::date`)
  }
  return conditions
}

export async function buildPayrollReport(
  periodId: string,
  reportType: PayrollReportType,
  filters: PayrollReportFilters = {},
  db: Queryable = pool
): Promise<PayrollReportResult> {
  const periodResult = await db.query(`SELECT * FROM payroll_periods WHERE id = $1`, [periodId])
  const period = periodResult.rows[0]
  if (!period) throw createError('Payroll period not found', 404)

  const values: unknown[] = [periodId]
  const conditions = [`pr.payroll_period_id = $1`, `pr.status::text NOT IN ('cancelled', 'voided')`, ...buildRecordFilters(filters, values)]
  const where = `WHERE ${conditions.join(' AND ')}`
  const summaryWhere = where
    .replace('pr.payroll_period_id = $1', 'pp.id = $1')
    .replace("pr.status::text NOT IN ('cancelled', 'voided')", "(pr.id IS NULL OR pr.status::text NOT IN ('cancelled', 'voided'))")

  let rows: Array<Record<string, unknown>> = []
  if (reportType === 'summary') {
    const result = await db.query(
      `SELECT pp.id AS payroll_period_id, pp.name AS payroll_period, pp.start_date, pp.end_date, pp.pay_date,
              pp.pay_frequency, pp.status,
              COUNT(pr.id) FILTER (WHERE pr.status::text NOT IN ('cancelled', 'voided'))::int AS employee_count,
              COALESCE(SUM(pr.gross_pay) FILTER (WHERE pr.status::text NOT IN ('cancelled', 'voided')), 0) AS total_gross_pay,
              COALESCE(SUM(pr.total_deductions) FILTER (WHERE pr.status::text NOT IN ('cancelled', 'voided')), 0) AS total_deductions,
              COALESCE(SUM(pr.net_pay) FILTER (WHERE pr.status::text NOT IN ('cancelled', 'voided')), 0) AS total_net_pay,
              COALESCE(SUM(pr.employer_contributions) FILTER (WHERE pr.status::text NOT IN ('cancelled', 'voided')), 0) AS total_employer_contributions,
              COALESCE(SUM(pr.sss_employee + pr.phil_health_employee + pr.pag_ibig_employee) FILTER (WHERE pr.status::text NOT IN ('cancelled', 'voided')), 0) AS total_government_deductions,
              COALESCE(SUM(pr.withholding_tax) FILTER (WHERE pr.status::text NOT IN ('cancelled', 'voided')), 0) AS total_withholding_tax
       FROM payroll_periods pp
       LEFT JOIN payroll_records pr ON pr.payroll_period_id = pp.id
       LEFT JOIN employees e ON e.id = pr.employee_id
       ${summaryWhere}
       GROUP BY pp.id`,
      values
    )
    rows = result.rows
  } else if (reportType === 'employees') {
    rows = (await db.query(
      `SELECT e.employee_number, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              d.name AS department, p.title AS position_title,
              pr.gross_pay, pr.total_deductions, pr.net_pay, pr.status AS payroll_status
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       JOIN employees e ON e.id = pr.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN positions p ON p.id = e.position_id
       ${where}
       ORDER BY e.last_name, e.first_name`,
      values
    )).rows
  } else if (reportType === 'government-contributions') {
    rows = (await db.query(
      `SELECT e.employee_number, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              pr.sss_employee, pr.sss_employer,
              pr.phil_health_employee, pr.phil_health_employer,
              pr.pag_ibig_employee, pr.pag_ibig_employer,
              (pr.sss_employee + pr.sss_employer + pr.phil_health_employee + pr.phil_health_employer + pr.pag_ibig_employee + pr.pag_ibig_employer) AS total_contribution
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       JOIN employees e ON e.id = pr.employee_id
       ${where}
       ORDER BY e.last_name, e.first_name`,
      values
    )).rows
  } else if (reportType === 'tax') {
    rows = (await db.query(
      `SELECT e.employee_number, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              pr.taxable_income, pr.withholding_tax, pp.pay_frequency,
              CONCAT(pp.start_date, ' to ', pp.end_date) AS payroll_period
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       JOIN employees e ON e.id = pr.employee_id
       ${where}
       ORDER BY e.last_name, e.first_name`,
      values
    )).rows
  } else {
    rows = (await db.query(
      `SELECT e.employee_number, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              pr.expected_work_days, pr.days_worked AS present_days,
              COALESCE((pcs.attendance_summary_json->>'absence_days')::numeric, 0) AS absent_days,
              pr.late_minutes, pr.undertime_minutes,
              pr.offset_earned_minutes, pr.offset_used_minutes, pr.offset_balance_minutes,
              (pr.paid_leave_days + pr.unpaid_leave_days) AS leave_days,
              (pr.absence_deduction + pr.late_deduction + pr.undertime_deduction + pr.leave_deduction) AS attendance_deductions
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       JOIN employees e ON e.id = pr.employee_id
       LEFT JOIN payroll_calculation_snapshots pcs ON pcs.id = pr.current_snapshot_id
       ${where}
       ORDER BY e.last_name, e.first_name`,
      values
    )).rows
  }

  const totals = rows.reduce<Record<string, number>>((acc, row) => {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) {
        acc[key] = (acc[key] ?? 0) + toNumber(value)
      }
    }
    return acc
  }, {})

  return {
    reportType,
    period,
    generatedAt: new Date().toISOString(),
    filters,
    totals,
    rows,
  }
}

export function reportToCsv(report: PayrollReportResult): string {
  const headers = report.rows.length ? Object.keys(report.rows[0]) : []
  const escape = (value: unknown) => {
    const text = value == null ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  return [
    headers.map(escape).join(','),
    ...report.rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ].join('\n')
}

function addPdfRow(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width = 240) {
  doc.font('Helvetica').fontSize(8.5).fillColor('#5f6673').text(label, x, y, { width: width * 0.58 })
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#111827').text(value, x + width * 0.58, y, { width: width * 0.42, align: 'right' })
}

function addSection(doc: PDFKit.PDFDocument, title: string, x: number, y: number, width: number) {
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827').text(title, x, y)
  doc.moveTo(x, y + 13).lineTo(x + width, y + 13).strokeColor('#d9dee7').lineWidth(0.6).stroke()
}

export async function generatePayslipPdf(payload: PayslipPayload): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const left = 36
    const right = 306
    const sectionWidth = 253
    doc.rect(0, 0, 595, 92).fill('#0f766e')
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(payload.company.name, left, 28)
    doc.font('Helvetica').fontSize(8.5).text(payload.company.address || 'Company address not configured', left, 52)
    if (payload.company.contact) doc.text(payload.company.contact, left, 65)
    doc.font('Helvetica-Bold').fontSize(16).text('PAYSLIP', right, 28, { width: 253, align: 'right' })
    doc.font('Helvetica').fontSize(8.5).text(`Generated ${new Date(payload.generatedAt).toLocaleString('en-PH')}`, right, 52, { width: 253, align: 'right' })
    doc.text(payload.referenceNumber, right, 65, { width: 253, align: 'right' })

    let y = 112
    addSection(doc, 'Employee Information', left, y, 523)
    y += 24
    addPdfRow(doc, 'Employee', String(payload.employee.name), left, y)
    addPdfRow(doc, 'Employee ID', String(payload.employee.employeeNumber ?? payload.employee.id), right, y)
    y += 15
    addPdfRow(doc, 'Department', String(payload.employee.department ?? 'Not assigned'), left, y)
    addPdfRow(doc, 'Position', String(payload.employee.position ?? 'Not assigned'), right, y)
    y += 15
    addPdfRow(doc, 'Employment Type', String(payload.employee.employmentType ?? 'Not recorded'), left, y)
    addPdfRow(doc, 'Payroll Frequency', String(payload.period.frequency), right, y)
    y += 15
    addPdfRow(doc, 'Payroll Period', `${payload.period.startDate} to ${payload.period.endDate}`, left, y)
    addPdfRow(doc, 'Pay Date', String(payload.period.payDate), right, y)

    y += 30
    addSection(doc, 'Earnings', left, y, sectionWidth)
    addSection(doc, 'Deductions', right, y, sectionWidth)
    y += 24
    const earningsRows = [
      ['Basic pay', payload.earnings.basicPay],
      ['Holiday pay', payload.earnings.holidayPay],
      ['Night differential', payload.earnings.nightDifferential],
      ['Paid leave amount', payload.earnings.paidLeaveAmount],
      ['Allowances', payload.earnings.allowances],
      ['Bonuses / incentives', payload.earnings.bonusesAndIncentives],
      ['Other taxable earnings', payload.earnings.otherTaxableEarnings],
      ['Other non-taxable earnings', payload.earnings.otherNonTaxableEarnings],
      ['Gross pay', payload.earnings.grossPay],
    ] as const
    const deductionRows = [
      ['Late deduction', payload.deductions.lateDeduction],
      ['Undertime deduction', payload.deductions.undertimeDeduction],
      ['Absence deduction', payload.deductions.absenceDeduction],
      ['Unpaid leave deduction', payload.deductions.unpaidLeaveDeduction],
      ['SSS employee share', payload.deductions.sssEmployee],
      ['PhilHealth employee share', payload.deductions.philHealthEmployee],
      ['Pag-IBIG employee share', payload.deductions.pagIbigEmployee],
      ['Withholding tax', payload.deductions.withholdingTax],
      ['Other deductions', payload.deductions.otherDeductions],
      ['Total deductions', payload.deductions.totalDeductions],
    ] as const
    const maxRows = Math.max(earningsRows.length, deductionRows.length)
    for (let i = 0; i < maxRows; i++) {
      if (earningsRows[i]) addPdfRow(doc, earningsRows[i][0], formatPeso(earningsRows[i][1]), left, y, sectionWidth)
      if (deductionRows[i]) addPdfRow(doc, deductionRows[i][0], formatPeso(deductionRows[i][1]), right, y, sectionWidth)
      y += 14
    }

    y += 14
    addSection(doc, 'Attendance and Leave Summary', left, y, 523)
    y += 24
    const attendanceRows = [
      ['Expected workdays', payload.attendance.expectedWorkdays],
      ['Days present', payload.attendance.daysPresent],
      ['Days absent', payload.attendance.daysAbsent],
      ['Late minutes', payload.attendance.lateMinutes],
      ['Undertime minutes', payload.attendance.undertimeMinutes],
      ['Offset earned minutes', payload.attendance.offsetEarnedMinutes],
      ['Offset used minutes', payload.attendance.offsetUsedMinutes],
      ['Remaining offset minutes', payload.attendance.offsetBalanceMinutes],
      ['Paid leave days', payload.attendance.paidLeaveDays],
      ['Unpaid leave days', payload.attendance.unpaidLeaveDays],
    ] as const
    attendanceRows.forEach((row, index) => {
      addPdfRow(doc, row[0], String(row[1]), index % 2 === 0 ? left : right, y + Math.floor(index / 2) * 14, sectionWidth)
    })
    y += 72

    addSection(doc, 'Employer Contributions', left, y, sectionWidth)
    addSection(doc, 'Payroll Summary', right, y, sectionWidth)
    y += 24
    const employerRows = [
      ['SSS employer share', payload.employerContributions.sssEmployer],
      ['PhilHealth employer share', payload.employerContributions.philHealthEmployer],
      ['Pag-IBIG employer share', payload.employerContributions.pagIbigEmployer],
      ['Other employer-paid benefits', payload.employerContributions.otherEmployerPaidBenefits],
      ['Total employer contributions', payload.employerContributions.totalEmployerContributions],
    ] as const
    const summaryRows = [
      ['Gross pay', payload.summary.grossPay],
      ['Taxable income', payload.summary.taxableIncome],
      ['Non-taxable earnings', payload.summary.nonTaxableEarnings],
      ['Total deductions', payload.summary.totalDeductions],
      ['Net pay', payload.summary.netPay],
    ] as const
    for (let i = 0; i < Math.max(employerRows.length, summaryRows.length); i++) {
      if (employerRows[i]) addPdfRow(doc, employerRows[i][0], formatPeso(employerRows[i][1]), left, y, sectionWidth)
      if (summaryRows[i]) addPdfRow(doc, summaryRows[i][0], formatPeso(summaryRows[i][1]), right, y, sectionWidth)
      y += 14
    }
    doc.font('Helvetica').fontSize(8).fillColor('#5f6673').text('Employer contributions are company-paid benefits and do not reduce employee net pay.', left, y + 2, { width: sectionWidth })
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f766e').text(formatPeso(payload.summary.netPay), right, y + 2, { width: sectionWidth, align: 'right' })
    doc.font('Helvetica').fontSize(8).fillColor('#5f6673').text(String(payload.summary.amountInWords), right, y + 26, { width: sectionWidth, align: 'right' })

    y += 62
    addSection(doc, 'Audit and System Metadata', left, y, 523)
    y += 24
    const metadataRows = [
      ['Payroll status', String(payload.metadata.payrollStatus)],
      ['Approved by', String(payload.metadata.approvedBy ?? 'Not recorded')],
      ['Released by', String(payload.metadata.releasedBy ?? 'Not recorded')],
      ['Released date', payload.metadata.releasedDate ? new Date(String(payload.metadata.releasedDate)).toLocaleString('en-PH') : 'Not recorded'],
      ['Snapshot ID', String(payload.metadata.calculationSnapshotId ?? 'Not recorded')],
      ['Formula/rule version', String(payload.metadata.formulaVersion ?? 'Not recorded')],
      ['Statutory rules', String(payload.metadata.statutoryRuleVersion ?? 'Not recorded')],
    ] as const
    metadataRows.forEach((row, index) => {
      addPdfRow(doc, row[0], row[1], index % 2 === 0 ? left : right, y + Math.floor(index / 2) * 14, sectionWidth)
    })

    doc.font('Helvetica').fontSize(7.5).fillColor('#6b7280').text(
      'This payslip is generated from approved payroll records and calculation snapshots in the iBayad Payroll Management System.',
      left,
      807,
      { width: 523, align: 'center' }
    )

    doc.end()
  })
}
