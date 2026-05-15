-- iBayad full-month demo employee attendance seed
-- Safe to rerun in development/demo databases. It resets only the records for:
--   employee_number = 'EMP-DEMO-2026-001'
--   email           = 'employee.demo@example.com'

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

BEGIN;

-- Reset demo-only records first so reseeding returns the same clean presentation state.
WITH demo_employee AS (
  SELECT id
  FROM employees
  WHERE employee_number = 'EMP-DEMO-2026-001'
     OR email = 'employee.demo@example.com'
),
demo_period AS (
  SELECT id
  FROM payroll_periods
  WHERE name = 'Demo April 2026 Full Month'
)
DELETE FROM offset_usage_allocations
WHERE offset_usage_id IN (
  SELECT id FROM offset_usages WHERE employee_id IN (SELECT id FROM demo_employee)
);

WITH demo_employee AS (
  SELECT id
  FROM employees
  WHERE employee_number = 'EMP-DEMO-2026-001'
     OR email = 'employee.demo@example.com'
),
demo_period AS (
  SELECT id
  FROM payroll_periods
  WHERE name = 'Demo April 2026 Full Month'
)
DELETE FROM payroll_records
WHERE employee_id IN (SELECT id FROM demo_employee)
   OR payroll_period_id IN (SELECT id FROM demo_period);

WITH demo_employee AS (
  SELECT id
  FROM employees
  WHERE employee_number = 'EMP-DEMO-2026-001'
     OR email = 'employee.demo@example.com'
)
DELETE FROM offset_usages
WHERE employee_id IN (SELECT id FROM demo_employee);

WITH demo_employee AS (
  SELECT id
  FROM employees
  WHERE employee_number = 'EMP-DEMO-2026-001'
     OR email = 'employee.demo@example.com'
)
DELETE FROM offset_credits
WHERE employee_id IN (SELECT id FROM demo_employee);

WITH demo_employee AS (
  SELECT id
  FROM employees
  WHERE employee_number = 'EMP-DEMO-2026-001'
     OR email = 'employee.demo@example.com'
)
DELETE FROM attendance_requests
WHERE employee_id IN (SELECT id FROM demo_employee);

WITH demo_employee AS (
  SELECT id
  FROM employees
  WHERE employee_number = 'EMP-DEMO-2026-001'
     OR email = 'employee.demo@example.com'
)
DELETE FROM attendance
WHERE employee_id IN (SELECT id FROM demo_employee);

WITH demo_employee AS (
  SELECT id
  FROM employees
  WHERE employee_number = 'EMP-DEMO-2026-001'
     OR email = 'employee.demo@example.com'
)
DELETE FROM leave_requests
WHERE employee_id IN (SELECT id FROM demo_employee);

WITH demo_employee AS (
  SELECT id
  FROM employees
  WHERE employee_number = 'EMP-DEMO-2026-001'
     OR email = 'employee.demo@example.com'
)
DELETE FROM loans
WHERE employee_id IN (SELECT id FROM demo_employee);

DELETE FROM payroll_periods
WHERE name = 'Demo April 2026 Full Month';

DELETE FROM users
WHERE email = 'employee.demo@example.com'
   OR employee_id IN (
     SELECT id
     FROM employees
     WHERE employee_number = 'EMP-DEMO-2026-001'
        OR email = 'employee.demo@example.com'
   );

DELETE FROM employees
WHERE employee_number = 'EMP-DEMO-2026-001'
   OR email = 'employee.demo@example.com';

-- Reference data used by the demo employee.
INSERT INTO departments (name, code, description)
VALUES ('Operations', 'OPS', 'Employee operations and service delivery')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = NOW();

INSERT INTO positions (title, code, department_id, base_salary, description)
VALUES (
  'Payroll Demo Associate',
  'DEMO-PAYROLL',
  (SELECT id FROM departments WHERE code = 'OPS'),
  26000,
  'Presentation-only employee with complete full-month attendance history'
)
ON CONFLICT (code) DO UPDATE
SET title = EXCLUDED.title,
    department_id = EXCLUDED.department_id,
    base_salary = EXCLUDED.base_salary,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = NOW();

