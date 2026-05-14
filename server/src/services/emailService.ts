import { randomUUID } from 'crypto'
import { Resend, type ErrorResponse } from 'resend'
import {
  getEmailEnvironmentConfig,
  getSafeEmailConfigForLogging,
  type EmailEnvironmentConfig,
} from '../config/environment'
import { logger } from '../utils/logger'

type EmailType = 'activation' | 'password_reset' | string

interface ActivationEmailInput {
  to: string
  name: string
  activationLink: string
  expiresHours: number
}

interface PasswordResetEmailInput {
  to: string
  employeeName: string
  resetUrl: string
  expiresMinutes: number
}

export interface SendEmailInput {
  to: string | string[]
  subject: string
  html: string
  text: string
  emailType: EmailType
}

export interface EmailDeliveryMetadata {
  emailType: EmailType
  provider: 'resend'
  messageId?: string
  accepted: string[]
  rejected: string[]
  pending: string[]
  sentAt: string
}

export interface EmailReadinessResult {
  ready: boolean
  checkedAt: string
  provider: 'resend'
  from?: string
  message: string
}

export class EmailDeliveryError extends Error {
  emailType: EmailType
  cause?: unknown

  constructor(emailType: EmailType, cause?: unknown) {
    super(`Email delivery failed for ${emailType}. The email provider is unavailable or rejected the message.`)
    this.name = 'EmailDeliveryError'
    this.emailType = emailType
    this.cause = cause
  }
}

let resendClient: Resend | null = null
let resendConfig: EmailEnvironmentConfig | null = null

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char))
}

function normalizeAsciiIdentifier(value: string, fallback: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  return normalized || fallback
}

function toRecipientArray(to: SendEmailInput['to']): string[] {
  return Array.isArray(to) ? to : [to]
}

function recipientDomains(to: SendEmailInput['to']): string[] {
  const recipients = toRecipientArray(to)
  return [...new Set(recipients.map((recipient) => recipient.split('@')[1]).filter(Boolean))]
}

function createResendClient(): Resend {
  const config = getEmailEnvironmentConfig()

  if (!resendClient || resendConfig?.apiKey !== config.apiKey) {
    resendClient = new Resend(config.apiKey)
    resendConfig = config
  }

  return resendClient
}

function getActiveConfig(): EmailEnvironmentConfig {
  if (!resendConfig) {
    createResendClient()
  }

  return resendConfig!
}

function getResendErrorMetadata(error: unknown): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) return { error }

  const resendError = error as Partial<ErrorResponse> & Error

  return {
    errorName: resendError.name,
    statusCode: resendError.statusCode,
    ...(process.env.NODE_ENV !== 'production' ? { errorMessage: resendError.message } : {}),
  }
}

function isRetryableResendError(error: ErrorResponse): boolean {
  if (error.statusCode == null) return true
  if (error.statusCode === 408 || error.statusCode === 429) return true
  return error.statusCode >= 500
}

function toDeliveryMetadata(emailType: EmailType, messageId: string | undefined, recipients: string[]): EmailDeliveryMetadata {
  return {
    emailType,
    provider: 'resend',
    messageId,
    accepted: recipients,
    rejected: [],
    pending: [],
    sentAt: new Date().toISOString(),
  }
}

function createIdempotencyKey(emailType: EmailType): string {
  return [
    'ibayad',
    normalizeAsciiIdentifier(emailType, 'email'),
    randomUUID(),
  ].join('-')
}

export async function verifyEmailProviderReadiness(): Promise<EmailReadinessResult> {
  try {
    const client = createResendClient()
    const config = getActiveConfig()

    if (!client) {
      throw new Error('Resend client could not be initialized')
    }

    logger.info('Email provider readiness check succeeded', {
      ...getSafeEmailConfigForLogging(config),
    })

    return {
      ready: true,
      checkedAt: new Date().toISOString(),
      provider: 'resend',
      from: config.from,
      message: 'Resend email configuration is present',
    }
  } catch (error) {
    logger.error('Email provider readiness check failed', {
      ...getSafeEmailConfigForLogging(),
      ...getResendErrorMetadata(error),
    })

    return {
      ready: false,
      checkedAt: new Date().toISOString(),
      provider: 'resend',
      message: 'Resend email configuration is incomplete or invalid',
    }
  }
}

