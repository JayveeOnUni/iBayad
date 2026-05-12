# iBayad Payroll Management System

A web-based payroll management system for iBayad with separate Admin and Employee portals. The application is organized as a React + TypeScript frontend and an Express + TypeScript backend backed by PostgreSQL.

## Current Implementation Status

This repository contains a functional application scaffold with real backend modules for authentication, employees, payroll, attendance, and leave management. The frontend already includes the full portal navigation, layouts, reusable UI components, and many feature pages.

Important implementation notes from code review:

- Many frontend pages currently render mock data and are not fully connected to the backend services yet.
- Some frontend service endpoints and response shapes do not match the current Express API routes.
- The database schema seeds leave types, work shifts, and system settings, but it does not seed an initial login user.
- TypeScript builds currently pass for both the client and server.
- There are no automated test scripts configured yet.

## Tech Stack

### Frontend

- React 18
- TypeScript
- Vite
- React Router
- Zustand
- React Hook Form
- Zod
- Tailwind CSS
- Lucide React
- Recharts
- date-fns

### Backend

- Node.js
- Express
- TypeScript
- PostgreSQL
- JWT authentication
- bcryptjs password hashing
- dotenv
- pg

## Project Structure

```text
iBayadPayrollManagementSystem/
+-- client/                       # React + Vite frontend
|   +-- src/
|   |   +-- components/           # Reusable layout and UI components
|   |   +-- hooks/                # Auth and payroll hooks
|   |   +-- layouts/              # Admin and employee layout shells
|   |   +-- pages/                # Admin, employee, and auth pages
|   |   +-- services/             # API client and frontend service wrappers
|   |   +-- store/                # Zustand auth store
|   |   +-- types/                # Shared frontend TypeScript types
|   |   +-- utils/                # Payroll, tax, and date helpers
|   +-- package.json
|   +-- tailwind.config.ts
|   +-- vite.config.ts
+-- server/                       # Express + TypeScript backend
|   +-- src/
|   |   +-- controllers/          # Request handlers
|   |   +-- db/                   # PostgreSQL schema
|   |   +-- middleware/           # Auth and error middleware
|   |   +-- models/               # Database model helpers
|   |   +-- routes/               # API route definitions
|   |   +-- services/             # Payroll business logic
|   |   +-- utils/                # DB, tax, and date utilities
|   +-- .env.example
|   +-- package.json
+-- tests/                        # Test folder placeholder
+-- ibayad.md                     # Original product/system planning notes
+-- README.md
```

## Main Features

### Admin Portal

- Dashboard overview
- Employee list and employee details
- Payroll periods and payroll processing screen
- Daily attendance log, attendance requests, and attendance summary
- Leave status, leave requests, and leave calendar
- Administration pages for roles, departments, shifts, holidays, and announcements
- Settings pages for general company details, payroll, leave, and attendance

### Employee Portal

- Employee dashboard
- Payslip page
- Attendance page
- Profile page
- Self-service routes for personal attendance, payroll records, leave requests, and leave balance are present in the backend

### Backend API Modules

- Authentication: login, logout, current user, refresh token, password change
- Employees: list, create, view, update, deactivate, employee self-profile
- Payroll: periods, records, employee payroll records, tax computation, batch processing, approval
- Attendance: employee clock in/out, logs, manual attendance records, summary, request review
- Leave: leave types, leave requests, leave balance, leave calendar, request approval/cancellation

## Application Workflow

1. A user signs in through the frontend login page.
2. The backend validates the email/password pair, returns access and refresh tokens, and stores a refresh token hash.
3. The frontend persists the authenticated user and token state with Zustand.
4. Users are routed by role:
   - Admin users go to `/admin/dashboard`.
   - Employee users go to `/employee/dashboard`.
5. Admin users manage employees, attendance, leave, payroll periods, and payroll approvals.
6. Employee users view personal payroll, attendance, and profile information.
7. Payroll processing computes earnings, deductions, employer contributions, and net pay from employee salary and attendance data.

## Database Overview

The PostgreSQL schema is located at:

```text
server/src/db/schema.sql
```

Main tables include:

| Area | Tables |
| --- | --- |
| Organization | `departments`, `positions`, `work_shifts` |
| People and access | `employees`, `users` |
| Payroll | `payroll_periods`, `payroll_records`, `loans` |
| Attendance | `attendance`, `attendance_requests` |
| Leave | `leave_types`, `leave_requests` |
| Administration | `announcements`, `holidays`, `system_settings`, `audit_logs` |

Seed data included in the schema:

