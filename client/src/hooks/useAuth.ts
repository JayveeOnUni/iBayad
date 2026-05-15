import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { authService } from '../services/authService'
import type { LoginCredentials } from '../types'

const fullAdminRoles = new Set(['admin', 'super_admin'])
const payrollWorkspaceRoles = new Set(['payroll_preparer', 'payroll_approver', 'payroll_releaser', 'auditor'])

function defaultPathForRole(role: string | undefined) {
  if (role === 'employee') return '/employee/dashboard'
  if (fullAdminRoles.has(role ?? '')) return '/admin/dashboard'
  if (payrollWorkspaceRoles.has(role ?? '')) return '/admin/payroll'
  return '/login'
}

export function useAuth() {
  const { user, isAuthenticated, isLoading, setAuth, logout: clearAuth, setLoading } = useAuthStore()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  const login = async (credentials: LoginCredentials) => {
    try {
      setError(null)
      setLoading(true)
      const response = await authService.login(credentials)
      setAuth(response.user, response.tokens)
      navigate(defaultPathForRole(response.user.role))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    try {
      await authService.logout()
    } catch {
      // ignore server error on logout
    } finally {
      clearAuth()
      navigate('/login')
    }
  }

  const changePassword = async (currentPassword: string, newPassword: string) => {
    try {
      setError(null)
      await authService.changePassword(currentPassword, newPassword)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.')
      return false
    }
  }

  const isAdmin = fullAdminRoles.has(user?.role ?? '')

  return {
    user,
    isAuthenticated,
    isLoading,
    isAdmin,
    error,
    login,
    logout,
    changePassword,
  }
}
