import pool from '../utils/db'
import type { Pool, PoolClient } from 'pg'

type Queryable = Pool | PoolClient

export class LeaveAuditService {
  static async record(params: {
    leaveRequestId: string
    action: string
    previousStatus?: string | null
    newStatus?: string | null
    remarks?: string | null
    userId?: string
    employeeId?: string
    role?: string
  }, db: Queryable = pool): Promise<void> {
    await db.query(
      `INSERT INTO leave_approval_history (
         leave_request_id, action_by_employee_id, action_by_user_id, action_role,
         previous_status, new_status, action, remarks
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.leaveRequestId,
        params.employeeId ?? null,
        params.userId ?? null,
        params.role ?? null,
        params.previousStatus ?? null,
        params.newStatus ?? null,
        params.action,
        params.remarks ?? null,
      ]
    )
  }

  static async recordEntityAudit(params: {
    userId?: string
    action: string
    entity: string
    entityId: string
    oldValues?: unknown
    newValues?: unknown
  }, db: Queryable = pool): Promise<void> {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_values, new_values)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.userId ?? null,
        params.action,
        params.entity,
        params.entityId,
        params.oldValues ? JSON.stringify(params.oldValues) : null,
        params.newValues ? JSON.stringify(params.newValues) : null,
      ]
    )
  }
}
