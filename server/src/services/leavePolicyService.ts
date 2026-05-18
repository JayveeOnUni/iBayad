import { addDays, differenceInCalendarDays, format, isAfter, isBefore, parseISO } from 'date-fns'
import type { Pool, PoolClient } from 'pg'
import pool from '../utils/db'
import { HolidayCalendarService } from './holidayCalendarService'

export type LeaveCode = 'VACATION' | 'SICK' | 'EMERGENCY' | 'BEREAVEMENT' | 'NON_PAID' | 'MATERNITY' | 'PATERNITY'
export type LeaveDayCountType = 'working_days' | 'calendar_days'

export interface LeaveTypePolicyRow {
  id: string
  code: LeaveCode
  name: string
  is_paid: boolean
  is_accrual_based: boolean
  requires_balance: boolean
  applies_to_probationary: boolean
  applies_to_regular: boolean
  max_days_per_request: string | null
  filing_deadline_days: number | null
  filing_deadline_type: string | null
  requires_document: boolean
  document_rule: string | null
  is_statutory: boolean
  day_count_type: LeaveDayCountType
}

export interface LeaveEmployeeRow {
  id: string
  employee_number: string
  first_name: string
  last_name: string
  employment_type: string
  hire_date: Date
  regularization_date: Date | null
  gender: string | null
  civil_status: string | null
  basic_salary: string
  daily_rate: string | null
  work_days_per_month: number | null
  city: string | null
  province: string | null
  nationality: string | null
  shift_start_time: string | null
}

export interface LeaveRequestInput {
  employeeId: string
  leaveTypeId: string
  startDate: string
  endDate: string
  reason: string
  emergencyReasonCategory?: string
  notificationAt?: string
  notificationMethod?: string
  emailFollowUpAt?: string
  isContagious?: boolean
  deliveryDate?: string
  deliveryCount?: number
  spouseDeliveryCount?: number
  relationshipToDeceased?: string
  acknowledgedPolicy?: boolean
  documentTypes?: string[]
}

export interface LeaveValidationResult {
  employee: LeaveEmployeeRow
  leaveType: LeaveTypePolicyRow
  totalDays: number
  dayCountType: LeaveDayCountType
  warnings: string[]
  errors: string[]
}

type Queryable = Pool | PoolClient

const EMERGENCY_REASONS = new Set([
  'family_accident_hospitalization_serious_sickness',
  'natural_calamity',
  'extraordinary_situation',
])

const BEREAVEMENT_RELATIONSHIPS = new Set(['spouse', 'parents', 'siblings', 'parents_in_law'])

export class LeavePolicyService {
  static readonly clarificationItems = [
    'Vacation leave conflict: maximum 3 consecutive days versus department-head route for more than 3 days.',
    'Exact leave entitlement progression from 5 to 10 to 15 days requires HR confirmation.',
    'Front-loaded versus monthly accrual requires HR confirmation; current implementation computes earned monthly credits.',
    'Vacation, sick, emergency, and bereavement day counting require HR confirmation; current implementation uses working days and excludes non-working holidays.',
    'Bereavement payment, deduction source, and supporting documents require HR confirmation; current implementation treats it as configurable unpaid/non-credit leave.',
    'Emergency leave supporting documents require HR confirmation.',
    'Sick leave approval versus notice-only workflow requires HR confirmation; current implementation still routes through review.',
    'Mandated leave and recall effects require HR confirmation.',
    'Holiday handling for non-statutory leaves requires HR confirmation; current implementation excludes non-working holidays for working-day leaves.',
    'Payroll daily-rate formulas require HR confirmation; current implementation uses employee daily_rate or monthly salary divided by work_days_per_month.',
  ]

  static parseDate(value: string): Date {
    return parseISO(value)
  }

  static toDateKey(value: Date): string {
    return format(value, 'yyyy-MM-dd')
  }

