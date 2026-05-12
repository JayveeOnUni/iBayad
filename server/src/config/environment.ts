const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'host.docker.internal',
])

export interface EmailEnvironmentConfig {
  provider: 'resend'
  apiKey: string
  from: string
  sendRetries: number
  retryDelayMs: number
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value || value.trim() === '') return true

  const normalized = value.trim().toLowerCase()
  return [
    'your_resend_api_key_here',
    're_xxxxxxxxx',
  ].includes(normalized)
}

function parseBoolean(name: string, fallback?: boolean): boolean {
  const rawValue = process.env[name]
  if (rawValue == null || rawValue.trim() === '') {
    if (fallback !== undefined) return fallback
    throw new Error(`${name} must be set to true or false`)
  }

  const normalized = rawValue.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error(`${name} must be set to true or false`)
}

function parsePositiveInteger(name: string, fallback: number): number {
  const rawValue = process.env[name]
  const value = rawValue == null || rawValue.trim() === '' ? String(fallback) : rawValue.trim()
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }

  return parsed
}

export function isEmailReadinessRequired(): boolean {
  return parseBoolean('REQUIRE_EMAIL_READY', isProduction())
}

export function getSafeEmailConfigForLogging(config?: Partial<EmailEnvironmentConfig>): {
  EMAIL_PROVIDER: 'resend'
  EMAIL_FROM?: string
  EMAIL_SEND_RETRIES: number
} {
  const from = config?.from ?? process.env.EMAIL_FROM?.trim()
  const fallbackRetries = isProduction() ? 2 : 0
  const rawRetries = process.env.EMAIL_SEND_RETRIES?.trim()
  const parsedRetries = rawRetries ? Number(rawRetries) : fallbackRetries
  const retries = config?.sendRetries ?? (
    Number.isInteger(parsedRetries) && parsedRetries >= 0 ? parsedRetries : fallbackRetries
  )

  return {
    EMAIL_PROVIDER: 'resend',
    ...(from ? { EMAIL_FROM: from } : {}),
    EMAIL_SEND_RETRIES: retries,
  }
}

function validateClientUrl(value: string): void {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error('CLIENT_URL must be a valid absolute URL')
  }

  const hostname = url.hostname.toLowerCase()
  const isPrivateIpv4 =
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)

  if (
    LOCAL_HOSTNAMES.has(hostname) ||
    hostname.includes('localhost') ||
    /^127\./.test(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    isPrivateIpv4
  ) {
    throw new Error('CLIENT_URL must point to the deployed frontend in production, not a local development URL')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('CLIENT_URL must use http or https')
  }
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function getClientBaseUrl(): string {
  const clientUrl =
    process.env.CLIENT_URL ||
    process.env.CORS_ORIGIN?.split(',')[0]?.trim() ||
    'http://localhost:5173'

  if (isProduction()) {
    validateClientUrl(clientUrl)
  }

  return normalizeBaseUrl(clientUrl)
}

export function buildClientUrl(pathname: string, params: Record<string, string> = {}): string {
  const url = new URL(pathname, getClientBaseUrl())

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  return url.toString()
}

function emailAddressFromSender(value: string): string {
  const trimmed = value.trim()
  const displayNameMatch = trimmed.match(/<([^<>]+)>$/)
  return displayNameMatch?.[1]?.trim() ?? trimmed
}

function validateEmailFrom(value: string): void {
  const address = emailAddressFromSender(value)
  const normalized = address.toLowerCase()
  const placeholderDomains = ['example.com', 'your-domain.com']

  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    throw new Error('EMAIL_FROM must be a valid sender email, optionally formatted as "Name <sender@domain.com>"')
  }

  if (placeholderDomains.some((domain) => normalized.endsWith(`@${domain}`))) {
    throw new Error('EMAIL_FROM must use a verified Resend sender domain, not a placeholder domain')
  }
}

export function getEmailEnvironmentConfig(): EmailEnvironmentConfig {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.EMAIL_FROM?.trim()

  if (isPlaceholder(apiKey)) throw new Error('RESEND_API_KEY is required to send email')
  if (!from) throw new Error('EMAIL_FROM is required to send email')

  validateEmailFrom(from)

  return {
    provider: 'resend',
    apiKey: apiKey!,
    from,
    sendRetries: parsePositiveInteger('EMAIL_SEND_RETRIES', isProduction() ? 2 : 0),
    retryDelayMs: parsePositiveInteger('EMAIL_RETRY_DELAY_MS', 1_000),
  }
}

export function validateProductionConfig(): void {
  if (!isProduction()) return

  const requireEmailReady = isEmailReadinessRequired()
  const required = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'CLIENT_URL',
  ]

  if (requireEmailReady) {
    required.push('RESEND_API_KEY', 'EMAIL_FROM')
  }

  if (!process.env.DATABASE_URL) {
    required.push('DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD')
  }

  const missing = required.filter((name) => isPlaceholder(process.env[name]))
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`)
  }

  const weakSecrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET'].filter((name) => {
    const value = process.env[name]?.trim() ?? ''
    return value.startsWith('replace_with_') || value.length < 32
  })
  if (weakSecrets.length > 0) {
    throw new Error(`Production JWT secrets must be unique random values at least 32 characters long: ${weakSecrets.join(', ')}`)
  }

  if (process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different in production')
  }

  validateClientUrl(process.env.CLIENT_URL!)
  if (requireEmailReady) {
    getEmailEnvironmentConfig()
  }
}
