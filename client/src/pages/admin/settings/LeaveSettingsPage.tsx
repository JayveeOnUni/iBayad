import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  CircleHelp,
  Info,
  LockKeyhole,
  Save,
  ShieldCheck,
} from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import Badge from '../../../components/ui/Badge'
import { FeedbackMessage, Page, PageHeader } from '../../../components/ui/Page'
import { useToast } from '../../../components/ui/Toast'
import { settingsService } from '../../../services/settingsService'
import type { LeavePolicyConfig, LeaveSettings, LeaveTypeConfig } from '../../../types'

type PageMessage = { variant: 'info' | 'success' | 'warning' | 'danger'; text: string }
type FieldErrors = Record<string, string>
type LeaveTypeField = keyof LeaveTypeConfig
type LeavePolicyField = keyof LeavePolicyConfig
type EnforcementStatus = 'enforced' | 'conditional' | 'reference'

interface EnforcementInfo {
  status: EnforcementStatus
  description: string
}

interface LeaveSection {
  id: 'accrual' | 'company' | 'statutory'
  title: string
  subtitle: string
  items: LeaveTypeConfig[]
  icon: ReactNode
}

const emptySettings: LeaveSettings = {
  leaveTypes: [],
  policies: [],
  globalSettings: {},
  clarificationItems: [],
}

const enforcementLabels: Record<EnforcementStatus, string> = {
  enforced: 'Enforced',
  conditional: 'Conditionally enforced',
  reference: 'Reference only',
}

const enforcementVariants: Record<EnforcementStatus, 'success' | 'warning' | 'neutral'> = {
  enforced: 'success',
  conditional: 'warning',
  reference: 'neutral',
}

const leaveTypeEnforcement: Partial<Record<LeaveTypeField, EnforcementInfo>> = {
  name: { status: 'reference', description: 'Display label saved for admins and employee-facing leave lists.' },
  code: { status: 'enforced', description: 'Stable backend code used by special leave rules. Codes cannot be changed here.' },
  daysPerYear: { status: 'conditional', description: 'Used for non-accrual balances; vacation and sick credits come from policy rows.' },
  dayCountType: { status: 'enforced', description: 'Used when counting requested leave days.' },
  maxDaysPerRequest: { status: 'conditional', description: 'Used by generic filing validation except vacation leave, which has a separate clarification path.' },
  filingDeadlineDays: { status: 'enforced', description: 'Used with supported deadline types during filing validation.' },
  filingDeadlineType: { status: 'enforced', description: 'Only supported deadline types are exposed here.' },
  documentRule: { status: 'conditional', description: 'Used when Requires Document is on and the rule maps to known document types.' },
  isPaid: { status: 'conditional', description: 'Used for payroll impact; statutory and emergency rules can add special handling.' },
  isAccrualBased: { status: 'reference', description: 'Classification metadata. Current accrual credits come from policy rows and leave code rules.' },
  requiresBalance: { status: 'enforced', description: 'Used when deciding whether insufficient credits block filing.' },
  requiresDocument: { status: 'enforced', description: 'Used during filing validation with document rule parsing.' },
  appliesToProbationary: { status: 'enforced', description: 'Used by employee eligibility validation.' },
  appliesToRegular: { status: 'enforced', description: 'Used by employee eligibility validation.' },
  isCashConvertible: { status: 'reference', description: 'Classification metadata. Cash conversion uses policy limits.' },
  isCarryOverAllowed: { status: 'reference', description: 'Classification metadata. Carry-over uses policy limits.' },
}

const policyEnforcement: Partial<Record<LeavePolicyField, EnforcementInfo>> = {
  entitlementDays: { status: 'enforced', description: 'Used for configured vacation and sick annual credits.' },
  monthlyCredit: { status: 'enforced', description: 'Used for configured vacation and sick monthly earned credits.' },
  carryOverLimit: { status: 'conditional', description: 'Used by year-end carry-over processing where the leave type supports it.' },
  cashConversionLimit: { status: 'conditional', description: 'Used by cash conversion processing where the leave type supports it.' },
  forfeitureRule: { status: 'reference', description: 'Saved as a policy note; numeric limits drive calculations.' },
  notes: { status: 'reference', description: 'Admin note only.' },
}

