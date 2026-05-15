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

function toNumberOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
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
