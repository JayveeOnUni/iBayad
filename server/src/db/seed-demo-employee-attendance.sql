-- iBayad four-employee demo attendance, leave, and semi-monthly payroll seed.
-- Demo-only data. Safe to rerun in development/demo databases; it resets only:
--   EMP-DEMO-006M / employee.demo.6m@example.com
--   EMP-DEMO-012M / employee.demo.12m@example.com
--   EMP-DEMO-018M / employee.demo.18m@example.com
--   EMP-DEMO-024M / employee.demo.24m@example.com

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

BEGIN;

CREATE TEMP TABLE demo_employee_seed_params ON COMMIT DROP AS
SELECT
  DATE '2026-04-01' AS attendance_start_date,
  DATE '2026-05-19' AS attendance_end_date,
  DATE '2026-05-19' AS demo_current_date,
  'DemoEmployee@2026'::text AS demo_password;

CREATE TEMP TABLE demo_employee_seed_accounts ON COMMIT DROP AS
SELECT
  v.experience_months,
  v.employee_number::varchar(20) AS employee_number,
  v.email::varchar(255) AS email,
  v.first_name::varchar(100) AS first_name,
  v.middle_name::varchar(100) AS middle_name,
  v.last_name::varchar(100) AS last_name,
  v.phone::varchar(20) AS phone,
  v.birth_date::date AS birth_date,
  v.gender::gender_type AS gender,
  v.hire_date::date AS hire_date,
  (v.hire_date::date + INTERVAL '6 months')::date AS regularization_date,
  v.basic_salary::numeric(12,2) AS basic_salary,
  ROUND((v.basic_salary::numeric / 22)::numeric, 4) AS daily_rate,
  ROUND(((v.basic_salary::numeric / 22) / 8)::numeric, 4) AS hourly_rate,
  v.sss_number::varchar(30) AS sss_number,
  v.philhealth_number::varchar(30) AS philhealth_number,
  v.pagibig_number::varchar(30) AS pagibig_number,
  v.tin_number::varchar(30) AS tin_number,
  v.bank_account_number::varchar(50) AS bank_account_number,
  v.address::text AS address
FROM (
  VALUES
    (6,  'EMP-DEMO-006M', 'employee.demo.6m@example.com',  'Mikaela', 'Demo', 'Reyes',  '0917-000-0006', '1996-04-12', 'female', '2025-11-18', 26000.00, '33-0000006-6', '12-000000006-6', '0006-0006-0006', '100-000-006-000', '0000000006', '6 Demo Lane, Pasig City'),
    (12, 'EMP-DEMO-012M', 'employee.demo.12m@example.com', 'Noel',    'Demo', 'Cruz',   '0917-000-0012', '1994-08-19', 'male',   '2025-05-18', 30000.00, '33-0000012-2', '12-000000012-2', '0012-0012-0012', '100-000-012-000', '0000000012', '12 Demo Lane, Pasig City'),
    (18, 'EMP-DEMO-018M', 'employee.demo.18m@example.com', 'Lara',    'Demo', 'Santos', '0917-000-0018', '1992-11-07', 'female', '2024-11-18', 34000.00, '33-0000018-8', '12-000000018-8', '0018-0018-0018', '100-000-018-000', '0000000018', '18 Demo Lane, Pasig City'),
    (24, 'EMP-DEMO-024M', 'employee.demo.24m@example.com', 'Rafael',  'Demo', 'Garcia', '0917-000-0024', '1990-02-23', 'male',   '2024-05-18', 38000.00, '33-0000024-4', '12-000000024-4', '0024-0024-0024', '100-000-024-000', '0000000024', '24 Demo Lane, Pasig City')
) AS v (
  experience_months, employee_number, email, first_name, middle_name, last_name,
  phone, birth_date, gender, hire_date, basic_salary, sss_number,
  philhealth_number, pagibig_number, tin_number, bank_account_number, address
);

CREATE TEMP TABLE demo_employee_seed_period_names ON COMMIT DROP AS
SELECT name
FROM (
  VALUES
    ('Demo April 2026 - 1st Period'),
    ('Demo April 2026 - 2nd Period'),
    ('Demo May 2026 - 1st Period')
) AS p(name);

CREATE TEMP TABLE demo_employee_seed_target_employees ON COMMIT DROP AS
SELECT id
FROM employees
WHERE employee_number IN (SELECT employee_number FROM demo_employee_seed_accounts)
   OR email IN (SELECT email FROM demo_employee_seed_accounts);

