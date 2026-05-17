INSERT INTO system_settings (key, value, description) VALUES
  ('company_name', '"iBayad Corporation"', 'Company name'),
  ('company_address', '"123 Business Park, Ortigas Center"', 'Company street address'),
  ('company_city', '"Pasig"', 'Company city'),
  ('company_province', '"Metro Manila"', 'Company province or region'),
  ('company_zip_code', '"1605"', 'Company ZIP code'),
  ('company_phone', '"+63 2 8888 0000"', 'Company phone number'),
  ('company_email', '"hr@ibayad.com"', 'Company HR or payroll email address'),
  ('company_tin', '"123-456-789-000"', 'Company BIR TIN'),
  ('sss_employer_number', '"03-1234567-8"', 'SSS employer number'),
  ('philhealth_employer_number', '"12-000000001-2"', 'PhilHealth employer number'),
  ('pagibig_employer_number', '"IBAY-0001"', 'Pag-IBIG employer ID')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description
  WHERE system_settings.description IS DISTINCT FROM EXCLUDED.description;
