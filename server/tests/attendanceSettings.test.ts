import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import pool from '../src/utils/db'
import {
  calculateAttendanceMetrics,
} from '../src/services/attendanceOffsetService'
import {
  getAttendanceSettings,
  updateAttendanceSettings,
  type AttendanceSettings,
} from '../src/services/settingsService'

type QueryResult = { rows: unknown[]; rowCount?: number }

const originals = {
  poolQuery: pool.query.bind(pool),
  poolConnect: pool.connect.bind(pool),
}

function restoreAll() {
  ;(pool as unknown as { query: typeof originals.poolQuery }).query = originals.poolQuery
  ;(pool as unknown as { connect: typeof originals.poolConnect }).connect = originals.poolConnect
}

afterEach(restoreAll)

test('getAttendanceSettings seeds defaults and maps persisted values', async () => {
  const queries: string[] = []
  ;(pool as unknown as { query: (text: string, params?: unknown[]) => Promise<QueryResult> }).query = async (text, params) => {
    queries.push(text)

    if (text.includes('INSERT INTO system_settings')) {
      assert.deepEqual(params, [
        ['attendance_grace_minutes', 'attendance_half_day_minutes'],
        ['5', '240'],
        [
          'Grace period in minutes before counting tardiness',
          'Rendered minutes threshold below which attendance is classified as half day',
        ],
      ])
      return { rows: [] }
    }

    if (text.includes('SELECT key, value')) {
      return {
        rows: [
          { key: 'attendance_grace_minutes', value: 12 },
          { key: 'attendance_half_day_minutes', value: 275 },
        ],
      }
    }

    throw new Error(`Unexpected query: ${text}`)
  }

  const settings = await getAttendanceSettings()

  assert.deepEqual(settings, {
    graceMinutes: 12,
    halfDayMinutes: 275,
  })
  assert.equal(queries.length, 2)
})

test('updateAttendanceSettings persists both fields and returns refreshed values', async () => {
  const writes: Array<{ text: string; params?: unknown[] }> = []
  const client = {
    query: async (text: string, params?: unknown[]) => {
      writes.push({ text, params })
      return { rows: [] }
    },
    release: () => undefined,
  }

  ;(pool as unknown as { connect: () => Promise<unknown> }).connect = async () => client
  ;(pool as unknown as { query: (text: string, params?: unknown[]) => Promise<QueryResult> }).query = async (text) => {
    if (text.includes('INSERT INTO system_settings')) return { rows: [] }
    if (text.includes('SELECT key, value')) {
      return {
        rows: [
          { key: 'attendance_grace_minutes', value: 8 },
          { key: 'attendance_half_day_minutes', value: 300 },
        ],
      }
    }

    throw new Error(`Unexpected query: ${text}`)
  }

  const input: AttendanceSettings = { graceMinutes: 8, halfDayMinutes: 300 }
  const result = await updateAttendanceSettings(input, '11111111-1111-1111-8111-111111111111')

  assert.deepEqual(result, input)
  assert.equal(writes[0]?.text, 'BEGIN')
  assert.equal(writes[3]?.text, 'COMMIT')
  assert.deepEqual(
    writes
      .filter((entry) => entry.text.includes('INSERT INTO system_settings'))
      .map((entry) => entry.params?.[0]),
    ['attendance_grace_minutes', 'attendance_half_day_minutes']
  )
})

test('calculateAttendanceMetrics applies grace minutes before counting lateness', () => {
  const metrics = calculateAttendanceMetrics({
    attendanceDate: '2026-05-19',
    timeIn: '2026-05-19T08:07:00',
    timeOut: '2026-05-19T17:00:00',
    shift: {
      name: 'Regular Shift',
      start_time: '08:00:00',
      end_time: '17:00:00',
      break_minutes: 60,
      work_hours: 8,
    },
    policy: {
      graceMinutes: 5,
      halfDayMinutes: 240,
    },
  })

  assert.equal(metrics.lateMinutes, 2)
  assert.equal(metrics.status, 'late')
})

test('calculateAttendanceMetrics applies configured half-day threshold', () => {
  const metrics = calculateAttendanceMetrics({
    attendanceDate: '2026-05-19',
    timeIn: '2026-05-19T08:00:00',
    timeOut: '2026-05-19T12:00:00',
    shift: {
      name: 'Regular Shift',
      start_time: '08:00:00',
      end_time: '17:00:00',
      break_minutes: 0,
      work_hours: 8,
    },
    policy: {
      graceMinutes: 0,
      halfDayMinutes: 300,
    },
  })

  assert.equal(metrics.actualRenderedMinutes, 240)
  assert.equal(metrics.status, 'half_day')
})
