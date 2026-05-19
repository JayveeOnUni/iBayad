import { useEffect, useState, type ReactNode } from 'react'
import { Plus, Edit2, Trash2, Building2, Power, Loader2, BriefcaseBusiness, Users } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Modal, { ConfirmModal } from '../../../components/ui/Modal'
import Input from '../../../components/ui/Input'
import Textarea from '../../../components/ui/Textarea'
import { EmptyState, FeedbackMessage } from '../../../components/ui/Page'
import { useToast } from '../../../components/ui/Toast'
import { departmentService, type DepartmentPayload } from '../../../services/referenceDataService'
import type { Department } from '../../../types'

interface DepartmentForm {
  name: string
  code: string
  description: string
}

type DepartmentFormErrors = Partial<Record<keyof DepartmentForm, string>>
type PageMessage = { variant: 'info' | 'success' | 'warning' | 'danger'; text: string }
type ActionTone = 'neutral' | 'success' | 'warning' | 'danger'

interface DepartmentActionButtonProps {
  label: string
  icon: ReactNode
  tone?: ActionTone
  isLoading?: boolean
  onClick: () => void
}

const defaultForm: DepartmentForm = {
  name: '',
  code: '',
  description: '',
}

const actionToneClasses: Record<ActionTone, string> = {
  neutral: 'text-neutral-70 hover:bg-white hover:text-ink hover:shadow-sm focus-visible:ring-brand-200',
  success: 'text-success hover:bg-success-muted hover:text-success-hover focus-visible:ring-success-border',
  warning: 'text-warning hover:bg-warning-muted hover:text-warning focus-visible:ring-warning-border',
  danger: 'text-danger hover:bg-danger-muted hover:text-danger-hover focus-visible:ring-danger-border',
}

