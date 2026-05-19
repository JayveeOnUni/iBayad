# Test Plan - iBayad Payroll Management System

## Metadata
- Date: 2026-05-19
- Scope: Full system (client + server + integrations)
- Environment: Local dev on Windows, Node 20+, PostgreSQL 14+
- Overall status: FAILED (client lint config missing; manual checks not run)

## Pass or Fail Criteria
A run is PASS only if all of the following are true:
- All automated checks listed below pass.
- All Critical manual test cases pass.
- No Severity 1 or Severity 2 defects remain open.

A run is FAIL if any of the following occur:
- Any automated check fails.
- Any Critical manual test case fails.
- A Severity 1 or Severity 2 defect is open.

## Automated Checks (Executed)
| Area | Command | Result | Notes |
| --- | --- | --- | --- |
| Server tests | `npm test` (server) | PASS | 67 tests passed; warnings are expected from negative test cases |
| Server build | `npm run build` (server) | PASS | TypeScript build completed |
| Client lint | `npm run lint` (client) | FAIL | ESLint config not found; lint cannot run |
| Client build | `npm run build` (client) | PASS | Vite production build completed |

## Manual Test Matrix (Not Yet Executed)
Critical flows must be run for overall PASS. The list below is the minimum critical set.

### Authentication and Access
- AUTH-01 Admin login with valid credentials
- AUTH-02 Employee login with valid credentials
- AUTH-03 Invalid login shows safe error message
- AUTH-04 Refresh token rotation and logout
- AUTH-05 Role-based route protection (admin vs employee)

### Admin Portal - Core Operations
- ADM-01 Create employee with required fields
- ADM-02 Update employee details and employment status
- ADM-03 Deactivate and reactivate employee account
- ADM-04 Create payroll period and run payroll processing
- ADM-05 Approve payroll and verify audit log entry

### Employee Portal - Core Operations
- EMP-01 View personal dashboard and profile
- EMP-02 View attendance and payroll records
- EMP-03 Submit leave request with attachment (if required)
- EMP-04 Cancel pending leave request

### Attendance
- ATT-01 Clock in and clock out on work day
- ATT-02 Clock in blocked on rest day, holiday, leave, or absent
- ATT-03 Admin adjusts attendance and verifies audit log

### Leave Management
- LEV-01 Leave balance computation matches policy
- LEV-02 Sick, vacation, and emergency leave flows
- LEV-03 Approval changes balances correctly
- LEV-04 Rejection leaves balances unchanged

### Payroll and Statutory Deductions
- PAY-01 Payroll compute for semi-monthly period
- PAY-02 Statutory deductions (SSS, PhilHealth, Pag-IBIG) computed
- PAY-03 Withholding tax computation per TRAIN tables
- PAY-04 Void payroll record with reason and audit log

### Reporting and Settings
- RPT-01 Payroll summary report generation
- SET-01 Update payroll settings and regenerate periods
- SET-02 Holiday creation affects attendance behavior

### Notifications and Integrations
- INT-01 Activation email is sent on employee creation
- INT-02 Email failure paths return safe, actionable errors

## Test Data and Preconditions
- PostgreSQL database is running and migrated with current schema.
- Seed data includes leave types, work shifts, and system settings.
- At least one admin user and one employee user exist.
- Email provider is configured for activation emails.

## Non-Functional Checks (Recommended)
- Performance: payroll processing for 100+ employees completes within target time
- Security: JWT secrets and DB credentials are not default values
- Accessibility: key pages pass basic keyboard navigation and contrast checks
- Reliability: server handles invalid input without crashes

## Defects and Risks
- Client lint is blocked because ESLint configuration is missing.
- Some frontend pages may still use mock data and may not fully match API shapes.
- Initial admin user may not be seeded by default; manual creation may be needed.

## Current Verdict
FAILED - automated lint step failed due to missing ESLint configuration, and critical manual checks have not been executed.
