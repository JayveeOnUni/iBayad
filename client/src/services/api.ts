import { useAuthStore } from '../store/authStore'
import type { ApiResponse } from '../types'

const DEFAULT_BASE_URL = '/api'

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_BASE_URL

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '')
  if (withoutTrailingSlash === DEFAULT_BASE_URL || withoutTrailingSlash.endsWith('/api')) {
    return withoutTrailingSlash
  }

  if (/^https?:\/\//i.test(withoutTrailingSlash)) {
    return `${withoutTrailingSlash}${DEFAULT_BASE_URL}`
  }

  return withoutTrailingSlash
}

const BASE_URL = normalizeBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL
)

type RefreshResponse = ApiResponse<{ accessToken: string }>

class ApiClient {
  private baseUrl: string
  private refreshPromise: Promise<string> | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private resolveUrl(path: string): string {
    return new URL(`${this.baseUrl}${path}`, window.location.origin).toString()
  }

  private getHeaders(): HeadersInit {
    const tokens = useAuthStore.getState().tokens
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    if (tokens?.accessToken) {
      headers['Authorization'] = `Bearer ${tokens.accessToken}`
    }
    return headers
  }

  private clearAuthAndRedirect(): void {
    useAuthStore.getState().logout()
    if (window.location.pathname !== '/login') {
      window.location.href = '/login'
    }
  }

  private async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise

    const refreshToken = useAuthStore.getState().tokens?.refreshToken
    if (!refreshToken) {
      throw new Error('No refresh token available')
    }

    this.refreshPromise = fetch(this.resolveUrl('/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        const data = await this.parseResponse<RefreshResponse>(res)
        const accessToken = data.data.accessToken
        useAuthStore.getState().setTokens({ accessToken, refreshToken })
        return accessToken
      })
      .finally(() => {
        this.refreshPromise = null
      })

    return this.refreshPromise
  }

  private async parseResponse<T>(res: Response): Promise<T> {
    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined

    if (!res.ok) {
      const error = new Error(data?.message ?? `HTTP error ${res.status}`) as Error & { details?: unknown }
      error.details = data?.details
      throw error
    }

    return data as T
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    retryOnUnauthorized = true
  ): Promise<T> {
    return this.requestUrl<T>(this.resolveUrl(path), path, init, retryOnUnauthorized)
  }

  private async requestUrl<T>(
    url: string,
    path: string,
    init: RequestInit,
    retryOnUnauthorized = true
  ): Promise<T> {
    const res = await fetch(url, init)

    if (res.status === 401 && retryOnUnauthorized && path !== '/auth/refresh') {
      let accessToken: string
      try {
        accessToken = await this.refreshAccessToken()
      } catch {
        this.clearAuthAndRedirect()
        throw new Error('Unauthorized')
      }

      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${accessToken}`)
      const retryRes = await fetch(url, { ...init, headers })
      if (retryRes.status === 401) {
        this.clearAuthAndRedirect()
      }
      return this.parseResponse<T>(retryRes)
    }

    return this.parseResponse<T>(res)
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
    const url = new URL(this.resolveUrl(path))
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v))
        }
      })
    }
    return this.requestUrl<T>(url.toString(), path, {
      method: 'GET',
      headers: this.getHeaders(),
    })
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: this.getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, path !== '/auth/login' && path !== '/auth/refresh')
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>(path, {
      method: 'DELETE',
      headers: this.getHeaders(),
    })
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    const tokens = useAuthStore.getState().tokens
    if (tokens?.accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${tokens.accessToken}`)
    }

    const requestInit = {
      ...init,
      headers,
    }
    const res = await fetch(this.resolveUrl(path), requestInit)

    if (res.status !== 401 || path === '/auth/refresh') {
      return res
    }

    try {
      const accessToken = await this.refreshAccessToken()
      headers.set('Authorization', `Bearer ${accessToken}`)
      return fetch(this.resolveUrl(path), requestInit)
    } catch {
      this.clearAuthAndRedirect()
      return res
    }
  }
}

export const api = new ApiClient(BASE_URL)
