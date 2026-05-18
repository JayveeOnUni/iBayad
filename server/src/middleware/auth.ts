import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export interface AuthPayload {
  userId: string
  email: string
  role: string
  employeeId?: string
}

export type PayrollPermission =
  | 'payroll:create_period'
  | 'payroll:process'
  | 'payroll:validate'
  | 'payroll:approve'
  | 'payroll:request_correction'
  | 'payroll:release'
  | 'payroll:view'
  | 'payroll:view_payslips'
  | 'payroll:view_reports'
  | 'payroll:export_reports'
  | 'payroll:view_audit_logs'
  | 'payroll:reprocess'
  | 'payroll:unlock'

const payrollPermissionsByRole: Record<string, PayrollPermission[] | '*'> = {
  admin: '*',
  super_admin: '*',
  payroll_preparer: [
    'payroll:create_period',
    'payroll:process',
    'payroll:validate',
    'payroll:reprocess',
    'payroll:view',
    'payroll:view_payslips',
    'payroll:view_reports',
    'payroll:export_reports',
  ],
  payroll_approver: [
    'payroll:validate',
    'payroll:approve',
    'payroll:request_correction',
    'payroll:view',
    'payroll:view_payslips',
    'payroll:view_reports',
    'payroll:export_reports',
  ],
  payroll_releaser: ['payroll:release', 'payroll:view', 'payroll:view_payslips', 'payroll:view_reports'],
  auditor: ['payroll:view', 'payroll:view_payslips', 'payroll:view_reports', 'payroll:export_reports', 'payroll:view_audit_logs'],
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

/**
 * Middleware: verify JWT access token and attach decoded payload to req.user.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'No token provided' })
    return
  }

  const token = authHeader.slice(7)
  const secret = process.env.JWT_SECRET

  if (!secret) {
    res.status(500).json({ success: false, message: 'Server configuration error' })
    return
  }

  try {
    const decoded = jwt.verify(token, secret) as AuthPayload
    req.user = decoded
    next()
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ success: false, message: 'Token expired' })
    } else {
      res.status(401).json({ success: false, message: 'Invalid token' })
    }
  }
}

/**
 * Middleware factory: require specific roles.
 * Usage: requireRole('admin')
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    const hasRequiredRole = roles.includes(req.user.role) ||
      (req.user.role === 'super_admin' && roles.includes('admin'))

    if (!hasRequiredRole) {
      res.status(403).json({
        success: false,
        message: `Access denied. Required role(s): ${roles.join(', ')}`,
      })
      return
    }

    next()
  }
}

export function hasPayrollPermission(role: string | undefined, permission: PayrollPermission): boolean {
  if (!role) return false
  const permissions = payrollPermissionsByRole[role]
  return permissions === '*' || Boolean(permissions?.includes(permission))
}

export function requirePayrollPermission(permission: PayrollPermission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    if (!hasPayrollPermission(req.user.role, permission)) {
      res.status(403).json({
        success: false,
        message: `Access denied. Missing permission: ${permission}`,
      })
      return
    }

    next()
  }
}

/**
 * Employee self-service shorthand.
 * Requires an employee role and a linked employee profile before serving personal records.
 */
export const employeeSelfService = [
  requireRole('employee'),
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user?.employeeId) {
      res.status(403).json({ success: false, message: 'No employee profile is linked to this account' })
      return
    }

    next()
  },
]

/**
 * Leave self-service/admin shorthand.
 * Keeps leave actions limited to employees and full admins. Super admins inherit
 * admin access through requireRole.
 */
export const leaveSelfServiceOrAdmin = [
  requireRole('employee', 'admin'),
  (req: Request, res: Response, next: NextFunction): void => {
    if (req.user?.role === 'employee' && !req.user.employeeId) {
      res.status(403).json({ success: false, message: 'No employee profile is linked to this account' })
      return
    }

    next()
  },
]

/**
 * Admin-only shorthand.
 */
export const adminOnly = requireRole('admin')
