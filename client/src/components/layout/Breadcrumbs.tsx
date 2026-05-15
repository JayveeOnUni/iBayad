import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'

const labelMap: Record<string, string> = {
  admin: 'Admin',
  employee: 'Employee',
  dashboard: 'Dashboard',
  employees: 'Employees',
  payroll: 'Payroll',
  attendance: 'Attendance',
  leave: 'Leave',
  administration: 'Administration',
  settings: 'Settings',
  daily: 'Daily Log',
  requests: 'Requests',
  summary: 'Summary',
  status: 'Status',
  calendar: 'Calendar',
  departments: 'Departments',
  shifts: 'Shifts',
  holidays: 'Holidays',
  announcements: 'Announcements',
  general: 'General',
  payslip: 'Payslip',
  profile: 'Profile',
}

export default function Breadcrumbs() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)

  return (
    <nav className="flex items-center gap-1 text-sm" aria-label="Breadcrumb">
      <Link to="/" className="text-muted hover:text-ink transition-colors">
        <Home size={14} />
      </Link>
      {segments.map((seg, index) => {
        const path = '/' + segments.slice(0, index + 1).join('/')
        const isLast = index === segments.length - 1
        const label = labelMap[seg] ?? seg

        return (
          <span key={path} className="flex items-center gap-1">
            <ChevronRight size={13} className="text-slate-300" />
            {isLast ? (
              <span className="font-medium text-ink">{label}</span>
            ) : (
              <Link to={path} className="text-muted hover:text-ink transition-colors">
                {label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
