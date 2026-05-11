import { api } from './api'
import type { PayrollPeriod, ApiResponse, PaginatedResponse, PayrollWarning } from '../types'
import { mapPayrollPeriod, mapPayrollRecord } from './mappers'

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

export const payrollService = {
  // Periods
  listPeriods: (params?: Record<string, string | number | boolean>) =>
    api.get<RawPaginated<RawRow>>('/payroll/periods', params)
      .then((res) => normalizePaginated(res, params, mapPayrollPeriod)),

  getPeriod: (id: string) =>
    api.get<ApiResponse<RawRow>>(`/payroll/periods/${id}`)
      .then((res) => ({ ...res, data: mapPayrollPeriod(res.data) })),

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

  processPayroll: (periodId: string) =>
    api.post<ApiResponse<{
      period: RawRow
      processed: number
      errors: Array<{ employeeId: string; error: string }>
      warnings: PayrollWarning[]
      warningCount: number
      message: string
    }>>('/payroll/process', { payrollPeriodId: periodId })
      .then((res) => ({
        ...res,
        data: {
          ...res.data,
          period: mapPayrollPeriod(res.data.period),
        },
      })),

  approvePayroll: (periodId: string) =>
    api.post<ApiResponse<RawRow>>(`/payroll/periods/${periodId}/approve`)
      .then((res) => ({ ...res, data: mapPayrollPeriod(res.data) })),

  markAsPaid: (periodId: string) =>
    api.post<ApiResponse<RawRow>>(`/payroll/periods/${periodId}/release`)
      .then((res) => ({ ...res, data: mapPayrollPeriod(res.data) })),

  generatePayslip: (recordId: string) =>
    api.raw(`/payroll/records/${recordId}/payslip`),

  getMyPayslips: (params?: Record<string, string | number | boolean>) =>
    api.get<RawPaginated<RawRow>>('/payroll/my-records', params)
      .then((res) => normalizePaginated(res, params, mapPayrollRecord)),
}
