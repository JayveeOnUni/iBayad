import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Download } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Table, { Pagination } from '../../../components/ui/Table'
import Badge from '../../../components/ui/Badge'
import Avatar from '../../../components/ui/Avatar'
import Modal from '../../../components/ui/Modal'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import { FeedbackMessage, PageHeader } from '../../../components/ui/Page'
import type { Employee, EmployeeFormData } from '../../../types'
import { formatDate } from '../../../utils/dateHelpers'
import { formatPeso } from '../../../utils/taxComputation'
import { employeeService } from '../../../services/employeeService'

const defaultEmployeeForm: EmployeeFormData = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  birthDate: '',
  gender: 'other',
  civilStatus: 'single',
  address: '',
  city: '',
  province: '',
  zipCode: '',
  departmentId: '',
  positionId: '',
  employmentType: 'regular',
  hireDate: new Date().toISOString().slice(0, 10),
  basicSalary: 0,
  sssNumber: '',
  philhealthNumber: '',
  pagibigNumber: '',
  tinNumber: '',
}

const governmentIdFields = [
  { key: 'sssNumber', label: 'SSS Number', placeholder: 'e.g. 12-3456789-0' },
  { key: 'philhealthNumber', label: 'PhilHealth Number', placeholder: 'e.g. 12-345678901-2' },
  { key: 'pagibigNumber', label: 'Pag-IBIG Number', placeholder: 'e.g. 1234-5678-9012' },
  { key: 'tinNumber', label: 'TIN Number', placeholder: 'e.g. 123-456-789-000' },
] as const

function validateGovernmentId(value: string | undefined, label: string) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) return null
  if (trimmed.length > 30) return `${label} must be 30 characters or fewer.`
  if (!/^[0-9 -]+$/.test(trimmed)) return `${label} must contain only numbers, spaces, or hyphens.`
  return null
}

function validateEmployeeForm(form: EmployeeFormData) {
  for (const field of governmentIdFields) {
    const error = validateGovernmentId(form[field.key], field.label)
    if (error) return error
  }
  return null
}

