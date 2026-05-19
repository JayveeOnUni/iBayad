-- Demo payroll specialist seed data with 18 months of attendance and leave history.
-- Safe to rerun in development/demo databases; it resets only the demo account.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

BEGIN;

CREATE TEMP TABLE demo_payroll_specialist_params ON COMMIT DROP AS
SELECT
  (CURRENT_DATE - INTERVAL '18 months')::date AS attendance_start_date,
  CURRENT_DATE AS attendance_end_date,
  CURRENT_DATE AS demo_current_date,
  'DemoPayroll@2026'::text AS demo_password;

CREATE TEMP TABLE demo_payroll_specialist_account ON COMMIT DROP AS
SELECT
  'EMP-DEMO-HR-018M'::varchar(20) AS employee_number,
  'payroll.specialist.demo@ibayad.test'::varchar(255) AS email,
  'Alex'::varchar(100) AS first_name,
  'R'::varchar(100) AS middle_name,
  'Navarro'::varchar(100) AS last_name,
  '0917-555-0180'::varchar(20) AS phone,
  '1993-09-14'::date AS birth_date,
  'female'::gender_type AS gender,
  'married'::civil_status AS civil_status,
  'Filipino'::varchar(50) AS nationality,
  (params.demo_current_date - INTERVAL '18 months')::date AS hire_date,
  ((params.demo_current_date - INTERVAL '18 months')::date + INTERVAL '6 months')::date AS regularization_date,
  42000.00::numeric(12,2) AS basic_salary,
  ROUND((42000.00 / 22)::numeric, 4) AS daily_rate,
  ROUND(((42000.00 / 22) / 8)::numeric, 4) AS hourly_rate,
  '33-1234567-8'::varchar(30) AS sss_number,
  '12-123456789-0'::varchar(30) AS philhealth_number,
  '1212-1212-1212'::varchar(30) AS pagibig_number,
  '123-456-789-001'::varchar(30) AS tin_number,
  'Metrobank'::varchar(100) AS bank_name,
  '0098000180'::varchar(50) AS bank_account_number,
  '18 Aurora Ave.'::text AS address,
  'Quezon City'::varchar(100) AS city,
  'Metro Manila'::varchar(100) AS province,
  '1100'::varchar(10) AS zip_code,
  'Human Resources'::varchar(100) AS department_name,
  'HR'::varchar(20) AS department_code,
  'Payroll Specialist'::varchar(100) AS position_title,
  'HR-PAYROLL-SPECIALIST'::varchar(20) AS position_code
FROM demo_payroll_specialist_params params;

CREATE TEMP TABLE demo_payroll_specialist_target_employees ON COMMIT DROP AS
SELECT id
FROM employees
WHERE employee_number = (SELECT employee_number FROM demo_payroll_specialist_account)
   OR email = (SELECT email FROM demo_payroll_specialist_account);

CREATE TEMP TABLE demo_payroll_specialist_target_users ON COMMIT DROP AS
SELECT id
FROM users
WHERE email = (SELECT email FROM demo_payroll_specialist_account)
   OR employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

CREATE TEMP TABLE demo_payroll_specialist_target_leave_requests ON COMMIT DROP AS
SELECT id
FROM leave_requests
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

-- Reset demo-only records for this account.
DELETE FROM payroll_audit_logs
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees)
   OR user_id IN (SELECT id FROM demo_payroll_specialist_target_users);

DELETE FROM audit_logs
WHERE user_id IN (SELECT id FROM demo_payroll_specialist_target_users);

DELETE FROM payroll_leave_adjustments
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees)
   OR leave_request_id IN (SELECT id FROM demo_payroll_specialist_target_leave_requests);

DELETE FROM payroll_loan_deductions
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM payroll_calculation_snapshots
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM payroll_records
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM offset_usage_allocations
WHERE offset_usage_id IN (SELECT id FROM offset_usages WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees))
   OR offset_credit_id IN (SELECT id FROM offset_credits WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees));

DELETE FROM offset_usages
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM offset_credits
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM attendance_requests
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM attendance
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM leave_documents
WHERE leave_request_id IN (SELECT id FROM demo_payroll_specialist_target_leave_requests);

DELETE FROM leave_approval_history
WHERE leave_request_id IN (SELECT id FROM demo_payroll_specialist_target_leave_requests);

DELETE FROM leave_requests
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM leave_balances
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM loans
WHERE employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

UPDATE departments
SET manager_id = NULL,
    updated_at = NOW()
WHERE manager_id IN (SELECT id FROM demo_payroll_specialist_target_employees);

DELETE FROM users
WHERE id IN (SELECT id FROM demo_payroll_specialist_target_users);

DELETE FROM employees
WHERE id IN (SELECT id FROM demo_payroll_specialist_target_employees);

-- Reference records for HR payroll specialist.
INSERT INTO departments (name, code, description)
SELECT department_name, department_code, 'Human Resources department for demo payroll specialist.'
FROM demo_payroll_specialist_account
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = NOW();

