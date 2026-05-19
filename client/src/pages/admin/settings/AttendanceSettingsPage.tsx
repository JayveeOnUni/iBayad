import { useForm } from 'react-hook-form'
import { Save } from 'lucide-react'
import Card from '../../../components/ui/Card'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'
import { useToast } from '../../../components/ui/Toast'

interface AttendanceSettingsForm {
  graceMinutes: number
  halfDayMinutes: number
  requireBiometrics: boolean
  allowMobileClockIn: boolean
  geofencingEnabled: boolean
  geofenceRadiusMeters: number
  offsetRequiresApproval: boolean
  minOffsetCreditMinutes: number
}

export default function AttendanceSettingsPage() {
  const { showToast } = useToast()
  const { register, handleSubmit } = useForm<AttendanceSettingsForm>({
    defaultValues: {
      graceMinutes: 5,
      halfDayMinutes: 240,
      requireBiometrics: false,
      allowMobileClockIn: true,
      geofencingEnabled: false,
      geofenceRadiusMeters: 100,
      offsetRequiresApproval: true,
      minOffsetCreditMinutes: 1,
    },
  })

  const onSubmit = (data: AttendanceSettingsForm) => {
    localStorage.setItem('ibayad-attendance-settings', JSON.stringify(data))
    showToast({
      variant: 'success',
      title: 'Attendance settings saved',
      description: 'Saved for this workstation.',
    })
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold text-ink">Attendance Settings</h2>
        <p className="text-sm text-muted mt-0.5">Configure attendance rules, grace periods, and time tracking</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <Card>
          <h3 className="text-sm font-semibold text-ink mb-5">Tardiness & Absence Rules</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Grace Period (minutes)"
              type="number"
              hint="Minutes before marking late"
              {...register('graceMinutes', { valueAsNumber: true })}
            />
            <Input
              label="Half Day Threshold (minutes)"
              type="number"
              hint="Hours worked to count as half day"
              {...register('halfDayMinutes', { valueAsNumber: true })}
            />
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-ink mb-5">Time Tracking</h3>
          <div className="space-y-4">
            {[
              { key: 'requireBiometrics' as const, label: 'Require Biometric Clock-In', desc: 'Employees must use fingerprint/face ID for attendance' },
              { key: 'allowMobileClockIn' as const, label: 'Allow Mobile Clock-In', desc: 'Employees can clock in via the mobile app' },
              { key: 'geofencingEnabled' as const, label: 'Enable Geofencing', desc: 'Restrict clock-in to within the office radius' },
            ].map((s) => (
              <div key={s.key} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium text-ink">{s.label}</p>
                  <p className="text-xs text-muted">{s.desc}</p>
                </div>
                <input type="checkbox" {...register(s.key)} className="w-5 h-5 accent-brand" />
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Input
              label="Geofence Radius (meters)"
              type="number"
              hint="Distance from office allowed for mobile clock-in"
              {...register('geofenceRadiusMeters', { valueAsNumber: true })}
            />
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-ink mb-5">Offset Credit Rules</h3>
          <div className="flex items-center justify-between py-3 border-b border-border mb-4">
            <div>
              <p className="text-sm font-medium text-ink">Offset Requires Approval</p>
              <p className="text-xs text-muted">Earned credits and usage requests need admin approval</p>
            </div>
            <input type="checkbox" {...register('offsetRequiresApproval')} className="w-5 h-5 accent-brand" />
          </div>
          <Input
            label="Minimum Offset Credit (minutes)"
            type="number"
            hint="Minimum excess minutes to create a pending offset credit"
            {...register('minOffsetCreditMinutes', { valueAsNumber: true })}
          />
        </Card>

        <div className="flex justify-end">
          <Button type="submit" leftIcon={<Save size={15} />}>Save Changes</Button>
        </div>
      </form>
    </div>
  )
}
