import pool from '../utils/db'

export type PayFrequency = 'weekly' | 'semi-monthly' | 'monthly'
export type PayrollStatus =
  | 'draft'
  | 'processing'
  | 'processed'
  | 'validation_failed'
  | 'ready_for_approval'
  | 'needs_correction'
  | 'approved'
  | 'released'
  | 'locked'
  | 'cancelled'
  | 'voided'

export interface PayrollPeriodRow {
  id: string
  name: string
  start_date: Date
  end_date: Date
  pay_date: Date
  pay_frequency: PayFrequency
  status: PayrollStatus
  created_by?: string
  approved_by?: string
  approved_at?: Date
  created_at: Date
  updated_at: Date
  active_employee_count?: number
  record_count?: number
  processing_record_count?: number
  approved_record_count?: number
  released_record_count?: number
  total_gross_pay?: number
  total_deductions?: number
  total_net_pay?: number
  negative_net_count?: number
  warning_count?: number
}

export interface PayrollRecordRow {
  id: string
  employee_id: string
  payroll_period_id: string
  basic_salary: number
  daily_rate: number
  hourly_rate: number
  regular_pay: number
  overtime_pay: number
  holiday_pay: number
  night_diff_pay: number
  allowances: number
  other_earnings: number
  gross_pay: number
  excess_minutes: number
  offset_earned_minutes: number
  offset_used_minutes: number
  undertime_minutes: number
  offset_balance_minutes: number
  absence_deduction: number
  late_deduction: number
  sss_employee: number
  phil_health_employee: number
  pag_ibig_employee: number
  withholding_tax: number
  loan_deductions: number
  other_deductions: number
  total_deductions: number
  sss_employer: number
  phil_health_employer: number
  pag_ibig_employer: number
  net_pay: number
  status: PayrollStatus
  voided_by?: string
  voided_at?: Date
  void_reason?: string
  created_at: Date
  updated_at: Date
}

