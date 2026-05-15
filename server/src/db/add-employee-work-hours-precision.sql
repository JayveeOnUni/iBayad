ALTER TABLE IF EXISTS employees
  ALTER COLUMN work_hours_per_day TYPE NUMERIC(4,2)
  USING work_hours_per_day::numeric;
