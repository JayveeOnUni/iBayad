import { useEffect, useState } from 'react'
import { Plus, Edit2, Clock, Power, Trash2, Loader2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Modal, { ConfirmModal } from '../../../components/ui/Modal'
import Input from '../../../components/ui/Input'
import { EmptyState, FeedbackMessage } from '../../../components/ui/Page'
import { useToast } from '../../../components/ui/Toast'
import { shiftService, type ShiftPayload } from '../../../services/referenceDataService'
import type { Shift } from '../../../types'

interface ShiftForm {
  name: string
  startTime: string
  endTime: string
  breakMinutes: string
  workingHoursPerDay: string
}

type ShiftFormErrors = Partial<Record<keyof ShiftForm, string>>
type PageMessage = { variant: 'info' | 'success' | 'warning' | 'danger'; text: string }
type ActionTone = 'neutral' | 'success' | 'warning' | 'danger'

interface ShiftActionButtonProps {
  label: string
  icon: React.ReactNode
  tone?: ActionTone
  isLoading?: boolean
  onClick: () => void
}

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/
const actionToneClasses: Record<ActionTone, string> = {
  neutral: 'text-neutral-70 hover:bg-white hover:text-ink hover:shadow-sm focus-visible:ring-brand-200',
  success: 'text-success hover:bg-success-muted hover:text-success-hover focus-visible:ring-success-border',
  warning: 'text-warning hover:bg-warning-muted hover:text-warning focus-visible:ring-warning-border',
  danger: 'text-danger hover:bg-danger-muted hover:text-danger-hover focus-visible:ring-danger-border',
}

const defaultForm: ShiftForm = {
  name: '',
  startTime: '08:00',
  endTime: '17:00',
  breakMinutes: '60',
  workingHoursPerDay: '8',
}

function formatShiftTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function isRegularShift(shift: Shift): boolean {
  return shift.name.trim().toLowerCase() === 'regular shift'
}

function ShiftActionButton({
  label,
  icon,
  tone = 'neutral',
  isLoading = false,
  onClick,
}: ShiftActionButtonProps) {
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

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function getShiftDurationMinutes(startTime: string, endTime: string): number {
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)
  const duration = end - start
  return duration > 0 ? duration : duration + 24 * 60
}

function validateShiftForm(form: ShiftForm): { payload?: ShiftPayload; errors: ShiftFormErrors } {
  const errors: ShiftFormErrors = {}
  const name = form.name.trim()
  const hasBreakMinutes = form.breakMinutes.trim() !== ''
  const hasWorkingHours = form.workingHoursPerDay.trim() !== ''
  const breakMinutes = Number(form.breakMinutes)
  const workingHoursPerDay = Number(form.workingHoursPerDay)

  if (!name) errors.name = 'Shift name is required'
  if (name.length > 100) errors.name = 'Shift name must be 100 characters or fewer'
  if (!timePattern.test(form.startTime)) errors.startTime = 'Start time is required'
  if (!timePattern.test(form.endTime)) errors.endTime = 'End time is required'
  if (!hasBreakMinutes) errors.breakMinutes = 'Break minutes are required'
  if (hasBreakMinutes && !Number.isInteger(breakMinutes)) errors.breakMinutes = 'Break minutes must be a whole number'
  if (hasBreakMinutes && breakMinutes < 0) errors.breakMinutes = 'Break minutes cannot be negative'
  if (!hasWorkingHours) errors.workingHoursPerDay = 'Working hours are required'
  if (hasWorkingHours && !Number.isFinite(workingHoursPerDay)) errors.workingHoursPerDay = 'Working hours must be a valid number'
  if (hasWorkingHours && workingHoursPerDay <= 0) errors.workingHoursPerDay = 'Working hours must be greater than 0'
  if (hasWorkingHours && workingHoursPerDay > 24) errors.workingHoursPerDay = 'Working hours cannot exceed 24'

  if (timePattern.test(form.startTime) && timePattern.test(form.endTime)) {
    if (form.startTime === form.endTime) errors.endTime = 'End time must differ from start time'

    const durationMinutes = getShiftDurationMinutes(form.startTime, form.endTime)
    const payableMinutes = durationMinutes - breakMinutes

    if (breakMinutes >= durationMinutes) {
      errors.breakMinutes = 'Break must be shorter than the shift duration'
    }
    if (payableMinutes > 0 && workingHoursPerDay * 60 > payableMinutes + 0.5) {
      errors.workingHoursPerDay = 'Working hours cannot exceed scheduled time minus break'
    }
  }

  if (Object.keys(errors).length > 0) return { errors }

  return {
    errors,
    payload: {
      name,
      startTime: form.startTime,
      endTime: form.endTime,
      breakMinutes,
      workingHoursPerDay: Math.round(workingHoursPerDay * 100) / 100,
    },
  }
}

export default function ShiftsPage() {
  const { showToast } = useToast()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingShift, setEditingShift] = useState<Shift | null>(null)
  const [form, setForm] = useState<ShiftForm>(defaultForm)
  const [fieldErrors, setFieldErrors] = useState<ShiftFormErrors>({})
  const [message, setMessage] = useState<PageMessage | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [togglingShiftId, setTogglingShiftId] = useState<string | null>(null)
  const [shiftPendingDelete, setShiftPendingDelete] = useState<Shift | null>(null)
  const [deletingShiftId, setDeletingShiftId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    shiftService.getAll()
      .then((data) => {
        if (!isMounted) return
        setShifts(data)
        setMessage(null)
      })
      .catch((err) => {
        if (!isMounted) return
        setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to load shifts.' })
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const openShiftModal = (shift?: Shift) => {
    setEditingShift(shift ?? null)
    setFieldErrors({})
    setForm({
      name: shift?.name ?? '',
      startTime: shift?.startTime ?? '08:00',
      endTime: shift?.endTime ?? '17:00',
      breakMinutes: String(shift?.breakMinutes ?? 60),
      workingHoursPerDay: String(shift?.workingHoursPerDay ?? 8),
    })
    setIsModalOpen(true)
  }

  const saveShift = async () => {
    const { payload, errors } = validateShiftForm(form)
    setFieldErrors(errors)
    if (!payload) return

    setIsSaving(true)
    setMessage(null)

    try {
      const savedShift = editingShift
        ? await shiftService.update(editingShift.id, payload)
        : await shiftService.create(payload)

      setShifts((current) =>
        editingShift
          ? current.map((item) => item.id === savedShift.id ? savedShift : item)
          : [savedShift, ...current]
      )
      showToast({ variant: 'success', title: editingShift ? 'Shift updated' : 'Shift created' })
      setIsModalOpen(false)
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to save shift.' })
    } finally {
      setIsSaving(false)
    }
  }

  const toggleShift = async (shift: Shift) => {
    setTogglingShiftId(shift.id)
    setMessage(null)

    try {
      const updatedShift = await shiftService.toggleActive(shift.id)
      setShifts((current) => current.map((item) => item.id === updatedShift.id ? updatedShift : item))
      showToast({ variant: 'success', title: `Shift ${updatedShift.isActive ? 'activated' : 'deactivated'}` })
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to update shift status.' })
    } finally {
      setTogglingShiftId(null)
    }
  }

  const openDeleteModal = (shift: Shift) => {
    if (isRegularShift(shift)) return
    setShiftPendingDelete(shift)
    setMessage(null)
  }

  const deleteShift = async () => {
    if (!shiftPendingDelete || isRegularShift(shiftPendingDelete)) return

    setDeletingShiftId(shiftPendingDelete.id)
    setMessage(null)

    try {
      const result = await shiftService.delete(shiftPendingDelete.id)
      const reassignedText = result.reassignedEmployees === 1
        ? '1 employee was reassigned to Regular Shift.'
        : `${result.reassignedEmployees} employees were reassigned to Regular Shift.`

      setShifts((current) => current.filter((item) => item.id !== result.deletedShiftId))
      showToast({ variant: 'success', title: 'Shift deleted', description: reassignedText })
      setShiftPendingDelete(null)
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to delete shift.' })
      setShiftPendingDelete(null)
    } finally {
      setDeletingShiftId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Work Shifts</h2>
          <p className="text-sm text-muted mt-0.5">Manage employee shift schedules</p>
        </div>
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => openShiftModal()}>Add Shift</Button>
      </div>

      {message && <FeedbackMessage variant={message.variant}>{message.text}</FeedbackMessage>}

      {isLoading ? (
        <FeedbackMessage>Loading work shifts...</FeedbackMessage>
      ) : shifts.length === 0 ? (
        <EmptyState
          icon={<Clock size={24} />}
          title="No work shifts yet"
          description="Create a shift so employees can be assigned to an active schedule."
          action={<Button size="sm" leftIcon={<Plus size={14} />} onClick={() => openShiftModal()}>Add Shift</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {shifts.map((shift) => (
            <Card key={shift.id}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Clock size={18} className="text-brand" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-ink truncate">{shift.name}</h3>
                    <Badge variant={shift.isActive === false ? 'danger' : 'success'} size="sm" dot>
                      {shift.isActive === false ? 'Inactive' : 'Active'}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-neutral-20 p-1">
                  <ShiftActionButton
                    label="Edit shift"
                    icon={<Edit2 size={15} />}
                    onClick={() => openShiftModal(shift)}
                  />
                  <ShiftActionButton
                    label={shift.isActive === false ? 'Activate shift' : 'Deactivate shift'}
                    icon={<Power size={15} />}
                    tone={shift.isActive === false ? 'success' : 'warning'}
                    isLoading={togglingShiftId === shift.id}
                    onClick={() => toggleShift(shift)}
                  />
                  {!isRegularShift(shift) && (
                    <ShiftActionButton
                      label="Delete shift"
                      icon={<Trash2 size={15} />}
                      tone="danger"
                      isLoading={deletingShiftId === shift.id}
                      onClick={() => openDeleteModal(shift)}
                    />
                  )}
                </div>
              </div>

              <div className="space-y-2 mt-4">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="text-muted">Start Time</span>
                  <span className="font-medium text-ink">{formatShiftTime(shift.startTime)}</span>
                </div>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="text-muted">End Time</span>
                  <span className="font-medium text-ink">{formatShiftTime(shift.endTime)}</span>
                </div>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="text-muted">Break</span>
                  <span className="font-medium text-ink">{shift.breakMinutes} minutes</span>
                </div>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="text-muted">Working Hours</span>
                  <span className="font-medium text-ink">{formatHours(shift.workingHoursPerDay)}h / day</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSaving && setIsModalOpen(false)}
        title={editingShift ? 'Edit Shift' : 'Add Shift'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={saveShift} isLoading={isSaving}>Save Shift</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Shift Name" value={form.name} error={fieldErrors.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} required />
          <Input label="Start Time" type="time" value={form.startTime} error={fieldErrors.startTime} onChange={(e) => setForm((current) => ({ ...current, startTime: e.target.value }))} required />
          <Input label="End Time" type="time" value={form.endTime} error={fieldErrors.endTime} onChange={(e) => setForm((current) => ({ ...current, endTime: e.target.value }))} required />
          <Input label="Break Minutes" type="number" min={0} step={1} value={form.breakMinutes} error={fieldErrors.breakMinutes} onChange={(e) => setForm((current) => ({ ...current, breakMinutes: e.target.value }))} required />
          <Input label="Working Hours / Day" type="number" min={0.25} max={24} step={0.25} value={form.workingHoursPerDay} error={fieldErrors.workingHoursPerDay} onChange={(e) => setForm((current) => ({ ...current, workingHoursPerDay: e.target.value }))} required />
        </div>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(shiftPendingDelete)}
        onClose={() => {
          if (!deletingShiftId) setShiftPendingDelete(null)
        }}
        onConfirm={deleteShift}
        title="Delete Shift"
        message={
          shiftPendingDelete
            ? `Delete ${shiftPendingDelete.name}? Any assigned employees will be reassigned to Regular Shift before this shift is deleted. This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete Shift"
        isLoading={Boolean(deletingShiftId)}
        variant="danger"
      />
    </div>
  )
}
