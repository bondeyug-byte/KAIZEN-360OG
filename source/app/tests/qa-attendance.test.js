// QA phase F — attendance figures must equal eligible Present / eligible recorded × 100, from the raw records.
import { describe, it, expect } from 'vitest'
import { studentSummary, createSession, editSession } from '../src/lib/attendance.js'
import { makeSeed } from '../src/data/seed.js'

const now = new Date('2026-10-16T06:00:00Z') // Friday, 11:30 IST
const round1 = (x) => Math.round(x * 1000) / 10

function randomState(seed) {
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const subjects = ['Engineering Mathematics I', 'Python Programming', 'Engineering Physics']
  const sessions = []
  for (let i = 0; i < 60; i++) {
    const d = new Date(now.getTime() - Math.floor(rnd() * 400) * 86400000).toISOString().slice(0, 10)
    const status = rnd() < 0.12 ? 'cancelled' : 'recorded'
    const records = {}
    if (status === 'recorded') { if (rnd() < 0.9) records.u_kabir = rnd() < 0.7 ? 'P' : 'A'; records.u_ishaan = rnd() < 0.5 ? 'P' : 'A' }
    sessions.push({ id: 'x' + i, division: 'D1ADA', subject: subjects[i % 3], date: d, start: '09:00', end: '10:00', status, records, version: 1 })
  }
  return { attSessions: sessions }
}

describe('attendance arithmetic matches raw records', () => {
  for (const seed of [1, 7, 42, 99, 2026]) {
    it(`random history #${seed}`, () => {
      const st = randomState(seed)
      const sum = studentSummary(st, 'u_kabir', now)
      const elig = st.attSessions.filter((s) => s.status === 'recorded' && 'u_kabir' in s.records)
      const P = elig.filter((s) => s.records.u_kabir === 'P').length
      expect(sum.overall.total).toBe(elig.length)
      expect(sum.overall.present).toBe(P)
      expect(sum.overall.pct).toBe(elig.length ? round1(P / elig.length) : null)
      // cancelled and missing never counted
      expect(sum.rows.every((r) => st.attSessions.find((s) => s.id === r.id).status === 'recorded')).toBe(true)
      // subject totals add up to overall
      expect(sum.bySubject.reduce((a, b) => a + b.total, 0)).toBe(sum.overall.total)
      // periods are subsets in IST
      const ym = '2026-10', y = '2026'
      expect(sum.month.total).toBe(elig.filter((s) => s.date.startsWith(ym)).length)
      expect(sum.year.total).toBe(elig.filter((s) => s.date.startsWith(y)).length)
      expect(sum.week.total).toBe(elig.filter((s) => s.date >= '2026-10-12' && s.date <= '2026-10-16').length)
      for (const v of [sum.overall, sum.week, sum.month, sum.year, ...sum.bySubject]) expect(Number.isNaN(v.pct)).toBe(false)
    })
  }
  it('zero eligible sessions gives no percentage (not 0%, not 100%, not NaN)', () => {
    const sum = studentSummary({ attSessions: [] }, 'u_kabir', now)
    expect(sum.overall).toEqual({ present: 0, absent: 0, total: 0, pct: null })
  })
  it('a correction changes the percentage immediately and keeps an audit entry', () => {
    const db = makeSeed(now)
    const c = createSession(db.shared, { division: 'D1ADA', subject: 'Python Programming', date: '2026-10-15', start: '11:00', end: '12:00', records: { u_kabir: 'A', u_ishaan: 'P' } }, db.profiles.u_t_meera, db.profiles, now)
    // Meera teaches EM-I only, so this must be refused; use an admin to verify edit maths
    expect(c.ok).toBe(false)
    const c2 = createSession(db.shared, { division: 'D1ADA', subject: 'Python Programming', date: '2026-10-15', start: '11:00', end: '12:00', records: { u_kabir: 'A', u_ishaan: 'P' } }, db.profiles.u_admin, db.profiles, now)
    expect(c2.ok).toBe(true)
    const before = studentSummary(c2.state, 'u_kabir', now).overall
    const e = editSession(c2.state, c2.item.id, { records: { u_kabir: 'P' } }, db.profiles.u_admin, { verified: true, reason: 'late arrival', version: 1, profiles: db.profiles }, now)
    expect(e.ok).toBe(true)
    const after = studentSummary(e.state, 'u_kabir', now).overall
    expect(after.present).toBe(before.present + 1)
    expect(after.total).toBe(before.total)
    const audit = e.state.attAudit.filter((a) => a.sessionId === c2.item.id)
    expect(audit.map((a) => a.action)).toEqual(['recorded', 'corrected'])
    expect(audit[1].changes).toEqual([{ studentId: 'u_kabir', from: 'A', to: 'P' }])
    // stale version (concurrent edit) is refused
    expect(editSession(e.state, c2.item.id, { records: { u_kabir: 'A' } }, db.profiles.u_admin, { verified: true, reason: 'x', version: 1, profiles: db.profiles }, now).ok).toBe(false)
    // duplicate lecture refused
    expect(createSession(e.state, { division: 'D1ADA', subject: 'Python Programming', date: '2026-10-15', start: '11:00', end: '12:00', records: { u_kabir: 'A', u_ishaan: 'P' } }, db.profiles.u_admin, db.profiles, now).ok).toBe(false)
    // future date refused
    expect(createSession(e.state, { division: 'D1ADA', subject: 'Python Programming', date: '2026-10-17', start: '11:00', end: '12:00', records: { u_kabir: 'A', u_ishaan: 'P' } }, db.profiles.u_admin, db.profiles, now).ok).toBe(false)
  })
})
