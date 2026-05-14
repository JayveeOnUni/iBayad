-- Ensure employee government ID fields exist in databases created before these
-- columns were added to the base schema.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS sss_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS philhealth_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS pagibig_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS tin_number VARCHAR(30);