CREATE TEMP TABLE demo_employee_seed_target_users ON COMMIT DROP AS
SELECT id
FROM users
WHERE email IN (SELECT email FROM demo_employee_seed_accounts)
   OR employee_id IN (SELECT id FROM demo_employee_seed_target_employees);

CREATE TEMP TABLE demo_employee_seed_target_payroll_periods ON COMMIT DROP AS
SELECT id
FROM payroll_periods
WHERE name IN (SELECT name FROM demo_employee_seed_period_names);

CREATE TEMP TABLE demo_employee_seed_target_payroll_records ON COMMIT DROP AS
SELECT id
FROM payroll_records
WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees)
   OR payroll_period_id IN (SELECT id FROM demo_employee_seed_target_payroll_periods);

-- Reset demo-only records first so reseeding returns the same clean presentation state.
UPDATE payroll_records
SET current_snapshot_id = NULL,
    updated_at = NOW()
WHERE id IN (SELECT id FROM demo_employee_seed_target_payroll_records);

DELETE FROM payroll_audit_logs
WHERE payroll_record_id IN (SELECT id FROM demo_employee_seed_target_payroll_records)
   OR payroll_period_id IN (SELECT id FROM demo_employee_seed_target_payroll_periods)
   OR employee_id IN (SELECT id FROM demo_employee_seed_target_employees)
   OR user_id IN (SELECT id FROM demo_employee_seed_target_users);

DELETE FROM audit_logs
WHERE user_id IN (SELECT id FROM demo_employee_seed_target_users);

DELETE FROM payroll_loan_deductions
WHERE payroll_record_id IN (SELECT id FROM demo_employee_seed_target_payroll_records)
   OR employee_id IN (SELECT id FROM demo_employee_seed_target_employees)
   OR payroll_period_id IN (SELECT id FROM demo_employee_seed_target_payroll_periods);

DELETE FROM payroll_calculation_snapshots
WHERE payroll_record_id IN (SELECT id FROM demo_employee_seed_target_payroll_records)
   OR employee_id IN (SELECT id FROM demo_employee_seed_target_employees)
   OR payroll_period_id IN (SELECT id FROM demo_employee_seed_target_payroll_periods);

DELETE FROM payroll_leave_adjustments
WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees)
   OR payroll_period_id IN (SELECT id FROM demo_employee_seed_target_payroll_periods)
   OR leave_request_id IN (
     SELECT id FROM leave_requests WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees)
   );

DELETE FROM offset_usage_allocations
WHERE offset_usage_id IN (
    SELECT id FROM offset_usages WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees)
  )
   OR offset_credit_id IN (
    SELECT id FROM offset_credits WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees)
  );

DELETE FROM payroll_records
WHERE id IN (SELECT id FROM demo_employee_seed_target_payroll_records);

DELETE FROM payroll_periods
WHERE id IN (SELECT id FROM demo_employee_seed_target_payroll_periods);

DELETE FROM offset_usages
WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees);

DELETE FROM offset_credits
WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees);

DELETE FROM attendance_requests
WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees);

DELETE FROM attendance
WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees);

DELETE FROM leave_requests
WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees);

DELETE FROM loans
WHERE employee_id IN (SELECT id FROM demo_employee_seed_target_employees);

UPDATE departments
SET manager_id = NULL,
    updated_at = NOW()
WHERE manager_id IN (SELECT id FROM demo_employee_seed_target_employees);

DELETE FROM users
WHERE id IN (SELECT id FROM demo_employee_seed_target_users);

DELETE FROM employees
WHERE id IN (SELECT id FROM demo_employee_seed_target_employees);

-- Reference records shared by the demo employees. These are intentionally generic.
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
  30000,
  'Presentation-only employees with semi-monthly attendance, leave, and payroll history'
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

CREATE TEMP TABLE demo_employee_seed_leave_type_ids ON COMMIT DROP AS
SELECT leave_code, leave_type_id
FROM (
  SELECT 'VACATION'::text AS leave_code, id AS leave_type_id,
         CASE WHEN code = 'VACATION' THEN 1 ELSE 2 END AS priority
  FROM leave_types
  WHERE code IN ('VACATION', 'VL')
  UNION ALL
  SELECT 'SICK'::text AS leave_code, id AS leave_type_id,
         CASE WHEN code = 'SICK' THEN 1 ELSE 2 END AS priority
  FROM leave_types
  WHERE code IN ('SICK', 'SL')
) typed
WHERE priority = (
  SELECT MIN(priority)
  FROM (
    SELECT 'VACATION'::text AS leave_code, id AS leave_type_id,
           CASE WHEN code = 'VACATION' THEN 1 ELSE 2 END AS priority
    FROM leave_types
    WHERE code IN ('VACATION', 'VL')
    UNION ALL
    SELECT 'SICK'::text AS leave_code, id AS leave_type_id,
           CASE WHEN code = 'SICK' THEN 1 ELSE 2 END AS priority
    FROM leave_types
    WHERE code IN ('SICK', 'SL')
  ) best
  WHERE best.leave_code = typed.leave_code
);

