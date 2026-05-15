-- iBayad Offset Credit System
-- Converts excess attendance minutes into auditable offset credits instead of additional salary.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'offset_credit_status') THEN
    CREATE TYPE offset_credit_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'offset_credit_source') THEN
    CREATE TYPE offset_credit_source AS ENUM ('excess_hours', 'attendance_correction', 'manual_adjustment');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'offset_usage_status') THEN
    CREATE TYPE offset_usage_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'offset_usage_source') THEN
    CREATE TYPE offset_usage_source AS ENUM ('employee_request', 'admin_entry', 'manual_adjustment');
  END IF;
END
$$;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS scheduled_shift_id UUID REFERENCES work_shifts(id),
  ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS required_work_minutes INT DEFAULT 480,
  ADD COLUMN IF NOT EXISTS actual_rendered_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS undertime_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS excess_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offset_earned_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offset_used_minutes INT DEFAULT 0;

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS excess_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offset_earned_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offset_used_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS undertime_minutes INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offset_balance_minutes INT DEFAULT 0;

CREATE TABLE IF NOT EXISTS offset_credits (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id           UUID NOT NULL REFERENCES employees(id),
  attendance_id         UUID REFERENCES attendance(id) ON DELETE SET NULL,
  date_earned           DATE NOT NULL,
  source                offset_credit_source NOT NULL DEFAULT 'excess_hours',
  minutes_earned        INT NOT NULL CHECK (minutes_earned >= 0),
  minutes_remaining     INT NOT NULL DEFAULT 0 CHECK (minutes_remaining >= 0),
  status                offset_credit_status NOT NULL DEFAULT 'pending',
  reason                TEXT,
  review_remarks        TEXT,
  reviewed_by           UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offset_usages (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id           UUID NOT NULL REFERENCES employees(id),
  attendance_id         UUID REFERENCES attendance(id) ON DELETE SET NULL,
  usage_date            DATE NOT NULL,
  requested_minutes     INT NOT NULL CHECK (requested_minutes > 0),
  approved_minutes      INT NOT NULL DEFAULT 0 CHECK (approved_minutes >= 0),
  status                offset_usage_status NOT NULL DEFAULT 'pending',
  source                offset_usage_source NOT NULL DEFAULT 'employee_request',
  reason                TEXT NOT NULL,
  review_remarks        TEXT,
  reviewed_by           UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  created_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offset_usage_allocations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  offset_usage_id       UUID NOT NULL REFERENCES offset_usages(id) ON DELETE CASCADE,
  offset_credit_id      UUID NOT NULL REFERENCES offset_credits(id),
  minutes_applied       INT NOT NULL CHECK (minutes_applied > 0),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_offset_credits_employee_status ON offset_credits(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_offset_credits_attendance ON offset_credits(attendance_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_offset_credits_attendance_source_unique
  ON offset_credits(attendance_id)
  WHERE attendance_id IS NOT NULL AND source IN ('excess_hours', 'attendance_correction');
CREATE INDEX IF NOT EXISTS idx_offset_usages_employee_status ON offset_usages(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_offset_usages_attendance ON offset_usages(attendance_id);
CREATE INDEX IF NOT EXISTS idx_offset_allocations_usage ON offset_usage_allocations(offset_usage_id);
CREATE INDEX IF NOT EXISTS idx_offset_allocations_credit ON offset_usage_allocations(offset_credit_id);

UPDATE work_shifts
SET name = 'Regular Shift', start_time = '08:00', end_time = '17:00', break_minutes = 60, work_hours = 8, is_active = true
WHERE name = 'Regular Day Shift';

INSERT INTO work_shifts (name, start_time, end_time, break_minutes, work_hours, is_active)
SELECT 'Regular Shift', '08:00', '17:00', 60, 8, true
WHERE NOT EXISTS (SELECT 1 FROM work_shifts WHERE name = 'Regular Shift');

INSERT INTO work_shifts (name, start_time, end_time, break_minutes, work_hours, is_active)
SELECT 'Mid Shift', '09:00', '18:00', 60, 8, false
WHERE NOT EXISTS (SELECT 1 FROM work_shifts WHERE name = 'Mid Shift');

INSERT INTO work_shifts (name, start_time, end_time, break_minutes, work_hours, is_active)
SELECT 'Graveyard Shift', '22:00', '07:00', 60, 8, false
WHERE NOT EXISTS (SELECT 1 FROM work_shifts WHERE name = 'Graveyard Shift');

UPDATE work_shifts
SET start_time = '09:00',
    end_time = '18:00',
    break_minutes = 60,
    work_hours = 8,
    is_active = false
WHERE name = 'Mid Shift';

UPDATE work_shifts
SET start_time = '22:00',
    end_time = '07:00',
    break_minutes = 60,
    work_hours = 8,
    is_active = false
WHERE name = 'Graveyard Shift';

UPDATE work_shifts
SET is_active = false
WHERE name IN ('Morning Shift', 'Night Shift');

UPDATE attendance
SET actual_rendered_minutes = COALESCE(NULLIF(actual_rendered_minutes, 0), total_worked_minutes, 0),
    required_work_minutes = COALESCE(NULLIF(required_work_minutes, 0), 480),
    excess_minutes = GREATEST(0, ROUND(COALESCE(overtime_hours, 0) * 60)::INT),
    offset_earned_minutes = GREATEST(0, ROUND(COALESCE(overtime_hours, 0) * 60)::INT),
    overtime_hours = 0,
    night_diff_hours = 0,
    updated_at = NOW();

INSERT INTO offset_credits (
  employee_id, attendance_id, date_earned, source, minutes_earned, minutes_remaining, status, reason
)
SELECT a.employee_id, a.id, a.date, 'excess_hours', a.offset_earned_minutes, a.offset_earned_minutes,
       'pending', 'Backfilled from existing excess attendance minutes.'
FROM attendance a
WHERE a.offset_earned_minutes > 0
  AND NOT EXISTS (
    SELECT 1 FROM offset_credits oc
    WHERE oc.attendance_id = a.id
      AND oc.source IN ('excess_hours', 'attendance_correction')
  );

INSERT INTO system_settings (key, value, description) VALUES
  ('offset_credit_enabled', 'true', 'Convert excess attendance minutes into offset credits'),
  ('offset_requires_approval', 'true', 'Offset credits and usage require admin approval'),
  ('minimum_offset_credit_minutes', '1', 'Minimum excess minutes to create pending offset credit'),
  ('night_differential_enabled', 'false', 'Night differential computation is disabled for active day shifts')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = NOW();

DELETE FROM system_settings
WHERE key IN ('overtime_rate', 'night_differential_rate');
