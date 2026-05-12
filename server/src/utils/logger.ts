type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogMeta = Record<string, unknown>

const SENSITIVE_KEY_PATTERN = /(pass|password|token|secret|authorization|cookie|credential|smtp_pass|jwt)/i
const TOKEN_QUERY_PATTERN = /([?&](?:token|password|pass|secret|jwt|code)=)[^&\s]+/gi

function redactString(value: string): string {
  return value.replace(TOKEN_QUERY_PATTERN, '$1[REDACTED]')
}

function sanitize(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]'

  if (typeof value === 'string') return redactString(value)
  if (typeof value !== 'object' || value === null) return value

  if (value instanceof Error) {
    const errorWithFields = value as Error & {
      code?: unknown
      command?: unknown
      responseCode?: unknown
      statusCode?: unknown
    }

    return {
      name: value.name,
      message: redactString(value.message),
      code: errorWithFields.code,
      command: errorWithFields.command,
      responseCode: errorWithFields.responseCode,
      statusCode: errorWithFields.statusCode,
      ...(process.env.NODE_ENV !== 'production' ? { stack: value.stack } : {}),
    }
  }

  if (Array.isArray(value)) return value.map((item) => sanitize(item, key))

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      sanitize(entryValue, entryKey),
    ])
  )
}

function log(level: LogLevel, message: string, meta?: LogMeta): void {
  if (level === 'debug' && process.env.NODE_ENV === 'production') return

  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(meta ? { meta: sanitize(meta) } : {}),
  }

  const output = process.env.NODE_ENV === 'production'
    ? JSON.stringify(payload)
    : `[${payload.timestamp}] ${level.toUpperCase()} ${message}${
        meta ? ` ${JSON.stringify(payload.meta)}` : ''
      }`

  if (level === 'error') {
    console.error(output)
    return
  }

  if (level === 'warn') {
    console.warn(output)
    return
  }

  console.log(output)
}

export const logger = {
  debug: (message: string, meta?: LogMeta): void => log('debug', message, meta),
  info: (message: string, meta?: LogMeta): void => log('info', message, meta),
  warn: (message: string, meta?: LogMeta): void => log('warn', message, meta),
  error: (message: string, meta?: LogMeta): void => log('error', message, meta),
}
