import pool from '../utils/db'

export interface ActiveDepartmentLookup {
  id: string
  name: string
  code: string
  description: string | null
}

export interface ActivePositionLookup {
  id: string
  title: string
  code: string
  description: string | null
  departmentId: string | null
  basicSalary: number | null
}

export interface ActiveShiftLookup {
  id: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  workingHoursPerDay: number
}

export interface AdminDepartment {
  id: string
  name: string
  code: string
  description: string | null
  managerId: string | null
  managerName: string | null
  isActive: boolean
  employeeCount: number
  positionCount: number
  createdAt: string
  updatedAt: string
}

export interface DepartmentMutationInput {
  name: string
  code: string
  description: string | null
}

export interface AdminShift {
  id: string
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  workingHoursPerDay: number
  isNightShift: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface ShiftMutationInput {
  name: string
  startTime: string
  endTime: string
  breakMinutes: number
  workingHoursPerDay: number
}

export interface AdminAnnouncement {
  id: string
  title: string
  content: string
  startDate: string | null
  endDate: string | null
  isPinned: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface AnnouncementMutationInput {
  title: string
  content: string
  startDate: string | null
  endDate: string | null
  isPinned: boolean
}

export type DeleteShiftResult =
  | { status: 'deleted'; deletedShiftId: string; reassignedEmployees: number }
  | { status: 'not_found' }
  | { status: 'regular_shift' }
  | { status: 'missing_regular_shift' }
  | { status: 'has_attendance_history' }

export type DeleteDepartmentResult =
  | { status: 'deleted'; deletedDepartmentId: string }
  | { status: 'not_found' }
  | { status: 'has_related_records'; employeeCount: number; positionCount: number }

export type DeleteAnnouncementResult =
  | { status: 'deleted'; deletedAnnouncementId: string }
  | { status: 'not_found' }

interface DepartmentRow {
  id: string
  name: string
  code: string
  description: string | null
  manager_id: string | null
  manager_name: string | null
  is_active: boolean | null
  employee_count: number | string | null
  position_count: number | string | null
  created_at: Date | string
  updated_at: Date | string
}

interface ShiftRow {
  id: string
  name: string
  start_time: string
  end_time: string
  break_minutes: number | string | null
  work_hours: number | string | null
  is_active: boolean | null
  created_at: Date | string
  updated_at: Date | string
}

interface AnnouncementRow {
  id: string
  title: string
  content: string
  start_date: string | null
  end_date: string | null
  is_pinned: boolean | null
  created_by: string | null
  created_at: Date | string
  updated_at: Date | string
}

function toNumberOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapDepartmentRow(row: DepartmentRow): AdminDepartment {
  return {
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    description: row.description == null ? null : String(row.description),
    managerId: row.manager_id == null ? null : String(row.manager_id),
    managerName: row.manager_name == null ? null : String(row.manager_name),
    isActive: Boolean(row.is_active),
    employeeCount: Number(row.employee_count ?? 0),
    positionCount: Number(row.position_count ?? 0),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function isNightShift(startTime: string, endTime: string): boolean {
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)
  return start >= 18 * 60 || end <= 6 * 60 || end <= start
}

function mapShiftRow(row: ShiftRow): AdminShift {
  const startTime = String(row.start_time)
  const endTime = String(row.end_time)

  return {
    id: String(row.id),
    name: String(row.name),
    startTime,
    endTime,
    breakMinutes: Number(row.break_minutes ?? 0),
    workingHoursPerDay: Number(row.work_hours ?? 0),
    isNightShift: isNightShift(startTime, endTime),
    isActive: Boolean(row.is_active),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

function mapAnnouncementRow(row: AnnouncementRow): AdminAnnouncement {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    startDate: row.start_date,
    endDate: row.end_date,
    isPinned: Boolean(row.is_pinned),
    createdBy: row.created_by == null ? null : String(row.created_by),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  }
}

export async function getActiveDepartments(): Promise<ActiveDepartmentLookup[]> {
  const result = await pool.query(
    `SELECT id, name, code, description
     FROM departments
     WHERE is_active = true
     ORDER BY name`
  )

  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    code: String(row.code),
    description: row.description == null ? null : String(row.description),
  }))
}

export async function getAllDepartments(): Promise<AdminDepartment[]> {
  const result = await pool.query<DepartmentRow>(
    `SELECT
       d.id,
       d.name,
       d.code,
       d.description,
       d.manager_id,
       NULLIF(TRIM(CONCAT_WS(' ', manager.first_name, manager.last_name)), '') AS manager_name,
       d.is_active,
       COUNT(DISTINCT e.id) AS employee_count,
       COUNT(DISTINCT p.id) AS position_count,
       d.created_at,
       d.updated_at
     FROM departments d
     LEFT JOIN employees manager ON manager.id = d.manager_id
     LEFT JOIN employees e ON e.department_id = d.id
     LEFT JOIN positions p ON p.department_id = d.id
     GROUP BY d.id, manager.first_name, manager.last_name
     ORDER BY d.is_active DESC, d.name`
  )

  return result.rows.map(mapDepartmentRow)
}

async function getDepartmentById(id: string): Promise<AdminDepartment | null> {
  const result = await pool.query<DepartmentRow>(
    `SELECT
       d.id,
       d.name,
       d.code,
       d.description,
       d.manager_id,
       NULLIF(TRIM(CONCAT_WS(' ', manager.first_name, manager.last_name)), '') AS manager_name,
       d.is_active,
       COUNT(DISTINCT e.id) AS employee_count,
       COUNT(DISTINCT p.id) AS position_count,
       d.created_at,
       d.updated_at
     FROM departments d
     LEFT JOIN employees manager ON manager.id = d.manager_id
     LEFT JOIN employees e ON e.department_id = d.id
     LEFT JOIN positions p ON p.department_id = d.id
     WHERE d.id = $1
     GROUP BY d.id, manager.first_name, manager.last_name`,
    [id]
  )

  return result.rows[0] ? mapDepartmentRow(result.rows[0]) : null
}

export async function isDepartmentCodeTaken(code: string, excludeId?: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM departments
     WHERE LOWER(code) = LOWER($1)
       AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [code, excludeId ?? null]
  )

