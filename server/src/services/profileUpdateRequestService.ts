import pool from '../utils/db'
import { createError } from '../middleware/errorHandler'

type Queryable = Pick<typeof pool, 'query'>
type DbDate = Date | string | null

export type ProfileUpdateRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export interface ProfileUpdateChange {
  field: EditableProfileField
  label: string
  current: string | null
  requested: string | null
}

export interface ProfileUpdateRequestRow {
  id: string
  employee_id: string
  requested_changes: Record<string, ProfileUpdateChange>
  status: ProfileUpdateRequestStatus
  employee_note: string | null
  review_remarks: string | null
  reviewed_by: string | null
  reviewed_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
  first_name?: string
  last_name?: string
  employee_number?: string
  reviewer_first_name?: string | null
  reviewer_last_name?: string | null
}

interface EmployeeProfileRow {
  id: string
  first_name: string
  middle_name: string | null
  last_name: string
  email: string
  phone: string | null
  birth_date: DbDate
  gender: string | null
  civil_status: string | null
  address: string | null
  city: string | null
  province: string | null
  zip_code: string | null
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const GENDER_VALUES = ['male', 'female', 'other'] as const
const CIVIL_STATUS_VALUES = ['single', 'married', 'widowed', 'separated'] as const

const editableFields = {
  firstName: { dbColumn: 'first_name', label: 'First Name', required: true, maxLength: 100 },
  middleName: { dbColumn: 'middle_name', label: 'Middle Name', maxLength: 100 },
  lastName: { dbColumn: 'last_name', label: 'Last Name', required: true, maxLength: 100 },
  email: { dbColumn: 'email', label: 'Email Address', required: true, maxLength: 255, email: true },
  phone: { dbColumn: 'phone', label: 'Phone Number', maxLength: 20 },
  birthDate: { dbColumn: 'birth_date', label: 'Birth Date', date: true },
  gender: { dbColumn: 'gender', label: 'Gender', enumValues: GENDER_VALUES },
  civilStatus: { dbColumn: 'civil_status', label: 'Civil Status', enumValues: CIVIL_STATUS_VALUES },
  address: { dbColumn: 'address', label: 'Address', maxLength: 1000 },
  city: { dbColumn: 'city', label: 'City', maxLength: 100 },
  province: { dbColumn: 'province', label: 'Province', maxLength: 100 },
  zipCode: { dbColumn: 'zip_code', label: 'ZIP Code', maxLength: 10 },
} as const

export type EditableProfileField = keyof typeof editableFields

const editableFieldNames = Object.keys(editableFields) as EditableProfileField[]
const editableFieldNameSet = new Set<string>(editableFieldNames)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function emptyToNull(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

function formatDateOnly(value: DbDate): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

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

function normalizeRequestedValue(field: EditableProfileField, value: unknown): string | null {
  const meta = editableFields[field]
  const normalized = emptyToNull(value)

  if (!normalized) {
    if ('required' in meta && meta.required) {
      throw createError(`${meta.label} cannot be blank`, 400)
    }
    return null
  }

  if ('maxLength' in meta && normalized.length > meta.maxLength) {
    throw createError(`${meta.label} must be ${meta.maxLength} characters or fewer`, 400)
  }

  if ('date' in meta && meta.date && (!DATE_ONLY_PATTERN.test(normalized) || !isDateOnly(normalized))) {
    throw createError(`${meta.label} must be a valid date in YYYY-MM-DD format`, 400)
  }

  if ('email' in meta && meta.email) {
    const email = normalized.toLowerCase()
    if (!EMAIL_PATTERN.test(email)) throw createError('Email Address must be a valid email address', 400)
    return email
  }

  if ('enumValues' in meta && !meta.enumValues.includes(normalized as never)) {
    throw createError(`${meta.label} must be one of: ${meta.enumValues.join(', ')}`, 400)
  }

  return normalized
}

function currentEmployeeValue(employee: EmployeeProfileRow, field: EditableProfileField): string | null {
  const column = editableFields[field].dbColumn
  if (field === 'birthDate') return formatDateOnly(employee.birth_date)
  return emptyToNull(employee[column as keyof EmployeeProfileRow])
}

function getRequestPayload(body: unknown): { values: Record<string, unknown>; employeeNote: string | null } {
  if (!isPlainObject(body)) throw createError('Request body must be an object', 400)

  const hasChangesObject = Object.prototype.hasOwnProperty.call(body, 'changes')
  const allowedTopLevel = hasChangesObject ? new Set(['changes', 'employeeNote']) : new Set([...editableFieldNames, 'employeeNote'])

  const unknownTopLevel = Object.keys(body).filter((field) => !allowedTopLevel.has(field))
  if (unknownTopLevel.length > 0) {
    throw createError(`Unknown profile update field(s): ${unknownTopLevel.join(', ')}`, 400)
  }

  const values = hasChangesObject ? body.changes : body
  if (!isPlainObject(values)) throw createError('changes must be an object', 400)

  const unknownChangeFields = Object.keys(values).filter((field) => !editableFieldNameSet.has(field))
  if (unknownChangeFields.length > 0) {
    throw createError(`Unknown profile update field(s): ${unknownChangeFields.join(', ')}`, 400)
  }

  return {
    values,
    employeeNote: emptyToNull(body.employeeNote),
  }
}

async function getEmployeeProfile(employeeId: string, db: Queryable = pool): Promise<EmployeeProfileRow> {
  const result = await db.query(
    `SELECT id, first_name, middle_name, last_name, email, phone,
            birth_date, gender, civil_status, address, city, province, zip_code
     FROM employees
     WHERE id = $1`,
    [employeeId]
  )
  const employee = result.rows[0] as EmployeeProfileRow | undefined
  if (!employee) throw createError('Profile not found', 404)
  return employee
}

export function buildRequestedChanges(
  employee: EmployeeProfileRow,
  values: Record<string, unknown>
): Record<string, ProfileUpdateChange> {
  const changes: Record<string, ProfileUpdateChange> = {}

  for (const field of editableFieldNames) {
    if (!Object.prototype.hasOwnProperty.call(values, field)) continue

    const current = currentEmployeeValue(employee, field)
    const requested = normalizeRequestedValue(field, values[field])

    if (current !== requested) {
      changes[field] = {
        field,
        label: editableFields[field].label,
        current,
        requested,
      }
    }
  }

  return changes
}

export async function createProfileUpdateRequest(employeeId: string, body: unknown): Promise<ProfileUpdateRequestRow> {
  const { values, employeeNote } = getRequestPayload(body)
  const employee = await getEmployeeProfile(employeeId)
  const changes = buildRequestedChanges(employee, values)

  if (Object.keys(changes).length === 0) {
    throw createError('No actual profile changes were submitted.', 400)
  }

  const result = await pool.query(
    `INSERT INTO profile_update_requests (employee_id, requested_changes, employee_note)
     VALUES ($1, $2::jsonb, $3)
     RETURNING *`,
    [employeeId, JSON.stringify(changes), employeeNote]
  )

  return result.rows[0] as ProfileUpdateRequestRow
}

export async function listMyProfileUpdateRequests(employeeId: string): Promise<ProfileUpdateRequestRow[]> {
  const result = await pool.query(
    `SELECT *
     FROM profile_update_requests
     WHERE employee_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [employeeId]
  )

  return result.rows as ProfileUpdateRequestRow[]
}

export async function listProfileUpdateRequests(params: { status?: string; limit?: number } = {}): Promise<ProfileUpdateRequestRow[]> {
  const values: unknown[] = []
  const conditions: string[] = []

  if (params.status) {
    conditions.push(`pur.status = $${values.length + 1}`)
    values.push(params.status)
  }

  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100)
  values.push(limit)

  const result = await pool.query(
    `SELECT pur.*, e.first_name, e.last_name, e.employee_number
     FROM profile_update_requests pur
     JOIN employees e ON e.id = pur.employee_id
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY
       CASE WHEN pur.status = 'pending' THEN 0 ELSE 1 END,
       pur.created_at DESC
     LIMIT $${values.length}`,
    values
  )

  return result.rows as ProfileUpdateRequestRow[]
}

export async function getProfileUpdateRequestById(id: string): Promise<ProfileUpdateRequestRow> {
  const result = await pool.query(
    `SELECT pur.*, e.first_name, e.last_name, e.employee_number,
            reviewer.first_name AS reviewer_first_name,
            reviewer.last_name AS reviewer_last_name
     FROM profile_update_requests pur
     JOIN employees e ON e.id = pur.employee_id
     LEFT JOIN users reviewer_user ON reviewer_user.id = pur.reviewed_by
     LEFT JOIN employees reviewer ON reviewer.id = reviewer_user.employee_id
     WHERE pur.id = $1`,
    [id]
  )
  const request = result.rows[0] as ProfileUpdateRequestRow | undefined
  if (!request) throw createError('Profile update request not found', 404)
  return request
}

function updateDataFromChanges(changes: Record<string, ProfileUpdateChange>): Record<string, string | null> {
  const data: Record<string, string | null> = {}

  for (const [field, change] of Object.entries(changes)) {
    if (!editableFieldNameSet.has(field)) {
      throw createError(`Profile update request contains unsupported field: ${field}`, 400)
    }

    data[editableFields[field as EditableProfileField].dbColumn] = change.requested
  }

  return data
}

function toDuplicateProfileUpdateError(error: unknown): Error {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  ) {
    return createError('The requested profile change conflicts with an existing employee record.', 409)
  }

  return error instanceof Error ? error : createError('Unable to review profile update request', 500)
}

export async function approveProfileUpdateRequest(id: string, reviewerUserId: string): Promise<ProfileUpdateRequestRow> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const requestResult = await client.query(
      `SELECT *
       FROM profile_update_requests
       WHERE id = $1
       FOR UPDATE`,
      [id]
    )
    const request = requestResult.rows[0] as ProfileUpdateRequestRow | undefined
    if (!request) throw createError('Profile update request not found', 404)
    if (request.status !== 'pending') throw createError('Only pending profile update requests can be approved.', 400)

    const data = updateDataFromChanges(request.requested_changes)
    const fields = Object.keys(data)
    if (fields.length === 0) throw createError('Profile update request has no changes to apply.', 400)

    const assignments = fields.map((field, index) => `${field} = $${index + 2}`).join(', ')
    await client.query(
      `UPDATE employees
       SET ${assignments}, updated_at = NOW()
       WHERE id = $1`,
      [request.employee_id, ...fields.map((field) => data[field])]
    )

    const updatedResult = await client.query(
      `UPDATE profile_update_requests
       SET status = 'approved',
           reviewed_by = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, reviewerUserId]
    )

    await client.query('COMMIT')
    return updatedResult.rows[0] as ProfileUpdateRequestRow
  } catch (error) {
    await client.query('ROLLBACK')
    throw toDuplicateProfileUpdateError(error)
  } finally {
    client.release()
  }
}

export async function rejectProfileUpdateRequest(
  id: string,
  reviewerUserId: string,
  remarks?: unknown
): Promise<ProfileUpdateRequestRow> {
  const reviewRemarks = emptyToNull(remarks)
  const result = await pool.query(
    `UPDATE profile_update_requests
     SET status = 'rejected',
         reviewed_by = $2,
         reviewed_at = NOW(),
         review_remarks = $3,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'pending'
     RETURNING *`,
    [id, reviewerUserId, reviewRemarks]
  )

  const request = result.rows[0] as ProfileUpdateRequestRow | undefined
  if (request) return request

  const existing = await pool.query('SELECT status FROM profile_update_requests WHERE id = $1', [id])
  if (!existing.rows[0]) throw createError('Profile update request not found', 404)
  throw createError('Only pending profile update requests can be rejected.', 400)
}
