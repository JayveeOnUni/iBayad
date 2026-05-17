import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Save } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import Badge from '../../../components/ui/Badge'
import { FeedbackMessage, PageHeader } from '../../../components/ui/Page'
import { settingsService } from '../../../services/settingsService'
import type { LeavePolicyConfig, LeaveSettings, LeaveTypeConfig } from '../../../types'

type PageMessage = { variant: 'info' | 'success' | 'warning' | 'danger'; text: string }
type FieldErrors = Record<string, string>
type LeaveTypeField = keyof LeaveTypeConfig
type LeavePolicyField = keyof LeavePolicyConfig

const emptySettings: LeaveSettings = {
  leaveTypes: [],
  policies: [],
  globalSettings: {},
  clarificationItems: [],
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
    if (leaveType.filingDeadlineDays != null && leaveType.filingDeadlineDays < 0) {
      errors[`${prefix}.filingDeadlineDays`] = 'Filing deadline cannot be negative'
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
  checked,
  disabled,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-muted">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 flex-shrink-0 accent-brand disabled:opacity-50"
      />
    </label>
  )
}

export default function LeaveSettingsPage() {
  const [settings, setSettings] = useState<LeaveSettings>(emptySettings)
  const [message, setMessage] = useState<PageMessage | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

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

  const policiesByLeaveType = useMemo(() => settings.policies.reduce<Record<string, LeavePolicyConfig[]>>((acc, policy) => {
    acc[policy.leaveTypeId] = [...(acc[policy.leaveTypeId] ?? []), policy]
    return acc
  }, {}), [settings.policies])

  const isFormDisabled = isLoading || isSaving

  const updateLeaveType = <K extends LeaveTypeField>(id: string, field: K, value: LeaveTypeConfig[K]) => {
    setSettings((current) => ({
      ...current,
      leaveTypes: current.leaveTypes.map((item) => (
        item.id === id ? { ...item, [field]: value } : item
      )),
    }))
  }

  const updatePolicy = <K extends LeavePolicyField>(id: string, field: K, value: LeavePolicyConfig[K]) => {
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
      setMessage({ variant: 'danger', text: 'Please correct the highlighted leave settings.' })
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
      setMessage({ variant: 'success', text: 'Leave settings saved.' })
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
    const disabled = isFormDisabled || Boolean(leaveType.isProtected)

    return (
      <Card key={leaveType.id} className="shadow-none">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-ink">{leaveType.name}</h4>
              <Badge variant={leaveType.isActive === false ? 'neutral' : 'success'}>{leaveType.isActive === false ? 'Inactive' : 'Active'}</Badge>
              {leaveType.isProtected && <Badge variant="warning">Protected</Badge>}
            </div>
            {leaveType.policyNotes && <p className="mt-1 text-xs leading-5 text-muted">{leaveType.policyNotes}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4 sm:grid-cols-2">
          <Input
            label="Name"
            value={leaveType.name}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'name', event.target.value)}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'name')]}
          />
          <Input
            label="Code"
            value={leaveType.code}
            disabled
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'code')]}
            hint="Stable backend code"
          />
          <Input
            label="Days / Year"
            type="number"
            step="0.01"
            min={0}
            value={leaveType.daysPerYear ?? 0}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'daysPerYear', parseRequiredNumber(event.target.value))}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'daysPerYear')]}
          />
          <Select
            label="Day Count"
            value={leaveType.dayCountType}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'dayCountType', event.target.value as LeaveTypeConfig['dayCountType'])}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'dayCountType')]}
          >
            <option value="working_days">Working days</option>
            <option value="calendar_days">Calendar days</option>
          </Select>
          <Input
            label="Max / Request"
            type="number"
            step="0.01"
            min={0.01}
            value={optionalNumberValue(leaveType.maxDaysPerRequest)}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'maxDaysPerRequest', parseOptionalNumber(event.target.value))}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'maxDaysPerRequest')]}
          />
          <Input
            label="Filing Deadline"
            type="number"
            min={0}
            value={optionalNumberValue(leaveType.filingDeadlineDays)}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'filingDeadlineDays', parseOptionalNumber(event.target.value))}
            error={fieldErrors[fieldErrorKey('leaveTypes', leaveType.id, 'filingDeadlineDays')]}
            hint="Days before start"
          />
          <Input
            label="Deadline Type"
            value={leaveType.filingDeadlineType ?? ''}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'filingDeadlineType', event.target.value || undefined)}
          />
          <Input
            label="Document Rule"
            value={leaveType.documentRule ?? ''}
            disabled={disabled}
            onChange={(event) => updateLeaveType(leaveType.id, 'documentRule', event.target.value || undefined)}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-x-6 lg:grid-cols-2">
          <div>
            <ToggleRow label="Paid" description="Approved leave is paid when payroll impact is calculated." checked={leaveType.isPaid} disabled={disabled} onChange={(checked) => updateLeaveType(leaveType.id, 'isPaid', checked)} />
            <ToggleRow label="Accrual Based" description="Balances are earned monthly from policy rows." checked={leaveType.isAccrualBased} disabled={disabled} onChange={(checked) => updateLeaveType(leaveType.id, 'isAccrualBased', checked)} />
            <ToggleRow label="Requires Balance" description="Requests consume tracked leave balances." checked={leaveType.requiresBalance} disabled={disabled} onChange={(checked) => updateLeaveType(leaveType.id, 'requiresBalance', checked)} />
            <ToggleRow label="Requires Document" description="Application workflow expects supporting documents." checked={leaveType.requiresDocument} disabled={disabled} onChange={(checked) => updateLeaveType(leaveType.id, 'requiresDocument', checked)} />
          </div>
          <div>
            <ToggleRow label="Probationary Applies" description="Probationary employees can select this leave type." checked={leaveType.appliesToProbationary} disabled={disabled} onChange={(checked) => updateLeaveType(leaveType.id, 'appliesToProbationary', checked)} />
            <ToggleRow label="Regular Applies" description="Regular employees can select this leave type." checked={leaveType.appliesToRegular} disabled={disabled} onChange={(checked) => updateLeaveType(leaveType.id, 'appliesToRegular', checked)} />
            <ToggleRow label="Cash Convertible" description="Unused balances can be converted if policy limits allow it." checked={leaveType.isCashConvertible} disabled={disabled} onChange={(checked) => updateLeaveType(leaveType.id, 'isCashConvertible', checked)} />
            <ToggleRow label="Carry Over Allowed" description="Year-end processing can carry remaining credits forward." checked={leaveType.isCarryOverAllowed} disabled={disabled} onChange={(checked) => updateLeaveType(leaveType.id, 'isCarryOverAllowed', checked)} />
          </div>
        </div>
      </Card>
    )
  }

  const renderPolicy = (policy: LeavePolicyConfig) => {
    const disabled = isFormDisabled || Boolean(policy.isProtected)
    const prefix = `policies.${policy.id}`

    return (
      <div key={policy.id} className="grid grid-cols-1 gap-3 border-b border-border py-4 last:border-0 lg:grid-cols-6">
        <div className="lg:col-span-1">
          <p className="text-sm font-medium text-ink">{policy.employmentStatus.replace(/_/g, ' ')}</p>
          <p className="text-xs text-muted">Effective {policy.effectiveDate}</p>
          {policy.isProtected && <Badge variant="warning" className="mt-2">Protected</Badge>}
        </div>
        <Input
          label="Entitlement"
          type="number"
          step="0.01"
          min={0}
          value={policy.entitlementDays}
          disabled={disabled}
          onChange={(event) => updatePolicy(policy.id, 'entitlementDays', parseRequiredNumber(event.target.value))}
          error={fieldErrors[`${prefix}.entitlementDays`]}
        />
        <Input
          label="Monthly Credit"
          type="number"
          step="0.01"
          min={0}
          value={policy.monthlyCredit}
          disabled={disabled}
          onChange={(event) => updatePolicy(policy.id, 'monthlyCredit', parseRequiredNumber(event.target.value))}
          error={fieldErrors[`${prefix}.monthlyCredit`]}
        />
        <Input
          label="Carry Over"
          type="number"
          step="0.01"
          min={0}
          value={optionalNumberValue(policy.carryOverLimit)}
          disabled={disabled}
          onChange={(event) => updatePolicy(policy.id, 'carryOverLimit', parseOptionalNumber(event.target.value))}
          error={fieldErrors[`${prefix}.carryOverLimit`]}
        />
        <Input
          label="Cash Conversion"
          type="number"
          step="0.01"
          min={0}
          value={optionalNumberValue(policy.cashConversionLimit)}
          disabled={disabled}
          onChange={(event) => updatePolicy(policy.id, 'cashConversionLimit', parseOptionalNumber(event.target.value))}
          error={fieldErrors[`${prefix}.cashConversionLimit`]}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-6">
          <Input
            label="Forfeiture Rule"
            value={policy.forfeitureRule ?? ''}
            disabled={disabled}
            onChange={(event) => updatePolicy(policy.id, 'forfeitureRule', event.target.value || null)}
          />
          <Input
            label="Notes"
            value={policy.notes ?? ''}
            disabled={disabled}
            onChange={(event) => updatePolicy(policy.id, 'notes', event.target.value || null)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader
        title="Leave Settings"
        subtitle="Configure leave types and policy rows used by leave balances, filing validation, carry-over, and cash conversion."
      />

      {message && <FeedbackMessage variant={message.variant}>{message.text}</FeedbackMessage>}
      {isLoading && <FeedbackMessage>Loading leave settings...</FeedbackMessage>}
      {settings.clarificationItems.length > 0 && (
        <FeedbackMessage variant="warning">
          <span className="font-medium">Policy clarifications:</span> {settings.clarificationItems.join(' ')}
        </FeedbackMessage>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-ink">Accrual-Based Leaves</h3>
          <div className="space-y-4">
            {groupedLeaveTypes.accrual.map(renderLeaveType)}
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold text-ink">Non-Accrual Company Leaves</h3>
          <div className="space-y-4">
            {groupedLeaveTypes.company.map(renderLeaveType)}
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold text-ink">Statutory / Protected Leaves</h3>
          <div className="space-y-4">
            {groupedLeaveTypes.statutory.map(renderLeaveType)}
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold text-ink">Policy Entitlements & Limits</h3>
          <div className="space-y-6">
            {settings.leaveTypes.map((leaveType) => {
              const policies = policiesByLeaveType[leaveType.id] ?? []
              if (policies.length === 0) return null

              return (
                <div key={leaveType.id}>
                  <div className="mb-1 flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-ink">{leaveType.name}</h4>
                    <Badge variant={leaveType.isStatutory ? 'warning' : 'info'}>{leaveType.code}</Badge>
                  </div>
                  <div>{policies.map(renderPolicy)}</div>
                </div>
              )
            })}
          </div>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" leftIcon={<Save size={15} />} isLoading={isSaving} disabled={isLoading}>
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  )
}
