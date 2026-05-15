import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import Modal from '../../../components/ui/Modal'
import Select from '../../../components/ui/Select'
import { FeedbackMessage } from '../../../components/ui/Page'
import { employeeService } from '../../../services/employeeService'
import {
  departmentService,
  positionService,
  shiftService,
  type ActiveDepartmentLookup,
  type ActivePositionLookup,
  type ActiveShiftLookup,
} from '../../../services/referenceDataService'
import type { EmployeeFormData } from '../../../types'

type CreateEmployeeResponse = Awaited<ReturnType<typeof employeeService.create>>

interface AddEmployeeModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (response: CreateEmployeeResponse) => Promise<void> | void
}

const governmentIdFields = [
  { key: 'sssNumber', label: 'SSS Number', placeholder: 'e.g. 12-3456789-0' },
  { key: 'philhealthNumber', label: 'PhilHealth Number', placeholder: 'e.g. 12-345678901-2' },
  { key: 'pagibigNumber', label: 'Pag-IBIG Number', placeholder: 'e.g. 1234-5678-9012' },
  { key: 'tinNumber', label: 'TIN Number', placeholder: 'e.g. 123-456-789-000' },
] as const

function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

const optionalGovernmentId = z
  .string()
  .trim()
  .refine((value) => value.length <= 30, 'Must be 30 characters or fewer')
  .refine((value) => value === '' || /^[0-9 -]+$/.test(value), 'Use only numbers, spaces, or hyphens')

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === '' || isDateOnly(value), 'Enter a valid date')

const employeeFormSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required'),
  middleName: z.string().trim(),
  lastName: z.string().trim().min(1, 'Last name is required'),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  phone: z.string().trim(),
  birthDate: optionalDate,
  gender: z.enum(['male', 'female', 'other']),
  civilStatus: z.enum(['single', 'married', 'widowed', 'separated']),
  address: z.string().trim(),
  city: z.string().trim(),
  province: z.string().trim(),
  zipCode: z.string().trim(),
  departmentId: z.string().trim().min(1, 'Select a department'),
  positionId: z.string().trim().min(1, 'Select a position'),
  employmentType: z.enum(['regular', 'probationary', 'contractual', 'part_time']),
  hireDate: z.string().trim().min(1, 'Hire date is required').refine(isDateOnly, 'Enter a valid hire date'),
  shiftId: z.string().trim(),
  basicSalary: z.coerce.number().positive('Monthly salary must be greater than 0'),
  workDaysPerMonth: z.coerce.number().int('Work days must be a whole number').positive('Work days must be greater than 0'),
  workHoursPerDay: z.coerce.number().positive('Work hours must be greater than 0'),
  sssNumber: optionalGovernmentId,
  philhealthNumber: optionalGovernmentId,
  pagibigNumber: optionalGovernmentId,
  tinNumber: optionalGovernmentId,
  bankName: z.string().trim(),
  bankAccountNumber: z.string().trim(),
})

