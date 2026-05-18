import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import { login } from '../src/controllers/authController'
import { errorHandler } from '../src/middleware/errorHandler'
import {
  loginRateLimiter,
  normalizeLoginEmail,
  recordFailedLogin,
  recordSuccessfulLogin,
  resetLoginRateLimitForTests,
} from '../src/middleware/loginRateLimiter'
import pool from '../src/utils/db'

type QueryResult = { rows: unknown[]; rowCount?: number }
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>

const originals = {
  poolQuery: pool.query.bind(pool),
  jwtSecret: process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  maxAttempts: process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
  windowMinutes: process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES,
  blockMinutes: process.env.LOGIN_RATE_LIMIT_BLOCK_MINUTES,
}

function restoreEnvironment() {
  setOrDeleteEnv('JWT_SECRET', originals.jwtSecret)
  setOrDeleteEnv('JWT_REFRESH_SECRET', originals.jwtRefreshSecret)
  setOrDeleteEnv('LOGIN_RATE_LIMIT_MAX_ATTEMPTS', originals.maxAttempts)
  setOrDeleteEnv('LOGIN_RATE_LIMIT_WINDOW_MINUTES', originals.windowMinutes)
  setOrDeleteEnv('LOGIN_RATE_LIMIT_BLOCK_MINUTES', originals.blockMinutes)
}

function setOrDeleteEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

function activeUser(passwordHash: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'Admin@Example.com',
    password_hash: passwordHash,
    activation_token_hash: null,
    role: 'admin',
    employee_id: null,
    first_name: 'Admin',
    last_name: 'User',
    is_active: true,
    is_deleted: false,
    employment_status: null,
    created_at: '2026-05-18T00:00:00.000Z',
    updated_at: '2026-05-18T00:00:00.000Z',
    ...overrides,
  }
}

function invokeLogin(body: Record<string, unknown>) {
  return new Promise<{ statusCode: number; body: Record<string, unknown> }>((resolve) => {
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code
        return this
      },
      json(payload: Record<string, unknown>) {
        resolve({ statusCode: this.statusCode, body: payload })
        return this
      },
    } as Response

    const next: NextFunction = (error?: unknown) => {
      if (error) {
        errorHandler(error as never, {} as Request, res, (() => undefined) as NextFunction)
      }
    }

    login({
      body,
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
    } as Partial<Request> as Request, res, next)
  })
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-access-secret'
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret'
  process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = '2'
  process.env.LOGIN_RATE_LIMIT_WINDOW_MINUTES = '15'
  process.env.LOGIN_RATE_LIMIT_BLOCK_MINUTES = '15'
  resetLoginRateLimitForTests()
})

afterEach(() => {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  resetLoginRateLimitForTests()
  restoreEnvironment()
})

test('login normalizes email before querying and returns the existing user email', async () => {
  const passwordHash = await bcrypt.hash('password123', 4)
  const queries: Array<{ text: string; params?: unknown[] }> = []

  ;(pool as unknown as { query: QueryFn }).query = async (text, params) => {
    queries.push({ text, params })
    if (text.includes('FROM users u') && text.includes('LOWER(u.email) = LOWER($1)')) {
      return { rows: [activeUser(passwordHash)] }
    }
    if (text.includes('UPDATE users SET refresh_token_hash')) {
      return { rows: [], rowCount: 1 }
    }
    throw new Error(`Unexpected auth query: ${text}`)
  }

  const result = await invokeLogin({
    email: '  ADMIN@Example.COM ',
    password: 'password123',
  })

  const data = result.body.data as Record<string, unknown>
  const user = data.user as Record<string, unknown>

  assert.equal(result.statusCode, 200)
  assert.equal(queries[0].params?.[0], 'admin@example.com')
  assert.equal(user.email, 'Admin@Example.com')
})

test('invalid login uses a safe message', async () => {
  ;(pool as unknown as { query: QueryFn }).query = async () => ({ rows: [] })

  const result = await invokeLogin({
    email: 'missing@example.com',
    password: 'password123',
  })

  assert.equal(result.statusCode, 401)
  assert.equal(result.body.message, 'Invalid email or password')
})

test('inactive login is rejected without revealing password state', async () => {
  const passwordHash = await bcrypt.hash('password123', 4)
  ;(pool as unknown as { query: QueryFn }).query = async () => ({
    rows: [activeUser(passwordHash, { is_active: false })],
  })

  const result = await invokeLogin({
    email: 'admin@example.com',
    password: 'password123',
  })

  assert.equal(result.statusCode, 403)
  assert.equal(result.body.message, 'Account is inactive')
})

test('login rate limiter blocks repeated failed attempts by IP and normalized email', () => {
  const req = {
    body: { email: ' USER@Example.COM ' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as Partial<Request> as Request
  let nextCalls = 0
  const next: NextFunction = () => {
    nextCalls += 1
  }
  const res = {
    statusCode: 200,
    body: null as Record<string, unknown> | null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: Record<string, unknown>) {
      this.body = payload
      return this
    },
  } as Response & { body: Record<string, unknown> | null }

  loginRateLimiter(req, res, next)
  recordFailedLogin(req, normalizeLoginEmail(req.body.email))
  recordFailedLogin(req, normalizeLoginEmail(req.body.email))
  loginRateLimiter(req, res, next)

  assert.equal(nextCalls, 1)
  assert.equal(res.statusCode, 429)
  assert.equal(res.body?.message, 'Too many failed sign-in attempts. Please wait before trying again.')

  recordSuccessfulLogin(req, normalizeLoginEmail(req.body.email))
  loginRateLimiter(req, res, next)

  assert.equal(nextCalls, 2)
})