function fieldErrorKey(kind: 'leaveTypes' | 'policies', id: string, field: string): string {
  return `${kind}.${id}.${field}`
}

function optionalNumberValue(value: number | null | undefined): string | number {
  return value ?? ''
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function parseRequiredNumber(value: string): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function formatStatus(value: string): string {
  return value.replace(/_/g, ' ')
}

function simplifyClarification(item: string): string {
  const simplified: Record<string, string> = {
    'Vacation leave conflict: maximum 3 consecutive days versus department-head route for more than 3 days.':
      'Vacation leave over 3 straight days needs a clear HR rule.',
    'Exact leave entitlement progression from 5 to 10 to 15 days requires HR confirmation.':
      'HR needs to confirm when employees move from 5 to 10 to 15 leave days.',
    'Front-loaded versus monthly accrual requires HR confirmation; current implementation computes earned monthly credits.':
      'The system currently earns leave monthly. HR should confirm if leave should instead be given all at once.',
    'Vacation, sick, emergency, and bereavement day counting require HR confirmation; current implementation uses working days and excludes non-working holidays.':
      'The system currently counts working days only for most company leaves. HR should confirm if holidays or rest days should count.',
    'Bereavement payment, deduction source, and supporting documents require HR confirmation; current implementation treats it as configurable unpaid/non-credit leave.':
      'HR should confirm if bereavement leave is paid, what balance it uses, and what documents are needed.',
    'Emergency leave supporting documents require HR confirmation.':
      'HR should confirm what documents are needed for emergency leave.',
    'Sick leave approval versus notice-only workflow requires HR confirmation; current implementation still routes through review.':
      'Sick leave currently still needs review. HR should confirm if some sick leaves should only require notice.',
    'Mandated leave and recall effects require HR confirmation.':
      'HR should confirm how mandatory leave and employee recall should affect leave balances and payroll.',
    'Holiday handling for non-statutory leaves requires HR confirmation; current implementation excludes non-working holidays for working-day leaves.':
      'The system currently skips non-working holidays for working-day leaves. HR should confirm if this is correct.',
    'Payroll daily-rate formulas require HR confirmation; current implementation uses employee daily_rate or monthly salary divided by work_days_per_month.':
      'Payroll uses the employee daily rate, or monthly salary divided by work days per month. HR should confirm this formula.',
  }

  return simplified[item] ?? item
}

function enforcementHint(info: EnforcementInfo | undefined, extra?: string): string | undefined {
  if (!info) return extra
  return `${enforcementLabels[info.status]}: ${info.description}${extra ? ` ${extra}` : ''}`
}

function EnforcementIcon({ status }: { status: EnforcementStatus }) {
  if (status === 'enforced') return <CheckCircle2 size={14} aria-hidden="true" />
  if (status === 'conditional') return <AlertTriangle size={14} aria-hidden="true" />
  return <CircleHelp size={14} aria-hidden="true" />
}

function EnforcementBadge({ info }: { info?: EnforcementInfo }) {
  if (!info) return null

  return (
    <Badge variant={enforcementVariants[info.status]} className="normal-case">
      <EnforcementIcon status={info.status} />
      {enforcementLabels[info.status]}
    </Badge>
  )
}

function EnforcementLegend() {
  const items: Array<{ status: EnforcementStatus; text: string }> = [
    { status: 'enforced', text: 'Backend filing, balance, payroll, or eligibility rules use this value.' },
    { status: 'conditional', text: 'Backend uses this value only for supported leave types or rule paths.' },
    { status: 'reference', text: 'Saved or displayed as policy metadata, but not a direct rule gate.' },
  ]

  return (
    <Card padding="sm">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.status} className="flex min-w-0 gap-3">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-neutral-30 text-neutral-80">
              <EnforcementIcon status={item.status} />
            </div>
            <div className="min-w-0">
              <EnforcementBadge info={{ status: item.status, description: '' }} />
              <p className="mt-1 text-xs leading-5 text-muted">{item.text}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function extractServerFieldErrors(error: unknown): FieldErrors {
  const details = (error as { details?: { errors?: Record<string, string[]> } } | null)?.details
  const serverErrors = details?.errors
  if (!serverErrors) return {}

  return Object.entries(serverErrors).reduce<FieldErrors>((acc, [field, messages]) => {
    acc[field] = messages[0]
    return acc
  }, {})
}

function validateSettings(settings: LeaveSettings): FieldErrors {
  const errors: FieldErrors = {}

  settings.leaveTypes.forEach((leaveType) => {
    const prefix = `leaveTypes.${leaveType.id}`
    if (!leaveType.name.trim()) errors[`${prefix}.name`] = 'Leave type name is required'
    if (!leaveType.code.trim()) errors[`${prefix}.code`] = 'Code is required'
    if ((leaveType.daysPerYear ?? 0) < 0) errors[`${prefix}.daysPerYear`] = 'Days per year cannot be negative'
    if (leaveType.maxDaysPerRequest != null && leaveType.maxDaysPerRequest <= 0) {
      errors[`${prefix}.maxDaysPerRequest`] = 'Max days must be greater than 0'
    }
    if (leaveType.filingDeadlineDays != null) {
      if (leaveType.filingDeadlineDays < 0) {
        errors[`${prefix}.filingDeadlineDays`] = 'Filing deadline cannot be negative'
      } else if (!Number.isInteger(leaveType.filingDeadlineDays)) {
        errors[`${prefix}.filingDeadlineDays`] = 'Filing deadline must be a whole number'
      }
    }
  })

  settings.policies.forEach((policy) => {
    const prefix = `policies.${policy.id}`
    if (policy.entitlementDays < 0) errors[`${prefix}.entitlementDays`] = 'Entitlement cannot be negative'
    if (policy.monthlyCredit < 0) errors[`${prefix}.monthlyCredit`] = 'Monthly credit cannot be negative'
    if (policy.carryOverLimit != null && policy.carryOverLimit < 0) {
      errors[`${prefix}.carryOverLimit`] = 'Carry-over limit cannot be negative'
    }
    if (policy.cashConversionLimit != null && policy.cashConversionLimit < 0) {
      errors[`${prefix}.cashConversionLimit`] = 'Cash conversion limit cannot be negative'
    }
  })

  return errors
}

function ToggleRow({
  label,
  description,
  enforcement,
  checked,
  disabled,
  readOnly = false,
  onChange,
}: {
  label: string
  description: string
  enforcement?: EnforcementInfo
  checked: boolean
  disabled: boolean
  readOnly?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {label}
          <EnforcementBadge info={enforcement} />
        </span>
        <span className="block text-xs leading-5 text-muted">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled || readOnly}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 flex-shrink-0 accent-brand disabled:opacity-50"
      />
    </label>
  )
}

function ReadOnlyFlag({
  label,
  description,
  enforcement,
  value,
}: {
  label: string
  description: string
  enforcement?: EnforcementInfo
  value: boolean
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {label}
          <EnforcementBadge info={enforcement} />
        </div>
        <p className="text-xs leading-5 text-muted">{description}</p>
      </div>
      <Badge variant={value ? 'info' : 'neutral'}>{value ? 'Yes' : 'No'}</Badge>
    </div>
  )
}

function SectionHeader({
  title,
  subtitle,
  count,
  icon,
}: {
  title: string
  subtitle: string
  count: number
  icon: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <p className="mt-0.5 text-sm leading-6 text-muted">{subtitle}</p>
        </div>
      </div>
      <Badge variant="neutral">{count} configured</Badge>
    </div>
  )
}

function EmptySection({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-neutral-20 px-4 py-6 text-sm text-muted">
      {text}
    </div>
  )
}

export default function LeaveSettingsPage() {
  const { showToast } = useToast()
  const [settings, setSettings] = useState<LeaveSettings>(emptySettings)
  const [message, setMessage] = useState<PageMessage | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [showClarifications, setShowClarifications] = useState(true)

  useEffect(() => {
    let isMounted = true

    settingsService.getLeave()
      .then((data) => {
        if (!isMounted) return
        setSettings(data)
        setMessage(null)
        setFieldErrors({})
      })
      .catch((err) => {
        if (!isMounted) return
        setMessage({
          variant: 'danger',
          text: err instanceof Error ? err.message : 'Unable to load leave settings.',
        })
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const groupedLeaveTypes = useMemo(() => ({
    accrual: settings.leaveTypes.filter((item) => item.isAccrualBased && !item.isStatutory),
    company: settings.leaveTypes.filter((item) => !item.isAccrualBased && !item.isStatutory),
    statutory: settings.leaveTypes.filter((item) => item.isStatutory),
  }), [settings.leaveTypes])

  const leaveSections: LeaveSection[] = useMemo(() => [
    {
      id: 'accrual',
      title: 'Accrual-Based Leaves',
      subtitle: 'Balance-backed leave types where credits are earned from policy rows.',
      items: groupedLeaveTypes.accrual,
      icon: <CheckCircle2 size={18} aria-hidden="true" />,
    },
    {
      id: 'company',
      title: 'Non-Accrual Company Leaves',
      subtitle: 'Company-managed leaves that do not earn monthly credits.',
      items: groupedLeaveTypes.company,
      icon: <Info size={18} aria-hidden="true" />,
    },
    {
      id: 'statutory',
      title: 'Statutory / Protected Leaves',
      subtitle: 'Protected legal leave rules are shown for review and locked from accidental edits.',
      items: groupedLeaveTypes.statutory,
      icon: <ShieldCheck size={18} aria-hidden="true" />,
    },
  ], [groupedLeaveTypes])

  const policiesByLeaveType = useMemo(() => settings.policies.reduce<Record<string, LeavePolicyConfig[]>>((acc, policy) => {
    acc[policy.leaveTypeId] = [...(acc[policy.leaveTypeId] ?? []), policy]
    return acc
  }, {}), [settings.policies])

  const isFormDisabled = isLoading || isSaving

  const updateLeaveType = <K extends LeaveTypeField>(id: string, field: K, value: LeaveTypeConfig[K]) => {
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[fieldErrorKey('leaveTypes', id, field)]
      delete next[`leaveTypes.${id}`]
      return next
    })
    setSettings((current) => ({
      ...current,
      leaveTypes: current.leaveTypes.map((item) => (
        item.id === id ? { ...item, [field]: value } : item
      )),
    }))
  }

  const updatePolicy = <K extends LeavePolicyField>(id: string, field: K, value: LeavePolicyConfig[K]) => {
    setFieldErrors((current) => {
      const next = { ...current }
      delete next[fieldErrorKey('policies', id, field)]
      delete next[`policies.${id}`]
      return next
    })
    setSettings((current) => ({
      ...current,
      policies: current.policies.map((item) => (
        item.id === id ? { ...item, [field]: value } : item
      )),
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)

    const validationErrors = validateSettings(settings)
    setFieldErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      setMessage({ variant: 'danger', text: 'Please correct the highlighted leave settings before saving.' })
      return
    }

    setIsSaving(true)
    try {
      const saved = await settingsService.updateLeave({
        leaveTypes: settings.leaveTypes,
        policies: settings.policies,
      })
      setSettings(saved)
      setFieldErrors({})
      showToast({
        variant: 'success',
        title: 'Leave settings saved',
        description: 'Audit log updated.',
      })
    } catch (err) {
      const serverErrors = extractServerFieldErrors(err)
      setFieldErrors(serverErrors)
      setMessage({
        variant: 'danger',
        text: err instanceof Error ? err.message : 'Unable to save leave settings.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const renderLeaveType = (leaveType: LeaveTypeConfig) => {
    const isProtected = Boolean(leaveType.isProtected)
    const disabled = isFormDisabled || isProtected
    const prefix = `leaveTypes.${leaveType.id}`
    const itemError = fieldErrors[prefix]
    const canEditDaysPerYear = !disabled && !leaveType.isAccrualBased
    const canEditDocumentRule = !disabled && leaveType.requiresDocument

    return (
      <div key={leaveType.id} className="rounded-md border border-border bg-neutral-10 p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="break-words text-sm font-semibold text-ink">{leaveType.name || 'Unnamed leave type'}</h4>
              <Badge variant="info">{leaveType.code}</Badge>
              <Badge variant={leaveType.isActive === false ? 'neutral' : 'success'} dot>
                {leaveType.isActive === false ? 'Inactive' : 'Active'}
              </Badge>
              {isProtected && <Badge variant="warning"><LockKeyhole size={12} aria-hidden="true" /> Protected</Badge>}
            </div>
            {leaveType.policyNotes && <p className="mt-1 text-xs leading-5 text-muted">{leaveType.policyNotes}</p>}
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <EnforcementBadge info={leaveTypeEnforcement.dayCountType} />
            {leaveType.requiresBalance && <Badge variant="info">Balance required</Badge>}
            {leaveType.requiresDocument && <Badge variant="warning">Docs required</Badge>}
          </div>
        </div>

        {isProtected && (
          <FeedbackMessage variant="warning" className="mb-4">
            <span className="inline-flex items-center gap-2">
              <LockKeyhole size={15} aria-hidden="true" />
              Protected statutory values are locked because payroll and legal handling are controlled by statutory rules.
            </span>
          </FeedbackMessage>
        )}
        {itemError && <FeedbackMessage variant="danger" className="mb-4">{itemError}</FeedbackMessage>}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Input
            id={`${leaveType.id}-name`}
            label="Name"
            value={leaveType.name}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'name', event.target.value)}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'name')]}
            hint={enforcementHint(leaveTypeEnforcement.name)}
          />
          <Input
            id={`${leaveType.id}-code`}
            label="Code"
            value={leaveType.code}
            disabled
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'code')]}
            hint={enforcementHint(leaveTypeEnforcement.code)}
          />
          <Input
            id={`${leaveType.id}-days-per-year`}
            label="Days / Year"
            type="number"
            step="0.01"
            min={0}
            value={leaveType.daysPerYear ?? 0}
            disabled={!canEditDaysPerYear}
            onChange={(event) => updateLeaveType(leaveType.id, 'daysPerYear', parseRequiredNumber(event.target.value))}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'daysPerYear')]}
            hint={enforcementHint(
              leaveTypeEnforcement.daysPerYear,
              leaveType.isAccrualBased ? 'Locked for accrual leaves because policy rows drive credits.' : undefined
            )}
          />
          <Select
            id={`${leaveType.id}-day-count`}
            label="Day Count"
            value={leaveType.dayCountType}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'dayCountType', event.target.value as LeaveTypeConfig['dayCountType'])}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'dayCountType')]}
            hint={enforcementHint(leaveTypeEnforcement.dayCountType)}
          >
            <option value="working_days">Working days</option>
            <option value="calendar_days">Calendar days</option>
          </Select>
          <Input
            id={`${leaveType.id}-max-days`}
            label="Max / Request"
            type="number"
            step="0.01"
            min={0.01}
            value={optionalNumberValue(leaveType.maxDaysPerRequest)}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'maxDaysPerRequest', parseOptionalNumber(event.target.value))}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'maxDaysPerRequest')]}
            hint={enforcementHint(leaveTypeEnforcement.maxDaysPerRequest)}
          />
          <Input
            id={`${leaveType.id}-deadline-days`}
            label="Filing Deadline"
            type="number"
            step={1}
            min={0}
            value={optionalNumberValue(leaveType.filingDeadlineDays)}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'filingDeadlineDays', parseOptionalNumber(event.target.value))}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'filingDeadlineDays')]}
            hint={enforcementHint(leaveTypeEnforcement.filingDeadlineDays, 'Whole days before start.')}
          />
          <Select
            id={`${leaveType.id}-deadline-type`}
            label="Deadline Type"
            value={leaveType.filingDeadlineType ?? ''}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'filingDeadlineType', event.target.value || undefined)}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'filingDeadlineType')]}
            hint={enforcementHint(leaveTypeEnforcement.filingDeadlineType)}
          >
            <option value="">No deadline rule</option>
            <option value="working_days_before_start">Working days before start</option>
            <option value="calendar_days_before_start">Calendar days before start</option>
            <option value="one_hour_before_shift">One hour before shift</option>
          </Select>
          <Input
            id={`${leaveType.id}-document-rule`}
            label="Document Rule"
            value={leaveType.documentRule ?? ''}
            disabled={!canEditDocumentRule}
            onChange={(event) => updateLeaveType(leaveType.id, 'documentRule', event.target.value || undefined)}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'documentRule')]}
            hint={enforcementHint(
              leaveTypeEnforcement.documentRule,
              leaveType.requiresDocument ? undefined : 'Locked until Requires Document is enabled.'
            )}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-x-6 lg:grid-cols-2">
          <div>
            <ToggleRow
              label="Paid"
              description="Approved leave may create paid payroll impact."
              enforcement={leaveTypeEnforcement.isPaid}
              checked={leaveType.isPaid}
              disabled={disabled}
              onChange={(checked) => updateLeaveType(leaveType.id, 'isPaid', checked)}
            />
            <ToggleRow
              label="Requires Balance"
              description="Requests consume tracked credits and can be blocked by insufficient balance."
              enforcement={leaveTypeEnforcement.requiresBalance}
              checked={leaveType.requiresBalance}
              disabled={disabled}
              onChange={(checked) => updateLeaveType(leaveType.id, 'requiresBalance', checked)}
            />
            <ToggleRow
              label="Requires Document"
              description="Filing validation expects supporting document types."
              enforcement={leaveTypeEnforcement.requiresDocument}
              checked={leaveType.requiresDocument}
              disabled={disabled}
              onChange={(checked) => updateLeaveType(leaveType.id, 'requiresDocument', checked)}
            />
            <ReadOnlyFlag
              label="Accrual Based"
              description="Classification shown for policy grouping. Accrual credits are controlled by policy rows."
              enforcement={leaveTypeEnforcement.isAccrualBased}
              value={leaveType.isAccrualBased}
            />
          </div>
          <div>
            <ToggleRow
              label="Probationary Applies"
              description="Probationary employees can select this leave type."
              enforcement={leaveTypeEnforcement.appliesToProbationary}
              checked={leaveType.appliesToProbationary}
              disabled={disabled}
              onChange={(checked) => updateLeaveType(leaveType.id, 'appliesToProbationary', checked)}
            />
            <ToggleRow
              label="Regular Applies"
              description="Regular employees can select this leave type."
              enforcement={leaveTypeEnforcement.appliesToRegular}
              checked={leaveType.appliesToRegular}
              disabled={disabled}
              onChange={(checked) => updateLeaveType(leaveType.id, 'appliesToRegular', checked)}
            />
            <ReadOnlyFlag
              label="Cash Convertible"
              description="Reference flag. Cash conversion is governed by policy limits below."
              enforcement={leaveTypeEnforcement.isCashConvertible}
              value={leaveType.isCashConvertible}
            />
            <ReadOnlyFlag
              label="Carry Over Allowed"
              description="Reference flag. Carry-over is governed by policy limits below."
              enforcement={leaveTypeEnforcement.isCarryOverAllowed}
              value={leaveType.isCarryOverAllowed}
            />
          </div>
        </div>
      </div>
    )
  }

  const renderPolicy = (policy: LeavePolicyConfig) => {
    const disabled = isFormDisabled || Boolean(policy.isProtected)
    const prefix = `policies.${policy.id}`
    const itemError = fieldErrors[prefix]

    return (
      <div key={policy.id} className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
        <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold capitalize text-ink">{formatStatus(policy.employmentStatus)}</p>
              <Badge variant="info">{policy.leaveTypeCode}</Badge>
              {policy.isProtected && <Badge variant="warning"><LockKeyhole size={12} aria-hidden="true" /> Protected</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted">Effective {policy.effectiveDate}</p>
          </div>
          {policy.isProtected && (
            <p className="max-w-xl text-xs leading-5 text-warning">
              Locked statutory entitlement row. Changes must be handled through compliant statutory rule updates.
            </p>
          )}
        </div>
        {itemError && <FeedbackMessage variant="danger" className="mb-4">{itemError}</FeedbackMessage>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Input
            id={`${policy.id}-entitlement`}
            label="Entitlement"
            type="number"
            step="0.01"
            min={0}
            value={policy.entitlementDays}
            disabled={disabled}
            onChange={(event) => updatePolicy(policy.id, 'entitlementDays', parseRequiredNumber(event.target.value))}
            error={fieldErrors[`${prefix}.entitlementDays`]}
            hint={enforcementHint(policyEnforcement.entitlementDays)}
          />
          <Input
            id={`${policy.id}-monthly-credit`}
            label="Monthly Credit"
            type="number"
            step="0.01"
            min={0}
            value={policy.monthlyCredit}
            disabled={disabled}
            onChange={(event) => updatePolicy(policy.id, 'monthlyCredit', parseRequiredNumber(event.target.value))}
            error={fieldErrors[`${prefix}.monthlyCredit`]}
            hint={enforcementHint(policyEnforcement.monthlyCredit)}
          />
          <Input
            id={`${policy.id}-carry-over`}
            label="Carry Over"
            type="number"
            step="0.01"
            min={0}
            value={optionalNumberValue(policy.carryOverLimit)}
            disabled={disabled}
            onChange={(event) => updatePolicy(policy.id, 'carryOverLimit', parseOptionalNumber(event.target.value))}
            error={fieldErrors[`${prefix}.carryOverLimit`]}
            hint={enforcementHint(policyEnforcement.carryOverLimit)}
          />
          <Input
            id={`${policy.id}-cash-conversion`}
            label="Cash Conversion"
            type="number"
            step="0.01"
            min={0}
            value={optionalNumberValue(policy.cashConversionLimit)}
            disabled={disabled}
            onChange={(event) => updatePolicy(policy.id, 'cashConversionLimit', parseOptionalNumber(event.target.value))}
            error={fieldErrors[`${prefix}.cashConversionLimit`]}
            hint={enforcementHint(policyEnforcement.cashConversionLimit)}
          />
          <Input
            id={`${policy.id}-forfeiture-rule`}
            label="Forfeiture Rule"
            value={policy.forfeitureRule ?? ''}
            disabled={disabled}
            onChange={(event) => updatePolicy(policy.id, 'forfeitureRule', event.target.value || null)}
            error={fieldErrors[`${prefix}.forfeitureRule`]}
            hint={enforcementHint(policyEnforcement.forfeitureRule)}
            className="xl:col-span-2"
          />
          <Input
            id={`${policy.id}-notes`}
            label="Notes"
            value={policy.notes ?? ''}
            disabled={disabled}
            onChange={(event) => updatePolicy(policy.id, 'notes', event.target.value || null)}
            error={fieldErrors[`${prefix}.notes`]}
            hint={enforcementHint(policyEnforcement.notes)}
            className="xl:col-span-2"
          />
        </div>
      </div>
    )
  }

  return (
    <Page maxWidth="wide" className="pb-8">
      <PageHeader
        title="Leave Settings"
        subtitle="Configure leave rules, entitlement rows, and policy metadata used by filing validation, balances, payroll impact, carry-over, and cash conversion."
        actions={(
          <Button
            type="submit"
            form="leave-settings-form"
            leftIcon={<Save size={15} />}
            isLoading={isSaving}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            Save Changes
          </Button>
        )}
      />

      {message && <FeedbackMessage variant={message.variant}>{message.text}</FeedbackMessage>}
      {isLoading && <FeedbackMessage>Loading leave settings...</FeedbackMessage>}
      <EnforcementLegend />
      {settings.clarificationItems.length > 0 && (
        <div className="rounded-lg border border-warning-border bg-warning-muted text-warning">
          <button
            type="button"
            onClick={() => setShowClarifications((current) => !current)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium"
            aria-expanded={showClarifications}
          >
            <span className="flex min-w-0 items-center gap-2">
              <AlertTriangle size={16} className="flex-shrink-0" aria-hidden="true" />
              <span className="truncate">Policy clarifications</span>
              <Badge variant="warning">{settings.clarificationItems.length}</Badge>
            </span>
            <ChevronDown
              size={16}
              className={`flex-shrink-0 transition-transform ${showClarifications ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
          {showClarifications && (
            <ul className="list-disc space-y-1 border-t border-warning-border px-8 py-3 text-sm leading-6">
              {settings.clarificationItems.map((item) => (
                <li key={item}>{simplifyClarification(item)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form id="leave-settings-form" onSubmit={handleSubmit} className="space-y-5">
        {leaveSections.map((section) => (
          <Card key={section.id}>
            <SectionHeader
              title={section.title}
              subtitle={section.subtitle}
              count={section.items.length}
              icon={section.icon}
            />
            {section.id === 'statutory' && (
              <FeedbackMessage variant="warning" className="mb-4">
                Statutory and protected leaves are shown for operational visibility. Editable controls are locked to prevent accidental legal or payroll rule drift.
              </FeedbackMessage>
            )}
            <div className="space-y-4">
              {section.items.length > 0
                ? section.items.map(renderLeaveType)
                : <EmptySection text="No leave types are currently configured in this group." />}
            </div>
          </Card>
        ))}

        <Card>
          <SectionHeader
            title="Policy Entitlements & Limits"
            subtitle="Employment-status rows that drive annual credits, monthly accruals, carry-over, and conversion caps."
            count={settings.policies.length}
            icon={<ShieldCheck size={18} aria-hidden="true" />}
          />
          <div className="space-y-5">
            {settings.leaveTypes.map((leaveType) => {
              const policies = policiesByLeaveType[leaveType.id] ?? []
              if (policies.length === 0) return null

              return (
                <div key={leaveType.id} className="rounded-md border border-border bg-neutral-10 p-4">
                  <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="break-words text-sm font-semibold text-ink">{leaveType.name}</h4>
                        <Badge variant={leaveType.isStatutory ? 'warning' : 'info'}>{leaveType.code}</Badge>
                        {leaveType.isProtected && <Badge variant="warning"><LockKeyhole size={12} aria-hidden="true" /> Protected</Badge>}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {policies.length} entitlement row{policies.length === 1 ? '' : 's'} configured for this leave type.
                      </p>
                    </div>
                  </div>
                  <div>{policies.map(renderPolicy)}</div>
                </div>
              )
            })}
            {settings.policies.length === 0 && <EmptySection text="No policy entitlement rows are currently configured." />}
          </div>
        </Card>

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted">
            Save keeps the existing admin settings endpoint and records changed rows for audit. Locked statutory rows are validated again by the server.
          </p>
          <Button type="submit" leftIcon={<Save size={15} />} isLoading={isSaving} disabled={isLoading} className="w-full sm:w-auto">
            Save Changes
          </Button>
        </div>
      </form>
    </Page>
  )
}
