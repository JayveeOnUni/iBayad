import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Archive, ArrowLeft, Edit2, Mail, Phone, MapPin, Briefcase, Calendar, CreditCard, RotateCcw, UserX } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Avatar from '../../../components/ui/Avatar'
import Modal from '../../../components/ui/Modal'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import Textarea from '../../../components/ui/Textarea'
import { formatDate, formatDateTime, yearsOfService } from '../../../utils/dateHelpers'
import { formatPeso } from '../../../utils/taxComputation'
import type { Employee } from '../../../types'
import { employeeService } from '../../../services/employeeService'
import { payrollService } from '../../../services/payrollService'
import {
  departmentService,
  positionService,
  shiftService,
  type ActiveDepartmentLookup,
  type ActivePositionLookup,
  type ActiveShiftLookup,
} from '../../../services/referenceDataService'

interface InfoRowProps {
  icon?: React.ReactNode
  label: string
  value?: string
}

interface EmployeeEditForm {
  phone: string
  address: string
  city: string
  province: string
  zipCode: string
  departmentId: string
  positionId: string
  shiftId: string
  employmentType: Employee['employmentType']
  basicSalary: number
  workDaysPerMonth: number
  workHoursPerDay: number
  sssNumber: string
  philhealthNumber: string
  pagibigNumber: string
  tinNumber: string
  bankName: string
  bankAccountNumber: string
}

const governmentIdFields = [
  { key: 'sssNumber', label: 'SSS Number' },
  { key: 'philhealthNumber', label: 'PhilHealth Number' },
  { key: 'pagibigNumber', label: 'Pag-IBIG Number' },
  { key: 'tinNumber', label: 'TIN' },
] as const

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

function statusLabel(status: string, isDeleted = false) {
  if (isDeleted) return 'Archived'
  return status.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function statusVariant(status: string, isDeleted = false): 'success' | 'neutral' | 'danger' | 'warning' {
  if (isDeleted) return 'neutral'
  if (status === 'active') return 'success'
  if (status === 'terminated') return 'danger'
  if (status === 'end_of_contract') return 'warning'
  return 'neutral'
}

function InfoRow({ icon, label, value }: InfoRowProps) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      {icon && <span className="mt-0.5 text-muted flex-shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="text-sm font-medium text-ink">{value ?? '—'}</p>
      </div>
    </div>
  )
}

