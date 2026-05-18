import { api } from './api'
import type { ApiResponse, ProfileUpdateRequest } from '../types'
import { mapProfileUpdateRequest } from './mappers'

export const profileUpdateRequestService = {
  list: (params?: { status?: string; limit?: number }) =>
    api.get<ApiResponse<Record<string, unknown>[]>>(
      '/profile-update-requests',
      params as Record<string, string | number | boolean>
    ).then((res) => ({ ...res, data: res.data.map(mapProfileUpdateRequest) as ProfileUpdateRequest[] })),

  getById: (id: string) =>
    api.get<ApiResponse<Record<string, unknown>>>(`/profile-update-requests/${id}`)
      .then((res) => ({ ...res, data: mapProfileUpdateRequest(res.data) })),

  approve: (id: string) =>
    api.post<ApiResponse<Record<string, unknown>>>(`/profile-update-requests/${id}/approve`)
      .then((res) => ({ ...res, data: mapProfileUpdateRequest(res.data) })),

  reject: (id: string, remarks?: string) =>
    api.post<ApiResponse<Record<string, unknown>>>(`/profile-update-requests/${id}/reject`, { remarks })
      .then((res) => ({ ...res, data: mapProfileUpdateRequest(res.data) })),
}
