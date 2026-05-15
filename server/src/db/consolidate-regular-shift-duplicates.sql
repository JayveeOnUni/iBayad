-- Consolidate duplicate Regular Shift rows and prevent future normalized name duplicates.
--
-- Assumptions:
-- - The canonical Regular Shift is the oldest row whose LOWER(TRIM(name)) is 'regular shift'.
-- - Attendance keeps historical schedule facts in scheduled_start, scheduled_end, and
--   required_work_minutes, so scheduled_shift_id can safely be repointed to the canonical
--   Regular Shift before duplicate rows are deleted.
-- - Unrelated shift names are not modified. If unrelated normalized duplicates exist, this
--   migration raises an error before adding the unique index.

-- Verification before cleanup: normalized duplicate shift names, if any.
SELECT
  LOWER(TRIM(name)) AS normalized_name,
  COUNT(*) AS shift_count,
  MIN(created_at) AS oldest_created_at,
  ARRAY_AGG(id ORDER BY created_at ASC NULLS LAST, id ASC) AS shift_ids
FROM work_shifts
GROUP BY LOWER(TRIM(name))
HAVING COUNT(*) > 1
ORDER BY normalized_name;

-- Verification before cleanup: Regular Shift candidates and reference counts.
SELECT
  ws.id,
  ws.name,
  ws.start_time,
  ws.end_time,
  ws.break_minutes,
  ws.work_hours,
  ws.is_active,
  ws.created_at,
  ws.updated_at,
  (ws.id = FIRST_VALUE(ws.id) OVER (ORDER BY ws.created_at ASC NULLS LAST, ws.id ASC)) AS will_be_canonical,
  COUNT(DISTINCT e.id) AS employee_references,
  COUNT(DISTINCT a.id) AS attendance_references
FROM work_shifts ws
LEFT JOIN employees e ON e.shift_id = ws.id
LEFT JOIN attendance a ON a.scheduled_shift_id = ws.id
WHERE LOWER(TRIM(ws.name)) = 'regular shift'
GROUP BY ws.id
ORDER BY ws.created_at ASC NULLS LAST, ws.id ASC;

LOCK TABLE work_shifts, employees, attendance IN SHARE ROW EXCLUSIVE MODE;

WITH canonical_regular_shift AS (
  SELECT id
  FROM work_shifts
  WHERE LOWER(TRIM(name)) = 'regular shift'
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1
),
duplicate_regular_shifts AS (
  SELECT ws.id
  FROM work_shifts ws
  CROSS JOIN canonical_regular_shift canonical
  WHERE LOWER(TRIM(ws.name)) = 'regular shift'
    AND ws.id <> canonical.id
)
UPDATE employees e
SET shift_id = canonical.id,
    updated_at = NOW()
FROM canonical_regular_shift canonical
WHERE e.shift_id IN (SELECT id FROM duplicate_regular_shifts)
  AND e.shift_id <> canonical.id;

WITH canonical_regular_shift AS (
  SELECT id
  FROM work_shifts
  WHERE LOWER(TRIM(name)) = 'regular shift'
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1
),
duplicate_regular_shifts AS (
  SELECT ws.id
  FROM work_shifts ws
  CROSS JOIN canonical_regular_shift canonical
  WHERE LOWER(TRIM(ws.name)) = 'regular shift'
    AND ws.id <> canonical.id
)
UPDATE attendance a
SET scheduled_shift_id = canonical.id,
    updated_at = NOW()
FROM canonical_regular_shift canonical
WHERE a.scheduled_shift_id IN (SELECT id FROM duplicate_regular_shifts)
  AND a.scheduled_shift_id <> canonical.id;

WITH canonical_regular_shift AS (
  SELECT id
  FROM work_shifts
  WHERE LOWER(TRIM(name)) = 'regular shift'
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1
),
duplicate_regular_shifts AS (
  SELECT ws.id
  FROM work_shifts ws
  CROSS JOIN canonical_regular_shift canonical
  WHERE LOWER(TRIM(ws.name)) = 'regular shift'
    AND ws.id <> canonical.id
)
DELETE FROM work_shifts ws
USING duplicate_regular_shifts duplicate
WHERE ws.id = duplicate.id;

DO $$
DECLARE
  duplicate_names TEXT;
BEGIN
  SELECT STRING_AGG(FORMAT('%s (%s rows)', normalized_name, shift_count), ', ' ORDER BY normalized_name)
  INTO duplicate_names
  FROM (
    SELECT LOWER(TRIM(name)) AS normalized_name, COUNT(*) AS shift_count
    FROM work_shifts
    GROUP BY LOWER(TRIM(name))
    HAVING COUNT(*) > 1
  ) remaining_duplicates;

  IF duplicate_names IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot add normalized unique index to work_shifts. Remaining duplicate normalized shift names: %',
      duplicate_names;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_shifts_normalized_name_unique
  ON work_shifts (LOWER(TRIM(name)));

-- Verification after cleanup: should return zero rows.
SELECT
  LOWER(TRIM(name)) AS normalized_name,
  COUNT(*) AS shift_count,
  ARRAY_AGG(id ORDER BY created_at ASC NULLS LAST, id ASC) AS shift_ids
FROM work_shifts
GROUP BY LOWER(TRIM(name))
HAVING COUNT(*) > 1
ORDER BY normalized_name;

-- Verification after cleanup: should show one Regular Shift row and all references on it.
SELECT
  ws.id,
  ws.name,
  ws.created_at,
  COUNT(DISTINCT e.id) AS employee_references,
  COUNT(DISTINCT a.id) AS attendance_references
FROM work_shifts ws
LEFT JOIN employees e ON e.shift_id = ws.id
LEFT JOIN attendance a ON a.scheduled_shift_id = ws.id
WHERE LOWER(TRIM(ws.name)) = 'regular shift'
GROUP BY ws.id
ORDER BY ws.created_at ASC NULLS LAST, ws.id ASC;
