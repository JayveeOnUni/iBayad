import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle,
  DollarSign,
  Download,
  Eye,
  FileText,
  History,
  Lock,
  Play,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Undo2,
  Users,
} from 'lucide-react'
import Card, { CardHeader, StatCard } from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Table, { Pagination } from '../../../components/ui/Table'
import Badge from '../../../components/ui/Badge'
import Modal from '../../../components/ui/Modal'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import Textarea from '../../../components/ui/Textarea'
import { EmptyState, FeedbackMessage, PageHeader } from '../../../components/ui/Page'
import { formatDate, formatDateTime } from '../../../utils/dateHelpers'
import { formatPeso } from '../../../utils/taxComputation'
import type {
  PayFrequency,
  PayrollAuditEntry,
  PayrollCalculationSnapshot,
  PayrollPeriod,
  PayrollRecord,
  PayrollReport,
  PayrollReportType,
  PayrollStatus,
  PayrollValidationReport,
} from '../../../types'
import { payrollService } from '../../../services/payrollService'
import { useAuthStore } from '../../../store/authStore'

type PageMessage = {
  variant: 'success' | 'error' | 'warning' | 'info'
  text: string
}

type PayrollAction = 'process' | 'approve' | 'release' | 'correction'

type PeriodForm = {
  name: string
  startDate: string
  endDate: string
  payDate: string
  frequency: PayFrequency
}

const statusVariant: Record<PayrollStatus, 'success' | 'info' | 'neutral' | 'warning' | 'danger'> = {
  locked: 'success',
  released: 'success',
  approved: 'success',
  ready_for_approval: 'info',
  processed: 'info',
  processing: 'info',
  validation_failed: 'danger',
  needs_correction: 'warning',
  draft: 'neutral',
  cancelled: 'danger',
  voided: 'danger',
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
  correction: 'CORRECTION',
}

const payrollPermissionsByRole: Record<string, string[] | '*'> = {
  admin: '*',
  super_admin: '*',
  payroll_preparer: ['create_period', 'process', 'validate', 'reprocess', 'void_record', 'view', 'view_payslips', 'view_reports', 'export_reports'],
  payroll_approver: ['validate', 'approve', 'request_correction', 'void_record', 'view', 'view_payslips', 'view_reports', 'export_reports'],
  payroll_releaser: ['release', 'view', 'view_payslips', 'view_reports'],
  auditor: ['view', 'view_payslips', 'view_reports', 'export_reports', 'view_audit_logs'],
}

function hasPayrollPermission(role: string | undefined, permission: string) {
  const permissions = role ? payrollPermissionsByRole[role] : undefined
  return permissions === '*' || Boolean(permissions?.includes(permission))
}

const today = () => new Date().toISOString().slice(0, 10)

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
  if (action === 'correction') return 'Request payroll correction'
  return 'Release payroll period'
}

function actionButtonLabel(action: PayrollAction, period: PayrollPeriod) {
  if (action === 'process') return period.recordCount ? 'Reprocess' : 'Process'
  if (action === 'approve') return 'Approve'
  if (action === 'correction') return 'Correction'
  return 'Release'
}

function actionSuccessText(action: PayrollAction) {
  if (action === 'process') return 'Payroll processed.'
  if (action === 'approve') return 'Payroll approved.'
  if (action === 'correction') return 'Payroll marked for correction.'
  return 'Payroll released.'
}

function warningBadgeVariant(severity: string): 'info' | 'warning' | 'danger' {
  if (severity === 'danger') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'info'
}