INSERT INTO positions (title, code, department_id, base_salary, description)
SELECT
  account.position_title,
  account.position_code,
  (SELECT id FROM departments WHERE code = account.department_code),
  account.basic_salary,
  'Payroll Specialist role for the demo HR account.'
FROM demo_payroll_specialist_account account
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
  account.civil_status,
  account.nationality,
  account.address,
  account.city,
  account.province,
  account.zip_code,
  (SELECT id FROM departments WHERE code = account.department_code),
  (SELECT id FROM positions WHERE code = account.position_code),
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
  account.bank_name,
  account.bank_account_number,
  'DEMO DATA ONLY - payroll specialist with 18 months of tenure and full attendance/leave history.'
FROM demo_payroll_specialist_account account;

INSERT INTO users (employee_id, email, password_hash, role, is_active, activated_at)
SELECT
  e.id,
  account.email,
  crypt((SELECT demo_password FROM demo_payroll_specialist_params), gen_salt('bf', 10)),
  'employee'::user_role,
  true,
  NOW()
FROM demo_payroll_specialist_account account
JOIN employees e ON e.employee_number = account.employee_number;

CREATE TEMP TABLE demo_payroll_specialist_leave_type_ids ON COMMIT DROP AS
WITH typed AS (
  SELECT 'VACATION'::text AS leave_code, id AS leave_type_id,
         CASE WHEN code IN ('VACATION', 'VL') THEN 1 ELSE 2 END AS priority
  FROM leave_types
  WHERE code IN ('VACATION', 'VL')
  UNION ALL
  SELECT 'SICK'::text AS leave_code, id AS leave_type_id,
         CASE WHEN code IN ('SICK', 'SL') THEN 1 ELSE 2 END AS priority
  FROM leave_types
  WHERE code IN ('SICK', 'SL')
  UNION ALL
  SELECT 'EMERGENCY'::text AS leave_code, id AS leave_type_id,
         CASE WHEN code IN ('EMERGENCY', 'EL') THEN 1 ELSE 2 END AS priority
  FROM leave_types
  WHERE code IN ('EMERGENCY', 'EL')
), best AS (
  SELECT leave_code, MIN(priority) AS priority
  FROM typed
  GROUP BY leave_code
)
SELECT typed.leave_code, typed.leave_type_id
FROM typed
JOIN best ON best.leave_code = typed.leave_code AND best.priority = typed.priority;

DO $$
BEGIN
  IF (SELECT COUNT(DISTINCT leave_code) FROM demo_payroll_specialist_leave_type_ids) < 3 THEN
    RAISE EXCEPTION 'Vacation, sick, and emergency leave types must exist before running the demo payroll specialist seed.';
  END IF;
END $$;

CREATE TEMP TABLE demo_payroll_specialist_leave_plans ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    ('VACATION', '2025-08-11'::date, '2025-08-12'::date, 2.0::numeric, 'Family out-of-town trip.', 'approved', 'Approved vacation leave.', 0.0::numeric, 0.0::numeric, 0.0::numeric),
    ('SICK',     '2025-10-03'::date, '2025-10-03'::date, 1.0::numeric, 'Seasonal flu.', 'approved', 'Approved sick leave.', 0.0::numeric, 0.0::numeric, 0.0::numeric),
    ('EMERGENCY','2025-12-23'::date, '2025-12-23'::date, 1.0::numeric, 'Emergency home repair.', 'approved', 'Approved emergency leave.', 1.0::numeric, 0.0::numeric, 0.0::numeric),
    ('VACATION', '2026-01-06'::date, '2026-01-06'::date, 1.0::numeric, 'Personal rest day.', 'approved', 'Approved vacation leave.', 0.0::numeric, 0.0::numeric, 0.0::numeric),
    ('SICK',     '2026-02-17'::date, '2026-02-17'::date, 1.0::numeric, 'Clinic visit.', 'approved', 'Approved sick leave.', 0.0::numeric, 0.0::numeric, 0.0::numeric),
    ('VACATION', '2026-04-24'::date, '2026-04-24'::date, 1.0::numeric, 'Pending vacation request.', 'pending', NULL, 0.0::numeric, 0.0::numeric, 0.0::numeric)
) AS leave_plan (
  leave_code, start_date, end_date, total_days, reason, status, review_remarks,
  deducted_sick_days, deducted_vacation_days, unpaid_days
);

CREATE TEMP TABLE demo_payroll_specialist_reviewer ON COMMIT DROP AS
SELECT COALESCE(
  (SELECT id FROM users WHERE role IN ('admin', 'super_admin') ORDER BY created_at ASC NULLS LAST, id ASC LIMIT 1),
  (SELECT id FROM users WHERE email = (SELECT email FROM demo_payroll_specialist_account) LIMIT 1)
) AS user_id;

