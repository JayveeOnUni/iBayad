import express from 'express'
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
import { errorHandler } from './middleware/errorHandler'

dotenv.config()

const app = express()
const PORT = Number(process.env.PORT) || 3001

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

function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return

  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET']
  if (!process.env.DATABASE_URL) {
    required.push('DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD')
  }
  if (!process.env.CORS_ORIGIN && !process.env.CLIENT_URL) {
    required.push('CORS_ORIGIN')
  }

  const missing = required.filter((name) => !process.env[name])
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
}

validateProductionConfig()
const allowedOrigins = getAllowedOrigins()

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({
  origin(origin, callback) {
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

// Request logger (simple, replace with winston in production)
app.use((req, _res, next) => {
  const ts = new Date().toISOString()
  console.log(`[${ts}] ${req.method} ${req.path}`)
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
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development',
  })
})

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' })
})

// ─── Error handler (must be last) ─────────────────────────────────────────────
app.use(errorHandler)

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n iBayad Payroll API`)
  console.log(` Listening on port: ${PORT}`)
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(` Health check path: /api/health\n`)
})

export default app
