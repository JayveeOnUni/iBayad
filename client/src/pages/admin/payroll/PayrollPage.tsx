import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle,
  DollarSign,
  Download,
  Eye,
  FileText,
  History,
  Play,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Users,
} from 'lucide-react'
import Card, { CardHeader, StatCard } from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Table, { Pagination } from '../../../components/ui/Table'
import Badge from '../../../components/ui/Badge'
import Modal from '../../../components/ui/Modal'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import { EmptyState, FeedbackMessage, PageHeader } from '../../../components/ui/Page'
import { formatDate, formatDateTime } from '../../../utils/dateHelpers'
import { formatPeso } from '../../../utils/taxComputation'
import type { PayFrequency, PayrollAuditEntry, PayrollIssueSummary, PayrollPeriod, PayrollRecord, PayrollStatus } from '../../../types'
import { payrollService } from '../../../services/payrollService'

type PageMessage = {
  variant: 'success' | 'error' | 'warning' | 'info'
  text: string
}

type PayrollAction = 'process' | 'approve' | 'release'

type PeriodForm = {
  name: string
  startDate: string
  endDate: string
  payDate: string
  frequency: PayFrequency
}

const statusVariant: Record<PayrollStatus, 'success' | 'info' | 'neutral' | 'warning' | 'danger'> = {
  released: 'success',
  approved: 'success',
  processing: 'info',
  draft: 'neutral',
  cancelled: 'danger',
}

const messageVariant: Record<PageMessage['variant'], 'success' | 'info' | 'warning' | 'danger'> = {
  success: 'success',
  error: 'danger',
  warning: 'warning',
  info: 'info',
}

const actionPhrase: Record<PayrollAction, string> = {
  process: 'PROCESS',
  approve: 'APPROVE',
  release: 'RELEASE',
}

const today = () => new Date().toISOString().slice(0, 10)

const defaultPayrollIssueSummary: PayrollIssueSummary = {
  criticalIssueCount: 0,
  warningIssueCount: 0,
  totalIssueCount: 0,
}

function defaultForm(): PeriodForm {
  const currentDate = today()
  return {
    name: '',
    startDate: currentDate,
    endDate: currentDate,
    payDate: currentDate,
    frequency: 'semi-monthly',
  }
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ')
}

function actionTitle(action: PayrollAction) {
  if (action === 'process') return 'Process payroll period'
  if (action === 'approve') return 'Approve payroll period'
  return 'Release payroll period'
}

function actionButtonLabel(action: PayrollAction, period: PayrollPeriod) {
  if (action === 'process') return period.status === 'processing' ? 'Reprocess' : 'Process'
  if (action === 'approve') return 'Approve'
  return 'Release'
}

function actionSuccessText(action: PayrollAction) {
  if (action === 'process') return 'Payroll processed.'
  if (action === 'approve') return 'Payroll approved.'
  return 'Payroll released.'
}

function warningBadgeVariant(severity: string): 'info' | 'warning' | 'danger' {
  if (severity === 'danger') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'info'
}