function shortRuleVersion(value?: string) {
  if (!value) return 'No rule'
  return value.split('|').map((part) => part.replace(/BIR-RR-11-2018-2023-/, 'BIR-')).join(' | ')
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

const reportTypes: Array<{ type: PayrollReportType; label: string }> = [
  { type: 'summary', label: 'Summary' },
  { type: 'employees', label: 'Employee Payroll' },
  { type: 'government-contributions', label: 'Government' },
  { type: 'tax', label: 'Tax' },
  { type: 'attendance', label: 'Attendance' },
]

function prettyColumn(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function renderReportValue(key: string, value: unknown) {
  const amountLike = /(pay|deduction|tax|share|contribution|income|amount|balance|gross|net|scheduled)/i.test(key)
  if (amountLike && Number.isFinite(Number(value))) return formatPeso(Number(value))
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  return value == null || value === '' ? '—' : String(value)
}

export default function PayrollPage() {
  const currentUser = useAuthStore((state) => state.user)
  const [periodPage, setPeriodPage] = useState(1)
  const [recordPage, setRecordPage] = useState(1)
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [periodMeta, setPeriodMeta] = useState({ total: 0, totalPages: 1, limit: 10 })
  const [recordMeta, setRecordMeta] = useState({ total: 0, totalPages: 1, limit: 10 })
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null)
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null)
  const [records, setRecords] = useState<PayrollRecord[]>([])
  const [validationReport, setValidationReport] = useState<PayrollValidationReport | null>(null)
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
    notes: string
  } | null>(null)
  const [snapshotModal, setSnapshotModal] = useState<{
    record: PayrollRecord
    snapshots: PayrollCalculationSnapshot[]
  } | null>(null)
  const [voidRecordConfirm, setVoidRecordConfirm] = useState<{
    record: PayrollRecord
    confirmation: string
    reason: string
  } | null>(null)
  const [reportType, setReportType] = useState<PayrollReportType>('summary')
  const [report, setReport] = useState<PayrollReport | null>(null)
  const [reportFilters, setReportFilters] = useState<{ status: 'all' | PayrollStatus; search: string }>({
    status: 'all',
    search: '',
  })
  const [isReportLoading, setIsReportLoading] = useState(false)
  const canCreatePeriod = hasPayrollPermission(currentUser?.role, 'create_period')
  const canProcessPayroll = hasPayrollPermission(currentUser?.role, 'process')
  const canValidatePayroll = hasPayrollPermission(currentUser?.role, 'validate')
  const canApprovePayroll = hasPayrollPermission(currentUser?.role, 'approve')
  const canRequestCorrection = hasPayrollPermission(currentUser?.role, 'request_correction')
  const canReleasePayroll = hasPayrollPermission(currentUser?.role, 'release')
  const canViewAudit = hasPayrollPermission(currentUser?.role, 'view_audit_logs')
  const canViewReports = hasPayrollPermission(currentUser?.role, 'view_reports')
  const canExportReports = hasPayrollPermission(currentUser?.role, 'export_reports')
  const canVoidRecord = hasPayrollPermission(currentUser?.role, 'void_record')

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
      const [periodRes, recordRes, validationRes] = await Promise.all([
        payrollService.getPeriod(periodId),
        payrollService.listRecords({ periodId, page: pageToLoad, limit: recordMeta.limit }),
        canValidatePayroll
          ? payrollService.getValidation(periodId)
          : Promise.resolve({ data: null }),
      ])
      setSelectedPeriod(periodRes.data)
      setRecords(recordRes.data)
      setValidationReport(validationRes.data)
      setRecordMeta({ total: recordRes.total, totalPages: recordRes.totalPages, limit: recordRes.limit })
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Unable to load payroll period details.'
      setMessage({ variant: 'error', text })
      if (options?.rethrow) throw new Error(text)
    } finally {
      setIsDetailLoading(false)
    }
  }, [canValidatePayroll, recordMeta.limit, recordPage])

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
  const warnings = selectedPeriod?.warnings ?? []
  const selectedValidationIssues = validationReport
    ? (validationReport.periodId === selectedPeriod?.id ? validationReport.issues : [])
    : []
  const focusValidationReport = validationReport?.periodId === focusPeriod?.id ? validationReport : null
  const hasCriticalValidationIssues =
    !!validationReport &&
    validationReport.periodId === selectedPeriod?.id &&
    validationReport.criticalIssueCount > 0
  const actionKey = confirmAction ? `${confirmAction.action}:${confirmAction.period.id}` : null
  const needsActionNotes = Boolean(confirmAction && (
    confirmAction.action === 'correction' ||
    (confirmAction.action === 'process' && ((confirmAction.period.recordCount ?? 0) > 0 || confirmAction.period.status !== 'draft'))
  ))
  const canConfirmAction = Boolean(
    confirmAction &&
    confirmAction.confirmation.trim() === actionPhrase[confirmAction.action] &&
    (!needsActionNotes || confirmAction.notes.trim().length > 0)
  )
  const canConfirmVoidRecord = Boolean(
    voidRecordConfirm &&
    voidRecordConfirm.confirmation.trim() === 'VOID' &&
    voidRecordConfirm.reason.trim().length > 0
  )

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

  const validateSelectedPayroll = async () => {
    if (!selectedPeriod) return
    try {
      setActionLoading(`validate:${selectedPeriod.id}`)
      setMessage(null)
      const res = await payrollService.validatePeriod(selectedPeriod.id)
      setValidationReport(res.data)
      await loadPeriods({ preserveMessage: true })
      await loadPeriodDetails(selectedPeriod.id, { preserveMessage: true })
      setMessage({
        variant: res.data.isValid ? 'success' : 'warning',
        text: res.data.isValid ? 'Validation Passed' : 'Validation Issues Found. Fix Issues Before Approval.',
      })
    } catch (err) {
      setMessage({ variant: 'error', text: err instanceof Error ? err.message : 'Unable to validate payroll.' })
    } finally {
      setActionLoading(null)
    }
  }

  const runConfirmedAction = async () => {
    if (!confirmAction) return
    const { action, period, notes } = confirmAction
    const loadingKey = `${action}:${period.id}`

    try {
      setActionLoading(loadingKey)
      setMessage(null)

      let successText = actionSuccessText(action)
      if (action === 'process') {
        const res = await payrollService.processPayroll(period.id, notes.trim() || undefined)
        successText = res.data.message || res.message || successText
      } else if (action === 'approve') {
        const res = await payrollService.approvePayroll(period.id, notes.trim() || undefined)
        successText = res.message || successText
      } else if (action === 'correction') {
        const res = await payrollService.requestCorrection(period.id, notes.trim())
        successText = res.message || successText
      } else {
        const res = await payrollService.markAsPaid(period.id, notes.trim() || undefined)
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
      link.download = `payslip-${record.employee?.employeeNumber ?? record.id}.pdf`
      link.click()
      URL.revokeObjectURL(url)
      setMessage({ variant: 'success', text: 'Payslip downloaded.' })
    } catch (err) {
      setMessage({ variant: 'error', text: err instanceof Error ? err.message : 'Unable to download payslip.' })
    } finally {
      setDownloadingRecordId(null)
    }
  }

  const viewSnapshots = async (record: PayrollRecord) => {
    try {
      setActionLoading(`snapshots:${record.id}`)
      const res = await payrollService.listRecordSnapshots(record.id)
      setSnapshotModal({ record, snapshots: res.data })
    } catch (err) {
      setMessage({ variant: 'error', text: err instanceof Error ? err.message : 'Unable to load calculation snapshots.' })
    } finally {
      setActionLoading(null)
    }
  }

  const runVoidRecord = async () => {
    if (!voidRecordConfirm || !selectedPeriod) return
    const { record, reason } = voidRecordConfirm
    try {
      setActionLoading(`void:${record.id}`)
      setMessage(null)
      const res = await payrollService.voidRecord(record.id, reason.trim())
      setVoidRecordConfirm(null)
      await loadPeriods({ preserveMessage: true })
      await loadPeriodDetails(selectedPeriod.id, { preserveMessage: true })
      setMessage({ variant: 'success', text: res.message ?? 'Payroll record voided.' })
    } catch (err) {
      setMessage({ variant: 'error', text: err instanceof Error ? err.message : 'Unable to void payroll record.' })
    } finally {
      setActionLoading(null)
    }
  }

  const loadReport = async () => {
    if (!selectedPeriod || !canViewReports) return
    try {
      setIsReportLoading(true)
      setMessage(null)
      const res = await payrollService.getPayrollReport(selectedPeriod.id, reportType, {
        ...(reportFilters.status !== 'all' ? { status: reportFilters.status } : {}),
        ...(reportFilters.search.trim() ? { search: reportFilters.search.trim() } : {}),
      })
      setReport(res.data)
    } catch (err) {
      setReport(null)
      setMessage({ variant: 'error', text: err instanceof Error ? err.message : 'Unable to load payroll report.' })
    } finally {
      setIsReportLoading(false)
    }
  }

  const exportReport = async () => {
    if (!selectedPeriod || !canExportReports) return
    try {
      setActionLoading(`export:${reportType}`)
      const res = await payrollService.exportPayrollReport(selectedPeriod.id, reportType, {
        ...(reportFilters.status !== 'all' ? { status: reportFilters.status } : {}),
        ...(reportFilters.search.trim() ? { search: reportFilters.search.trim() } : {}),
      })
      if (!res.ok) throw new Error('Unable to export report.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const disposition = res.headers.get('content-disposition') ?? ''
      const match = /filename="?([^"]+)"?/i.exec(disposition)
      link.href = url
      link.download = match?.[1] ?? `${reportType}-${selectedPeriod.startDate}-to-${selectedPeriod.endDate}.csv`
      link.click()
      URL.revokeObjectURL(url)
      setMessage({ variant: 'success', text: 'Report exported.' })
    } catch (err) {
      setMessage({ variant: 'error', text: err instanceof Error ? err.message : 'Unable to export report.' })
    } finally {
      setActionLoading(null)
    }
  }

  useEffect(() => {
    if (!selectedPeriod || !canViewReports) {
      setReport(null)
      return
    }
    loadReport()
  }, [selectedPeriod?.id, reportType, reportFilters.status, reportFilters.search, canViewReports])

  const renderActions = (period: PayrollPeriod) => {
    const isBusy = Boolean(actionLoading)
    const approveBlocked = Boolean(
      period.status === 'ready_for_approval' &&
      validationReport?.periodId === period.id &&
      validationReport.criticalIssueCount > 0
    )
    const isLocked = period.isLocked || period.status === 'locked'
    const canProcess = canProcessPayroll && ['draft', 'processing', 'processed', 'validation_failed', 'needs_correction'].includes(period.status) && !isLocked
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canProcess && (
          <Button
            size="xs"
            leftIcon={<Play size={12} />}
            disabled={isBusy}
            onClick={(event) => {
              event.stopPropagation()
              setConfirmAction({ action: 'process', period, confirmation: '', notes: '' })
            }}
          >
            {actionButtonLabel('process', period)}
          </Button>
        )}
        {canApprovePayroll && period.status === 'ready_for_approval' && (
          <Button
            size="xs"
            variant="secondary"
            leftIcon={<CheckCircle size={12} />}
            disabled={isBusy || approveBlocked}
            title={approveBlocked ? 'Fix validation issues before approval' : undefined}
            onClick={(event) => {
              event.stopPropagation()
              setConfirmAction({ action: 'approve', period, confirmation: '', notes: '' })
            }}
          >
            Approve
          </Button>
        )}
        {canRequestCorrection && ['processed', 'validation_failed', 'ready_for_approval', 'approved'].includes(period.status) && !isLocked && (
          <Button
            size="xs"
            variant="outline"
            leftIcon={<Undo2 size={12} />}
            disabled={isBusy}
            onClick={(event) => {
              event.stopPropagation()
              setConfirmAction({ action: 'correction', period, confirmation: '', notes: '' })
            }}
          >
            Correction
          </Button>
        )}
        {canReleasePayroll && period.status === 'approved' && (
          <Button
            size="xs"
            variant="success"
            leftIcon={<DollarSign size={12} />}
            disabled={isBusy}
            onClick={(event) => {
              event.stopPropagation()
              setConfirmAction({ action: 'release', period, confirmation: '', notes: '' })
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
            {canCreatePeriod && (
              <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setIsNewOpen(true)}>
                New Period
              </Button>
            )}
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
          label="Validation"
          value={focusValidationReport ? focusValidationReport.criticalIssueCount : focusPeriod?.warningCount ?? 0}
          delta={focusValidationReport
            ? (focusValidationReport.isValid ? 'Validation Passed' : 'Fix Issues Before Approval')
            : 'Validate before approval'}
          icon={<AlertTriangle size={20} />}
          tone={hasCriticalValidationIssues ? 'danger' : 'neutral'}
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
              <option value="processed">Processed</option>
              <option value="validation_failed">Validation failed</option>
              <option value="ready_for_approval">Ready for approval</option>
              <option value="needs_correction">Needs correction</option>
              <option value="approved">Approved</option>
              <option value="released">Released</option>
              <option value="locked">Locked</option>
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
              key: 'warnings',
              header: 'Warnings',
              render: (row) => (
                <Badge variant={(row.warningCount ?? 0) > 0 ? 'warning' : 'neutral'}>
                  {row.warningCount ?? 0}
                </Badge>
              ),
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

              {(selectedPeriod.isLocked || selectedPeriod.status === 'locked') && (
                <div className="mt-5 flex items-start gap-3 rounded-md border border-success-border bg-success-muted px-3 py-3 text-sm text-ink">
                  <Lock size={16} className="mt-0.5 text-success" />
                  <div>
                    <p className="font-semibold">Locked Payroll</p>
                    <p className="text-muted">
                      Released payroll is read-only. Payslips remain available, but recalculation and edits are blocked.
                    </p>
                  </div>
                </div>
              )}

              <div className="mt-5 border-t border-border pt-5">
                <p className="mb-3 text-sm font-semibold text-ink">Payroll Status Timeline</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                  {[
                    ['Created', selectedPeriod.createdAt],
                    ['Processed', selectedPeriod.processedAt],
                    ['Validated', selectedPeriod.validatedAt],
                    ['Reprocessed', selectedPeriod.reprocessedAt],
                    ['Approved', selectedPeriod.approvedAt],
                    ['Released', selectedPeriod.releasedAt],
                    ['Locked', selectedPeriod.lockedAt],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border border-border px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
                      <p className="mt-1 text-xs text-ink">{value ? formatDateTime(value) : 'Pending'}</p>
                    </div>
                  ))}
                </div>
                {(selectedPeriod.approvalNotes || selectedPeriod.correctionNotes || selectedPeriod.reprocessReason || selectedPeriod.lockedReason) && (
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    {selectedPeriod.approvalNotes && <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">Approval: {selectedPeriod.approvalNotes}</p>}
                    {selectedPeriod.correctionNotes && <p className="rounded-md border border-warning-border bg-warning-muted px-3 py-2 text-sm text-ink">Correction: {selectedPeriod.correctionNotes}</p>}
                    {selectedPeriod.reprocessReason && <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">Reprocess: {selectedPeriod.reprocessReason}</p>}
                    {selectedPeriod.lockedReason && <p className="rounded-md border border-border px-3 py-2 text-sm text-muted">Lock: {selectedPeriod.lockedReason}</p>}
                  </div>
                )}
              </div>

              <div className="mt-5 border-t border-border pt-5">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className={hasCriticalValidationIssues ? 'text-danger' : 'text-success'} />
                    <p className="text-sm font-semibold text-ink">Payroll Validation</p>
                    {validationReport?.periodId === selectedPeriod.id && (
                      <Badge variant={validationReport.isValid ? 'success' : 'danger'}>
                        {validationReport.isValid ? 'Validation Passed' : 'Validation Issues Found'}
                      </Badge>
                    )}
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    leftIcon={<ShieldCheck size={12} />}
                    isLoading={actionLoading === `validate:${selectedPeriod.id}`}
                    disabled={Boolean(actionLoading) || !canValidatePayroll}
                    title={!canValidatePayroll ? 'You do not have permission to validate payroll' : undefined}
                    onClick={validateSelectedPayroll}
                  >
                    Validate Payroll
                  </Button>
                </div>
                {validationReport?.periodId === selectedPeriod.id && (
                  <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                    <div className="rounded-md border border-border px-3 py-2">
                      <p className="text-xs text-muted">Complete Attendance</p>
                      <p className="text-sm font-semibold text-ink">
                        {validationReport.attendance.completeEmployees}/{validationReport.attendance.totalEmployees}
                      </p>
                    </div>
                    <div className="rounded-md border border-border px-3 py-2">
                      <p className="text-xs text-muted">Unrecorded Attendance</p>
                      <p className="text-sm font-semibold text-danger">
                        {validationReport.attendance.employeesWithMissingAttendance}
                      </p>
                    </div>
                    <div className="rounded-md border border-border px-3 py-2">
                      <p className="text-xs text-muted">Negative Net Pay</p>
                      <p className="text-sm font-semibold text-danger">
                        {validationReport.payroll.employeesWithNegativeNetPay}
                      </p>
                    </div>
                    <div className="rounded-md border border-border px-3 py-2">
                      <p className="text-xs text-muted">Rule Versions</p>
                      <p className={`text-sm font-semibold ${validationReport.statutory.isComplete ? 'text-success' : 'text-danger'}`}>
                        {validationReport.statutory.isComplete ? 'Complete' : `${validationReport.statutory.missingRules.length} missing`}
                      </p>
                    </div>
                    <div className="rounded-md border border-border px-3 py-2">
                      <p className="text-xs text-muted">Leave Adjustments</p>
                      <p className="text-sm font-semibold text-ink">
                        {validationReport.leaveAdjustments.unappliedLeaveAdjustments} unapplied
                      </p>
                    </div>
                    <div className="rounded-md border border-border px-3 py-2">
                      <p className="text-xs text-muted">Taxable Income</p>
                      <p className="text-sm font-semibold text-danger">
                        {validationReport.payroll.employeesWithInvalidTaxableIncome}
                      </p>
                    </div>
                  </div>
                )}
                {(selectedValidationIssues.length === 0 && warnings.length === 0) ? (
                  <p className="rounded-md border border-border bg-neutral-20 px-3 py-2 text-sm text-muted">
                    No validation issues reported for this payroll period.
                  </p>
                ) : (
                  <div className="divide-y divide-border rounded-md border border-border">
                    {(selectedValidationIssues.length ? selectedValidationIssues : warnings).map((warning) => (
                      <div key={warning.code} className="flex items-start gap-3 px-3 py-3">
                        <Badge variant={warning.severity === 'critical' ? 'danger' : warningBadgeVariant(warning.severity)}>
                          {warning.severity === 'critical' ? 'critical' : warning.severity}
                        </Badge>
                        <p className="text-sm leading-6 text-ink">{warning.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {canViewAudit && (
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
            )}
          </div>

          {canViewReports && (
            <Card padding="none">
              <div className="flex flex-col gap-3 border-b border-border px-5 py-4 xl:flex-row xl:items-end xl:justify-between">
                <CardHeader
                  title="Reports and Export Center"
                  subtitle={report ? `Generated ${formatDateTime(report.generatedAt)}` : 'Backend-approved payroll records and calculation snapshots'}
                  className="mb-0"
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:min-w-[680px]">
                  <Input
                    label="Employee Search"
                    value={reportFilters.search}
                    leftAddon={<Search size={14} />}
                    onChange={(event) => setReportFilters((current) => ({ ...current, search: event.target.value }))}
                    placeholder="Name or ID"
                  />
                  <Select
                    label="Status"
                    value={reportFilters.status}
                    onChange={(event) => setReportFilters((current) => ({ ...current, status: event.target.value as 'all' | PayrollStatus }))}
                  >
                    <option value="all">All statuses</option>
                    <option value="processed">Processed</option>
                    <option value="approved">Approved</option>
                    <option value="released">Released</option>
                    <option value="locked">Locked</option>
                  </Select>
                  <Button
                    className="self-end"
                    variant="outline"
                    leftIcon={<Download size={14} />}
                    disabled={!canExportReports || isReportLoading || !report}
                    isLoading={actionLoading === `export:${reportType}`}
                    onClick={exportReport}
                  >
                    Export CSV
                  </Button>
                </div>
              </div>

              <div className="border-b border-border px-5 py-3">
                <div className="flex flex-wrap gap-2">
                  {reportTypes.map((item) => (
                    <Button
                      key={item.type}
                      size="xs"
                      variant={reportType === item.type ? 'primary' : 'outline'}
                      onClick={() => setReportType(item.type)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>

              {report && (
                <div className="grid grid-cols-1 gap-3 border-b border-border px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
                  {Object.entries(report.totals)
                    .filter(([key]) => /(pay|deduction|tax|share|contribution|income|amount|balance|gross|net|employee_count)/i.test(key))
                    .slice(0, 4)
                    .map(([key, value]) => (
                      <div key={key} className="rounded-md border border-border px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{prettyColumn(key)}</p>
                        <p className="mt-1 text-sm font-semibold text-ink">
                          {key === 'employee_count' ? Number(value).toLocaleString() : formatPeso(value)}
                        </p>
                      </div>
                    ))}
                </div>
              )}

              <Table
                data={report?.rows ?? []}
                rowKey={(_row, index) => `${reportType}-${index}`}
                isLoading={isReportLoading}
                emptyMessage="No report rows match the selected filters."
                columns={(report?.rows[0] ? Object.keys(report.rows[0]) : ['report'])
                  .slice(0, 10)
                  .map((key) => ({
                    key,
                    header: prettyColumn(key),
                    render: (row: Record<string, unknown>) => (
                      <span className="text-sm">{renderReportValue(key, row[key])}</span>
                    ),
                  }))}
              />
            </Card>
          )}

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
                  render: (record) => (
                    <div>
                      <p className="text-sm">{formatPeso(record.grossPay)}</p>
                      <p className="text-xs text-muted">{formatPeso(record.taxableEarnings)} taxable</p>
                    </div>
                  ),
                },
                {
                  key: 'deductions',
                  header: 'Deductions',
                  render: (record) => (
                    <div>
                      <p className="text-sm text-danger">{formatPeso(record.totalDeductions)}</p>
                      <p className="text-xs text-muted">{formatPeso(record.statutoryDeductions)} statutory</p>
                    </div>
                  ),
                },
                {
                  key: 'leave',
                  header: 'Leave',
                  render: (record) => (
                    <div className="text-sm">
                      <p className="text-danger">{formatPeso(record.leaveDeduction)} leave</p>
                    </div>
                  ),
                },
                {
                  key: 'tax',
                  header: 'Tax',
                  render: (record) => (
                    <div>
                      <p className="text-sm">{formatPeso(record.taxableIncome)}</p>
                      <p className="text-xs text-danger">{formatPeso(record.withholdingTax)} withheld</p>
                    </div>
                  ),
                },
                {
                  key: 'employer',
                  header: 'Employer Share',
                  render: (record) => <span className="text-sm">{formatPeso(record.employerContributions)}</span>,
                },
                {
                  key: 'netPay',
                  header: 'Net',
                  render: (record) => <span className="text-sm font-semibold">{formatPeso(record.netPay)}</span>,
                },
                {
                  key: 'rules',
                  header: 'Rule Version',
                  render: (record) => (
                    <span className="block max-w-[220px] text-xs text-muted">{shortRuleVersion(record.statutoryRuleVersion)}</span>
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
                  render: (record) => {
                    const periodLocked = selectedPeriod?.isLocked || ['released', 'locked'].includes(selectedPeriod?.status ?? '')
                    const recordClosed = record.isLocked || ['released', 'locked', 'cancelled', 'voided'].includes(record.status)
                    const canVoidThisRecord = canVoidRecord && !periodLocked && !recordClosed
                    return (
                      <div className="flex items-center justify-end gap-2">
                        {canViewAudit && (
                          <Button
                            size="xs"
                            variant="ghost"
                            leftIcon={<History size={12} />}
                            isLoading={actionLoading === `snapshots:${record.id}`}
                            onClick={() => viewSnapshots(record)}
                          >
                            Snapshots
                          </Button>
                        )}
                        {canVoidRecord && (
                          <Button
                            size="xs"
                            variant="danger"
                            leftIcon={<Ban size={12} />}
                            disabled={!canVoidThisRecord || Boolean(actionLoading)}
                            onClick={() => setVoidRecordConfirm({ record, confirmation: '', reason: '' })}
                          >
                            Void
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="ghost"
                          leftIcon={<Download size={12} />}
                          isLoading={downloadingRecordId === record.id}
                          disabled={!['released', 'locked'].includes(record.status) || Boolean(downloadingRecordId)}
                          onClick={() => downloadPayslip(record)}
                        >
                          Payslip
                        </Button>
                      </div>
                    )
                  },
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
              disabled={!canConfirmAction || (confirmAction?.action === 'approve' && hasCriticalValidationIssues)}
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
            {confirmAction.action === 'release' && (
              <FeedbackMessage variant="warning">
                Release automatically locks this payroll period and its records. Normal recalculation, edits, and deletion will be blocked.
              </FeedbackMessage>
            )}
            {confirmAction.action === 'approve' && hasCriticalValidationIssues && (
              <FeedbackMessage variant="danger">
                Fix Issues Before Approval. Run validation and complete the listed attendance, leave, salary, or payroll records first.
              </FeedbackMessage>
            )}
            <Textarea
              label={
                confirmAction.action === 'approve'
                  ? 'Approval notes'
                  : confirmAction.action === 'correction'
                    ? 'Correction notes'
                    : confirmAction.action === 'process' && ((confirmAction.period.recordCount ?? 0) > 0 || confirmAction.period.status !== 'draft')
                      ? 'Reprocessing reason'
                      : 'Notes'
              }
              required={needsActionNotes}
              value={confirmAction.notes}
              onChange={(event) => setConfirmAction((current) => current ? { ...current, notes: event.target.value } : current)}
              placeholder="Record the business reason or review notes"
            />
            <Input
              label={`Type ${actionPhrase[confirmAction.action]} to confirm`}
              value={confirmAction.confirmation}
              onChange={(event) => setConfirmAction((current) => current ? { ...current, confirmation: event.target.value } : current)}
              autoFocus
            />
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(voidRecordConfirm)}
        onClose={() => {
          if (!actionLoading) setVoidRecordConfirm(null)
        }}
        title="Void payroll record"
        description={voidRecordConfirm ? employeeName(voidRecordConfirm.record) : ''}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setVoidRecordConfirm(null)} disabled={Boolean(actionLoading)}>Cancel</Button>
            <Button
              variant="danger"
              leftIcon={<Ban size={14} />}
              disabled={!canConfirmVoidRecord}
              isLoading={Boolean(voidRecordConfirm && actionLoading === `void:${voidRecordConfirm.record.id}`)}
              onClick={runVoidRecord}
            >
              Void Record
            </Button>
          </>
        }
      >
        {voidRecordConfirm && (
          <div className="space-y-4">
            <FeedbackMessage variant="danger">
              Voiding keeps the record for audit history but removes it from payroll totals, reports, approvals, and payslip generation.
            </FeedbackMessage>
            <Textarea
              label="Void reason"
              required
              value={voidRecordConfirm.reason}
              onChange={(event) => setVoidRecordConfirm((current) => current ? { ...current, reason: event.target.value } : current)}
              placeholder="Record the business reason for voiding this payroll record"
            />
            <Input
              label="Type VOID to confirm"
              value={voidRecordConfirm.confirmation}
              onChange={(event) => setVoidRecordConfirm((current) => current ? { ...current, confirmation: event.target.value } : current)}
              autoFocus
            />
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(snapshotModal)}
        onClose={() => setSnapshotModal(null)}
        title="Calculation Snapshot History"
        description={snapshotModal ? employeeName(snapshotModal.record) : undefined}
        size="lg"
        footer={<Button variant="outline" onClick={() => setSnapshotModal(null)}>Close</Button>}
      >
        {snapshotModal?.snapshots.length ? (
          <div className="space-y-3">
            {snapshotModal.snapshots.map((snapshot) => (
              <div key={snapshot.id} className="rounded-md border border-border px-3 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-ink">Version {snapshot.snapshotVersion}</p>
                    <p className="text-xs text-muted">{formatDateTime(snapshot.computedAt)} - {snapshot.formulaVersion}</p>
                  </div>
                  <Badge variant="neutral">{snapshot.snapshotHash.slice(0, 12)}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <p className="rounded-md bg-neutral-20 px-3 py-2 text-sm text-ink">Gross {formatPeso(snapshot.grossPay)}</p>
                  <p className="rounded-md bg-neutral-20 px-3 py-2 text-sm text-ink">Deductions {formatPeso(snapshot.totalDeductions)}</p>
                  <p className="rounded-md bg-neutral-20 px-3 py-2 text-sm font-semibold text-brand">Net {formatPeso(snapshot.netPay)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No calculation snapshots are recorded for this payroll record.</p>
        )}
      </Modal>
    </div>
  )
}
