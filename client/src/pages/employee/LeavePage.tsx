import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, CalendarDays, FileCheck2, Send } from 'lucide-react'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Input from '../../components/ui/Input'
import { leaveService } from '../../services/leaveService'
import { format } from '../../utils/dateHelpers'
import type { LeaveApplication, LeaveApplicationFormData, LeaveBalance, LeaveTypeConfig } from '../../types'

const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  approved: 'success',
  pending: 'warning',
  rejected: 'danger',
  cancelled: 'default',
}

const emergencyReasons = [
  { value: 'family_accident_hospitalization_serious_sickness', label: 'Family accident, hospitalization, or serious sickness' },
  { value: 'natural_calamity', label: 'Natural calamity or fortuitous event' },
  { value: 'extraordinary_situation', label: 'Fire, robbery, kidnapping, eviction, or similar' },
]

const relationships = [
  { value: 'spouse', label: 'Spouse' },
  { value: 'parents', label: 'Parents' },
  { value: 'siblings', label: 'Siblings' },
  { value: 'parents_in_law', label: 'Parents-in-law' },
]

const initialForm: LeaveApplicationFormData = {
  leaveTypeId: '',
  startDate: '',
  endDate: '',
  reason: '',
  notificationMethod: 'email',
  acknowledgedPolicy: false,
  documentTypes: [],
}

function resultErrorMessage(result: PromiseRejectedResult) {
  return result.reason instanceof Error ? result.reason.message : 'Unable to load leave records.'
}

