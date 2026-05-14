import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  Megaphone,
  Plus,
  RefreshCw,
  Users,
  WalletCards,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { dashboardService } from '../../services/dashboardService'
import { useAuthStore } from '../../store/authStore'
import type { AdminDashboardData } from '../../types'
import Badge, { statusBadge } from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card, { CardHeader, StatCard } from '../../components/ui/Card'
import Table from '../../components/ui/Table'
import { EmptyState, FeedbackMessage, Page, PageHeader } from '../../components/ui/Page'
import { formatPeso } from '../../utils/taxComputation'

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral'
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'
type AttendanceDashboardFilter = 'present' | 'late' | 'absent' | 'on_leave' | 'missing'

const severityBadge: Record<string, BadgeTone> = {
  info: 'info',
  warning: 'warning',
  danger: 'danger',
}

const approvalBadge: Record<AdminDashboardData['approvalQueue'][number]['type'], BadgeTone> = {
  leave: 'warning',
  attendance: 'info',
  payroll: 'danger',
}

function asDate(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
}

function formatDate(value?: string | null) {
  if (!value) return 'Not scheduled'
  const date = asDate(value)
  if (Number.isNaN(date.getTime())) return 'Not scheduled'
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not available'
  const date = asDate(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatPercent(value: number) {
  return `${Number(value || 0).toFixed(value % 1 === 0 ? 0 : 1)}%`
}

function plural(value: number, singular: string, pluralLabel = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralLabel}`
}

function labelize(value: string) {
  return value.replace(/_/g, ' ')
}

function ProgressBar({ percent, tone }: { percent: number; tone: Exclude<Tone, 'neutral'> }) {
  const toneClass: Record<Exclude<Tone, 'neutral'>, string> = {
    brand: 'bg-brand',
    success: 'bg-success',
    warning: 'bg-secondary',
    danger: 'bg-danger',
  }

  return (
    <div className="h-2.5 overflow-hidden rounded-md bg-neutral-30">
      <div
        className={`h-full rounded-md ${toneClass[tone]}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}

function LoadingDashboard() {
  return (
    <Page>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="h-8 w-56 animate-pulse rounded bg-neutral-30" />
          <div className="h-4 w-72 animate-pulse rounded bg-neutral-30" />
        </div>
        <div className="h-9 w-32 animate-pulse rounded bg-neutral-30" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Card key={item} className="space-y-4">
            <div className="h-4 w-28 animate-pulse rounded bg-neutral-30" />
            <div className="h-8 w-20 animate-pulse rounded bg-neutral-30" />
          </Card>
        ))}
      </div>
      {[1, 2, 3].map((item) => (
        <Card key={item} className="space-y-4">
          <div className="h-4 w-44 animate-pulse rounded bg-neutral-30" />
          <div className="h-24 animate-pulse rounded bg-neutral-30" />
        </Card>
      ))}
    </Page>
  )
}

