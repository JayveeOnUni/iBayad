import { api } from './api'
import type {
  PayrollCalculationSnapshot,
  PayrollPeriod,
  ApiResponse,
  PaginatedResponse,
  PayrollReport,
  PayrollReportType,
  PayrollValidationReport,
  PayrollWarning,
  PayslipDetail,
} from '../types'
import { mapPayrollCalculationSnapshot, mapPayrollPeriod, mapPayrollRecord, mapPayrollValidationReport } from './mappers'

export interface PayrollListParams {
  page?: number
  limit?: number
  periodId?: string
  employeeId?: string
  status?: string
  year?: string | number
  search?: string
}

type RawRow = Record<string, unknown>
type RawPaginated<T> = ApiResponse<T[]> & Partial<Pick<PaginatedResponse<T>, 'total' | 'page' | 'limit' | 'totalPages'>>

function normalizePaginated<T>(
  res: RawPaginated<RawRow>,
  params: Record<string, string | number | boolean | undefined> | undefined,
  mapper: (row: RawRow) => T
) {
  const limit = Number(res.limit ?? params?.limit ?? res.data.length)
  const total = Number(res.total ?? res.data.length)
  return {
    success: res.success,
    data: res.data.map(mapper),
    total,
    page: Number(res.page ?? params?.page ?? 1),
    limit,
    totalPages: Number(res.totalPages ?? Math.max(1, Math.ceil(total / Math.max(1, limit)))),
  }
}

function queryString(params?: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams()
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const payrollService = {
  // Periods
  listPeriods: (params?: Record<string, string | number | boolean>) =>
    api.get<RawPaginated<RawRow>>('/payroll/periods', params)
      .then((res) => normalizePaginated(res, params, mapPayrollPeriod)),

  getPeriod: (id: string) =>
    api.get<ApiResponse<RawRow>>(`/payroll/periods/${id}`)
      .then((res) => ({ ...res, data: mapPayrollPeriod(res.data) })),

  validatePeriod: (id: string) =>
    api.post<ApiResponse<RawRow>>(`/payroll/periods/${id}/validation`)
      .then((res) => ({ ...res, data: mapPayrollValidationReport(res.data) as PayrollValidationReport })),

  getValidation: (id: string) =>
    api.get<ApiResponse<RawRow>>(`/payroll/periods/${id}/validation`)
      .then((res) => ({ ...res, data: mapPayrollValidationReport(res.data) as PayrollValidationReport })),

  createPeriod: (data: Partial<PayrollPeriod>) =>
    api.post<ApiResponse<RawRow>>('/payroll/periods', {
      name: data.name,
      startDate: data.startDate,
      endDate: data.endDate,
      payDate: data.payDate,
      payFrequency: data.frequency,
    }).then((res) => ({ ...res, data: mapPayrollPeriod(res.data) })),

  updatePeriod: (id: string, data: Partial<PayrollPeriod>) =>
    api.put<ApiResponse<PayrollPeriod>>(`/payroll/periods/${id}`, data),

  // Records
  listRecords: (params?: PayrollListParams) =>
    api.get<RawPaginated<RawRow>>('/payroll/records', params as Record<string, string | number | boolean>)
      .then((res) => normalizePaginated(res, params as Record<string, string | number | boolean>, mapPayrollRecord)),

  getRecord: (id: string) =>
    api.get<ApiResponse<RawRow>>(`/payroll/records/${id}`)
      .then((res) => ({ ...res, data: mapPayrollRecord(res.data) })),

  getRecordBreakdown: (id: string) =>
    api.get<ApiResponse<RawRow>>(`/payroll/records/${id}/breakdown`),

  voidRecord: (id: string, reason: string) =>
    api.post<ApiResponse<RawRow>>(`/payroll/records/${id}/void`, { reason })
      .then((res) => ({ ...res, data: mapPayrollRecord(res.data) })),

  listStatutoryRules: () =>
    api.get<ApiResponse<RawRow[]>>('/payroll/statutory-rules'),

  processPayroll: (periodId: string, reason?: string) =>
    api.post<ApiResponse<{
      period: RawRow
      processed: number
      errors: Array<{ employeeId: string; error: string }>
      warnings: PayrollWarning[]
      warningCount: number
      message: string
    }>>(`/payroll/periods/${periodId}/process`, { reason })
      .then((res) => ({
        ...res,
        data: {
          ...res.data,
          period: mapPayrollPeriod(res.data.period),
        },
      })),

  approvePayroll: (periodId: string, approvalNotes?: string) =>
    api.post<ApiResponse<RawRow>>(`/payroll/periods/${periodId}/approve`, { approvalNotes })
      .then((res) => ({ ...res, data: mapPayrollPeriod(res.data) })),

  requestCorrection: (periodId: string, correctionNotes: string) =>
    api.post<ApiResponse<RawRow>>(`/payroll/periods/${periodId}/request-correction`, { correctionNotes })
      .then((res) => ({ ...res, data: mapPayrollPeriod(res.data) })),

  markAsPaid: (periodId: string, releaseNotes?: string) =>
    api.post<ApiResponse<RawRow>>(`/payroll/periods/${periodId}/release`, { releaseNotes })
      .then((res) => ({ ...res, data: mapPayrollPeriod(res.data) })),

  listPeriodAuditLogs: (periodId: string, params?: Record<string, string | number | boolean>) =>
    api.get<ApiResponse<RawRow[]>>(`/payroll/periods/${periodId}/audit-logs`, params),

  listRecordSnapshots: (recordId: string) =>
    api.get<ApiResponse<RawRow[]>>(`/payroll/records/${recordId}/snapshots`)
      .then((res) => ({ ...res, data: res.data.map(mapPayrollCalculationSnapshot) as PayrollCalculationSnapshot[] })),

  generatePayslip: (recordId: string) =>
    api.raw(`/payroll/records/${recordId}/payslip/pdf`),

  getPayslip: (recordId: string) =>
    api.get<ApiResponse<PayslipDetail>>(`/payroll/records/${recordId}/payslip`),

  downloadPayslipPdf: (recordId: string, self = false) =>
    api.raw(self ? `/payroll/my-records/${recordId}/pdf` : `/payroll/records/${recordId}/payslip/pdf`),

  getPayrollReport: (periodId: string, reportType: PayrollReportType, params?: Record<string, string | number | boolean>) =>
    api.get<ApiResponse<PayrollReport>>(`/payroll/periods/${periodId}/reports/${reportType}`, params),

  exportPayrollReport: (periodId: string, reportType: PayrollReportType, params?: Record<string, string | number | boolean>) =>
    api.raw(`/payroll/periods/${periodId}/reports/export${queryString({ ...params, type: reportType, format: 'csv' })}`),

  computeTax: (monthlyBasicSalary: number) =>
    api.get<ApiResponse<RawRow>>('/payroll/compute-tax', { monthlyBasicSalary }),

  getMyPayslips: (params?: Record<string, string | number | boolean>) =>
    api.get<RawPaginated<RawRow>>('/payroll/my-records', params)
      .then((res) => normalizePaginated(res, params, mapPayrollRecord)),

  getMyPayslip: (recordId: string) =>
    api.get<ApiResponse<PayslipDetail>>(`/payroll/my-records/${recordId}`),
}
