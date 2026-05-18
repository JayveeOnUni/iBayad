import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Mail } from 'lucide-react'
import { useState } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { FeedbackMessage } from '../../components/ui/Page'
import { authService } from '../../services/authService'
import logoUrl from '../../Logo.png'

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
})

type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>

function resetPathFromLink(link: string): string {
  try {
    const url = new URL(link, window.location.origin)
    return `${url.pathname}${url.search}`
  } catch {
    return '/reset-password'
  }
}

export default function ForgotPasswordPage() {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [resetLink, setResetLink] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  })

  const onSubmit = async (values: ForgotPasswordFormValues) => {
    try {
      setIsSubmitting(true)
      setError(null)
      setSuccess(null)
      setResetLink(null)
      const response = await authService.forgotPassword(values.email.trim().toLowerCase())
      setSuccess(response.message ?? 'If an active account exists for that email, password reset instructions have been sent.')
      setResetLink(response.resetLink ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request a password reset.')
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
          <h2 className="text-2xl font-semibold">Reset your password</h2>
          <p className="mt-1 text-sm text-brand-100">Enter your company email address.</p>
        </div>

        <div className="px-8 py-8">
          {error && (
            <FeedbackMessage variant="danger" className="mb-5">
              {error}
            </FeedbackMessage>
          )}

          {success && (
            <FeedbackMessage variant="success" className="mb-5">
              {success}
            </FeedbackMessage>
          )}

          {resetLink && (
            <FeedbackMessage variant="info" className="mb-5 break-words">
              Local reset link: <Link to={resetPathFromLink(resetLink)} className="font-medium underline">open reset page</Link>
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

            <Button type="submit" fullWidth size="lg" isLoading={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send reset link'}
            </Button>
          </form>

          <Link
            to="/login"
            className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-brand transition-colors hover:text-brand-700"
          >
            <ArrowLeft size={16} />
            Back to sign in
          </Link>
        </div>
      </main>
    </div>
  )
}
