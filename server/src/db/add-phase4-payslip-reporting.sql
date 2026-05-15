-- Phase 4 payslip and payroll reporting metadata.
-- Safe to run multiple times; does not modify locked payroll financial values.

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS payslip_reference_number VARCHAR(80),
  ADD COLUMN IF NOT EXISTS payslip_generated_at TIMESTAMPTZ;

ALTER TABLE payroll_audit_logs
  ADD COLUMN IF NOT EXISTS report_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS filters_used_json JSONB;

CREATE INDEX IF NOT EXISTS idx_payroll_records_payslip_reference
  ON payroll_records(payslip_reference_number)
  WHERE payslip_reference_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payroll_audit_report_type
  ON payroll_audit_logs(report_type, created_at DESC)
  WHERE report_type IS NOT NULL;

INSERT INTO role_permissions (role_name, permission_key) VALUES
  ('admin', 'payroll:view_payslips'),
  ('admin', 'payroll:view_reports'),
  ('admin', 'payroll:export_reports'),
  ('super_admin', 'payroll:view_payslips'),
  ('super_admin', 'payroll:view_reports'),
  ('super_admin', 'payroll:export_reports'),
  ('payroll_preparer', 'payroll:view_payslips'),
  ('payroll_preparer', 'payroll:view_reports'),
  ('payroll_preparer', 'payroll:export_reports'),
  ('payroll_approver', 'payroll:view_payslips'),
  ('payroll_approver', 'payroll:view_reports'),
  ('payroll_approver', 'payroll:export_reports'),
  ('payroll_releaser', 'payroll:view_payslips'),
  ('payroll_releaser', 'payroll:view_reports'),
  ('auditor', 'payroll:view_payslips'),
  ('auditor', 'payroll:view_reports'),
  ('auditor', 'payroll:export_reports')
ON CONFLICT (role_name, permission_key) DO NOTHING;

