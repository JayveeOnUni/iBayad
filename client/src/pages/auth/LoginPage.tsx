import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { FeedbackMessage } from '../../components/ui/Page'
import { useAuth } from '../../hooks/useAuth'
import type { LoginCredentials } from '../../types'
import logoUrl from '../../Logo.png'
import loginBackgroundUrl from '../../assets/login-office-background.png'

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(6, 'Password must be at least 6 characters'),
})

type LoginFormValues = z.infer<typeof loginSchema>

export default function LoginPage() {
  const { login, isLoading, error } = useAuth()
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  const onSubmit = async (data: LoginCredentials) => {
    await login({
      ...data,
      email: data.email.trim().toLowerCase(),
    })
  }

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-surface px-4 py-8">
      <img
        src={loginBackgroundUrl}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 -z-20 h-full w-full object-cover opacity-[0.16] grayscale"
      />
      <div className="absolute inset-0 -z-10 bg-white/78" aria-hidden="true" />

      <div className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-border bg-white/95 shadow-elevated backdrop-blur-[2px] lg:grid-cols-[1fr_440px]">
        <section className="hidden bg-brand-900 p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-11 w-12 items-center justify-start overflow-hidden rounded-md bg-white">
                <img src={logoUrl} alt="iBayad logo" className="h-10 w-auto max-w-none object-contain object-left" />
              </div>
              <div>
                <h1 className="text-xl font-semibold leading-tight">iBayad</h1>
                <p className="text-sm text-brand-100">Payroll Management System</p>
              </div>
            </div>
            <p className="max-w-sm text-3xl font-semibold leading-tight">
              Secure payroll and HR operations in one workspace.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2" aria-hidden="true">
            <div className="h-1.5 rounded-full bg-brand-400" />
            <div className="h-1.5 rounded-full bg-secondary" />
            <div className="h-1.5 rounded-full bg-danger" />
          </div>
        </section>

        <main className="px-6 py-8 sm:px-8">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-11 items-center justify-start overflow-hidden rounded-md bg-brand-900">
              <img src={logoUrl} alt="iBayad logo" className="h-9 w-auto max-w-none object-contain object-left" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight text-brand">iBayad</h1>
              <p className="text-xs font-medium text-muted">Payroll Management System</p>
            </div>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-ink">Welcome back</h2>
            <p className="mt-1 text-sm text-muted">Sign in with your company account.</p>
          </div>

          {error && (
            <FeedbackMessage variant="danger" className="mb-5">
              {error}
            </FeedbackMessage>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
              placeholder="you@ibayad.com"
              leftAddon={<Mail size={16} />}
              required
              error={errors.email?.message}
              {...register('email')}
            />

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-medium text-ink">
                  Password <span className="text-danger">*</span>
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium text-brand transition-colors hover:text-brand-700"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Enter your password"
                leftAddon={<Lock size={16} />}
                rightAddon={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                }
                required
                error={errors.password?.message}
                {...register('password')}
              />
            </div>

            <Button type="submit" fullWidth size="lg" isLoading={isLoading} className="mt-2">
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted">
            Having trouble accessing your account?{' '}
            <a href="mailto:support@ibayad.com" className="font-medium text-brand hover:underline">
              Contact support
            </a>
          </p>

          <p className="mt-8 text-center text-xs text-neutral-60">
            © {new Date().getFullYear()} iBayad. All rights reserved.
          </p>
        </main>
      </div>
    </div>
  )
}
