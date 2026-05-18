import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Download, ChevronLeft, ChevronRight, RotateCcw, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Table from '../../../components/ui/Table'
import Badge from '../../../components/ui/Badge'
import Avatar from '../../../components/ui/Avatar'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import { FeedbackMessage, PageHeader } from '../../../components/ui/Page'
import { formatDate, formatTime, addDays, format, parseISO } from '../../../utils/dateHelpers'
import type { AttendanceRecord, AttendanceStatus, Employee } from '../../../types'
import { attendanceService } from '../../../services/attendanceService'
import { employeeService } from '../../../services/employeeService'

const today = new Date()
const todayKey = format(today, 'yyyy-MM-dd')

type AttendanceFilterStatus = AttendanceStatus | 'missing'
type DisplayAttendanceRecord = Omit<AttendanceRecord, 'status'> & {
  status: AttendanceFilterStatus
  isMissing?: boolean
}

const statusVariant: Record<AttendanceFilterStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  present: 'success',
  late: 'warning',
  absent: 'danger',
  half_day: 'warning',
  on_leave: 'info',
  holiday: 'info',
  rest_day: 'neutral',
  missing: 'danger',
}

const statusLabels: Record<AttendanceFilterStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  half_day: 'Half Day',
  on_leave: 'On Leave',
  holiday: 'Holiday',
  rest_day: 'Rest Day',
  missing: 'Unrecorded',
}

const filterStatuses: AttendanceFilterStatus[] = ['present', 'late', 'absent', 'on_leave', 'missing']

function normalizeStatus(value: string | null): AttendanceFilterStatus | '' {
  return value && filterStatuses.includes(value as AttendanceFilterStatus)
    ? value as AttendanceFilterStatus
    : ''
}