function offsetHours(minutes: number) {
  const hours = (minutes || 0) / 60
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`
}

function validatePeriodForm(form: PeriodForm): string | null {
  if (!form.name.trim()) return 'Payroll period name is required.'
  if (!form.startDate || !form.endDate || !form.payDate) return 'Start date, end date, and pay date are required.'
  if (form.startDate > form.endDate) return 'Start date must be on or before end date.'
  if (form.payDate < form.endDate) return 'Pay date cannot be before the payroll period end date.'

  const start = new Date(`${form.startDate}T00:00:00`)
  const end = new Date(`${form.endDate}T00:00:00`)
  const days = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  const maxDays: Record<PayFrequency, number> = {
    weekly: 7,
    'semi-monthly': 16,
    monthly: 31,
  }
  if (days > maxDays[form.frequency]) {
    return `${form.frequency} payroll periods cannot be longer than ${maxDays[form.frequency]} calendar days.`
  }
  return null
}

function auditLabel(entry: PayrollAuditEntry) {
  return entry.action.replace(/_/g, ' ')
}

function auditDetail(entry: PayrollAuditEntry) {
  if (!entry.newValues || typeof entry.newValues !== 'object') return 'Payroll action recorded.'
  const values = entry.newValues as Record<string, unknown>
  if (values.processed) return `${values.processed} records processed`
  if (values.status && values.totalNetPay) return `Status: ${values.status} - ${formatPeso(Number(values.totalNetPay))}`
  if (values.status) return `Status: ${values.status}`
  return 'Payroll action recorded.'
}

function employeeName(record: PayrollRecord) {
  if (!record.employee) return 'Employee'
  return `${record.employee.firstName} ${record.employee.lastName}`.trim()
}

function getPayrollIssueSummary(period?: PayrollPeriod | null): PayrollIssueSummary {
  if (!period) return defaultPayrollIssueSummary

  const issueSummary = period.issueSummary ?? defaultPayrollIssueSummary
  const warningIssueCount = issueSummary.warningIssueCount ?? period.warningCount ?? period.warnings?.length ?? 0
  const criticalIssueCount = issueSummary.criticalIssueCount ?? 0

  return {
    criticalIssueCount,
    warningIssueCount,
    totalIssueCount: issueSummary.totalIssueCount ?? criticalIssueCount + warningIssueCount,
  }
}

export default function PayrollPage() {
  const [periodPage, setPeriodPage] = useState(1)
  const [recordPage, setRecordPage] = useState(1)
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [periodMeta, setPeriodMeta] = useState({ total: 0, totalPages: 1, limit: 10 })
  const [recordMeta, setRecordMeta] = useState({ total: 0, totalPages: 1, limit: 10 })
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null)
  const [records, setRecords] = useState<PayrollRecord[]>([])
  const [filters, setFilters] = useState<{ status: 'all' | PayrollStatus; year: string; search: string }>({
    status: 'all',
    year: 'all',
    search: '',
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [downloadingRecordId, setDownloadingRecordId] = useState<string | null>(null)
  const [message, setMessage] = useState<PageMessage | null>(null)
  const [isNewOpen, setIsNewOpen] = useState(false)
  const [form, setForm] = useState<PeriodForm>(defaultForm)
  const [confirmAction, setConfirmAction] = useState<{
    action: PayrollAction
    period: PayrollPeriod
    confirmation: string
  } | null>(null)

  const loadPeriods = useCallback(async (options?: { preserveMessage?: boolean; rethrow?: boolean }) => {
    try {
      setIsLoading(true)
      if (!options?.preserveMessage) setMessage(null)
      const res = await payrollService.listPeriods({
        page: periodPage,
        limit: periodMeta.limit,
        ...(filters.status !== 'all' ? { status: filters.status } : {}),
        ...(filters.year !== 'all' ? { year: filters.year } : {}),
        ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
      })
      setPeriods(res.data)
      setPeriodMeta({ total: res.total, totalPages: res.totalPages, limit: res.limit })
      setSelectedPeriodId((current) => current ?? res.data[0]?.id ?? null)
      setSelectedPeriod((current) => {
        if (!current) return current
        const updated = res.data.find((period) => period.id === current.id)
        return updated ? { ...current, ...updated } : current
      })
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Unable to load payroll periods.'
      setMessage({ variant: 'error', text })
      if (options?.rethrow) throw new Error(text)
    } finally {
      setIsLoading(false)
    }
  }, [filters.search, filters.status, filters.year, periodMeta.limit, periodPage])

  const loadPeriodDetails = useCallback(async (
    periodId: string,
    options?: { preserveMessage?: boolean; rethrow?: boolean; page?: number }
  ) => {
    try {
      setIsDetailLoading(true)
      if (!options?.preserveMessage) setMessage(null)
      const pageToLoad = options?.page ?? recordPage
      const [periodRes, recordRes] = await Promise.all([
        payrollService.getPeriod(periodId),
        payrollService.listRecords({ periodId, page: pageToLoad, limit: recordMeta.limit }),
      ])
      setSelectedPeriod(periodRes.data)
      setRecords(recordRes.data)
      setRecordMeta({ total: recordRes.total, totalPages: recordRes.totalPages, limit: recordRes.limit })
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Unable to load payroll period details.'
      setMessage({ variant: 'error', text })
      if (options?.rethrow) throw new Error(text)
    } finally {
      setIsDetailLoading(false)
    }
  }, [recordMeta.limit, recordPage])

  useEffect(() => {
    loadPeriods()
  }, [loadPeriods])

  useEffect(() => {
    if (!selectedPeriodId) return
    loadPeriodDetails(selectedPeriodId)
  }, [loadPeriodDetails, selectedPeriodId])

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const years = new Set<number>()
    for (let i = -1; i <= 4; i++) years.add(currentYear - i)
    periods.forEach((period) => {
      const year = Number(period.startDate.slice(0, 4))
      if (Number.isInteger(year)) years.add(year)
    })
    return Array.from(years).sort((a, b) => b - a)
  }, [periods])

  const focusPeriod = selectedPeriod ?? periods[0]
  const focusIssueSummary = getPayrollIssueSummary(focusPeriod)
  const selectedIssueSummary = getPayrollIssueSummary(selectedPeriod)
  const warnings = selectedPeriod?.warnings ?? []
  const isLoadingValidationDetails = Boolean(selectedPeriod && isDetailLoading && !selectedPeriod.warnings)
  const actionKey = confirmAction ? `${confirmAction.action}:${confirmAction.period.id}` : null
  const canConfirmAction = Boolean(confirmAction && confirmAction.confirmation.trim() === actionPhrase[confirmAction.action])

  const openPeriod = (period: PayrollPeriod) => {
    setSelectedPeriodId(period.id)
    setSelectedPeriod(period)
    setRecordPage(1)
  }

  const updateFilter = (next: Partial<typeof filters>) => {
    setPeriodPage(1)
    setFilters((current) => ({ ...current, ...next }))
  }

  const createPeriod = async () => {
    const validation = validatePeriodForm(form)
    if (validation) {
      setMessage({ variant: 'error', text: validation })
      return
    }

    try {
      setIsSaving(true)
      setMessage(null)
      const created = await payrollService.createPeriod({ ...form })
      setIsNewOpen(false)
      setForm(defaultForm())
      setSelectedPeriodId(created.data.id)
      setRecordPage(1)
      try {
        await loadPeriods({ preserveMessage: true, rethrow: true })
        await loadPeriodDetails(created.data.id, { preserveMessage: true, rethrow: true, page: 1 })
        setMessage({ variant: 'success', text: created.message ?? 'Payroll period created.' })
      } catch (reloadErr) {
        const text = reloadErr instanceof Error ? reloadErr.message : 'The payroll list did not refresh.'
        setMessage({ variant: 'warning', text: `Payroll period created, but refresh failed: ${text}` })
      }
    } catch (err) {
      setMessage({ variant: 'error', text: err instanceof Error ? err.message : 'Unable to create payroll period.' })
    } finally {
      setIsSaving(false)
    }
  }

  const runConfirmedAction = async () => {
    if (!confirmAction) return
    const { action, period } = confirmAction
    const loadingKey = `${action}:${period.id}`

    try {
      setActionLoading(loadingKey)
      setMessage(null)

      let successText = actionSuccessText(action)
      if (action === 'process') {
        const res = await payrollService.processPayroll(period.id)
        successText = res.data.message || res.message || successText
      } else if (action === 'approve') {
        const res = await payrollService.approvePayroll(period.id)
        successText = res.message || successText
      } else {
        const res = await payrollService.markAsPaid(period.id)
        successText = res.message || successText
      }

      setConfirmAction(null)
      setSelectedPeriodId(period.id)
      setRecordPage(1)

      try {
        await loadPeriods({ preserveMessage: true, rethrow: true })
        await loadPeriodDetails(period.id, { preserveMessage: true, rethrow: true, page: 1 })
        setMessage({ variant: 'success', text: successText })
      } catch (reloadErr) {
        const text = reloadErr instanceof Error ? reloadErr.message : 'The payroll workspace did not refresh.'
        setMessage({ variant: 'warning', text: `${successText} Refresh failed: ${text}` })
      }
    } catch (err) {
      setMessage({ variant: 'error', text: err instanceof Error ? err.message : 'Unable to update payroll period.' })
    } finally {
      setActionLoading(null)
    }
  }

  const downloadPayslip = async (record: PayrollRecord) => {
    try {
      setDownloadingRecordId(record.id)
      const res = await payrollService.generatePayslip(record.id)
      if (!res.ok) throw new Error('Unable to download payslip.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `payslip-${record.employee?.employeeNumber ?? record.id}.txt`
      link.click()
      URL.revokeObjectURL(url)
      setMessage({ variant: 'success', text: 'Payslip downloaded.' })
    } catch (err) {
      setMessage({ variant: 'error', text: err instanceof Error ? err.message : 'Unable to download payslip.' })
    } finally {
      setDownloadingRecordId(null)
    }
  }

  const renderActions = (period: PayrollPeriod) => {
    const isBusy = Boolean(actionLoading)
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {(period.status === 'draft' || period.status === 'processing') && (
          <Button
            size="xs"
            leftIcon={<Play size={12} />}
            disabled={isBusy}
            onClick={(event) => {
              event.stopPropagation()
              setConfirmAction({ action: 'process', period, confirmation: '' })
            }}
          >
            {actionButtonLabel('process', period)}
          </Button>
        )}
        {period.status === 'processing' && (
          <Button
            size="xs"
            variant="secondary"
            leftIcon={<CheckCircle size={12} />}
            disabled={isBusy}
            onClick={(event) => {
              event.stopPropagation()
              setConfirmAction({ action: 'approve', period, confirmation: '' })
            }}
          >
            Approve
          </Button>
        )}
        {period.status === 'approved' && (
          <Button
            size="xs"
            variant="success"
            leftIcon={<DollarSign size={12} />}
            disabled={isBusy}
            onClick={(event) => {
              event.stopPropagation()
              setConfirmAction({ action: 'release', period, confirmation: '' })
            }}
          >
            Release
          </Button>
        )}
        <Button
          size="xs"
          variant="ghost"
          leftIcon={<Eye size={12} />}
          onClick={(event) => {
            event.stopPropagation()
            openPeriod(period)
          }}
        >
          View
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payroll"
        subtitle="Operate payroll periods from cutoff creation through payslip release."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<RefreshCcw size={14} />}
              onClick={() => {
                loadPeriods()
                if (selectedPeriodId) loadPeriodDetails(selectedPeriodId)
              }}
              disabled={isLoading || isDetailLoading}
            >
              Refresh
            </Button>
            <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setIsNewOpen(true)}>
              New Period
            </Button>
          </>
        }
      />

      {message && (
        <FeedbackMessage variant={messageVariant[message.variant]}>
          {message.text}
        </FeedbackMessage>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Selected period"
          value={focusPeriod?.name ?? 'No period'}
          delta={focusPeriod ? `${formatDate(focusPeriod.startDate)} - ${formatDate(focusPeriod.endDate)}` : 'Create a payroll period to begin'}
          icon={<CalendarDays size={20} />}
          tone="brand"
        />
        <StatCard
          label="Payroll records"
          value={focusPeriod ? `${focusPeriod.recordCount ?? 0}/${focusPeriod.activeEmployeeCount ?? 0}` : '0/0'}
          delta="Generated records / active employees"
          icon={<Users size={20} />}
          tone="success"
        />
        <StatCard
          label="Net payroll"
          value={formatPeso(focusPeriod?.totalNetPay ?? 0)}
          delta={focusPeriod ? `${formatPeso(focusPeriod.totalGrossPay ?? 0)} gross` : 'No records yet'}
          icon={<DollarSign size={20} />}
          tone="warning"
        />
        <StatCard
          label="Validation issues"
          value={focusIssueSummary.totalIssueCount}
          delta={
            focusIssueSummary.criticalIssueCount > 0
              ? `${focusIssueSummary.criticalIssueCount} critical issue${focusIssueSummary.criticalIssueCount === 1 ? '' : 's'} require review`
              : focusIssueSummary.warningIssueCount > 0
                ? `${focusIssueSummary.warningIssueCount} warning issue${focusIssueSummary.warningIssueCount === 1 ? '' : 's'} reported`
                : 'No blocking warnings reported'
          }
          icon={<AlertTriangle size={20} />}
          tone={focusIssueSummary.totalIssueCount > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <Card padding="none">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 xl:flex-row xl:items-end xl:justify-between">
          <CardHeader title="Payroll Periods" subtitle="Cutoff summaries and protected actions" className="mb-0" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:min-w-[640px]">
            <Input
              label="Search"
              value={filters.search}
              leftAddon={<Search size={14} />}
              onChange={(event) => updateFilter({ search: event.target.value })}
              placeholder="Period name"
            />
            <Select
              label="Year"
              value={filters.year}
              onChange={(event) => updateFilter({ year: event.target.value })}
            >
              <option value="all">All years</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </Select>
            <Select
              label="Status"
              value={filters.status}
              onChange={(event) => updateFilter({ status: event.target.value as 'all' | PayrollStatus })}
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="processing">Processing</option>
              <option value="approved">Approved</option>
              <option value="released">Released</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
        </div>

        <Table
          data={periods}
          rowKey={(row) => row.id}
          onRowClick={openPeriod}
          isLoading={isLoading}
          emptyMessage="No payroll periods match the current filters."
          columns={[
            {
              key: 'name',
              header: 'Period',
              render: (row) => (
                <div>
                  <p className="text-sm font-medium text-ink">{row.name}</p>
                  <p className="text-xs text-muted">
                    {formatDate(row.startDate)} - {formatDate(row.endDate)}
                  </p>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <Badge variant={statusVariant[row.status] ?? 'neutral'} dot>
                  {statusLabel(row.status)}
                </Badge>
              ),
            },
            {
              key: 'records',
              header: 'Records',
              render: (row) => (
                <span className="text-sm font-medium">
                  {row.recordCount ?? 0}/{row.activeEmployeeCount ?? 0}
                </span>
              ),
            },
            {
              key: 'gross',
              header: 'Gross',
              render: (row) => <span className="text-sm">{formatPeso(row.totalGrossPay ?? 0)}</span>,
            },
            {
              key: 'net',
              header: 'Net',
              render: (row) => <span className="text-sm font-semibold">{formatPeso(row.totalNetPay ?? 0)}</span>,
            },
            {
              key: 'issues',
              header: 'Issues',
              render: (row) => {
                const issueSummary = getPayrollIssueSummary(row)
                return (
                  <Badge
                    variant={
                      issueSummary.criticalIssueCount > 0
                        ? 'danger'
                        : issueSummary.totalIssueCount > 0
                          ? 'warning'
                          : 'neutral'
                    }
                  >
                    {issueSummary.totalIssueCount}
                  </Badge>
                )
              },
            },
            {
              key: 'payDate',
              header: 'Pay Date',
              render: (row) => <span className="text-sm">{formatDate(row.payDate)}</span>,
            },
            {
              key: 'actions',
              header: '',
              className: 'min-w-[280px]',
              render: renderActions,
            },
          ]}
        />
        <Pagination
          page={periodPage}
          totalPages={periodMeta.totalPages}
          total={periodMeta.total}
          limit={periodMeta.limit}
          onPageChange={setPeriodPage}
        />
      </Card>

      {!selectedPeriod && !isDetailLoading && (
        <EmptyState
          title="Select a payroll period."
          description="Period records, warnings, and audit history will appear here."
          icon={<FileText size={22} />}
        />
      )}

      {selectedPeriod && (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
            <Card>
              <CardHeader
                title={selectedPeriod.name}
                subtitle={`${formatDate(selectedPeriod.startDate)} - ${formatDate(selectedPeriod.endDate)} | Pay date ${formatDate(selectedPeriod.payDate)}`}
                action={
                  <Badge variant={statusVariant[selectedPeriod.status] ?? 'neutral'} dot>
                    {statusLabel(selectedPeriod.status)}
                  </Badge>
                }
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Gross Pay</p>
                  <p className="mt-1 text-lg font-semibold text-ink">{formatPeso(selectedPeriod.totalGrossPay ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Deductions</p>
                  <p className="mt-1 text-lg font-semibold text-danger">{formatPeso(selectedPeriod.totalDeductions ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Net Pay</p>
                  <p className="mt-1 text-lg font-semibold text-brand">{formatPeso(selectedPeriod.totalNetPay ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Records</p>
                  <p className="mt-1 text-lg font-semibold text-ink">
                    {selectedPeriod.recordCount ?? 0}/{selectedPeriod.activeEmployeeCount ?? 0}
                  </p>
                </div>
              </div>

              <div className="mt-5 border-t border-border pt-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className="text-warning" />
                    <p className="text-sm font-semibold text-ink">Validation summary</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={selectedIssueSummary.criticalIssueCount > 0 ? 'danger' : 'neutral'}>
                      Critical: {selectedIssueSummary.criticalIssueCount}
                    </Badge>
                    <Badge variant={selectedIssueSummary.warningIssueCount > 0 ? 'warning' : 'neutral'}>
                      Warnings: {selectedIssueSummary.warningIssueCount}
                    </Badge>
                  </div>
                </div>
                {isLoadingValidationDetails ? (
                  <p className="rounded-md border border-border bg-neutral-20 px-3 py-2 text-sm text-muted">
                    Loading payroll validation details...
                  </p>
                ) : warnings.length === 0 ? (
                  <p className="rounded-md border border-border bg-neutral-20 px-3 py-2 text-sm text-muted">
                    {selectedIssueSummary.totalIssueCount > 0
                      ? `Validation summary reports ${selectedIssueSummary.totalIssueCount} issue${selectedIssueSummary.totalIssueCount === 1 ? '' : 's'}, but no detailed messages were returned for this payroll period.`
                      : 'No warnings reported for this payroll period.'}
                  </p>
                ) : (
                  <div className="divide-y divide-border rounded-md border border-border">
                    {warnings.map((warning) => (
                      <div key={warning.code} className="flex items-start gap-3 px-3 py-3">
                        <Badge variant={warningBadgeVariant(warning.severity)}>
                          {warning.severity}
                        </Badge>
                        <p className="text-sm leading-6 text-ink">{warning.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Audit History"
                subtitle="Latest period events"
                action={<History size={17} className="text-muted" />}
              />
              {selectedPeriod.auditHistory?.length ? (
                <div className="space-y-3">
                  {selectedPeriod.auditHistory.map((entry) => (
                    <div key={entry.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                      <p className="text-sm font-medium capitalize text-ink">{auditLabel(entry)}</p>
                      <p className="text-xs leading-5 text-muted">{auditDetail(entry)}</p>
                      <p className="text-xs text-muted">
                        {entry.actorEmail ?? 'System'} - {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">No audit events recorded yet.</p>
              )}
            </Card>
          </div>

          <Card padding="none">
            <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <CardHeader
                title="Payroll Records"
                subtitle={`${recordMeta.total} employee record${recordMeta.total === 1 ? '' : 's'}`}
                className="mb-0"
              />
              {isDetailLoading && <span className="text-sm text-muted">Loading details...</span>}
            </div>
            <Table
              data={records}
              rowKey={(record) => record.id}
              isLoading={isDetailLoading}
              emptyMessage="No payroll records have been generated for this period."
              columns={[
                {
                  key: 'employee',
                  header: 'Employee',
                  render: (record) => (
                    <div>
                      <p className="text-sm font-medium text-ink">{employeeName(record)}</p>
                      <p className="text-xs text-muted">{record.employee?.employeeNumber ?? record.employeeId}</p>
                    </div>
                  ),
                },
                {
                  key: 'grossPay',
                  header: 'Gross',
                  render: (record) => <span className="text-sm">{formatPeso(record.grossPay)}</span>,
                },
                {
                  key: 'deductions',
                  header: 'Deductions',
                  render: (record) => <span className="text-sm text-danger">{formatPeso(record.totalDeductions)}</span>,
                },
                {
                  key: 'netPay',
                  header: 'Net',
                  render: (record) => <span className="text-sm font-semibold">{formatPeso(record.netPay)}</span>,
                },
                {
                  key: 'offsets',
                  header: 'Offsets',
                  render: (record) => (
                    <span className="text-sm">
                      +{offsetHours(record.offsetEarnedMinutes)} / -{offsetHours(record.offsetUsedMinutes)}
                    </span>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (record) => (
                    <Badge variant={statusVariant[record.status] ?? 'neutral'} dot>
                      {statusLabel(record.status)}
                    </Badge>
                  ),
                },
                {
                  key: 'payslip',
                  header: '',
                  render: (record) => (
                    <Button
                      size="xs"
                      variant="ghost"
                      leftIcon={<Download size={12} />}
                      isLoading={downloadingRecordId === record.id}
                      disabled={record.status !== 'released' || Boolean(downloadingRecordId)}
                      onClick={() => downloadPayslip(record)}
                    >
                      Payslip
                    </Button>
                  ),
                },
              ]}
            />
            <Pagination
              page={recordPage}
              totalPages={recordMeta.totalPages}
              total={recordMeta.total}
              limit={recordMeta.limit}
              onPageChange={setRecordPage}
            />
          </Card>
        </>
      )}

      <Modal
        isOpen={isNewOpen}
        onClose={() => setIsNewOpen(false)}
        title="New Payroll Period"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsNewOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={createPeriod} isLoading={isSaving}>Create Period</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Name" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          <Select
            label="Frequency"
            required
            value={form.frequency}
            onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value as PayFrequency }))}
          >
            <option value="weekly">Weekly</option>
            <option value="semi-monthly">Semi-monthly</option>
            <option value="monthly">Monthly</option>
          </Select>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Start Date" type="date" required value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
            <Input label="End Date" type="date" required value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
          </div>
          <Input label="Pay Date" type="date" required value={form.payDate} onChange={(event) => setForm((current) => ({ ...current, payDate: event.target.value }))} />
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(confirmAction)}
        onClose={() => {
          if (!actionLoading) setConfirmAction(null)
        }}
        title={confirmAction ? actionTitle(confirmAction.action) : ''}
        description={confirmAction?.period.name}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmAction(null)} disabled={Boolean(actionLoading)}>Cancel</Button>
            <Button
              variant={confirmAction?.action === 'release' ? 'success' : 'primary'}
              leftIcon={<ShieldCheck size={14} />}
              disabled={!canConfirmAction}
              isLoading={Boolean(actionKey && actionLoading === actionKey)}
              onClick={runConfirmedAction}
            >
              {confirmAction ? actionButtonLabel(confirmAction.action, confirmAction.period) : 'Confirm'}
            </Button>
          </>
        }
      >
        {confirmAction && (
          <div className="space-y-4">
            <div className="rounded-md border border-warning-border bg-warning-muted px-3 py-3 text-sm leading-6 text-ink">
              This action changes payroll records for {confirmAction.period.recordCount ?? 0} employee
              {(confirmAction.period.recordCount ?? 0) === 1 ? '' : 's'} with a net total of {formatPeso(confirmAction.period.totalNetPay ?? 0)}.
            </div>
            <Input
              label={`Type ${actionPhrase[confirmAction.action]} to confirm`}
              value={confirmAction.confirmation}
              onChange={(event) => setConfirmAction((current) => current ? { ...current, confirmation: event.target.value } : current)}
              autoFocus
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
