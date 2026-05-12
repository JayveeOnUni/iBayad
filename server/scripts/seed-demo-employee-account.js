const path = require('path')
const bcrypt = require('bcryptjs')
const dotenv = require('dotenv')

const serverRoot = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(serverRoot, '.env') })

const { createPgClient } = require('./db-config')

const DEMO_ACCOUNTS = [
  {
    email: 'employee.demo@ibayad.test',
    password: 'Demo@12345',
    role: 'employee',
    employeeNumber: 'EMP-DEMO-001',
    firstName: 'Juan',
    middleName: null,
    lastName: 'Dela Cruz',
    departmentName: 'IT Department',
    departmentCode: 'DEMO-IT',
    positionTitle: 'Web Developer',
    positionCode: 'DEMO-WEBDEV',
    basicSalary: 35000,
    workDaysPerMonth: 22,
    workHoursPerDay: 8,
  },
  {
    email: 'employee.demo2@ibayad.test',
    password: 'Demo@12345',
    role: 'employee',
    employeeNumber: 'EMP-DEMO-002',
    firstName: 'Maria',
    middleName: null,
    lastName: 'Santos',
    departmentName: 'Finance Department',
    departmentCode: 'DEMO-FIN',
    positionTitle: 'Payroll Assistant',
    positionCode: 'DEMO-PAYROLL-ASST',
    basicSalary: 32000,
    workDaysPerMonth: 22,
    workHoursPerDay: 8,
  },
]

function requireDatabaseUrl() {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim() === '') {
    throw new Error('Set DATABASE_URL before running this seed script.')
  }
}

function roundMoney(value) {
  return Math.round(value * 10000) / 10000
}

