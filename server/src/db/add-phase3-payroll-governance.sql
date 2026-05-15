-- Phase 3 Payroll Governance
-- Adds segregation-friendly action tracking, immutable calculation snapshots,
-- period/record locks, and payroll audit logs.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_name VARCHAR(80) NOT NULL,
  permission_key VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (role_name, permission_key)
);

INSERT INTO role_permissions (role_name, permission_key)
VALUES
  ('admin', 'payroll:*'),
  ('super_admin', 'payroll:*'),
  ('payroll_preparer', 'payroll:create_period'),
  ('payroll_preparer', 'payroll:process'),
  ('payroll_preparer', 'payroll:validate'),
  ('payroll_preparer', 'payroll:reprocess'),
  ('payroll_preparer', 'payroll:view'),
  ('payroll_approver', 'payroll:validate'),
  ('payroll_approver', 'payroll:approve'),
  ('payroll_approver', 'payroll:request_correction'),
  ('payroll_approver', 'payroll:view'),
  ('payroll_releaser', 'payroll:release'),
  ('payroll_releaser', 'payroll:view'),
  ('auditor', 'payroll:view'),
  ('auditor', 'payroll:view_audit_logs')
ON CONFLICT (role_name, permission_key) DO NOTHING;

ALTER TABLE payroll_periods
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS validated_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT,
  ADD COLUMN IF NOT EXISTS correction_notes TEXT,
  ADD COLUMN IF NOT EXISTS correction_requested_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS correction_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reprocess_reason TEXT,
  ADD COLUMN IF NOT EXISTS reprocessed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reprocessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_reason TEXT;

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id);

CREATE TABLE IF NOT EXISTS payroll_calculation_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_record_id UUID NOT NULL REFERENCES payroll_records(id),
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id),
  employee_id UUID NOT NULL REFERENCES employees(id),
  snapshot_version INT NOT NULL DEFAULT 1,
  formula_version VARCHAR(80) NOT NULL DEFAULT 'phase3-v1',
  salary_version_id UUID,
  payroll_frequency pay_frequency,
  payroll_period_start DATE NOT NULL,
  payroll_period_end DATE NOT NULL,
  attendance_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  leave_adjustment_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  loan_deduction_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  statutory_rule_versions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  earnings_breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  deductions_breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  employer_contributions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  taxable_income NUMERIC(12,2) NOT NULL DEFAULT 0,
  non_taxable_earnings NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  computed_by UUID REFERENCES users(id),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payroll_record_id, snapshot_version)
);

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS current_snapshot_id UUID REFERENCES payroll_calculation_snapshots(id);

CREATE TABLE IF NOT EXISTS payroll_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  user_role VARCHAR(80),
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id UUID,
  payroll_period_id UUID REFERENCES payroll_periods(id),
  payroll_record_id UUID REFERENCES payroll_records(id),
  employee_id UUID REFERENCES employees(id),
  old_value_json JSONB,
  new_value_json JSONB,
  reason TEXT,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_name);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_locked ON payroll_periods(is_locked, status);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_action_users ON payroll_periods(processed_by, approved_by, released_by);
CREATE INDEX IF NOT EXISTS idx_payroll_records_locked ON payroll_records(payroll_period_id, is_locked);
CREATE INDEX IF NOT EXISTS idx_payroll_snapshots_record ON payroll_calculation_snapshots(payroll_record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_snapshots_period_employee ON payroll_calculation_snapshots(payroll_period_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_snapshots_hash ON payroll_calculation_snapshots(snapshot_hash);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_period ON payroll_audit_logs(payroll_period_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_employee ON payroll_audit_logs(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_action ON payroll_audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_audit_created ON payroll_audit_logs(created_at DESC);

CREATE OR REPLACE FUNCTION prevent_payroll_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Payroll calculation snapshots are immutable and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_payroll_snapshot_update ON payroll_calculation_snapshots;
CREATE TRIGGER trg_prevent_payroll_snapshot_update
BEFORE UPDATE OR DELETE ON payroll_calculation_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_payroll_snapshot_mutation();

CREATE OR REPLACE FUNCTION prevent_locked_payroll_record_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_locked THEN
    RAISE EXCEPTION 'Locked payroll records cannot be modified or deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_locked_payroll_record_update ON payroll_records;
CREATE TRIGGER trg_prevent_locked_payroll_record_update
BEFORE UPDATE OR DELETE ON payroll_records
FOR EACH ROW EXECUTE FUNCTION prevent_locked_payroll_record_mutation();

UPDATE payroll_periods
SET processed_at = COALESCE(processed_at, updated_at),
    processed_by = COALESCE(processed_by, created_by),
    status = CASE WHEN status::text = 'processing' THEN 'processed'::payroll_status ELSE status END
WHERE status::text = 'processing';

UPDATE payroll_records
SET status = 'processed'::payroll_status
WHERE status::text = 'processing';

UPDATE payroll_periods
SET status = 'locked'::payroll_status,
    is_locked = true,
    released_at = COALESCE(released_at, approved_at, updated_at),
    locked_at = COALESCE(locked_at, approved_at, updated_at),
    locked_reason = COALESCE(locked_reason, 'Backfilled lock for previously released payroll')
WHERE status::text = 'released';

UPDATE payroll_records pr
SET status = 'locked'::payroll_status,
    is_locked = true,
    locked_at = COALESCE(pr.locked_at, pp.locked_at, pr.updated_at)
FROM payroll_periods pp
WHERE pp.id = pr.payroll_period_id
  AND pp.is_locked = true
  AND pr.is_locked = false;
