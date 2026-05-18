import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Download, RefreshCw } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Table, { Pagination } from '../../../components/ui/Table'
import Badge from '../../../components/ui/Badge'
import Avatar from '../../../components/ui/Avatar'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import { FeedbackMessage, PageHeader } from '../../../components/ui/Page'
import type { Employee } from '../../../types'
import { formatDate } from '../../../utils/dateHelpers'
import { formatPeso } from '../../../utils/taxComputation'
import { employeeService } from '../../../services/employeeService'
import AddEmployeeModal from './AddEmployeeModal'

type CreateEmployeeResponse = Awaited<ReturnType<typeof employeeService.create>>

interface ActivationFollowUp {
  employeeId: string
  email: string
  message: string
  activationLink?: string
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
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activationFollowUp, setActivationFollowUp] = useState<ActivationFollowUp | null>(null)
  const [isResendingActivation, setIsResendingActivation] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)

  const loadEmployees = useCallback(async () => {
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
  }, [page, search, statusFilter])

  useEffect(() => {
    void loadEmployees()
  }, [loadEmployees])

  const handleEmployeeCreated = async (res: CreateEmployeeResponse) => {
    setIsAddOpen(false)
    await loadEmployees()

    if (res.activationEmailSent === false) {
      setSuccess(null)
      setActivationFollowUp({
        employeeId: res.data.id,
        email: res.data.email,
        message: res.message ?? `Employee account created, but activation email could not be sent to ${res.data.email}.`,
        activationLink: res.activationLink,
      })
      return
    }

    setActivationFollowUp(null)
    setSuccess(
      res.activationLink
        ? `${res.message ?? 'Employee account created.'} Activation link: ${res.activationLink}`
        : res.message ?? 'Employee account created. Activation email sent.'
    )
  }

  const resendActivation = async () => {
    if (!activationFollowUp) return

    try {
      setIsResendingActivation(true)
      setError(null)
      setSuccess(null)
      const res = await employeeService.resendActivation(activationFollowUp.employeeId)
      setActivationFollowUp(null)
      setSuccess(
        res.activationLink
          ? `${res.message ?? 'Activation email sent.'} Activation link: ${res.activationLink}`
          : res.message ?? `Activation email sent to ${activationFollowUp.email}.`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend activation email.')
    } finally {
      setIsResendingActivation(false)
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
          <Button
            size="sm"
            leftIcon={<Plus size={14} />}
            onClick={() => {
              setError(null)
              setSuccess(null)
              setActivationFollowUp(null)
              setIsAddOpen(true)
            }}
          >
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

      {activationFollowUp && (
        <FeedbackMessage variant="warning">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p>{activationFollowUp.message}</p>
              {activationFollowUp.activationLink && (
                <p className="break-all text-xs">Activation link: {activationFollowUp.activationLink}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                leftIcon={<RefreshCw size={14} />}
                isLoading={isResendingActivation}
                onClick={resendActivation}
              >
                Resend Activation
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/admin/employees/${activationFollowUp.employeeId}`)}
              >
                Open Employee
              </Button>
            </div>
          </div>
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

      <AddEmployeeModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onCreated={handleEmployeeCreated}
      />
    </div>
  )
}