function dateOnly(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function oneMonthAgoDateOnly(now = new Date()) {
  const targetMonth = now.getMonth() - 1
  const target = new Date(now.getFullYear(), targetMonth, now.getDate())

  if (target.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    return dateOnly(new Date(now.getFullYear(), now.getMonth(), 0))
  }

  return dateOnly(target)
}

async function ensureDepartment(client, account) {
  const byCode = await client.query(
    `SELECT id
     FROM departments
     WHERE code = $1
     FOR UPDATE`,
    [account.departmentCode]
  )

  if (byCode.rows[0]) {
    const updated = await client.query(
      `UPDATE departments
       SET name = $1,
           description = $2,
           is_active = true,
           updated_at = NOW()
      WHERE id = $3
       RETURNING id`,
      [
        account.departmentName,
        'Demo reference department for the presentation employee account.',
        byCode.rows[0].id,
      ]
    )
    return updated.rows[0].id
  }

  const byName = await client.query(
    `SELECT id
     FROM departments
     WHERE LOWER(name) = LOWER($1)
     ORDER BY created_at
     LIMIT 1
     FOR UPDATE`,
    [account.departmentName]
  )

  if (byName.rows[0]) {
    return byName.rows[0].id
  }

  const inserted = await client.query(
    `INSERT INTO departments (name, code, description, is_active)
     VALUES ($1, $2, $3, true)
     RETURNING id`,
    [
      account.departmentName,
      account.departmentCode,
      'Demo reference department for the presentation employee account.',
    ]
  )

  return inserted.rows[0].id
}

async function ensurePosition(client, account, departmentId) {
  const byCode = await client.query(
    `SELECT id
     FROM positions
     WHERE code = $1
     FOR UPDATE`,
    [account.positionCode]
  )

  if (byCode.rows[0]) {
    const updated = await client.query(
      `UPDATE positions
       SET title = $1,
           department_id = $2,
           base_salary = $3,
           description = $4,
           is_active = true,
           updated_at = NOW()
      WHERE id = $5
       RETURNING id`,
      [
        account.positionTitle,
        departmentId,
        account.basicSalary,
        'Demo reference position for the presentation employee account.',
        byCode.rows[0].id,
      ]
    )
    return updated.rows[0].id
  }

  const byTitle = await client.query(
    `SELECT id
     FROM positions
     WHERE LOWER(title) = LOWER($1)
       AND department_id = $2
     ORDER BY created_at
     LIMIT 1
     FOR UPDATE`,
    [account.positionTitle, departmentId]
  )

  if (byTitle.rows[0]) {
    return byTitle.rows[0].id
  }

  const inserted = await client.query(
    `INSERT INTO positions (title, code, department_id, base_salary, description, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id`,
    [
      account.positionTitle,
      account.positionCode,
      departmentId,
      account.basicSalary,
      'Demo reference position for the presentation employee account.',
    ]
  )

  return inserted.rows[0].id
}

async function ensureRegularShift(client) {
  const existing = await client.query(
    `SELECT id
     FROM work_shifts
     WHERE name = 'Regular Shift'
     ORDER BY is_active DESC, created_at
     LIMIT 1`
  )

  if (existing.rows[0]) {
    return existing.rows[0].id
  }

  const inserted = await client.query(
    `INSERT INTO work_shifts (name, start_time, end_time, break_minutes, work_hours, is_active)
     VALUES ('Regular Shift', '08:00', '17:00', 60, 8, true)
     RETURNING id`
  )

  return inserted.rows[0].id
}

async function upsertEmployee(client, account, departmentId, positionId, shiftId) {
  const conflicts = await client.query(
    `SELECT id, employee_number, email
     FROM employees
     WHERE employee_number = $1
        OR LOWER(email) = LOWER($2)
     FOR UPDATE`,
    [account.employeeNumber, account.email]
  )

  const uniqueIds = new Set(conflicts.rows.map((row) => row.id))
  if (uniqueIds.size > 1) {
    throw new Error(
      `Cannot seed demo employee because ${account.employeeNumber} and ${account.email} belong to different employee rows.`
    )
  }

  const dailyRate = roundMoney(account.basicSalary / account.workDaysPerMonth)
  const hourlyRate = roundMoney(dailyRate / account.workHoursPerDay)
  const hireDate = oneMonthAgoDateOnly()
  const existing = conflicts.rows[0]

  if (existing) {
    const updated = await client.query(
      `UPDATE employees
       SET employee_number = $1,
           first_name = $2,
           middle_name = $3,
           last_name = $4,
           email = $5,
           department_id = $6,
           position_id = $7,
           shift_id = $8,
           employment_type = 'regular',
           employment_status = 'active',
           hire_date = $9,
           regularization_date = NULL,
           separation_date = NULL,
           basic_salary = $10,
           daily_rate = $11,
           hourly_rate = $12,
           work_days_per_month = $13,
           work_hours_per_day = $14,
           notes = $15,
           updated_at = NOW()
      WHERE id = $16
       RETURNING id, employee_number, email`,
      [
        account.employeeNumber,
        account.firstName,
        account.middleName,
        account.lastName,
        account.email,
        departmentId,
        positionId,
        shiftId,
        hireDate,
        account.basicSalary,
        dailyRate,
        hourlyRate,
        account.workDaysPerMonth,
        account.workHoursPerDay,
        'DEMO DATA ONLY - temporary presentation account while transactional email delivery is unavailable.',
        existing.id,
      ]
    )
    return updated.rows[0]
  }

  const inserted = await client.query(
    `INSERT INTO employees (
       employee_number, first_name, middle_name, last_name, email,
       department_id, position_id, shift_id,
       employment_type, employment_status, hire_date,
       basic_salary, daily_rate, hourly_rate,
       work_days_per_month, work_hours_per_day, notes
     )
     VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8,
       'regular', 'active', $9,
       $10, $11, $12,
       $13, $14, $15
     )
     RETURNING id, employee_number, email`,
    [
      account.employeeNumber,
      account.firstName,
      account.middleName,
      account.lastName,
      account.email,
      departmentId,
      positionId,
      shiftId,
      hireDate,
      account.basicSalary,
      dailyRate,
      hourlyRate,
      account.workDaysPerMonth,
      account.workHoursPerDay,
      'DEMO DATA ONLY - temporary presentation account while transactional email delivery is unavailable.',
    ]
  )

  return inserted.rows[0]
}

async function upsertUser(client, account, employeeId, passwordHash) {
  const conflicts = await client.query(
    `SELECT id, email, employee_id
     FROM users
     WHERE LOWER(email) = LOWER($1)
        OR employee_id = $2
     FOR UPDATE`,
    [account.email, employeeId]
  )

  const uniqueIds = new Set(conflicts.rows.map((row) => row.id))
  if (uniqueIds.size > 1) {
    throw new Error(
      `Cannot seed demo account because ${account.email} and employee ${employeeId} belong to different user rows.`
    )
  }

  const existing = conflicts.rows[0]

  if (existing) {
    const updated = await client.query(
      `UPDATE users
       SET employee_id = $1,
           email = $2,
           password_hash = $3,
           role = $4,
           is_active = true,
           activation_token_hash = NULL,
           activation_token_expires_at = NULL,
           activation_sent_at = NULL,
           activation_email_message_id = NULL,
           activated_at = COALESCE(activated_at, NOW()),
           password_reset_token_hash = NULL,
           password_reset_token_expires_at = NULL,
           password_reset_sent_at = NULL,
           password_reset_email_message_id = NULL,
           refresh_token_hash = NULL,
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, email, role, is_active, activated_at`,
      [
        employeeId,
        account.email,
        passwordHash,
        account.role,
        existing.id,
      ]
    )
    return updated.rows[0]
  }

  const inserted = await client.query(
    `INSERT INTO users (
       employee_id, email, password_hash, role, is_active, activated_at,
       activation_token_hash, activation_token_expires_at,
       password_reset_token_hash, password_reset_token_expires_at,
       refresh_token_hash
     )
     VALUES ($1, $2, $3, $4, true, NOW(), NULL, NULL, NULL, NULL, NULL)
     RETURNING id, email, role, is_active, activated_at`,
    [employeeId, account.email, passwordHash, account.role]
  )

  return inserted.rows[0]
}

async function main() {
  requireDatabaseUrl()

  const client = createPgClient()
  let inTransaction = false

  try {
    await client.connect()
    await client.query('BEGIN')
    inTransaction = true

    const shiftId = await ensureRegularShift(client)
    const seededAccounts = []

    for (const account of DEMO_ACCOUNTS) {
      const passwordHash = await bcrypt.hash(account.password, 12)
      const departmentId = await ensureDepartment(client, account)
      const positionId = await ensurePosition(client, account, departmentId)
      const employee = await upsertEmployee(client, account, departmentId, positionId, shiftId)
      const user = await upsertUser(client, account, employee.id, passwordHash)

      seededAccounts.push({ account, employee, user })
    }

    await client.query('COMMIT')
    inTransaction = false

    console.log('Demo employee accounts ready.')
    for (const { account, employee, user } of seededAccounts) {
      console.log(`Email: ${user.email}`)
      console.log(`Password: ${account.password}`)
      console.log(`Role: ${user.role}`)
      console.log(`Employee Number: ${employee.employee_number}`)
      console.log(`Employee ID: ${employee.id}`)
      console.log('---')
    }
  } catch (error) {
    if (inTransaction) {
      await client.query('ROLLBACK').catch(() => undefined)
    }
    throw error
  } finally {
    await client.end().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
