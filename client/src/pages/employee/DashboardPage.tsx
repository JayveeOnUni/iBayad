import { AlertCircle, CalendarClock, LogIn, LogOut, Megaphone } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { attendanceService } from '../../services/attendanceService'
import { dashboardService } from '../../services/dashboardService'
import type { EmployeeDashboardData } from '../../types'
import Card, { CardHeader } from '../../components/ui/Card'
import Table from '../../components/ui/Table'
import { EmptyState, FeedbackMessage, Page, PageHeader } from '../../components/ui/Page'
import { useToast } from '../../components/ui/Toast'

interface ProgressBarProps {
  percent: number
}

function ProgressBar({ percent }: ProgressBarProps) {
  return (
    <div className="h-2 bg-neutral-20 rounded-md overflow-hidden w-full">
      <div className="h-full bg-info rounded-md" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  )
}

function formatDateTime(value?: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'

  return new Intl.DateTimeFormat('en-PH', options ?? {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatTime(value?: string | null) {
  return formatDateTime(value, { hour: 'numeric', minute: '2-digit' })
}

function formatTimeOnly(value?: string | null) {
  if (!value) return '--:--'
  const [hours = '0', minutes = '0'] = value.split(':')
  const date = new Date()
  date.setHours(Number(hours), Number(minutes), 0, 0)
  return new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(date)
}

function hours(value: number) {
  return `${Number(value || 0).toFixed(value % 1 === 0 ? 0 : 1)} hr`
}

function balanceNumber(value: number | undefined) {
  return Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
}

const protectedAttendanceStatuses = new Set(['on_leave', 'holiday', 'rest_day', 'absent'])
const leaveTypePriority = new Map([
  ['VACATION', 1],
  ['SICK', 2],
  ['EMERGENCY', 3],
])
const coreLeaveTypeCodes = new Set(leaveTypePriority.keys())

export default function EmployeeDashboardPage() {
  const { showToast } = useToast()
  const [dashboard, setDashboard] = useState<EmployeeDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [punchAction, setPunchAction] = useState<'in' | 'out' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') setIsLoading(true)

    try {
      setError(null)
      const res = await dashboardService.getEmployeeDashboard()
      setDashboard(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard data.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDashboard('initial')
  }, [loadDashboard])

  const punch = async (action: 'in' | 'out') => {
    try {
      setPunchAction(action)
      setError(null)

      if (action === 'in') {
        await attendanceService.clockIn()
        showToast({ variant: 'success', title: 'Time in recorded' })
      } else {
        await attendanceService.clockOut()
        showToast({ variant: 'success', title: 'Time out recorded' })
      }

      await loadDashboard('refresh')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update attendance.')
    } finally {
      setPunchAction(null)
    }
  }

  const attendance = dashboard?.attendanceToday
  const monthly = dashboard?.monthlyAttendance
  const leave = dashboard?.leaveBalance
  const isProtectedAttendance = protectedAttendanceStatuses.has(attendance?.attendanceStatus ?? '')
  const canTimeIn = attendance?.status === 'Not Timed In' && !isProtectedAttendance
  const canTimeOut = attendance?.status === 'Timed In' && !isProtectedAttendance
  const isTimeInDisabled = !canTimeIn || Boolean(punchAction)
  const isTimeOutDisabled = !canTimeOut || Boolean(punchAction)
  const workedPercent = monthly && monthly.expectedHours > 0 ? (monthly.totalHours / monthly.expectedHours) * 100 : 0
  const shortagePercent = monthly && monthly.expectedHours > 0 ? (monthly.shortageHours / monthly.expectedHours) * 100 : 0
  const offsetPercent = monthly && monthly.expectedHours > 0 ? (monthly.offsetEarnedHours / monthly.expectedHours) * 100 : 0

  const { coreLeaveBalanceItems, otherLeaveBalanceItems } = useMemo(() => {
    if (!leave?.items) {
      return {
        coreLeaveBalanceItems: [],
        otherLeaveBalanceItems: [],
      }
    }

    const sortedItems = [...leave.items].sort((a, b) => {
      const priorityA = leaveTypePriority.get(a.code) ?? 99
      const priorityB = leaveTypePriority.get(b.code) ?? 99
      if (priorityA !== priorityB) return priorityA - priorityB
      return a.name.localeCompare(b.name)
    })

    return {
      coreLeaveBalanceItems: sortedItems.filter((item) => coreLeaveTypeCodes.has(item.code)),
      otherLeaveBalanceItems: sortedItems.filter((item) => !coreLeaveTypeCodes.has(item.code)),
    }
  }, [leave])

  if (isLoading) {
    return (
      <Page>
        <div className="h-8 w-40 animate-pulse rounded bg-neutral-30" />
        {[1, 2, 3, 4].map((item) => (
          <Card key={item} className="space-y-4">
            <div className="h-4 w-48 animate-pulse rounded bg-neutral-30" />
            <div className="h-20 animate-pulse rounded bg-neutral-30" />
          </Card>
        ))}
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title="Dashboard"
        subtitle={dashboard?.generatedAt ? `Updated ${formatDateTime(dashboard.generatedAt)}` : 'Your attendance and leave overview.'}
      />

        {error && (
          <FeedbackMessage variant="danger" className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </FeedbackMessage>
        )}
        <Card>
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <p className="text-base font-semibold tracking-tight text-ink">
              Good to see you, {dashboard?.employee.firstName ?? 'Employee'}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {dashboard?.employee.position || 'Position not set'}{dashboard?.employee.department ? `, ${dashboard.employee.department}` : ''}
              </p>
              <p className="mt-2 text-xs text-muted">Attendance status: {attendance?.status ?? 'Unavailable'}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={isTimeInDisabled}
                aria-busy={punchAction === 'in'}
                aria-label="Time In"
                title={isProtectedAttendance ? 'Time in is unavailable for today\'s attendance status.' : undefined}
                onClick={() => punch('in')}
                className="group flex min-w-[180px] items-center gap-3 rounded-lg border border-border bg-success-muted px-3 py-2 text-left transition-colors hover:border-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white">
                  <LogIn size={18} className={punchAction === 'in' ? 'animate-pulse text-success' : 'text-success'} />
                </div>
                <div className="flex flex-col gap-px">
                  <span className="text-xs font-medium leading-[18px] text-neutral-90">{formatTime(attendance?.timeIn)}</span>
                  <span className="text-xs leading-[18px] text-muted">{punchAction === 'in' ? 'Recording time in' : 'Time In'}</span>
                </div>
              </button>
              <button
                type="button"
                disabled={isTimeOutDisabled}
                aria-busy={punchAction === 'out'}
                aria-label="Time Out"
                title={isProtectedAttendance ? 'Time out is unavailable for today\'s attendance status.' : undefined}
                onClick={() => punch('out')}
                className="group flex min-w-[180px] items-center gap-3 rounded-lg border border-border bg-danger-muted px-3 py-2 text-left transition-colors hover:border-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white">
                  <LogOut size={18} className={punchAction === 'out' ? 'animate-pulse text-danger' : 'text-danger'} />
                </div>
                <div className="flex flex-col gap-px">
                  <span className="text-xs font-medium leading-[18px] text-neutral-90">{formatTime(attendance?.timeOut)}</span>
                  <span className="text-xs leading-[18px] text-muted">{punchAction === 'out' ? 'Recording time out' : 'Time Out'}</span>
                </div>
              </button>
            </div>
          </div>
        </Card>

        {coreLeaveBalanceItems.length ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {coreLeaveBalanceItems.map((item) => (
                <Card key={item.id} className="relative overflow-hidden" padding="sm">
                  <div className="absolute inset-y-0 left-0 w-1 bg-brand" aria-hidden="true" />
                  <div className="flex items-start justify-between gap-3 pl-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <CalendarClock size={15} className="flex-shrink-0 text-brand" />
                        <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                      </div>
                      <p className="mt-2 text-xs text-muted">Available balance</p>
                      <p className="text-2xl font-semibold leading-tight text-ink">{balanceNumber(item.remaining ?? item.balance)}</p>
                    </div>
                    <div className="grid min-w-[104px] grid-cols-2 gap-2 text-right">
                      <div>
                        <p className="text-xs text-muted">Pending</p>
                        <p className="text-sm font-medium text-warning">{balanceNumber(item.pendingCredits ?? item.pending)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Used</p>
                        <p className="text-sm font-medium text-neutral-90">{balanceNumber(item.used ?? item.taken)}</p>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
            {otherLeaveBalanceItems.length > 0 && (
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-2 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {otherLeaveBalanceItems.length} other leave balance{otherLeaveBalanceItems.length === 1 ? '' : 's'} available.
                </span>
                <Link to="/employee/leave" className="font-medium text-brand hover:text-brand-700">
                  View on My Leave
                </Link>
              </div>
            )}
          </div>
        ) : (
          <EmptyState title="No leave balances are available yet." />
        )}

        <Card>
          <CardHeader title="Time Log" subtitle="Today and monthly attendance progress." />
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div className="flex flex-col gap-4">
              <p className="text-base font-medium text-neutral-90">Today</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  { label: 'Scheduled in', value: formatTimeOnly(attendance?.scheduledStart) },
                  { label: 'Scheduled out', value: formatTimeOnly(attendance?.scheduledEnd) },
                  { label: 'Worked today', value: hours(attendance?.totalHours ?? 0) },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col gap-2 rounded-lg bg-surface px-4 py-3">
                    <p className="text-sm font-medium text-neutral-90">{item.value}</p>
                    <p className="text-xs text-neutral-60">{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <p className="text-base font-medium text-neutral-90">This month</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  { label: 'Expected time to date', value: hours(monthly?.expectedHours ?? 0), percent: 100 },
                  { label: 'Worked time', value: hours(monthly?.totalHours ?? 0), percent: workedPercent },
                  { label: 'Shortage time', value: hours(monthly?.shortageHours ?? 0), percent: shortagePercent },
                  { label: 'Overtime', value: hours(monthly?.overtimeHours ?? 0), percent: monthly && monthly.expectedHours > 0 ? (monthly.overtimeHours / monthly.expectedHours) * 100 : 0 },
                  { label: 'Offset earned', value: hours(monthly?.offsetEarnedHours ?? 0), percent: offsetPercent },
                  { label: 'Offset used', value: hours(monthly?.offsetUsedHours ?? 0), percent: monthly && monthly.expectedHours > 0 ? (monthly.offsetUsedHours / monthly.expectedHours) * 100 : 0 },
                ].map((item) => (
                  <div key={item.label} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="text-neutral-60">{item.label}</span>
                      <span className="text-neutral-90">{item.value}</span>
                    </div>
                    <ProgressBar percent={item.percent} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card>
            <CardHeader
              title="Attendance Summary"
              subtitle="This month"
              className="mb-4"
            />
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { label: 'Present', value: monthly?.presentDays ?? 0 },
                { label: 'Late', value: monthly?.lateDays ?? 0 },
                { label: 'Absent', value: monthly?.absentDays ?? 0 },
                { label: 'On leave', value: monthly?.leaveDays ?? 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-lg bg-surface p-3">
                  <p className="text-xs text-muted">{item.label}</p>
                  <p className="text-xl font-semibold text-ink">{item.value}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none" className="xl:col-span-2">
            <div className="px-5 py-4">
              <CardHeader title="Announcements" subtitle="Active company notices." className="mb-0" />
            </div>
            {dashboard?.announcements.length ? (
              <Table
                data={dashboard.announcements}
                rowKey={(row) => row.id}
                columns={[
                  { key: 'title', header: 'Title', render: (row) => <span className="font-medium">{row.title}</span> },
                  { key: 'startDate', header: 'Start date', render: (row) => row.startDate ? formatDateTime(row.startDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Always active' },
                  { key: 'endDate', header: 'End date', render: (row) => row.endDate ? formatDateTime(row.endDate, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No end date' },
                  { key: 'message', header: 'Message' },
                ]}
              />
            ) : (
              <div className="px-5 pb-5">
                <EmptyState title="No active announcements right now." icon={<Megaphone size={22} />} />
              </div>
            )}
          </Card>
        </div>
    </Page>
  )
}