  static async getEmployee(employeeId: string, db: Queryable = pool): Promise<LeaveEmployeeRow | undefined> {
    const result = await db.query(
      `SELECT e.*, ws.start_time AS shift_start_time
       FROM employees e
       LEFT JOIN work_shifts ws ON ws.id = e.shift_id
       WHERE e.id = $1`,
      [employeeId]
    )
    return result.rows[0] as LeaveEmployeeRow | undefined
  }

  static async getLeaveType(leaveTypeId: string, db: Queryable = pool): Promise<LeaveTypePolicyRow | undefined> {
    const result = await db.query(
      `SELECT id, code, name, is_paid, COALESCE(is_accrual_based, false) AS is_accrual_based,
              COALESCE(requires_balance, false) AS requires_balance,
              COALESCE(applies_to_probationary, false) AS applies_to_probationary,
              COALESCE(applies_to_regular, true) AS applies_to_regular,
              max_days_per_request,
              filing_deadline_days,
              filing_deadline_type,
              COALESCE(requires_document, requires_docs, false) AS requires_document,
              document_rule,
              COALESCE(is_statutory, false) AS is_statutory,
              COALESCE(day_count_type, 'working_days') AS day_count_type
       FROM leave_types
       WHERE id = $1 AND is_active = true`,
      [leaveTypeId]
    )
    return result.rows[0] as LeaveTypePolicyRow | undefined
  }

  static async getLeaveTypeByCode(code: LeaveCode, db: Queryable = pool): Promise<LeaveTypePolicyRow | undefined> {
    const result = await db.query(
      `SELECT id, code, name, is_paid, COALESCE(is_accrual_based, false) AS is_accrual_based,
              COALESCE(requires_balance, false) AS requires_balance,
              COALESCE(applies_to_probationary, false) AS applies_to_probationary,
              COALESCE(applies_to_regular, true) AS applies_to_regular,
              max_days_per_request,
              filing_deadline_days,
              filing_deadline_type,
              COALESCE(requires_document, requires_docs, false) AS requires_document,
              document_rule,
              COALESCE(is_statutory, false) AS is_statutory,
              COALESCE(day_count_type, 'working_days') AS day_count_type
       FROM leave_types
       WHERE code = $1 AND is_active = true`,
      [code]
    )
    return result.rows[0] as LeaveTypePolicyRow | undefined
  }

  static isRegular(employee: LeaveEmployeeRow): boolean {
    return employee.employment_type === 'regular'
  }

  static isProbationary(employee: LeaveEmployeeRow): boolean {
    return employee.employment_type === 'probationary'
  }

  static async countLeaveDays(
    leaveType: LeaveTypePolicyRow,
    employee: LeaveEmployeeRow,
    startDate: Date,
    endDate: Date,
    db: Queryable = pool
  ): Promise<number> {
    if (leaveType.day_count_type === 'calendar_days') {
      return differenceInCalendarDays(endDate, startDate) + 1
    }

    return HolidayCalendarService.countWorkingDays({
      startDate,
      endDate,
      country: employee.nationality && employee.nationality !== 'Filipino' ? employee.nationality : 'Philippines',
      cityOrProvince: employee.city ?? employee.province ?? undefined,
    }, db)
  }

  static monthsEarnedForYear(employee: LeaveEmployeeRow, year: number, asOf = new Date()): number {
    const regularizationDate = employee.regularization_date ? new Date(employee.regularization_date) : null
    if (!regularizationDate) return 0

    const effectiveStart = regularizationDate.getFullYear() === year ? regularizationDate : new Date(year, 0, 1)
    const effectiveEnd = asOf.getFullYear() === year ? asOf : new Date(year, 11, 31)
    if (isBefore(effectiveEnd, effectiveStart)) return 0

    return effectiveEnd.getMonth() - effectiveStart.getMonth() + 1
  }

