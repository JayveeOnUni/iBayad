import { useEffect, useMemo, useState } from 'react'
import { Download, Eye, FileText, Printer, Search } from 'lucide-react'
import Card, { CardHeader } from '../../components/ui/Card'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Input from '../../components/ui/Input'
import Select from '../../components/ui/Select'
import { EmptyState, FeedbackMessage, PageHeader } from '../../components/ui/Page'
import { formatDate, formatDateTime } from '../../utils/dateHelpers'
import { formatPeso } from '../../utils/taxComputation'
import { payrollService } from '../../services/payrollService'
import type { PayFrequency, PayrollRecord, PayslipDetail } from '../../types'

type Filters = {
  year: string
  month: string
  frequency: 'all' | PayFrequency
  search: string
}

const labelMap: Record<string, string> = {
  basicPay: 'Basic Pay',
  holidayPay: 'Holiday Pay',
  nightDifferential: 'Night Differential',
  paidLeaveAmount: 'Paid Leave Amount',
  allowances: 'Allowances',
  bonusesAndIncentives: 'Bonuses / Incentives',
  otherTaxableEarnings: 'Other Taxable Earnings',
  otherNonTaxableEarnings: 'Other Non-taxable Earnings',
  grossPay: 'Gross Pay',
  lateDeduction: 'Late Deduction',
  undertimeDeduction: 'Undertime Deduction',
  absenceDeduction: 'Absence Deduction',
  unpaidLeaveDeduction: 'Unpaid Leave Deduction',
  sssEmployee: 'SSS Employee Share',
  philHealthEmployee: 'PhilHealth Employee Share',
  pagIbigEmployee: 'Pag-IBIG Employee Share',
  withholdingTax: 'Withholding Tax',
  otherDeductions: 'Other Deductions',
  totalDeductions: 'Total Deductions',
  sssEmployer: 'SSS Employer Share',
  philHealthEmployer: 'PhilHealth Employer Share',
  pagIbigEmployer: 'Pag-IBIG Employer Share',
  otherEmployerPaidBenefits: 'Other Employer-paid Benefits',
  totalEmployerContributions: 'Total Employer Contributions',
  offsetEarnedMinutes: 'Offset Earned',
  offsetUsedMinutes: 'Offset Used',
  offsetBalanceMinutes: 'Remaining Offset',
}

function numberRows(values: Record<string, number>, emphasisKey?: string) {
  return Object.entries(values).filter(([key]) => key !== 'loanDeductions' && key !== 'overtimePay').map(([key, value]) => (
    <div key={key} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
      <span className={key === emphasisKey ? 'font-semibold text-ink' : 'text-muted'}>{labelMap[key] ?? key}</span>
      <span className={key === emphasisKey ? 'font-semibold text-ink' : 'font-medium text-ink'}>{formatPeso(value)}</span>
    </div>
  ))
}

function openBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function PayslipPage() {
  const [payslips, setPayslips] = useState<PayrollRecord[]>([])
  const [selectedRecord, setSelectedRecord] = useState<PayrollRecord | null>(null)
  const [detail, setDetail] = useState<PayslipDetail | null>(null)
  const [filters, setFilters] = useState<Filters>({ year: 'all', month: 'all', frequency: 'all', search: '' })
  const [isLoading, setIsLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const years = useMemo(() => {
    const current = new Date().getFullYear()
    const set = new Set([current, current - 1, current - 2])
    payslips.forEach((payslip) => {
      const year = Number((payslip.payrollPeriod?.payDate ?? payslip.createdAt).slice(0, 4))
      if (Number.isInteger(year)) set.add(year)
    })
    return Array.from(set).sort((a, b) => b - a)
  }, [payslips])

  useEffect(() => {
    const loadPayslips = async () => {
      try {
        setIsLoading(true)
        setMessage(null)
        const res = await payrollService.getMyPayslips({
          limit: 50,
          ...(filters.year !== 'all' ? { year: filters.year } : {}),
          ...(filters.month !== 'all' ? { month: filters.month } : {}),
          ...(filters.frequency !== 'all' ? { frequency: filters.frequency } : {}),
          ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
        })
        setPayslips(res.data)
        setSelectedRecord((current) => {
          const next = current ? res.data.find((item) => item.id === current.id) : undefined
          return next ?? res.data[0] ?? null
        })
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Unable to load payslips.')
      } finally {
        setIsLoading(false)
      }
    }

    loadPayslips()
  }, [filters])

  useEffect(() => {
    if (!selectedRecord) {
      setDetail(null)
      return
    }

    const loadDetail = async () => {
      try {
        setIsDetailLoading(true)
        const res = await payrollService.getMyPayslip(selectedRecord.id)
        setDetail(res.data)
      } catch (err) {
        setDetail(null)
        setMessage(err instanceof Error ? err.message : 'Unable to load payslip preview.')
      } finally {
        setIsDetailLoading(false)
      }
    }

    loadDetail()
  }, [selectedRecord])

  const downloadPdf = async (record = selectedRecord) => {
    if (!record) return
    try {
      const res = await payrollService.downloadPayslipPdf(record.id, true)
      if (!res.ok) throw new Error('Unable to download payslip PDF.')
      const blob = await res.blob()
      openBlobDownload(blob, `payslip-${record.payrollPeriod?.payDate ?? record.id}.pdf`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to download payslip PDF.')
    }
  }

  const printPayslip = () => {
    window.print()
  }

  return (
    <div className="space-y-5">
      <PageHeader title="My Payslips" subtitle="Released payroll records, printable previews, and PDF downloads." />

      {message && (
        <FeedbackMessage variant={message.toLowerCase().includes('unable') ? 'danger' : 'info'}>
          {message}
        </FeedbackMessage>
      )}

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Search"
            value={filters.search}
            leftAddon={<Search size={14} />}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            placeholder="Payroll period"
          />
          <Select label="Year" value={filters.year} onChange={(event) => setFilters((current) => ({ ...current, year: event.target.value }))}>
            <option value="all">All years</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </Select>
          <Select label="Month" value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))}>
            <option value="all">All months</option>
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index + 1} value={index + 1}>{new Date(2026, index, 1).toLocaleString('en-PH', { month: 'long' })}</option>
            ))}
          </Select>
          <Select label="Frequency" value={filters.frequency} onChange={(event) => setFilters((current) => ({ ...current, frequency: event.target.value as Filters['frequency'] }))}>
            <option value="all">All frequencies</option>
            <option value="weekly">Weekly</option>
            <option value="semi-monthly">Semi-monthly</option>
            <option value="monthly">Monthly</option>
          </Select>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        <div className="space-y-2">
          {isLoading && <div className="rounded-md border border-border bg-white px-4 py-3 text-sm text-muted">Loading payslips...</div>}
          {!isLoading && payslips.length === 0 && <EmptyState title="No released payslips found." description="Adjust the filters or check again after payroll release." />}
          {payslips.map((payslip) => (
            <div
              key={payslip.id}
              className={[
                'rounded-md border bg-white px-4 py-3 transition-colors',
                selectedRecord?.id === payslip.id ? 'border-brand bg-brand-50' : 'border-border',
              ].join(' ')}
            >
              <button type="button" className="w-full text-left" onClick={() => setSelectedRecord(payslip)}>
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{payslip.payrollPeriod?.name ?? 'Payroll period'}</p>
                    <p className="text-xs text-muted">{formatDate(payslip.payrollPeriod?.startDate ?? payslip.createdAt)} - {formatDate(payslip.payrollPeriod?.endDate ?? payslip.createdAt)}</p>
                  </div>
                  <Badge variant="success" size="sm">{payslip.status}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted">Gross</span><p className="font-semibold text-ink">{formatPeso(payslip.grossPay)}</p></div>
                  <div><span className="text-muted">Deductions</span><p className="font-semibold text-danger">{formatPeso(payslip.totalDeductions)}</p></div>
                  <div><span className="text-muted">Net</span><p className="font-semibold text-brand">{formatPeso(payslip.netPay)}</p></div>
                </div>
              </button>
              <div className="mt-3 flex gap-2">
                <Button size="xs" variant="outline" leftIcon={<Eye size={12} />} onClick={() => setSelectedRecord(payslip)}>View</Button>
                <Button size="xs" variant="ghost" leftIcon={<Download size={12} />} onClick={() => downloadPdf(payslip)}>PDF</Button>
              </div>
            </div>
          ))}
        </div>

        <div className="print:block">
          {!selectedRecord && !isLoading && (
            <EmptyState title="Select a payslip." icon={<FileText size={22} />} />
          )}
          {selectedRecord && (
            <Card className="print:shadow-none print:border-0">
              <div className="mb-5 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Payslip</p>
                  <h2 className="text-xl font-bold text-ink">{detail?.company.name ?? 'iBayad Payroll Management System'}</h2>
                  <p className="text-sm text-muted">{detail?.company.address || 'Company address not configured'}</p>
                  {detail?.company.contact && <p className="text-sm text-muted">{detail.company.contact}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-2 print:hidden">
                  <Button size="sm" variant="outline" leftIcon={<Printer size={14} />} onClick={printPayslip}>Print</Button>
                  <Button size="sm" leftIcon={<Download size={14} />} onClick={() => downloadPdf()}>Download PDF</Button>
                </div>
              </div>

              {isDetailLoading && <p className="text-sm text-muted">Loading payslip preview...</p>}
              {detail && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {[
                      ['Employee', detail.employee.name],
                      ['Employee ID', detail.employee.employeeNumber],
                      ['Department', detail.employee.department ?? 'Not assigned'],
                      ['Position', detail.employee.position ?? 'Not assigned'],
                      ['Employment Type', detail.employee.employmentType ?? 'Not recorded'],
                      ['Payroll Period', `${formatDate(detail.period.startDate)} - ${formatDate(detail.period.endDate)}`],
                      ['Frequency', detail.period.frequency],
                      ['Reference', detail.referenceNumber],
                      ['Generated', formatDateTime(detail.generatedAt)],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-md border border-border px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
                        <p className="mt-1 text-sm font-medium text-ink">{value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                    <CardHeader title="Earnings Breakdown" className="mb-0" />
                    <CardHeader title="Deductions Breakdown" className="mb-0" />
                    <div>{numberRows(detail.earnings, 'grossPay')}</div>
                    <div>{numberRows(detail.deductions, 'totalDeductions')}</div>
                  </div>

                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                    <div>
                      <p className="mb-3 text-sm font-semibold text-ink">Attendance and Leave Summary</p>
                      <div className="grid grid-cols-2 gap-2">
                        {Object.entries(detail.attendance).map(([key, value]) => (
                          <div key={key} className="rounded-md border border-border px-3 py-2">
                            <p className="text-xs text-muted">{key.replace(/([A-Z])/g, ' $1')}</p>
                            <p className="text-sm font-semibold text-ink">
                              {key.toLowerCase().includes('deduction') ? formatPeso(value) : value}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-3 text-sm font-semibold text-ink">Employer Contributions</p>
                      <div>{numberRows(detail.employerContributions, 'totalEmployerContributions')}</div>
                      <p className="mt-2 text-xs text-muted">Employer contributions are company-paid benefits and do not reduce employee net pay.</p>
                    </div>
                  </div>

                  <div className="rounded-md border border-brand bg-brand-50 px-4 py-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-ink">Net Pay</p>
                        <p className="text-xs text-muted">{String(detail.summary.amountInWords ?? '')}</p>
                      </div>
                      <p className="text-3xl font-bold text-brand">{formatPeso(Number(detail.summary.netPay ?? 0))}</p>
                    </div>
                  </div>

                  <div className="rounded-md border border-border px-4 py-3">
                    <p className="mb-3 text-sm font-semibold text-ink">Audit and System Metadata</p>
                    <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
                      {Object.entries(detail.metadata).map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
                          <span className="text-muted">{key.replace(/([A-Z])/g, ' $1')}</span>
                          <span className="text-right font-medium text-ink">{value == null ? 'Not recorded' : String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
