import { logger } from '../utils/logger'

const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'host.docker.internal',
])

export interface SmtpEnvironmentConfig {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
  requireTls: boolean
  connectionTimeoutMs: number
  greetingTimeoutMs: number
  socketTimeoutMs: number
  sendRetries: number
  retryDelayMs: number
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

function isPlaceholder(value: string | undefined): boolean {
  return !value || value.trim() === '' || value.trim() === 'your_smtp_password_here'
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

function parsePort(name: string, fallback: number): number {
  const rawValue = process.env[name]
  const value = rawValue == null || rawValue.trim() === '' ? String(fallback) : rawValue.trim()
  const port = Number(value)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be a numeric TCP port between 1 and 65535`)
  }

  return port
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

export function getSmtpEnvironmentConfig(): SmtpEnvironmentConfig {
  const host = process.env.SMTP_HOST?.trim()
  const port = parsePort('SMTP_PORT', 587)
  const secure = parseBoolean('SMTP_SECURE', false)
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM?.trim() || user

  if (!host) throw new Error('SMTP_HOST is required to send email')
  if (!from) throw new Error('SMTP_FROM is required to send email')
  if ((user && isPlaceholder(pass)) || (!user && !isPlaceholder(pass))) {
    throw new Error('SMTP_USER and SMTP_PASS must be set together')
  }

  const requireTls = secure ? false : parseBoolean('SMTP_REQUIRE_TLS', isProduction())
  const config: SmtpEnvironmentConfig = {
    host,
    port,
    secure,
    user,
    pass: isPlaceholder(pass) ? undefined : pass,
    from,
    requireTls,
    connectionTimeoutMs: parsePositiveInteger('SMTP_CONNECTION_TIMEOUT_MS', 10_000),
    greetingTimeoutMs: parsePositiveInteger('SMTP_GREETING_TIMEOUT_MS', 10_000),
    socketTimeoutMs: parsePositiveInteger('SMTP_SOCKET_TIMEOUT_MS', 30_000),
    sendRetries: parsePositiveInteger('SMTP_SEND_RETRIES', isProduction() ? 2 : 0),
    retryDelayMs: parsePositiveInteger('SMTP_RETRY_DELAY_MS', 1_000),
  }

  validateSmtpSecurityPairing(config, isProduction())
  return config
}

export function validateSmtpSecurityPairing(
  config: Pick<SmtpEnvironmentConfig, 'secure' | 'port'>,
  strict: boolean
): void {
  if (config.secure && config.port !== 465) {
    const message = 'SMTP_SECURE=true should use port 465 for implicit TLS'
    if (strict) throw new Error(message)
    logger.warn(message, { smtpPort: config.port, smtpSecure: config.secure })
  }

  if (!config.secure && config.port === 465) {
    throw new Error('SMTP_SECURE=false cannot use port 465; use SMTP_SECURE=true for implicit TLS or use port 587 for STARTTLS')
  }

  if (!config.secure && config.port !== 587) {
    logger.warn('SMTP_SECURE=false is usually paired with port 587 or another STARTTLS-compatible port', {
      smtpPort: config.port,
      smtpSecure: config.secure,
    })
  }
}

export function validateProductionConfig(): void {
  if (!isProduction()) return

  const required = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_SECURE',
    'SMTP_USER',
    'SMTP_PASS',
    'SMTP_FROM',
    'CLIENT_URL',
  ]

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
  getSmtpEnvironmentConfig()
}
