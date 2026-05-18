-- Removes the unsupported intern employment type from the database enum when safe.
-- Existing intern rows are left intact so historical data is not broken.
DO $$
DECLARE
  has_intern_value BOOLEAN;
  has_intern_rows BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_enum enum_values
    JOIN pg_type enum_types ON enum_types.oid = enum_values.enumtypid
    WHERE enum_types.typname = 'employment_type'
      AND enum_values.enumlabel = 'intern'
  ) INTO has_intern_value;

  IF NOT has_intern_value THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM employees
    WHERE employment_type::TEXT = 'intern'
  ) INTO has_intern_rows;

  IF has_intern_rows THEN
    RAISE NOTICE 'employment_type enum still includes intern because existing employee rows use it.';
    RETURN;
  END IF;

  ALTER TABLE employees
    ALTER COLUMN employment_type DROP DEFAULT;

  ALTER TYPE employment_type RENAME TO employment_type_old;
  CREATE TYPE employment_type AS ENUM ('regular', 'probationary', 'contractual', 'part_time');

  ALTER TABLE employees
    ALTER COLUMN employment_type TYPE employment_type
    USING employment_type::TEXT::employment_type;

  ALTER TABLE employees
    ALTER COLUMN employment_type SET DEFAULT 'regular';

  DROP TYPE employment_type_old;
END $$;