export class PayrollPeriodModel {
  static async findAll(params: { page: number; limit: number; status?: PayrollStatus; year?: number; search?: string }) {
    const offset = (params.page - 1) * params.limit
    const conditions: string[] = []
    const values: unknown[] = []
    let i = 1

    if (params.status) {
      conditions.push(`pp.status = $${i++}`)
      values.push(params.status)
    }
    if (params.year) {
      conditions.push(`(EXTRACT(YEAR FROM pp.start_date) = $${i} OR EXTRACT(YEAR FROM pp.pay_date) = $${i})`)
      values.push(params.year)
      i++
    }
    if (params.search) {
      conditions.push(`pp.name ILIKE $${i++}`)
      values.push(`%${params.search}%`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const [count, data] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM payroll_periods pp ${where}`, values),
      pool.query(
        `WITH active_employees AS (
           SELECT COUNT(*)::int AS active_employee_count
           FROM employees
           WHERE employment_status = 'active'
             AND is_deleted = false
         ),
         summaries AS (
           SELECT payroll_period_id,
                  COUNT(*) FILTER (WHERE status::text NOT IN ('cancelled', 'voided'))::int AS record_count,
                  COUNT(*) FILTER (WHERE status IN ('processing', 'processed', 'validation_failed', 'ready_for_approval', 'needs_correction'))::int AS processing_record_count,
                  COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_record_count,
                  COUNT(*) FILTER (WHERE status IN ('released', 'locked'))::int AS released_record_count,
                  COALESCE(SUM(gross_pay) FILTER (WHERE status::text NOT IN ('cancelled', 'voided')), 0) AS total_gross_pay,
                  COALESCE(SUM(total_deductions) FILTER (WHERE status::text NOT IN ('cancelled', 'voided')), 0) AS total_deductions,
                  COALESCE(SUM(net_pay) FILTER (WHERE status::text NOT IN ('cancelled', 'voided')), 0) AS total_net_pay,
                  COUNT(*) FILTER (WHERE status::text NOT IN ('cancelled', 'voided') AND net_pay < 0)::int AS negative_net_count
           FROM payroll_records
           GROUP BY payroll_period_id
         )
         SELECT pp.*,
                ae.active_employee_count,
                COALESCE(s.record_count, 0)::int AS record_count,
                COALESCE(s.processing_record_count, 0)::int AS processing_record_count,
                COALESCE(s.approved_record_count, 0)::int AS approved_record_count,
                COALESCE(s.released_record_count, 0)::int AS released_record_count,
                COALESCE(s.total_gross_pay, 0) AS total_gross_pay,
                COALESCE(s.total_deductions, 0) AS total_deductions,
                COALESCE(s.total_net_pay, 0) AS total_net_pay,
                COALESCE(s.negative_net_count, 0)::int AS negative_net_count
         FROM payroll_periods pp
         CROSS JOIN active_employees ae
         LEFT JOIN summaries s ON s.payroll_period_id = pp.id
         ${where}
         ORDER BY pp.start_date DESC, pp.created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, params.limit, offset]
      ),
    ])

    return {
      data: data.rows as PayrollPeriodRow[],
      total: parseInt(count.rows[0].count, 10),
    }
  }

  static async findById(id: string) {
    const result = await pool.query(
      `WITH active_employees AS (
         SELECT COUNT(*)::int AS active_employee_count
         FROM employees
         WHERE employment_status = 'active'
           AND is_deleted = false
       ),
       summaries AS (
         SELECT payroll_period_id,
                COUNT(*) FILTER (WHERE status::text NOT IN ('cancelled', 'voided'))::int AS record_count,
                COUNT(*) FILTER (WHERE status IN ('processing', 'processed', 'validation_failed', 'ready_for_approval', 'needs_correction'))::int AS processing_record_count,
                COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_record_count,
                COUNT(*) FILTER (WHERE status IN ('released', 'locked'))::int AS released_record_count,
                COALESCE(SUM(gross_pay) FILTER (WHERE status::text NOT IN ('cancelled', 'voided')), 0) AS total_gross_pay,
                COALESCE(SUM(total_deductions) FILTER (WHERE status::text NOT IN ('cancelled', 'voided')), 0) AS total_deductions,
                COALESCE(SUM(net_pay) FILTER (WHERE status::text NOT IN ('cancelled', 'voided')), 0) AS total_net_pay,
                COUNT(*) FILTER (WHERE status::text NOT IN ('cancelled', 'voided') AND net_pay < 0)::int AS negative_net_count
         FROM payroll_records
         GROUP BY payroll_period_id
       )
       SELECT pp.*,
              ae.active_employee_count,
              COALESCE(s.record_count, 0)::int AS record_count,
              COALESCE(s.processing_record_count, 0)::int AS processing_record_count,
              COALESCE(s.approved_record_count, 0)::int AS approved_record_count,
              COALESCE(s.released_record_count, 0)::int AS released_record_count,
              COALESCE(s.total_gross_pay, 0) AS total_gross_pay,
              COALESCE(s.total_deductions, 0) AS total_deductions,
              COALESCE(s.total_net_pay, 0) AS total_net_pay,
              COALESCE(s.negative_net_count, 0)::int AS negative_net_count
       FROM payroll_periods pp
       CROSS JOIN active_employees ae
       LEFT JOIN summaries s ON s.payroll_period_id = pp.id
       WHERE pp.id = $1`,
      [id]
    )
    return result.rows[0] as PayrollPeriodRow | undefined
  }

  static async create(data: {
    name: string
    startDate: string
    endDate: string
    payDate: string
    payFrequency?: PayFrequency
    createdBy?: string
  }) {
    const result = await pool.query(
      `INSERT INTO payroll_periods (name, start_date, end_date, pay_date, pay_frequency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.name, data.startDate, data.endDate, data.payDate, data.payFrequency ?? 'semi-monthly', data.createdBy ?? null]
    )
    return result.rows[0] as PayrollPeriodRow
  }

  static async updateStatus(id: string, status: PayrollStatus, approvedBy?: string) {
    const result = await pool.query(
      `UPDATE payroll_periods
       SET status = $2,
           approved_by = COALESCE($3, approved_by),
           approved_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE approved_at END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status, approvedBy ?? null]
    )
    return result.rows[0] as PayrollPeriodRow | undefined
  }
}

export class PayrollRecordModel {
  static async findByPeriod(periodId: string) {
    const result = await pool.query(
      `SELECT pr.*, e.first_name, e.last_name, e.employee_number
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       WHERE pr.payroll_period_id = $1
       ORDER BY e.last_name, e.first_name`,
      [periodId]
    )
    return result.rows as PayrollRecordRow[]
  }

  static async findById(id: string) {
    const result = await pool.query(
      `SELECT pr.*, e.first_name, e.last_name, e.employee_number, e.department_id,
              d.name AS department_name, p.title AS position_title
       FROM payroll_records pr
       JOIN employees e ON pr.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN positions p ON e.position_id = p.id
       WHERE pr.id = $1`,
      [id]
    )
    return result.rows[0] as PayrollRecordRow | undefined
  }

  static async findByEmployee(employeeId: string) {
    const result = await pool.query(
      `SELECT pr.*, pp.name AS period_name, pp.pay_date
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.payroll_period_id
       WHERE pr.employee_id = $1
       ORDER BY pp.pay_date DESC`,
      [employeeId]
    )
    return result.rows as PayrollRecordRow[]
  }
}
