import { useEffect, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import Card from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { EmptyState, FeedbackMessage, PageHeader } from '../../components/ui/Page'
import { formatDate } from '../../utils/dateHelpers'
import { formatPeso } from '../../utils/taxComputation'
import { payrollService } from '../../services/payrollService'
import type { PayrollRecord } from '../../types'

function offsetHours(minutes: number) {
  const hours = (minutes || 0) / 60
  return `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`
}

export default function PayslipPage() {
  const [payslips, setPayslips] = useState<PayrollRecord[]>([])
  const [selectedPayslip, setSelectedPayslip] = useState<PayrollRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const loadPayslips = async () => {
      try {
        setIsLoading(true)
        setMessage(null)
        const res = await payrollService.getMyPayslips()
        setPayslips(res.data)
        setSelectedPayslip(res.data[0] ?? null)
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Unable to load payslips.')
      } finally {
        setIsLoading(false)
      }
    }

    loadPayslips()
  }, [])

  const downloadPayslip = async () => {
    if (!selectedPayslip) return
    try {
      const res = await payrollService.generatePayslip(selectedPayslip.id)
      if (!res.ok) throw new Error('Unable to download payslip.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `payslip-${selectedPayslip.id}.txt`
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to download payslip.')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="My Payslips"
        subtitle="View and download your payslip history."
      />

      {message && (
        <FeedbackMessage variant={message.toLowerCase().includes('unable') ? 'danger' : 'info'}>
          {message}
        </FeedbackMessage>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* List */}
        <div className="space-y-2">
          {isLoading && <div className="rounded-lg border border-border bg-white px-4 py-3 text-sm text-muted">Loading payslips...</div>}
          {!isLoading && payslips.length === 0 && <EmptyState title="No payslips available yet." />}
          {payslips.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedPayslip(p)}
              className={[
                'w-full rounded-lg border px-4 py-3.5 text-left transition-all',
                selectedPayslip?.id === p.id
                  ? 'border-brand bg-brand-50'
                  : 'border-border bg-white hover:bg-neutral-20',
              ].join(' ')}
            >
              <div className="flex items-center justify-between mb-1">
                <p className={`text-sm font-medium ${selectedPayslip?.id === p.id ? 'text-brand' : 'text-ink'}`}>
                  {formatPeso(p.netPay)}
                </p>
                <Badge variant={p.status === 'released' ? 'success' : 'warning'} size="sm">{p.status}</Badge>
              </div>
              <p className="text-xs text-muted">{p.payrollPeriod?.name ?? 'Payroll period'}</p>
              <p className="text-xs text-muted">Pay date: {formatDate(p.payrollPeriod?.payDate ?? p.processedAt ?? p.createdAt)}</p>
            </button>
          ))}
        </div>

        {/* Detail */}
        {selectedPayslip && (
          <div className="lg:col-span-2">
            <Card>
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2.5">
                  <FileText size={18} className="text-muted" />
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Payslip - {selectedPayslip.payrollPeriod?.name ?? 'Payroll period'}</h3>
                    <p className="text-xs text-muted">Pay Date: {formatDate(selectedPayslip.payrollPeriod?.payDate ?? selectedPayslip.createdAt)}</p>
                  </div>
                </div>
                <Button size="sm" variant="outline" leftIcon={<Download size={14} />} onClick={downloadPayslip}>
                  Download Payslip
                </Button>
              </div>

              {/* Earnings */}
              <div className="mb-5">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Earnings</p>
                <div className="space-y-2">
                  {[
                    { label: 'Basic Pay', value: selectedPayslip.basicPay },
                    { label: 'Overtime Pay', value: selectedPayslip.overtimePay },
                    { label: 'Holiday Pay', value: selectedPayslip.holidayPay },
                    { label: 'Allowances', value: selectedPayslip.allowances },
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
                      <span className="text-muted">{row.label}</span>
                      <span className="text-ink font-medium">{formatPeso(row.value)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-semibold pt-2">
                    <span className="text-ink">Gross Pay</span>
                    <span className="text-ink">{formatPeso(selectedPayslip.grossPay)}</span>
                  </div>
                </div>
              </div>

              <div className="mb-5">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Time Offset</p>
                <div className="space-y-2">
                  {[
                    { label: 'Offset Earned', value: offsetHours(selectedPayslip.offsetEarnedMinutes) },
                    { label: 'Offset Used', value: offsetHours(selectedPayslip.offsetUsedMinutes) },
                    { label: 'Offset Balance', value: offsetHours(selectedPayslip.offsetBalanceMinutes) },
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
                      <span className="text-muted">{row.label}</span>
                      <span className="text-ink font-medium">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Deductions */}
              <div className="mb-5">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Deductions</p>
                <div className="space-y-2">
                  {[
                    { label: 'SSS Employee Share', value: selectedPayslip.contributions.sss },
                    { label: 'PhilHealth Employee Share', value: selectedPayslip.contributions.philhealth },
                    { label: 'Pag-IBIG Employee Share', value: selectedPayslip.contributions.pagibig },
                    { label: 'Withholding Tax', value: selectedPayslip.withholdingTax },
                    { label: 'Late/Absence Deductions', value: selectedPayslip.lateDeduction + selectedPayslip.absenceDeduction },
                  ].map((row) => (
                    <div key={row.label} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
                      <span className="text-muted">{row.label}</span>
                      <span className="font-medium text-danger">-{formatPeso(row.value)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm font-semibold pt-2">
                    <span className="text-ink">Total Deductions</span>
                    <span className="text-danger">-{formatPeso(selectedPayslip.totalDeductions)}</span>
                  </div>
                </div>
              </div>

              {/* Net Pay */}
              <div className="flex items-center justify-between rounded-lg bg-brand-50 p-4">
                <span className="text-base font-bold text-ink">NET PAY</span>
                <span className="text-2xl font-bold text-brand">{formatPeso(selectedPayslip.netPay)}</span>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
