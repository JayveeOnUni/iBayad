import { api } from './api'
import type { EmployeeFormData, EmployeeSeparationPayload, PaginatedResponse, ApiResponse, ProfileUpdateRequest } from '../types'
import { mapEmployee, mapProfileUpdateRequest } from './mappers'

export interface EmployeeListParams {
  page?: number
  limit?: number
  search?: string
  departmentId?: string
  status?: string
  employmentType?: string
  includeArchived?: boolean
  includeFormer?: boolean
}

export type ProfileUpdateRequestPayload = Record<string, string | null | undefined> & {
  employeeNote?: string | null
}

export const employeeService = {
  list: (params?: EmployeeListParams) =>
    api.get<PaginatedResponse<Record<string, unknown>>>('/employees', params as Record<string, string | number | boolean>)
      .then((res) => ({ ...res, data: res.data.map(mapEmployee) })),

  getById: (id: string) =>
    api.get<ApiResponse<Record<string, unknown>>>(`/employees/${id}`)
      .then((res) => ({ ...res, data: mapEmployee(res.data) })),

  getMe: () =>
    api.get<ApiResponse<Record<string, unknown>>>('/employees/me')
      .then((res) => ({ ...res, data: mapEmployee(res.data) })),

  submitMyProfileUpdateRequest: (data: ProfileUpdateRequestPayload) =>
    api.post<ApiResponse<Record<string, unknown>>>('/employees/me/profile-update-requests', data)
      .then((res) => ({ ...res, data: mapProfileUpdateRequest(res.data) })),

  listMyProfileUpdateRequests: () =>
    api.get<ApiResponse<Record<string, unknown>[]>>('/employees/me/profile-update-requests')
      .then((res) => ({ ...res, data: res.data.map(mapProfileUpdateRequest) as ProfileUpdateRequest[] })),

  create: (data: EmployeeFormData) =>
    api.post<ApiResponse<Record<string, unknown>>>('/employees', data)
      .then((res) => ({ ...res, data: mapEmployee(res.data) })),

  update: (id: string, data: Partial<EmployeeFormData>) =>
    api.put<ApiResponse<Record<string, unknown>>>(`/employees/${id}`, data)
      .then((res) => ({ ...res, data: mapEmployee(res.data) })),

  deactivate: (id: string) =>
    api.delete<ApiResponse<Record<string, unknown>>>(`/employees/${id}`)
      .then((res) => ({ ...res, data: mapEmployee(res.data) })),

  separate: (id: string, data: EmployeeSeparationPayload) =>
    api.put<ApiResponse<Record<string, unknown>>>(`/employees/${id}/separation`, data)
      .then((res) => ({ ...res, data: mapEmployee(res.data) })),

  archive: (id: string) =>
    api.delete<ApiResponse<Record<string, unknown>>>(`/employees/${id}`)
      .then((res) => ({ ...res, data: mapEmployee(res.data) })),

  activate: (id: string) =>
    api.put<ApiResponse<Record<string, unknown>>>(`/employees/${id}/activate`)
      .then((res) => ({ ...res, data: mapEmployee(res.data) })),

  resendActivation: (id: string) =>
    api.post<ApiResponse<void>>(`/employees/${id}/resend-activation`),

  delete: (id: string) =>
    api.delete<ApiResponse<void>>(`/employees/${id}/permanent`),
}