export default function EmployeeLeavePage() {
  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeConfig[]>([])
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [requests, setRequests] = useState<LeaveApplication[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [form, setForm] = useState<LeaveApplicationFormData>(initialForm)
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)

  const selectedType = leaveTypes.find((leaveType) => leaveType.id === form.leaveTypeId)
  const selectedCode = selectedType?.code

  const loadLeave = async () => {
    setIsLoading(true)
    const [typeResult, balanceResult, requestResult] = await Promise.allSettled([
      leaveService.getTypes(),
      leaveService.getMyBalances(),
      leaveService.getMyApplications(),
    ])

    if (typeResult.status === 'fulfilled') {
      setLeaveTypes(typeResult.value.data)
    }
    if (balanceResult.status === 'fulfilled') {
      setBalances(balanceResult.value.data)
    }
    if (requestResult.status === 'fulfilled') {
      setRequests(requestResult.value.data)
    }

    const firstError = [typeResult, balanceResult, requestResult].find((result) => result.status === 'rejected')
    if (firstError?.status === 'rejected') {
      setMessage(resultErrorMessage(firstError))
    }
    setIsLoading(false)
  }

  useEffect(() => {
    loadLeave()
  }, [])

  useEffect(() => {
    const canPreview = form.leaveTypeId && form.startDate && form.endDate && form.reason.length >= 5
    if (!canPreview) {
      setPreview(null)
      return
    }
    const handle = window.setTimeout(async () => {
      try {
        const res = await leaveService.preview(form)
        setPreview(res.data)
      } catch (err) {
        setPreview({ errors: [err instanceof Error ? err.message : 'Unable to preview leave request.'] })
      }
    }, 450)
    return () => window.clearTimeout(handle)
  }, [form])

  const summary = useMemo(() => {
    const byCode = (code: string) => balances.find((balance) => balance.code === code)
    return [
      { label: 'Vacation', balance: byCode('VACATION'), tone: 'text-emerald-700' },
      { label: 'Sick', balance: byCode('SICK'), tone: 'text-sky-700' },
      { label: 'Emergency unpaid preview', balance: byCode('EMERGENCY'), tone: 'text-amber-700' },
      { label: 'Bereavement', balance: byCode('BEREAVEMENT'), tone: 'text-slate-700' },
    ]
  }, [balances])

  const previewErrors = Array.isArray(preview?.errors) ? preview.errors.map(String) : []
  const previewWarnings = Array.isArray(preview?.warnings) ? preview.warnings.map(String) : []
  const deduction = (preview?.deduction ?? {}) as Record<string, unknown>

  const toggleDocument = (documentType: string, checked: boolean) => {
    setForm((current) => {
      const documentTypes = new Set(current.documentTypes ?? [])
      if (checked) documentTypes.add(documentType)
      else documentTypes.delete(documentType)
      return { ...current, documentTypes: Array.from(documentTypes) }
    })
  }

  const submitLeave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    try {
      setIsSubmitting(true)
      setMessage(null)
      await leaveService.apply(form)
      setForm(initialForm)
      setPreview(null)
      setMessage('Leave request submitted for review.')
      await loadLeave()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to submit leave request.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-ink">My Leave</h2>
        <p className="text-sm text-muted mt-0.5">Balances, requests, and policy checks from the 2022 leave memo</p>
      </div>

      {message && <div className="text-sm text-ink bg-slate-50 border border-border rounded-lg px-4 py-3">{message}</div>}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {summary.map((item) => (
          <Card key={item.label}>
            <p className="text-sm text-muted">{item.label}</p>
            <p className={`text-2xl font-bold mt-1 ${item.tone}`}>{item.balance?.remaining ?? 0}</p>
            <p className="text-xs text-muted mt-1">
              Earned {item.balance?.earnedCredits ?? 0} · Used {item.balance?.used ?? 0} · Pending {item.balance?.pendingCredits ?? 0}
            </p>
          </Card>
        ))}
      </div>

      <div className="grid xl:grid-cols-[minmax(0,440px)_1fr] gap-5">
        <Card>
          <form onSubmit={submitLeave} className="space-y-4">
            <div className="flex items-center gap-2">
              <CalendarDays size={17} className="text-brand" />
              <h3 className="text-sm font-semibold text-ink">Submit Leave Request</h3>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink">Leave Type</label>
              <select
                value={form.leaveTypeId}
                onChange={(e) => setForm((current) => ({ ...current, leaveTypeId: e.target.value }))}
                required
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200 bg-white"
              >
                <option value="">Select leave type...</option>
                {leaveTypes.map((leaveType) => (
                  <option key={leaveType.id} value={leaveType.id}>{leaveType.name}</option>
                ))}
              </select>
              {selectedType?.policyNotes && <p className="text-xs text-amber-700">{selectedType.policyNotes}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input label="Start Date" type="date" required value={form.startDate} onChange={(e) => setForm((current) => ({ ...current, startDate: e.target.value }))} />
              <Input label="End Date" type="date" required value={form.endDate} onChange={(e) => setForm((current) => ({ ...current, endDate: e.target.value }))} />
            </div>

            {(selectedCode === 'SICK' || selectedCode === 'EMERGENCY') && (
              <div className="grid grid-cols-2 gap-3">
                <Input label="Notice Sent At" type="datetime-local" required value={form.notificationAt ?? ''} onChange={(e) => setForm((current) => ({ ...current, notificationAt: e.target.value }))} />
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-ink">Notice Method</label>
                  <select value={form.notificationMethod ?? 'email'} onChange={(e) => setForm((current) => ({ ...current, notificationMethod: e.target.value }))} className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-white">
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="viber">Viber</option>
                    <option value="skype">Skype</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="messenger">Facebook Messenger</option>
                    <option value="call">Call</option>
                  </select>
                </div>
              </div>
            )}

            {selectedCode === 'EMERGENCY' && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-ink">Emergency Reason</label>
                <select required value={form.emergencyReasonCategory ?? ''} onChange={(e) => setForm((current) => ({ ...current, emergencyReasonCategory: e.target.value }))} className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-white">
                  <option value="">Select category...</option>
                  {emergencyReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                </select>
              </div>
            )}

            {selectedCode === 'SICK' && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={Boolean(form.isContagious)} onChange={(e) => setForm((current) => ({ ...current, isContagious: e.target.checked }))} className="h-4 w-4 rounded border-border" />
                  Contagious disease
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={form.documentTypes?.includes('MEDICAL_CERTIFICATE') ?? false} onChange={(e) => toggleDocument('MEDICAL_CERTIFICATE', e.target.checked)} className="h-4 w-4 rounded border-border" />
                  Medical certificate attached
                </label>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={form.documentTypes?.includes('MEDICAL_CLEARANCE') ?? false} onChange={(e) => toggleDocument('MEDICAL_CLEARANCE', e.target.checked)} className="h-4 w-4 rounded border-border" />
                  Medical clearance attached
                </label>
              </div>
            )}

            {selectedType?.requiresDocument && selectedCode !== 'SICK' && (
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={form.documentTypes?.includes('SUPPORTING_DOCUMENT') ?? false} onChange={(e) => toggleDocument('SUPPORTING_DOCUMENT', e.target.checked)} className="h-4 w-4 rounded border-border" />
                Supporting document attached
              </label>
            )}

            {selectedCode === 'BEREAVEMENT' && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-ink">Relationship</label>
                <select required value={form.relationshipToDeceased ?? ''} onChange={(e) => setForm((current) => ({ ...current, relationshipToDeceased: e.target.value }))} className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-white">
                  <option value="">Select relationship...</option>
                  {relationships.map((relationship) => <option key={relationship.value} value={relationship.value}>{relationship.label}</option>)}
                </select>
              </div>
            )}

            {(selectedCode === 'MATERNITY' || selectedCode === 'PATERNITY') && (
              <div className="grid grid-cols-2 gap-3">
                <Input label="Delivery Date" type="date" required value={form.deliveryDate ?? ''} onChange={(e) => setForm((current) => ({ ...current, deliveryDate: e.target.value }))} />
                <Input label={selectedCode === 'MATERNITY' ? 'Delivery Count' : 'Spouse Delivery Count'} type="number" min={1} max={4} required value={selectedCode === 'MATERNITY' ? form.deliveryCount ?? '' : form.spouseDeliveryCount ?? ''} onChange={(e) => setForm((current) => selectedCode === 'MATERNITY' ? { ...current, deliveryCount: Number(e.target.value) } : { ...current, spouseDeliveryCount: Number(e.target.value) })} />
              </div>
            )}

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-ink">Reason</label>
              <textarea rows={4} required minLength={5} value={form.reason} onChange={(e) => setForm((current) => ({ ...current, reason: e.target.value }))} className="w-full px-3 py-2 text-sm border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>

            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" checked={Boolean(form.acknowledgedPolicy)} onChange={(e) => setForm((current) => ({ ...current, acknowledgedPolicy: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-border" />
              I acknowledge the leave policy and document requirements.
            </label>

            {(previewErrors.length > 0 || previewWarnings.length > 0 || preview) && (
              <div className="rounded-lg border border-border bg-slate-50 p-3 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <FileCheck2 size={15} />
                  Policy Preview
                </div>
                {previewErrors.map((error) => <p key={error} className="text-xs text-red-700">{error}</p>)}
                {previewWarnings.map((warning) => <p key={warning} className="text-xs text-amber-700">{warning}</p>)}
                <p className="text-xs text-muted">
                  Sick {Number(deduction.deductedSickDays ?? 0)} · Vacation {Number(deduction.deductedVacationDays ?? 0)} · Unpaid {Number(deduction.unpaidDays ?? 0)}
                </p>
              </div>
            )}

            <Button type="submit" leftIcon={<Send size={14} />} isLoading={isSubmitting} disabled={previewErrors.length > 0}>
              Submit Request
            </Button>
          </form>
        </Card>

        <Card padding="none">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">Leave History</h3>
            <Badge variant="default">{requests.length}</Badge>
          </div>
          <div className="divide-y divide-border">
            {isLoading && <div className="px-5 py-6 text-sm text-muted">Loading leave requests...</div>}
            {!isLoading && requests.length === 0 && <div className="px-5 py-6 text-sm text-muted">No leave requests yet.</div>}
            {!isLoading && requests.map((request) => (
              <div key={request.id} className="px-5 py-3.5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-ink capitalize">{request.leaveType.replace('_', ' ')}</p>
                  <p className="text-xs text-muted">
                    {format(new Date(request.startDate), 'MMM d')} - {format(new Date(request.endDate), 'MMM d, yyyy')} · {request.totalDays} day{request.totalDays === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-muted mt-1">
                    Sick {request.deductedSickDays ?? 0} · Vacation {request.deductedVacationDays ?? 0} · Unpaid {request.unpaidDays ?? 0}
                  </p>
                  {request.payrollImpactStatus && request.payrollImpactStatus !== 'not_applied' && (
                    <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      {request.payrollImpactStatus.replace(/_/g, ' ')}
                    </p>
                  )}
                </div>
                <Badge variant={statusVariant[request.status]} dot>{request.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
