import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Clock, Info, Save, WalletCards } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import { FeedbackMessage, PageHeader } from '../../../components/ui/Page'
import { useToast } from '../../../components/ui/Toast'
import { settingsService } from '../../../services/settingsService'
import type { PayrollSettings } from '../../../types'

type PayrollSettingsForm = PayrollSettings
type PayrollSettingsField = keyof PayrollSettingsForm
type PageMessage = { variant: 'info' | 'success' | 'warning' | 'danger'; text: string }

const defaultSettings: PayrollSettingsForm = {
  payFrequency: 'semi-monthly',
  semiMonthlyCutoff1: 15,
  semiMonthlyCutoff2: 31,
  semiMonthlyPayDay1: 20,
  semiMonthlyPayDay2: 5,
  workingHoursPerDay: 8,
  workingDaysPerWeek: 5,
  workDaysPerMonth: 22,
  offsetCreditEnabled: true,
  offsetRequiresApproval: true,
  minimumOffsetCreditMinutes: 1,
  nightDifferentialEnabled: false,
  regularHolidayRate: 2.0,
  specialHolidayRate: 1.3,
  thirteenthMonthEnabled: true,
}

function extractServerFieldErrors(error: unknown): Partial<Record<PayrollSettingsField, string>> {
  const details = (error as { details?: { errors?: Record<string, string[]> } } | null)?.details
  const serverErrors = details?.errors
  if (!serverErrors) return {}

  return Object.entries(serverErrors).reduce<Partial<Record<PayrollSettingsField, string>>>((acc, [field, messages]) => {
    if (field in defaultSettings) {
      acc[field as PayrollSettingsField] = messages[0]
    }
    return acc
  }, {})
}

const wholeDayValidation = {
  valueAsNumber: true,
  required: 'Enter a day from 1 to 31',
  min: { value: 1, message: 'Day must be at least 1' },
  max: { value: 31, message: 'Day must be 31 or less' },
  validate: (value: number) => Number.isInteger(value) || 'Day must be a whole number',
}

