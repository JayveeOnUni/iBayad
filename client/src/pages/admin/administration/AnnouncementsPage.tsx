import { useEffect, useState, type ReactNode } from 'react'
import { CalendarDays, Edit2, Loader2, Megaphone, Pin, Plus, Trash2 } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Modal, { ConfirmModal } from '../../../components/ui/Modal'
import Input from '../../../components/ui/Input'
import Textarea from '../../../components/ui/Textarea'
import { EmptyState, FeedbackMessage } from '../../../components/ui/Page'
import { useToast } from '../../../components/ui/Toast'
import { announcementService, type AnnouncementPayload } from '../../../services/announcementService'
import { formatDate } from '../../../utils/dateHelpers'
import type { Announcement } from '../../../types'

interface AnnouncementForm {
  title: string
  content: string
  startDate: string
  endDate: string
  isPinned: boolean
}

type AnnouncementFormErrors = Partial<Record<keyof AnnouncementForm, string>>
type PageMessage = { variant: 'info' | 'success' | 'warning' | 'danger'; text: string }
type ActionTone = 'neutral' | 'danger'

interface AnnouncementActionButtonProps {
  label: string
  icon: ReactNode
  tone?: ActionTone
  isLoading?: boolean
  onClick: () => void
}

const defaultForm: AnnouncementForm = {
  title: '',
  content: '',
  startDate: '',
  endDate: '',
  isPinned: false,
}

const actionToneClasses: Record<ActionTone, string> = {
  neutral: 'text-neutral-70 hover:bg-white hover:text-ink hover:shadow-sm focus-visible:ring-brand-200',
  danger: 'text-danger hover:bg-danger-muted hover:text-danger-hover focus-visible:ring-danger-border',
}

function AnnouncementActionButton({
  label,
  icon,
  tone = 'neutral',
  isLoading = false,
  onClick,
}: AnnouncementActionButtonProps) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={isLoading}
        onClick={onClick}
        className={[
          'inline-flex h-8 w-8 items-center justify-center rounded-md',
          'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed disabled:opacity-60',
          actionToneClasses[tone],
        ].join(' ')}
      >
        {isLoading ? <Loader2 className="animate-spin" size={15} /> : icon}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {label}
      </span>
    </span>
  )
}

function validateAnnouncementForm(form: AnnouncementForm): { payload?: AnnouncementPayload; errors: AnnouncementFormErrors } {
  const errors: AnnouncementFormErrors = {}
  const title = form.title.trim()
  const content = form.content.trim()
  const startDate = form.startDate.trim()
  const endDate = form.endDate.trim()

  if (!title) errors.title = 'Title is required'
  if (title.length > 255) errors.title = 'Title must be 255 characters or fewer'
  if (!content) errors.content = 'Message is required'
  if (startDate && endDate && endDate < startDate) {
    errors.endDate = 'End date cannot be earlier than start date'
  }

  if (Object.keys(errors).length > 0) return { errors }

  return {
    errors,
    payload: {
      title,
      content,
      startDate: startDate || null,
      endDate: endDate || null,
      isPinned: form.isPinned,
    },
  }
}

function formatDateRange(announcement: Announcement): string {
  if (!announcement.startDate && !announcement.endDate) return 'Always active'
  if (announcement.startDate && announcement.endDate) {
    return `${formatDate(announcement.startDate)} to ${formatDate(announcement.endDate)}`
  }
  if (announcement.startDate) return `Starts ${formatDate(announcement.startDate)}`
  return `Ends ${formatDate(announcement.endDate ?? '')}`
}

function sortAnnouncements(items: Announcement[]): Announcement[] {
  return [...items].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
    const aDate = a.startDate ?? a.createdAt
    const bDate = b.startDate ?? b.createdAt
    return bDate.localeCompare(aDate)
  })
}

