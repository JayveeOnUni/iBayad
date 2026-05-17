import { api } from './api'
import type { Announcement, ApiResponse } from '../types'

export interface AnnouncementPayload {
  title: string
  content: string
  startDate: string | null
  endDate: string | null
  isPinned: boolean
}

export interface DeleteAnnouncementResult {
  deletedAnnouncementId: string
}

export const announcementService = {
  getAll: () =>
    api.get<ApiResponse<Announcement[]>>('/admin/announcements')
      .then((res) => res.data),
  create: (payload: AnnouncementPayload) =>
    api.post<ApiResponse<Announcement>>('/admin/announcements', payload)
      .then((res) => res.data),
  update: (id: string, payload: AnnouncementPayload) =>
    api.put<ApiResponse<Announcement>>(`/admin/announcements/${id}`, payload)
      .then((res) => res.data),
  delete: (id: string) =>
    api.delete<ApiResponse<DeleteAnnouncementResult>>(`/admin/announcements/${id}`)
      .then((res) => res.data),
}
