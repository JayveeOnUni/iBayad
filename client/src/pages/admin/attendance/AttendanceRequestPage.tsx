import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, XCircle } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Table from '../../../components/ui/Table'
import Badge from '../../../components/ui/Badge'
import Avatar from '../../../components/ui/Avatar'
import { formatDate } from '../../../utils/dateHelpers'
import type { AttendanceRequest, OffsetCredit, OffsetUsage } from '../../../types'
import { attendanceService } from '../../../services/attendanceService'
import { useToast } from '../../../components/ui/Toast'

type Section = 'corrections' | 'credits' | 'usage'

const sectionLabels: Record<Section, string> = {
  corrections: 'Corrections',
  credits: 'Offset Credits',
  usage: 'Offset Usage',
}

function minutesLabel(minutes: number) {
  const hours = minutes / 60
  return `${minutes} min${hours >= 1 ? ` (${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h)` : ''}`
}

function employeeName(row: AttendanceRequest | OffsetCredit | OffsetUsage) {
  return row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : row.employeeId
}

export default function AttendanceRequestPage() {
  const { showToast } = useToast()
  const [section, setSection] = useState<Section>('corrections')
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [requests, setRequests] = useState<AttendanceRequest[]>([])
  const [credits, setCredits] = useState<OffsetCredit[]>([])
  const [usages, setUsages] = useState<OffsetUsage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  const loadQueue = async () => {
    try {
      setIsLoading(true)
      setMessage(null)
      const params = tab === 'pending' ? { status: 'pending' } : undefined

      if (section === 'corrections') {
        const res = await attendanceService.listRequests(params)
        setRequests(res.data)
      } else if (section === 'credits') {
        const res = await attendanceService.listOffsetCredits(params)
        setCredits(res.data)
      } else {
        const res = await attendanceService.listOffsetUsages(params)
        setUsages(res.data)
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to load attendance queue.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadQueue()
  }, [section, tab])

  const pendingCount = useMemo(() => {
    if (section === 'corrections') return requests.filter((r) => r.status === 'pending').length
    if (section === 'credits') return credits.filter((r) => r.status === 'pending').length
    return usages.filter((r) => r.status === 'pending').length
  }, [credits, requests, section, usages])

  const reviewCorrection = async (id: string, action: 'approve' | 'reject') => {
    try {
      setMessage(null)
      if (action === 'approve') {
        await attendanceService.approveRequest(id)
      } else {
        await attendanceService.rejectRequest(id, 'Rejected by reviewer')
      }
      await loadQueue()
      showToast({
        variant: 'success',
        title: `Attendance correction ${action === 'approve' ? 'approved' : 'rejected'}`,
      })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to review correction.')
    }
  }

  const reviewCredit = async (id: string, action: 'approve' | 'reject') => {
    try {
      setMessage(null)
      if (action === 'approve') {
        await attendanceService.approveOffsetCredit(id)
      } else {
        await attendanceService.rejectOffsetCredit(id, 'Rejected by reviewer')
      }
      await loadQueue()
      showToast({
        variant: 'success',
        title: `Offset credit ${action === 'approve' ? 'approved' : 'rejected'}`,
      })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to review offset credit.')
    }
  }

  const reviewUsage = async (id: string, action: 'approve' | 'reject', requestedMinutes: number) => {
    try {
      setMessage(null)
      if (action === 'approve') {
        await attendanceService.approveOffsetUsage(id, requestedMinutes)
      } else {
        await attendanceService.rejectOffsetUsage(id, 'Rejected by reviewer')
      }
      await loadQueue()
      showToast({
        variant: 'success',
        title: `Offset usage ${action === 'approve' ? 'approved' : 'rejected'}`,
      })
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to review offset usage.')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-ink">Attendance Requests</h2>
        <p className="text-sm text-muted mt-0.5">Review attendance corrections, earned offset credits, and offset usage.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(sectionLabels) as Section[]).map((item) => (
          <button
            key={item}
            onClick={() => setSection(item)}
            className={[
              'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
              section === item
                ? 'border-brand bg-brand-50 text-brand'
                : 'border-border bg-white text-muted hover:bg-neutral-20 hover:text-ink',
            ].join(' ')}
          >
            {sectionLabels[item]}
          </button>
        ))}
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['pending', 'all'] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTab(item)}
            className={[
              'px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
              tab === item
                ? 'border-brand text-brand'
                : 'border-transparent text-muted hover:text-ink',
            ].join(' ')}
          >
            {item === 'pending' ? 'Pending' : 'All Requests'}
            {item === 'pending' && (
              <Badge variant="warning" className="ml-2">
                {pendingCount}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {message && (
        <div className="text-sm text-ink bg-slate-50 border border-border rounded-lg px-4 py-3">
          {message}
        </div>
      )}

      {section === 'corrections' && (
        <Card padding="none">
          <Table
            data={requests}
            rowKey={(r) => r.id}
            isLoading={isLoading}
            emptyMessage="No attendance correction requests found."
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (row) => (
                  <div className="flex items-center gap-3">
                    <Avatar name={employeeName(row)} size="sm" />
                    <span className="text-sm font-medium">{employeeName(row)}</span>
                  </div>
                ),
              },
              { key: 'date', header: 'Date', render: (row) => <span className="text-sm">{formatDate(row.date)}</span> },
              { key: 'type', header: 'Type', render: (row) => <span className="capitalize text-sm">{row.type.replace('_', ' ')}</span> },
              {
                key: 'time',
                header: 'Requested Time',
                render: (row) => <span className="text-sm">{row.requestedTimeIn ?? '—'} - {row.requestedTimeOut ?? '—'}</span>,
              },
              { key: 'reason', header: 'Reason', render: (row) => <p className="text-sm text-muted max-w-xs truncate">{row.reason}</p> },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <Badge variant={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'} dot>
                    {row.status}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (row) =>
                  row.status === 'pending' ? (
                    <div className="flex gap-2">
                      <Button size="xs" leftIcon={<CheckCircle size={12} />} onClick={() => reviewCorrection(row.id, 'approve')}>
                        Approve
                      </Button>
                      <Button size="xs" variant="danger" leftIcon={<XCircle size={12} />} onClick={() => reviewCorrection(row.id, 'reject')}>
                        Reject
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}

      {section === 'credits' && (
        <Card padding="none">
          <Table
            data={credits}
            rowKey={(r) => r.id}
            isLoading={isLoading}
            emptyMessage="No offset credits found."
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (row) => (
                  <div className="flex items-center gap-3">
                    <Avatar name={employeeName(row)} size="sm" />
                    <span className="text-sm font-medium">{employeeName(row)}</span>
                  </div>
                ),
              },
              { key: 'dateEarned', header: 'Date Earned', render: (row) => <span className="text-sm">{formatDate(row.dateEarned)}</span> },
              { key: 'minutesEarned', header: 'Credit', render: (row) => <span className="text-sm">{minutesLabel(row.minutesEarned)}</span> },
              { key: 'source', header: 'Source', render: (row) => <span className="capitalize text-sm">{row.source.replace('_', ' ')}</span> },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <Badge variant={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'} dot>
                    {row.status}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (row) =>
                  row.status === 'pending' ? (
                    <div className="flex gap-2">
                      <Button size="xs" leftIcon={<CheckCircle size={12} />} onClick={() => reviewCredit(row.id, 'approve')}>
                        Approve
                      </Button>
                      <Button size="xs" variant="danger" leftIcon={<XCircle size={12} />} onClick={() => reviewCredit(row.id, 'reject')}>
                        Reject
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}

      {section === 'usage' && (
        <Card padding="none">
          <Table
            data={usages}
            rowKey={(r) => r.id}
            isLoading={isLoading}
            emptyMessage="No offset usage requests found."
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (row) => (
                  <div className="flex items-center gap-3">
                    <Avatar name={employeeName(row)} size="sm" />
                    <span className="text-sm font-medium">{employeeName(row)}</span>
                  </div>
                ),
              },
              { key: 'usageDate', header: 'Usage Date', render: (row) => <span className="text-sm">{formatDate(row.usageDate)}</span> },
              { key: 'requestedMinutes', header: 'Requested', render: (row) => <span className="text-sm">{minutesLabel(row.requestedMinutes)}</span> },
              { key: 'approvedMinutes', header: 'Approved', render: (row) => <span className="text-sm">{row.approvedMinutes ? minutesLabel(row.approvedMinutes) : '—'}</span> },
              { key: 'reason', header: 'Reason', render: (row) => <p className="text-sm text-muted max-w-xs truncate">{row.reason}</p> },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <Badge variant={row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'} dot>
                    {row.status}
                  </Badge>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (row) =>
                  row.status === 'pending' ? (
                    <div className="flex gap-2">
                      <Button size="xs" leftIcon={<CheckCircle size={12} />} onClick={() => reviewUsage(row.id, 'approve', row.requestedMinutes)}>
                        Approve
                      </Button>
                      <Button size="xs" variant="danger" leftIcon={<XCircle size={12} />} onClick={() => reviewUsage(row.id, 'reject', row.requestedMinutes)}>
                        Reject
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </Card>
      )}
    </div>
  )
}
