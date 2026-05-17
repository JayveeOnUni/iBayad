ALTER TABLE holidays
  ADD COLUMN IF NOT EXISTS holiday_date DATE,
  ADD COLUMN IF NOT EXISTS holiday_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS country VARCHAR(80) DEFAULT 'Philippines',
  ADD COLUMN IF NOT EXISTS city_or_province VARCHAR(120),
  ADD COLUMN IF NOT EXISTS is_working_holiday BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS source TEXT;

ALTER TABLE holidays
  DROP CONSTRAINT IF EXISTS holidays_type_check;

ALTER TABLE holidays
  ADD CONSTRAINT holidays_type_check
  CHECK (type IN ('regular', 'special_non_working', 'special_working'));

UPDATE holidays
SET holiday_date = COALESCE(holiday_date, date),
    holiday_type = COALESCE(holiday_type, type),
    country = COALESCE(NULLIF(TRIM(country), ''), 'Philippines'),
    is_working_holiday = CASE
      WHEN COALESCE(holiday_type, type) = 'special_working' THEN true
      ELSE COALESCE(is_working_holiday, false)
    END
WHERE holiday_date IS NULL
   OR holiday_type IS NULL
   OR country IS NULL
   OR TRIM(country) = ''
   OR is_working_holiday IS NULL
   OR COALESCE(holiday_type, type) = 'special_working';

UPDATE holidays
SET type = holiday_type
WHERE holiday_type IN ('regular', 'special_non_working', 'special_working')
  AND type IS DISTINCT FROM holiday_type;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'holidays_holiday_type_check'
      AND conrelid = 'holidays'::regclass
  ) THEN
    ALTER TABLE holidays
      ADD CONSTRAINT holidays_holiday_type_check
      CHECK (holiday_type IS NULL OR holiday_type IN ('regular', 'special_non_working', 'special_working'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_holidays_location_date ON holidays(country, city_or_province, holiday_date);
