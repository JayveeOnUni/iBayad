INSERT INTO system_settings (key, value, description) VALUES
  ('attendance_grace_minutes', '5', 'Grace period in minutes before counting tardiness'),
  ('attendance_half_day_minutes', '240', 'Rendered minutes threshold below which attendance is classified as half day')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description
  WHERE system_settings.description IS DISTINCT FROM EXCLUDED.description;
