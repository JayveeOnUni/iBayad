import type {
  AttendanceRecord,
  AttendanceRequest,
  Employee,
  LeaveApplication,
  PayrollAuditEntry,
  OffsetBalance,
  OffsetCredit,
  OffsetUsage,
  PayrollIssueSummary,
  PayrollPeriod,
  PayrollRecord,
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

function mapPayrollIssueSummary(
  value: unknown,
  fallback?: Partial<PayrollIssueSummary>
): PayrollIssueSummary {
  const row = value && typeof value === 'object' ? value as Row : {}
  const criticalIssueCount = num(
    row.critical_issue_count ?? row.criticalIssueCount,
    fallback?.criticalIssueCount ?? 0
  )
  const warningIssueCount = num(
    row.warning_issue_count ?? row.warningIssueCount,
    fallback?.warningIssueCount ?? 0
  )
  const totalIssueCount = num(
    row.total_issue_count ?? row.totalIssueCount,
    fallback?.totalIssueCount ?? criticalIssueCount + warningIssueCount
  )

  return {
    criticalIssueCount,
    warningIssueCount,
    totalIssueCount,
  }
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
    sssNumber: row.sss_number ? str(row.sss_number) : undefined,
    philhealthNumber: row.philhealth_number ? str(row.philhealth_number) : undefined,
    pagibigNumber: row.pagibig_number ? str(row.pagibig_number) : undefined,
    tinNumber: row.tin_number ? str(row.tin_number) : undefined,
    basicSalary: num(row.basic_salary ?? row.basicSalary),
    dailyRate: num(row.daily_rate ?? row.dailyRate),
    hourlyRate: num(row.hourly_rate ?? row.hourlyRate),
    bankName: row.bank_name ? str(row.bank_name) : undefined,
    bankAccountNumber: row.bank_account_number ? str(row.bank_account_number) : undefined,
    avatarUrl: row.avatar_url ? str(row.avatar_url) : undefined,
    shiftId: row.shift_id ? str(row.shift_id) : undefined,
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
  const warningCount = num(row.warning_count ?? row.warningCount)
  const issueSummarySource =
    row.issue_summary
    ?? row.issueSummary
    ?? row.validation_summary
    ?? row.validationSummary
    ?? row.readiness_summary
    ?? row.readinessSummary

  return {
    id: str(row.id),
    name: str(row.name),
    frequency: str(row.pay_frequency ?? row.frequency, 'semi-monthly') as PayrollPeriod['frequency'],
    startDate: str(row.start_date ?? row.startDate),
    endDate: str(row.end_date ?? row.endDate),
    payDate: str(row.pay_date ?? row.payDate),
    status: str(row.status, 'draft') as PayrollPeriod['status'],
    approvedBy: row.approved_by ? str(row.approved_by) : undefined,
    approvedAt: row.approved_at ? str(row.approved_at) : undefined,
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
    warningCount,
    issueSummary: mapPayrollIssueSummary(issueSummarySource, {
      warningIssueCount: warningCount,
      totalIssueCount: warningCount,
    }),
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

export function mapPayrollAuditEntry(row: Row): PayrollAuditEntry {
  return {
    id: str(row.id),
    action: str(row.action),
    entity: str(row.entity),
    entityId: str(row.entity_id ?? row.entityId),
    actorEmail: row.actor_email ? str(row.actor_email) : undefined,
    oldValues: row.old_values ?? row.oldValues,
    newValues: row.new_values ?? row.newValues,
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
    loanDeductions: num(row.loan_deductions),
    otherDeductions: num(row.other_deductions),
    totalDeductions: num(row.total_deductions),
    netPay: num(row.net_pay),
    daysWorked: num(row.days_worked),
    hoursWorked: num(row.hours_worked),
    overtimeHours: num(row.overtime_hours),
    absentDays: num(row.absent_days),
    lateDays: num(row.late_days),
    status: str(row.status, 'draft') as PayrollRecord['status'],
    remarks: row.remarks ? str(row.remarks) : undefined,
    processedBy: row.processed_by ? str(row.processed_by) : undefined,
    processedAt: row.processed_at ? str(row.processed_at) : undefined,
    createdAt: str(row.created_at ?? row.createdAt),
    updatedAt: str(row.updated_at ?? row.updatedAt),
  }
}
