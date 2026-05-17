import { api } from './api'
import type { ApiResponse, GeneralSettings } from '../types'

export type GeneralSettingsPayload = GeneralSettings

export const settingsService = {
  getGeneral: () =>
    api.get<ApiResponse<GeneralSettings>>('/admin/settings/general')
      .then((res) => res.data),
  updateGeneral: (payload: GeneralSettingsPayload) =>
    api.put<ApiResponse<GeneralSettings>>('/admin/settings/general', payload)
      .then((res) => res.data),
}
