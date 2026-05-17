import { api } from './api'
import type { ApiResponse, Department, Shift } from '../types'

export interface ActiveDepartmentLookup {
  id: string
  name: string
  code: string
  description?: string | null
}

export interface ActivePositionLookup {
  id: string
  title: string
  code: string
  description?: string | null
  departmentId?: string | null
  basicSalary?: number | null
}

export interface ActiveShiftLookup {
  id: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  workingHoursPerDay: number
}

export interface ShiftPayload {
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  workingHoursPerDay: number
}

export interface DepartmentPayload {
  name: string
  code: string
  description: string | null
}

export interface DeleteDepartmentResult {
  deletedDepartmentId: string
}

export interface DeleteShiftResult {
  deletedShiftId: string
  reassignedEmployees: number
}

export const departmentService = {
  getActive: () =>
    api.get<ApiResponse<ActiveDepartmentLookup[]>>('/admin/departments/active')
      .then((res) => res.data),
  getAll: () =>
    api.get<ApiResponse<Department[]>>('/admin/departments')
      .then((res) => res.data),
  create: (payload: DepartmentPayload) =>
    api.post<ApiResponse<Department>>('/admin/departments', payload)
      .then((res) => res.data),
  update: (id: string, payload: DepartmentPayload) =>
    api.put<ApiResponse<Department>>(`/admin/departments/${id}`, payload)
      .then((res) => res.data),
  toggleActive: (id: string) =>
    api.patch<ApiResponse<Department>>(`/admin/departments/${id}/toggle-active`)
      .then((res) => res.data),
  delete: (id: string) =>
    api.delete<ApiResponse<DeleteDepartmentResult>>(`/admin/departments/${id}`)
      .then((res) => res.data),
}

export const positionService = {
  getActive: () =>
    api.get<ApiResponse<ActivePositionLookup[]>>('/admin/positions/active')
      .then((res) => res.data),
}

export const shiftService = {
  getActive: () =>
    api.get<ApiResponse<ActiveShiftLookup[]>>('/admin/shifts/active')
      .then((res) => res.data),
  getAll: () =>
    api.get<ApiResponse<Shift[]>>('/admin/shifts')
      .then((res) => res.data),
  create: (payload: ShiftPayload) =>
    api.post<ApiResponse<Shift>>('/admin/shifts', payload)
      .then((res) => res.data),
  update: (id: string, payload: ShiftPayload) =>
    api.put<ApiResponse<Shift>>(`/admin/shifts/${id}`, payload)
      .then((res) => res.data),
  toggleActive: (id: string) =>
    api.patch<ApiResponse<Shift>>(`/admin/shifts/${id}/toggle-active`)
      .then((res) => res.data),
  delete: (id: string) =>
    api.delete<ApiResponse<DeleteShiftResult>>(`/admin/shifts/${id}`)
      .then((res) => res.data),
}
