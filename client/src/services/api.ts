import { useAuthStore } from '../store/authStore'

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

class ApiClient {
  private baseUrl: string

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

  private async handleResponse<T>(res: Response): Promise<T> {
    if (res.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
      throw new Error('Unauthorized')
    }

    const text = await res.text()
    const data = text ? JSON.parse(text) : undefined

    if (!res.ok) {
      throw new Error(data?.message ?? `HTTP error ${res.status}`)
    }

    return data as T
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
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getHeaders(),
    })
    return this.handleResponse<T>(res)
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.resolveUrl(path), {
      method: 'POST',
      headers: this.getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return this.handleResponse<T>(res)
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.resolveUrl(path), {
      method: 'PUT',
      headers: this.getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return this.handleResponse<T>(res)
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.resolveUrl(path), {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return this.handleResponse<T>(res)
  }

  async delete<T>(path: string): Promise<T> {
    const res = await fetch(this.resolveUrl(path), {
      method: 'DELETE',
      headers: this.getHeaders(),
    })
    return this.handleResponse<T>(res)
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    const tokens = useAuthStore.getState().tokens
    if (tokens?.accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${tokens.accessToken}`)
    }

    return fetch(this.resolveUrl(path), {
      ...init,
      headers,
    })
  }
}

export const api = new ApiClient(BASE_URL)
