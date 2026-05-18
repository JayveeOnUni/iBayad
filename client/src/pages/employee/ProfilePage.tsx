import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { AlertCircle, BriefcaseBusiness, CreditCard, Lock, Save, User } from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Avatar from '../../components/ui/Avatar'
import Badge from '../../components/ui/Badge'
import { EmptyState, FeedbackMessage, PageHeader } from '../../components/ui/Page'
import { useAuthStore } from '../../store/authStore'
import { useAuth } from '../../hooks/useAuth'
import { employeeService } from '../../services/employeeService'
import type { Employee, ProfileUpdateChange, ProfileUpdateRequest } from '../../types'

interface ProfileFormValues {
  firstName: string
  middleName: string
  lastName: string
  email: string
  phone: string
  birthDate: string
  gender: string
  civilStatus: string
  address: string
  city: string
  province: string
  zipCode: string
}

interface PasswordFormValues {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

const emptyProfileForm: ProfileFormValues = {
  firstName: '',
  middleName: '',
  lastName: '',
  email: '',
  phone: '',
  birthDate: '',
  gender: '',
  civilStatus: '',
  address: '',
  city: '',
  province: '',
  zipCode: '',
}

const profileFieldLabels: Record<keyof ProfileFormValues, string> = {
  firstName: 'First Name',
  middleName: 'Middle Name',
  lastName: 'Last Name',
  email: 'Email Address',
  phone: 'Phone Number',
  birthDate: 'Birth Date',
  gender: 'Gender',
  civilStatus: 'Civil Status',
  address: 'Address',
  city: 'City',
  province: 'Province',
  zipCode: 'ZIP Code',
}

const profileFieldOrder = Object.keys(profileFieldLabels) as Array<keyof ProfileFormValues>

function profileFormValues(employee: Employee): ProfileFormValues {
  return {
    firstName: employee.firstName,
    middleName: employee.middleName ?? '',
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone ?? '',
    birthDate: employee.birthDate ? employee.birthDate.slice(0, 10) : '',
    gender: employee.gender,
    civilStatus: employee.civilStatus,
    address: employee.address,
    city: employee.city,
    province: employee.province,
    zipCode: employee.zipCode,
  }
}

function displayValue(value?: string | null) {
  return value && value.trim() ? value : 'Not provided'
}

function normalizeValue(value?: string | null) {
  return value?.trim() ?? ''
}

function displayProfileRequestValue(value?: string | null) {
  return displayValue(normalizeValue(value))
}

function formatDate(value?: string | null) {
  if (!value) return 'Not provided'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return displayValue(value)
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatLabel(value?: string | null) {
  if (!value) return 'Not provided'
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function maskIdentifier(value?: string | null) {
  const trimmed = value?.trim()
  if (!trimmed) return 'Not provided'

  const digits = trimmed.replace(/\D/g, '')
  const visible = (digits || trimmed).slice(-4)
  return `**** ${visible}`
}

function InfoItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-sm font-medium text-ink ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

const requestStatusVariant: Record<ProfileUpdateRequest['status'], 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
}

function changedFieldSummary(changes: Record<string, ProfileUpdateChange>) {
  const labels = Object.values(changes).map((change) => change.label)
  if (labels.length === 0) return 'No fields'
  if (labels.length <= 3) return labels.join(', ')
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`
}

export default function ProfilePage() {
  const { user } = useAuthStore()
  const { changePassword } = useAuth()
  const [profile, setProfile] = useState<Employee | null>(null)
  const [recentRequests, setRecentRequests] = useState<ProfileUpdateRequest[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; variant: 'info' | 'success' | 'danger' } | null>(null)
  const fullName = useMemo(() => {
    if (profile) return `${profile.firstName} ${profile.lastName}`.trim()
    return user ? `${user.firstName} ${user.lastName}`.trim() : ''
  }, [profile, user])

  const {
    register: registerPersonal,
    handleSubmit: handlePersonal,
    reset: resetPersonal,
  } = useForm<ProfileFormValues>({
    defaultValues: emptyProfileForm,
  })

  const {
    register: registerPassword,
    handleSubmit: handlePassword,
    reset: resetPassword,
    formState: { errors: passwordErrors },
  } = useForm<PasswordFormValues>({
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const loadProfile = useCallback(async () => {
    try {
      setIsLoading(true)
      setLoadError(null)
      const res = await employeeService.getMe()
      setProfile(res.data)
      resetPersonal(profileFormValues(res.data))
      try {
        const requestsRes = await employeeService.listMyProfileUpdateRequests()
        setRecentRequests(requestsRes.data)
      } catch {
        setRecentRequests([])
      }
    } catch (err) {
      setProfile(null)
      setLoadError(err instanceof Error ? err.message : 'Unable to load profile.')
    } finally {
      setIsLoading(false)
    }
  }, [resetPersonal])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const onSavePersonal = async (data: ProfileFormValues) => {
    if (!profile) return

    const currentValues = profileFormValues(profile)
    const changes = profileFieldOrder
      .map((field) => ({
        field,
        current: normalizeValue(currentValues[field]),
        requested: normalizeValue(data[field]),
      }))
      .filter(({ current, requested }) => current !== requested)

    if (changes.length === 0) {
      setMessage({ text: 'No profile changes to request.', variant: 'info' })
      return
    }

    try {
      setIsSubmittingRequest(true)
      setMessage(null)
      await employeeService.submitMyProfileUpdateRequest({ ...data })
      const requestsRes = await employeeService.listMyProfileUpdateRequests()
      setRecentRequests(requestsRes.data)
      resetPersonal(currentValues)
      setMessage({
        text: 'Profile update request submitted for HR review.',
        variant: 'success',
      })
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Unable to submit profile update request.',
        variant: 'danger',
      })
    } finally {
      setIsSubmittingRequest(false)
    }
  }

  const onChangePassword = async (data: PasswordFormValues) => {
    if (data.newPassword !== data.confirmPassword) {
      setMessage({ text: 'Passwords do not match.', variant: 'danger' })
      return
    }
    if (data.newPassword.length < 8) {
      setMessage({ text: 'Password must be at least 8 characters.', variant: 'danger' })
      return
    }

    const result = await changePassword(data.currentPassword, data.newPassword)
    if (result.ok) {
      setMessage({ text: 'Password changed successfully.', variant: 'success' })
      resetPassword()
    } else {
      setMessage({ text: result.error ?? 'Failed to change password.', variant: 'danger' })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-5 max-w-3xl">
        <PageHeader title="My Profile" subtitle="View and request updates to your personal information." />
        {[1, 2, 3, 4].map((item) => (
          <Card key={item} className="space-y-4">
            <div className="h-4 w-48 animate-pulse rounded bg-neutral-30" />
            <div className="h-20 animate-pulse rounded bg-neutral-30" />
          </Card>
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-5 max-w-3xl">
        <PageHeader title="My Profile" subtitle="View and request updates to your personal information." />
        <FeedbackMessage variant="danger" className="flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{loadError}</span>
        </FeedbackMessage>
        <EmptyState
          title="Unable to load profile."
          description="Please try again or contact HR if the issue continues."
          action={<Button size="sm" onClick={loadProfile}>Retry</Button>}
        />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="space-y-5 max-w-3xl">
        <PageHeader title="My Profile" subtitle="View and request updates to your personal information." />
        <EmptyState title="No employee profile found." description="Your employee record is not available yet." />
      </div>
    )
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader
        title="My Profile"
        subtitle="View and request updates to your personal information."
      />

      {message && (
        <FeedbackMessage variant={message.variant}>
          {message.text}
        </FeedbackMessage>
      )}

      {/* Profile header */}
      <Card>
        <div className="flex items-center gap-5">
          <Avatar src={profile.avatarUrl} name={fullName} size="xl" />
          <div>
            <h3 className="text-lg font-bold text-ink">{fullName}</h3>
            <p className="text-sm text-muted">{displayValue(profile.email)}</p>
            <p className="mt-0.5 text-xs text-neutral-60">
              {displayValue(profile.employeeNumber)} - {displayValue(profile.position?.title)}
            </p>
          </div>
        </div>
      </Card>

      {/* Employment info */}
      <Card>
        <div className="flex items-center gap-2.5 mb-5">
          <BriefcaseBusiness size={18} className="text-muted" />
          <h3 className="text-sm font-semibold text-ink">Employment Information</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <InfoItem label="Employee Number" value={displayValue(profile.employeeNumber)} mono />
          <InfoItem label="Department" value={displayValue(profile.department?.name)} />
          <InfoItem label="Position" value={displayValue(profile.position?.title)} />
          <InfoItem label="Employment Type" value={formatLabel(profile.employmentType)} />
          <InfoItem label="Employment Status" value={formatLabel(profile.employmentStatus)} />
          <InfoItem label="Hire Date" value={formatDate(profile.hireDate)} />
          <InfoItem label="Regularization Date" value={formatDate(profile.regularizationDate)} />
        </div>
      </Card>

      {/* Personal info */}
      <Card>
        <div className="flex items-center gap-2.5 mb-5">
          <User size={18} className="text-muted" />
          <h3 className="text-sm font-semibold text-ink">Personal Information</h3>
        </div>
        <p className="mb-4 rounded-lg border border-warning-border bg-warning-muted px-3 py-2 text-xs text-warning">
          Changes to personal information require HR approval. Submit a request and HR will review it.
        </p>
        <form onSubmit={handlePersonal(onSavePersonal)} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="First Name" {...registerPersonal('firstName')} />
            <Input label="Middle Name" {...registerPersonal('middleName')} />
            <Input label="Last Name" {...registerPersonal('lastName')} />
          </div>
          <Input label="Email Address" type="email" {...registerPersonal('email')} />
          <Input label="Phone Number" type="tel" {...registerPersonal('phone')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="Birth Date" type="date" {...registerPersonal('birthDate')} />
            <Input label="Gender" {...registerPersonal('gender')} />
            <Input label="Civil Status" {...registerPersonal('civilStatus')} />
          </div>
          <Input label="Address" {...registerPersonal('address')} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="City" {...registerPersonal('city')} />
            <Input label="Province" {...registerPersonal('province')} />
            <Input label="ZIP Code" {...registerPersonal('zipCode')} />
          </div>
          <div className="flex justify-end pt-2">
            <Button type="submit" size="sm" leftIcon={<Save size={14} />} isLoading={isSubmittingRequest}>
              Submit Update Request
            </Button>
          </div>
        </form>
      </Card>

      {/* Recent profile update requests */}
      <Card>
        <div className="flex items-center justify-between gap-3 mb-5">
          <div>
            <h3 className="text-sm font-semibold text-ink">Recent Profile Update Requests</h3>
            <p className="text-xs text-muted mt-0.5">Track requests submitted for HR review.</p>
          </div>
        </div>
        {recentRequests.length === 0 ? (
          <p className="text-sm text-muted">No profile update requests yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {recentRequests.map((request) => (
              <div key={request.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">{changedFieldSummary(request.requestedChanges)}</p>
                    <p className="text-xs text-muted">{formatDate(request.createdAt)}</p>
                  </div>
                  <Badge variant={requestStatusVariant[request.status]} dot>
                    {request.status}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Object.values(request.requestedChanges).slice(0, 4).map((change) => (
                    <div key={change.field} className="rounded-md border border-border bg-neutral-20 px-3 py-2">
                      <p className="text-xs font-medium text-ink">{change.label}</p>
                      <p className="text-xs text-muted">
                        {displayProfileRequestValue(change.current)} to {displayProfileRequestValue(change.requested)}
                      </p>
                    </div>
                  ))}
                </div>
                {request.reviewRemarks && (
                  <p className="mt-2 text-xs text-muted">HR remarks: {request.reviewRemarks}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Change password */}
      <Card>
        <div className="flex items-center gap-2.5 mb-5">
          <Lock size={18} className="text-muted" />
          <h3 className="text-sm font-semibold text-ink">Change Password</h3>
        </div>
        <form onSubmit={handlePassword(onChangePassword)} className="space-y-4">
          <Input label="Current Password" type="password" {...registerPassword('currentPassword')} required />
          <Input
            label="New Password"
            type="password"
            hint="Minimum 8 characters"
            error={passwordErrors.newPassword?.message}
            {...registerPassword('newPassword', {
              minLength: { value: 8, message: 'Password must be at least 8 characters.' },
            })}
            required
          />
          <Input label="Confirm New Password" type="password" {...registerPassword('confirmPassword')} required />
          <div className="flex justify-end pt-2">
            <Button type="submit" size="sm" leftIcon={<Lock size={14} />}>
              Update Password
            </Button>
          </div>
        </form>
      </Card>

      {/* Government IDs (view-only) */}
      <Card>
        <div className="flex items-center gap-2.5 mb-5">
          <CreditCard size={18} className="text-muted" />
          <h3 className="text-sm font-semibold text-ink">Government IDs (View Only)</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[
            { label: 'SSS Number', value: maskIdentifier(profile.sssNumber) },
            { label: 'PhilHealth No.', value: maskIdentifier(profile.philhealthNumber) },
            { label: 'Pag-IBIG No.', value: maskIdentifier(profile.pagibigNumber) },
            { label: 'TIN', value: maskIdentifier(profile.tinNumber) },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-xs text-muted">{item.label}</p>
              <p className="text-sm font-medium text-ink font-mono">{item.value}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted mt-4">
          To update government IDs, please contact HR directly.
        </p>
      </Card>
    </div>
  )
}
