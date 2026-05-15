import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'

// Layouts
import AdminLayout from './layouts/AdminLayout'
import EmployeeLayout from './layouts/EmployeeLayout'

// Auth
import LoginPage from './pages/auth/LoginPage'
import ActivateAccountPage from './pages/auth/ActivateAccountPage'

// Admin pages
import AdminDashboardPage from './pages/admin/DashboardPage'
import EmployeeListPage from './pages/admin/employees/EmployeeListPage'
import EmployeeDetailPage from './pages/admin/employees/EmployeeDetailPage'
import PayrollPage from './pages/admin/payroll/PayrollPage'
import DailyLogPage from './pages/admin/attendance/DailyLogPage'
import AttendanceRequestPage from './pages/admin/attendance/AttendanceRequestPage'
import AttendanceSummaryPage from './pages/admin/attendance/AttendanceSummaryPage'
import LeaveStatusPage from './pages/admin/leave/LeaveStatusPage'
import LeaveCalendarPage from './pages/admin/leave/LeaveCalendarPage'
import DepartmentsPage from './pages/admin/administration/DepartmentsPage'
import ShiftsPage from './pages/admin/administration/ShiftsPage'
import HolidaysPage from './pages/admin/administration/HolidaysPage'
import AnnouncementsPage from './pages/admin/administration/AnnouncementsPage'
import GeneralSettingsPage from './pages/admin/settings/GeneralSettingsPage'
import PayrollSettingsPage from './pages/admin/settings/PayrollSettingsPage'
import LeaveSettingsPage from './pages/admin/settings/LeaveSettingsPage'
import AttendanceSettingsPage from './pages/admin/settings/AttendanceSettingsPage'

// Employee pages
import EmployeeDashboardPage from './pages/employee/DashboardPage'
import PayslipPage from './pages/employee/PayslipPage'
import AttendancePage from './pages/employee/AttendancePage'
import EmployeeLeavePage from './pages/employee/LeavePage'
import ProfilePage from './pages/employee/ProfilePage'

const fullAdminRoles = new Set(['admin', 'super_admin'])
const adminWorkspaceRoles = new Set([
  'admin',
  'super_admin',
  'payroll_preparer',
  'payroll_approver',
  'payroll_releaser',
  'auditor',
])

function defaultPathForRole(role: string | undefined) {
  if (role === 'employee') return '/employee/dashboard'
  if (fullAdminRoles.has(role ?? '')) return '/admin/dashboard'
  if (adminWorkspaceRoles.has(role ?? '')) return '/admin/payroll'
  return '/login'
}

function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!adminWorkspaceRoles.has(user?.role ?? '')) {
    return <Navigate to={defaultPathForRole(user?.role)} replace />
  }
  return <>{children}</>
}

function ProtectedFullAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!fullAdminRoles.has(user?.role ?? '')) {
    return <Navigate to={defaultPathForRole(user?.role)} replace />
  }
  return <>{children}</>
}

function ProtectedEmployeeRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (user?.role !== 'employee') return <Navigate to={defaultPathForRole(user?.role)} replace />
  return <>{children}</>
}

export default function App() {
  const { isAuthenticated, user } = useAuthStore()

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route
          path="/login"
          element={
            isAuthenticated
              ? <Navigate to={defaultPathForRole(user?.role)} replace />
              : <LoginPage />
          }
        />
        <Route path="/account/activate" element={<ActivateAccountPage />} />

        {/* Admin routes */}
        <Route
          path="/admin"
          element={
            <ProtectedAdminRoute>
              <AdminLayout />
            </ProtectedAdminRoute>
          }
        >
          <Route index element={<Navigate to={defaultPathForRole(user?.role).replace('/admin/', '')} replace />} />
          <Route path="dashboard" element={<ProtectedFullAdminRoute><AdminDashboardPage /></ProtectedFullAdminRoute>} />

          <Route path="employees" element={<ProtectedFullAdminRoute><EmployeeListPage /></ProtectedFullAdminRoute>} />
          <Route path="employees/:id" element={<ProtectedFullAdminRoute><EmployeeDetailPage /></ProtectedFullAdminRoute>} />

          <Route path="payroll" element={<PayrollPage />} />

          <Route path="attendance/daily" element={<ProtectedFullAdminRoute><DailyLogPage /></ProtectedFullAdminRoute>} />
          <Route path="attendance/requests" element={<ProtectedFullAdminRoute><AttendanceRequestPage /></ProtectedFullAdminRoute>} />
          <Route path="attendance/summary" element={<ProtectedFullAdminRoute><AttendanceSummaryPage /></ProtectedFullAdminRoute>} />

          <Route path="leave/status" element={<ProtectedFullAdminRoute><LeaveStatusPage /></ProtectedFullAdminRoute>} />
          <Route path="leave/requests" element={<Navigate to="/admin/leave/status" replace />} />
          <Route path="leave/calendar" element={<ProtectedFullAdminRoute><LeaveCalendarPage /></ProtectedFullAdminRoute>} />

          <Route path="administration/departments" element={<ProtectedFullAdminRoute><DepartmentsPage /></ProtectedFullAdminRoute>} />
          <Route path="administration/shifts" element={<ProtectedFullAdminRoute><ShiftsPage /></ProtectedFullAdminRoute>} />
          <Route path="administration/holidays" element={<ProtectedFullAdminRoute><HolidaysPage /></ProtectedFullAdminRoute>} />
          <Route path="administration/announcements" element={<ProtectedFullAdminRoute><AnnouncementsPage /></ProtectedFullAdminRoute>} />

          <Route path="settings/general" element={<ProtectedFullAdminRoute><GeneralSettingsPage /></ProtectedFullAdminRoute>} />
          <Route path="settings/payroll" element={<ProtectedFullAdminRoute><PayrollSettingsPage /></ProtectedFullAdminRoute>} />
          <Route path="settings/leave" element={<ProtectedFullAdminRoute><LeaveSettingsPage /></ProtectedFullAdminRoute>} />
          <Route path="settings/attendance" element={<ProtectedFullAdminRoute><AttendanceSettingsPage /></ProtectedFullAdminRoute>} />
        </Route>

        {/* Employee routes */}
        <Route
          path="/employee"
          element={
            <ProtectedEmployeeRoute>
              <EmployeeLayout />
            </ProtectedEmployeeRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<EmployeeDashboardPage />} />
          <Route path="payslip" element={<PayslipPage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="leave" element={<EmployeeLeavePage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* Fallback */}
        <Route path="/" element={<Navigate to={isAuthenticated ? defaultPathForRole(user?.role) : '/login'} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
