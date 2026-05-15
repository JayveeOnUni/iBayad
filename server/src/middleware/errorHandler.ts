import { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'

export interface AppError extends Error {
  statusCode?: number
  isOperational?: boolean
  code?: string
  constraint?: string
  details?: unknown
}

function toOperationalDatabaseError(err: AppError): AppError {
  if (err.code === '42703') {
    return createError('Database schema is out of date. Please run the latest migrations and try again.', 500)
  }

  if (err.code === '23505') {
    const constraint = err.constraint ?? ''
    if (constraint.includes('email')) {
      return createError('An account or employee with that email already exists.', 409)
    }
    return createError('A record with that unique value already exists.', 409)
  }

  return err
}

/**
 * Global Express error handler.
 * Must be mounted AFTER all routes with 4 parameters.
 */
export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const normalizedError = toOperationalDatabaseError(err)
  const statusCode = normalizedError.statusCode ?? 500
  const message = normalizedError.isOperational ? normalizedError.message : 'Internal server error'

  const logMeta = {
    statusCode,
    isOperational: Boolean(normalizedError.isOperational),
    error: err,
  }

  if (statusCode >= 500) {
    logger.error('Request error', logMeta)
  } else {
    logger.warn('Request error', logMeta)
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(normalizedError.details ? { details: normalizedError.details } : {}),
    ...(process.env.NODE_ENV === 'development' && {
      stack: normalizedError.stack,
    }),
  })
}

/**
 * Create an operational error with a status code.
 */
export function createError(message: string, statusCode: number): AppError {
  const err: AppError = new Error(message)
  err.statusCode = statusCode
  err.isOperational = true
  return err
}

/**
 * Async route wrapper — catches promise rejections and forwards to error handler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}