- Default leave types
- Default work shifts
- Default system settings

## Prerequisites

Install the following before running the system:

- Node.js 20 or later
- npm
- PostgreSQL 14 or later
- Git

## Setup Guide

### 1. Clone the repository

```bash
git clone <repository-url>
cd iBayadPayrollManagementSystem
```

### 2. Install frontend dependencies

```bash
cd client
npm ci
```

### 3. Install backend dependencies

```bash
cd ../server
npm ci
```

### 4. Configure backend environment variables

From the `server` directory:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Update `server/.env` with your local PostgreSQL credentials:

```env
NODE_ENV=development
PORT=3001

DB_HOST=localhost
DB_PORT=5432
DB_NAME=ibayad_payroll
DB_USER=postgres
DB_PASSWORD=your_db_password_here

JWT_SECRET=replace_with_a_long_random_secret
JWT_REFRESH_SECRET=replace_with_a_different_long_random_secret
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

CLIENT_URL=http://localhost:5173
```

### 5. Create the database

Create the database:

```bash
createdb ibayad_payroll
```

If your PostgreSQL user requires a username:

```bash
createdb -U postgres ibayad_payroll
```

### 6. Apply the schema

From the repository root:

```bash
psql -U postgres -d ibayad_payroll -f server/src/db/schema.sql
```

### 7. Seed demo/test accounts

The repository includes a seed file with one account per supported role:

```bash
psql -U postgres -d ibayad_payroll -f server/src/db/seed-test-accounts.sql
```

Demo password for every account:

```text
Ibayad123!
```

Demo accounts:

| Role | Email |
| --- | --- |
| Admin | `admin@ibayad.test` |
| Employee | `employee@ibayad.test` |

Change these passwords immediately for any shared or deployed environment.

### 8. Seed the full-month demo employee

For presentations, you can add a dedicated fake employee account with a complete April 2026 attendance month and a released payroll record:

```bash
cd server
npm run seed:demo-employee
```

Demo employee credentials:

| Role | Email | Password |
| --- | --- | --- |
| Employee | `employee.demo@example.com` | `DemoEmployee@2026` |

This seed creates `EMP-DEMO-2026-001` / `Mikaela Demo Reyes` with:

- 30 April 2026 attendance rows
- Working days, rest days, late records, undertime, overtime, and one absence
- A released `Demo April 2026 Full Month` payroll period and payslip-ready payroll record
- Fake-only employee, government ID, bank, address, phone, and email data

The seed is idempotent. Rerunning `npm run seed:demo-employee` resets only this demo employee, their attendance, payroll, offset, loan, leave, and account records, then recreates the clean demo state.

## Running the Application

Open two terminals.

### Terminal 1: start the backend

```bash
cd server
npm run dev
```

The API runs on:

```text
http://localhost:3001
```

Health check:

```text
http://localhost:3001/api/health
```

### Terminal 2: start the frontend

```bash
cd client
npm run dev
```

The frontend runs on:

```text
http://localhost:5173
```

During local development, Vite proxies `/api` requests to `http://localhost:3001`.

## Backend Deployment on Render

For the backend web service, set the Render root directory to `server`.

Build command:

```bash
npm install && npm run build
```

Start command:

```bash
npm start
```

Recommended Render environment variables:

