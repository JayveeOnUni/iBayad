-- Phase 1 Payroll Foundation
-- Adds persisted backend-only payroll breakdown fields used for validation,
-- pay-frequency-aware computation, and payslip display.

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS expected_work_days INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS days_worked NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_leave_days NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unpaid_leave_days NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS late_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS undertime_deduction NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leave_deduction NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_income NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS statutory_rule_version VARCHAR(160);

CREATE INDEX IF NOT EXISTS idx_attendance_employee_date_status
  ON attendance(employee_id, date, status);

CREATE INDEX IF NOT EXISTS idx_attendance_requests_date_status
  ON attendance_requests(date, status);

CREATE INDEX IF NOT EXISTS idx_leave_requests_dates_status
  ON leave_requests(start_date, end_date, status);
