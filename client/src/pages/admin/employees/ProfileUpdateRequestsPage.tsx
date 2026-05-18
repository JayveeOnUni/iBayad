import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, RefreshCw, XCircle } from 'lucide-react'
import Avatar from '../../../components/ui/Avatar'
import Badge from '../../../components/ui/Badge'
import Button from '../../../components/ui/Button'
import Card from '../../../components/ui/Card'
import Table from '../../../components/ui/Table'
import Textarea from '../../../components/ui/Textarea'
import { FeedbackMessage } from '../../../components/ui/Page'
import { profileUpdateRequestService } from '../../../services/profileUpdateRequestService'
import type { ProfileUpdateChange, ProfileUpdateRequest } from '../../../types'
import { formatDate } from '../../../utils/dateHelpers'

const statusVariant: Record<ProfileUpdateRequest['status'], 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
}

function employeeName(request: ProfileUpdateRequest) {
  return request.employee
    ? `${request.employee.firstName} ${request.employee.lastName}`.trim()
    : request.employeeId
}

function displayValue(value?: string | null) {
  return value && value.trim() ? value : 'Not provided'
}

function changeSummary(changes: Record<string, ProfileUpdateChange>) {
  const labels = Object.values(changes).map((change) => change.label)
  if (labels.length <= 3) return labels.join(', ') || 'No fields'
  return `${labels.slice(0, 3).join(', ')} +${labels.length - 3} more`
}

export default function ProfileUpdateRequestsPage() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [requests, setRequests] = useState<ProfileUpdateRequest[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [remarks, setRemarks] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isReviewing, setIsReviewing] = useState(false)
  const [message, setMessage] = useState<{ text: string; variant: 'info' | 'success' | 'danger' } | null>(null)

  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedId) ?? requests[0] ?? null,
    [requests, selectedId]
  )

  const loadRequests = async () => {
    try {
      setIsLoading(true)
      setMessage(null)
      const res = await profileUpdateRequestService.list(tab === 'pending' ? { status: 'pending' } : undefined)
      setRequests(res.data)
      setSelectedId((current) => {
        if (current && res.data.some((request) => request.id === current)) return current
        return res.data[0]?.id ?? null
      })
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Unable to load profile update requests.',
        variant: 'danger',
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadRequests()
  }, [tab])

  const reviewRequest = async (action: 'approve' | 'reject') => {
    if (!selectedRequest) return

    try {
      setIsReviewing(true)
      setMessage(null)
      if (action === 'approve') {
        await profileUpdateRequestService.approve(selectedRequest.id)
      } else {
        await profileUpdateRequestService.reject(selectedRequest.id, remarks)
      }
      setRemarks('')
      await loadRequests()
      setMessage({
        text: `Profile update request ${action === 'approve' ? 'approved' : 'rejected'}.`,
        variant: 'success',
      })
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : 'Unable to review profile update request.',
        variant: 'danger',
      })
    } finally {
      setIsReviewing(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Profile Update Requests</h2>
          <p className="text-sm text-muted mt-0.5">Review employee personal, contact, and address changes.</p>
        </div>
        <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={loadRequests}>
          Refresh
        </Button>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(['pending', 'all'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={[
              'px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
              tab === item ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink',
            ].join(' ')}
          >
            {item === 'pending' ? 'Pending Approval' : 'All Requests'}
          </button>
        ))}
      </div>

      {message && (
        <FeedbackMessage variant={message.variant}>
          {message.text}
        </FeedbackMessage>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <Card padding="none">
          <Table
            data={requests}
            rowKey={(request) => request.id}
            isLoading={isLoading}
            emptyMessage="No profile update requests found."
            onRowClick={(request) => setSelectedId(request.id)}
            columns={[
              {
                key: 'employee',
                header: 'Employee',
                render: (request) => (
                  <div className="flex items-center gap-3">
                    <Avatar name={employeeName(request)} size="sm" />
                    <div>
                      <p className="text-sm font-medium">{employeeName(request)}</p>
                      <p className="text-xs text-muted">{request.employee?.employeeNumber ?? 'No employee number'}</p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'changes',
                header: 'Requested Changes',
                render: (request) => <span className="text-sm">{changeSummary(request.requestedChanges)}</span>,
              },
              {
                key: 'createdAt',
                header: 'Submitted',
                render: (request) => <span className="text-sm">{formatDate(request.createdAt)}</span>,
              },
              {
                key: 'status',
                header: 'Status',
                render: (request) => (
                  <Badge variant={statusVariant[request.status]} dot>
                    {request.status}
                  </Badge>
                ),
              },
            ]}
          />
        </Card>

        <Card>
          {selectedRequest ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">{employeeName(selectedRequest)}</p>
                  <p className="text-xs text-muted">{selectedRequest.employee?.employeeNumber ?? selectedRequest.employeeId}</p>
                </div>
                <Badge variant={statusVariant[selectedRequest.status]} dot>
                  {selectedRequest.status}
                </Badge>
              </div>

              <div className="space-y-3">
                {Object.values(selectedRequest.requestedChanges).map((change) => (
                  <div key={change.field} className="rounded-md border border-border">
                    <div className="border-b border-border bg-neutral-20 px-3 py-2">
                      <p className="text-xs font-semibold text-ink">{change.label}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      <div>
                        <p className="text-xs text-muted">Current</p>
                        <p className="text-sm font-medium text-ink">{displayValue(change.current)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Requested</p>
                        <p className="text-sm font-medium text-ink">{displayValue(change.requested)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {selectedRequest.employeeNote && (
                <div>
                  <p className="text-xs text-muted">Employee Note</p>
                  <p className="text-sm text-ink">{selectedRequest.employeeNote}</p>
                </div>
              )}

              {selectedRequest.status === 'pending' ? (
                <div className="space-y-3 border-t border-border pt-4">
                  <Textarea
                    label="Review Remarks"
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                    placeholder="Optional remarks for rejection or audit context"
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="danger"
                      size="sm"
                      leftIcon={<XCircle size={14} />}
                      isLoading={isReviewing}
                      onClick={() => reviewRequest('reject')}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      leftIcon={<CheckCircle size={14} />}
                      isLoading={isReviewing}
                      onClick={() => reviewRequest('approve')}
                    >
                      Approve
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="border-t border-border pt-4">
                  <p className="text-xs text-muted">Review Remarks</p>
                  <p className="text-sm text-ink">{displayValue(selectedRequest.reviewRemarks)}</p>
                  <p className="mt-2 text-xs text-muted">
                    Reviewed {selectedRequest.reviewedAt ? formatDate(selectedRequest.reviewedAt) : '—'}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">Select a request to review details.</p>
          )}
        </Card>
      </div>
    </div>
  )
}