function minutesLabel(minutes: number) {
  if (minutes <= 0) return '—'
  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`
}

export default function DailyLogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialDate = searchParams.get('date') || todayKey
  const [selectedDate, setSelectedDate] = useState(initialDate)
  const [logs, setLogs] = useState<AttendanceRecord[]>([])
  const [dateLogs, setDateLogs] = useState<AttendanceRecord[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<AttendanceFilterStatus | ''>(normalizeStatus(searchParams.get('status')))
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const loadLogs = async () => {
      try {
        setIsLoading(true)
        setMessage(null)
        const dateParams = selectedDate ? { startDate: selectedDate, endDate: selectedDate } : {}
        const apiStatus = status && status !== 'missing' ? status : undefined
        const [tableRes, dateRes, employeeRes] = await Promise.all([
          attendanceService.list({ ...dateParams, status: apiStatus }),
          selectedDate ? attendanceService.list(dateParams) : Promise.resolve(null),
          selectedDate ? employeeService.list({ limit: 1000, status: 'active' }) : Promise.resolve(null),
        ])
        setLogs(tableRes.data)
        setDateLogs(dateRes?.data ?? tableRes.data)
        setEmployees(employeeRes?.data ?? [])
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Unable to load attendance logs.')
      } finally {
        setIsLoading(false)
      }
    }

    loadLogs()
  }, [selectedDate, status])

  useEffect(() => {
    const params = new URLSearchParams()
    if (selectedDate) params.set('date', selectedDate)
    if (status) params.set('status', status)
    setSearchParams(params, { replace: true })
  }, [selectedDate, setSearchParams, status])

  const missingRows = useMemo<DisplayAttendanceRecord[]>(() => {
    if (!selectedDate) return []
    const recordedEmployeeIds = new Set(dateLogs.map((log) => log.employeeId))
    return employees
      .filter((employee) => !recordedEmployeeIds.has(employee.id))
      .map((employee) => ({
        id: `missing-${employee.id}-${selectedDate}`,
        employeeId: employee.id,
        employee: {
          id: employee.id,
          firstName: employee.firstName,
          lastName: employee.lastName,
          employeeNumber: employee.employeeNumber,
        },
        date: selectedDate,
        requiredWorkMinutes: 0,
        actualRenderedMinutes: 0,
        hoursWorked: 0,
        overtimeHours: 0,
        excessMinutes: 0,
        offsetEarnedMinutes: 0,
        offsetUsedMinutes: 0,
        lateMinutes: 0,
        undertimeMinutes: 0,
        status: 'missing',
        isMissing: true,
        createdAt: selectedDate,
        updatedAt: selectedDate,
      }))
  }, [dateLogs, employees, selectedDate])

  const tableRows = useMemo<DisplayAttendanceRecord[]>(() => {
    return status === 'missing' ? missingRows : logs
  }, [logs, missingRows, status])

  const filteredLogs = useMemo(() => tableRows.filter((log) => {
    const employeeName = log.employee ? `${log.employee.firstName} ${log.employee.lastName}`.toLowerCase() : ''
    return employeeName.includes(search.toLowerCase())
  }), [search, tableRows])

  const summaryLogs = selectedDate ? dateLogs : logs
  const countStatus = (value: AttendanceRecord['status']) => summaryLogs.filter((log) => log.status === value).length

  const setAdjacentDate = (amount: number) => {
    const base = selectedDate ? parseISO(selectedDate) : today
    setSelectedDate(format(addDays(base, amount), 'yyyy-MM-dd'))
  }

  const resetFilters = () => {
    setSelectedDate('')
    setStatus('')
    setSearch('')
  }

  const exportLogs = () => {
    const csv = [
      ['Employee', 'Date', 'Shift', 'Time In', 'Time Out', 'Hours', 'Late Minutes', 'Excess Minutes', 'Offset Earned', 'Offset Used', 'Status'],
      ...filteredLogs.map((log) => [
        log.employee ? `${log.employee.firstName} ${log.employee.lastName}` : log.employeeId,
        log.date,
        log.isMissing ? 'No record' : log.scheduledShiftName ?? '',
        log.timeIn ?? '',
        log.timeOut ?? '',
        String(log.hoursWorked),
        String(log.lateMinutes),
        String(log.excessMinutes),
        String(log.offsetEarnedMinutes),
        String(log.offsetUsedMinutes),
        statusLabels[log.status],
      ]),
    ].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `attendance-${selectedDate || 'all'}${status ? `-${status}` : ''}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Daily Attendance Log"
        subtitle="Track employee time-in, time-out, late minutes, and daily status."
        actions={
        <Button variant="outline" size="sm" leftIcon={<Download size={14} />} onClick={exportLogs}>
          Export
        </Button>
        }
      />

      {message && (
        <FeedbackMessage variant={message.toLowerCase().includes('unable') ? 'danger' : 'info'}>
          {message}
        </FeedbackMessage>
      )}

      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center justify-between gap-3 sm:justify-start">
            <button
              type="button"
              onClick={() => setAdjacentDate(-1)}
              className="rounded-md p-2 text-muted transition-colors hover:bg-neutral-20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
              aria-label="Previous date"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="min-w-0 text-center sm:min-w-48">
              <p className="text-base font-semibold text-ink">
                {selectedDate ? formatDate(selectedDate, 'EEEE') : 'All dates'}
              </p>
              <p className="text-sm text-muted">
                {selectedDate ? formatDate(selectedDate, 'MMMM d, yyyy') : 'Date filter removed'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAdjacentDate(1)}
              className="rounded-md p-2 text-muted transition-colors hover:bg-neutral-20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
              aria-label="Next date"
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(180px,220px)_auto_auto] sm:items-end">
            <Input
              label="Attendance date"
              type="date"
              value={selectedDate}
              leftAddon={<CalendarDays size={15} />}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setSelectedDate(todayKey)}>
              Today
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<RotateCcw size={14} />}
              onClick={resetFilters}
            >
              Show All
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { status: 'present' as const, count: countStatus('present'), variant: 'success' as const },
            { status: 'late' as const, count: countStatus('late'), variant: 'warning' as const },
            { status: 'absent' as const, count: countStatus('absent'), variant: 'danger' as const },
            { status: 'on_leave' as const, count: countStatus('on_leave'), variant: 'info' as const },
            { status: 'missing' as const, count: selectedDate ? missingRows.length : 0, variant: 'danger' as const },
          ].map((s) => (
            <button
              key={s.status}
              type="button"
              onClick={() => setStatus((current) => current === s.status ? '' : s.status)}
              aria-pressed={status === s.status}
              className={[
                'flex min-h-16 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition duration-150',
                'hover:-translate-y-0.5 hover:border-brand-200 hover:bg-brand-50/70 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 active:translate-y-0',
                status === s.status ? 'border-brand-200 bg-brand-50 shadow-card' : 'border-border bg-neutral-20',
              ].join(' ')}
            >
              <Badge variant={s.variant}>{statusLabels[s.status]}</Badge>
              <span className="text-lg font-semibold text-ink">{s.count}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card padding="none">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <Input
            type="text"
            placeholder="Search employee..."
            value={search}
            leftAddon={<Search size={15} />}
            onChange={(e) => setSearch(e.target.value)}
            className="lg:max-w-xs"
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(180px,220px)_auto] sm:items-end">
            <Select
              label="Status filter"
              value={status}
              onChange={(e) => setStatus(normalizeStatus(e.target.value))}
            >
              <option value="">All statuses</option>
              {filterStatuses.map((item) => (
                <option key={item} value={item}>{statusLabels[item]}</option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<RotateCcw size={14} />}
              onClick={resetFilters}
            >
              Reset Filter
            </Button>
          </div>
        </div>

        <Table
          data={filteredLogs}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyMessage={
            status === 'missing' && !selectedDate
              ? 'Choose a date to see employees with unrecorded attendance.'
              : 'No attendance records match the selected filters.'
          }
          columns={[
            {
              key: 'employee',
              header: 'Employee',
              render: (row) => (
                <div className="flex items-center gap-3">
                  <Avatar name={row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : 'Employee'} size="sm" />
                  <span className="text-sm font-medium text-ink">
                    {row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : row.employeeId}
                  </span>
                </div>
              ),
            },
            {
              key: 'shift',
              header: 'Shift',
              render: (row) => (
                <span className="text-sm">{row.isMissing ? 'No record' : row.scheduledShiftName ?? '—'}</span>
              ),
            },
            {
              key: 'timeIn',
              header: 'Time In',
              render: (row) => (
                <span className="text-sm">{row.timeIn ? formatTime(row.timeIn) : '—'}</span>
              ),
            },
            {
              key: 'timeOut',
              header: 'Time Out',
              render: (row) => (
                <span className="text-sm">{row.timeOut ? formatTime(row.timeOut) : '—'}</span>
              ),
            },
            {
              key: 'hoursWorked',
              header: 'Hours',
              render: (row) => <span className="text-sm">{row.hoursWorked > 0 ? `${row.hoursWorked}h` : '—'}</span>,
            },
            {
              key: 'lateMinutes',
              header: 'Late',
              render: (row) => (
                <span className={`text-sm ${row.lateMinutes > 0 ? 'font-medium text-warning' : 'text-muted'}`}>
                  {row.lateMinutes > 0 ? `${row.lateMinutes} min` : '—'}
                </span>
              ),
            },
            {
              key: 'offsetEarnedMinutes',
              header: 'Offset Earned',
              render: (row) => (
                <span className="text-sm text-muted">{minutesLabel(row.offsetEarnedMinutes)}</span>
              ),
            },
            {
              key: 'offsetUsedMinutes',
              header: 'Offset Used',
              render: (row) => (
                <span className="text-sm text-muted">{minutesLabel(row.offsetUsedMinutes)}</span>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <Badge variant={statusVariant[row.status]} dot>
                  {statusLabels[row.status]}
                </Badge>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