function DepartmentActionButton({
  label,
  icon,
  tone = 'neutral',
  isLoading = false,
  onClick,
}: DepartmentActionButtonProps) {
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

function validateDepartmentForm(form: DepartmentForm): { payload?: DepartmentPayload; errors: DepartmentFormErrors } {
  const errors: DepartmentFormErrors = {}
  const name = form.name.trim()
  const code = form.code.trim()
  const description = form.description.trim()

  if (!name) errors.name = 'Department name is required'
  if (name.length > 100) errors.name = 'Department name must be 100 characters or fewer'
  if (!code) errors.code = 'Department code is required'
  if (code.length > 20) errors.code = 'Department code must be 20 characters or fewer'

  if (Object.keys(errors).length > 0) return { errors }

  return {
    errors,
    payload: {
      name,
      code,
      description: description || null,
    },
  }
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export default function DepartmentsPage() {
  const { showToast } = useToast()
  const [departments, setDepartments] = useState<Department[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingDepartment, setEditingDepartment] = useState<Department | null>(null)
  const [form, setForm] = useState<DepartmentForm>(defaultForm)
  const [fieldErrors, setFieldErrors] = useState<DepartmentFormErrors>({})
  const [message, setMessage] = useState<PageMessage | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [togglingDepartmentId, setTogglingDepartmentId] = useState<string | null>(null)
  const [departmentPendingDelete, setDepartmentPendingDelete] = useState<Department | null>(null)
  const [deletingDepartmentId, setDeletingDepartmentId] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    departmentService.getAll()
      .then((data) => {
        if (!isMounted) return
        setDepartments(data)
        setMessage(null)
      })
      .catch((err) => {
        if (!isMounted) return
        setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to load departments.' })
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  const openDepartmentModal = (department?: Department) => {
    setEditingDepartment(department ?? null)
    setFieldErrors({})
    setForm({
      name: department?.name ?? '',
      code: department?.code ?? '',
      description: department?.description ?? '',
    })
    setIsModalOpen(true)
  }

  const saveDepartment = async () => {
    const { payload, errors } = validateDepartmentForm(form)
    setFieldErrors(errors)
    if (!payload) return

    setIsSaving(true)
    setMessage(null)

    try {
      const savedDepartment = editingDepartment
        ? await departmentService.update(editingDepartment.id, payload)
        : await departmentService.create(payload)

      setDepartments((current) =>
        editingDepartment
          ? current.map((item) => item.id === savedDepartment.id ? savedDepartment : item)
          : [savedDepartment, ...current]
      )
      showToast({ variant: 'success', title: editingDepartment ? 'Department updated' : 'Department created' })
      setIsModalOpen(false)
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to save department.' })
    } finally {
      setIsSaving(false)
    }
  }

  const toggleDepartment = async (department: Department) => {
    setTogglingDepartmentId(department.id)
    setMessage(null)

    try {
      const updatedDepartment = await departmentService.toggleActive(department.id)
      setDepartments((current) => current.map((item) => item.id === updatedDepartment.id ? updatedDepartment : item))
      showToast({ variant: 'success', title: `Department ${updatedDepartment.isActive ? 'activated' : 'deactivated'}` })
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to update department status.' })
    } finally {
      setTogglingDepartmentId(null)
    }
  }

  const openDeleteModal = (department: Department) => {
    setDepartmentPendingDelete(department)
    setMessage(null)
  }

  const deleteDepartment = async () => {
    if (!departmentPendingDelete) return

    setDeletingDepartmentId(departmentPendingDelete.id)
    setMessage(null)

    try {
      const result = await departmentService.delete(departmentPendingDelete.id)
      setDepartments((current) => current.filter((item) => item.id !== result.deletedDepartmentId))
      showToast({ variant: 'success', title: 'Department deleted' })
      setDepartmentPendingDelete(null)
    } catch (err) {
      setMessage({ variant: 'danger', text: err instanceof Error ? err.message : 'Unable to delete department. Deactivate it instead.' })
      setDepartmentPendingDelete(null)
    } finally {
      setDeletingDepartmentId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-ink">Departments</h2>
          <p className="text-sm text-muted mt-0.5">Organize your company structure</p>
        </div>
        <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => openDepartmentModal()}>
          Add Department
        </Button>
      </div>

      {message && <FeedbackMessage variant={message.variant}>{message.text}</FeedbackMessage>}

      {isLoading ? (
        <FeedbackMessage>Loading departments...</FeedbackMessage>
      ) : departments.length === 0 ? (
        <EmptyState
          icon={<Building2 size={24} />}
          title="No departments yet"
          description="Create a department so employees and positions can be assigned to it."
          action={<Button size="sm" leftIcon={<Plus size={14} />} onClick={() => openDepartmentModal()}>Add Department</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {departments.map((dept) => {
            const employeeCount = dept.employeeCount ?? 0
            const positionCount = dept.positionCount ?? 0

            return (
              <Card key={dept.id} className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50">
                      <Building2 size={18} className="text-brand" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-ink">{dept.name}</h3>
                      <span className="font-mono text-xs text-muted">{dept.code}</span>
                    </div>
                  </div>
                  <Badge variant={dept.isActive === false ? 'danger' : 'success'} size="sm" dot>
                    {dept.isActive === false ? 'Inactive' : 'Active'}
                  </Badge>
                </div>

                {dept.description && (
                  <p className="line-clamp-3 text-xs leading-5 text-muted">{dept.description}</p>
                )}

                {dept.managerName && (
                  <div className="text-xs text-muted">
                    Head: <span className="font-medium text-ink">{dept.managerName}</span>
                  </div>
                )}

                <div className="mt-auto space-y-3 border-t border-border pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-2 rounded-md bg-neutral-20 px-2.5 py-2 text-xs text-muted">
                      <Users size={14} className="text-neutral-70" />
                      <span><span className="font-semibold text-ink">{employeeCount}</span> employees</span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-neutral-20 px-2.5 py-2 text-xs text-muted">
                      <BriefcaseBusiness size={14} className="text-neutral-70" />
                      <span><span className="font-semibold text-ink">{positionCount}</span> positions</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted">
                      {pluralize(employeeCount + positionCount, 'assignment')}
                    </span>
                    <div className="flex flex-shrink-0 items-center gap-1 rounded-md border border-border bg-neutral-20 p-1">
                      <DepartmentActionButton
                        label="Edit department"
                        icon={<Edit2 size={15} />}
                        onClick={() => openDepartmentModal(dept)}
                      />
                      <DepartmentActionButton
                        label={dept.isActive === false ? 'Activate department' : 'Deactivate department'}
                        icon={<Power size={15} />}
                        tone={dept.isActive === false ? 'success' : 'warning'}
                        isLoading={togglingDepartmentId === dept.id}
                        onClick={() => toggleDepartment(dept)}
                      />
                      <DepartmentActionButton
                        label="Delete department"
                        icon={<Trash2 size={15} />}
                        tone="danger"
                        isLoading={deletingDepartmentId === dept.id}
                        onClick={() => openDeleteModal(dept)}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSaving && setIsModalOpen(false)}
        title={editingDepartment ? 'Edit Department' : 'Add Department'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={saveDepartment} isLoading={isSaving}>Save Department</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Department Name"
            placeholder="e.g. Human Resources"
            value={form.name}
            error={fieldErrors.name}
            maxLength={100}
            onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
            required
          />
          <Input
            label="Department Code"
            placeholder="e.g. HR"
            value={form.code}
            error={fieldErrors.code}
            maxLength={20}
            onChange={(e) => setForm((current) => ({ ...current, code: e.target.value }))}
            required
          />
          <Textarea
            label="Description"
            placeholder="Brief description..."
            value={form.description}
            error={fieldErrors.description}
            rows={3}
            onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
          />
        </div>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(departmentPendingDelete)}
        onClose={() => {
          if (!deletingDepartmentId) setDepartmentPendingDelete(null)
        }}
        onConfirm={deleteDepartment}
        title="Delete Department"
        message={
          departmentPendingDelete
            ? `Delete ${departmentPendingDelete.name}? This action is only allowed when no employees or positions are assigned. Deactivation is recommended for departments with history.`
            : ''
        }
        confirmLabel="Delete Department"
        isLoading={Boolean(deletingDepartmentId)}
        variant="danger"
      />
    </div>
  )
}