INSERT INTO work_shifts (name, start_time, end_time, break_minutes, work_hours, is_active)
SELECT 'Regular Shift', '08:00', '17:00', 60, 8, true
WHERE NOT EXISTS (
  SELECT 1
  FROM work_shifts
  WHERE LOWER(TRIM(name)) = 'regular shift'
);

UPDATE work_shifts
SET start_time = '08:00',
    end_time = '17:00',
    break_minutes = 60,
    work_hours = 8,
    is_active = true,
    updated_at = NOW()
WHERE LOWER(TRIM(name)) = 'regular shift';

-- Fake employee profile. No real employee, bank, or government details are used.
INSERT INTO employees (
  employee_number, first_name, middle_name, last_name, email, phone,
  birth_date, gender, civil_status, nationality,
  address, city, province, zip_code,
  department_id, position_id, shift_id,
  employment_type, employment_status, hire_date, regularization_date,
  basic_salary, daily_rate, hourly_rate, work_days_per_month, work_hours_per_day,
  sss_number, philhealth_number, pagibig_number, tin_number,
  bank_name, bank_account_number, notes
)
VALUES (
  'EMP-DEMO-2026-001',
  'Mikaela',
  'Demo',
  'Reyes',
  'employee.demo@example.com',
  '0917-000-0000',
  '1996-04-12',
  'female',
  'single',
  'Filipino',
  '123 Demo Street',
  'Pasig',
  'Metro Manila',
  '1605',
  (SELECT id FROM departments WHERE code = 'OPS'),
  (SELECT id FROM positions WHERE code = 'DEMO-PAYROLL'),
  (SELECT id FROM work_shifts WHERE LOWER(TRIM(name)) = 'regular shift' ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1),
  'regular',
  'active',
  '2026-03-25',
  '2026-09-25',
  26000.00,
  1181.8182,
  147.7273,
  22,
  8,
  '33-0000000-0',
  '12-000000000-0',
  '0000-0000-0000',
  '100-000-000-000',
  'Demo Bank',
  '0000000000',
  'DEMO DATA ONLY - safe fake employee for presentations and payroll testing.'
);

INSERT INTO users (employee_id, email, password_hash, role, is_active, activated_at)
SELECT id,
       'employee.demo@example.com',
       crypt('DemoEmployee@2026', gen_salt('bf', 10)),
       'employee',
       true,
       NOW()
FROM employees
WHERE employee_number = 'EMP-DEMO-2026-001';

