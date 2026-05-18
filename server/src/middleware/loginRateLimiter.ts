import type { NextFunction, Request, Response } from 'express'

interface LoginAttemptState {
  failures: number
  firstFailureAt: number
  blockedUntil?: number
}

const attempts = new Map<string, LoginAttemptState>()

// Local/demo limiter only. Production deployments should move this state to
// Redis or another shared persistent store so limits work across server restarts.
function positiveIntegerEnv(name: string, fallback: number, minimum: number): number {
  const rawValue = process.env[name]
  const parsed = rawValue == null || rawValue.trim() === '' ? fallback : Number(rawValue)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.floor(parsed)) : fallback
}

function maxAttempts(): number {
  return positiveIntegerEnv('LOGIN_RATE_LIMIT_MAX_ATTEMPTS', 5, 1)
}

function windowMs(): number {
  return positiveIntegerEnv('LOGIN_RATE_LIMIT_WINDOW_MINUTES', 15, 1) * 60 * 1000
}

function blockMs(): number {
  return positiveIntegerEnv('LOGIN_RATE_LIMIT_BLOCK_MINUTES', 5, 1) * 60 * 1000
}

export function normalizeLoginEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown-ip'
}

function attemptKey(req: Request, email: string): string {
  return `${clientIp(req)}:${email || 'unknown-email'}`
}

function getActiveState(key: string, now: number): LoginAttemptState | undefined {
  const state = attempts.get(key)
  if (!state) return undefined

  if (state.blockedUntil && state.blockedUntil > now) {
    return state
  }

  if (state.blockedUntil || now - state.firstFailureAt > windowMs()) {
    attempts.delete(key)
    return undefined
  }

  return state
}

export function loginRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const email = normalizeLoginEmail(req.body?.email)
  const state = getActiveState(attemptKey(req, email), Date.now())

  if (state?.blockedUntil && state.blockedUntil > Date.now()) {
    res.status(429).json({
      success: false,
      message: 'Too many failed sign-in attempts. Please wait before trying again.',
    })
    return
  }

  next()
}

export function recordFailedLogin(req: Request, email: string): void {
  const now = Date.now()
  const key = attemptKey(req, email)
  const state = getActiveState(key, now) ?? { failures: 0, firstFailureAt: now }
  const failures = state.failures + 1

  attempts.set(key, {
    failures,
    firstFailureAt: state.firstFailureAt,
    blockedUntil: failures >= maxAttempts() ? now + blockMs() : undefined,
  })
}

export function recordSuccessfulLogin(req: Request, email: string): void {
  attempts.delete(attemptKey(req, email))
}

export function resetLoginRateLimitForTests(): void {
  attempts.clear()
}
