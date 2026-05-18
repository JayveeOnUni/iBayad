import { api } from './api'
import type { LeaveBalance, LeaveApplicationFormData, ApiResponse, LeaveTypeConfig } from '../types'
import { mapLeave } from './mappers'

function mapLeaveBalance(row: Record<string, unknown>): LeaveBalance {
  const name = String(row.name ?? row.leave_type ?? row.leaveType ?? 'others')
  const code = String(row.code ?? '').toUpperCase()

  return {
    id: String(row.id ?? row.leave_type_id ?? ''),
    employeeId: String(row.employee_id ?? row.employeeId ?? ''),
    leaveTypeId: String(row.leave_type_id ?? row.leaveTypeId ?? row.id ?? ''),
    code,
    leaveType: name.toLowerCase().replace(' leave', '').replace(/\s+/g, '_') as LeaveBalance['leaveType'],
    allocated: Number(row.earned_credits ?? row.allowance ?? row.allocated ?? 0),
    openingBalance: Number(row.opening_balance ?? 0),
    earnedCredits: Number(row.earned_credits ?? 0),
    pendingCredits: Number(row.pending_credits ?? 0),
    carriedOverCredits: Number(row.carried_over_credits ?? 0),
    forfeitedCredits: Number(row.forfeited_credits ?? 0),
    convertedToCashCredits: Number(row.converted_to_cash_credits ?? 0),
    used: Number(row.used_credits ?? row.taken ?? row.used ?? 0),
    remaining: Number(row.available_balance ?? row.balance ?? row.remaining ?? 0),
    year: Number(row.year ?? new Date().getFullYear()),
    entitlementStage: String(row.entitlement_stage ?? ''),
  }
}

function mapLeaveType(row: Record<string, unknown>): LeaveTypeConfig {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    description: row.description ? String(row.description) : undefined,
    isPaid: Boolean(row.is_paid ?? row.isPaid),
    isAccrualBased: Boolean(row.is_accrual_based ?? row.isAccrualBased),
    requiresBalance: Boolean(row.requires_balance ?? row.requiresBalance),
    appliesToProbationary: Boolean(row.applies_to_probationary ?? row.appliesToProbationary),
    appliesToRegular: Boolean(row.applies_to_regular ?? row.appliesToRegular),
    maxDaysPerRequest: row.max_days_per_request == null ? undefined : Number(row.max_days_per_request),
    filingDeadlineDays: row.filing_deadline_days == null ? undefined : Number(row.filing_deadline_days),
    filingDeadlineType: row.filing_deadline_type ? String(row.filing_deadline_type) : undefined,
    requiresDocument: Boolean(row.requires_document ?? row.requiresDocument),
    documentRule: row.document_rule ? String(row.document_rule) : undefined,
    isCashConvertible: Boolean(row.is_cash_convertible ?? row.isCashConvertible),
    isCarryOverAllowed: Boolean(row.is_carry_over_allowed ?? row.isCarryOverAllowed),
    isStatutory: Boolean(row.is_statutory ?? row.isStatutory),
    dayCountType: (row.day_count_type ?? 'working_days') as LeaveTypeConfig['dayCountType'],
    policyNotes: row.policy_notes ? String(row.policy_notes) : undefined,
  }
}

export interface LeaveListParams {
  page?: number
  limit?: number
  employeeId?: string
  leaveType?: string
  status?: string
  year?: number
}

export interface LeaveRequestPayload {
  employeeId?: string
  leaveTypeId: string
  startDate: string
  endDate: string
  reason: string
  isHalfDay?: boolean
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

export interface LeaveDocumentUploadPayload {
  documentType: string
  fileName: string
  fileUrl: string
  mimeType?: string
}

export const leaveService = {
  // Applications
  list: (params?: LeaveListParams) =>
    api.get<ApiResponse<Record<string, unknown>[]>>('/leave/requests', params as Record<string, string | number | boolean>)
      .then((res) => ({
        success: res.success,
        data: res.data.map(mapLeave),
        total: res.data.length,
        page: params?.page ?? 1,
        limit: params?.limit ?? res.data.length,
        totalPages: 1,
      })),

  getById: (id: string) =>
    api.get<ApiResponse<Record<string, unknown>>>(`/leave/requests/${id}`)
      .then((res) => ({ ...res, data: mapLeave(res.data) })),

  apply: (data: LeaveApplicationFormData | LeaveRequestPayload) =>
    api.post<ApiResponse<Record<string, unknown>>>('/leave/requests', data)
      .then((res) => ({ ...res, data: mapLeave(res.data) })),

  preview: (data: LeaveApplicationFormData | LeaveRequestPayload) =>
    api.post<ApiResponse<Record<string, unknown>>>('/leave/requests/preview', data),

  cancel: (id: string) =>
    api.put<ApiResponse<Record<string, unknown>>>(`/leave/requests/${id}/cancel`)
      .then((res) => ({ ...res, data: mapLeave(res.data) })),

  uploadDocument: (id: string, data: LeaveDocumentUploadPayload) =>
    api.post<ApiResponse<Record<string, unknown>>>(`/leave/requests/${id}/documents`, data),

  approve: (id: string, remarks?: string) =>
    api.put<ApiResponse<Record<string, unknown>>>(`/leave/requests/${id}/review`, { action: 'approve', remarks })
      .then((res) => ({ ...res, data: mapLeave(res.data) })),

  reject: (id: string, reason: string) =>
    api.put<ApiResponse<Record<string, unknown>>>(`/leave/requests/${id}/review`, { action: 'reject', remarks: reason })
      .then((res) => ({ ...res, data: mapLeave(res.data) })),

  // Balances
  getBalances: (employeeId: string, year?: number) =>
    api.get<ApiResponse<Record<string, unknown>[]>>(`/leave/balance/${employeeId}`, year ? { year } : {})
      .then((res) => ({ ...res, data: res.data.map(mapLeaveBalance) })),

  getMyBalances: (year?: number) =>
    api.get<ApiResponse<Record<string, unknown>[]>>('/leave/balance', year ? { year } : {})
      .then((res) => ({ ...res, data: res.data.map(mapLeaveBalance) })),

  getMyApplications: (params?: LeaveListParams) =>
    api.get<ApiResponse<Record<string, unknown>[]>>('/leave/my-requests', params as Record<string, string | number | boolean>)
      .then((res) => ({
        success: res.success,
        data: res.data.map(mapLeave),
        total: res.data.length,
        page: params?.page ?? 1,
        limit: params?.limit ?? res.data.length,
        totalPages: 1,
      })),

  // Calendar
  getCalendar: (month: number, year: number) =>
    api.get<ApiResponse<Record<string, unknown>[]>>('/leave/calendar', { month, year })
      .then((res) => ({ ...res, data: res.data.map(mapLeave) })),

  getTypes: () =>
    api.get<ApiResponse<Record<string, unknown>[]>>('/leave/types')
      .then((res) => ({ ...res, data: res.data.map(mapLeaveType) })),
}