WITH demo AS (
  SELECT e.id AS employee_id, u.id AS user_id, e.shift_id
  FROM employees e
  JOIN users u ON u.employee_id = e.id
  WHERE e.employee_number = 'EMP-DEMO-2026-001'
),
attendance_rows (
  work_date, status, time_in, time_out, actual_rendered_minutes,
  late_minutes, undertime_minutes, overtime_hours, remarks
) AS (
  VALUES
    ('2026-04-01'::date, 'present'::attendance_status, '2026-04-01 08:00:00+08'::timestamptz, '2026-04-01 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday'),
    ('2026-04-02'::date, 'late'::attendance_status, '2026-04-02 08:05:00+08'::timestamptz, '2026-04-02 17:00:00+08'::timestamptz, 475, 5, 5, 0.00::numeric, 'Late by 5 minutes'),
    ('2026-04-03'::date, 'present'::attendance_status, '2026-04-03 07:55:00+08'::timestamptz, '2026-04-03 18:00:00+08'::timestamptz, 545, 0, 0, 1.00::numeric, 'One hour approved overtime'),
    ('2026-04-04'::date, 'rest_day'::attendance_status, NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0.00::numeric, 'Weekend rest day'),
    ('2026-04-05'::date, 'rest_day'::attendance_status, NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0.00::numeric, 'Weekend rest day'),
    ('2026-04-06'::date, 'present'::attendance_status, '2026-04-06 08:00:00+08'::timestamptz, '2026-04-06 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday'),
    ('2026-04-07'::date, 'late'::attendance_status, '2026-04-07 08:15:00+08'::timestamptz, '2026-04-07 17:00:00+08'::timestamptz, 465, 15, 15, 0.00::numeric, 'Late by 15 minutes'),
    ('2026-04-08'::date, 'present'::attendance_status, '2026-04-08 08:00:00+08'::timestamptz, '2026-04-08 16:30:00+08'::timestamptz, 450, 0, 30, 0.00::numeric, 'Undertime by 30 minutes'),
    ('2026-04-09'::date, 'present'::attendance_status, '2026-04-09 08:00:00+08'::timestamptz, '2026-04-09 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday'),
    ('2026-04-10'::date, 'present'::attendance_status, '2026-04-10 08:00:00+08'::timestamptz, '2026-04-10 19:00:00+08'::timestamptz, 600, 0, 0, 2.00::numeric, 'Two hours approved overtime'),
    ('2026-04-11'::date, 'rest_day'::attendance_status, NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0.00::numeric, 'Weekend rest day'),
    ('2026-04-12'::date, 'rest_day'::attendance_status, NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0.00::numeric, 'Weekend rest day'),
    ('2026-04-13'::date, 'present'::attendance_status, '2026-04-13 08:00:00+08'::timestamptz, '2026-04-13 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday'),
    ('2026-04-14'::date, 'absent'::attendance_status, NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0.00::numeric, 'Unpaid demo absence'),
    ('2026-04-15'::date, 'late'::attendance_status, '2026-04-15 08:10:00+08'::timestamptz, '2026-04-15 17:00:00+08'::timestamptz, 470, 10, 10, 0.00::numeric, 'Late by 10 minutes'),
    ('2026-04-16'::date, 'present'::attendance_status, '2026-04-16 08:00:00+08'::timestamptz, '2026-04-16 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday'),
    ('2026-04-17'::date, 'present'::attendance_status, '2026-04-17 08:00:00+08'::timestamptz, '2026-04-17 18:30:00+08'::timestamptz, 570, 0, 0, 1.50::numeric, 'One and a half hours approved overtime'),
    ('2026-04-18'::date, 'rest_day'::attendance_status, NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0.00::numeric, 'Weekend rest day'),
    ('2026-04-19'::date, 'rest_day'::attendance_status, NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0.00::numeric, 'Weekend rest day'),
    ('2026-04-20'::date, 'present'::attendance_status, '2026-04-20 08:00:00+08'::timestamptz, '2026-04-20 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday'),
    ('2026-04-21'::date, 'late'::attendance_status, '2026-04-21 08:20:00+08'::timestamptz, '2026-04-21 17:00:00+08'::timestamptz, 460, 20, 20, 0.00::numeric, 'Late by 20 minutes'),
    ('2026-04-22'::date, 'present'::attendance_status, '2026-04-22 08:00:00+08'::timestamptz, '2026-04-22 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday'),
    ('2026-04-23'::date, 'present'::attendance_status, '2026-04-23 08:00:00+08'::timestamptz, '2026-04-23 16:00:00+08'::timestamptz, 420, 0, 60, 0.00::numeric, 'Undertime by one hour'),
    ('2026-04-24'::date, 'present'::attendance_status, '2026-04-24 08:00:00+08'::timestamptz, '2026-04-24 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday'),
    ('2026-04-25'::date, 'rest_day'::attendance_status, NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0.00::numeric, 'Weekend rest day'),
    ('2026-04-26'::date, 'rest_day'::attendance_status, NULL::timestamptz, NULL::timestamptz, 0, 0, 0, 0.00::numeric, 'Weekend rest day'),
    ('2026-04-27'::date, 'present'::attendance_status, '2026-04-27 08:00:00+08'::timestamptz, '2026-04-27 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday'),
    ('2026-04-28'::date, 'present'::attendance_status, '2026-04-28 08:00:00+08'::timestamptz, '2026-04-28 18:00:00+08'::timestamptz, 540, 0, 0, 1.00::numeric, 'One hour approved overtime'),
    ('2026-04-29'::date, 'late'::attendance_status, '2026-04-29 08:30:00+08'::timestamptz, '2026-04-29 17:00:00+08'::timestamptz, 450, 30, 30, 0.00::numeric, 'Late by 30 minutes'),
    ('2026-04-30'::date, 'present'::attendance_status, '2026-04-30 08:00:00+08'::timestamptz, '2026-04-30 17:00:00+08'::timestamptz, 480, 0, 0, 0.00::numeric, 'Regular workday')
)
INSERT INTO attendance (
  employee_id, date, time_in, time_out, status,
  scheduled_shift_id, scheduled_start, scheduled_end, required_work_minutes,
  actual_rendered_minutes, late_minutes, undertime_minutes, excess_minutes,
  offset_earned_minutes, offset_used_minutes, overtime_hours, holiday_hours,
  night_diff_hours, total_worked_minutes, remarks, created_by
)
SELECT
  demo.employee_id,
  ar.work_date,
  ar.time_in,
  ar.time_out,
  ar.status,
  CASE WHEN ar.status = 'rest_day' THEN NULL ELSE demo.shift_id END,
  CASE WHEN ar.status = 'rest_day' THEN NULL ELSE (ar.work_date::text || ' 08:00:00+08')::timestamptz END,
  CASE WHEN ar.status = 'rest_day' THEN NULL ELSE (ar.work_date::text || ' 17:00:00+08')::timestamptz END,
  CASE WHEN ar.status = 'rest_day' THEN 0 ELSE 480 END,
  ar.actual_rendered_minutes,
  ar.late_minutes,
  ar.undertime_minutes,
  0,
  0,
  0,
  ar.overtime_hours,
  0,
  0,
  ar.actual_rendered_minutes,
  ar.remarks,
  demo.user_id
