-- Phase 2 Payroll Compliance and Adjustment Fixes
-- Maintains statutory rule versions here. When SSS, PhilHealth, Pag-IBIG, or
-- BIR publish new tables, insert a new statutory_rule_versions row and its
-- matching statutory_brackets / withholding_tax_brackets rows instead of
-- changing payroll engine code.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS statutory_rule_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency VARCHAR(40) NOT NULL,
  rule_name VARCHAR(120) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  version_label VARCHAR(120) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT statutory_rule_versions_effective_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE (agency, rule_name, effective_from, version_label)
);

CREATE TABLE IF NOT EXISTS statutory_brackets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_version_id UUID NOT NULL REFERENCES statutory_rule_versions(id) ON DELETE CASCADE,
  min_compensation NUMERIC(12,2) DEFAULT 0,
  max_compensation NUMERIC(12,2),
  employee_share NUMERIC(12,2),
  employer_share NUMERIC(12,2),
  total_contribution NUMERIC(12,2),
  fixed_amount NUMERIC(12,2),
  percentage_rate NUMERIC(9,6),
  formula_type VARCHAR(80) NOT NULL DEFAULT 'bracket',
  metadata_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS withholding_tax_brackets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_version_id UUID NOT NULL REFERENCES statutory_rule_versions(id) ON DELETE CASCADE,
  payroll_frequency pay_frequency NOT NULL,
  min_taxable_income NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_taxable_income NUMERIC(12,2),
  base_tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  excess_over NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(9,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payroll_records
  ADD COLUMN IF NOT EXISTS non_taxable_earnings NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pre_tax_deductions NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS statutory_deductions NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS post_tax_deductions NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_contributions NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_earnings NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_leave_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS computation_breakdown JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS statutory_rule_versions JSONB DEFAULT '{}'::jsonb;

ALTER TABLE payroll_leave_adjustments
  ADD COLUMN IF NOT EXISTS payroll_record_id UUID REFERENCES payroll_records(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS payroll_loan_deductions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payroll_record_id UUID NOT NULL REFERENCES payroll_records(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  loan_id UUID NOT NULL REFERENCES loans(id),
  payroll_period_id UUID NOT NULL REFERENCES payroll_periods(id),
  scheduled_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deducted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_balance_before NUMERIC(12,2) NOT NULL DEFAULT 0,
  remaining_balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
  deduction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (loan_id, payroll_period_id)
);

CREATE INDEX IF NOT EXISTS idx_statutory_versions_lookup
  ON statutory_rule_versions(agency, rule_name, is_active, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_statutory_brackets_version
  ON statutory_brackets(rule_version_id, min_compensation, max_compensation);
CREATE INDEX IF NOT EXISTS idx_withholding_brackets_version_frequency
  ON withholding_tax_brackets(rule_version_id, payroll_frequency, min_taxable_income);
CREATE INDEX IF NOT EXISTS idx_payroll_loan_deductions_record
  ON payroll_loan_deductions(payroll_record_id);
CREATE INDEX IF NOT EXISTS idx_payroll_loan_deductions_employee_period
  ON payroll_loan_deductions(employee_id, payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_leave_adjustments_record
  ON payroll_leave_adjustments(payroll_record_id);

WITH versions AS (
  INSERT INTO statutory_rule_versions (agency, rule_name, effective_from, version_label, description)
  VALUES
    ('SSS', 'employee_employer_contribution', DATE '2025-01-01', 'SSS-2025-01',
     'SSS employee/employer contribution policy effective January 1, 2025. SS 15% of MSC up to PHP 35,000 split 5% employee / 10% employer; EC employer-only PHP 10 or PHP 30.'),
    ('PHILHEALTH', 'direct_contributor_premium', DATE '2025-01-01', 'PHIC-PA-2025-0002',
     'PhilHealth Advisory 2025-0002: 5.0% premium, PHP 10,000 income floor, PHP 100,000 income ceiling, split equally.'),
    ('PAGIBIG', 'monthly_membership_savings', DATE '2024-02-01', 'HDMF-Circular-460',
     'Pag-IBIG Circular 460: maximum fund salary PHP 10,000; employee 1% up to PHP 1,500 and 2% over PHP 1,500; employer 2%.'),
    ('BIR', 'withholding_tax_compensation', DATE '2023-01-01', 'BIR-RR-11-2018-2023',
     'BIR Revised Withholding Tax Table effective January 1, 2023 and onwards.')
  ON CONFLICT (agency, rule_name, effective_from, version_label) DO UPDATE SET
    description = EXCLUDED.description,
    is_active = true,
    updated_at = NOW()
  RETURNING id, agency
)
INSERT INTO statutory_brackets (
  rule_version_id, min_compensation, max_compensation, formula_type, metadata_json
)
SELECT id, 0, NULL,
       CASE agency
         WHEN 'SSS' THEN 'sss_2025_rate_with_msc_step'
         WHEN 'PHILHEALTH' THEN 'philhealth_floor_ceiling_rate'
         WHEN 'PAGIBIG' THEN 'pagibig_circular_460'
       END,
       CASE agency
         WHEN 'SSS' THEN '{"minMonthlySalaryCredit":5000,"maxMonthlySalaryCredit":35000,"salaryCreditStep":500,"employeeRate":0.05,"employerRate":0.10,"ecLow":10,"ecHigh":30,"ecHighThreshold":15000}'::jsonb
         WHEN 'PHILHEALTH' THEN '{"floor":10000,"ceiling":100000,"rate":0.05,"split":"equal"}'::jsonb
         WHEN 'PAGIBIG' THEN '{"maxFundSalary":10000,"lowSalaryThreshold":1500,"lowEmployeeRate":0.01,"highEmployeeRate":0.02,"employerRate":0.02}'::jsonb
       END
FROM versions
WHERE agency IN ('SSS', 'PHILHEALTH', 'PAGIBIG')
  AND NOT EXISTS (
    SELECT 1 FROM statutory_brackets sb WHERE sb.rule_version_id = versions.id
  );

WITH bir AS (
  SELECT id
  FROM statutory_rule_versions
  WHERE agency = 'BIR'
    AND rule_name = 'withholding_tax_compensation'
    AND effective_from = DATE '2023-01-01'
  LIMIT 1
)
INSERT INTO withholding_tax_brackets (
  rule_version_id, payroll_frequency, min_taxable_income, max_taxable_income, base_tax, excess_over, tax_rate
)
SELECT bir.id, x.payroll_frequency::pay_frequency, x.min_taxable_income, x.max_taxable_income,
       x.base_tax, x.excess_over, x.tax_rate
FROM bir
CROSS JOIN (
  VALUES
    ('weekly', 0, 4808, 0, 0, 0),
    ('weekly', 4808.01, 7691, 0, 4808, 0.15),
    ('weekly', 7692, 15384, 432.60, 7692, 0.20),
    ('weekly', 15385, 38461, 1971.20, 15385, 0.25),
    ('weekly', 38462, 153845, 7740.45, 38462, 0.30),
    ('weekly', 153846, NULL, 42355.65, 153846, 0.35),
    ('semi-monthly', 0, 10417, 0, 0, 0),
    ('semi-monthly', 10417.01, 16666, 0, 10417, 0.15),
    ('semi-monthly', 16667, 33332, 937.50, 16667, 0.20),
    ('semi-monthly', 33333, 83332, 4270.70, 33333, 0.25),
    ('semi-monthly', 83333, 333332, 16770.70, 83333, 0.30),
    ('semi-monthly', 333333, NULL, 91770.70, 333333, 0.35),
    ('monthly', 0, 20833, 0, 0, 0),
    ('monthly', 20833.01, 33332, 0, 20833, 0.15),
    ('monthly', 33333, 66666, 1875.00, 33333, 0.20),
    ('monthly', 66667, 166666, 8541.80, 66667, 0.25),
    ('monthly', 166667, 666666, 33541.80, 166667, 0.30),
    ('monthly', 666667, NULL, 183541.80, 666667, 0.35)
) AS x(payroll_frequency, min_taxable_income, max_taxable_income, base_tax, excess_over, tax_rate)
WHERE NOT EXISTS (
  SELECT 1
  FROM withholding_tax_brackets wtb
  WHERE wtb.rule_version_id = bir.id
    AND wtb.payroll_frequency = x.payroll_frequency::pay_frequency
    AND wtb.min_taxable_income = x.min_taxable_income
);
