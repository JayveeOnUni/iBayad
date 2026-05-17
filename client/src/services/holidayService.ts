import { api } from './api'
import type { ApiResponse, Holiday, HolidayType } from '../types'

export interface HolidayPayload {
  name: string
  holidayDate: string
  date: string
  holidayType: HolidayType
  type: HolidayType
  isRecurring: boolean
  country: string
  cityOrProvince: string | null
  isWorkingHoliday: boolean
  source: string | null
}

export interface DeleteHolidayResult {
  deletedHolidayId: string
}

export const holidayService = {
  getAll: (year?: number) =>
    api.get<ApiResponse<Holiday[]>>('/admin/holidays', year ? { year } : undefined)
      .then((res) => res.data),
  create: (payload: HolidayPayload) =>
    api.post<ApiResponse<Holiday>>('/admin/holidays', payload)
      .then((res) => res.data),
  update: (id: string, payload: HolidayPayload) =>
    api.put<ApiResponse<Holiday>>(`/admin/holidays/${id}`, payload)
      .then((res) => res.data),
  delete: (id: string) =>
    api.delete<ApiResponse<DeleteHolidayResult>>(`/admin/holidays/${id}`)
      .then((res) => res.data),
}
