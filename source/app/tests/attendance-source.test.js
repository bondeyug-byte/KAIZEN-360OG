// Audit 2026-10: one attendance calculation for every student view, demo and server.
import { describe, it, expect } from 'vitest'
import { summarize, studentSummary, rowsFromServer } from '../src/lib/attendance.js'

const now = new Date('2026-10-23T10:00:00+05:30') // Friday
// what GET my-record returns in attendance.history (api/_records.js recordFor)
const history = [
  { date: '2026-10-22', subject: 'Maths', start: '09:00', division: 'D2B', present: true },
  { date: '2026-10-22', subject: 'Physics', start: '10:00', division: 'D2B', present: false },
  { date: '2026-10-20', subject: 'Maths', start: '09:00', division: 'D2B', present: true },
  { date: '2026-09-30', subject: 'Maths', start: '09:00', division: 'D2A', present: false },
]
// the server's own totals for the same rows (same formula: round(1000·p/n)/10)
const serverPct = (rows) => Math.round((1000 * rows.filter((r) => r.present).length) / rows.length) / 10

describe('shared attendance calculation', () => {
  it('server rows → the same overall numbers the College and Parent portals show', () => {
    const s = summarize(rowsFromServer(history), now)
    expect(s.overall).toEqual({ present: 2, absent: 2, total: 4, pct: serverPct(history) })
    expect(s.overall.pct).toBe(50)
  })
  it('subject-wise, week, month and year filters come from the same rows', () => {
    const s = summarize(rowsFromServer(history), now)
    expect(s.bySubject.map((x) => [x.subject, x.present, x.total, x.pct])).toEqual([['Maths', 2, 3, 66.7], ['Physics', 0, 1, 0]])
    expect(s.week.total).toBe(3) // Mon 20 – Fri 23 Oct
    expect(s.month.total).toBe(3)
    expect(s.year.total).toBe(4)
    expect(s.rows[0].date).toBe('2026-10-22') // newest first
  })
  it('an earlier division’s lectures stay in the history (labelled with their division)', () => {
    const s = summarize(rowsFromServer(history), now)
    expect(s.rows.at(-1).division).toBe('D2A')
  })
  it('no rows → no percentage (nothing invented)', () => {
    const s = summarize([], now)
    expect(s.overall).toEqual({ present: 0, absent: 0, total: 0, pct: null })
  })
  it('demo sheets: cancelled lectures and students not on the sheet are not counted', () => {
    const state = { attSessions: [
      { id: 'a', status: 'recorded', date: '2026-10-22', start: '09:00', subject: 'Maths', records: { u1: 'P', u2: 'A' } },
      { id: 'b', status: 'cancelled', date: '2026-10-21', start: '09:00', subject: 'Maths', records: {} },
      { id: 'c', status: 'recorded', date: '2026-10-21', start: '10:00', subject: 'Maths', records: { u2: 'P' } },
    ] }
    expect(studentSummary(state, 'u1', now).overall).toEqual({ present: 1, absent: 0, total: 1, pct: 100 })
    expect(studentSummary(state, 'u2', now).overall).toEqual({ present: 1, absent: 1, total: 2, pct: 50 })
  })
})