INSERT INTO leave_requests (
  employee_id, leave_type_id, start_date, end_date, total_days, reason,
  is_half_day, status, reviewed_by, reviewed_at, review_remarks,
  day_count_type, is_paid, unpaid_days, deducted_sick_days, deducted_vacation_days, deducted_other_days,
  approved_at
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
  CASE WHEN lp.status IN ('approved', 'rejected') THEN (SELECT user_id FROM demo_payroll_specialist_reviewer) ELSE NULL END,
  CASE WHEN lp.status IN ('approved', 'rejected') THEN NOW() ELSE NULL END,
  lp.review_remarks,
  'working_days'::leave_day_count_type,
  lp.unpaid_days = 0,
  lp.unpaid_days,
  lp.deducted_sick_days,
  lp.deducted_vacation_days,
  0,
  CASE WHEN lp.status = 'approved' THEN NOW() ELSE NULL END
FROM demo_payroll_specialist_leave_plans lp
CROSS JOIN demo_payroll_specialist_account account
JOIN employees e ON e.employee_number = account.employee_number
JOIN demo_payroll_specialist_leave_type_ids lt ON lt.leave_code = lp.leave_code;

CREATE TEMP TABLE demo_payroll_specialist_attendance_exceptions ON COMMIT DROP AS
SELECT *
FROM (
  VALUES
    ('2024-12-05'::date, 'late'::attendance_status,    '08:12'::time, '17:00'::time, 468, 12, 12, 0.00::numeric, 'Late by 12 minutes.'),
    ('2025-02-11'::date, 'absent'::attendance_status,  NULL::time,    NULL::time,    0,   0,  0, 0.00::numeric, 'Unpaid absence.'),
    ('2025-06-18'::date, 'present'::attendance_status, '08:00'::time, '16:15'::time, 435, 0, 45, 0.00::numeric, 'Undertime by 45 minutes.'),
    ('2025-09-04'::date, 'present'::attendance_status, '08:00'::time, '18:30'::time, 570, 0,  0, 0.00::numeric, 'Extra rendered time creates offset credit.'),
    ('2025-12-01'::date, 'late'::attendance_status,    '08:20'::time, '17:00'::time, 460, 20, 20, 0.00::numeric, 'Late by 20 minutes.'),
    ('2026-03-03'::date, 'absent'::attendance_status,  NULL::time,    NULL::time,    0,   0,  0, 0.00::numeric, 'Unpaid absence.'),
    ('2026-05-08'::date, 'present'::attendance_status, '08:00'::time, '18:10'::time, 550, 0,  0, 0.00::numeric, 'Extra rendered time creates offset credit.')
) AS exception_row (
  work_date, status, time_in_time, time_out_time,
  actual_rendered_minutes, late_minutes, undertime_minutes, overtime_hours, remarks
);

CREATE TEMP TABLE demo_payroll_specialist_approved_leave_days ON COMMIT DROP AS
SELECT lr.employee_id,
       gs.leave_date::date AS leave_date,
       lt.name AS leave_type_name,
       lr.reason
FROM leave_requests lr
JOIN leave_types lt ON lt.id = lr.leave_type_id
CROSS JOIN LATERAL generate_series(lr.start_date, lr.end_date, INTERVAL '1 day') AS gs(leave_date)
JOIN demo_payroll_specialist_params params ON true
WHERE lr.employee_id IN (SELECT id FROM employees WHERE employee_number = (SELECT employee_number FROM demo_payroll_specialist_account))
  AND lr.status = 'approved'
  AND gs.leave_date::date BETWEEN params.attendance_start_date AND params.attendance_end_date
  AND EXTRACT(ISODOW FROM gs.leave_date::date) < 6;

WITH demo AS (
  SELECT e.id AS employee_id, u.id AS user_id, e.shift_id
  FROM demo_payroll_specialist_account account
  JOIN employees e ON e.employee_number = account.employee_number
  JOIN users u ON u.employee_id = e.id
),
attendance_dates AS (
  SELECT gs.work_date::date AS work_date
  FROM demo_payroll_specialist_params params
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
    exception_row.time_out_time,
    exception_row.actual_rendered_minutes AS exception_rendered_minutes,
    exception_row.late_minutes AS exception_late_minutes,
    exception_row.undertime_minutes AS exception_undertime_minutes,
    exception_row.overtime_hours AS exception_overtime_hours,
    exception_row.remarks AS exception_remarks
  FROM demo
  CROSS JOIN attendance_dates dates
  LEFT JOIN demo_payroll_specialist_attendance_exceptions exception_row
    ON exception_row.work_date = dates.work_date
  LEFT JOIN demo_payroll_specialist_approved_leave_days leave_day
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
  CASE
    WHEN final_status IN ('rest_day', 'on_leave', 'absent') THEN NULL
    ELSE (work_date::text || ' ' || COALESCE(time_in_time, '08:00'::time)::text || '+08')::timestamptz
  END,
  CASE
    WHEN final_status IN ('rest_day', 'on_leave', 'absent') THEN NULL
    ELSE (work_date::text || ' ' || COALESCE(time_out_time, '17:00'::time)::text || '+08')::timestamptz
  END,
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
WHERE a.employee_id IN (SELECT id FROM demo_payroll_specialist_target_employees)
  AND a.offset_earned_minutes > 0;

COMMIT;
