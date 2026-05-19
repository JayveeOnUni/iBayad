import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Building2, CreditCard, Save } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import { FeedbackMessage, PageHeader } from '../../../components/ui/Page'
import { useToast } from '../../../components/ui/Toast'
import { settingsService } from '../../../services/settingsService'
import type { GeneralSettings } from '../../../types'

type GeneralSettingsForm = GeneralSettings
type PageMessage = { variant: 'info' | 'success' | 'warning' | 'danger'; text: string }
type GeneralSettingsField = keyof GeneralSettingsForm

const emptySettings: GeneralSettingsForm = {
  companyName: '',
  address: '',
  city: '',
  province: '',
  zipCode: '',
  phone: '',
  email: '',
  tin: '',
  sssEmployerNumber: '',
  philhealthEmployerNumber: '',
  pagibigEmployerNumber: '',
}

const maxLengths: Record<GeneralSettingsField, number> = {
  companyName: 150,
  address: 255,
  city: 100,
  province: 100,
  zipCode: 20,
  phone: 50,
  email: 150,
  tin: 50,
  sssEmployerNumber: 50,
  philhealthEmployerNumber: 50,
  pagibigEmployerNumber: 50,
}

function extractServerFieldErrors(error: unknown): Partial<Record<GeneralSettingsField, string>> {
  const details = (error as { details?: { errors?: Record<string, string[]> } } | null)?.details
  const serverErrors = details?.errors
  if (!serverErrors) return {}

  return Object.entries(serverErrors).reduce<Partial<Record<GeneralSettingsField, string>>>((acc, [field, messages]) => {
    if (field in emptySettings) {
      acc[field as GeneralSettingsField] = messages[0]
    }
    return acc
  }, {})
}

export default function GeneralSettingsPage() {
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
  } = useForm<GeneralSettingsForm>({
    defaultValues: emptySettings,
    mode: 'onBlur',
  })

  useEffect(() => {
    let isMounted = true

    settingsService.getGeneral()
      .then((settings) => {
        if (!isMounted) return
        reset({ ...emptySettings, ...settings })
        setMessage(null)
      })
      .catch((err) => {
        if (!isMounted) return
        reset(emptySettings)
        setMessage({
          variant: 'danger',
          text: err instanceof Error ? err.message : 'Unable to load general settings.',
        })
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [reset])

  const onSubmit = async (data: GeneralSettingsForm) => {
    const payload = Object.entries(data).reduce((acc, [field, value]) => ({
      ...acc,
      [field]: value.trim(),
    }), {} as GeneralSettingsForm)

    setIsSaving(true)
    setMessage(null)

    try {
      const savedSettings = await settingsService.updateGeneral(payload)
      reset({ ...emptySettings, ...savedSettings })
      showToast({ variant: 'success', title: 'General settings saved' })
    } catch (err) {
      const fieldErrors = extractServerFieldErrors(err)
      Object.entries(fieldErrors).forEach(([field, errorMessage]) => {
        setError(field as GeneralSettingsField, { type: 'server', message: errorMessage })
      })
      setMessage({
        variant: 'danger',
        text: err instanceof Error ? err.message : 'Unable to save general settings.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const isFormDisabled = isLoading || isSaving

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="General Settings"
        subtitle="Configure company information and government IDs."
      />

      {message && <FeedbackMessage variant={message.variant}>{message.text}</FeedbackMessage>}
      {isLoading && <FeedbackMessage>Loading general settings...</FeedbackMessage>}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Card>
          <div className="mb-5 flex items-center gap-2.5">
            <Building2 size={18} className="text-muted" />
            <h3 className="text-sm font-semibold text-ink">Company Information</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Company Name"
                required
                disabled={isFormDisabled}
                maxLength={maxLengths.companyName}
                {...register('companyName', {
                  required: 'Company name is required',
                  maxLength: { value: maxLengths.companyName, message: 'Company name must be 150 characters or fewer' },
                })}
                error={errors.companyName?.message}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label="Address"
                required
                disabled={isFormDisabled}
                maxLength={maxLengths.address}
                {...register('address', {
                  required: 'Address is required',
                  maxLength: { value: maxLengths.address, message: 'Address must be 255 characters or fewer' },
                })}
                error={errors.address?.message}
              />
            </div>
            <Input
              label="City"
              disabled={isFormDisabled}
              maxLength={maxLengths.city}
              {...register('city', {
                maxLength: { value: maxLengths.city, message: 'City must be 100 characters or fewer' },
              })}
              error={errors.city?.message}
            />
            <Input
              label="Province"
              disabled={isFormDisabled}
              maxLength={maxLengths.province}
              {...register('province', {
                maxLength: { value: maxLengths.province, message: 'Province must be 100 characters or fewer' },
              })}
              error={errors.province?.message}
            />
            <Input
              label="ZIP Code"
              disabled={isFormDisabled}
              maxLength={maxLengths.zipCode}
              {...register('zipCode', {
                maxLength: { value: maxLengths.zipCode, message: 'ZIP code must be 20 characters or fewer' },
              })}
              error={errors.zipCode?.message}
            />
            <Input
              label="Phone"
              type="tel"
              disabled={isFormDisabled}
              maxLength={maxLengths.phone}
              {...register('phone', {
                maxLength: { value: maxLengths.phone, message: 'Phone must be 50 characters or fewer' },
              })}
              error={errors.phone?.message}
            />
            <div className="sm:col-span-2">
              <Input
                label="HR Email"
                type="email"
                disabled={isFormDisabled}
                maxLength={maxLengths.email}
                {...register('email', {
                  maxLength: { value: maxLengths.email, message: 'Email must be 150 characters or fewer' },
                  pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address' },
                })}
                error={errors.email?.message}
              />
            </div>
          </div>
        </Card>

        <Card>
          <div className="mb-5 flex items-center gap-2.5">
            <CreditCard size={18} className="text-muted" />
            <h3 className="text-sm font-semibold text-ink">Government Registration Numbers</h3>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="BIR TIN"
              placeholder="123-456-789-000"
              disabled={isFormDisabled}
              maxLength={maxLengths.tin}
              {...register('tin', {
                maxLength: { value: maxLengths.tin, message: 'BIR TIN must be 50 characters or fewer' },
              })}
              error={errors.tin?.message}
            />
            <Input
              label="SSS Employer Number"
              placeholder="03-0000000-0"
              disabled={isFormDisabled}
              maxLength={maxLengths.sssEmployerNumber}
              {...register('sssEmployerNumber', {
                maxLength: { value: maxLengths.sssEmployerNumber, message: 'SSS employer number must be 50 characters or fewer' },
              })}
              error={errors.sssEmployerNumber?.message}
            />
            <Input
              label="PhilHealth Employer Number"
              placeholder="12-000000001-2"
              disabled={isFormDisabled}
              maxLength={maxLengths.philhealthEmployerNumber}
              {...register('philhealthEmployerNumber', {
                maxLength: { value: maxLengths.philhealthEmployerNumber, message: 'PhilHealth employer number must be 50 characters or fewer' },
              })}
              error={errors.philhealthEmployerNumber?.message}
            />
            <Input
              label="Pag-IBIG Employer ID"
              placeholder="XXXX-0000"
              disabled={isFormDisabled}
              maxLength={maxLengths.pagibigEmployerNumber}
              {...register('pagibigEmployerNumber', {
                maxLength: { value: maxLengths.pagibigEmployerNumber, message: 'Pag-IBIG employer ID must be 50 characters or fewer' },
              })}
              error={errors.pagibigEmployerNumber?.message}
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
