-- Phase 3 Payroll Governance Statuses and Roles
-- Kept separate because PostgreSQL enum values should be committed before use.

DO $$
BEGIN
  ALTER TYPE payroll_status ADD VALUE IF NOT EXISTS 'processed';
  ALTER TYPE payroll_status ADD VALUE IF NOT EXISTS 'validation_failed';
  ALTER TYPE payroll_status ADD VALUE IF NOT EXISTS 'ready_for_approval';
  ALTER TYPE payroll_status ADD VALUE IF NOT EXISTS 'needs_correction';
  ALTER TYPE payroll_status ADD VALUE IF NOT EXISTS 'locked';
END $$;

DO $$
BEGIN
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'payroll_preparer';
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'payroll_approver';
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'payroll_releaser';
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'auditor';
  ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';
END $$;