export default function AnnouncementsPage() {
  const { showToast } = useToast()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null)
  const [form, setForm] = useState<AnnouncementForm>(defaultForm)
  const [fieldErrors, setFieldErrors] = useState<AnnouncementFormErrors>({})
  const [message, setMessage] = useState<PageMessage | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [announcementPendingDelete, setAnnouncementPendingDelete] = useState<Announcement | null>(null)
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    announcementService.getAll()
      .then((data) => {
        if (!isMounted) return
        setAnnouncements(sortAnnouncements(data))
        setMessage(null)
      })
      .catch((err) => {
        if (!isMounted) return
        setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to load announcements.' })
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const openAnnouncementModal = (announcement?: Announcement) => {
    setEditingAnnouncement(announcement ?? null)
    setFieldErrors({})
    setForm({
      title: announcement?.title ?? '',
      content: announcement?.content ?? '',
      startDate: announcement?.startDate ?? '',
      endDate: announcement?.endDate ?? '',
      isPinned: announcement?.isPinned ?? false,
    })
    setIsModalOpen(true)
  }

  const saveAnnouncement = async () => {
    const { payload, errors } = validateAnnouncementForm(form)
    setFieldErrors(errors)
    if (!payload) return

    setIsSaving(true)
    setMessage(null)

    try {
      const savedAnnouncement = editingAnnouncement
        ? await announcementService.update(editingAnnouncement.id, payload)
        : await announcementService.create(payload)

      setAnnouncements((current) =>
        sortAnnouncements(
          editingAnnouncement
            ? current.map((item) => item.id === savedAnnouncement.id ? savedAnnouncement : item)
            : [savedAnnouncement, ...current]
        )
      )
      showToast({ variant: 'success', title: editingAnnouncement ? 'Announcement updated' : 'Announcement created' })
      setIsModalOpen(false)
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to save announcement.' })
    } finally {
      setIsSaving(false)
    }
  }

  const openDeleteModal = (announcement: Announcement) => {
    setAnnouncementPendingDelete(announcement)
    setMessage(null)
  }

  const deleteAnnouncement = async () => {
    if (!announcementPendingDelete) return

    setDeletingAnnouncementId(announcementPendingDelete.id)
    setMessage(null)

    try {
      const result = await announcementService.delete(announcementPendingDelete.id)
      setAnnouncements((current) => current.filter((item) => item.id !== result.deletedAnnouncementId))
      showToast({ variant: 'success', title: 'Announcement deleted' })
      setAnnouncementPendingDelete(null)
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to delete announcement.' })
      setAnnouncementPendingDelete(null)
    } finally {
      setDeletingAnnouncementId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-ink">Announcements</h2>
          <p className="mt-0.5 text-sm text-muted">Broadcast company notices to dashboards</p>
        </div>
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => openAnnouncementModal()}>
          New Announcement
        </Button>
      </div>

      {message && <FeedbackMessage variant={message.variant}>{message.text}</FeedbackMessage>}

      {isLoading ? (
        <FeedbackMessage>Loading announcements...</FeedbackMessage>
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={24} />}
          title="No announcements yet"
          description="Create a company notice so it can appear on the admin and employee dashboards."
          action={<Button size="sm" leftIcon={<Plus size={14} />} onClick={() => openAnnouncementModal()}>New Announcement</Button>}
        />
      ) : (
        <div className="space-y-4">
          {announcements.map((announcement) => (
            <Card key={announcement.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50">
                    <Megaphone size={17} className="text-brand" />
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{announcement.title}</h3>
                      {announcement.isPinned && (
                        <Badge variant="info" size="sm">
                          Pinned
                        </Badge>
                      )}
                    </div>
                    <p className="whitespace-pre-line text-sm leading-6 text-muted">{announcement.content}</p>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays size={13} />
                        {formatDateRange(announcement)}
                      </span>
                      <span>Updated {formatDate(announcement.updatedAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-neutral-20 p-1">
                  <AnnouncementActionButton
                    label="Edit announcement"
                    icon={<Edit2 size={15} />}
                    onClick={() => openAnnouncementModal(announcement)}
                  />
                  <AnnouncementActionButton
                    label="Delete announcement"
                    icon={<Trash2 size={15} />}
                    tone="danger"
                    isLoading={deletingAnnouncementId === announcement.id}
                    onClick={() => openDeleteModal(announcement)}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSaving && setIsModalOpen(false)}
        title={editingAnnouncement ? 'Edit Announcement' : 'New Announcement'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={saveAnnouncement} isLoading={isSaving}>Save Announcement</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="Announcement title..."
            value={form.title}
            error={fieldErrors.title}
            maxLength={255}
            onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))}
            required
          />
          <Textarea
            label="Message"
            placeholder="Write your announcement..."
            value={form.content}
            error={fieldErrors.content}
            rows={5}
            onChange={(e) => setForm((current) => ({ ...current, content: e.target.value }))}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Start Date"
              type="date"
              value={form.startDate}
              error={fieldErrors.startDate}
              onChange={(e) => setForm((current) => ({ ...current, startDate: e.target.value }))}
            />
            <Input
              label="End Date"
              type="date"
              value={form.endDate}
              error={fieldErrors.endDate}
              onChange={(e) => setForm((current) => ({ ...current, endDate: e.target.value }))}
            />
          </div>
          <label className="flex items-center justify-between gap-4 rounded-lg border border-border bg-neutral-20 px-3 py-3">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <Pin size={15} className="text-brand" />
              Pinned
            </span>
            <input
              type="checkbox"
              checked={form.isPinned}
              onChange={(e) => setForm((current) => ({ ...current, isPinned: e.target.checked }))}
              className="h-4 w-4 rounded border-border text-brand focus:ring-brand-200"
            />
          </label>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(announcementPendingDelete)}
        onClose={() => {
          if (!deletingAnnouncementId) setAnnouncementPendingDelete(null)
        }}
        onConfirm={deleteAnnouncement}
        title="Delete Announcement"
        message={
          announcementPendingDelete
            ? `Delete ${announcementPendingDelete.title}? This will remove it from dashboard announcement lists.`
            : ''
        }
        confirmLabel="Delete Announcement"
        isLoading={Boolean(deletingAnnouncementId)}
        variant="danger"
      />
    </div>
  )
}
