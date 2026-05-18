import type {
  AttendanceRecord,
  AttendanceRequest,
  Employee,
  LeaveApplication,
  PayrollAuditEntry,
  PayrollCalculationSnapshot,
  OffsetBalance,
  OffsetCredit,
  OffsetUsage,
  PayrollPeriod,
  PayrollRecord,
  ProfileUpdateChange,
  ProfileUpdateRequest,
  PayrollValidationEmployeeIssue,
  PayrollValidationIssue,
  PayrollValidationReport,
  PayrollWarning,
} from '../types'

type Row = Record<string, unknown>

function str(value: unknown, fallback = ''): string {
  return value == null ? fallback : String(value)
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function mapEmployee(row: Row): Employee {
  return {
    id: str(row.id),
    employeeNumber: str(row.employee_number ?? row.employeeNumber),
    firstName: str(row.first_name ?? row.firstName),
    middleName: row.middle_name ? str(row.middle_name) : undefined,
    lastName: str(row.last_name ?? row.lastName),
    email: str(row.email),
    phone: row.phone ? str(row.phone) : undefined,
    birthDate: str(row.birth_date ?? row.birthDate),
    gender: (row.gender as Employee['gender']) ?? 'other',
    civilStatus: (row.civil_status ?? row.civilStatus ?? 'single') as Employee['civilStatus'],
    address: str(row.address),
    city: str(row.city),
    province: str(row.province),
    zipCode: str(row.zip_code ?? row.zipCode),
    departmentId: str(row.department_id ?? row.departmentId),
    department: row.department_name
      ? {
          id: str(row.department_id ?? row.departmentId),
          name: str(row.department_name),
          code: str(row.department_code),
          isActive: true,
          createdAt: '',
          updatedAt: '',
        }
      : undefined,
    positionId: str(row.position_id ?? row.positionId),
    position: row.position_title
      ? {
          id: str(row.position_id ?? row.positionId),
          title: str(row.position_title),
          departmentId: str(row.department_id ?? row.departmentId),
          basicSalary: num(row.basic_salary ?? row.basicSalary),
          salaryType: 'monthly',
          isActive: true,
          createdAt: '',
          updatedAt: '',
        }
      : undefined,
    employmentType: (row.employment_type ?? row.employmentType ?? 'regular') as Employee['employmentType'],
    employmentStatus: (row.employment_status ?? row.employmentStatus ?? 'active') as Employee['employmentStatus'],
    hireDate: str(row.hire_date ?? row.hireDate),
    regularizationDate: row.regularization_date ? str(row.regularization_date) : undefined,
    lastWorkingDay: row.last_working_day ? str(row.last_working_day) : undefined,
    separationDate: row.separation_date ? str(row.separation_date) : undefined,
    separationReason: row.separation_reason ? str(row.separation_reason) : undefined,
    separationRemarks: row.separation_remarks ? str(row.separation_remarks) : undefined,
    separationProcessedBy: (row.separation_processed_by_email ?? row.separation_processed_by) ? str(row.separation_processed_by_email ?? row.separation_processed_by) : undefined,
    separationProcessedAt: row.separation_processed_at ? str(row.separation_processed_at) : undefined,
    isDeleted: Boolean(row.is_deleted ?? row.isDeleted),
    deletedAt: row.deleted_at ? str(row.deleted_at) : undefined,
    deletedBy: (row.deleted_by_email ?? row.deleted_by) ? str(row.deleted_by_email ?? row.deleted_by) : undefined,
    sssNumber: row.sss_number ? str(row.sss_number) : undefined,
    philhealthNumber: row.philhealth_number ? str(row.philhealth_number) : undefined,
    pagibigNumber: row.pagibig_number ? str(row.pagibig_number) : undefined,
    tinNumber: row.tin_number ? str(row.tin_number) : undefined,
    basicSalary: num(row.basic_salary ?? row.basicSalary),
    dailyRate: num(row.daily_rate ?? row.dailyRate),
    hourlyRate: num(row.hourly_rate ?? row.hourlyRate),
    workDaysPerMonth: num(row.work_days_per_month ?? row.workDaysPerMonth),
    workHoursPerDay: num(row.work_hours_per_day ?? row.workHoursPerDay),
    bankName: row.bank_name ? str(row.bank_name) : undefined,
    bankAccountNumber: row.bank_account_number ? str(row.bank_account_number) : undefined,
    avatarUrl: row.avatar_url ? str(row.avatar_url) : undefined,
    shiftId: row.shift_id ? str(row.shift_id) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}

export function mapProfileUpdateRequest(row: Row): ProfileUpdateRequest {
  const changes = (row.requested_changes ?? row.requestedChanges ?? {}) as Record<string, ProfileUpdateChange>

  return {
    id: str(row.id),
    employeeId: str(row.employee_id ?? row.employeeId),
    employee: row.first_name
      ? {
          id: str(row.employee_id ?? row.employeeId),
          firstName: str(row.first_name),
          lastName: str(row.last_name),
          employeeNumber: str(row.employee_number),
        }
      : undefined,
    requestedChanges: changes,
    status: str(row.status, 'pending') as ProfileUpdateRequest['status'],
    employeeNote: row.employee_note ? str(row.employee_note) : undefined,
    reviewRemarks: row.review_remarks ? str(row.review_remarks) : undefined,
    reviewedBy: row.reviewed_by ? str(row.reviewed_by) : undefined,
    reviewedAt: row.reviewed_at ? str(row.reviewed_at) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}

export function mapAttendance(row: Row): AttendanceRecord {
  const minutes = num(row.total_worked_minutes ?? row.totalWorkedMinutes)
  return {
    id: str(row.id),
    employeeId: str(row.employee_id ?? row.employeeId),
    employee: row.first_name || row.employee
      ? {
          id: str(row.employee_id ?? row.employeeId),
          firstName: str(row.first_name ?? (row.employee as Row | undefined)?.firstName),
          lastName: str(row.last_name ?? (row.employee as Row | undefined)?.lastName),
          employeeNumber: str(row.employee_number ?? (row.employee as Row | undefined)?.employeeNumber),
        }
      : undefined,
    date: str(row.date),
    timeIn: row.time_in ? str(row.time_in) : undefined,
    timeOut: row.time_out ? str(row.time_out) : undefined,
    scheduledShiftId: row.scheduled_shift_id ? str(row.scheduled_shift_id) : undefined,
    scheduledShiftName: row.scheduled_shift_name ? str(row.scheduled_shift_name) : undefined,
    scheduledStart: row.scheduled_start ? str(row.scheduled_start) : undefined,
    scheduledEnd: row.scheduled_end ? str(row.scheduled_end) : undefined,
    requiredWorkMinutes: num(row.required_work_minutes ?? row.requiredWorkMinutes),
    actualRenderedMinutes: num(row.actual_rendered_minutes ?? row.actualRenderedMinutes, minutes),
    hoursWorked: num(row.hours_worked ?? row.hoursWorked, minutes ? minutes / 60 : 0),
    overtimeHours: num(row.overtime_hours ?? row.overtimeHours),
    excessMinutes: num(row.excess_minutes ?? row.excessMinutes),
    offsetEarnedMinutes: num(row.offset_earned_minutes ?? row.offsetEarnedMinutes),
    offsetUsedMinutes: num(row.offset_used_minutes ?? row.offsetUsedMinutes),
    lateMinutes: num(row.late_minutes ?? row.lateMinutes),
    undertimeMinutes: num(row.undertime_minutes ?? row.undertimeMinutes),
    status: (row.status ?? 'present') as AttendanceRecord['status'],
    notes: row.remarks ? str(row.remarks) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}

export function mapOffsetBalance(row: Row): OffsetBalance {
  return {
    employeeId: str(row.employee_id ?? row.employeeId),
    employee: row.first_name
      ? {
          id: str(row.employee_id ?? row.employeeId),
          firstName: str(row.first_name),
          lastName: str(row.last_name),
          employeeNumber: str(row.employee_number),
        }
      : undefined,
    pendingMinutes: num(row.pending_minutes ?? row.pendingMinutes),
    availableMinutes: num(row.available_minutes ?? row.availableMinutes),
    usedMinutes: num(row.used_minutes ?? row.usedMinutes),
    pendingUsageMinutes: num(row.pending_usage_minutes ?? row.pendingUsageMinutes),
  }
}

export function mapOffsetCredit(row: Row): OffsetCredit {
  return {
    id: str(row.id),
    employeeId: str(row.employee_id ?? row.employeeId),
    employee: row.first_name
      ? {
          id: str(row.employee_id ?? row.employeeId),
          firstName: str(row.first_name),
          lastName: str(row.last_name),
          employeeNumber: str(row.employee_number),
        }
      : undefined,
    attendanceId: row.attendance_id ? str(row.attendance_id) : undefined,
    dateEarned: str(row.date_earned ?? row.dateEarned),
    source: str(row.source, 'excess_hours') as OffsetCredit['source'],
    minutesEarned: num(row.minutes_earned ?? row.minutesEarned),
    minutesRemaining: num(row.minutes_remaining ?? row.minutesRemaining),
    status: str(row.status, 'pending') as OffsetCredit['status'],
    reason: row.reason ? str(row.reason) : undefined,
    reviewRemarks: row.review_remarks ? str(row.review_remarks) : undefined,
    reviewedBy: row.reviewed_by ? str(row.reviewed_by) : undefined,
    reviewedAt: row.reviewed_at ? str(row.reviewed_at) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}

export function mapOffsetUsage(row: Row): OffsetUsage {
  return {
    id: str(row.id),
    employeeId: str(row.employee_id ?? row.employeeId),
    employee: row.first_name
      ? {
          id: str(row.employee_id ?? row.employeeId),
          firstName: str(row.first_name),
          lastName: str(row.last_name),
          employeeNumber: str(row.employee_number),
        }
      : undefined,
    attendanceId: row.attendance_id ? str(row.attendance_id) : undefined,
    usageDate: str(row.usage_date ?? row.usageDate),
    requestedMinutes: num(row.requested_minutes ?? row.requestedMinutes),
    approvedMinutes: num(row.approved_minutes ?? row.approvedMinutes),
    status: str(row.status, 'pending') as OffsetUsage['status'],
    source: str(row.source, 'employee_request') as OffsetUsage['source'],
    reason: str(row.reason),
    reviewRemarks: row.review_remarks ? str(row.review_remarks) : undefined,
    reviewedBy: row.reviewed_by ? str(row.reviewed_by) : undefined,
    reviewedAt: row.reviewed_at ? str(row.reviewed_at) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}

export function mapAttendanceRequest(row: Row): AttendanceRequest {
  return {
    id: str(row.id),
    employeeId: str(row.employee_id ?? row.employeeId),
    employee: row.first_name
      ? {
          id: str(row.employee_id ?? row.employeeId),
          firstName: str(row.first_name),
          lastName: str(row.last_name),
          employeeNumber: str(row.employee_number),
        }
      : undefined,
    date: str(row.date),
    type: 'correction',
    requestedTimeIn: row.requested_time_in ? str(row.requested_time_in) : undefined,
    requestedTimeOut: row.requested_time_out ? str(row.requested_time_out) : undefined,
    reason: str(row.reason),
    status: (row.status ?? 'pending') as AttendanceRequest['status'],
    reviewedBy: row.reviewed_by ? str(row.reviewed_by) : undefined,
    reviewedAt: row.reviewed_at ? str(row.reviewed_at) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}

export function mapLeave(row: Row): LeaveApplication {
  const documents = Array.isArray(row.documents)
    ? row.documents.map((doc) => {
        const item = doc as Row
        return {
          id: str(item.id),
          documentType: str(item.document_type ?? item.documentType),
          fileName: str(item.file_name ?? item.fileName),
          fileUrl: str(item.file_url ?? item.fileUrl),
          status: str(item.status, 'pending'),
        }
      })
    : undefined

  return {
    id: str(row.id),
    employeeId: str(row.employee_id ?? row.employeeId),
    employee: row.first_name
      ? {
          id: str(row.employee_id ?? row.employeeId),
          firstName: str(row.first_name),
          lastName: str(row.last_name),
          employeeNumber: str(row.employee_number),
        }
      : undefined,
    leaveType: str(row.leave_type_name ?? row.leave_type ?? row.leaveType).toLowerCase().replace(' leave', '').replace(/\s+/g, '_') as LeaveApplication['leaveType'],
    startDate: str(row.start_date ?? row.startDate),
    endDate: str(row.end_date ?? row.endDate),
    totalDays: num(row.total_days ?? row.totalDays),
    dayCountType: (row.day_count_type ?? row.dayCountType) as LeaveApplication['dayCountType'],
    reason: str(row.reason),
    emergencyReasonCategory: row.emergency_reason_category ? str(row.emergency_reason_category) : undefined,
    unpaidDays: num(row.unpaid_days ?? row.unpaidDays),
    deductedSickDays: num(row.deducted_sick_days ?? row.deductedSickDays),
    deductedVacationDays: num(row.deducted_vacation_days ?? row.deductedVacationDays),
    payrollImpactStatus: row.payroll_impact_status ? str(row.payroll_impact_status) : undefined,
    attendanceImpactStatus: row.attendance_impact_status ? str(row.attendance_impact_status) : undefined,
    validationWarnings: Array.isArray(row.validation_warnings) ? row.validation_warnings.map(String) : undefined,
    documents,
    status: (row.status ?? 'pending') as LeaveApplication['status'],
    approvedBy: row.reviewed_by ? str(row.reviewed_by) : undefined,
    approvedAt: row.reviewed_at ? str(row.reviewed_at) : undefined,
    rejectionReason: row.review_remarks ? str(row.review_remarks) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}

export function mapPayrollPeriod(row: Row): PayrollPeriod {
  return {
    id: str(row.id),
    name: str(row.name),
    frequency: str(row.pay_frequency ?? row.frequency, 'semi-monthly') as PayrollPeriod['frequency'],
    startDate: str(row.start_date ?? row.startDate),
    endDate: str(row.end_date ?? row.endDate),
    payDate: str(row.pay_date ?? row.payDate),
    status: str(row.status, 'draft') as PayrollPeriod['status'],
    createdBy: row.created_by ? str(row.created_by) : undefined,
    processedBy: row.processed_by ? str(row.processed_by) : undefined,
    validatedBy: row.validated_by ? str(row.validated_by) : undefined,
    approvedBy: row.approved_by ? str(row.approved_by) : undefined,
    releasedBy: row.released_by ? str(row.released_by) : undefined,
    lockedBy: row.locked_by ? str(row.locked_by) : undefined,
    reprocessedBy: row.reprocessed_by ? str(row.reprocessed_by) : undefined,
    correctionRequestedBy: row.correction_requested_by ? str(row.correction_requested_by) : undefined,
    processedAt: row.processed_at ? str(row.processed_at) : undefined,
    validatedAt: row.validated_at ? str(row.validated_at) : undefined,
    approvedAt: row.approved_at ? str(row.approved_at) : undefined,
    releasedAt: row.released_at ? str(row.released_at) : undefined,
    lockedAt: row.locked_at ? str(row.locked_at) : undefined,
    reprocessedAt: row.reprocessed_at ? str(row.reprocessed_at) : undefined,
    correctionRequestedAt: row.correction_requested_at ? str(row.correction_requested_at) : undefined,
    approvalNotes: row.approval_notes ? str(row.approval_notes) : undefined,
    correctionNotes: row.correction_notes ? str(row.correction_notes) : undefined,
    reprocessReason: row.reprocess_reason ? str(row.reprocess_reason) : undefined,
    isLocked: Boolean(row.is_locked ?? row.isLocked),
    lockedReason: row.locked_reason ? str(row.locked_reason) : undefined,
    activeEmployeeCount: num(row.active_employee_count ?? row.activeEmployeeCount),
    recordCount: num(row.record_count ?? row.recordCount),
    processingRecordCount: num(row.processing_record_count ?? row.processingRecordCount),
    approvedRecordCount: num(row.approved_record_count ?? row.approvedRecordCount),
    releasedRecordCount: num(row.released_record_count ?? row.releasedRecordCount),
    totalGrossPay: num(row.total_gross_pay ?? row.totalGrossPay),
    totalDeductions: num(row.total_deductions ?? row.totalDeductions),
    totalNetPay: num(row.total_net_pay ?? row.totalNetPay),
    negativeNetCount: num(row.negative_net_count ?? row.negativeNetCount),
    pendingAttendanceRequestCount: num(row.pending_attendance_request_count ?? row.pendingAttendanceRequestCount),
    pendingLeaveRequestCount: num(row.pending_leave_request_count ?? row.pendingLeaveRequestCount),
    warningCount: num(row.warning_count ?? row.warningCount),
    warnings: Array.isArray(row.warnings) ? row.warnings.map((warning) => mapPayrollWarning(warning as Row)) : undefined,
    auditHistory: Array.isArray(row.audit_history ?? row.auditHistory)
      ? ((row.audit_history ?? row.auditHistory) as Row[]).map(mapPayrollAuditEntry)
      : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}

export function mapPayrollWarning(row: Row): PayrollWarning {
  return {
    code: str(row.code),
    severity: str(row.severity, 'info') as PayrollWarning['severity'],
    message: str(row.message),
    count: row.count == null ? undefined : num(row.count),
  }
}

function mapValidationEmployeeIssue(row: Row): PayrollValidationEmployeeIssue {
  return {
    employeeId: str(row.employee_id ?? row.employeeId),
    employeeNumber: str(row.employee_number ?? row.employeeNumber),
    employeeName: str(row.employee_name ?? row.employeeName),
    count: row.count == null ? undefined : num(row.count),
    dates: Array.isArray(row.dates) ? row.dates.map(String) : undefined,
    amount: row.amount == null ? undefined : num(row.amount),
  }
}

function mapValidationIssue(row: Row): PayrollValidationIssue {
  return {
    code: str(row.code),
    severity: str(row.severity, 'critical') as PayrollValidationIssue['severity'],
    message: str(row.message),
    count: row.count == null ? undefined : num(row.count),
  }
}

function withoutLoanDeductions(value: unknown): Record<string, unknown> {
  const row = { ...((value ?? {}) as Row) }
  delete row.loanDeductions
  delete row.loan_deductions
  return row
}

function withoutPayrollLoanBreakdown(value: unknown): Record<string, unknown> {
  const breakdown = withoutLoanDeductions(value)
  if (breakdown.deductions && typeof breakdown.deductions === 'object') {
    breakdown.deductions = withoutLoanDeductions(breakdown.deductions)
  }
  return breakdown
}

export function mapPayrollValidationReport(row: Row): PayrollValidationReport {
  const attendance = (row.attendance ?? {}) as Row
  const payroll = (row.payroll ?? {}) as Row
  const leaveAdjustments = (row.leaveAdjustments ?? row.leave_adjustments ?? {}) as Row
  const statutory = (row.statutory ?? {}) as Row

  return {
    periodId: str(row.periodId ?? row.period_id),
    status: str(row.status, 'draft') as PayrollValidationReport['status'],
    isValid: Boolean(row.isValid ?? row.is_valid),
    criticalIssueCount: num(row.criticalIssueCount ?? row.critical_issue_count),
    warningCount: num(row.warningCount ?? row.warning_count),
    message: str(row.message),
    issues: Array.isArray(row.issues) ? row.issues.map((issue) => mapValidationIssue(issue as Row)) : [],
    attendance: {
      totalEmployees: num(attendance.totalEmployees ?? attendance.total_employees),
      expectedWorkdays: num(attendance.expectedWorkdays ?? attendance.expected_workdays),
      expectedEmployeeDays: num(attendance.expectedEmployeeDays ?? attendance.expected_employee_days),
      completeEmployees: num(attendance.completeEmployees ?? attendance.complete_employees),
      employeesWithMissingAttendance: num(attendance.employeesWithMissingAttendance ?? attendance.employees_with_missing_attendance),
      missingEmployeeDays: num(attendance.missingEmployeeDays ?? attendance.missing_employee_days),
      pendingCorrections: num(attendance.pendingCorrections ?? attendance.pending_corrections),
      missingAttendance: Array.isArray(attendance.missingAttendance ?? attendance.missing_attendance)
        ? ((attendance.missingAttendance ?? attendance.missing_attendance) as Row[]).map(mapValidationEmployeeIssue)
        : [],
    },
    payroll: {
      employeesWithPayrollRecords: num(payroll.employeesWithPayrollRecords ?? payroll.employees_with_payroll_records),
      employeesWithoutPayrollRecords: num(payroll.employeesWithoutPayrollRecords ?? payroll.employees_without_payroll_records),
      employeesWithMissingSalarySetup: num(payroll.employeesWithMissingSalarySetup ?? payroll.employees_with_missing_salary_setup),
      employeesWithNegativeNetPay: num(payroll.employeesWithNegativeNetPay ?? payroll.employees_with_negative_net_pay),
      employeesWithIncompleteBreakdown: num(payroll.employeesWithIncompleteBreakdown ?? payroll.employees_with_incomplete_breakdown),
      employeesWithInconsistentTotals: num(payroll.employeesWithInconsistentTotals ?? payroll.employees_with_inconsistent_totals),
      employeesWithInvalidTaxableIncome: num(payroll.employeesWithInvalidTaxableIncome ?? payroll.employees_with_invalid_taxable_income),
      missingPayrollRecords: Array.isArray(payroll.missingPayrollRecords ?? payroll.missing_payroll_records)
        ? ((payroll.missingPayrollRecords ?? payroll.missing_payroll_records) as Row[]).map(mapValidationEmployeeIssue)
        : [],
      missingSalarySetup: Array.isArray(payroll.missingSalarySetup ?? payroll.missing_salary_setup)
        ? ((payroll.missingSalarySetup ?? payroll.missing_salary_setup) as Row[]).map(mapValidationEmployeeIssue)
        : [],
      negativeNetPay: Array.isArray(payroll.negativeNetPay ?? payroll.negative_net_pay)
        ? ((payroll.negativeNetPay ?? payroll.negative_net_pay) as Row[]).map(mapValidationEmployeeIssue)
        : [],
      incompleteBreakdown: Array.isArray(payroll.incompleteBreakdown ?? payroll.incomplete_breakdown)
        ? ((payroll.incompleteBreakdown ?? payroll.incomplete_breakdown) as Row[]).map(mapValidationEmployeeIssue)
        : [],
      inconsistentTotals: Array.isArray(payroll.inconsistentTotals ?? payroll.inconsistent_totals)
        ? ((payroll.inconsistentTotals ?? payroll.inconsistent_totals) as Row[]).map(mapValidationEmployeeIssue)
        : [],
      invalidTaxableIncome: Array.isArray(payroll.invalidTaxableIncome ?? payroll.invalid_taxable_income)
        ? ((payroll.invalidTaxableIncome ?? payroll.invalid_taxable_income) as Row[]).map(mapValidationEmployeeIssue)
        : [],
    },
    leaveAdjustments: {
      pendingLeaveRequests: num(leaveAdjustments.pendingLeaveRequests ?? leaveAdjustments.pending_leave_requests),
      unappliedLeaveAdjustments: num(leaveAdjustments.unappliedLeaveAdjustments ?? leaveAdjustments.unapplied_leave_adjustments),
      unpaidLeaveRecords: num(leaveAdjustments.unpaidLeaveRecords ?? leaveAdjustments.unpaid_leave_records),
    },
    statutory: {
      isComplete: Boolean(statutory.isComplete ?? statutory.is_complete),
      versions: (statutory.versions ?? {}) as Record<string, unknown>,
      missingRules: Array.isArray(statutory.missingRules ?? statutory.missing_rules)
        ? ((statutory.missingRules ?? statutory.missing_rules) as Row[]).map((item) => ({
            agency: str(item.agency),
            ruleName: str(item.ruleName ?? item.rule_name),
          }))
        : [],
    },
  }
}

export function mapPayrollAuditEntry(row: Row): PayrollAuditEntry {
  return {
    id: str(row.id),
    action: str(row.action),
    entity: str(row.entity),
    entityId: str(row.entity_id ?? row.entityId),
    actorEmail: row.actor_email ? str(row.actor_email) : undefined,
    oldValues: row.old_values ?? row.oldValues,
    newValues: row.new_values ?? row.newValues,
    reason: row.reason ? str(row.reason) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
  }
}

export function mapPayrollCalculationSnapshot(row: Row): PayrollCalculationSnapshot {
  return {
    id: str(row.id),
    payrollRecordId: str(row.payroll_record_id ?? row.payrollRecordId),
    payrollPeriodId: str(row.payroll_period_id ?? row.payrollPeriodId),
    employeeId: str(row.employee_id ?? row.employeeId),
    snapshotVersion: num(row.snapshot_version ?? row.snapshotVersion),
    formulaVersion: str(row.formula_version ?? row.formulaVersion),
    payrollFrequency: row.payroll_frequency ? str(row.payroll_frequency) as PayrollCalculationSnapshot['payrollFrequency'] : undefined,
    payrollPeriodStart: str(row.payroll_period_start ?? row.payrollPeriodStart),
    payrollPeriodEnd: str(row.payroll_period_end ?? row.payrollPeriodEnd),
    attendanceSummary: (row.attendance_summary_json ?? row.attendanceSummary ?? {}) as Record<string, unknown>,
    earningsBreakdown: (row.earnings_breakdown_json ?? row.earningsBreakdown ?? {}) as Record<string, unknown>,
    deductionsBreakdown: withoutLoanDeductions(row.deductions_breakdown_json ?? row.deductionsBreakdown),
    employerContributions: (row.employer_contributions_json ?? row.employerContributions ?? {}) as Record<string, unknown>,
    taxableIncome: num(row.taxable_income ?? row.taxableIncome),
    nonTaxableEarnings: num(row.non_taxable_earnings ?? row.nonTaxableEarnings),
    grossPay: num(row.gross_pay ?? row.grossPay),
    totalDeductions: num(row.total_deductions ?? row.totalDeductions),
    netPay: num(row.net_pay ?? row.netPay),
    computedBy: row.computed_by ? str(row.computed_by) : undefined,
    computedAt: str(row.computed_at ?? row.computedAt),
    snapshotHash: str(row.snapshot_hash ?? row.snapshotHash),
    createdAt: str(row.created_at ?? row.createdAt),
  }
}

export function mapPayrollRecord(row: Row): PayrollRecord {
  return {
    id: str(row.id),
    payrollPeriodId: str(row.payroll_period_id ?? row.payrollPeriodId),
    payrollPeriod: row.period_name || row.pay_date
      ? {
          id: str(row.payroll_period_id ?? row.payrollPeriodId),
          name: str(row.period_name),
          frequency: str(row.pay_frequency ?? row.frequency, 'semi-monthly') as PayrollPeriod['frequency'],
          startDate: str(row.start_date),
          endDate: str(row.end_date),
          payDate: str(row.pay_date),
          status: (str(row.period_status ?? row.payroll_period_status ?? row.status) || 'draft') as PayrollPeriod['status'],
          createdAt: '',
          updatedAt: '',
        }
      : undefined,
    employeeId: str(row.employee_id ?? row.employeeId),
    employee: row.first_name ? mapEmployee(row) : undefined,
    basicPay: num(row.regular_pay ?? row.basic_pay ?? row.basic_salary),
    overtimePay: num(row.overtime_pay),
    holidayPay: num(row.holiday_pay),
    nightDifferential: num(row.night_diff_pay ?? row.night_differential),
    thirteenthMonthPay: num(row.thirteenth_month_pay),
    allowances: num(row.allowances),
    otherEarnings: num(row.other_earnings),
    taxableEarnings: num(row.taxable_earnings),
    nonTaxableEarnings: num(row.non_taxable_earnings),
    paidLeaveAmount: num(row.paid_leave_amount),
    grossPay: num(row.gross_pay),
    excessMinutes: num(row.excess_minutes),
    offsetEarnedMinutes: num(row.offset_earned_minutes),
    offsetUsedMinutes: num(row.offset_used_minutes),
    undertimeMinutes: num(row.undertime_minutes),
    offsetBalanceMinutes: num(row.offset_balance_minutes),
    contributions: {
      sss: num(row.sss_employee),
      philhealth: num(row.phil_health_employee ?? row.philhealth_employee),
      pagibig: num(row.pag_ibig_employee ?? row.pagibig_employee),
      totalEmployee:
        num(row.sss_employee) +
        num(row.phil_health_employee ?? row.philhealth_employee) +
        num(row.pag_ibig_employee ?? row.pagibig_employee),
      sssEmployer: num(row.sss_employer),
      philhealthEmployer: num(row.phil_health_employer ?? row.philhealth_employer),
      pagibigEmployer: num(row.pag_ibig_employer ?? row.pagibig_employer),
      totalEmployer:
        num(row.sss_employer) +
        num(row.phil_health_employer ?? row.philhealth_employer) +
        num(row.pag_ibig_employer ?? row.pagibig_employer),
    },
    withholdingTax: num(row.withholding_tax),
    absenceDeduction: num(row.absence_deduction),
    lateDeduction: num(row.late_deduction),
    undertimeDeduction: num(row.undertime_deduction),
    leaveDeduction: num(row.leave_deduction),
    taxableIncome: num(row.taxable_income),
    preTaxDeductions: num(row.pre_tax_deductions),
    statutoryDeductions: num(row.statutory_deductions),
    postTaxDeductions: num(row.post_tax_deductions),
    loanDeductions: 0,
    otherDeductions: num(row.other_deductions),
    totalDeductions: num(row.total_deductions),
    netPay: num(row.net_pay),
    employerContributions: num(row.employer_contributions),
    statutoryRuleVersion: row.statutory_rule_version ? str(row.statutory_rule_version) : undefined,
    statutoryRuleVersions: (row.statutory_rule_versions ?? row.statutoryRuleVersions) as Record<string, unknown> | undefined,
    computationBreakdown: withoutPayrollLoanBreakdown(row.computation_breakdown ?? row.computationBreakdown),
    daysWorked: num(row.days_worked),
    hoursWorked: num(row.hours_worked),
    overtimeHours: num(row.overtime_hours),
    absentDays: num(row.absent_days),
    lateDays: num(row.late_days),
    status: str(row.status, 'draft') as PayrollRecord['status'],
    remarks: row.remarks ? str(row.remarks) : undefined,
    processedBy: row.processed_by ? str(row.processed_by) : undefined,
    processedAt: row.processed_at ? str(row.processed_at) : undefined,
    currentSnapshotId: row.current_snapshot_id ? str(row.current_snapshot_id) : undefined,
    isLocked: Boolean(row.is_locked ?? row.isLocked),
    lockedAt: row.locked_at ? str(row.locked_at) : undefined,
    lockedBy: row.locked_by ? str(row.locked_by) : undefined,
    voidedBy: row.voided_by ? str(row.voided_by) : undefined,
    voidedAt: row.voided_at ? str(row.voided_at) : undefined,
    voidReason: row.void_reason ? str(row.void_reason) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}