  static entitlementFor(employee: LeaveEmployeeRow, year: number, code: LeaveCode): { annual: number; monthly: number; stage: string } {
    const stage = this.entitlementStageFor(employee, year, code)
    if (stage === 'not_accrual_based') return { annual: 0, monthly: 0, stage }
    if (stage === 'probationary_or_not_regular') return { annual: 0, monthly: 0, stage: 'probationary_or_not_regular' }
    if (stage === 'pre_2022_regular') return { annual: 15, monthly: 1.25, stage }
    if (stage === 'regular_first_entitlement') return { annual: 5, monthly: 0.42, stage }
    if (stage === 'regular_following_entitlement') return { annual: 10, monthly: 0.83, stage }
    return { annual: 15, monthly: 1.25, stage }
  }

  static entitlementStageFor(employee: LeaveEmployeeRow, year: number, code: LeaveCode): string {
    if (code !== 'VACATION' && code !== 'SICK') return 'not_accrual_based'
    if (!this.isRegular(employee) || !employee.regularization_date) return 'probationary_or_not_regular'

    const regularizationDate = new Date(employee.regularization_date)
    if (regularizationDate <= new Date('2021-12-31T00:00:00')) {
      return 'pre_2022_regular'
    }

    const yearsAfterRegularization = year - regularizationDate.getFullYear()
    if (yearsAfterRegularization <= 0) return 'regular_first_entitlement'
    if (yearsAfterRegularization === 1) return 'regular_following_entitlement'
    return 'regular_later_entitlement'
  }

  static async configuredEntitlementFor(
    employee: LeaveEmployeeRow,
    year: number,
    code: LeaveCode
  ): Promise<{ annual: number; monthly: number; stage: string }> {
    const fallback = this.entitlementFor(employee, year, code)
    if (code !== 'VACATION' && code !== 'SICK') return fallback

    const result = await pool.query(
      `SELECT lp.entitlement_days, lp.monthly_credit
       FROM leave_policies lp
       JOIN leave_types lt ON lt.id = lp.leave_type_id
       WHERE lt.code = $1
         AND lp.employment_status = $2
         AND lp.effective_date <= $3::date
       ORDER BY lp.effective_date DESC
       LIMIT 1`,
      [code, fallback.stage, `${year}-12-31`]
    )
    const row = result.rows[0] as { entitlement_days?: unknown; monthly_credit?: unknown } | undefined
    if (!row) return fallback

    const annual = Number(row.entitlement_days ?? fallback.annual)
    const monthly = Number(row.monthly_credit ?? fallback.monthly)

    return {
      annual: Number.isFinite(annual) ? annual : fallback.annual,
      monthly: Number.isFinite(monthly) ? monthly : fallback.monthly,
      stage: fallback.stage,
    }
  }

  static async configuredEarnedCreditsFor(
    employee: LeaveEmployeeRow,
    year: number,
    code: LeaveCode,
    asOf = new Date()
  ): Promise<number> {
    const entitlement = await this.configuredEntitlementFor(employee, year, code)
    const months = this.monthsEarnedForYear(employee, year, asOf)
    return Math.min(entitlement.annual, Math.round(entitlement.monthly * months * 100) / 100)
  }

  static async configuredCarryOverLimitFor(
    employee: LeaveEmployeeRow,
    year: number,
    code: LeaveCode
  ): Promise<number | null> {
    const entitlement = this.entitlementFor(employee, year, code)
    const result = await pool.query(
      `SELECT lp.carry_over_limit
       FROM leave_policies lp
       JOIN leave_types lt ON lt.id = lp.leave_type_id
       WHERE lt.code = $1
         AND lp.employment_status = $2
         AND lp.effective_date <= $3::date
       ORDER BY lp.effective_date DESC
       LIMIT 1`,
      [code, entitlement.stage, `${year}-12-31`]
    )
    const value = Number(result.rows[0]?.carry_over_limit)
    return Number.isFinite(value) ? value : null
  }

