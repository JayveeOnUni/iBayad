-- Employee account lifecycle and soft archive support

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumtypid = 'employment_status'::regtype
      AND enumlabel = 'end_of_contract'
  ) THEN
    ALTER TYPE employment_status ADD VALUE 'end_of_contract';
  END IF;
END $$;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS last_working_day DATE,
  ADD COLUMN IF NOT EXISTS separation_reason TEXT,
  ADD COLUMN IF NOT EXISTS separation_remarks TEXT,
  ADD COLUMN IF NOT EXISTS separation_processed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS separation_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_employees_active_directory
  ON employees(employment_status, is_deleted, last_name, first_name);

CREATE INDEX IF NOT EXISTS idx_employees_archived
  ON employees(is_deleted, deleted_at DESC);
