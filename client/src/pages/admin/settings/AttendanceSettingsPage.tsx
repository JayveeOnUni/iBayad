import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Clock3, Save } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import { FeedbackMessage, PageHeader } from '../../../components/ui/Page'
import { useToast } from '../../../components/ui/Toast'
import { settingsService } from '../../../services/settingsService'
import type { AttendanceSettings } from '../../../types'

type AttendanceSettingsForm = AttendanceSettings
type AttendanceSettingsField = keyof AttendanceSettingsForm
type PageMessage = { variant: 'info' | 'success' | 'warning' | 'danger'; text: string }

const defaultSettings: AttendanceSettingsForm = {
  graceMinutes: 5,
  halfDayMinutes: 240,
}

function extractServerFieldErrors(error: unknown): Partial<Record<AttendanceSettingsField, string>> {
  const details = (error as { details?: { errors?: Record<string, string[]> } } | null)?.details
  const serverErrors = details?.errors
  if (!serverErrors) return {}

  return Object.entries(serverErrors).reduce<Partial<Record<AttendanceSettingsField, string>>>((acc, [field, messages]) => {
    if (field in defaultSettings) {
      acc[field as AttendanceSettingsField] = messages[0]
    }
    return acc
  }, {})
}

export default function AttendanceSettingsPage() {
  const { showToast } = useToast()
  const [message, setMessage] = useState<PageMessage | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<AttendanceSettingsForm>({
    defaultValues: defaultSettings,
    mode: 'onBlur',
  })

  useEffect(() => {
    let isMounted = true

    settingsService.getAttendance()
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
          text: err instanceof Error ? err.message : 'Unable to load attendance settings.',
        })
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [reset])

  const onSubmit = async (data: AttendanceSettingsForm) => {
    setIsSaving(true)
    setMessage(null)

    try {
      const savedSettings = await settingsService.updateAttendance(data)
      reset({ ...defaultSettings, ...savedSettings })
      showToast({ variant: 'success', title: 'Attendance settings saved' })
    } catch (err) {
      const fieldErrors = extractServerFieldErrors(err)
      Object.entries(fieldErrors).forEach(([field, errorMessage]) => {
        setError(field as AttendanceSettingsField, { type: 'server', message: errorMessage })
      })
      setMessage({
        variant: 'danger',
        text: err instanceof Error ? err.message : 'Unable to save attendance settings.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const isFormDisabled = isLoading || isSaving

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Attendance Settings"
        subtitle="Configure tardiness and half-day rules used when attendance records are computed."
      />

      {message && <FeedbackMessage variant={message.variant}>{message.text}</FeedbackMessage>}
      {isLoading && <FeedbackMessage>Loading attendance settings...</FeedbackMessage>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Card>
          <div className="mb-5 flex items-center gap-2.5">
            <Clock3 size={18} className="text-muted" />
            <h3 className="text-sm font-semibold text-ink">Attendance Rules</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Grace Period (minutes)"
              type="number"
              min={0}
              max={240}
              disabled={isFormDisabled}
              {...register('graceMinutes', {
                valueAsNumber: true,
                required: 'Enter a grace period',
                min: { value: 0, message: 'Grace period cannot be negative' },
                max: { value: 240, message: 'Grace period must be 240 minutes or less' },
                validate: (value) => Number.isInteger(value) || 'Grace period must be a whole number',
              })}
              error={errors.graceMinutes?.message}
              hint="Late minutes start counting only after this allowance."
            />
            <Input
              label="Half-Day Threshold (minutes)"
              type="number"
              min={1}
              max={1440}
              disabled={isFormDisabled}
              {...register('halfDayMinutes', {
                valueAsNumber: true,
                required: 'Enter a half-day threshold',
                min: { value: 1, message: 'Half-day threshold must be at least 1 minute' },
                max: { value: 1440, message: 'Half-day threshold must be 1440 minutes or less' },
                validate: (value) => Number.isInteger(value) || 'Half-day threshold must be a whole number',
              })}
              error={errors.halfDayMinutes?.message}
              hint="Attendance is marked half day when rendered minutes fall below this value."
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
