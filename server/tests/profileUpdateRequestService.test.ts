import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  approveProfileUpdateRequest,
  createProfileUpdateRequest,
  listMyProfileUpdateRequests,
  rejectProfileUpdateRequest,
} from '../src/services/profileUpdateRequestService'
import pool from '../src/utils/db'

type QueryCall = { text: string; params?: unknown[] }
type QueryResult = { rows: unknown[]; rowCount?: number }
type QueryFn = (text: string, params?: unknown[]) => Promise<QueryResult>

const employeeId = '11111111-1111-4111-8111-111111111111'
const reviewerUserId = '22222222-2222-4222-8222-222222222222'

const originals = {
  poolQuery: pool.query.bind(pool),
  poolConnect: pool.connect.bind(pool),
}

function employee(overrides: Record<string, unknown> = {}) {
  return {
    id: employeeId,
    first_name: 'Ada',
    middle_name: null,
    last_name: 'Lovelace',
    email: 'ada@example.com',
    phone: '09171234567',
    birth_date: '1990-01-01',
    gender: 'female',
    civil_status: 'single',
    address: '123 Rizal Street',
    city: 'Makati',
    province: 'Metro Manila',
    zip_code: '1200',
    ...overrides,
  }
}

function restoreMocks() {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  ;(pool as unknown as { connect: typeof originals.poolConnect }).connect = originals.poolConnect
}

afterEach(restoreMocks)

test('profile update request rejects no actual changes', async () => {
  ;(pool as unknown as { query: QueryFn }).query = async (text: string): Promise<QueryResult> => {
    if (text.includes('FROM employees') && text.includes('WHERE id = $1')) {
      return { rows: [employee()] }
    }
    throw new Error(`Unexpected query: ${text}`)
  }

  await assert.rejects(
    () => createProfileUpdateRequest(employeeId, { firstName: 'Ada', city: 'Makati' }),
    /No actual profile changes/
  )
})

test('profile update request rejects unknown fields', async () => {
  await assert.rejects(
    () => createProfileUpdateRequest(employeeId, { firstName: 'Ada', basicSalary: '100000' }),
    /Unknown profile update field/
  )
})

test('employee request listing is scoped to the logged-in employee', async () => {
  const calls: QueryCall[] = []
  ;(pool as unknown as { query: QueryFn }).query = async (text: string, params?: unknown[]): Promise<QueryResult> => {
    calls.push({ text, params })
    return { rows: [{ id: 'request-1', employee_id: employeeId, requested_changes: {}, status: 'pending' }] }
  }

  const rows = await listMyProfileUpdateRequests(employeeId)

  assert.equal(rows.length, 1)
  assert.deepEqual(calls[0].params, [employeeId])
  assert.match(calls[0].text, /WHERE employee_id = \$1/)
})

test('approving a profile update applies changes and marks the request approved', async () => {
  const calls: QueryCall[] = []
  const request = {
    id: 'request-1',
    employee_id: employeeId,
    status: 'pending',
    requested_changes: {
      phone: { field: 'phone', label: 'Phone Number', current: '09171234567', requested: '09999999999' },
      city: { field: 'city', label: 'City', current: 'Makati', requested: 'Pasig' },
    },
  }

  const client = {
    query: async (text: string, params?: unknown[]): Promise<QueryResult> => {
      calls.push({ text, params })
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] }
      if (text.includes('FROM profile_update_requests') && text.includes('FOR UPDATE')) return { rows: [request] }
      if (text.includes('UPDATE employees')) return { rows: [{ id: employeeId }] }
      if (text.includes('UPDATE profile_update_requests')) {
        return { rows: [{ ...request, status: 'approved', reviewed_by: reviewerUserId }] }
      }
      throw new Error(`Unexpected query: ${text}`)
    },
    release: () => undefined,
  }

  ;(pool as unknown as { connect: () => Promise<typeof client> }).connect = async () => client

  const approved = await approveProfileUpdateRequest('request-1', reviewerUserId)
  const employeeUpdate = calls.find((call) => call.text.includes('UPDATE employees'))
  const requestUpdate = calls.find((call) => call.text.includes('UPDATE profile_update_requests'))

  assert.equal(approved.status, 'approved')
  assert.match(employeeUpdate?.text ?? '', /phone = \$2, city = \$3/)
  assert.deepEqual(employeeUpdate?.params, [employeeId, '09999999999', 'Pasig'])
  assert.deepEqual(requestUpdate?.params, ['request-1', reviewerUserId])
})

test('rejecting a profile update does not apply employee changes', async () => {
  const calls: QueryCall[] = []
  ;(pool as unknown as { query: QueryFn }).query = async (text: string, params?: unknown[]): Promise<QueryResult> => {
    calls.push({ text, params })
    if (text.includes('UPDATE profile_update_requests')) {
      return {
        rows: [{
          id: 'request-1',
          employee_id: employeeId,
          requested_changes: {
            city: { field: 'city', label: 'City', current: 'Makati', requested: 'Pasig' },
          },
          status: 'rejected',
          reviewed_by: reviewerUserId,
          review_remarks: 'Needs supporting document',
        }],
      }
    }
    throw new Error(`Unexpected query: ${text}`)
  }

  const rejected = await rejectProfileUpdateRequest('request-1', reviewerUserId, 'Needs supporting document')

  assert.equal(rejected.status, 'rejected')
  assert.equal(calls.some((call) => call.text.includes('UPDATE employees')), false)
  assert.deepEqual(calls[0].params, ['request-1', reviewerUserId, 'Needs supporting document'])
})
