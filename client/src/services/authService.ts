import { api } from './api'
import type { ActivationTokenInfo, ApiResponse, AuthResponse, LoginCredentials, User } from '../types'

export const authService = {
  login: (credentials: LoginCredentials) =>
    api.post<ApiResponse<AuthResponse>>('/auth/login', credentials).then((res) => res.data),

  logout: () =>
    api.post<void>('/auth/logout'),

  me: () =>
    api.get<{ data: User }>('/auth/me'),

  refreshToken: (refreshToken: string) =>
    api.post<ApiResponse<{ accessToken: string }>>('/auth/refresh', { refreshToken }).then((res) => res.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.put<void>('/auth/change-password', { currentPassword, newPassword }),

  verifyActivationToken: (token: string) =>
    api.post<ApiResponse<ActivationTokenInfo>>('/auth/activate/verify', { token }).then((res) => res.data),

  activateAccount: (token: string, password: string) =>
    api.post<ApiResponse<void>>('/auth/activate', { token, password }),

  forgotPassword: (email: string) =>
    api.post<ApiResponse<void> & { resetLink?: string }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    api.post<ApiResponse<void>>('/auth/reset-password', { token, password }),
}