DO $$
BEGIN
  IF (SELECT COUNT(DISTINCT leave_code) FROM demo_employee_seed_leave_type_ids) < 2 THEN
    RAISE EXCEPTION 'Vacation and sick leave types must exist before running the demo employee seed.';
  END IF;
END $$;

-- Fake employee profiles. No real employee, bank, or government details are used.
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
SELECT
  account.employee_number,
  account.first_name,
  account.middle_name,
  account.last_name,
  account.email,
  account.phone,
  account.birth_date,
  account.gender,
  'single'::civil_status,
  'Filipino',
  account.address,
  'Pasig',
  'Metro Manila',
  '1605',
  (SELECT id FROM departments WHERE code = 'OPS'),
  (SELECT id FROM positions WHERE code = 'DEMO-PAYROLL'),
  (SELECT id FROM work_shifts WHERE LOWER(TRIM(name)) = 'regular shift' ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1),
  'regular'::employment_type,
  'active'::employment_status,
  account.hire_date,
  account.regularization_date,
  account.basic_salary,
  account.daily_rate,
  account.hourly_rate,
  22,
  8,
  account.sss_number,
  account.philhealth_number,
  account.pagibig_number,
  account.tin_number,
  'Demo Bank',
  account.bank_account_number,
  'DEMO DATA ONLY - fake employee for presentations and payroll testing. Company experience as of 2026-05-18: ' || account.experience_months || ' months.'
FROM demo_employee_seed_accounts account;

INSERT INTO users (employee_id, email, password_hash, role, is_active, activated_at)
SELECT
  employee.id,
  account.email,
  crypt((SELECT demo_password FROM demo_employee_seed_params), gen_salt('bf', 10)),
  'employee'::user_role,
  true,
  NOW()
FROM demo_employee_seed_accounts account
JOIN employees employee ON employee.employee_number = account.employee_number;

CREATE TEMP TABLE demo_employee_seed_leave_plans ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    ('EMP-DEMO-006M', 'SICK',     '2026-05-18'::date, '2026-05-18'::date, 1.0::numeric, 'Newly eligible sick leave for a same-day clinic visit.', 'approved',  'Approved for demo; first regularization-day leave usage.'),
    ('EMP-DEMO-006M', 'VACATION', '2026-05-25'::date, '2026-05-25'::date, 1.0::numeric, 'Planned personal errand after regularization.',          'pending',   NULL),
    ('EMP-DEMO-006M', 'VACATION', '2026-04-20'::date, '2026-04-20'::date, 1.0::numeric, 'Requested before leave eligibility completed.',          'rejected',  'Rejected because the employee was not yet leave-eligible.'),
    ('EMP-DEMO-012M', 'VACATION', '2026-04-17'::date, '2026-04-17'::date, 1.0::numeric, 'Short planned vacation day.',                           'approved',  'Approved one-day vacation leave.'),
    ('EMP-DEMO-012M', 'SICK',     '2026-05-22'::date, '2026-05-22'::date, 1.0::numeric, 'Follow-up checkup request.',                            'pending',   NULL),
    ('EMP-DEMO-012M', 'VACATION', '2026-04-27'::date, '2026-04-27'::date, 1.0::numeric, 'Schedule conflict with team coverage.',                  'cancelled', 'Cancelled by employee after rescheduling.'),
    ('EMP-DEMO-018M', 'VACATION', '2026-04-23'::date, '2026-04-24'::date, 2.0::numeric, 'Two-day family trip.',                                  'approved',  'Approved vacation leave within available credits.'),
    ('EMP-DEMO-018M', 'SICK',     '2026-05-08'::date, '2026-05-08'::date, 1.0::numeric, 'Fever and recovery day.',                               'approved',  'Approved sick leave.'),
    ('EMP-DEMO-018M', 'VACATION', '2026-05-26'::date, '2026-05-27'::date, 2.0::numeric, 'Pending request for a long weekend.',                    'pending',   NULL),
    ('EMP-DEMO-018M', 'SICK',     '2026-04-07'::date, '2026-04-07'::date, 1.0::numeric, 'Incomplete notification details.',                       'rejected',  'Rejected for incomplete supporting details.'),
    ('EMP-DEMO-024M', 'VACATION', '2026-04-13'::date, '2026-04-15'::date, 3.0::numeric, 'Planned family vacation.',                              'approved',  'Approved three-day vacation leave.'),
    ('EMP-DEMO-024M', 'SICK',     '2026-05-06'::date, '2026-05-06'::date, 1.0::numeric, 'Migraine recovery day.',                                'approved',  'Approved sick leave.'),
    ('EMP-DEMO-024M', 'VACATION', '2026-05-29'::date, '2026-05-29'::date, 1.0::numeric, 'Pending request for personal appointment.',              'pending',   NULL),
    ('EMP-DEMO-024M', 'VACATION', '2026-05-04'::date, '2026-05-04'::date, 1.0::numeric, 'Cancelled because the appointment moved.',               'cancelled', 'Cancelled by employee.'),
    ('EMP-DEMO-024M', 'SICK',     '2026-04-28'::date, '2026-04-28'::date, 1.0::numeric, 'Requested after returning without required notice.',      'rejected',  'Rejected for late filing.')
) AS leave_plan (
  employee_number, leave_code, start_date, end_date, total_days, reason, status, review_remarks
);

