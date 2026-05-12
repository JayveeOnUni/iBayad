import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
import { getSmtpEnvironmentConfig, type SmtpEnvironmentConfig } from '../config/environment'
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
  messageId?: string
  accepted: string[]
  rejected: string[]
  pending: string[]
  sentAt: string
}

export interface SmtpReadinessResult {
  ready: boolean
  checkedAt: string
  host?: string
  port?: number
  secure?: boolean
  message: string
}

export class EmailDeliveryError extends Error {
  emailType: EmailType

  constructor(emailType: EmailType) {
    super('Email delivery failed')
    this.name = 'EmailDeliveryError'
    this.emailType = emailType
  }
}

let transporter: Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options> | null = null
let transporterConfig: SmtpEnvironmentConfig | null = null

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

function stringifyAddress(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'address' in value) {
    const address = (value as { address?: unknown }).address
    return typeof address === 'string' ? address : ''
  }
  return ''
}

function toStringArray(values: unknown): string[] {
  return Array.isArray(values)
    ? values.map(stringifyAddress).filter(Boolean)
    : []
}

function recipientDomains(to: SendEmailInput['to']): string[] {
  const recipients = Array.isArray(to) ? to : [to]
  return [...new Set(recipients.map((recipient) => recipient.split('@')[1]).filter(Boolean))]
}

function buildTransportOptions(config: SmtpEnvironmentConfig): SMTPTransport.Options {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    connectionTimeout: config.connectionTimeoutMs,
    greetingTimeout: config.greetingTimeoutMs,
    socketTimeout: config.socketTimeoutMs,
    auth: config.user && config.pass
      ? {
          user: config.user,
          pass: config.pass,
        }
      : undefined,
    tls: {
      minVersion: 'TLSv1.2',
    },
  }
}

export function createTransporter(): Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options> {
  const config = getSmtpEnvironmentConfig()

  if (!transporter) {
    transporter = nodemailer.createTransport(buildTransportOptions(config))
    transporterConfig = config
  }

  return transporter
}

function getActiveConfig(): SmtpEnvironmentConfig {
  if (!transporterConfig) {
    createTransporter()
  }

  return transporterConfig!
}

function getSmtpErrorMetadata(error: unknown): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) return { error }

  const smtpError = error as Error & {
    code?: unknown
    command?: unknown
    responseCode?: unknown
  }

  return {
    errorName: smtpError.name,
    ...(process.env.NODE_ENV !== 'production' ? { errorMessage: smtpError.message } : {}),
    code: smtpError.code,
    command: smtpError.command,
    responseCode: smtpError.responseCode,
  }
}

function isRetryableSmtpError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const smtpError = error as { code?: unknown; responseCode?: unknown }
  if (typeof smtpError.responseCode === 'number' && smtpError.responseCode >= 500) return false

  return ['ETIMEDOUT', 'ECONNECTION', 'ECONNRESET', 'ESOCKET'].includes(String(smtpError.code))
}

function toDeliveryMetadata(
  emailType: EmailType,
  info: SMTPTransport.SentMessageInfo
): EmailDeliveryMetadata {
  return {
    emailType,
    messageId: info.messageId,
    accepted: toStringArray(info.accepted),
    rejected: toStringArray(info.rejected),
    pending: toStringArray(info.pending),
    sentAt: new Date().toISOString(),
  }
}

export async function verifySmtpConnection(): Promise<SmtpReadinessResult> {
  let config: SmtpEnvironmentConfig | undefined

  try {
    const mailer = createTransporter()
    config = getActiveConfig()
    await mailer.verify()

    logger.info('SMTP readiness check succeeded', {
      smtpHost: config.host,
      smtpPort: config.port,
      smtpSecure: config.secure,
    })

    return {
      ready: true,
      checkedAt: new Date().toISOString(),
      host: config.host,
      port: config.port,
      secure: config.secure,
      message: 'SMTP connection verified',
    }
  } catch (error) {
    logger.error('SMTP readiness check failed', {
      smtpHost: config?.host,
      smtpPort: config?.port,
      smtpSecure: config?.secure,
      ...getSmtpErrorMetadata(error),
    })

    return {
      ready: false,
      checkedAt: new Date().toISOString(),
      host: config?.host,
      port: config?.port,
      secure: config?.secure,
      message: 'SMTP connection could not be verified',
    }
  }
}

export async function assertSmtpReady(): Promise<void> {
  const readiness = await verifySmtpConnection()
  if (!readiness.ready) {
    throw new Error('SMTP readiness check failed. Verify SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, and SMTP_FROM.')
  }
}

export async function sendEmail(input: SendEmailInput): Promise<EmailDeliveryMetadata> {
  const mailer = createTransporter()
  const config = getActiveConfig()
  const attempts = config.sendRetries + 1
  const mailOptions: SendMailOptions = {
    from: config.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    headers: {
      'X-iBayad-Email-Type': input.emailType,
    },
    disableFileAccess: true,
    disableUrlAccess: true,
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const info = await mailer.sendMail(mailOptions)
      const metadata = toDeliveryMetadata(input.emailType, info)

      if (metadata.rejected.length > 0 && metadata.accepted.length === 0) {
        throw new Error('SMTP provider rejected all recipients')
      }

      logger.info('Email sent', {
        emailType: input.emailType,
        messageId: metadata.messageId,
        acceptedCount: metadata.accepted.length,
        rejectedCount: metadata.rejected.length,
        pendingCount: metadata.pending.length,
        recipientDomains: recipientDomains(input.to),
      })

      return metadata
    } catch (error) {
      const canRetry = attempt < attempts && isRetryableSmtpError(error)

      logger.warn(canRetry ? 'Email send attempt failed; retrying' : 'Email send failed', {
        emailType: input.emailType,
        attempt,
        attempts,
        recipientDomains: recipientDomains(input.to),
        ...getSmtpErrorMetadata(error),
      })

      if (!canRetry) {
        throw new EmailDeliveryError(input.emailType)
      }

      await sleep(config.retryDelayMs * attempt)
    }
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
