DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'profile_update_request_status') THEN
    CREATE TYPE profile_update_request_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS profile_update_requests (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id           UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  requested_changes     JSONB NOT NULL CHECK (jsonb_typeof(requested_changes) = 'object'),
  status                profile_update_request_status NOT NULL DEFAULT 'pending',
  employee_note         TEXT,
  review_remarks        TEXT,
  reviewed_by           UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_update_requests_employee_created
  ON profile_update_requests(employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_update_requests_status_created
  ON profile_update_requests(status, created_at DESC);