export default function AdminDashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') setIsLoading(true)
    if (mode === 'refresh') setIsRefreshing(true)

    try {
      setError(null)
      const res = await dashboardService.getAdminDashboard()
      setDashboard(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load admin dashboard.')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadDashboard('initial')
  }, [loadDashboard])

  const keyStats = useMemo(() => {
    if (!dashboard) return []
    const attentionCount =
      dashboard.attendanceToday.missingAttendance +
      dashboard.attendanceToday.incompletePunches +
      dashboard.attendanceToday.absentToday +
      dashboard.attendanceToday.lateToday
    const readinessTone: Tone = dashboard.attendanceReadiness.isPayrollReady
      ? 'success'
      : dashboard.attendanceReadiness.completionRate >= 90
        ? 'warning'
        : 'danger'

    return [
      {
        label: 'Needs attention today',
        value: attentionCount,
        delta: attentionCount ? 'Attendance exceptions found' : 'No attendance exceptions',
        tone: attentionCount ? 'warning' as Tone : 'success' as Tone,
        icon: <FileWarning size={20} />,
      },
      {
        label: 'Attendance readiness',
        value: formatPercent(dashboard.attendanceReadiness.completionRate),
        delta: dashboard.attendanceReadiness.isPayrollReady
          ? 'Ready for payroll'
          : `${plural(dashboard.attendanceReadiness.missingEmployeeDays, 'employee-day')} missing`,
        tone: readinessTone,
        icon: <ClipboardCheck size={20} />,
      },
      {
        label: 'Blocking approvals',
        value: dashboard.approvals.totalPending,
        delta: dashboard.approvals.totalPending ? 'Requires admin review' : 'No pending approvals',
        tone: dashboard.approvals.totalPending ? 'danger' as Tone : 'success' as Tone,
        icon: <CheckCircle2 size={20} />,
      },
      {
        label: 'Next pay date',
        value: dashboard.payroll.nextPayDate ? formatDate(dashboard.payroll.nextPayDate) : 'Not scheduled',
        delta: dashboard.payroll.daysUntilPayDate == null
          ? 'Create or schedule a payroll period'
          : dashboard.payroll.daysUntilPayDate === 0
            ? 'Pay date is today'
            : `In ${plural(dashboard.payroll.daysUntilPayDate, 'day')}`,
        tone: dashboard.payroll.nextPayDate ? 'brand' as Tone : 'neutral' as Tone,
        icon: <WalletCards size={20} />,
      },
    ]
  }, [dashboard])

  if (isLoading) return <LoadingDashboard />

  if (!dashboard) {
    return (
      <Page>
        <PageHeader
          title="Admin Dashboard"
          subtitle="Operational HR and payroll overview."
          actions={
            <Button size="sm" onClick={() => loadDashboard()} leftIcon={<RefreshCw size={14} />}>
              Retry
            </Button>
          }
        />
        {error && (
          <FeedbackMessage variant="danger" className="flex items-start gap-2">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </FeedbackMessage>
        )}
        <EmptyState title="Dashboard data is unavailable." />
      </Page>
    )
  }

  const firstName = user?.firstName ?? 'Admin'
  const payrollPeriod = dashboard.payroll.currentPeriod
  const attendanceFilterDate = dashboard.attendanceToday.date || dashboard.today
  const readinessTone: Exclude<Tone, 'neutral'> = dashboard.attendanceReadiness.isPayrollReady
    ? 'success'
    : dashboard.attendanceReadiness.completionRate >= 90
      ? 'warning'
      : 'danger'
  const openAttendanceFilter = (status: AttendanceDashboardFilter) => {
    const params = new URLSearchParams({ date: attendanceFilterDate, status })
    navigate(`/admin/attendance/daily?${params.toString()}`)
  }

  return (
    <Page>
      <PageHeader
        title="Admin Dashboard"
        subtitle={`Updated ${formatDateTime(dashboard.generatedAt)}`}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadDashboard()}
              isLoading={isRefreshing}
              leftIcon={<RefreshCw size={14} />}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => navigate('/admin/employees')}
              leftIcon={<Plus size={14} />}
            >
              Add Employee
            </Button>
          </>
        }
      />

      {error && (
        <FeedbackMessage variant="danger" className="flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </FeedbackMessage>
      )}

      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-base font-semibold tracking-tight text-ink">Good to see you, {firstName}</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              {formatDate(dashboard.today)} is tracking {plural(dashboard.workforce.activeEmployees, 'active employee')} with
              {' '}{plural(dashboard.attendanceToday.onLeaveToday, 'person', 'people')} on approved leave.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:min-w-[620px] lg:grid-cols-5">
            {[
              { label: 'Present', value: dashboard.attendanceToday.presentToday, status: 'present' as const },
              { label: 'Late', value: dashboard.attendanceToday.lateToday, status: 'late' as const },
              { label: 'Absent', value: dashboard.attendanceToday.absentToday, status: 'absent' as const },
              { label: 'On Leave', value: dashboard.attendanceToday.onLeaveToday, status: 'on_leave' as const },
              { label: 'Missing', value: dashboard.attendanceToday.missingAttendance, status: 'missing' as const },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => openAttendanceFilter(item.status)}
                className="rounded-lg border border-transparent bg-surface px-4 py-3 text-left transition duration-150 hover:-translate-y-0.5 hover:border-brand-200 hover:bg-brand-50/70 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 active:translate-y-0"
              >
                <p className="text-xl font-semibold text-ink">{item.value}</p>
                <p className="text-xs text-muted">{item.label}</p>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {keyStats.map((stat) => (
          <StatCard
            key={stat.label}
            label={stat.label}
            value={stat.value}
            delta={stat.delta}
            tone={stat.tone}
            icon={stat.icon}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Who Needs Attention Today"
            subtitle="Employees with missing records, late arrivals, absences, or incomplete time logs."
            action={
              <Button size="xs" variant="outline" onClick={() => navigate('/admin/attendance/daily')}>
                Daily Log
              </Button>
            }
          />
          {dashboard.employeesNeedingAttention.length ? (
            <div className="divide-y divide-border">
              {dashboard.employeesNeedingAttention.map((employee) => (
                <div key={employee.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{employee.name}</p>
                      <Badge variant={severityBadge[employee.severity]}>{labelize(employee.type)}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {employee.employeeNumber}
                      {employee.department ? `, ${employee.department}` : ''}
                      {employee.position ? `, ${employee.position}` : ''}
                    </p>
                  </div>
                  <p className="text-sm text-muted sm:max-w-xs sm:text-right">{employee.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center">
              <CheckCircle2 className="mx-auto mb-2 text-success" size={24} />
              <p className="text-sm font-medium text-ink">No employee attendance exceptions today.</p>
              <p className="mt-1 text-sm text-muted">The daily log is clean based on current records.</p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Payroll Period" subtitle="Current period and next pay date." />
          {payrollPeriod ? (
            <div className="space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{payrollPeriod.name}</p>
                  {statusBadge(payrollPeriod.status)}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {formatDate(payrollPeriod.startDate)} to {formatDate(payrollPeriod.endDate)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-surface p-3">
                  <p className="text-xs text-muted">Pay date</p>
                  <p className="mt-1 font-semibold text-ink">{formatDate(payrollPeriod.payDate)}</p>
                </div>
                <div className="rounded-lg bg-surface p-3">
                  <p className="text-xs text-muted">Records</p>
                  <p className="mt-1 font-semibold text-ink">
                    {payrollPeriod.processedRecordCount}/{payrollPeriod.recordCount}
                  </p>
                </div>
                <div className="col-span-2 rounded-lg bg-surface p-3">
                  <p className="text-xs text-muted">Net payroll total</p>
                  <p className="mt-1 text-lg font-semibold text-ink">{formatPeso(payrollPeriod.totalNetPay)}</p>
                </div>
              </div>
              <Button size="sm" variant="outline" fullWidth onClick={() => navigate('/admin/payroll')}>
                Open Payroll
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center">
              <WalletCards className="mx-auto mb-2 text-muted" size={24} />
              <p className="text-sm font-medium text-ink">No active payroll period today.</p>
              <p className="mt-1 text-sm text-muted">
                {dashboard.payroll.nextPayDate
                  ? `Next scheduled pay date is ${formatDate(dashboard.payroll.nextPayDate)}.`
                  : 'Create a payroll period to start tracking readiness.'}
              </p>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader
            title="Attendance Readiness"
            subtitle={
              payrollPeriod
                ? `${formatDate(dashboard.attendanceReadiness.periodStart)} to ${formatDate(dashboard.attendanceReadiness.evaluatedThrough)}`
                : 'No active payroll period. Showing today only.'
            }
          />
          <div className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-ink">{formatPercent(dashboard.attendanceReadiness.completionRate)} complete</span>
                <span className="text-muted">
                  {dashboard.attendanceReadiness.completedEmployeeDays}/{dashboard.attendanceReadiness.expectedEmployeeDays}
                </span>
              </div>
              <ProgressBar percent={dashboard.attendanceReadiness.completionRate} tone={readinessTone} />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-surface p-3">
                <p className="text-xs text-muted">Missing days</p>
                <p className="mt-1 text-xl font-semibold text-ink">{dashboard.attendanceReadiness.missingEmployeeDays}</p>
              </div>
              <div className="rounded-lg bg-surface p-3">
                <p className="text-xs text-muted">Today complete</p>
                <p className="mt-1 text-xl font-semibold text-ink">{formatPercent(dashboard.attendanceToday.completionRate)}</p>
              </div>
            </div>
            <FeedbackMessage variant={dashboard.attendanceReadiness.isPayrollReady ? 'success' : 'warning'}>
              {dashboard.attendanceReadiness.isPayrollReady
                ? 'Attendance is complete enough for the evaluated payroll window.'
                : `${plural(dashboard.attendanceReadiness.missingEmployeeDays, 'employee-day')} still needs attendance or approved leave.`}
            </FeedbackMessage>
          </div>
        </Card>

        <Card padding="none" className="xl:col-span-2">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <CardHeader title="Approval Blockers" subtitle="Requests currently blocking HR or payroll work." className="mb-0" />
            <div className="flex flex-wrap gap-2">
              <Badge variant={dashboard.approvals.pendingLeaveRequests ? 'warning' : 'success'}>
                {dashboard.approvals.pendingLeaveRequests} leave
              </Badge>
              <Badge variant={dashboard.approvals.pendingAttendanceRequests ? 'warning' : 'success'}>
                {dashboard.approvals.pendingAttendanceRequests} attendance
              </Badge>
              <Badge variant={dashboard.approvals.payrollPeriodsForApproval ? 'danger' : 'success'}>
                {dashboard.approvals.payrollPeriodsForApproval} payroll
              </Badge>
            </div>
          </div>
          <Table
            data={dashboard.approvalQueue}
            rowKey={(row) => `${row.type}-${row.id}`}
            emptyMessage="No pending approvals are blocking payroll."
            columns={[
              {
                key: 'type',
                header: 'Type',
                render: (row) => <Badge variant={approvalBadge[row.type]}>{row.type}</Badge>,
              },
              {
                key: 'request',
                header: 'Request',
                render: (row) => (
                  <div>
                    <p className="font-medium text-ink">{row.title}</p>
                    <p className="text-xs text-muted">{formatDateTime(row.requestedAt)}</p>
                  </div>
                ),
              },
              {
                key: 'employee',
                header: 'Employee',
                render: (row) => row.employeeName ? `${row.employeeName} (${row.employeeNumber})` : 'Payroll',
              },
              { key: 'detail', header: 'Detail' },
              {
                key: 'action',
                header: '',
                render: (row) => (
                  <Button size="xs" variant="ghost" onClick={() => navigate(row.actionPath)}>
                    Open
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      </div>

      <Card padding="none">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <CardHeader title="Active Company Notices" subtitle="Currently visible announcements." className="mb-0" />
          <Button size="xs" variant="outline" onClick={() => navigate('/admin/administration/announcements')} leftIcon={<Megaphone size={13} />}>
            Manage Notices
          </Button>
        </div>
        <Table
          data={dashboard.announcements}
          rowKey={(row) => row.id}
          emptyMessage="No company notices are active right now."
          columns={[
            {
              key: 'title',
              header: 'Title',
              render: (row) => (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.title}</span>
                  {row.isPinned && <Badge variant="info">Pinned</Badge>}
                </div>
              ),
            },
            { key: 'startDate', header: 'Start date', render: (row) => row.startDate ? formatDate(row.startDate) : 'Always active' },
            { key: 'endDate', header: 'End date', render: (row) => row.endDate ? formatDate(row.endDate) : 'No end date' },
            { key: 'message', header: 'Message' },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total employees"
          value={dashboard.workforce.totalEmployees}
          delta={`${dashboard.workforce.inactiveEmployees} inactive`}
          icon={<Users size={20} />}
          tone="neutral"
        />
        <StatCard
          label="Active notices"
          value={dashboard.announcements.length}
          delta="Currently visible"
          icon={<Megaphone size={20} />}
          tone="brand"
        />
        <StatCard
          label="Active payroll period"
          value={payrollPeriod ? 'Open' : 'None'}
          delta={payrollPeriod ? payrollPeriod.name : 'Create a period when ready'}
          icon={<CalendarDays size={20} />}
          tone={payrollPeriod ? 'success' : 'neutral'}
        />
      </div>
    </Page>
  )
}
