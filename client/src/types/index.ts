// ─── Auth & Users ────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'employee'

export interface User {
  id: string
  email: string
  role: UserRole
  employeeId?: string
  firstName: string
  lastName: string
  avatarUrl?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface AuthResponse {
  user: User
  tokens: AuthTokens
}

export interface ActivationTokenInfo {
  email: string
  firstName?: string
  lastName?: string
  expiresAt: string
}

// ─── Department & Position ────────────────────────────────────────────────────

export interface Department {
  id: string
  name: string
  code: string
  headId?: string
  description?: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface Position {
  id: string
  title: string
  departmentId: string
  department?: Department
  basicSalary: number
  salaryType: 'monthly' | 'daily' | 'hourly'
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ─── Employee ─────────────────────────────────────────────────────────────────

export type EmploymentStatus = 'active' | 'inactive' | 'resigned' | 'terminated' | 'on_leave'
export type CivilStatus = 'single' | 'married' | 'widowed' | 'separated'
export type EmploymentType = 'regular' | 'probationary' | 'contractual' | 'part_time'

export interface Employee {
  id: string
  employeeNumber: string
  firstName: string
  middleName?: string
  lastName: string
  email: string
  phone?: string
  birthDate: string
  gender: 'male' | 'female' | 'other'
  civilStatus: CivilStatus
  address: string
  city: string
  province: string
  zipCode: string

  // Employment details
  departmentId: string
  department?: Department
  positionId: string
  position?: Position
  employmentType: EmploymentType
  employmentStatus: EmploymentStatus
  hireDate: string
  regularizationDate?: string
  resignationDate?: string

  // Government IDs
  sssNumber?: string
  philhealthNumber?: string
  pagibigNumber?: string
  tinNumber?: string

  // Compensation
  basicSalary: number
  dailyRate: number
  hourlyRate: number

  // Banking
  bankName?: string
  bankAccountNumber?: string

  avatarUrl?: string
  shiftId?: string
  shift?: Shift

  userId?: string
  createdAt: string
  updatedAt: string
}

// ─── Shift ────────────────────────────────────────────────────────────────────

export interface Shift {
  id: string
  name: string
  startTime: string   // "08:00"
  endTime: string     // "17:00"
  breakMinutes: number
  workingHoursPerDay: number
  isNightShift: boolean
  createdAt: string
  updatedAt: string
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'on_leave' | 'holiday'

export interface AttendanceRecord {
  id: string
  employeeId: string
  employee?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'employeeNumber'>
  date: string
  timeIn?: string
  timeOut?: string
  scheduledShiftId?: string
  scheduledShiftName?: string
  scheduledStart?: string
  scheduledEnd?: string
  requiredWorkMinutes: number
  actualRenderedMinutes: number
  hoursWorked: number
  overtimeHours: number
  excessMinutes: number
  offsetEarnedMinutes: number
  offsetUsedMinutes: number
  lateMinutes: number
  undertimeMinutes: number
  status: AttendanceStatus
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface AttendanceRequest {
  id: string
  employeeId: string
  employee?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'employeeNumber'>
  date: string
  type: 'correction' | 'offset_usage' | 'undertime_excuse'
  requestedTimeIn?: string
  requestedTimeOut?: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}

export type OffsetCreditStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
export type OffsetUsageStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface OffsetBalance {
  employeeId: string
  employee?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'employeeNumber'>
  pendingMinutes: number
  availableMinutes: number
  usedMinutes: number
  pendingUsageMinutes: number
}

export interface OffsetCredit {
  id: string
  employeeId: string
  employee?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'employeeNumber'>
  attendanceId?: string
  dateEarned: string
  source: 'excess_hours' | 'attendance_correction' | 'manual_adjustment'
  minutesEarned: number
  minutesRemaining: number
  status: OffsetCreditStatus
  reason?: string
  reviewRemarks?: string
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}

export interface OffsetUsage {
  id: string
  employeeId: string
  employee?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'employeeNumber'>
  attendanceId?: string
  usageDate: string
  requestedMinutes: number
  approvedMinutes: number
  status: OffsetUsageStatus
  source: 'employee_request' | 'admin_entry' | 'manual_adjustment'
  reason: string
  reviewRemarks?: string
  reviewedBy?: string
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}

// ─── Leave ────────────────────────────────────────────────────────────────────

export type LeaveType = 'vacation' | 'sick' | 'emergency' | 'bereavement' | 'non_paid' | 'maternity' | 'paternity' | 'solo_parent' | 'others'
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface LeaveTypeConfig {
  id: string
  code: string
  name: string
  description?: string
  isPaid: boolean
  isAccrualBased: boolean
  requiresBalance: boolean
  appliesToProbationary: boolean
  appliesToRegular: boolean
  maxDaysPerRequest?: number
  filingDeadlineDays?: number
  filingDeadlineType?: string
  requiresDocument: boolean
  documentRule?: string
  isCashConvertible: boolean
  isCarryOverAllowed: boolean
  isStatutory: boolean
  dayCountType: 'working_days' | 'calendar_days'
  policyNotes?: string
}

export interface LeaveBalance {
  id: string
  employeeId: string
  leaveTypeId?: string
  code?: string
  leaveType: LeaveType
  allocated: number
  openingBalance?: number
  earnedCredits?: number
  pendingCredits?: number
  carriedOverCredits?: number
  forfeitedCredits?: number
  convertedToCashCredits?: number
  used: number
  remaining: number
  year: number
  entitlementStage?: string
}

export interface LeaveApplication {
  id: string
  employeeId: string
  employee?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'employeeNumber'>
  leaveType: LeaveType
  startDate: string
  endDate: string
  totalDays: number
  dayCountType?: 'working_days' | 'calendar_days'
  reason: string
  emergencyReasonCategory?: string
  unpaidDays?: number
  deductedSickDays?: number
  deductedVacationDays?: number
  payrollImpactStatus?: string
  attendanceImpactStatus?: string
  validationWarnings?: string[]
  documents?: Array<{
    id: string
    documentType: string
    fileName: string
    fileUrl: string
    status: string
  }>
  status: LeaveStatus
  approvedBy?: string
  approvedAt?: string
  rejectionReason?: string
  createdAt: string
  updatedAt: string
}

// ─── Holiday ──────────────────────────────────────────────────────────────────

export type HolidayType = 'regular' | 'special_non_working' | 'special_working'

export interface Holiday {
  id: string
  name: string
  date: string
  type: HolidayType
  isRecurring: boolean
  createdAt: string
  updatedAt: string
}

// ─── Payroll ──────────────────────────────────────────────────────────────────

export type PayFrequency = 'weekly' | 'semi-monthly' | 'monthly'
export type PayrollStatus = 'draft' | 'processing' | 'approved' | 'released' | 'cancelled'

export interface PayrollWarning {
  code: string
  severity: 'info' | 'warning' | 'danger'
  message: string
  count?: number
}

export interface PayrollIssueSummary {
  criticalIssueCount: number
  warningIssueCount: number
  totalIssueCount: number
}

export interface PayrollAuditEntry {
  id: string
  action: string
  entity: string
  entityId: string
  actorEmail?: string
  oldValues?: unknown
  newValues?: unknown
  createdAt: string
}

export interface PayrollPeriod {
  id: string
  name: string
  frequency: PayFrequency
  startDate: string
  endDate: string
  payDate: string
  status: PayrollStatus
  createdAt: string
  updatedAt: string
  approvedBy?: string
  approvedAt?: string
  activeEmployeeCount?: number
  recordCount?: number
  processingRecordCount?: number
  approvedRecordCount?: number
  releasedRecordCount?: number
  totalGrossPay?: number
  totalDeductions?: number
  totalNetPay?: number
  negativeNetCount?: number
  pendingAttendanceRequestCount?: number
  pendingLeaveRequestCount?: number
  warningCount?: number
  issueSummary?: PayrollIssueSummary | null
  warnings?: PayrollWarning[]
  auditHistory?: PayrollAuditEntry[]
}

export interface GovernmentContributions {
  sss: number
  philhealth: number
  pagibig: number
  totalEmployee: number
  sssEmployer: number
  philhealthEmployer: number
  pagibigEmployer: number
  totalEmployer: number
}

export interface TaxWithholding {
  taxableIncome: number
  withholdingTax: number
  bracket: string
}

export interface PayrollRecord {
  id: string
  payrollPeriodId: string
  payrollPeriod?: PayrollPeriod
  employeeId: string
  employee?: Employee

  // Earnings
  basicPay: number
  overtimePay: number
  holidayPay: number
  nightDifferential: number
  thirteenthMonthPay: number
  allowances: number
  otherEarnings: number
  grossPay: number
  excessMinutes: number
  offsetEarnedMinutes: number
  offsetUsedMinutes: number
  undertimeMinutes: number
  offsetBalanceMinutes: number

  // Deductions
  contributions: GovernmentContributions
  withholdingTax: number
  absenceDeduction: number
  lateDeduction: number
  loanDeductions: number
  otherDeductions: number
  totalDeductions: number

  // Net
  netPay: number

  // Meta
  daysWorked: number
  hoursWorked: number
  overtimeHours: number
  absentDays: number
  lateDays: number

  status: PayrollStatus
  remarks?: string
  processedBy?: string
  processedAt?: string
  createdAt: string
  updatedAt: string
}

// ─── Loan ─────────────────────────────────────────────────────────────────────

export type LoanType = 'sss_loan' | 'pagibig_loan' | 'company_loan' | 'cash_advance'
export type LoanStatus = 'active' | 'fully_paid' | 'cancelled'

export interface Loan {
  id: string
  employeeId: string
  employee?: Pick<Employee, 'id' | 'firstName' | 'lastName' | 'employeeNumber'>
  loanType: LoanType
  principalAmount: number
  interestRate: number
  totalAmount: number
  monthlyAmortization: number
  balance: number
  startDate: string
  endDate: string
  status: LoanStatus
  createdAt: string
  updatedAt: string
}

// ─── Announcement ─────────────────────────────────────────────────────────────

export interface Announcement {
  id: string
  title: string
  content: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  targetAudience: 'all' | 'admin' | 'employee' | 'department'
  targetDepartmentId?: string
  publishedAt?: string
  expiresAt?: string
  isPublished: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

// ─── Role & Permissions ───────────────────────────────────────────────────────

export interface Permission {
  id: string
  module: string
  action: 'read' | 'create' | 'update' | 'delete'
  description: string
}

export interface Role {
  id: string
  name: string
  description: string
  permissions: Permission[]
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

// ─── System Settings ──────────────────────────────────────────────────────────

export interface CompanySettings {
  companyName: string
  companyLogo?: string
  address: string
  city: string
  province: string
  zipCode: string
  phone: string
  email: string
  tin: string
  sssEmployerNumber: string
  philhealthEmployerNumber: string
  pagibigEmployerNumber: string
}

export interface PayrollSettings {
  payFrequency: PayFrequency
  semiMonthlyCutoff1: number
  semiMonthlyCutoff2: number
  semiMonthlyPayDay1: number
  semiMonthlyPayDay2: number
  workingHoursPerDay: number
  workingDaysPerWeek: number
  offsetCreditEnabled: boolean
  offsetRequiresApproval: boolean
  nightDifferentialEnabled: boolean
  regularHolidayRate: number
  specialHolidayRate: number
  thirteenthMonthEnabled: boolean
}

export interface LeaveSettings {
  vacationLeaveCredits: number
  sickLeaveCredits: number
  emergencyLeaveCredits: number
  leaveAccrualEnabled: boolean
  unusedLeaveConvertible: boolean
  unusedLeaveConversionRate: number
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export interface DashboardStats {
  totalEmployees: number
  activeEmployees: number
  onLeaveToday: number
  presentToday: number
  absentToday: number
  pendingLeaveRequests: number
  pendingAttendanceRequests: number
  upcomingPayDate?: string
  lastPayrollTotal?: number
  currentPeriod?: PayrollPeriod
}

export interface AdminDashboardData {
  today: string
  generatedAt: string
  workforce: {
    totalEmployees: number
    activeEmployees: number
    inactiveEmployees: number
  }
  attendanceToday: {
    date: string
    activeEmployees: number
    recordedEmployees: number
    presentToday: number
    lateToday: number
    absentToday: number
    onLeaveToday: number
    missingAttendance: number
    incompletePunches: number
    completionRate: number
  }
  attendanceReadiness: {
    periodStart: string
    periodEnd: string
    evaluatedThrough: string
    expectedEmployeeDays: number
    completedEmployeeDays: number
    missingEmployeeDays: number
    completionRate: number
    isPayrollReady: boolean
  }
  approvals: {
    pendingLeaveRequests: number
    pendingAttendanceRequests: number
    payrollPeriodsForApproval: number
    totalPending: number
  }
  payroll: {
    currentPeriod: (PayrollPeriod & {
      recordCount: number
      processedRecordCount: number
      totalGrossPay: number
      totalNetPay: number
    }) | null
    nextPayDate: string | null
    nextPayDatePeriodId: string | null
    nextPayDatePeriodName: string | null
    daysUntilPayDate: number | null
  }
  attentionItems: Array<{
    id: string
    title: string
    description: string
    count: number
    severity: 'info' | 'warning' | 'danger'
    actionLabel: string
    actionPath: string
  }>
  employeesNeedingAttention: Array<{
    id: string
    employeeNumber: string
    name: string
    department?: string
    position?: string
    type: 'missing_time_in' | 'incomplete_punch' | 'absent' | 'late' | 'attention'
    severity: 'info' | 'warning' | 'danger'
    description: string
  }>
  approvalQueue: Array<{
    id: string
    type: 'leave' | 'attendance' | 'payroll'
    title: string
    employeeName: string | null
    employeeNumber: string | null
    detail: string
    requestedAt: string
    actionPath: string
  }>
  announcements: Array<{
    id: string
    title: string
    message: string
    startDate: string | null
    endDate: string | null
    isPinned: boolean
    createdAt: string
  }>
}

export interface EmployeeDashboardData {
  employee: {
    id: string
    employeeNumber: string
    name: string
    firstName: string
    lastName: string
    email: string
    department?: string
    position?: string
  }
  attendanceToday: {
    id: string | null
    status: 'Not Timed In' | 'Timed In' | 'Timed Out'
    attendanceStatus: AttendanceStatus | null
    date: string
    timeIn: string | null
    timeOut: string | null
    totalHours: number
    scheduledStart: string
    scheduledEnd: string
    scheduledHours: number
    lateMinutes: number
    offsetEarnedMinutes: number
    offsetUsedMinutes: number
    excessMinutes: number
    overtimeHours: number
  }
  monthlyAttendance: {
    presentDays: number
    lateDays: number
    absentDays: number
    halfDays: number
    leaveDays: number
    totalHours: number
    expectedHours: number
    shortageHours: number
    offsetEarnedHours: number
    offsetUsedHours: number
    undertimeHours: number
    overtimeHours: number
    lateMinutes: number
  }
  leaveBalance: {
    vacationLeave: number
    sickLeave: number
    emergencyLeave: number
    totalAllowance: number
    totalTaken: number
    totalAvailable: number
    pendingRequests: number
    items: Array<{
      id: string
      name: string
      code: string
      isPaid: boolean
      allowance: number
      taken: number
      pending: number
      balance: number
    }>
  }
  announcements: Array<{
    id: string
    title: string
    message: string
    startDate: string | null
    endDate: string | null
    isPinned: boolean
    createdAt: string
  }>
  generatedAt: string
}

// ─── API Response wrappers ────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean
  data: T
  message?: string
  activationLink?: string
  activationEmailSent?: boolean
}

export interface PaginatedResponse<T> {
  success: boolean
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ApiError {
  success: false
  message: string
  errors?: Record<string, string[]>
}

// ─── Form types ───────────────────────────────────────────────────────────────

export interface EmployeeFormData {
  firstName: string
  middleName?: string
  lastName: string
  email: string
  phone?: string
  birthDate: string
  gender: 'male' | 'female' | 'other'
  civilStatus: CivilStatus
  address: string
  city: string
  province: string
  zipCode: string
  departmentId: string
  positionId: string
  employmentType: EmploymentType
  hireDate: string
  basicSalary: number
  sssNumber?: string
  philhealthNumber?: string
  pagibigNumber?: string
  tinNumber?: string
  bankName?: string
  bankAccountNumber?: string
  shiftId?: string
}

export interface LeaveApplicationFormData {
  employeeId?: string
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