CREATE TEMP TABLE demo_employee_seed_reviewer ON COMMIT DROP AS
SELECT COALESCE(
  (SELECT id FROM users WHERE role IN ('admin', 'super_admin') ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1),
  (SELECT id FROM users WHERE email = 'employee.demo.024m@example.com' LIMIT 1)
) AS user_id;

INSERT INTO leave_requests (
  employee_id, leave_type_id, start_date, end_date, total_days, reason,
  is_half_day, status, reviewed_by, reviewed_at, review_remarks
)
SELECT
  e.id,
  lt.leave_type_id,
  lp.start_date,
  lp.end_date,
  lp.total_days,
  lp.reason,
  false,
  lp.status::leave_request_status,
  CASE WHEN lp.status IN ('approved', 'rejected') THEN (SELECT user_id FROM demo_employee_seed_reviewer) ELSE NULL END,
  CASE WHEN lp.status IN ('approved', 'rejected') THEN NOW() ELSE NULL END,
  lp.review_remarks
FROM demo_employee_seed_leave_plans lp
JOIN employees e ON e.employee_number = lp.employee_number
JOIN demo_employee_seed_leave_type_ids lt ON lt.leave_code = lp.leave_code;

CREATE TEMP TABLE demo_employee_seed_attendance_exceptions ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    ('EMP-DEMO-006M', '2026-04-03'::date, 'late'::attendance_status,    '08:12'::time, 468, 12, 12, 0.00::numeric, 'Late by 12 minutes.'),
    ('EMP-DEMO-006M', '2026-04-21'::date, 'absent'::attendance_status,  '08:00'::time,   0,  0,  0, 0.00::numeric, 'Unpaid demo absence.'),
    ('EMP-DEMO-006M', '2026-05-05'::date, 'present'::attendance_status, '08:00'::time, 450,  0, 30, 0.00::numeric, 'Undertime by 30 minutes.'),
    ('EMP-DEMO-006M', '2026-05-12'::date, 'present'::attendance_status, '07:55'::time, 545,  0,  0, 0.00::numeric, 'Extra rendered time creates offset credit.'),
    ('EMP-DEMO-012M', '2026-04-06'::date, 'late'::attendance_status,    '08:18'::time, 462, 18, 18, 0.00::numeric, 'Late by 18 minutes.'),
    ('EMP-DEMO-012M', '2026-04-30'::date, 'present'::attendance_status, '08:00'::time, 570,  0,  0, 0.00::numeric, 'Extra rendered time creates offset credit.'),
    ('EMP-DEMO-012M', '2026-05-11'::date, 'absent'::attendance_status,  '08:00'::time,   0,  0,  0, 0.00::numeric, 'Unpaid demo absence.'),
    ('EMP-DEMO-012M', '2026-05-14'::date, 'present'::attendance_status, '08:00'::time, 420,  0, 60, 0.00::numeric, 'Undertime by one hour.'),
    ('EMP-DEMO-018M', '2026-04-10'::date, 'present'::attendance_status, '08:00'::time, 600,  0,  0, 0.00::numeric, 'Extra rendered time creates offset credit.'),
    ('EMP-DEMO-018M', '2026-04-16'::date, 'late'::attendance_status,    '08:07'::time, 473,  7,  7, 0.00::numeric, 'Late by 7 minutes.'),
    ('EMP-DEMO-018M', '2026-04-29'::date, 'present'::attendance_status, '08:00'::time, 435,  0, 45, 0.00::numeric, 'Undertime by 45 minutes.'),
    ('EMP-DEMO-018M', '2026-05-13'::date, 'absent'::attendance_status,  '08:00'::time,   0,  0,  0, 0.00::numeric, 'Unpaid demo absence.'),
    ('EMP-DEMO-024M', '2026-04-02'::date, 'late'::attendance_status,    '08:05'::time, 475,  5,  5, 0.00::numeric, 'Late by 5 minutes.'),
    ('EMP-DEMO-024M', '2026-04-20'::date, 'present'::attendance_status, '08:00'::time, 540,  0,  0, 0.00::numeric, 'Extra rendered time creates offset credit.'),
    ('EMP-DEMO-024M', '2026-05-07'::date, 'present'::attendance_status, '08:00'::time, 440,  0, 40, 0.00::numeric, 'Undertime by 40 minutes.'),
    ('EMP-DEMO-024M', '2026-05-15'::date, 'absent'::attendance_status,  '08:00'::time,   0,  0,  0, 0.00::numeric, 'Unpaid demo absence.')
) AS exception_row (
  employee_number, work_date, status, time_in_time,
  actual_rendered_minutes, late_minutes, undertime_minutes, overtime_hours, remarks
);

