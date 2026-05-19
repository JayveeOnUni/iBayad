import pool from '../utils/db'

type DbDate = Date | string
type Nullable<T> = T | null
type Queryable = Pick<typeof pool, 'query'>

export interface EmployeeRow {
  id: string
  employee_number: string
  first_name: string
  middle_name?: Nullable<string>
  last_name: string
  email: string
  phone?: Nullable<string>
  birth_date: Nullable<DbDate>
  gender: Nullable<string>
  civil_status: Nullable<string>
  address: Nullable<string>
  city: Nullable<string>
  province: Nullable<string>
  zip_code: Nullable<string>
  department_id: Nullable<string>
  position_id: Nullable<string>
  employment_type: string
  employment_status: string
  hire_date: DbDate
  regularization_date?: Nullable<DbDate>
  last_working_day?: Nullable<DbDate>
  separation_date?: Nullable<DbDate>
  separation_reason?: Nullable<string>
  separation_remarks?: Nullable<string>
  separation_processed_by?: Nullable<string>
  separation_processed_at?: Nullable<DbDate>
  is_deleted?: boolean
  deleted_at?: Nullable<DbDate>
  deleted_by?: Nullable<string>
  resignation_date?: Nullable<DbDate>
  basic_salary: number
  daily_rate: number
  hourly_rate: number
  work_days_per_month?: number
  work_hours_per_day?: number
  sss_number?: Nullable<string>
  philhealth_number?: Nullable<string>
  pagibig_number?: Nullable<string>
  tin_number?: Nullable<string>
  bank_name?: Nullable<string>
  bank_account_number?: Nullable<string>
  avatar_url?: Nullable<string>
  shift_id?: Nullable<string>
  user_id?: Nullable<string>
  created_at: Date
  updated_at: Date
}

export class EmployeeModel {
  static async findAll(params: {
    page: number
    limit: number
    search?: string
    departmentId?: string
    status?: string
    includeArchived?: boolean
    includeFormer?: boolean
  }) {
    const offset = (params.page - 1) * params.limit
    const conditions: string[] = []
    const values: (string | number)[] = []
    let paramIdx = 1

    if (params.search) {
      conditions.push(`(
        e.first_name ILIKE $${paramIdx} OR
        e.last_name ILIKE $${paramIdx} OR
        e.email ILIKE $${paramIdx} OR
        e.employee_number ILIKE $${paramIdx}
      )`)
      values.push(`%${params.search}%`)
      paramIdx++
    }

    if (params.departmentId) {
      conditions.push(`e.department_id = $${paramIdx}`)
      values.push(params.departmentId)
      paramIdx++
    }

    if (params.status === 'archived') {
      conditions.push(`e.is_deleted = true`)
    } else if (params.status && params.status !== 'all') {
      conditions.push(`e.employment_status = $${paramIdx}`)
      values.push(params.status)
      paramIdx++
    } else if (!params.includeFormer) {
      conditions.push(`e.employment_status = 'active'`)
    }

    if (params.status !== 'archived' && !params.includeArchived) {
      conditions.push(`e.is_deleted = false`)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const countQuery = `SELECT COUNT(*) FROM employees e ${where}`
    const dataQuery = `
      SELECT
        e.*,
        d.name AS department_name,
        p.title AS position_title
      FROM employees e
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN positions p ON e.position_id = p.id
      ${where}
      ORDER BY e.last_name, e.first_name
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `

    const [countResult, dataResult] = await Promise.all([
      pool.query(countQuery, values),
      pool.query(dataQuery, [...values, params.limit, offset]),
    ])

    return {
      data: dataResult.rows as EmployeeRow[],
      total: parseInt(countResult.rows[0].count, 10),
    }
  }

  static async findById(id: string) {
    const result = await pool.query(
      `SELECT e.*, d.name AS department_name, p.title AS position_title, s.name AS shift_name,
              processed_by.email AS separation_processed_by_email,
              deleted_by_user.email AS deleted_by_email
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       LEFT JOIN work_shifts s ON e.shift_id = s.id
       LEFT JOIN users processed_by ON processed_by.id = e.separation_processed_by
       LEFT JOIN users deleted_by_user ON deleted_by_user.id = e.deleted_by
       WHERE e.id = $1`,
      [id]
    )
    return result.rows[0] as EmployeeRow | undefined
  }

  static async create(data: Partial<EmployeeRow>, db: Queryable = pool) {
    const result = await db.query(
      `INSERT INTO employees (
        employee_number, first_name, middle_name, last_name, email, phone,
        birth_date, gender, civil_status, address, city, province, zip_code,
        department_id, position_id, employment_type, employment_status, hire_date,
        basic_salary, daily_rate, hourly_rate, work_days_per_month, work_hours_per_day,
        sss_number, philhealth_number, pagibig_number, tin_number,
        bank_name, bank_account_number, shift_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, $26, $27,
        $28, $29, $30
      ) RETURNING *`,
      [
        data.employee_number, data.first_name, data.middle_name, data.last_name,
        data.email, data.phone,
        data.birth_date, data.gender, data.civil_status,
        data.address, data.city, data.province, data.zip_code,
        data.department_id, data.position_id, data.employment_type, data.employment_status, data.hire_date,
        data.basic_salary, data.daily_rate, data.hourly_rate,
        data.work_days_per_month, data.work_hours_per_day,
        data.sss_number, data.philhealth_number, data.pagibig_number, data.tin_number,
        data.bank_name, data.bank_account_number, data.shift_id,
      ]
    )
    return result.rows[0] as EmployeeRow
  }

  static async update(id: string, data: Partial<EmployeeRow>) {
    const fields = Object.keys(data)
      .map((key, i) => `${key} = $${i + 2}`)
      .join(', ')
    const values = Object.values(data)

    const result = await pool.query(
      `UPDATE employees SET ${fields}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    )
    return result.rows[0] as EmployeeRow
  }

  static async generateEmployeeNumber(db: Queryable = pool): Promise<string> {
    const result = await db.query(
      `SELECT COALESCE(MAX(substring(employee_number FROM '^EMP-([0-9]+)$')::int), 0) AS last_number
       FROM employees
       WHERE employee_number ~ '^EMP-[0-9]+$'`
    )
    const lastNumber = Number(result.rows[0]?.last_number ?? 0)
    const nextNumber = lastNumber + 1
    return `EMP-${String(nextNumber).padStart(3, '0')}`
  }
}
