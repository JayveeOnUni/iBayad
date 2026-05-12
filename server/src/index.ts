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

// Middleware
import { asyncHandler, errorHandler } from './middleware/errorHandler'
import { authenticate, requireRole } from './middleware/auth'
import {
  getSafeSmtpConfigForLogging,
  isSmtpReadinessRequired,
  validateProductionConfig,
} from './config/environment'
import { assertSmtpReady, verifySmtpConnection } from './services/emailService'
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

// Health check
app.get('/api/health', (_req: Request, res: Response): void => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  })
})

app.get('/api/admin/readiness/smtp', authenticate, requireRole('admin'), asyncHandler(async (_req: Request, res: Response) => {
  const readiness = await verifySmtpConnection()

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
function shouldCheckSmtpOnStartup(requireSmtpReady: boolean): boolean {
  return requireSmtpReady || process.env.NODE_ENV === 'production'
}

function logSmtpStartupConfig(requireSmtpReady: boolean): void {
  logger.info('SMTP startup configuration', {
    ...getSafeSmtpConfigForLogging(),
    requireSmtpReady,
  })
}

async function runOptionalSmtpReadinessCheck(): Promise<void> {
  const readiness = await verifySmtpConnection()
  if (!readiness.ready) {
    logger.warn('SMTP readiness check failed; continuing because REQUIRE_SMTP_READY is not true', {
      ...getSafeSmtpConfigForLogging(),
      message: readiness.message,
    })
  }
}

async function startServer(): Promise<void> {
  try {
    const requireSmtpReady = isSmtpReadinessRequired()

    if (shouldCheckSmtpOnStartup(requireSmtpReady)) {
      logSmtpStartupConfig(requireSmtpReady)
    }

    if (requireSmtpReady) {
      await assertSmtpReady()
    }

    app.listen(PORT, HOST, (): void => {
      logger.info('iBayad Payroll API started', {
        host: HOST,
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        healthCheckPath: '/api/health',
      })
    })

    if (!requireSmtpReady && shouldCheckSmtpOnStartup(requireSmtpReady)) {
      void runOptionalSmtpReadinessCheck().catch((error) => {
        logger.error('SMTP readiness check errored; server remains online because REQUIRE_SMTP_READY is not true', {
          ...getSafeSmtpConfigForLogging(),
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
