import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Calendar, Edit2, Loader2, MapPin, Plus, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Table from '../../../components/ui/Table'
import Badge from '../../../components/ui/Badge'
import Modal, { ConfirmModal } from '../../../components/ui/Modal'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import { EmptyState, FeedbackMessage } from '../../../components/ui/Page'
import { useToast } from '../../../components/ui/Toast'
import { holidayService, type HolidayPayload } from '../../../services/holidayService'
import { formatDate } from '../../../utils/dateHelpers'
import type { Holiday, HolidayType } from '../../../types'

interface HolidayForm {
  name: string
  holidayDate: string
  holidayType: HolidayType
  isRecurring: boolean
  country: string
  cityOrProvince: string
  isWorkingHoliday: boolean
  source: string
}

type HolidayFormErrors = Partial<Record<keyof HolidayForm, string>>
type PageMessage = { variant: 'info' | 'success' | 'warning' | 'danger'; text: string }
type ActionTone = 'neutral' | 'danger'

interface HolidayActionButtonProps {
  label: string
  icon: ReactNode
  tone?: ActionTone
  isLoading?: boolean
  onClick: () => void
}

const typeVariant: Record<HolidayType, 'danger' | 'warning' | 'info'> = {
  regular: 'danger',
  special_non_working: 'warning',
  special_working: 'info',
}

const typeLabel: Record<HolidayType, string> = {
  regular: 'Regular Holiday',
  special_non_working: 'Special Non-Working',
  special_working: 'Special Working',
}

const actionToneClasses: Record<ActionTone, string> = {
  neutral: 'text-neutral-70 hover:bg-white hover:text-ink hover:shadow-sm focus-visible:ring-brand-200',
  danger: 'text-danger hover:bg-danger-muted hover:text-danger-hover focus-visible:ring-danger-border',
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/

function defaultFormForYear(year: number): HolidayForm {
  return {
    name: '',
    holidayDate: `${year}-01-01`,
    holidayType: 'regular',
    isRecurring: true,
    country: 'Philippines',
    cityOrProvince: '',
    isWorkingHoliday: false,
    source: 'Manual',
  }
}

function getHolidayYear(holiday: Pick<Holiday, 'date'>): number {
  return Number(holiday.date.slice(0, 4))
}

function isValidDateString(value: string): boolean {
  if (!datePattern.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && value === date.toISOString().slice(0, 10)
}

function HolidayActionButton({
  label,
  icon,
  tone = 'neutral',
  isLoading = false,
  onClick,
}: HolidayActionButtonProps) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={isLoading}
        onClick={onClick}
        className={[
          'inline-flex h-8 w-8 items-center justify-center rounded-md',
          'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-60',
          actionToneClasses[tone],
        ].join(' ')}
      >
        {isLoading ? <Loader2 className="animate-spin" size={15} /> : icon}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {label}
      </span>
    </span>
  )
}

function validateHolidayForm(form: HolidayForm): { payload?: HolidayPayload; errors: HolidayFormErrors } {
  const errors: HolidayFormErrors = {}
  const name = form.name.trim()
  const country = form.country.trim() || 'Philippines'
  const cityOrProvince = form.cityOrProvince.trim()
  const source = form.source.trim()
  const isWorkingHoliday = form.holidayType === 'special_working'

  if (!name) errors.name = 'Holiday name is required'
  if (name.length > 100) errors.name = 'Holiday name must be 100 characters or fewer'
  if (!form.holidayDate) errors.holidayDate = 'Holiday date is required'
  if (form.holidayDate && !isValidDateString(form.holidayDate)) {
    errors.holidayDate = 'Holiday date must be valid'
  }
  if (country.length > 80) errors.country = 'Country must be 80 characters or fewer'
  if (cityOrProvince.length > 120) errors.cityOrProvince = 'City or province must be 120 characters or fewer'

  if (Object.keys(errors).length > 0) return { errors }

  return {
    errors,
    payload: {
      name,
      date: form.holidayDate,
      holidayDate: form.holidayDate,
      type: form.holidayType,
      holidayType: form.holidayType,
      isRecurring: form.isRecurring,
      country,
      cityOrProvince: cityOrProvince || null,
      isWorkingHoliday,
      source: source || null,
    },
  }
}

function sortHolidays(items: Holiday[]): Holiday[] {
  return [...items].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date)
    return dateCompare !== 0 ? dateCompare : a.name.localeCompare(b.name)
  })
}

