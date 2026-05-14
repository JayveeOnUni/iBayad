import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import {
  AlignLeft,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  CalendarDays,
  ClipboardList,
  Clock,
  Clock3,
  CreditCard,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Megaphone,
  Settings,
  Users,
  X,
} from 'lucide-react'
import Sidebar from '../components/layout/Sidebar'
import MainHeader from '../components/layout/MainHeader'
import type { NavItem } from '../components/layout/Sidebar'

const adminNav: NavItem[] = [
  { label: 'Dashboard', to: '/admin/dashboard', icon: <LayoutDashboard size={18} /> },
  {
    label: 'Job Desk',
    icon: <Briefcase size={18} />,
    children: [
      { label: 'Employees', to: '/admin/employees', icon: <Users size={15} /> },
      { label: 'Payroll', to: '/admin/payroll', icon: <CreditCard size={15} /> },
    ],
  },
  {
    label: 'Leave',
    icon: <AlignLeft size={18} />,
    children: [
      { label: 'Status', to: '/admin/leave/status', icon: <ClipboardList size={15} /> },
      { label: 'Calendar', to: '/admin/leave/calendar', icon: <CalendarDays size={15} /> },
    ],
  },
  {
    label: 'Attendance',
    icon: <Clock size={18} />,
    children: [
      { label: 'Daily Log', to: '/admin/attendance/daily', icon: <BookOpen size={15} /> },
      { label: 'Requests', to: '/admin/attendance/requests', icon: <FileText size={15} /> },
      { label: 'Summary', to: '/admin/attendance/summary', icon: <ClipboardList size={15} /> },
    ],
  },
  {
    label: 'Administration',
    icon: <FolderOpen size={18} />,
    children: [
      { label: 'Roles', to: '/admin/administration/roles', icon: <Users size={15} /> },
      { label: 'Departments', to: '/admin/administration/departments', icon: <Building2 size={15} /> },
      { label: 'Shifts', to: '/admin/administration/shifts', icon: <Clock3 size={15} /> },
      { label: 'Holidays', to: '/admin/administration/holidays', icon: <Calendar size={15} /> },
      { label: 'Announcements', to: '/admin/administration/announcements', icon: <Megaphone size={15} /> },
    ],
  },
  {
    label: 'Settings',
    icon: <Settings size={18} />,
    children: [
      { label: 'General', to: '/admin/settings/general' },
      { label: 'Payroll', to: '/admin/settings/payroll' },
      { label: 'Leave', to: '/admin/settings/leave' },
      { label: 'Attendance', to: '/admin/settings/attendance' },
    ],
  },
]

export default function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-surface">
      <MainHeader onMenuClick={() => setSidebarOpen(true)} />

      <div className="flex flex-1 overflow-hidden">
        <div className="hidden lg:block">
          <Sidebar items={adminNav} />
        </div>

        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close navigation"
            />
            <div className="absolute inset-y-0 left-0 bg-white shadow-2xl">
              <div className="flex h-14 items-center justify-end border-b border-border px-3">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="rounded-md p-2 text-muted hover:bg-neutral-20 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
                  aria-label="Close navigation"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="h-[calc(100%-3.5rem)]">
                <Sidebar items={adminNav} onNavigate={() => setSidebarOpen(false)} />
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-screen-2xl p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