export default function PayrollSettingsPage() {
  const { showToast } = useToast()
  const [message, setMessage] = useState<PageMessage | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const {
    register,
    handleSubmit,
    reset,
    setError,
    getValues,
    formState: { errors },
  } = useForm<PayrollSettingsForm>({
    defaultValues: defaultSettings,
    mode: 'onBlur',
  })

  useEffect(() => {
    let isMounted = true

    settingsService.getPayroll()
      .then((settings) => {
        if (!isMounted) return
        reset({ ...defaultSettings, ...settings })
        setMessage(null)
      })
      .catch((err) => {
        if (!isMounted) return
        reset(defaultSettings)
        setMessage({
          variant: 'danger',
          text: err instanceof Error ? err.message : 'Unable to load payroll settings.',
        })
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [reset])

  const onSubmit = async (data: PayrollSettingsForm) => {
    setIsSaving(true)
    setMessage(null)

    try {
      const savedSettings = await settingsService.updatePayroll(data)
      reset({ ...defaultSettings, ...savedSettings })
      showToast({ variant: 'success', title: 'Payroll settings saved' })
    } catch (err) {
      const fieldErrors = extractServerFieldErrors(err)
      Object.entries(fieldErrors).forEach(([field, errorMessage]) => {
        setError(field as PayrollSettingsField, { type: 'server', message: errorMessage })
      })
      setMessage({
        variant: 'danger',
        text: err instanceof Error ? err.message : 'Unable to save payroll settings.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const isFormDisabled = isLoading || isSaving

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Payroll Settings"
        subtitle="Configure pay schedule defaults, attendance policy controls, and payroll rate multipliers."
      />

      {message && <FeedbackMessage variant={message.variant}>{message.text}</FeedbackMessage>}
      {isLoading && <FeedbackMessage>Loading payroll settings...</FeedbackMessage>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Card>
          <div className="mb-5 flex items-center gap-2.5">
            <WalletCards size={18} className="text-muted" />
            <h3 className="text-sm font-semibold text-ink">Pay Schedule</h3>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select label="Pay Frequency" disabled={isFormDisabled} error={errors.payFrequency?.message} {...register('payFrequency')}>
              <option value="weekly">Weekly</option>
              <option value="semi-monthly">Semi-Monthly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </div>

          <div className="mt-4 rounded-lg bg-blue-50 p-4">
            <div className="flex gap-2">
              <Info size={15} className="mt-0.5 flex-shrink-0 text-brand" />
              <p className="text-xs text-brand">
                Semi-monthly cutoffs determine which attendance, offset, and deduction records are included in each payroll period.
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">1st Period</p>
              <Input
                label="Cutoff Day"
                type="number"
                min={1}
                max={31}
                disabled={isFormDisabled}
                {...register('semiMonthlyCutoff1', {
                  ...wholeDayValidation,
                  validate: (value) => {
                    if (!Number.isInteger(value)) return 'Day must be a whole number'
                    return value < getValues('semiMonthlyCutoff2') || 'First cutoff must be less than second cutoff'
                  },
                })}
                error={errors.semiMonthlyCutoff1?.message}
                hint="Day of month, for example 15"
              />
              <Input
                label="Pay Day"
                type="number"
                min={1}
                max={31}
                disabled={isFormDisabled}
                {...register('semiMonthlyPayDay1', wholeDayValidation)}
                error={errors.semiMonthlyPayDay1?.message}
                hint="Day of month, for example 20"
              />
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">2nd Period</p>
              <Input
                label="Cutoff Day"
                type="number"
                min={1}
                max={31}
                disabled={isFormDisabled}
                {...register('semiMonthlyCutoff2', {
                  ...wholeDayValidation,
                  validate: (value) => {
                    if (!Number.isInteger(value)) return 'Day must be a whole number'
                    return value > getValues('semiMonthlyCutoff1') || 'Second cutoff must be greater than first cutoff'
                  },
                })}
                error={errors.semiMonthlyCutoff2?.message}
                hint="Use 31 for end of month"
              />
              <Input
                label="Pay Day"
                type="number"
                min={1}
                max={31}
                disabled={isFormDisabled}
                {...register('semiMonthlyPayDay2', wholeDayValidation)}
                error={errors.semiMonthlyPayDay2?.message}
                hint="Day of month, for example 5"
              />
            </div>
          </div>
        </Card>

        <Card>
          <div className="mb-5 flex items-center gap-2.5">
            <Clock size={18} className="text-muted" />
            <h3 className="text-sm font-semibold text-ink">Working Time Defaults</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Hours / Day"
              type="number"
              step="0.25"
              min={0.25}
              max={24}
              disabled={isFormDisabled}
              {...register('workingHoursPerDay', {
                valueAsNumber: true,
                required: 'Enter working hours per day',
                min: { value: 0.01, message: 'Hours must be greater than 0' },
                max: { value: 24, message: 'Hours must be 24 or less' },
              })}
              error={errors.workingHoursPerDay?.message}
            />
            <Input
              label="Days / Week"
              type="number"
              min={1}
              max={7}
              disabled={isFormDisabled}
              {...register('workingDaysPerWeek', {
                valueAsNumber: true,
                required: 'Enter working days per week',
                min: { value: 1, message: 'Days per week must be at least 1' },
                max: { value: 7, message: 'Days per week must be 7 or less' },
                validate: (value) => Number.isInteger(value) || 'Days per week must be a whole number',
              })}
              error={errors.workingDaysPerWeek?.message}
            />
            <Input
              label="Days / Month"
              type="number"
              min={1}
              max={31}
              disabled={isFormDisabled}
              {...register('workDaysPerMonth', {
                valueAsNumber: true,
                required: 'Enter work days per month',
                min: { value: 1, message: 'Days per month must be at least 1' },
                max: { value: 31, message: 'Days per month must be 31 or less' },
                validate: (value) => Number.isInteger(value) || 'Days per month must be a whole number',
              })}
              error={errors.workDaysPerMonth?.message}
            />
          </div>
        </Card>

        <Card>
          <h3 className="mb-5 text-sm font-semibold text-ink">Payroll Treatment</h3>
          <div className="mb-5 space-y-4">
            {[
              { key: 'offsetCreditEnabled' as const, label: 'Enable Offset Credits', desc: 'Excess attendance minutes are tracked as offset credits.' },
              { key: 'offsetRequiresApproval' as const, label: 'Require Offset Approval', desc: 'Credits and usage need admin approval before they affect balances.' },
              { key: 'nightDifferentialEnabled' as const, label: 'Enable Night Differential', desc: 'Payroll uses recorded night differential hours when available.' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
                <div>
                  <p className="text-sm font-medium text-ink">{item.label}</p>
                  <p className="text-xs text-muted">{item.desc}</p>
                </div>
                <input type="checkbox" disabled={isFormDisabled} {...register(item.key)} className="h-5 w-5 accent-brand disabled:opacity-50" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Minimum Offset Minutes"
              type="number"
              min={0}
              disabled={isFormDisabled}
              {...register('minimumOffsetCreditMinutes', {
                valueAsNumber: true,
                required: 'Enter minimum offset minutes',
                min: { value: 0, message: 'Minimum minutes cannot be negative' },
                validate: (value) => Number.isInteger(value) || 'Minimum minutes must be a whole number',
              })}
              error={errors.minimumOffsetCreditMinutes?.message}
            />
            <Input
              label="Regular Holiday Rate"
              type="number"
              step="0.01"
              min={0.01}
              disabled={isFormDisabled}
              {...register('regularHolidayRate', {
                valueAsNumber: true,
                required: 'Enter regular holiday rate',
                min: { value: 0.01, message: 'Regular holiday rate must be positive' },
              })}
              error={errors.regularHolidayRate?.message}
              hint="2.00 = 200%"
            />
            <Input
              label="Special Holiday Rate"
              type="number"
              step="0.01"
              min={0.01}
              disabled={isFormDisabled}
              {...register('specialHolidayRate', {
                valueAsNumber: true,
                required: 'Enter special holiday rate',
                min: { value: 0.01, message: 'Special holiday rate must be positive' },
              })}
              error={errors.specialHolidayRate?.message}
              hint="1.30 = 130%"
            />
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-ink">13th Month Pay</h3>
              <p className="mt-0.5 text-xs text-muted">Persist the policy toggle for future payroll workflows.</p>
            </div>
            <input
              type="checkbox"
              disabled={isFormDisabled}
              {...register('thirteenthMonthEnabled')}
              className="h-5 w-5 accent-brand disabled:opacity-50"
            />
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
