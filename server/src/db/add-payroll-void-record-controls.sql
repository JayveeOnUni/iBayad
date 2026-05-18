ALTER TYPE payroll_status ADD VALUE IF NOT EXISTS 'voided';

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_payroll_records_voided
  ON payroll_records(payroll_period_id, status, voided_at);

INSERT INTO role_permissions (role_name, permission_key) VALUES
  ('payroll_preparer', 'payroll:void_record'),
  ('payroll_approver', 'payroll:void_record')
ON CONFLICT (role_name, permission_key) DO NOTHING;