CREATE TEMP TABLE demo_employee_seed_approved_leave_days ON COMMIT DROP AS
SELECT lr.employee_id,
       gs.leave_date::date AS leave_date,
       lt.name AS leave_type_name,
       lr.reason
FROM leave_requests lr
JOIN leave_types lt ON lt.id = lr.leave_type_id
CROSS JOIN LATERAL generate_series(lr.start_date, lr.end_date, INTERVAL '1 day') AS gs(leave_date)
JOIN demo_employee_seed_params params ON true
WHERE lr.employee_id IN (SELECT id FROM employees WHERE employee_number IN (SELECT employee_number FROM demo_employee_seed_accounts))
  AND lr.status = 'approved'
  AND gs.leave_date::date BETWEEN params.attendance_start_date AND params.attendance_end_date
  AND EXTRACT(ISODOW FROM gs.leave_date::date) < 6;

WITH demo AS (
  SELECT e.id AS employee_id, e.employee_number, u.id AS user_id, e.shift_id
  FROM demo_employee_seed_accounts account
  JOIN employees e ON e.employee_number = account.employee_number
  JOIN users u ON u.employee_id = e.id
),
attendance_dates AS (
  SELECT gs.work_date::date AS work_date
  FROM demo_employee_seed_params params
  CROSS JOIN LATERAL generate_series(params.attendance_start_date, params.attendance_end_date, INTERVAL '1 day') AS gs(work_date)
),
resolved_attendance AS (
  SELECT
    demo.employee_id,
    demo.user_id,
    demo.shift_id,
    dates.work_date,
    EXTRACT(ISODOW FROM dates.work_date) IN (6, 7) AS is_rest_day,
    leave_day.leave_type_name,
    leave_day.reason AS leave_reason,
    exception_row.status AS exception_status,
    exception_row.time_in_time,
    exception_row.actual_rendered_minutes AS exception_rendered_minutes,
    exception_row.late_minutes AS exception_late_minutes,
    exception_row.undertime_minutes AS exception_undertime_minutes,
    exception_row.overtime_hours AS exception_overtime_hours,
    exception_row.remarks AS exception_remarks
  FROM demo
  CROSS JOIN attendance_dates dates
  LEFT JOIN demo_employee_seed_attendance_exceptions exception_row
    ON exception_row.employee_number = demo.employee_number
   AND exception_row.work_date = dates.work_date
  LEFT JOIN demo_employee_seed_approved_leave_days leave_day
    ON leave_day.employee_id = demo.employee_id
   AND leave_day.leave_date = dates.work_date
),
final_attendance AS (
  SELECT
    *,
    CASE
      WHEN is_rest_day THEN 'rest_day'::attendance_status
      WHEN leave_type_name IS NOT NULL THEN 'on_leave'::attendance_status
      WHEN exception_status IS NOT NULL THEN exception_status
      ELSE 'present'::attendance_status
    END AS final_status
  FROM resolved_attendance
)
INSERT INTO attendance (
  employee_id, date, time_in, time_out, status,
  scheduled_shift_id, scheduled_start, scheduled_end, required_work_minutes,
  actual_rendered_minutes, late_minutes, undertime_minutes, excess_minutes,
  offset_earned_minutes, offset_used_minutes, overtime_hours, holiday_hours,
  night_diff_hours, total_worked_minutes, remarks, created_by
)
SELECT
  employee_id,
  work_date,
  (work_date::text || ' ' || COALESCE(time_in_time, '08:00'::time)::text || '+08')::timestamptz,
  NULL,
  final_status,
  CASE WHEN final_status = 'rest_day' THEN NULL ELSE shift_id END,
  CASE WHEN final_status = 'rest_day' THEN NULL ELSE (work_date::text || ' 08:00:00+08')::timestamptz END,
  CASE WHEN final_status = 'rest_day' THEN NULL ELSE (work_date::text || ' 17:00:00+08')::timestamptz END,
  CASE WHEN final_status = 'rest_day' THEN 0 ELSE 480 END,
  CASE
    WHEN final_status IN ('rest_day', 'on_leave', 'absent') THEN 0
    ELSE COALESCE(exception_rendered_minutes, 480)
  END,
  CASE WHEN final_status = 'late' THEN COALESCE(exception_late_minutes, 0) ELSE 0 END,
  CASE WHEN final_status IN ('present', 'late') THEN COALESCE(exception_undertime_minutes, 0) ELSE 0 END,
  CASE
    WHEN final_status IN ('present', 'late') THEN GREATEST(COALESCE(exception_rendered_minutes, 480) - 480, 0)
    ELSE 0
  END,
  CASE
    WHEN final_status IN ('present', 'late') THEN GREATEST(COALESCE(exception_rendered_minutes, 480) - 480, 0)
    ELSE 0
  END,
  0,
  0,
  0,
  0,
  CASE
    WHEN final_status IN ('rest_day', 'on_leave', 'absent') THEN 0
    ELSE COALESCE(exception_rendered_minutes, 480)
  END,
  CASE
    WHEN final_status = 'rest_day' THEN 'Weekend rest day.'
    WHEN final_status = 'on_leave' THEN leave_type_name || ' - ' || leave_reason
    ELSE COALESCE(exception_remarks, 'Regular workday.')
  END,
  user_id
