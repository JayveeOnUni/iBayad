import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock, Plus } from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import Input from '../../components/ui/Input'
import Textarea from '../../components/ui/Textarea'
import { FeedbackMessage, PageHeader } from '../../components/ui/Page'
import { useToast } from '../../components/ui/Toast'
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  formatTime,
  isSameDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from '../../utils/dateHelpers'
import { attendanceService } from '../../services/attendanceService'
import type { AttendanceRecord, AttendanceStatus, OffsetBalance } from '../../types'

const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  half_day: 'warning',
  on_leave: 'info',
  holiday: 'info',
  rest_day: 'info',
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const calendarStatusStyles: Record<AttendanceStatus, string> = {
  present: 'border-success/20 bg-success/10 text-success',
  late: 'border-warning/20 bg-warning/10 text-warning',
  absent: 'border-danger/20 bg-danger/10 text-danger',
  half_day: 'border-warning/20 bg-warning/10 text-warning',
  on_leave: 'border-info/20 bg-info/10 text-info',
  holiday: 'border-brand-200 bg-brand-50 text-brand-700',
  rest_day: 'border-slate-200 bg-slate-100 text-slate-700',
}

const statusLabels: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  half_day: 'Half Day',
  on_leave: 'On Leave',
  holiday: 'Holiday',
  rest_day: 'Rest Day',
}

