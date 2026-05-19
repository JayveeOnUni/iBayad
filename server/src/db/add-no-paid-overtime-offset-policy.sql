-- iBayad policy: extra rendered time is tracked as offset credit, not paid overtime.

UPDATE attendance
SET excess_minutes = CASE
      WHEN GREATEST(COALESCE(excess_minutes, 0), COALESCE(offset_earned_minutes, 0), ROUND(COALESCE(overtime_hours, 0) * 60)::INT) > 0
      THEN GREATEST(COALESCE(excess_minutes, 0), COALESCE(offset_earned_minutes, 0), ROUND(COALESCE(overtime_hours, 0) * 60)::INT)
      ELSE 0
    END,
    offset_earned_minutes = CASE
      WHEN GREATEST(COALESCE(offset_earned_minutes, 0), COALESCE(excess_minutes, 0), ROUND(COALESCE(overtime_hours, 0) * 60)::INT) > 0
      THEN GREATEST(COALESCE(offset_earned_minutes, 0), COALESCE(excess_minutes, 0), ROUND(COALESCE(overtime_hours, 0) * 60)::INT)
      ELSE 0
    END,
    overtime_hours = 0,
    updated_at = NOW()
WHERE COALESCE(overtime_hours, 0) <> 0
   OR (COALESCE(excess_minutes, 0) > 0 AND COALESCE(offset_earned_minutes, 0) = 0);

INSERT INTO offset_credits (
  employee_id, attendance_id, date_earned, source, minutes_earned, minutes_remaining,
  status, reason, created_by
)
SELECT a.employee_id,
       a.id,
       a.date,
       'excess_hours',
       a.offset_earned_minutes,
       a.offset_earned_minutes,
       'pending',
       'Backfilled from extra rendered time under offset policy.',
       a.created_by
FROM attendance a
WHERE a.offset_earned_minutes > 0
  AND NOT EXISTS (
    SELECT 1
    FROM offset_credits oc
    WHERE oc.attendance_id = a.id
      AND oc.source IN ('excess_hours', 'attendance_correction')
  );

UPDATE payroll_records
SET taxable_earnings = GREATEST(0, COALESCE(taxable_earnings, 0) - COALESCE(overtime_pay, 0)),
    gross_pay = GREATEST(0, COALESCE(gross_pay, 0) - COALESCE(overtime_pay, 0)),
    taxable_income = GREATEST(0, COALESCE(taxable_income, 0) - COALESCE(overtime_pay, 0)),
    net_pay = COALESCE(net_pay, 0) - COALESCE(overtime_pay, 0),
    overtime_pay = 0,
    computation_breakdown = jsonb_set(
      COALESCE(computation_breakdown, '{}'::jsonb),
      '{earnings}',
      COALESCE(COALESCE(computation_breakdown, '{}'::jsonb)->'earnings', '{}'::jsonb)
        || '{"overtimePay":0,"paidOvertimeDisabled":true}'::jsonb,
      true
    ),
    updated_at = NOW()
WHERE COALESCE(overtime_pay, 0) <> 0;

DELETE FROM system_settings
WHERE key = 'overtime_rate';
