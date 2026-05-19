import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle, DollarSign, Search, XCircle } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Table, { Pagination } from '../../../components/ui/Table'
import Badge from '../../../components/ui/Badge'
import Avatar from '../../../components/ui/Avatar'
import { formatDate } from '../../../utils/dateHelpers'
import type { LeaveApplication } from '../../../types'
import { leaveService } from '../../../services/leaveService'
import { useToast } from '../../../components/ui/Toast'

const leaveTypeLabel: Record<string, string> = {
  vacation: 'Vacation Leave',
  sick: 'Sick Leave',
  emergency: 'Emergency Leave',
  bereavement: 'Bereavement Leave',
  non_paid: 'Non-Paid Leave',
  maternity: 'Maternity Leave',
  paternity: 'Paternity Leave',
}

const statusVariant: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
}

export default function LeaveStatusPage() {
  const { showToast } = useToast()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState<'all' | 'pending'>('pending')
  const [leaves, setLeaves] = useState<LeaveApplication[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const loadLeaves = async () => {
    try {
      setIsLoading(true)
      setMessage(null)
      const res = await leaveService.list(tab === 'pending' ? { status: 'pending' } : undefined)
      setLeaves(res.data)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to load leave requests.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadLeaves()
  }, [tab])

  const filtered = useMemo(() => leaves.filter((l) => {
    if (tab === 'pending' && l.status !== 'pending') return false
    const name = l.employee ? `${l.employee.firstName} ${l.employee.lastName}`.toLowerCase() : ''
    return name.includes(search.toLowerCase())
  }), [leaves, search, tab])

  const visibleLeaves = filtered.slice((page - 1) * 10, page * 10)

  const reviewLeave = async (id: string, action: 'approve' | 'reject') => {
    try {
      setMessage(null)
      if (action === 'approve') {
        await leaveService.approve(id)
      } else {
        await leaveService.reject(id, 'Rejected by reviewer')
      }
      await loadLeaves()
      showToast({
        variant: 'success',
        title: `Leave request ${action === 'approve' ? 'approved' : 'rejected'}`,
      })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to review leave request.')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Leave Status</h2>
          <p className="text-sm text-muted mt-0.5">Review and manage leave applications</p>
        </div>
      </div>

      {message && (
        <div className="text-sm text-ink bg-slate-50 border border-border rounded-lg px-4 py-3">
          {message}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['pending', 'all'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
              tab === t ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink',
            ].join(' ')}
          >
            {t === 'pending' ? 'Pending Approval' : 'All Requests'}
          </button>
        ))}
      </div>

      <Card padding="none">
        <div className="px-5 py-4 border-b border-border">
          <div className="relative max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search employee..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
        </div>

        <Table
          data={visibleLeaves}
          rowKey={(r) => r.id}
          isLoading={isLoading}
          emptyMessage="No leave requests found."
          columns={[
            {
              key: 'employee',
              header: 'Employee',
              render: (row) => (
                <div className="flex items-center gap-3">
                  <Avatar name={row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : 'Employee'} size="sm" />
                  <span className="text-sm font-medium">
                    {row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : row.employeeId}
                  </span>
                </div>
              ),
            },
            {
              key: 'leaveType',
              header: 'Leave Type',
              render: (row) => <span className="text-sm">{leaveTypeLabel[row.leaveType] ?? row.leaveType}</span>,
            },
            {
              key: 'dates',
              header: 'Dates',
              render: (row) => (
                <div>
                  <p className="text-sm">{formatDate(row.startDate)} – {formatDate(row.endDate)}</p>
                  <p className="text-xs text-muted">{row.totalDays} day{row.totalDays !== 1 ? 's' : ''}</p>
                  <p className="text-xs text-muted">
                    SL {row.deductedSickDays ?? 0} · VL {row.deductedVacationDays ?? 0} · Unpaid {row.unpaidDays ?? 0}
                  </p>
                </div>
              ),
            },
            {
              key: 'impact',
              header: 'Impact',
              render: (row) => (
                <div className="space-y-1">
                  {Number(row.unpaidDays ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                      <DollarSign size={12} />
                      payroll deduction
                    </span>
                  )}
                  {row.documents && row.documents.length === 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <AlertTriangle size={12} />
                      no documents
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: 'reason',
              header: 'Reason',
              render: (row) => (
                <p className="text-sm text-muted max-w-xs truncate">{row.reason}</p>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (row) => (
                <Badge variant={statusVariant[row.status]} dot>{row.status}</Badge>
              ),
            },
            {
              key: 'actions',
              header: '',
              render: (row) =>
                row.status === 'pending' ? (
                  <div className="flex gap-2">
                    <Button size="xs" leftIcon={<CheckCircle size={12} />} onClick={() => reviewLeave(row.id, 'approve')}>Approve</Button>
                    <Button size="xs" variant="danger" leftIcon={<XCircle size={12} />} onClick={() => reviewLeave(row.id, 'reject')}>Reject</Button>
                  </div>
                ) : null,
            },
          ]}
        />
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(filtered.length / 10))} total={filtered.length} limit={10} onPageChange={setPage} />
      </Card>
    </div>
  )
}