FROM attendance_rows ar
CROSS JOIN demo;

INSERT INTO payroll_periods (name, start_date, end_date, pay_date, pay_frequency, status)
VALUES ('Demo April 2026 Full Month', '2026-04-01', '2026-04-30', '2026-05-05', 'monthly', 'released');

WITH demo AS (
  SELECT e.id AS employee_id,
         e.basic_salary,
         e.daily_rate,
         e.hourly_rate,
         e.work_days_per_month,
         e.work_hours_per_day
  FROM employees e
  WHERE e.employee_number = 'EMP-DEMO-2026-001'
),
period AS (
  SELECT id AS payroll_period_id
  FROM payroll_periods
  WHERE name = 'Demo April 2026 Full Month'
),
attendance_summary AS (
  SELECT
    COUNT(*) FILTER (WHERE a.status IN ('present', 'late'))::numeric AS payable_work_days,
    COUNT(*) FILTER (WHERE a.status = 'absent')::numeric AS absence_days,
    COALESCE(SUM(a.late_minutes), 0)::numeric AS late_minutes,
    COALESCE(SUM(a.undertime_minutes), 0)::numeric AS undertime_minutes,
    COALESCE(SUM(a.overtime_hours), 0)::numeric AS overtime_hours,
    COALESCE(SUM(a.excess_minutes), 0)::numeric AS excess_minutes,
    COALESCE(SUM(a.offset_earned_minutes), 0)::numeric AS offset_earned_minutes,
    COALESCE(SUM(a.offset_used_minutes), 0)::numeric AS offset_used_minutes
  FROM attendance a
  JOIN demo d ON d.employee_id = a.employee_id
  WHERE a.date BETWEEN '2026-04-01' AND '2026-04-30'
),
deductions AS (
  SELECT
    d.*,
    p.payroll_period_id,
    s.*,
    ROUND((ROUND(LEAST(GREATEST(d.basic_salary, 4250), 29750) / 500) * 500 * 0.045)::numeric, 2) AS sss_employee,
    ROUND((ROUND(LEAST(GREATEST(d.basic_salary, 4250), 29750) / 500) * 500 * 0.095)::numeric, 2) AS sss_employer,
    ROUND(((LEAST(GREATEST(d.basic_salary, 10000), 80000) * 0.04) / 2)::numeric, 2) AS phil_health_employee,
    ROUND(((LEAST(GREATEST(d.basic_salary, 10000), 80000) * 0.04) / 2)::numeric, 2) AS phil_health_employer,
    ROUND((LEAST(d.basic_salary, 5000) * CASE WHEN d.basic_salary <= 1500 THEN 0.01 ELSE 0.02 END)::numeric, 2) AS pag_ibig_employee,
    ROUND((LEAST(d.basic_salary, 5000) * 0.02)::numeric, 2) AS pag_ibig_employer
  FROM demo d
  CROSS JOIN period p
  CROSS JOIN attendance_summary s
),
payroll_values AS (
  SELECT
    *,
    ROUND((daily_rate * work_days_per_month)::numeric, 2) AS regular_pay,
    ROUND((hourly_rate * overtime_hours * 1.25)::numeric, 2) AS overtime_pay,
    ROUND((daily_rate * absence_days)::numeric, 2) AS absence_deduction,
    ROUND((hourly_rate * ((late_minutes + GREATEST(undertime_minutes - late_minutes, 0)) / 60))::numeric, 2) AS late_deduction,
    ROUND(
      CASE
        WHEN (basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) <= 20833 THEN 0
        WHEN (basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) <= 33332
          THEN ((basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) - 20834) * 0.15
        WHEN (basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) <= 66666
          THEN 2500 + ((basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) - 33333) * 0.20
        WHEN (basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) <= 166666
          THEN 10833 + ((basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) - 66667) * 0.25
        WHEN (basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) <= 666666
          THEN 40833.33 + ((basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) - 166667) * 0.30
        ELSE 200833.33 + ((basic_salary - sss_employee - phil_health_employee - pag_ibig_employee) - 666667) * 0.35
      END::numeric,
      2
    ) AS withholding_tax
  FROM deductions
),
final_payroll AS (
  SELECT
    *,
    ROUND((regular_pay + overtime_pay)::numeric, 2) AS gross_pay,
    ROUND((
      absence_deduction + late_deduction + sss_employee + phil_health_employee +
      pag_ibig_employee + withholding_tax
    )::numeric, 2) AS total_deductions
  FROM payroll_values
)
INSERT INTO payroll_records (
  employee_id, payroll_period_id,
  basic_salary, daily_rate, hourly_rate,
  regular_pay, overtime_pay, holiday_pay, night_diff_pay, allowances, other_earnings, gross_pay,
  excess_minutes, offset_earned_minutes, offset_used_minutes, undertime_minutes, offset_balance_minutes,
  absence_deduction, late_deduction,
  sss_employee, phil_health_employee, pag_ibig_employee, withholding_tax,
  loan_deductions, other_deductions, total_deductions,
  sss_employer, phil_health_employer, pag_ibig_employer,
  net_pay, status
)
SELECT
  employee_id,
  payroll_period_id,
  basic_salary,
  daily_rate,
  hourly_rate,
  regular_pay,
  overtime_pay,
  0,
  0,
  0,
  0,
  gross_pay,
  excess_minutes,
  offset_earned_minutes,
  offset_used_minutes,
  undertime_minutes,
  0,
  absence_deduction,
  late_deduction,
  sss_employee,
  phil_health_employee,
  pag_ibig_employee,
  withholding_tax,
  0,
  0,
  total_deductions,
  sss_employer,
  phil_health_employer,
  pag_ibig_employer,
  ROUND((gross_pay - total_deductions)::numeric, 2),
  'released'
FROM final_payroll;

COMMIT;