FROM final_attendance;

INSERT INTO offset_credits (
  employee_id, attendance_id, date_earned, source, minutes_earned, minutes_remaining,
  status, reason, reviewed_by, reviewed_at, created_by
)
SELECT
  a.employee_id,
  a.id,
  a.date,
  'excess_hours',
  a.offset_earned_minutes,
  a.offset_earned_minutes,
  'approved',
  'Generated from demo attendance excess minutes.',
  a.created_by,
  NOW(),
  a.created_by
FROM attendance a
WHERE a.employee_id IN (SELECT id FROM demo_employee_seed_target_employees)
  AND a.offset_earned_minutes > 0;

CREATE TEMP TABLE demo_employee_seed_periods ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    ('Demo April 2026 - 1st Period', '2026-04-01'::date, '2026-04-15'::date, '2026-04-20'::date, 'released'::payroll_status),
    ('Demo April 2026 - 2nd Period', '2026-04-16'::date, '2026-04-30'::date, '2026-05-05'::date, 'released'::payroll_status),
    ('Demo May 2026 - 1st Period',   '2026-05-01'::date, '2026-05-15'::date, '2026-05-20'::date, 'approved'::payroll_status)
) AS p(name, start_date, end_date, pay_date, status);

INSERT INTO payroll_periods (name, start_date, end_date, pay_date, pay_frequency, status)
SELECT name, start_date, end_date, pay_date, 'semi-monthly'::pay_frequency, status
FROM demo_employee_seed_periods;

