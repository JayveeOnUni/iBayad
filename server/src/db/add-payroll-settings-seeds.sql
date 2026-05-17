INSERT INTO system_settings (key, value, description) VALUES
  ('pay_frequency', '"semi-monthly"', 'Default pay frequency'),
  ('semi_monthly_cutoff_1', '15', 'First semi-monthly cutoff day'),
  ('semi_monthly_cutoff_2', '31', 'Second semi-monthly cutoff day'),
  ('semi_monthly_pay_day_1', '20', 'First semi-monthly pay day'),
  ('semi_monthly_pay_day_2', '5', 'Second semi-monthly pay day'),
  ('work_days_per_week', '5', 'Standard working days per week'),
  ('work_days_per_month', '22', 'Standard working days per month'),
  ('work_hours_per_day', '8', 'Standard working hours per day'),
  ('offset_credit_enabled', 'true', 'Convert excess attendance minutes into offset credits'),
  ('offset_requires_approval', 'true', 'Offset credits and usage require admin approval'),
  ('minimum_offset_credit_minutes', '1', 'Minimum excess minutes to create offset credit'),
  (
    'regular_holiday_rate',
    COALESCE((SELECT value FROM system_settings WHERE key = 'holiday_rate'), '2.0'::jsonb),
    'Regular holiday rate multiplier'
  ),
  ('special_holiday_rate', '1.3', 'Special holiday rate multiplier'),
  ('holiday_rate', '2.0', 'Legacy regular holiday rate multiplier'),
  ('night_differential_enabled', 'false', 'Enable night differential pay from recorded night differential hours'),
  ('thirteenth_month_enabled', 'true', 'Enable 13th month pay policy toggle')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description
  WHERE system_settings.description IS DISTINCT FROM EXCLUDED.description;