function minutesLabel(minutes: number) {
  if (minutes <= 0) return '0h'
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`
}

export default function AttendancePage() {
  const { showToast } = useToast()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isOffsetModalOpen, setIsOffsetModalOpen] = useState(false)
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [offsetBalance, setOffsetBalance] = useState<OffsetBalance | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [requestForm, setRequestForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    requestedTimeIn: '',
    requestedTimeOut: '',
    reason: '',
  })
  const [offsetForm, setOffsetForm] = useState({
    usageDate: new Date().toISOString().slice(0, 10),
    requestedMinutes: 120,
    reason: '',
  })

  useEffect(() => {
    const loadAttendance = async () => {
      try {
        setIsLoading(true)
        setMessage(null)
        const [res, balanceRes] = await Promise.all([
          attendanceService.getMyAttendance({
            startDate: format(startOfMonth(currentMonth), 'yyyy-MM-dd'),
            endDate: format(endOfMonth(currentMonth), 'yyyy-MM-dd'),
          }),
          attendanceService.getMyOffsetBalance(),
        ])
        setAttendance(res.data)
        setOffsetBalance(balanceRes.data)
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Unable to load attendance.')
      } finally {
        setIsLoading(false)
      }
    }

    loadAttendance()
  }, [currentMonth])

  const present = useMemo(() => attendance.filter((a) => a.status === 'present' || a.status === 'late').length, [attendance])
  const absent = useMemo(() => attendance.filter((a) => a.status === 'absent').length, [attendance])
  const late = useMemo(() => attendance.filter((a) => a.status === 'late').length, [attendance])
  const offsetEarned = useMemo(() => attendance.reduce((sum, a) => sum + a.offsetEarnedMinutes, 0), [attendance])
  const offsetUsed = useMemo(() => attendance.reduce((sum, a) => sum + a.offsetUsedMinutes, 0), [attendance])
  const undertime = useMemo(() => attendance.reduce((sum, a) => sum + a.undertimeMinutes, 0), [attendance])
  const attendanceByDate = useMemo(
    () => new Map(attendance.map((record) => [record.date.slice(0, 10), record])),
    [attendance]
  )
  const monthDays = useMemo(() => {
    const days: Date[] = []
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const calendarStart = startOfWeek(monthStart)
    const calendarEnd = endOfWeek(monthEnd)

    let day = calendarStart
    while (day <= calendarEnd) {
      days.push(new Date(day))
      day = addDays(day, 1)
    }

    return days
  }, [currentMonth])

  const selectedDateKey = format(selectedDate, 'yyyy-MM-dd')
  const selectedAttendance = attendanceByDate.get(selectedDateKey)

  const changeMonth = (step: -1 | 1) => {
    setCurrentMonth((previousMonth) => {
      const nextMonth = step === -1 ? subMonths(previousMonth, 1) : addMonths(previousMonth, 1)
      const today = new Date()
      setSelectedDate(
        today.getMonth() === nextMonth.getMonth() && today.getFullYear() === nextMonth.getFullYear()
          ? today
          : startOfMonth(nextMonth)
      )
      return nextMonth
    })
  }

  const openCorrectionModal = (date = selectedDateKey) => {
    setRequestForm((form) => ({ ...form, date }))
    setIsModalOpen(true)
  }

  const submitCorrection = async () => {
    try {
      setIsSubmitting(true)
      setMessage(null)
      await attendanceService.submitRequest({
        date: requestForm.date,
        requestedStatus: 'present',
        requestedTimeIn: requestForm.requestedTimeIn ? `${requestForm.date}T${requestForm.requestedTimeIn}:00` : undefined,
        requestedTimeOut: requestForm.requestedTimeOut ? `${requestForm.date}T${requestForm.requestedTimeOut}:00` : undefined,
        reason: requestForm.reason,
      })
      setIsModalOpen(false)
      setRequestForm({ date: new Date().toISOString().slice(0, 10), requestedTimeIn: '', requestedTimeOut: '', reason: '' })
      showToast({
        variant: 'success',
        title: 'Attendance correction submitted',
        description: 'Sent for review.',
      })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to submit attendance request.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const submitOffsetUsage = async () => {
    try {
      setIsSubmitting(true)
      setMessage(null)
      await attendanceService.submitOffsetUsage({
        usageDate: offsetForm.usageDate,
        requestedMinutes: offsetForm.requestedMinutes,
        reason: offsetForm.reason,
      })
      setIsOffsetModalOpen(false)
      setOffsetForm({ usageDate: new Date().toISOString().slice(0, 10), requestedMinutes: 120, reason: '' })
      const balanceRes = await attendanceService.getMyOffsetBalance()
      setOffsetBalance(balanceRes.data)
      showToast({
        variant: 'success',
        title: 'Time offset request submitted',
        description: 'Sent for review.',
      })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to submit time offset request.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Attendance"
        subtitle="Track your daily time in and time out."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" leftIcon={<Clock size={14} />} onClick={() => setIsOffsetModalOpen(true)}>
              Request Time Offset
            </Button>
            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => openCorrectionModal()}>
              Request Correction
            </Button>
          </div>
        }
      />

      {message && (
        <FeedbackMessage variant={message.toLowerCase().includes('unable') ? 'danger' : 'info'}>
          {message}
        </FeedbackMessage>
      )}

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            className="rounded-md p-2 text-muted hover:bg-neutral-20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="text-base font-semibold text-ink">
            {format(currentMonth, 'MMMM yyyy')}
          </p>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            className="rounded-md p-2 text-muted hover:bg-neutral-20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-7">
          {[
            { label: 'Days Present', value: present, color: 'text-success' },
            { label: 'Days Absent', value: absent, color: 'text-danger' },
            { label: 'Late Days', value: late, color: 'text-warning' },
            { label: 'Undertime', value: minutesLabel(undertime), color: 'text-warning' },
            { label: 'Offset Available', value: minutesLabel(offsetBalance?.availableMinutes ?? 0), color: 'text-brand' },
            { label: 'Offset Earned', value: minutesLabel(offsetEarned), color: 'text-info' },
            { label: 'Offset Used', value: minutesLabel(offsetUsed), color: 'text-info' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-neutral-20 p-3 text-center">
              <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
              <p className="mt-1 text-xs text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Attendance Calendar</h3>
            <p className="mt-1 text-xs text-muted">Click a day to review your recorded hours, status, and offsets.</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const today = new Date()
              setCurrentMonth(today)
              setSelectedDate(today)
            }}
          >
            Today
          </Button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(Object.keys(statusLabels) as AttendanceStatus[]).map((status) => (
            <span
              key={status}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${calendarStatusStyles[status]}`}
            >
              {statusLabels[status]}
            </span>
          ))}
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div>
            <div className="mb-2 grid grid-cols-7 gap-2">
              {DAY_LABELS.map((day) => (
                <div key={day} className="py-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-muted">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-2">
              {monthDays.map((date) => {
                const isCurrentMonth = date.getMonth() === currentMonth.getMonth()
                const isToday = isSameDay(date, new Date())
                const isSelected = isSameDay(date, selectedDate)
                const record = attendanceByDate.get(format(date, 'yyyy-MM-dd'))

                return (
                  <button
                    key={format(date, 'yyyy-MM-dd')}
                    type="button"
                    onClick={() => isCurrentMonth && setSelectedDate(date)}
                    disabled={!isCurrentMonth}
                    className={[
                      'min-h-[104px] rounded-2xl border p-2 text-left transition',
                      isCurrentMonth ? 'bg-white hover:border-brand-200 hover:bg-brand-50/40' : 'bg-slate-50 text-slate-300',
                      isSelected ? 'border-brand-300 ring-2 ring-brand-100' : 'border-border',
                      !isCurrentMonth ? 'cursor-default' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={[
                          'inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                          isToday ? 'bg-brand text-white' : isCurrentMonth ? 'bg-neutral-20 text-ink' : 'bg-transparent text-slate-300',
                        ].join(' ')}
                      >
                        {format(date, 'd')}
                      </span>
                      {record && (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${calendarStatusStyles[record.status]}`}>
                          {statusLabels[record.status]}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 space-y-1">
                      {record ? (
                        <>
                          <p className="text-xs font-medium text-ink">
                            {record.timeIn && record.timeOut
                              ? `${formatTime(record.timeIn)} - ${formatTime(record.timeOut)}`
                              : 'No complete time log'}
                          </p>
                          <p className="text-[11px] text-muted">
                            {record.hoursWorked > 0
                              ? `${record.hoursWorked.toFixed(1)}h worked`
                              : record.status === 'absent'
                                ? 'Marked absent'
                                : 'Recorded'}
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-muted">{isCurrentMonth ? 'No attendance log' : ' '}</p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-neutral-20/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Selected day</p>
            <h4 className="mt-2 text-lg font-semibold text-ink">{format(selectedDate, 'EEEE, MMMM d')}</h4>
            <p className="text-sm text-muted">{format(selectedDate, 'yyyy')}</p>

            {selectedAttendance ? (
              <div className="mt-4 space-y-4">
                <Badge variant={statusVariant[selectedAttendance.status]} dot>
                  {statusLabels[selectedAttendance.status]}
                </Badge>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs text-muted">Time In</p>
                    <p className="mt-1 font-medium text-ink">{selectedAttendance.timeIn ? formatTime(selectedAttendance.timeIn) : '—'}</p>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs text-muted">Time Out</p>
                    <p className="mt-1 font-medium text-ink">{selectedAttendance.timeOut ? formatTime(selectedAttendance.timeOut) : '—'}</p>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs text-muted">Worked</p>
                    <p className="mt-1 font-medium text-ink">{selectedAttendance.hoursWorked.toFixed(1)}h</p>
                  </div>
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs text-muted">Late / Undertime</p>
                    <p className="mt-1 font-medium text-ink">
                      {selectedAttendance.lateMinutes}m / {selectedAttendance.undertimeMinutes}m
                    </p>
                  </div>
                </div>

                <div className="rounded-xl bg-white p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Offset earned</span>
                    <span className="font-medium text-ink">{minutesLabel(selectedAttendance.offsetEarnedMinutes)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted">Offset used</span>
                    <span className="font-medium text-ink">{minutesLabel(selectedAttendance.offsetUsedMinutes)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-white/80 p-4 text-sm text-muted">
                No attendance record is available for this day yet.
              </div>
            )}

            <div className="mt-4">
              <Button size="sm" variant="outline" onClick={() => openCorrectionModal()}>
                Request correction for this date
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold text-ink">Attendance Log</h3>
        </div>
        <div className="divide-y divide-border">
          {isLoading && <div className="px-5 py-6 text-sm text-muted">Loading attendance...</div>}
          {!isLoading && attendance.length === 0 && <div className="px-5 py-6 text-sm text-muted">No attendance logs for this month.</div>}
          {!isLoading && attendance.map((record) => (
            <div key={record.id} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-sm font-medium text-ink">
                  {format(new Date(record.date), 'EEEE, MMMM d')}
                </p>
                <p className="text-xs text-muted">
                  {record.timeIn && record.timeOut
                    ? `${formatTime(record.timeIn)} - ${formatTime(record.timeOut)} · ${record.hoursWorked.toFixed(1)}h`
                    : 'No record'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {record.offsetEarnedMinutes > 0 && (
                  <span className="text-xs font-medium text-brand">+{minutesLabel(record.offsetEarnedMinutes)} offset</span>
                )}
                {record.offsetUsedMinutes > 0 && (
                  <span className="text-xs font-medium text-info">-{minutesLabel(record.offsetUsedMinutes)} used</span>
                )}
                <Badge variant={statusVariant[record.status]} dot>
                  {statusLabels[record.status]}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="Request Attendance Correction"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={submitCorrection} isLoading={isSubmitting}>Submit Request</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Date"
            type="date"
            value={requestForm.date}
            onChange={(e) => setRequestForm((form) => ({ ...form, date: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Correct Time In"
              type="time"
              value={requestForm.requestedTimeIn}
              onChange={(e) => setRequestForm((form) => ({ ...form, requestedTimeIn: e.target.value }))}
            />
            <Input
              label="Correct Time Out"
              type="time"
              value={requestForm.requestedTimeOut}
              onChange={(e) => setRequestForm((form) => ({ ...form, requestedTimeOut: e.target.value }))}
            />
          </div>
          <Textarea
            label="Reason"
            rows={3}
            value={requestForm.reason}
            onChange={(e) => setRequestForm((form) => ({ ...form, reason: e.target.value }))}
            placeholder="Please explain why you need this correction..."
          />
        </div>
      </Modal>

      <Modal
        isOpen={isOffsetModalOpen}
        onClose={() => setIsOffsetModalOpen(false)}
        title="Request Time Offset"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsOffsetModalOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button onClick={submitOffsetUsage} isLoading={isSubmitting}>Submit Request</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Usage Date"
            type="date"
            value={offsetForm.usageDate}
            onChange={(e) => setOffsetForm((form) => ({ ...form, usageDate: e.target.value }))}
          />
          <Input
            label="Offset Minutes"
            type="number"
            min={1}
            value={offsetForm.requestedMinutes}
            onChange={(e) => setOffsetForm((form) => ({ ...form, requestedMinutes: Number(e.target.value) }))}
          />
          <Textarea
            label="Reason"
            rows={3}
            value={offsetForm.reason}
            onChange={(e) => setOffsetForm((form) => ({ ...form, reason: e.target.value }))}
            placeholder="Describe how the offset will be used..."
          />
        </div>
      </Modal>
    </div>
  )
}
