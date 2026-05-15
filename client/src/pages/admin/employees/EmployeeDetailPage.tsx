import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit2, Mail, Phone, MapPin, Briefcase, Calendar, CreditCard } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Badge from '../../../components/ui/Badge'
import Avatar from '../../../components/ui/Avatar'
import Modal from '../../../components/ui/Modal'
import Input from '../../../components/ui/Input'
import { formatDate, yearsOfService } from '../../../utils/dateHelpers'
import { formatPeso } from '../../../utils/taxComputation'
import type { Employee } from '../../../types'
import { employeeService } from '../../../services/employeeService'
import { payrollService } from '../../../services/payrollService'

interface InfoRowProps {
  icon?: React.ReactNode
  label: string
  value?: string
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
  const [isSaving, setIsSaving] = useState(false)
  const [isSendingActivation, setIsSendingActivation] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ phone: '', address: '', city: '', basicSalary: 0 })
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
        setEditForm({
          phone: res.data.phone ?? '',
          address: res.data.address ?? '',
          city: res.data.city ?? '',
          basicSalary: res.data.basicSalary,
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load employee.')
      } finally {
        setIsLoading(false)
      }
    }

    loadEmployee()
  }, [id])

  const saveEmployee = async () => {
    if (!employee) return
    try {
      setIsSaving(true)
      setError(null)
      const res = await employeeService.update(employee.id, editForm)
      setEmployee(res.data)
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

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading employee...</div>
  if (!employee) return <div className="p-8 text-sm text-red-700">{error ?? 'Employee not found.'}</div>

  const fullName = `${employee.firstName} ${employee.lastName}`
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
          >
            Resend Activation
          </Button>
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
              <Badge variant="success" dot>
                {employee.employmentStatus}
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
            </div>
          </Card>

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
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={saveEmployee} isLoading={isSaving}>Save Changes</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Phone" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
          <Input label="Address" value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} />
          <Input label="City" value={editForm.city} onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))} />
          <Input label="Basic Salary" type="number" value={editForm.basicSalary} onChange={(e) => setEditForm((f) => ({ ...f, basicSalary: Number(e.target.value) }))} />
        </div>
      </Modal>
    </div>
  )
}