```env
NODE_ENV=production
NODE_VERSION=22
REQUIRE_SMTP_READY=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

Also set the production database, JWT, CORS/client URL, and SMTP credential variables in Render. Keep `REQUIRE_SMTP_READY=false` unless deployment should fail when SMTP is unreachable; email routes will still return a clear error if SMTP cannot send.

## Useful Scripts

### Frontend

```bash
cd client
npm run dev       # Start Vite dev server
npm run build     # Type-check and build frontend
npm run preview   # Preview production build
npm run lint      # Run ESLint
```

### Backend

```bash
cd server
npm run dev       # Start Express API with ts-node-dev
npm run build     # Compile TypeScript to dist/
npm run start     # Run compiled API from dist/
npm run lint      # Run ESLint against server source
```

## API Route Summary

| Module | Routes |
| --- | --- |
| Auth | `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`, `PUT /api/auth/change-password` |
| Employees | `GET /api/employees/me`, `GET /api/employees`, `POST /api/employees`, `GET /api/employees/:id`, `PUT /api/employees/:id`, `DELETE /api/employees/:id` |
| Payroll | `GET /api/payroll/my-records`, `GET /api/payroll/compute-tax`, `GET /api/payroll/periods`, `POST /api/payroll/periods`, `GET /api/payroll/periods/:id`, `GET /api/payroll/records`, `POST /api/payroll/process`, `POST /api/payroll/periods/:id/approve` |
| Attendance | `GET /api/attendance/my-logs`, `POST /api/attendance/clock-in`, `POST /api/attendance/clock-out`, `GET /api/attendance`, `POST /api/attendance`, `GET /api/attendance/summary`, `GET /api/attendance/requests`, `PUT /api/attendance/requests/:id` |
| Leave | `GET /api/leave/types`, `GET /api/leave/calendar`, `GET /api/leave/my-requests`, `GET /api/leave/balance/:employeeId?`, `POST /api/leave/requests`, `PUT /api/leave/requests/:id/cancel`, `GET /api/leave/requests`, `PUT /api/leave/requests/:id/review` |

## Known Gaps and Risks

- Frontend API contracts need alignment with backend responses. For example, auth responses are returned under `data`, but `useAuth` expects `response.user` and `response.tokens`.
- Several service methods call routes that do not exist yet, such as some payroll, leave, attendance, and employee activate/deactivate paths.
- Some backend models appear to reference older table names or column names, such as `leave_applications`, `leave_balances`, and `shifts`, while the schema uses `leave_requests`, computed leave balances, and `work_shifts`.
- Payroll batch processing uses simplified working-day logic and appears to reference a `loans.amount` field that is not present in the schema.
- Attendance clock-in/clock-out uses hardcoded 8:00 AM and 5:00 PM schedules instead of employee shift data.
- Tokens are stored in local storage, which is convenient for development but increases exposure if XSS vulnerabilities are introduced.
- Audit logging is modeled in the database but not consistently written by controllers yet.

## Build Verification

After installing dependencies with `npm ci` in both subprojects, the current build results are:

```text
client: npm run build passes.
server: npm run build passes.
```

Audit note:

- The frontend `npm audit` report still shows moderate advisories through `vite`/`esbuild`. The suggested fix requires `npm audit fix --force` and upgrades Vite with breaking changes, so test carefully before applying it.

## Recommendations

### Architecture

- Treat the API contract as a shared boundary. Add shared DTO types or an OpenAPI specification so frontend services and Express routes cannot drift silently.
- Consolidate duplicate payroll/tax computation logic. The client and server both contain payroll and tax utilities; the server should be the source of truth for payroll computation.
- Align model classes with the current database schema or remove unused legacy models to reduce confusion.
- Consider adding a root workspace configuration so `npm install`, `npm run dev`, and `npm run build` can orchestrate both subprojects from the repository root.

### Functionality

- Replace mock frontend data with real service calls module by module.
- Add complete CRUD APIs for departments, positions, shifts, holidays, announcements, roles, and settings.
- Add payslip generation/export once payroll records are stable.
- Add a real attendance correction submission route for employees, not only admin review.
- Add payroll period lifecycle rules: draft, processing, approved, released/paid, and cancelled.

### Security

- Store JWT refresh tokens in secure, HTTP-only cookies for production instead of local storage.
- Add rate limiting and account lockout protection for login attempts.
- Validate all request bodies with a consistent schema validation layer, such as Zod or express-validator.
- Add role and permission checks per action, especially for payroll approval and employee compensation updates.
- Enforce strong production secrets and never use sample JWT secrets outside local development.
- Write audit log entries for sensitive actions such as payroll processing, approval, employee updates, and settings changes.

### Performance

- Add pagination to large attendance, leave, payroll, and employee queries consistently.
- Add database indexes around common filters such as status, pay date, employee, and period.
- Avoid computing payroll synchronously for very large employee batches; consider a background job queue.
- Cache stable reference data such as leave types, holidays, and settings.

### Maintainability

- Add automated tests for payroll computation, tax computation, auth, and role access.
- Add integration tests for the main API workflows.
- Add lint configuration files or update scripts so lint commands run consistently.
- Keep frontend and backend dependencies current, especially build tooling such as Vite and esbuild.
- Normalize naming conventions between database snake_case and frontend camelCase with explicit mappers.
- Keep environment examples up to date and add a small troubleshooting section when setup changes.

### User Experience

- Show loading, empty, and error states on every data-driven page.
- Add confirmation dialogs for destructive actions such as deactivation and payroll approval.
- Add form validation and success/error feedback across settings, employee, leave, attendance, and payroll pages.
- Add responsive behavior for the fixed-width sidebars on smaller screens.
- Improve admin onboarding by seeding or documenting the first-user creation process in a repeatable script.