  static async configuredCashConversionLimitFor(
    employee: LeaveEmployeeRow,
    year: number,
    code: LeaveCode
  ): Promise<number | null> {
    const entitlement = this.entitlementFor(employee, year, code)
    const result = await pool.query(
      `SELECT lp.cash_conversion_limit
       FROM leave_policies lp
       JOIN leave_types lt ON lt.id = lp.leave_type_id
       WHERE lt.code = $1
         AND lp.employment_status = $2
         AND lp.effective_date <= $3::date
       ORDER BY lp.effective_date DESC
       LIMIT 1`,
      [code, entitlement.stage, `${year}-12-31`]
    )
    const value = Number(result.rows[0]?.cash_conversion_limit)
    return Number.isFinite(value) ? value : null
  }

  static earnedCreditsFor(employee: LeaveEmployeeRow, year: number, code: LeaveCode, asOf = new Date()): number {
    const entitlement = this.entitlementFor(employee, year, code)
    const months = this.monthsEarnedForYear(employee, year, asOf)
    return Math.min(entitlement.annual, Math.round(entitlement.monthly * months * 100) / 100)
  }

  static async validate(input: LeaveRequestInput, now = new Date()): Promise<LeaveValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const employee = await this.getEmployee(input.employeeId)
    const leaveType = await this.getLeaveType(input.leaveTypeId)

    if (!employee) throw new Error('Employee not found')
    if (!leaveType) throw new Error('Leave type not found')