export default function EmployeeListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [totalEmployees, setTotalEmployees] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [form, setForm] = useState<EmployeeFormData>(defaultEmployeeForm)

  useEffect(() => {
    const loadEmployees = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const res = await employeeService.list({
          page,
          limit: 10,
          search: search || undefined,
          status: statusFilter || undefined,
        })
        setEmployees(res.data)
        setTotalEmployees(res.total)
        setTotalPages(Math.max(1, res.totalPages))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load employees.')
      } finally {
        setIsLoading(false)
      }
    }

    loadEmployees()
  }, [page, search, statusFilter])

  const updateForm = (key: keyof EmployeeFormData, value: string | number) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const createEmployee = async () => {
    const validationError = validateEmployeeForm(form)
    if (validationError) {
      setError(validationError)
      setSuccess(null)
      return
    }

    try {
      setIsSaving(true)
      setError(null)
      setSuccess(null)
      const res = await employeeService.create(form)
      setEmployees((current) => [res.data, ...current])
      setTotalEmployees((current) => current + 1)
      setIsAddOpen(false)
      setForm(defaultEmployeeForm)
      setSuccess(
        res.activationLink
          ? `${res.message ?? 'Employee account created.'} Activation link: ${res.activationLink}`
          : res.message ?? 'Employee account created. Activation email sent.'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create employee.')
    } finally {
      setIsSaving(false)
    }
  }

  const exportEmployees = async () => {
    try {
      setIsExporting(true)
      setError(null)
      setSuccess(null)
      const firstPage = await employeeService.list({
        page: 1,
        limit: 100,
        search: search || undefined,
        status: statusFilter || undefined,
      })
      const allEmployees = [...firstPage.data]

      for (let exportPage = 2; exportPage <= firstPage.totalPages; exportPage += 1) {
        const res = await employeeService.list({
          page: exportPage,
          limit: 100,
          search: search || undefined,
          status: statusFilter || undefined,
        })
        allEmployees.push(...res.data)
      }

      const headers = ['Employee No.', 'Name', 'Email', 'Department', 'Position', 'Status', 'Basic Salary']
      const rows = allEmployees.map((e) => [
        e.employeeNumber,
        `${e.firstName} ${e.lastName}`,
        e.email,
        e.department?.name ?? '',
        e.position?.title ?? '',
        e.employmentStatus,
        String(e.basicSalary),
      ])
      const csv = [headers, ...rows]
        .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
        .join('\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'employees.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export employees.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        subtitle="Manage all employee records, compensation details, and employment status."
        actions={
          <>
          <Button variant="outline" size="sm" leftIcon={<Download size={14} />} onClick={exportEmployees} isLoading={isExporting}>
            Export
          </Button>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setIsAddOpen(true)}>
            Add Employee
          </Button>
          </>
        }
      />

      {error && (
        <FeedbackMessage variant="danger">
          {error}
        </FeedbackMessage>
      )}

      {success && (
        <FeedbackMessage variant="success">
          {success}
        </FeedbackMessage>
      )}

      <Card padding="none">
        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 md:flex-row md:items-center">
          <div className="w-full md:max-w-sm">
            <Input
              type="text"
              placeholder="Search employees..."
              value={search}
              leftAddon={<Search size={15} />}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="md:w-48"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="resigned">Resigned</option>
            <option value="terminated">Terminated</option>
          </Select>
        </div>

        <Table
          data={employees}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/admin/employees/${r.id}`)}
          isLoading={isLoading}
          columns={[
            {
              key: 'employee',
              header: 'Employee',
              render: (row) => (
                <div className="flex items-center gap-3">
                  <Avatar name={`${row.firstName} ${row.lastName}`} size="sm" />
                  <div>
                    <p className="font-medium text-ink text-sm">
                      {row.firstName} {row.lastName}
                    </p>
                    <p className="text-xs text-muted">{row.employeeNumber}</p>
                  </div>
                </div>
              ),
            },
            {
              key: 'department',
              header: 'Department',
              render: (row) => (
                <div>
                  <p className="text-sm text-ink">{row.department?.name ?? '—'}</p>
                  <p className="text-xs text-muted">{row.position?.title ?? '—'}</p>
                </div>
              ),
            },
            {
              key: 'employmentType',
              header: 'Type',
              render: (row) => (
                <span className="capitalize text-sm">{row.employmentType.replace('_', ' ')}</span>
              ),
            },
            {
              key: 'basicSalary',
              header: 'Basic Salary',
              render: (row) => (
                <span className="font-medium text-sm">{formatPeso(row.basicSalary)}</span>
              ),
            },
            {
              key: 'hireDate',
              header: 'Hire Date',
              render: (row) => <span className="text-sm">{formatDate(row.hireDate)}</span>,
            },
            {
              key: 'employmentStatus',
              header: 'Status',
              render: (row) => {
                const variantMap: Record<string, 'success' | 'neutral' | 'danger' | 'warning'> = {
                  active: 'success',
                  inactive: 'neutral',
                  resigned: 'neutral',
                  terminated: 'danger',
                  on_leave: 'warning',
                }
                return (
                  <Badge variant={variantMap[row.employmentStatus] ?? 'neutral'} dot>
                    {row.employmentStatus.replace('_', ' ')}
                  </Badge>
                )
              },
            },
          ]}
        />
        <Pagination
          page={page}
          totalPages={totalPages}
          total={totalEmployees}
          limit={10}
          onPageChange={setPage}
        />
      </Card>

      <Modal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        title="Add Employee"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsAddOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={createEmployee} isLoading={isSaving}>Save Employee</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="First Name" required value={form.firstName} onChange={(e) => updateForm('firstName', e.target.value)} />
          <Input label="Last Name" required value={form.lastName} onChange={(e) => updateForm('lastName', e.target.value)} />
          <Input label="Email" type="email" required value={form.email} onChange={(e) => updateForm('email', e.target.value)} />
          <Input label="Phone" value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} />
          <Input label="Hire Date" type="date" required value={form.hireDate} onChange={(e) => updateForm('hireDate', e.target.value)} />
          <Input label="Basic Salary" type="number" required value={form.basicSalary || ''} onChange={(e) => updateForm('basicSalary', Number(e.target.value))} />
          {governmentIdFields.map((field) => (
            <Input
              key={field.key}
              label={field.label}
              placeholder={field.placeholder}
              value={form[field.key] ?? ''}
              inputMode="numeric"
              pattern="[0-9 -]*"
              maxLength={30}
              onChange={(e) => updateForm(field.key, e.target.value)}
            />
          ))}
          <Input label="Department ID" value={form.departmentId} onChange={(e) => updateForm('departmentId', e.target.value)} />
          <Input label="Position ID" value={form.positionId} onChange={(e) => updateForm('positionId', e.target.value)} />
          <Input label="City" value={form.city} onChange={(e) => updateForm('city', e.target.value)} />
          <Input label="Province" value={form.province} onChange={(e) => updateForm('province', e.target.value)} />
        </div>
      </Modal>
    </div>
  )
}
