// Pure helpers behind the Overview. They only reshape real records: no scores, no invented numbers.
import { visiblePosts, mySubs, SUBST } from './posts.js'
import { eventStatus, EVENT_STATUS, myRequest, regStatus } from './events.js'

const H = 3600000
/** Due-date state used everywhere on the Overview: overdue, due within 36 h, later, or no date. */
export function dueState(due, now) {
  if (!due) return 'none'
  const ms = Date.parse(due) - now
  return ms < 0 ? 'overdue' : ms < 36 * H ? 'soon' : 'later'
}
const ORDER = { overdue: 0, soon: 1, later: 2, none: 3 }
const byDue = (a, b) => ORDER[a.state] - ORDER[b.state] || (a.due && b.due ? Date.parse(a.due) - Date.parse(b.due) : a.due ? -1 : b.due ? 1 : 0)

/**
 * College-issued work for the student. `live` = phone account: sample (demo) records are never shown as real.
 *  - assignments the student's division received (browser classwork), with their submission status;
 *  - dated reminders from the college server (teachers / class rep) for phone accounts.
 */
export function collegeTasks({ shared, me, now, live, reminders = [] }) {
  const out = []
  for (const p of visiblePosts(shared, me, now)) {
    if (p.kind !== 'assignment' || p.status !== 'Published' || (live && p.demo)) continue
    const last = mySubs(shared, p.id, me.id)[0]
    const sub = !last ? 'Not submitted' : last.status === SUBST.CHANGES ? 'Changes requested' : last.status
    if (sub === SUBST.REVIEWED) continue // finished
    out.push({ id: p.id, kind: 'assignment', title: p.title, subject: p.subject || '', due: p.deadline, state: sub === 'Not submitted' || sub === 'Changes requested' ? dueState(p.deadline, now) : 'later', submission: sub, href: `#/classwork?id=${p.id}`, demo: !!p.demo })
  }
  for (const r of reminders) out.push({ id: `rem_${r.id}`, kind: 'reminder', title: r.title, subject: r.author_name ? `From ${r.author_name}` : '', due: r.remind_at, state: dueState(r.remind_at, now), submission: null, href: '#/portal?tab=feed', demo: false })
  return out.sort(byDue)
}

/** Personal study tasks (the student's own deadlines): only they see these. */
export function personalTasks(deadlines = [], now) {
  return deadlines.filter((d) => !d.done).map((d) => ({ ...d, state: dueState(d.due, now) })).sort(byDue)
}

/** Events that haven't ended, soonest first, with registration deadline and the student's request status. */
export function upcomingEvents({ shared, me, now, live, college = [] }) {
  const out = []
  for (const e of college) {
    if (e.status !== 'published' && e.status !== 'cancelled') continue
    const end = e.ends_at || e.starts_at
    if (Date.parse(end) < now) continue
    out.push({ id: `ce_${e.id}`, title: e.title, start: e.starts_at, venue: e.venue || '', cancelled: e.status === 'cancelled', registration: e.registration || '', mine: null, regCloses: null, href: '#/portal?tab=record', source: 'college' })
  }
  for (const e of shared.events || []) {
    if (live && e.demo) continue
    if (eventStatus(e, now) === EVENT_STATUS.ENDED) continue
    const r = me ? myRequest(shared, e.id, me.id) : null
    out.push({ id: e.id, title: e.title, start: e.start, venue: e.place?.label || '', cancelled: !!e.cancelled, registration: '', mine: r ? regStatus(r) : null, regCloses: e.regCloses || null, href: `#/events?id=${e.id}`, source: e.demo ? 'sample' : 'campus' })
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

/**
 * Notices for the student's class or role, newest first: server notices (teachers / HOD), published attendance
 * alerts, browser notices for the division, and the student's own notifications.
 */
export function importantNotices({ shared, me, now, live, record = null, notifications = [] }) {
  const out = []
  if (record) {
    for (const a of record.alerts || []) out.push({ id: `al_${a.id}`, kind: 'Attendance alert', tone: 'bad', title: a.title, body: a.details || '', at: a.published_at, href: '#/portal?tab=record' })
    for (const n of record.notices || []) out.push({ id: `no_${n.id}`, kind: n.author_role === 'hod' ? 'HOD' : 'Teacher', tone: 'neutral', title: n.title, body: n.author_name ? `From ${n.author_name}` : '', at: n.created_at, href: '#/portal?tab=feed' })
  }
  for (const p of visiblePosts(shared, me, now)) {
    if (p.kind !== 'notice' || (live && p.demo)) continue
    out.push({ id: p.id, kind: 'Notice', tone: 'neutral', title: p.title, body: p.createdByName ? `From ${p.createdByName}` : '', at: p.createdAt, href: `#/classwork?id=${p.id}`, demo: !!p.demo })
  }
  for (const n of notifications) {
    if (live && n.demo) continue
    if (n.category === 'deadline' || n.category === 'attendance') continue // shown in their own sections
    out.push({ id: n.id, kind: 'Update', tone: 'neutral', title: n.title, body: n.body || '', at: n.at, href: n.href || '#/notifications', unread: !n.read, notification: true })
  }
  return out.filter((x) => x.at).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}