function defaultEmployeeForm(): EmployeeFormData {
  return {
    firstName: '',
    middleName: '',
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
    shiftId: '',
    basicSalary: 0,
    workDaysPerMonth: 22,
    workHoursPerDay: 8,
    sssNumber: '',
    philhealthNumber: '',
    pagibigNumber: '',
    tinNumber: '',
    bankName: '',
    bankAccountNumber: '',
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : undefined
}

function toPayload(values: EmployeeFormData): EmployeeFormData {
  return {
    ...values,
    firstName: values.firstName.trim(),
    middleName: emptyToUndefined(values.middleName),
    lastName: values.lastName.trim(),
    email: values.email.trim().toLowerCase(),
    phone: emptyToUndefined(values.phone),
    birthDate: values.birthDate?.trim() ?? '',
    address: values.address.trim(),
    city: values.city.trim(),
    province: values.province.trim(),
    zipCode: values.zipCode.trim(),
    shiftId: emptyToUndefined(values.shiftId),
    basicSalary: Number(values.basicSalary),
    workDaysPerMonth: Number(values.workDaysPerMonth),
    workHoursPerDay: Number(values.workHoursPerDay),
    sssNumber: emptyToUndefined(values.sssNumber),
    philhealthNumber: emptyToUndefined(values.philhealthNumber),
    pagibigNumber: emptyToUndefined(values.pagibigNumber),
    tinNumber: emptyToUndefined(values.tinNumber),
    bankName: emptyToUndefined(values.bankName),
    bankAccountNumber: emptyToUndefined(values.bankAccountNumber),
  }
}

function formatShift(shift: ActiveShiftLookup): string {
  return `${shift.name} (${shift.startTime}-${shift.endTime}, ${shift.workingHoursPerDay}h)`
}

function FieldSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="border-b border-border pb-2 text-sm font-semibold text-ink">{title}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

export default function AddEmployeeModal({ isOpen, onClose, onCreated }: AddEmployeeModalProps) {
  const [departments, setDepartments] = useState<ActiveDepartmentLookup[]>([])
  const [positions, setPositions] = useState<ActivePositionLookup[]>([])
  const [shifts, setShifts] = useState<ActiveShiftLookup[]>([])
  const [isLookupLoading, setIsLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    formState: { errors },
  } = useForm<EmployeeFormData>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: defaultEmployeeForm(),
  })

  const selectedDepartmentId = watch('departmentId')
  const selectedPositionId = watch('positionId')
  const selectedShiftId = watch('shiftId')

  const filteredPositions = useMemo(
    () => positions.filter((position) => !position.departmentId || position.departmentId === selectedDepartmentId),
    [positions, selectedDepartmentId]
  )

  useEffect(() => {
    if (!isOpen) return

    let isCurrent = true
    reset(defaultEmployeeForm())
    setSaveError(null)
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
  }, [isOpen, reset])

  useEffect(() => {
    if (!selectedDepartmentId) {
      setValue('positionId', '')
      return
    }

    const currentPositionId = getValues('positionId')
    if (currentPositionId && !filteredPositions.some((position) => position.id === currentPositionId)) {
      setValue('positionId', '', { shouldValidate: true })
    }
  }, [filteredPositions, getValues, selectedDepartmentId, setValue])

  useEffect(() => {
    const selectedPosition = positions.find((position) => position.id === selectedPositionId)
    if (selectedPosition?.basicSalary && Number(getValues('basicSalary')) <= 0) {
      setValue('basicSalary', selectedPosition.basicSalary, { shouldValidate: true })
    }
  }, [getValues, positions, selectedPositionId, setValue])

  useEffect(() => {
    const selectedShift = shifts.find((shift) => shift.id === selectedShiftId)
    if (selectedShift?.workingHoursPerDay) {
      setValue('workHoursPerDay', selectedShift.workingHoursPerDay, { shouldValidate: true })
    }
  }, [selectedShiftId, setValue, shifts])

  const onSubmit = async (values: EmployeeFormData) => {
    if (isSaving) return

    try {
      setIsSaving(true)
      setSaveError(null)
      const response = await employeeService.create(toPayload(values))
      await onCreated(response)
      reset(defaultEmployeeForm())
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Unable to create employee.')
    } finally {
      setIsSaving(false)
    }
  }

  const closeModal = () => {
    if (isSaving) return
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeModal}
      title="Add Employee"
      size="full"
      footer={
        <>
          <Button variant="outline" onClick={closeModal} disabled={isSaving}>Cancel</Button>
          <Button
            type="submit"
            form="add-employee-form"
            isLoading={isSaving}
            disabled={isLookupLoading || Boolean(lookupError)}
          >
            Save Employee
          </Button>
        </>
      }
    >
      <form id="add-employee-form" onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        {isLookupLoading && (
          <FeedbackMessage>Loading departments, positions, and shifts...</FeedbackMessage>
        )}

        {lookupError && (
          <FeedbackMessage variant="danger">
            {lookupError}
          </FeedbackMessage>
        )}

        {saveError && (
          <FeedbackMessage variant="danger">
            {saveError}
          </FeedbackMessage>
        )}

        <FieldSection title="Personal Information">
          <Input label="First Name" required error={errors.firstName?.message} {...register('firstName')} />
          <Input label="Middle Name" error={errors.middleName?.message} {...register('middleName')} />
          <Input label="Last Name" required error={errors.lastName?.message} {...register('lastName')} />
          <Input label="Email" type="email" required error={errors.email?.message} {...register('email')} />
          <Input label="Contact Number" error={errors.phone?.message} {...register('phone')} />
          <Input label="Birth Date" type="date" error={errors.birthDate?.message} {...register('birthDate')} />
          <Select label="Gender" required error={errors.gender?.message} {...register('gender')}>
            <option value="other">Other</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </Select>
          <Select label="Civil Status" required error={errors.civilStatus?.message} {...register('civilStatus')}>
            <option value="single">Single</option>
            <option value="married">Married</option>
            <option value="widowed">Widowed</option>
            <option value="separated">Separated</option>
          </Select>
        </FieldSection>

        <FieldSection title="Employment Information">
          <Input label="Employee Number" value="Auto-generated" disabled readOnly />
          <Select
            label="Department"
            required
            disabled={isLookupLoading}
            error={errors.departmentId?.message}
            {...register('departmentId')}
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
            required
            disabled={isLookupLoading || !selectedDepartmentId}
            error={errors.positionId?.message}
            {...register('positionId')}
          >
            <option value="">
              {selectedDepartmentId ? 'Select position' : 'Select department first'}
            </option>
            {filteredPositions.map((position) => (
              <option key={position.id} value={position.id}>
                {position.title}
              </option>
            ))}
          </Select>
          <Select label="Employment Type" required error={errors.employmentType?.message} {...register('employmentType')}>
            <option value="regular">Regular</option>
            <option value="probationary">Probationary</option>
            <option value="contractual">Contractual</option>
            <option value="part_time">Part-time</option>
          </Select>
          <Input label="Hire Date" type="date" required error={errors.hireDate?.message} {...register('hireDate')} />
          <Select label="Shift" disabled={isLookupLoading} error={errors.shiftId?.message} {...register('shiftId')}>
            <option value="">No assigned shift</option>
            {shifts.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {formatShift(shift)}
              </option>
            ))}
          </Select>
        </FieldSection>

        <FieldSection title="Compensation">
          <Input
            label="Monthly Salary"
            type="number"
            min="0"
            step="0.01"
            required
            error={errors.basicSalary?.message}
            {...register('basicSalary', { valueAsNumber: true })}
          />
          <Input
            label="Work Days per Month"
            type="number"
            min="1"
            step="1"
            required
            error={errors.workDaysPerMonth?.message}
            {...register('workDaysPerMonth', { valueAsNumber: true })}
          />
          <Input
            label="Work Hours per Day"
            type="number"
            min="0.25"
            step="0.25"
            required
            error={errors.workHoursPerDay?.message}
            {...register('workHoursPerDay', { valueAsNumber: true })}
          />
        </FieldSection>

        <FieldSection title="Government IDs">
          {governmentIdFields.map((field) => (
            <Input
              key={field.key}
              label={field.label}
              placeholder={field.placeholder}
              inputMode="numeric"
              pattern="[0-9 -]*"
              maxLength={30}
              error={errors[field.key]?.message}
              {...register(field.key)}
            />
          ))}
        </FieldSection>

        <FieldSection title="Bank / Payroll Details">
          <Input label="Bank Name" error={errors.bankName?.message} {...register('bankName')} />
          <Input label="Account Number" error={errors.bankAccountNumber?.message} {...register('bankAccountNumber')} />
        </FieldSection>
      </form>
    </Modal>
  )
}
