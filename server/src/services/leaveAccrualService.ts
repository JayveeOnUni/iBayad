import { LeaveCode, LeavePolicyService } from './leavePolicyService'

export class LeaveAccrualService {
  static async computeEmployeeCredits(employeeId: string, year: number, code: LeaveCode, asOf = new Date()): Promise<{
    earnedCredits: number
    entitlementStage: string
    annualEntitlement: number
    monthlyCredit: number
  }> {
    const employee = await LeavePolicyService.getEmployee(employeeId)
    if (!employee) throw new Error('Employee not found')
    const entitlement = await LeavePolicyService.configuredEntitlementFor(employee, year, code)
    return {
      earnedCredits: await LeavePolicyService.configuredEarnedCreditsFor(employee, year, code, asOf),
      entitlementStage: entitlement.stage,
      annualEntitlement: entitlement.annual,
      monthlyCredit: entitlement.monthly,
    }
  }
}