export default function EmployeeDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isSeparationOpen, setIsSeparationOpen] = useState(false)
  const [isArchiveOpen, setIsArchiveOpen] = useState(false)
  const [isReactivateOpen, setIsReactivateOpen] = useState(false)
  const [isRestoreOpen, setIsRestoreOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLifecycleSaving, setIsLifecycleSaving] = useState(false)
  const [isSendingActivation, setIsSendingActivation] = useState(false)
  const [isLookupLoading, setIsLookupLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [departments, setDepartments] = useState<ActiveDepartmentLookup[]>([])
  const [positions, setPositions] = useState<ActivePositionLookup[]>([])
  const [shifts, setShifts] = useState<ActiveShiftLookup[]>([])
  const [editForm, setEditForm] = useState<EmployeeEditForm>({
    phone: '',
    address: '',
    city: '',
    province: '',
    zipCode: '',
    departmentId: '',
    positionId: '',
    shiftId: '',
    employmentType: 'regular',
    basicSalary: 0,
    workDaysPerMonth: 22,
    workHoursPerDay: 8,
    sssNumber: '',
    philhealthNumber: '',
    pagibigNumber: '',
    tinNumber: '',
    bankName: '',
    bankAccountNumber: '',
  })
  const [separationForm, setSeparationForm] = useState({
    status: 'resigned' as 'resigned' | 'terminated' | 'end_of_contract' | 'inactive',
    lastWorkingDay: todayDate(),
    separationDate: todayDate(),
    reasonForLeaving: '',
    remarks: '',
  })
  const [deductionPreview, setDeductionPreview] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    const loadEmployee = async () => {
      if (!id) return
      try {
        setIsLoading(true)
        setError(null)
        const res = await employeeService.getById(id)
        setEmployee(res.data)
        payrollService.computeTax(res.data.basicSalary)
          .then((taxRes) => setDeductionPreview(taxRes.data))
          .catch(() => setDeductionPreview(null))
        setEditForm(editFormFromEmployee(res.data))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load employee.')
      } finally {
        setIsLoading(false)
      }
    }

    loadEmployee()
  }, [id])

  const filteredPositions = useMemo(
    () => positions.filter((position) => !position.departmentId || position.departmentId === editForm.departmentId),
    [editForm.departmentId, positions]
  )

  useEffect(() => {
    if (!isEditOpen || !employee) return

    let isCurrent = true
    setEditForm(editFormFromEmployee(employee))
    setLookupError(null)
    setIsLookupLoading(true)

    Promise.all([
      departmentService.getActive(),
      positionService.getActive(),
      shiftService.getActive(),
    ])
      .then(([departmentData, positionData, shiftData]) => {
        if (!isCurrent) return
        setDepartments(departmentData)
        setPositions(positionData)
        setShifts(shiftData)
      })
      .catch((err) => {
        if (!isCurrent) return
        setLookupError(err instanceof Error ? err.message : 'Unable to load employee reference data.')
      })
      .finally(() => {
        if (isCurrent) setIsLookupLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [employee, isEditOpen])

  useEffect(() => {
    if (!isEditOpen || !editForm.departmentId) return
    if (editForm.positionId && !filteredPositions.some((position) => position.id === editForm.positionId)) {
      setEditForm((form) => ({ ...form, positionId: '' }))
    }
  }, [editForm.departmentId, editForm.positionId, filteredPositions, isEditOpen])

  useEffect(() => {
    if (!isEditOpen) return
    const selectedShift = shifts.find((shift) => shift.id === editForm.shiftId)
    if (selectedShift?.workingHoursPerDay) {
      setEditForm((form) => ({ ...form, workHoursPerDay: selectedShift.workingHoursPerDay }))
    }
  }, [editForm.shiftId, isEditOpen, shifts])

  const saveEmployee = async () => {
    if (!employee) return
    try {
      setIsSaving(true)
      setError(null)
      const res = await employeeService.update(employee.id, editForm)
      setEmployee(res.data)
      payrollService.computeTax(res.data.basicSalary)
        .then((taxRes) => setDeductionPreview(taxRes.data))
        .catch(() => setDeductionPreview(null))
      setIsEditOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update employee.')
    } finally {
      setIsSaving(false)
    }
  }

  const resendActivation = async () => {
    if (!employee) return
    try {
      setIsSendingActivation(true)
      setError(null)
      setSuccess(null)
      const res = await employeeService.resendActivation(employee.id)
      setSuccess(
        res.activationLink
          ? `${res.message ?? 'Activation email sent.'} Activation link: ${res.activationLink}`
          : res.message ?? 'Activation email sent.'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend activation email.')
    } finally {
      setIsSendingActivation(false)
    }
  }

  const submitSeparation = async () => {
    if (!employee) return
    try {
      setIsLifecycleSaving(true)
      setError(null)
      setSuccess(null)
      const res = await employeeService.separate(employee.id, separationForm)
      setEmployee(res.data)
      setIsSeparationOpen(false)
      setSuccess(res.message ?? 'Employee offboarding recorded.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record employee separation.')
    } finally {
      setIsLifecycleSaving(false)
    }
  }

  const archiveEmployee = async () => {
    if (!employee) return
    try {
      setIsLifecycleSaving(true)
      setError(null)
      setSuccess(null)
      const res = await employeeService.archive(employee.id)
      setEmployee(res.data)
      setIsArchiveOpen(false)
      setSuccess(res.message ?? 'Employee archived.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to archive employee.')
    } finally {
      setIsLifecycleSaving(false)
    }
  }

  const reactivateEmployee = async () => {
    if (!employee) return
    try {
      setIsLifecycleSaving(true)
      setError(null)
      setSuccess(null)
      const res = await employeeService.activate(employee.id)
      setEmployee(res.data)
      setIsReactivateOpen(false)
      setIsRestoreOpen(false)
      if (res.loginAccessRestored) {
        setSuccess('Employee reactivated. Login access has been restored.')
      } else if (res.activationRequired) {
        setSuccess('Employee reactivated. Account activation is still required before login access is restored.')
      } else {
        setSuccess(res.message ?? 'Employee reactivated.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reactivate employee.')
    } finally {
      setIsLifecycleSaving(false)
    }
  }

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading employee...</div>
  if (!employee) return <div className="p-8 text-sm text-red-700">{error ?? 'Employee not found.'}</div>

  const fullName = `${employee.firstName} ${employee.lastName}`
  const isArchived = employee.isDeleted
  const isActiveEmployee = employee.employmentStatus === 'active'
  const canReactivateAccount = !isArchived && !isActiveEmployee
  const sss = (deductionPreview?.sss ?? {}) as Record<string, unknown>
  const philHealth = (deductionPreview?.philHealth ?? {}) as Record<string, unknown>
  const pagIBIG = (deductionPreview?.pagIBIG ?? {}) as Record<string, unknown>
  const previewNetPay = Number(deductionPreview?.netPay ?? employee.basicSalary)

  return (
    <div className="space-y-5">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Employees
        </button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Mail size={14} />}
            onClick={resendActivation}
            isLoading={isSendingActivation}
            disabled={employee.employmentStatus !== 'active' || employee.isDeleted}
          >
            Resend Activation
          </Button>
          {isActiveEmployee && !isArchived && (
            <Button size="sm" variant="outline" leftIcon={<UserX size={14} />} onClick={() => setIsSeparationOpen(true)}>
              Deactivate Account
            </Button>
          )}
          {canReactivateAccount && (
            <Button size="sm" variant="outline" leftIcon={<RotateCcw size={14} />} onClick={() => setIsReactivateOpen(true)}>
              Reactivate Account
            </Button>
          )}
          {!isArchived && (
            <Button size="sm" variant="outline" leftIcon={<Archive size={14} />} onClick={() => setIsArchiveOpen(true)}>
              Archive Employee
            </Button>
          )}
          {isArchived && (
            <Button size="sm" variant="outline" leftIcon={<RotateCcw size={14} />} onClick={() => setIsRestoreOpen(true)}>
              Restore
            </Button>
          )}
          <Button size="sm" variant="outline" leftIcon={<Edit2 size={14} />} onClick={() => setIsEditOpen(true)}>
            Edit Employee
          </Button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {success && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: Profile card */}
        <div className="space-y-4">
          <Card className="text-center">
            <div className="flex flex-col items-center gap-3 py-2">
              <Avatar name={fullName} size="xl" />
              <div>
                <h2 className="text-lg font-bold text-ink">{fullName}</h2>
                <p className="text-sm text-muted">{employee.position?.title ?? '—'}</p>
                <p className="text-xs text-slate-400">{employee.employeeNumber}</p>
              </div>
              <Badge variant={statusVariant(employee.employmentStatus, employee.isDeleted)} dot>
                {statusLabel(employee.employmentStatus, employee.isDeleted)}
              </Badge>
            </div>

            <div className="border-t border-border mt-3 pt-3 space-y-0.5">
              <InfoRow icon={<Mail size={14} />} label="Email" value={employee.email} />
              <InfoRow icon={<Phone size={14} />} label="Phone" value={employee.phone} />
              <InfoRow
                icon={<MapPin size={14} />}
                label="Address"
                value={`${employee.address}, ${employee.city}`}
              />
            </div>
          </Card>

          {/* Government IDs */}
          <Card>
            <h3 className="text-sm font-semibold text-ink mb-3">Government IDs</h3>
            <div className="space-y-0.5">
              <InfoRow label="SSS Number" value={employee.sssNumber} />
              <InfoRow label="PhilHealth No." value={employee.philhealthNumber} />
              <InfoRow label="Pag-IBIG No." value={employee.pagibigNumber} />
              <InfoRow label="TIN" value={employee.tinNumber} />
            </div>
          </Card>
        </div>

        {/* Right: Details */}
        <div className="lg:col-span-2 space-y-4">
          {/* Employment Info */}
          <Card>
            <h3 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2">
              <Briefcase size={16} className="text-muted" />
              Employment Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
              <InfoRow label="Department" value={employee.department?.name} />
              <InfoRow label="Position" value={employee.position?.title} />
              <InfoRow
                label="Employment Type"
                value={employee.employmentType.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())}
              />
              <InfoRow
                label="Years of Service"
                value={`${yearsOfService(employee.hireDate)} years`}
              />
              <InfoRow
                icon={<Calendar size={14} />}
                label="Hire Date"
                value={formatDate(employee.hireDate)}
              />
              {employee.regularizationDate && (
                <InfoRow label="Regularization Date" value={formatDate(employee.regularizationDate)} />
              )}
              {employee.lastWorkingDay && (
                <InfoRow label="Last Working Day" value={formatDate(employee.lastWorkingDay)} />
              )}
              {employee.separationDate && (
                <InfoRow label="Separation Date" value={formatDate(employee.separationDate)} />
              )}
            </div>
          </Card>

          {(employee.separationReason || employee.separationRemarks || employee.isDeleted) && (
            <Card>
              <h3 className="text-sm font-semibold text-ink mb-3">Separation / Archive Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                <InfoRow label="Reason for Leaving" value={employee.separationReason} />
                <InfoRow label="Remarks" value={employee.separationRemarks} />
                <InfoRow label="Processed By" value={employee.separationProcessedBy} />
                <InfoRow label="Processed At" value={employee.separationProcessedAt ? formatDateTime(employee.separationProcessedAt) : undefined} />
                {employee.deletedAt && <InfoRow label="Archived At" value={formatDateTime(employee.deletedAt)} />}
              </div>
            </Card>
          )}

          {/* Compensation */}
          <Card>
            <h3 className="text-sm font-semibold text-ink mb-4 flex items-center gap-2">
              <CreditCard size={16} className="text-muted" />
              Compensation & Deductions
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-brand-50 rounded-lg p-4 text-center">
                <p className="text-xs text-muted mb-1">Monthly Basic Salary</p>
                <p className="text-xl font-bold text-brand">{formatPeso(employee.basicSalary)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 text-center">
                <p className="text-xs text-muted mb-1">Daily Rate</p>
                <p className="text-xl font-bold text-ink">{formatPeso(employee.dailyRate)}</p>
              </div>
              <div className="bg-slate-50 rounded-lg p-4 text-center">
                <p className="text-xs text-muted mb-1">Hourly Rate</p>
                <p className="text-xl font-bold text-ink">{formatPeso(employee.hourlyRate)}</p>
              </div>
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
                Monthly Contributions (Employee Share)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'SSS', value: Number(sss.employee ?? 0) },
                  { label: 'PhilHealth', value: Number(philHealth.employee ?? 0) },
                  { label: 'Pag-IBIG', value: Number(pagIBIG.employee ?? 0) },
                  { label: 'Withholding Tax', value: Number(deductionPreview?.withholdingTax ?? 0) },
                ].map((c) => (
                  <div key={c.label} className="text-center border border-border rounded-lg p-3">
                    <p className="text-xs text-muted">{c.label}</p>
                    <p className="text-sm font-semibold text-ink mt-0.5">{formatPeso(c.value)}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-between items-center px-3 py-2.5 bg-slate-50 rounded-lg">
                <span className="text-sm font-medium text-ink">Estimated Net Pay</span>
                <span className="text-base font-bold text-emerald-600">
                  {formatPeso(previewNetPay)}
                </span>
              </div>
            </div>
          </Card>

          {/* Bank Info */}
          <Card>
            <h3 className="text-sm font-semibold text-ink mb-3">Banking Details</h3>
            <div className="grid grid-cols-2 gap-x-6">
              <InfoRow label="Bank Name" value={employee.bankName} />
              <InfoRow label="Account Number" value={employee.bankAccountNumber} />
            </div>
          </Card>
        </div>
      </div>

      <Modal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="Edit Employee"
        size="full"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={saveEmployee} isLoading={isSaving} disabled={isLookupLoading || Boolean(lookupError)}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-6">
          {isLookupLoading && (
            <div className="rounded-lg border border-border bg-neutral-20 px-4 py-3 text-sm text-muted">
              Loading departments, positions, and shifts...
            </div>
          )}
          {lookupError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {lookupError}
            </div>
          )}

          <FieldSection title="Contact & Address">
            <Input label="Phone" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
            <Input label="Address" value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} />
            <Input label="City" value={editForm.city} onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))} />
            <Input label="Province" value={editForm.province} onChange={(e) => setEditForm((f) => ({ ...f, province: e.target.value }))} />
            <Input label="Zip Code" value={editForm.zipCode} onChange={(e) => setEditForm((f) => ({ ...f, zipCode: e.target.value }))} />
          </FieldSection>

          <FieldSection title="Employment Information">
            <Select
              label="Department"
              value={editForm.departmentId}
              disabled={isLookupLoading}
              onChange={(event) => setEditForm((form) => ({ ...form, departmentId: event.target.value }))}
            >
              <option value="">Select department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name} ({department.code})
                </option>
              ))}
            </Select>
            <Select
              label="Position"
              value={editForm.positionId}
              disabled={isLookupLoading || !editForm.departmentId}
              onChange={(event) => setEditForm((form) => ({ ...form, positionId: event.target.value }))}
            >
              <option value="">{editForm.departmentId ? 'Select position' : 'Select department first'}</option>
              {filteredPositions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.title}
                </option>
              ))}
            </Select>
            <Select
              label="Shift"
              value={editForm.shiftId}
              disabled={isLookupLoading}
              onChange={(event) => setEditForm((form) => ({ ...form, shiftId: event.target.value }))}
            >
              <option value="">No assigned shift</option>
              {shifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {formatShift(shift)}
                </option>
              ))}
            </Select>
            <Select
              label="Employment Type"
              value={editForm.employmentType}
              onChange={(event) => setEditForm((form) => ({ ...form, employmentType: event.target.value as Employee['employmentType'] }))}
            >
              <option value="regular">Regular</option>
              <option value="probationary">Probationary</option>
              <option value="contractual">Contractual</option>
              <option value="part_time">Part-time</option>
            </Select>
          </FieldSection>

          <FieldSection title="Compensation">
            <Input label="Monthly Salary" type="number" min="0.01" max="10000000" step="0.01" value={editForm.basicSalary} onChange={(e) => setEditForm((f) => ({ ...f, basicSalary: Number(e.target.value) }))} />
            <Input label="Work Days per Month" type="number" min="1" max="31" step="1" value={editForm.workDaysPerMonth} onChange={(e) => setEditForm((f) => ({ ...f, workDaysPerMonth: Number(e.target.value) }))} />
            <Input label="Work Hours per Day" type="number" min="0.25" max="24" step="0.25" value={editForm.workHoursPerDay} onChange={(e) => setEditForm((f) => ({ ...f, workHoursPerDay: Number(e.target.value) }))} />
          </FieldSection>

          <FieldSection title="Government IDs">
            {governmentIdFields.map((field) => (
              <Input
                key={field.key}
                label={field.label}
                value={editForm[field.key]}
                inputMode="numeric"
                pattern="[0-9 -]*"
                maxLength={30}
                onChange={(e) => setEditForm((f) => ({ ...f, [field.key]: e.target.value }))}
              />
            ))}
          </FieldSection>

          <FieldSection title="Bank / Payroll Details">
            <Input label="Bank Name" value={editForm.bankName} onChange={(e) => setEditForm((f) => ({ ...f, bankName: e.target.value }))} />
            <Input label="Account Number" value={editForm.bankAccountNumber} onChange={(e) => setEditForm((f) => ({ ...f, bankAccountNumber: e.target.value }))} />
          </FieldSection>
        </div>
      </Modal>

      <Modal
        isOpen={isSeparationOpen}
        onClose={() => setIsSeparationOpen(false)}
        title="Deactivate Account"
        description="This disables login access, excludes the employee from future regular payroll, and keeps records available for final pay and history."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsSeparationOpen(false)} disabled={isLifecycleSaving}>Cancel</Button>
            <Button onClick={submitSeparation} isLoading={isLifecycleSaving}>Record Separation</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select
            label="Employment Status"
            value={separationForm.status}
            onChange={(event) => setSeparationForm((form) => ({ ...form, status: event.target.value as typeof separationForm.status }))}
          >
            <option value="resigned">Resigned</option>
            <option value="terminated">Terminated</option>
            <option value="end_of_contract">End of Contract</option>
            <option value="inactive">Inactive / Former Employee</option>
          </Select>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Last Working Day" type="date" value={separationForm.lastWorkingDay} onChange={(e) => setSeparationForm((form) => ({ ...form, lastWorkingDay: e.target.value }))} required />
            <Input label="Separation Date" type="date" value={separationForm.separationDate} onChange={(e) => setSeparationForm((form) => ({ ...form, separationDate: e.target.value }))} required />
          </div>
          <Textarea label="Reason for Leaving" value={separationForm.reasonForLeaving} onChange={(e) => setSeparationForm((form) => ({ ...form, reasonForLeaving: e.target.value }))} required />
          <Textarea label="Remarks" value={separationForm.remarks} onChange={(e) => setSeparationForm((form) => ({ ...form, remarks: e.target.value }))} />
        </div>
      </Modal>

      <Modal
        isOpen={isArchiveOpen}
        onClose={() => setIsArchiveOpen(false)}
        title="Archive Employee"
        description="Archived employees are hidden from normal active lists but remain searchable for HR/admin audit and payroll history."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsArchiveOpen(false)} disabled={isLifecycleSaving}>Cancel</Button>
            <Button variant="danger" onClick={archiveEmployee} isLoading={isLifecycleSaving}>Archive Employee</Button>
          </>
        }
      >
        <p className="text-sm text-ink">
          This will disable the linked login account, revoke refresh access, and preserve payroll, attendance, payslip, loan, and tax history.
        </p>
      </Modal>

      <Modal
        isOpen={isReactivateOpen}
        onClose={() => setIsReactivateOpen(false)}
        title="Reactivate Account"
        description="This returns a non-archived inactive or separated employee to active employment status."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsReactivateOpen(false)} disabled={isLifecycleSaving}>Cancel</Button>
            <Button onClick={reactivateEmployee} isLoading={isLifecycleSaving}>Reactivate Account</Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-ink">
          <p>The employee will be marked active again and separation fields will be cleared.</p>
          <p>Login access will be restored only if the employee already activated their account before.</p>
        </div>
      </Modal>

      <Modal
        isOpen={isRestoreOpen}
        onClose={() => setIsRestoreOpen(false)}
        title="Restore Employee"
        description="This restores an archived employee record to active status."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsRestoreOpen(false)} disabled={isLifecycleSaving}>Cancel</Button>
            <Button onClick={reactivateEmployee} isLoading={isLifecycleSaving}>Restore</Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-ink">
          <p>The employee will be removed from the archive, marked active again, and separation fields will be cleared.</p>
          <p>Login access will be restored only if the employee already activated their account before.</p>
        </div>
      </Modal>
    </div>
  )
}

function formatShift(shift: ActiveShiftLookup): string {
  return `${shift.name} (${shift.startTime}-${shift.endTime}, ${shift.workingHoursPerDay}h)`
}

function editFormFromEmployee(employee: Employee): EmployeeEditForm {
  return {
    phone: employee.phone ?? '',
    address: employee.address ?? '',
    city: employee.city ?? '',
    province: employee.province ?? '',
    zipCode: employee.zipCode ?? '',
    departmentId: employee.departmentId ?? '',
    positionId: employee.positionId ?? '',
    shiftId: employee.shiftId ?? '',
    employmentType: employee.employmentType,
    basicSalary: employee.basicSalary,
    workDaysPerMonth: employee.workDaysPerMonth ?? 22,
    workHoursPerDay: employee.workHoursPerDay ?? 8,
    sssNumber: employee.sssNumber ?? '',
    philhealthNumber: employee.philhealthNumber ?? '',
    pagibigNumber: employee.pagibigNumber ?? '',
    tinNumber: employee.tinNumber ?? '',
    bankName: employee.bankName ?? '',
    bankAccountNumber: employee.bankAccountNumber ?? '',
  }
}

function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="border-b border-border pb-2 text-sm font-semibold text-ink">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}
