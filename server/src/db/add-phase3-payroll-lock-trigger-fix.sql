-- Phase 3 Payroll Lock Trigger Fix
-- Allows normal deletes of unlocked payroll records while still blocking locked rows.

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