    const startDate = this.parseDate(input.startDate)
    const endDate = this.parseDate(input.endDate)
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      errors.push('Start date and end date must be valid dates.')
    }
    if (isAfter(startDate, endDate)) {
      errors.push('Leave end date cannot be earlier than start date.')
    }

    const totalDays = errors.length ? 0 : await this.countLeaveDays(leaveType, employee, startDate, endDate)
    if (totalDays <= 0 && errors.length === 0) errors.push('Selected date range has no countable leave days.')

    if (this.isProbationary(employee) && !leaveType.applies_to_probationary) {
      errors.push(`${leaveType.name} is available only to regular employees.`)
    }
    if (this.isRegular(employee) && !leaveType.applies_to_regular) {
      errors.push(`${leaveType.name} is not available to regular employees.`)
    }

    await this.validateOverlap(input, errors)
    this.validateConfiguredMaxDays(leaveType, totalDays, errors)
    await this.validateConfiguredFilingDeadline(input, leaveType, employee, startDate, now, errors)
    this.validateConfiguredDocuments(input, leaveType, totalDays, errors)

    switch (leaveType.code) {
      case 'VACATION':
        this.validateVacation(input, totalDays, warnings)
        break
      case 'SICK':
        this.validateSick(input, totalDays, warnings)
        break
      case 'EMERGENCY':
        this.validateEmergency(input, warnings, errors)
        break
      case 'BEREAVEMENT':
        this.validateBereavement(input, warnings, errors)
        break
      case 'MATERNITY':
        this.validateMaternity(input, totalDays, employee, errors)
        break
      case 'PATERNITY':
        this.validatePaternity(input, totalDays, employee, startDate, endDate, errors)
        break
      case 'NON_PAID':
        break
    }

    if (!input.acknowledgedPolicy) {
      warnings.push('Employee acknowledgement is recommended before submission.')
    }

    return { employee, leaveType, totalDays, dayCountType: leaveType.day_count_type, warnings, errors }
  }

  private static async validateOverlap(input: LeaveRequestInput, errors: string[]): Promise<void> {
    const result = await pool.query(
      `SELECT id
       FROM leave_requests
       WHERE employee_id = $1
         AND status IN ('pending', 'approved')
         AND daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]')
       LIMIT 1`,
      [input.employeeId, input.startDate, input.endDate]
    )
    if (result.rows[0]) errors.push('This request overlaps with an existing leave request.')
  }

  private static validateConfiguredMaxDays(leaveType: LeaveTypePolicyRow, totalDays: number, errors: string[]): void {
    const maxDays = Number(leaveType.max_days_per_request)
    if (!Number.isFinite(maxDays) || maxDays <= 0 || totalDays <= maxDays) return

    if (leaveType.code === 'VACATION') return

    errors.push(`${leaveType.name} cannot exceed ${maxDays} day${maxDays === 1 ? '' : 's'} per request.`)
  }

  private static async validateConfiguredFilingDeadline(
    input: LeaveRequestInput,
    leaveType: LeaveTypePolicyRow,
    employee: LeaveEmployeeRow,
    startDate: Date,
    now: Date,
    errors: string[]
  ): Promise<void> {
    const deadlineType = leaveType.filing_deadline_type?.trim()
    if (!deadlineType) return

    if (deadlineType === 'one_hour_before_shift') {
      this.validateOneHourNotice(input, employee, startDate, errors, leaveType.name)
      return
    }

    const deadlineDays = leaveType.filing_deadline_days
    if (deadlineDays === null || deadlineDays === undefined) return

    if (deadlineType === 'working_days_before_start') {
      const workingDaysBeforeStart = await HolidayCalendarService.countWorkingDays({
        startDate: addDays(now, 1),
        endDate: addDays(startDate, -1),
        country: employee.nationality && employee.nationality !== 'Filipino' ? employee.nationality : 'Philippines',
        cityOrProvince: employee.city ?? employee.province ?? undefined,
      })
      if (workingDaysBeforeStart < deadlineDays) {
        errors.push(`${leaveType.name} must be filed at least ${deadlineDays} working day${deadlineDays === 1 ? '' : 's'} before the requested date.`)
      }
      return
    }

    if (deadlineType === 'calendar_days_before_start' || deadlineType === 'days_before_start') {
      const calendarDaysBeforeStart = differenceInCalendarDays(startDate, now)
      if (calendarDaysBeforeStart < deadlineDays) {
        errors.push(`${leaveType.name} must be filed at least ${deadlineDays} calendar day${deadlineDays === 1 ? '' : 's'} before the requested date.`)
      }
    }
  }

  private static validateConfiguredDocuments(
    input: LeaveRequestInput,
    leaveType: LeaveTypePolicyRow,
    totalDays: number,
    errors: string[]
  ): void {
    if (!leaveType.requires_document) return

    const documentTypes = new Set(input.documentTypes ?? [])
    const requiredTypes = this.requiredDocumentTypesFor(leaveType, totalDays, Boolean(input.isContagious))
    for (const documentType of requiredTypes) {
      if (!documentTypes.has(documentType)) {
        errors.push(`${leaveType.name} requires ${this.documentLabel(documentType)}.`)
      }
    }
  }

  private static requiredDocumentTypesFor(leaveType: LeaveTypePolicyRow, totalDays: number, isContagious: boolean): string[] {
    const rule = leaveType.document_rule?.toLowerCase() ?? ''
    const required = new Set<string>()
    const hasKnownRule = rule.includes('medical certificate') || rule.includes('medical clearance')

    if (rule.includes('medical certificate')) {
      if (!rule.includes('more than 2') || totalDays > 2) required.add('MEDICAL_CERTIFICATE')
    }
    if (rule.includes('medical clearance') && (!rule.includes('contagious') || isContagious)) {
      required.add('MEDICAL_CLEARANCE')
    }
    if (required.size === 0 && leaveType.requires_document && !hasKnownRule) {
      required.add('SUPPORTING_DOCUMENT')
    }

    return Array.from(required)
  }

  private static documentLabel(documentType: string): string {
    return documentType.toLowerCase().replace(/_/g, ' ')
  }

  private static validateVacation(
    input: LeaveRequestInput,
    totalDays: number,
    warnings: string[]
  ): void {
    if (totalDays > 3) {
      warnings.push('Clarification required: vacation leave above 3 days may be prohibited or may require department head approval.')
    }
    if (input.documentTypes?.length) return
  }

  private static validateSick(
    input: LeaveRequestInput,
    totalDays: number,
    warnings: string[]
  ): void {
    const documentTypes = new Set(input.documentTypes ?? [])
    if (totalDays > 2 && !documentTypes.has('MEDICAL_CERTIFICATE')) {
      warnings.push('Sick leave of more than 2 days requires a medical certificate before returning to work.')
    }
    if (input.isContagious && !documentTypes.has('MEDICAL_CLEARANCE')) {
      warnings.push('A medical clearance is required before returning to work for contagious disease.')
    }
  }

  private static validateEmergency(
    input: LeaveRequestInput,
    warnings: string[],
    errors: string[]
  ): void {
    if (!input.emergencyReasonCategory || !EMERGENCY_REASONS.has(input.emergencyReasonCategory)) {
      errors.push('Emergency leave requires a valid emergency reason category.')
    }
    warnings.push('Emergency leave documentation is not specified in the memo and requires HR confirmation.')
  }

  private static validateBereavement(input: LeaveRequestInput, warnings: string[], errors: string[]): void {
    if (!input.relationshipToDeceased || !BEREAVEMENT_RELATIONSHIPS.has(input.relationshipToDeceased)) {
      errors.push('Bereavement leave requires an immediate family relationship covered by the memo.')
    }
    warnings.push('Bereavement payment, deductions, and documents require HR confirmation.')
  }

  private static validateMaternity(input: LeaveRequestInput, totalDays: number, employee: LeaveEmployeeRow, errors: string[]): void {
    if (employee.gender !== 'female') errors.push('Maternity leave is available only to pregnant female employees.')
    if (!input.deliveryDate) errors.push('Maternity leave requires an expected or actual delivery date.')
    if (!input.deliveryCount || input.deliveryCount < 1) errors.push('Maternity leave requires a delivery count.')
    if (input.deliveryCount && input.deliveryCount > 4) errors.push('Maternity leave is available only for the first four deliveries.')
    if (totalDays > 105) errors.push('Maternity leave cannot exceed 105 calendar days.')
  }

  private static validatePaternity(
    input: LeaveRequestInput,
    totalDays: number,
    employee: LeaveEmployeeRow,
    startDate: Date,
    endDate: Date,
    errors: string[]
  ): void {
    if (employee.gender !== 'male') errors.push('Paternity leave is available only to male employees.')
    if (employee.civil_status !== 'married') errors.push('Paternity leave is available only to legally married male employees.')
    if (!input.deliveryDate) errors.push('Paternity leave requires the spouse delivery date.')
    if (!input.spouseDeliveryCount || input.spouseDeliveryCount < 1) errors.push('Paternity leave requires the spouse delivery count.')
    if (input.spouseDeliveryCount && input.spouseDeliveryCount > 4) errors.push('Paternity leave is available only for the first four spouse deliveries.')
    if (totalDays > 7) errors.push('Paternity leave cannot exceed 7 working days.')

    if (input.deliveryDate) {
      const deliveryDate = this.parseDate(input.deliveryDate)
      const earliest = addDays(deliveryDate, -60)
      const latest = addDays(deliveryDate, 60)
      if (isBefore(startDate, earliest) || isAfter(endDate, latest)) {
        errors.push('Paternity leave must be used within 60 calendar days before or after delivery.')
      }
    }
  }

  private static validateOneHourNotice(
    input: LeaveRequestInput,
    employee: LeaveEmployeeRow,
    startDate: Date,
    errors: string[],
    leaveName = 'Sick and emergency leave'
  ): void {
    if (!input.notificationAt) {
      errors.push(`${leaveName} requires notice at least 1 hour before the start of shift.`)
      return
    }
    const shiftStart = employee.shift_start_time ?? '08:00:00'
    const shiftStartAt = new Date(`${this.toDateKey(startDate)}T${shiftStart}`)
    const notificationAt = new Date(input.notificationAt)
    const minutesBeforeShift = (shiftStartAt.getTime() - notificationAt.getTime()) / 60000
    if (minutesBeforeShift < 60) {
      errors.push(`${leaveName} notice must be sent at least 1 hour before the start of shift.`)
    }
    if (input.notificationMethod && input.notificationMethod !== 'email' && !input.emailFollowUpAt) {
      errors.push(`Alternative ${leaveName.toLowerCase()} notices must be complemented by email within 24 hours.`)
    }
  }
}