  return Boolean(result.rowCount && result.rowCount > 0)
}

export async function createDepartment(input: DepartmentMutationInput): Promise<AdminDepartment> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO departments (name, code, description, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id`,
    [input.name, input.code, input.description]
  )

  const department = await getDepartmentById(result.rows[0].id)
  if (!department) throw new Error('Department was not found after creation.')
  return department
}

export async function updateDepartment(id: string, input: DepartmentMutationInput): Promise<AdminDepartment | null> {
  const result = await pool.query<{ id: string }>(
    `UPDATE departments
     SET name = $2,
         code = $3,
         description = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [id, input.name, input.code, input.description]
  )

  if (!result.rows[0]) return null
  return getDepartmentById(result.rows[0].id)
}

export async function toggleDepartmentActive(id: string): Promise<AdminDepartment | null> {
  const result = await pool.query<{ id: string }>(
    `UPDATE departments
     SET is_active = NOT COALESCE(is_active, false),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [id]
  )

  if (!result.rows[0]) return null
  return getDepartmentById(result.rows[0].id)
}

export async function deleteDepartment(id: string): Promise<DeleteDepartmentResult> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const targetResult = await client.query<{ id: string }>(
      `SELECT id
       FROM departments
       WHERE id = $1
       FOR UPDATE`,
      [id]
    )

    if (!targetResult.rows[0]) {
      await client.query('ROLLBACK')
      return { status: 'not_found' }
    }

    const employeeResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM employees
       WHERE department_id = $1`,
      [id]
    )
    const positionResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM positions
       WHERE department_id = $1`,
      [id]
    )

    const employeeCount = Number(employeeResult.rows[0]?.count ?? 0)
    const positionCount = Number(positionResult.rows[0]?.count ?? 0)

    if (employeeCount > 0 || positionCount > 0) {
      await client.query('ROLLBACK')
      return { status: 'has_related_records', employeeCount, positionCount }
    }

    await client.query('DELETE FROM departments WHERE id = $1', [id])
    await client.query('COMMIT')

    return { status: 'deleted', deletedDepartmentId: id }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function getActivePositions(): Promise<ActivePositionLookup[]> {
  const result = await pool.query(
    `SELECT id, title, code, description, department_id, base_salary
     FROM positions
     WHERE is_active = true
     ORDER BY title`
  )

  return result.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    code: String(row.code),
    description: row.description == null ? null : String(row.description),
    departmentId: row.department_id == null ? null : String(row.department_id),
    basicSalary: toNumberOrNull(row.base_salary),
  }))
}

export async function getActiveShifts(): Promise<ActiveShiftLookup[]> {
  const result = await pool.query(
    `SELECT
       id,
       name,
       TO_CHAR(start_time, 'HH24:MI') AS start_time,
       TO_CHAR(end_time, 'HH24:MI') AS end_time,
       break_minutes,
       work_hours
     FROM work_shifts
     WHERE is_active = true
     ORDER BY start_time, name`
  )

  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    breakMinutes: Number(row.break_minutes ?? 0),
    workingHoursPerDay: Number(row.work_hours ?? 0),
  }))
}

export async function getAllShifts(): Promise<AdminShift[]> {
  const result = await pool.query<ShiftRow>(
    `SELECT
       id,
       name,
       TO_CHAR(start_time, 'HH24:MI') AS start_time,
       TO_CHAR(end_time, 'HH24:MI') AS end_time,
       break_minutes,
       work_hours,
       is_active,
       created_at,
       updated_at
     FROM work_shifts
     ORDER BY is_active DESC, start_time, name`
  )

  return result.rows.map(mapShiftRow)
}

export async function getAllAnnouncements(): Promise<AdminAnnouncement[]> {
  const result = await pool.query<AnnouncementRow>(
    `SELECT
       id,
       title,
       content,
       TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
       TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
       is_pinned,
       created_by,
       created_at,
       updated_at
     FROM announcements
     ORDER BY COALESCE(is_pinned, false) DESC, COALESCE(start_date, created_at::date) DESC, created_at DESC`
  )

  return result.rows.map(mapAnnouncementRow)
}

export async function createAnnouncement(
  input: AnnouncementMutationInput,
  createdBy: string | null
): Promise<AdminAnnouncement> {
  const result = await pool.query<AnnouncementRow>(
    `INSERT INTO announcements (title, content, start_date, end_date, is_pinned, created_by)
     VALUES ($1, $2, $3::date, $4::date, $5, $6::uuid)
     RETURNING
       id,
       title,
       content,
       TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
       TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
       is_pinned,
       created_by,
       created_at,
       updated_at`,
    [
      input.title,
      input.content,
      input.startDate,
      input.endDate,
      input.isPinned,
      createdBy,
    ]
  )

  return mapAnnouncementRow(result.rows[0])
}

export async function updateAnnouncement(
  id: string,
  input: AnnouncementMutationInput
): Promise<AdminAnnouncement | null> {
  const result = await pool.query<AnnouncementRow>(
    `UPDATE announcements
     SET title = $2,
         content = $3,
         start_date = $4::date,
         end_date = $5::date,
         is_pinned = $6,
         updated_at = NOW()
     WHERE id = $1
     RETURNING
       id,
       title,
       content,
       TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
       TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
       is_pinned,
       created_by,
       created_at,
       updated_at`,
    [
      id,
      input.title,
      input.content,
      input.startDate,
      input.endDate,
      input.isPinned,
    ]
  )

  return result.rows[0] ? mapAnnouncementRow(result.rows[0]) : null
}

export async function deleteAnnouncement(id: string): Promise<DeleteAnnouncementResult> {
  const result = await pool.query(
    `DELETE FROM announcements
     WHERE id = $1`,
    [id]
  )

  if (!result.rowCount) return { status: 'not_found' }
  return { status: 'deleted', deletedAnnouncementId: id }
}

export async function createShift(input: ShiftMutationInput): Promise<AdminShift> {
  const result = await pool.query<ShiftRow>(
    `INSERT INTO work_shifts (name, start_time, end_time, break_minutes, work_hours, is_active)
     VALUES ($1, $2::time, $3::time, $4, $5, true)
     RETURNING
       id,
       name,
       TO_CHAR(start_time, 'HH24:MI') AS start_time,
       TO_CHAR(end_time, 'HH24:MI') AS end_time,
       break_minutes,
       work_hours,
       is_active,
       created_at,
       updated_at`,
    [
      input.name,
      input.startTime,
      input.endTime,
      input.breakMinutes,
      input.workingHoursPerDay,
    ]
  )

  return mapShiftRow(result.rows[0])
}

export async function updateShift(id: string, input: ShiftMutationInput): Promise<AdminShift | null> {
  const result = await pool.query<ShiftRow>(
    `UPDATE work_shifts
     SET name = $2,
         start_time = $3::time,
         end_time = $4::time,
         break_minutes = $5,
         work_hours = $6,
         updated_at = NOW()
     WHERE id = $1
     RETURNING
       id,
       name,
       TO_CHAR(start_time, 'HH24:MI') AS start_time,
       TO_CHAR(end_time, 'HH24:MI') AS end_time,
       break_minutes,
       work_hours,
       is_active,
       created_at,
       updated_at`,
    [
      id,
      input.name,
      input.startTime,
      input.endTime,
      input.breakMinutes,
      input.workingHoursPerDay,
    ]
  )

  return result.rows[0] ? mapShiftRow(result.rows[0]) : null
}

export async function toggleShiftActive(id: string): Promise<AdminShift | null> {
  const result = await pool.query<ShiftRow>(
    `UPDATE work_shifts
     SET is_active = NOT COALESCE(is_active, false),
         updated_at = NOW()
     WHERE id = $1
     RETURNING
       id,
       name,
       TO_CHAR(start_time, 'HH24:MI') AS start_time,
       TO_CHAR(end_time, 'HH24:MI') AS end_time,
       break_minutes,
       work_hours,
       is_active,
       created_at,
       updated_at`,
    [id]
  )

  return result.rows[0] ? mapShiftRow(result.rows[0]) : null
}

export async function deleteShift(id: string): Promise<DeleteShiftResult> {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const targetResult = await client.query<{ id: string; name: string }>(
      `SELECT id, name
       FROM work_shifts
       WHERE id = $1
       FOR UPDATE`,
      [id]
    )

    const targetShift = targetResult.rows[0]
    if (!targetShift) {
      await client.query('ROLLBACK')
      return { status: 'not_found' }
    }

    if (targetShift.name.trim().toLowerCase() === 'regular shift') {
      await client.query('ROLLBACK')
      return { status: 'regular_shift' }
    }

    const regularShiftResult = await client.query<{ id: string }>(
      `SELECT id
       FROM work_shifts
       WHERE LOWER(TRIM(name)) = LOWER($1)
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE`,
      ['Regular Shift']
    )

    const regularShift = regularShiftResult.rows[0]
    if (!regularShift) {
      await client.query('ROLLBACK')
      return { status: 'missing_regular_shift' }
    }

    if (regularShift.id === targetShift.id) {
      await client.query('ROLLBACK')
      return { status: 'regular_shift' }
    }

    const attendanceResult = await client.query(
      `SELECT 1
       FROM attendance
       WHERE scheduled_shift_id = $1
       LIMIT 1`,
      [id]
    )

    if (attendanceResult.rowCount && attendanceResult.rowCount > 0) {
      await client.query('ROLLBACK')
      return { status: 'has_attendance_history' }
    }

    const reassignedResult = await client.query(
      `UPDATE employees
       SET shift_id = $2,
           updated_at = NOW()
       WHERE shift_id = $1`,
      [id, regularShift.id]
    )

    await client.query('DELETE FROM work_shifts WHERE id = $1', [id])
    await client.query('COMMIT')

    return {
      status: 'deleted',
      deletedShiftId: id,
      reassignedEmployees: reassignedResult.rowCount ?? 0,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
