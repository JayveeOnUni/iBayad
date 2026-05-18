import { Link, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { FeedbackMessage } from '../../components/ui/Page'
import { authService } from '../../services/authService'
import logoUrl from '../../Logo.png'

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Confirm your password'),
}).refine((value) => value.password === value.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  })

  const onSubmit = async (values: ResetPasswordFormValues) => {
    if (!token) {
      setError('Password reset token is missing.')
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      const response = await authService.resetPassword(token, values.password)
      setSuccess(response.message ?? 'Password reset successfully. You can now sign in.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-8">
      <main className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-white shadow-elevated">
        <div className="bg-brand-900 px-8 py-7 text-white">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-11 items-center justify-start overflow-hidden rounded-md bg-white">
              <img src={logoUrl} alt="iBayad logo" className="h-9 w-auto max-w-none object-contain object-left" />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight">iBayad</h1>
              <p className="text-xs text-brand-100">Payroll Management System</p>
            </div>
          </div>
          <h2 className="text-2xl font-semibold">Create a new password</h2>
          <p className="mt-1 text-sm text-brand-100">Use at least 8 characters.</p>
        </div>

        <div className="px-8 py-8">
          {!token && (
            <FeedbackMessage variant="danger" className="mb-5">
              Password reset token is missing.
            </FeedbackMessage>
          )}

          {error && (
            <FeedbackMessage variant="danger" className="mb-5">
              {error}
            </FeedbackMessage>
          )}

          {success ? (
            <div className="space-y-5">
              <FeedbackMessage variant="success" className="flex items-start gap-2">
                <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
                <span>{success}</span>
              </FeedbackMessage>
              <Link to="/login">
                <Button fullWidth size="lg">Go to sign in</Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
              <Input
                label="New password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                leftAddon={<Lock size={16} />}
                rightAddon={
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
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

              <Input
                label="Confirm password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                error={errors.confirmPassword?.message}
                {...register('confirmPassword')}
              />

              <Button type="submit" fullWidth size="lg" isLoading={isSubmitting} disabled={!token}>
                {isSubmitting ? 'Saving...' : 'Save new password'}
              </Button>
            </form>
          )}

          {!success && (
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand transition-colors hover:text-brand-700"
            >
              <ArrowLeft size={16} />
              Back to sign in
            </Link>
          )}
        </div>
      </main>
    </div>
  )
}
