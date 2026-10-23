// Audit 2026-10: the Overview shows real records only, sorted by meaningful dates.
import { describe, it, expect } from 'vitest'
import { collegeTasks, personalTasks, upcomingEvents, importantNotices, dueState } from '../src/lib/overview.js'

const now = new Date('2026-10-23T10:00:00+05:30')
const iso = (h) => new Date(now.getTime() + h * 3600000).toISOString()
const me = { id: 'u1', role: 'student', division: 'D2B', classId: 'FE-B' }
const post = (id, extra) => ({ id, kind: 'assignment', title: id, audience: { divisions: ['D2B'] }, status: 'Published', createdBy: 't1', createdAt: iso(-48), deadline: null, ...extra })
const shared = {
  posts: [
    post('later', { deadline: iso(72) }), post('overdue', { deadline: iso(-2) }), post('soon', { deadline: iso(5) }),
    post('other-div', { audience: { divisions: ['D2A'] }, deadline: iso(1) }), post('sample', { deadline: iso(3), demo: true }),
    post('reviewed', { deadline: iso(10) }), post('notice1', { kind: 'notice', createdAt: iso(-1) }),
  ],
  postSubs: [{ id: 's1', postId: 'reviewed', userId: 'u1', attempt: 1, status: 'Reviewed' }],
  events: [
    { id: 'e2', title: 'Later', start: iso(100), end: iso(102) }, { id: 'e1', title: 'Soon', start: iso(20), end: iso(22) },
    { id: 'e0', title: 'Over', start: iso(-5), end: iso(-3) }, { id: 'es', title: 'Sample', start: iso(30), end: iso(31), demo: true },
  ],
  registrations: [{ id: 'r1', eventId: 'e1', userId: 'u1', status: 'Approved', at: iso(-3) }],
}

describe('Overview data', () => {
  it('due states', () => {
    expect(dueState(iso(-1), now)).toBe('overdue'); expect(dueState(iso(5), now)).toBe('soon'); expect(dueState(iso(48), now)).toBe('later'); expect(dueState(null, now)).toBe('none')
  })
  it('tasks: own division only, overdue first, then by date; reviewed work drops off', () => {
    const t = collegeTasks({ shared, me, now, live: false })
    expect(t.map((x) => x.id)).toEqual(['overdue', 'sample', 'soon', 'later'])
    expect(t.find((x) => x.id === 'soon').submission).toBe('Not submitted')
  })
  it('phone accounts never see sample records as real; server reminders are included', () => {
    const t = collegeTasks({ shared, me, now, live: true, reminders: [{ id: 'm1', title: 'Bring lab journal', remind_at: iso(20), author_name: 'Prof B' }] })
    expect(t.map((x) => x.id)).toEqual(['overdue', 'soon', 'rem_m1', 'later'])
  })
  it('personal tasks are separate and sorted', () => {
    const p = personalTasks([{ id: 'a', title: 'Revise', due: iso(50) }, { id: 'b', title: 'Done', due: iso(1), done: true }, { id: 'c', title: 'Read', due: iso(2) }], now)
    expect(p.map((x) => x.id)).toEqual(['c', 'a'])
  })
  it('events: not ended, soonest first, with my registration status; college events included', () => {
    const e = upcomingEvents({ shared, me, now, live: true, college: [{ id: 'c1', title: 'Induction', starts_at: iso(10), status: 'published', venue: 'Amphitheatre' }, { id: 'c2', title: 'Draft', starts_at: iso(5), status: 'draft' }] })
    expect(e.map((x) => x.title)).toEqual(['Induction', 'Soon', 'Later'])
    expect(e.find((x) => x.title === 'Soon').mine).toBe('Approved')
  })
  it('notices: newest first, alerts from the server record included', () => {
    const n = importantNotices({ shared, me, now, live: false, record: { alerts: [{ id: 'a1', title: 'Low attendance in Maths', published_at: iso(-0.5) }], notices: [{ id: 'n1', title: 'Lab moved', created_at: iso(-3), author_role: 'teacher' }] } })
    expect(n.map((x) => x.title)).toEqual(['Low attendance in Maths', 'notice1', 'Lab moved'])
  })
})
