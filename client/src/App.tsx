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
import RolesPage from './pages/admin/administration/RolesPage'
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

function ProtectedAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (user?.role !== 'admin') {
    return <Navigate to="/employee/dashboard" replace />
  }
  return <>{children}</>
}

function ProtectedEmployeeRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
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
              ? <Navigate to={user?.role === 'employee' ? '/employee/dashboard' : '/admin/dashboard'} replace />
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
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboardPage />} />

          <Route path="employees" element={<EmployeeListPage />} />
          <Route path="employees/:id" element={<EmployeeDetailPage />} />

          <Route path="payroll" element={<PayrollPage />} />

          <Route path="attendance/daily" element={<DailyLogPage />} />
          <Route path="attendance/requests" element={<AttendanceRequestPage />} />
          <Route path="attendance/summary" element={<AttendanceSummaryPage />} />

          <Route path="leave/status" element={<LeaveStatusPage />} />
          <Route path="leave/requests" element={<Navigate to="/admin/leave/status" replace />} />
          <Route path="leave/calendar" element={<LeaveCalendarPage />} />

          <Route path="administration/roles" element={<RolesPage />} />
          <Route path="administration/departments" element={<DepartmentsPage />} />
          <Route path="administration/shifts" element={<ShiftsPage />} />
          <Route path="administration/holidays" element={<HolidaysPage />} />
          <Route path="administration/announcements" element={<AnnouncementsPage />} />

          <Route path="settings/general" element={<GeneralSettingsPage />} />
          <Route path="settings/payroll" element={<PayrollSettingsPage />} />
          <Route path="settings/leave" element={<LeaveSettingsPage />} />
          <Route path="settings/attendance" element={<AttendanceSettingsPage />} />
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
        <Route path="/" element={<Navigate to={isAuthenticated ? (user?.role === 'employee' ? '/employee/dashboard' : '/admin/dashboard') : '/login'} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
