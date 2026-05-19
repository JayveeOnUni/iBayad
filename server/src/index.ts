import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'

// Routes
import authRoutes from './routes/auth'
import employeeRoutes from './routes/employees'
import payrollRoutes from './routes/payroll'
import attendanceRoutes from './routes/attendance'
import leaveRoutes from './routes/leave'
import adminLeaveRoutes from './routes/adminLeaves'
import adminDashboardRoutes from './routes/adminDashboard'
import adminReferenceDataRoutes from './routes/adminReferenceData'
import profileUpdateRequestRoutes from './routes/profileUpdateRequests'

// Middleware
import { asyncHandler, errorHandler } from './middleware/errorHandler'
import { authenticate, requireRole } from './middleware/auth'
import {
  getSafeEmailConfigForLogging,
  isEmailReadinessRequired,
  validateProductionConfig,
} from './config/environment'
import { assertEmailProviderReady, verifyEmailProviderReadiness } from './services/emailService'
import { startAutoAbsentScheduler } from './services/attendanceAutoAbsentService'
import { logger } from './utils/logger'

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT) || 3001
const HOST = '0.0.0.0'

function parseOrigins(value: string | undefined): string[] {
  return value
    ? value.split(',').map((origin) => origin.trim().replace(/\/+$/, '')).filter(Boolean)
    : []
}

function getAllowedOrigins(): string[] {
  const configuredOrigins = [
    ...parseOrigins(process.env.CORS_ORIGIN),
    ...parseOrigins(process.env.CLIENT_URL),
  ]
  if (configuredOrigins.length > 0) return configuredOrigins
  return process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173']
}

try {
  validateProductionConfig()
} catch (error) {
  logger.error('Production configuration validation failed', { error })
  process.exit(1)
}

const allowedOrigins = getAllowedOrigins()

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS`))
  },
  credentials: true,
}))

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.use((req: Request, _res: Response, next: NextFunction): void => {
  const startedAt = Date.now()
  _res.on('finish', () => {
    logger.info('HTTP request completed', {
      method: req.method,
      path: req.path,
      statusCode: _res.statusCode,
      durationMs: Date.now() - startedAt,
    })
  })
  next()
})

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes)
app.use('/api/employees', employeeRoutes)
app.use('/api/payroll', payrollRoutes)
app.use('/api/attendance', attendanceRoutes)
app.use('/api/leave', leaveRoutes)
app.use('/api/leaves', leaveRoutes)
app.use('/api/admin/dashboard', adminDashboardRoutes)
app.use('/api/admin/leaves', adminLeaveRoutes)
app.use('/api/admin', adminReferenceDataRoutes)
app.use('/api/profile-update-requests', profileUpdateRequestRoutes)

// Health check
app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  })
})

app.get('/api/admin/readiness/email', authenticate, requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
  const readiness = await verifyEmailProviderReadiness()

  res.status(readiness.ready ? 200 : 503).json({
    success: readiness.ready,
    message: readiness.message,
    data: readiness,
  })
}))

// 404 handler
app.use((_req: Request, res: Response): void => {
  res.status(404).json({ success: false, message: 'Route not found' })
})

// ─── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler)

// ─── Start ────────────────────────────────────────────────────────────────────
function shouldCheckEmailOnStartup(requireEmailReady: boolean): boolean {
  return requireEmailReady || process.env.NODE_ENV === 'production'
}

function logEmailStartupConfig(requireEmailReady: boolean): void {
  logger.info('Email provider startup configuration', {
    ...getSafeEmailConfigForLogging(),
    requireEmailReady,
  })
}

async function runOptionalEmailReadinessCheck(): Promise<void> {
  const readiness = await verifyEmailProviderReadiness()
  if (!readiness.ready) {
    logger.warn('Email readiness check failed; continuing because REQUIRE_EMAIL_READY is not true', {
      ...getSafeEmailConfigForLogging(),
      message: readiness.message,
    })
  }
}

async function startServer(): Promise<void> {
  try {
    const requireEmailReady = isEmailReadinessRequired()

    if (shouldCheckEmailOnStartup(requireEmailReady)) {
      logEmailStartupConfig(requireEmailReady)
    }

    if (requireEmailReady) {
      await assertEmailProviderReady()
    }

    app.listen(PORT, HOST, (): void => {
      logger.info('iBayad Payroll API started', {
        host: HOST,
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        healthCheckPath: '/api/health',
      })
    })

    startAutoAbsentScheduler()

    if (!requireEmailReady && shouldCheckEmailOnStartup(requireEmailReady)) {
      void runOptionalEmailReadinessCheck().catch((error) => {
        logger.error('Email readiness check errored; server remains online because REQUIRE_EMAIL_READY is not true', {
          ...getSafeEmailConfigForLogging(),
          error,
        })
      })
    }
  } catch (error) {
    logger.error('Server startup failed', { error })
    process.exit(1)
  }
}

void startServer()

export default app
