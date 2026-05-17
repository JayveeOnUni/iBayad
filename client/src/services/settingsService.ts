import { api } from './api'
import type { ApiResponse, GeneralSettings, LeaveSettings, PayrollSettings } from '../types'

export type GeneralSettingsPayload = GeneralSettings
export type PayrollSettingsPayload = PayrollSettings
export type LeaveSettingsPayload = Pick<LeaveSettings, 'leaveTypes' | 'policies'>

export const settingsService = {
  getGeneral: () =>
    api.get<ApiResponse<GeneralSettings>>('/admin/settings/general')
      .then((res) => res.data),
  updateGeneral: (payload: GeneralSettingsPayload) =>
    api.put<ApiResponse<GeneralSettings>>('/admin/settings/general', payload)
      .then((res) => res.data),
  getPayroll: () =>
    api.get<ApiResponse<PayrollSettings>>('/admin/settings/payroll')
      .then((res) => res.data),
  updatePayroll: (payload: PayrollSettingsPayload) =>
    api.put<ApiResponse<PayrollSettings>>('/admin/settings/payroll', payload)
      .then((res) => res.data),
  getLeave: () =>
    api.get<ApiResponse<LeaveSettings>>('/admin/settings/leave')
      .then((res) => res.data),
  updateLeave: (payload: LeaveSettingsPayload) =>
    api.put<ApiResponse<LeaveSettings>>('/admin/settings/leave', payload)
      .then((res) => res.data),
}