export default function HolidaysPage() {
  const { showToast } = useToast()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingHoliday, setEditingHoliday] = useState<Holiday | null>(null)
  const [form, setForm] = useState<HolidayForm>(() => defaultFormForYear(currentYear))
  const [fieldErrors, setFieldErrors] = useState<HolidayFormErrors>({})
  const [message, setMessage] = useState<PageMessage | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [holidayPendingDelete, setHolidayPendingDelete] = useState<Holiday | null>(null)
  const [deletingHolidayId, setDeletingHolidayId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    setIsLoading(true)

    holidayService.getAll(year)
      .then((data) => {
        if (!isMounted) return
        setHolidays(sortHolidays(data))
        setMessage(null)
      })
      .catch((err) => {
        if (!isMounted) return
        setHolidays([])
        setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to load holidays.' })
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [year])

  const yearOptions = useMemo(
    () => {
      const options = Array.from({ length: 7 }, (_, index) => currentYear - 3 + index)
      return options.includes(year) ? options : [...options, year].sort((a, b) => a - b)
    },
    [currentYear, year]
  )

  const selectedYearHolidays = holidays.filter((holiday) => getHolidayYear(holiday) === year)

  const openHolidayModal = (holiday?: Holiday) => {
    setEditingHoliday(holiday ?? null)
    setFieldErrors({})
    setForm(holiday
      ? {
          name: holiday.name,
          holidayDate: holiday.holidayDate ?? holiday.date,
          holidayType: holiday.holidayType ?? holiday.type,
          isRecurring: holiday.isRecurring,
          country: holiday.country ?? 'Philippines',
          cityOrProvince: holiday.cityOrProvince ?? '',
          isWorkingHoliday: holiday.isWorkingHoliday,
          source: holiday.source ?? '',
        }
      : defaultFormForYear(year)
    )
    setIsModalOpen(true)
  }

  const saveHoliday = async () => {
    const { payload, errors } = validateHolidayForm(form)
    setFieldErrors(errors)
    if (!payload) return

    setIsSaving(true)
    setMessage(null)

    try {
      const savedHoliday = editingHoliday
        ? await holidayService.update(editingHoliday.id, payload)
        : await holidayService.create(payload)

      const savedYear = getHolidayYear(savedHoliday)
      if (savedYear !== year) {
        setYear(savedYear)
      } else {
        setHolidays((current) =>
          sortHolidays(
            editingHoliday
              ? current.map((item) => item.id === savedHoliday.id ? savedHoliday : item)
              : [savedHoliday, ...current]
          )
        )
      }

      showToast({ variant: 'success', title: editingHoliday ? 'Holiday updated' : 'Holiday created' })
      setIsModalOpen(false)
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to save holiday.' })
    } finally {
      setIsSaving(false)
    }
  }

  const openDeleteModal = (holiday: Holiday) => {
    setHolidayPendingDelete(holiday)
    setMessage(null)
  }

  const deleteHoliday = async () => {
    if (!holidayPendingDelete) return

    setDeletingHolidayId(holidayPendingDelete.id)
    setMessage(null)

    try {
      const result = await holidayService.delete(holidayPendingDelete.id)
      setHolidays((current) => current.filter((item) => item.id !== result.deletedHolidayId))
      showToast({ variant: 'success', title: 'Holiday deleted' })
      setHolidayPendingDelete(null)
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to delete holiday.' })
      setHolidayPendingDelete(null)
    } finally {
      setDeletingHolidayId(null)
    }
  }

  const updateHolidayType = (holidayType: HolidayType) => {
    setForm((current) => ({
      ...current,
      holidayType,
      isWorkingHoliday: holidayType === 'special_working',
    }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Holidays</h2>
          <p className="mt-0.5 text-sm text-muted">Manage official and special holidays affecting payroll</p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            aria-label="Holiday year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="min-w-24"
          >
            {yearOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => openHolidayModal()}>
            Add Holiday
          </Button>
        </div>
      </div>

      {message && <FeedbackMessage variant={message.variant}>{message.text}</FeedbackMessage>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Regular Holidays', count: selectedYearHolidays.filter((h) => h.type === 'regular').length, variant: 'danger' as const },
          { label: 'Special Non-Working', count: selectedYearHolidays.filter((h) => h.type === 'special_non_working').length, variant: 'warning' as const },
          { label: 'Special Working', count: selectedYearHolidays.filter((h) => h.type === 'special_working').length, variant: 'info' as const },
        ].map((summary) => (
          <Card key={summary.label} className="text-center">
            <p className="text-2xl font-bold text-ink">{summary.count}</p>
            <p className="mt-1 text-xs text-muted">{summary.label}</p>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <FeedbackMessage>Loading holidays...</FeedbackMessage>
      ) : selectedYearHolidays.length === 0 ? (
        <EmptyState
          icon={<Calendar size={24} />}
          title={`No holidays for ${year}`}
          description="Create official holidays so leave and payroll calculations can exclude non-working dates."
          action={<Button size="sm" leftIcon={<Plus size={14} />} onClick={() => openHolidayModal()}>Add Holiday</Button>}
        />
      ) : (
        <Card padding="none">
          <Table
            data={selectedYearHolidays}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'name',
                header: 'Holiday',
                render: (row) => (
                  <div className="flex items-center gap-2.5">
                    <Calendar size={15} className="text-muted" />
                    <div className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{row.name}</span>
                      {row.source && <span className="block text-xs text-muted">{row.source}</span>}
                    </div>
                  </div>
                ),
              },
              {
                key: 'date',
                header: 'Date',
                render: (row) => <span className="text-sm">{formatDate(row.date, 'MMMM d, yyyy (EEEE)')}</span>,
              },
              {
                key: 'type',
                header: 'Type',
                render: (row) => (
                  <Badge variant={typeVariant[row.type]}>{typeLabel[row.type]}</Badge>
                ),
              },
              {
                key: 'scope',
                header: 'Scope',
                render: (row) => (
                  <span className="inline-flex items-center gap-1.5 text-sm text-ink">
                    <MapPin size={14} className="text-muted" />
                    {row.cityOrProvince ? `${row.cityOrProvince}, ${row.country}` : row.country}
                  </span>
                ),
              },
              {
                key: 'isRecurring',
                header: 'Recurring',
                render: (row) => (
                  <Badge variant={row.isRecurring ? 'success' : 'neutral'}>
                    {row.isRecurring ? 'Yes' : 'No'}
                  </Badge>
                ),
              },
              {
                key: 'isWorkingHoliday',
                header: 'Working',
                render: (row) => (
                  <Badge variant={row.isWorkingHoliday ? 'info' : 'neutral'}>
                    {row.isWorkingHoliday ? 'Yes' : 'No'}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                header: '',
                headerClassName: 'text-right',
                className: 'text-right',
                render: (row) => (
                  <div className="flex justify-end">
                    <div className="flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-neutral-20 p-1">
                      <HolidayActionButton
                        label="Edit holiday"
                        icon={<Edit2 size={15} />}
                        onClick={() => openHolidayModal(row)}
                      />
                      <HolidayActionButton
                        label="Delete holiday"
                        icon={<Trash2 size={15} />}
                        tone="danger"
                        isLoading={deletingHolidayId === row.id}
                        onClick={() => openDeleteModal(row)}
                      />
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSaving && setIsModalOpen(false)}
        title={editingHoliday ? 'Edit Holiday' : 'Add Holiday'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={saveHoliday} isLoading={isSaving}>Save Holiday</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Holiday Name"
            placeholder="e.g. Independence Day"
            value={form.name}
            error={fieldErrors.name}
            maxLength={100}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Date"
              type="date"
              value={form.holidayDate}
              error={fieldErrors.holidayDate}
              onChange={(e) => setForm((current) => ({ ...current, holidayDate: e.target.value }))}
              required
            />
            <Select
              label="Type"
              value={form.holidayType}
              error={fieldErrors.holidayType}
              onChange={(e) => updateHolidayType(e.target.value as HolidayType)}
              required
            >
              <option value="regular">Regular Holiday</option>
              <option value="special_non_working">Special Non-Working</option>
              <option value="special_working">Special Working</option>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Country"
              value={form.country}
              error={fieldErrors.country}
              maxLength={80}
              onChange={(e) => setForm((current) => ({ ...current, country: e.target.value }))}
              required
            />
            <Input
              label="City or Province"
              placeholder="Optional"
              value={form.cityOrProvince}
              error={fieldErrors.cityOrProvince}
              maxLength={120}
              onChange={(e) => setForm((current) => ({ ...current, cityOrProvince: e.target.value }))}
            />
          </div>
          <Input
            label="Source"
            placeholder="e.g. Official Gazette, HR entry"
            value={form.source}
            error={fieldErrors.source}
            onChange={(e) => setForm((current) => ({ ...current, source: e.target.value }))}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-neutral-20 px-3 py-3">
              <span className="text-sm font-medium text-ink">Recurring yearly</span>
              <input
                type="checkbox"
                checked={form.isRecurring}
                onChange={(e) => setForm((current) => ({ ...current, isRecurring: e.target.checked }))}
                className="h-4 w-4 rounded border-border text-brand focus:ring-brand-200"
              />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-neutral-20 px-3 py-3">
              <span className="text-sm font-medium text-ink">Working holiday</span>
              <input
                type="checkbox"
                checked={form.isWorkingHoliday}
                readOnly
                className="h-4 w-4 rounded border-border text-brand focus:ring-brand-200"
              />
            </label>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(holidayPendingDelete)}
        onClose={() => {
          if (!deletingHolidayId) setHolidayPendingDelete(null)
        }}
        onConfirm={deleteHoliday}
        title="Delete Holiday"
        message={
          holidayPendingDelete
            ? `Delete ${holidayPendingDelete.name}? This will remove it from holiday calendars used by leave and payroll calculations.`
            : ''
        }
        confirmLabel="Delete Holiday"
        isLoading={Boolean(deletingHolidayId)}
        variant="danger"
      />
    </div>
  )
}