export async function assertEmailProviderReady(): Promise<void> {
  const readiness = await verifyEmailProviderReadiness()
  if (!readiness.ready) {
    throw new Error('Email readiness check failed. Verify RESEND_API_KEY, EMAIL_FROM, and CLIENT_URL.')
  }
}

export async function sendEmail(input: SendEmailInput): Promise<EmailDeliveryMetadata> {
  let client: Resend
  let config: EmailEnvironmentConfig

  try {
    client = createResendClient()
    config = getActiveConfig()
  } catch (error) {
    logger.warn('Email send failed before Resend client was ready', {
      emailType: input.emailType,
      recipientDomains: recipientDomains(input.to),
      ...getSafeEmailConfigForLogging(),
      ...getResendErrorMetadata(error),
    })
    throw new EmailDeliveryError(input.emailType, error)
  }

  const recipients = toRecipientArray(input.to)
  const attempts = config.sendRetries + 1
  const idempotencyKey = createIdempotencyKey(input.emailType)

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await client.emails.send({
      from: config.from,
      to: recipients,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: {
        'X-iBayad-Email-Type': input.emailType,
      },
      tags: [
        {
          name: 'email_type',
          value: normalizeAsciiIdentifier(input.emailType, 'email'),
        },
      ],
    }, { idempotencyKey })

    if (response.data) {
      const metadata = toDeliveryMetadata(input.emailType, response.data.id, recipients)

      logger.info('Email sent', {
        provider: config.provider,
        emailType: input.emailType,
        messageId: metadata.messageId,
        acceptedCount: metadata.accepted.length,
        rejectedCount: metadata.rejected.length,
        pendingCount: metadata.pending.length,
        recipientDomains: recipientDomains(input.to),
      })

      return metadata
    }

    const canRetry = attempt < attempts && isRetryableResendError(response.error)

    logger.warn(canRetry ? 'Email send attempt failed; retrying' : 'Email send failed', {
      provider: config.provider,
      emailType: input.emailType,
      attempt,
      attempts,
      recipientDomains: recipientDomains(input.to),
      ...getResendErrorMetadata(response.error),
    })

    if (!canRetry) {
      throw new EmailDeliveryError(input.emailType, response.error)
    }

    await sleep(config.retryDelayMs * attempt)
  }

  throw new EmailDeliveryError(input.emailType)
}

export async function sendActivationEmail(input: ActivationEmailInput): Promise<EmailDeliveryMetadata> {
  const escapedName = escapeHtml(input.name)
  const escapedLink = escapeHtml(input.activationLink)

  return sendEmail({
    to: input.to,
    subject: 'Activate your iBayad Payroll account',
    emailType: 'activation',
    text: [
      `Hello ${input.name},`,
      '',
      'An iBayad Payroll employee account was created for you.',
      `Activate your account and set your password within ${input.expiresHours} hours:`,
      input.activationLink,
      '',
      'If you were not expecting this email, contact your payroll administrator.',
    ].join('\n'),
    html: `
      <p>Hello ${escapedName},</p>
      <p>An iBayad Payroll employee account was created for you.</p>
      <p>
        <a href="${escapedLink}">Activate your account and set your password</a>
        within ${input.expiresHours} hours.
      </p>
      <p>If you were not expecting this email, contact your payroll administrator.</p>
    `,
  })
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<EmailDeliveryMetadata> {
  const escapedName = escapeHtml(input.employeeName || 'there')
  const escapedLink = escapeHtml(input.resetUrl)

  return sendEmail({
    to: input.to,
    subject: 'Reset your iBayad Payroll password',
    emailType: 'password_reset',
    text: [
      `Hello ${input.employeeName || 'there'},`,
      '',
      'We received a request to reset your iBayad Payroll password.',
      `Reset your password within ${input.expiresMinutes} minutes:`,
      input.resetUrl,
      '',
      'If you did not request this change, you can ignore this email.',
    ].join('\n'),
    html: `
      <p>Hello ${escapedName},</p>
      <p>We received a request to reset your iBayad Payroll password.</p>
      <p>
        <a href="${escapedLink}">Reset your password</a>
        within ${input.expiresMinutes} minutes.
      </p>
      <p>If you did not request this change, you can ignore this email.</p>
    `,
  })
}