WITH demo AS (
  SELECT e.id AS employee_id,
         e.basic_salary,
         e.daily_rate,
         e.hourly_rate,
         e.work_days_per_month,
         e.work_hours_per_day
  FROM demo_employee_seed_accounts account
  JOIN employees e ON e.employee_number = account.employee_number
),
period AS (
  SELECT pp.id AS payroll_period_id,
         pp.name,
         pp.start_date,
         pp.end_date,
         pp.pay_date,
         pp.status AS payroll_status
  FROM payroll_periods pp
  JOIN demo_employee_seed_periods seeded ON seeded.name = pp.name
),
attendance_summary AS (
  SELECT
    d.employee_id,
    p.payroll_period_id,
    COUNT(*) FILTER (WHERE a.status <> 'rest_day')::int AS expected_work_days,
    COUNT(*) FILTER (WHERE a.status IN ('present', 'late', 'half_day'))::numeric AS days_worked,
    COUNT(*) FILTER (WHERE a.status = 'on_leave')::numeric AS paid_leave_days,
    COUNT(*) FILTER (WHERE a.status = 'absent')::numeric AS absence_days,
    COALESCE(SUM(a.late_minutes), 0)::numeric AS late_minutes,
    COALESCE(SUM(a.undertime_minutes), 0)::numeric AS undertime_minutes,
    0::numeric AS overtime_hours,
    COALESCE(SUM(a.holiday_hours), 0)::numeric AS holiday_hours,
    COALESCE(SUM(a.excess_minutes), 0)::numeric AS excess_minutes,
    COALESCE(SUM(a.offset_earned_minutes), 0)::numeric AS offset_earned_minutes,
    COALESCE(SUM(a.offset_used_minutes), 0)::numeric AS offset_used_minutes
  FROM demo d
  CROSS JOIN period p
  JOIN attendance a ON a.employee_id = d.employee_id
                   AND a.date BETWEEN p.start_date AND p.end_date
  GROUP BY d.employee_id, p.payroll_period_id
),
payroll_inputs AS (
  SELECT
    d.*,
    p.payroll_period_id,
    p.name AS period_name,
    p.start_date,
    p.end_date,
    p.payroll_status,
    s.expected_work_days,
    s.days_worked,
    s.paid_leave_days,
    0::numeric AS unpaid_leave_days,
    s.absence_days,
    s.late_minutes,
    s.undertime_minutes,
    s.overtime_hours,
    s.holiday_hours,
    s.excess_minutes,
    s.offset_earned_minutes,
    s.offset_used_minutes,
    ROUND((ROUND(LEAST(GREATEST(d.basic_salary, 4250), 29750) / 500) * 500 * 0.045 * 0.5)::numeric, 2) AS sss_employee,
    ROUND((ROUND(LEAST(GREATEST(d.basic_salary, 4250), 29750) / 500) * 500 * 0.095 * 0.5)::numeric, 2) AS sss_employer,
    ROUND((((LEAST(GREATEST(d.basic_salary, 10000), 80000) * 0.04) / 2) * 0.5)::numeric, 2) AS phil_health_employee,
    ROUND((((LEAST(GREATEST(d.basic_salary, 10000), 80000) * 0.04) / 2) * 0.5)::numeric, 2) AS phil_health_employer,
    ROUND((LEAST(d.basic_salary, 5000) * CASE WHEN d.basic_salary <= 1500 THEN 0.01 ELSE 0.02 END * 0.5)::numeric, 2) AS pag_ibig_employee,
    ROUND((LEAST(d.basic_salary, 5000) * 0.02 * 0.5)::numeric, 2) AS pag_ibig_employer
  FROM demo d
  CROSS JOIN period p
  JOIN attendance_summary s ON s.employee_id = d.employee_id
                           AND s.payroll_period_id = p.payroll_period_id
),
payroll_values AS (
  SELECT
    *,
    ROUND((daily_rate * expected_work_days)::numeric, 2) AS regular_pay,
    ROUND((daily_rate * paid_leave_days)::numeric, 2) AS paid_leave_amount,
    0::numeric AS overtime_pay,
    ROUND((daily_rate * absence_days)::numeric, 2) AS absence_deduction,
    ROUND((hourly_rate * (late_minutes / 60))::numeric, 2) AS late_deduction,
    ROUND((hourly_rate * (GREATEST(undertime_minutes - late_minutes, 0) / 60))::numeric, 2) AS undertime_deduction
  FROM payroll_inputs
),
taxable_values AS (
  SELECT
    *,
    ROUND(regular_pay::numeric, 2) AS taxable_earnings,
    ROUND(regular_pay::numeric, 2) AS gross_pay,
    ROUND(GREATEST(0, regular_pay - absence_deduction - late_deduction - undertime_deduction)::numeric, 2) AS taxable_gross_for_period
  FROM payroll_values
),
withholding_values AS (
  SELECT
    *,
    ROUND(GREATEST(0, taxable_gross_for_period - sss_employee - phil_health_employee - pag_ibig_employee)::numeric, 2) AS taxable_income
  FROM taxable_values
),
final_payroll AS (
  SELECT
    *,
    ROUND(
      CASE
        WHEN taxable_income <= 10417 THEN 0
        WHEN taxable_income <= 16666 THEN (taxable_income - 10417) * 0.15
        WHEN taxable_income <= 33332 THEN 937.50 + ((taxable_income - 16667) * 0.20)
        WHEN taxable_income <= 83332 THEN 4270.70 + ((taxable_income - 33333) * 0.25)
        WHEN taxable_income <= 333332 THEN 16770.70 + ((taxable_income - 83333) * 0.30)
        ELSE 91770.70 + ((taxable_income - 333333) * 0.35)
      END::numeric,
      2
    ) AS withholding_tax
  FROM withholding_values
)
INSERT INTO payroll_records (
  employee_id, payroll_period_id,
  basic_salary, daily_rate, hourly_rate,
  expected_work_days, days_worked, paid_leave_days, unpaid_leave_days, late_minutes,
  regular_pay, overtime_pay, holiday_pay, night_diff_pay, allowances, other_earnings,
  taxable_earnings, non_taxable_earnings, paid_leave_amount, gross_pay,
  excess_minutes, offset_earned_minutes, offset_used_minutes, undertime_minutes, offset_balance_minutes,
  absence_deduction, late_deduction, undertime_deduction, leave_deduction,
  sss_employee, phil_health_employee, pag_ibig_employee, taxable_income, withholding_tax,
  pre_tax_deductions, statutory_deductions, post_tax_deductions,
  loan_deductions, other_deductions, total_deductions,
  sss_employer, phil_health_employer, pag_ibig_employer,
  employer_contributions, net_pay, statutory_rule_version, statutory_rule_versions, computation_breakdown, status
)
SELECT
  employee_id,
  payroll_period_id,
  basic_salary,
  daily_rate,
  hourly_rate,
  expected_work_days,
  days_worked,
  paid_leave_days,
  unpaid_leave_days,
  late_minutes::int,
  regular_pay,
  overtime_pay,
  0,
  0,
  0,
  0,
  taxable_earnings,
  0,
  paid_leave_amount,
  gross_pay,
  excess_minutes::int,
  offset_earned_minutes::int,
  offset_used_minutes::int,
  undertime_minutes::int,
  0,
  absence_deduction,
  late_deduction,
  undertime_deduction,
  0,
  sss_employee,
  phil_health_employee,
  pag_ibig_employee,
  taxable_income,
  withholding_tax,
  0,
  ROUND((sss_employee + phil_health_employee + pag_ibig_employee + withholding_tax)::numeric, 2),
  0,
  0,
  0,
  ROUND((absence_deduction + late_deduction + undertime_deduction + sss_employee + phil_health_employee + pag_ibig_employee + withholding_tax)::numeric, 2),
  sss_employer,
  phil_health_employer,
  pag_ibig_employer,
  ROUND((sss_employer + phil_health_employer + pag_ibig_employer)::numeric, 2),
  ROUND((gross_pay - (absence_deduction + late_deduction + undertime_deduction + sss_employee + phil_health_employee + pag_ibig_employee + withholding_tax))::numeric, 2),
  'demo-semi-monthly-2026',
  jsonb_build_object(
    'sss', 'demo-2026-semi-monthly',
    'philHealth', 'demo-2026-semi-monthly',
    'pagIBIG', 'demo-2026-semi-monthly',
    'bir', 'BIR-RR-11-2018-2023-semi-monthly'
  ),
  jsonb_build_object(
    'demoSeed', true,
    'period', period_name,
    'payFrequency', 'semi-monthly',
    'earnings', jsonb_build_object(
      'regularPay', regular_pay,
      'overtimePay', 0,
      'paidOvertimeDisabled', true,
      'offsetEarnedMinutes', offset_earned_minutes,
      'offsetUsedMinutes', offset_used_minutes,
      'paidLeaveAmount', paid_leave_amount
    ),
    'deductions', jsonb_build_object('absenceDeduction', absence_deduction, 'lateDeduction', late_deduction, 'undertimeDeduction', undertime_deduction, 'withholdingTax', withholding_tax),
    'attendance', jsonb_build_object('expectedWorkDays', expected_work_days, 'daysWorked', days_worked, 'paidLeaveDays', paid_leave_days, 'absenceDays', absence_days)
  ),
  payroll_status
FROM final_payroll;

COMMIT;
