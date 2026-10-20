// Notification centre records. One list in shared state, each record addressed to one user.
// Records are only ever created from real app actions or data (event published, request decided, deadline
// added/changed/approaching, challenge posted, submission reviewed). `key` makes creation idempotent, so reloading
// a page or re-running a generator never duplicates a notification.
//
// NOTE: in this build the "shared" state lives in this browser's storage. A notification addressed to another
// student only reaches them if they use this same browser (demo accounts). Real cross-device delivery needs the
// shared backend described in README → "Notifications: multi-user delivery".
import { uid } from './ids.js'

export const CATEGORY = { event: 'Event', deadline: 'Deadline', challenge: 'Challenge', classwork: 'Classwork', attendance: 'Attendance', ride: 'Ride', peer: 'Peer learning', notes: 'Notes' }

/** Add notifications, skipping any (userId, key) pair that already exists. */
export function notify(state, items, now = new Date()) {
  const list = state.notifications || []
  const seen = new Set(list.map((n) => n.userId + '|' + n.key))
  const add = []
  for (const it of items) {
    if (!it?.userId || !it.key) continue
    const k = it.userId + '|' + it.key
    if (seen.has(k)) continue
    seen.add(k)
    add.push({ id: uid('ntf'), userId: it.userId, key: it.key, category: it.category, title: it.title, body: it.body || '', href: it.href || null, at: (it.at || now.toISOString()), read: false })
  }
  return add.length ? { ...state, notifications: [...add, ...list] } : state
}

export const notificationsFor = (state, userId) => (state.notifications || []).filter((n) => n.userId === userId).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
export const unreadCount = (state, userId) => (state.notifications || []).filter((n) => n.userId === userId && !n.read).length

export function markRead(state, userId, ids) {
  const set = new Set(ids)
  let changed = false
  const notifications = (state.notifications || []).map((n) => (n.userId === userId && set.has(n.id) && !n.read ? ((changed = true), { ...n, read: true }) : n))
  return changed ? { ...state, notifications } : state
}
export function markAllRead(state, userId) {
  return markRead(state, userId, (state.notifications || []).filter((n) => n.userId === userId).map((n) => n.id))
}

/** Students who should hear about campus-wide things (not system or organiser accounts). */
export const studentIds = (profiles) => Object.values(profiles || {}).filter((p) => !p.system && !['organiser', 'teacher', 'admin'].includes(p.role)).map((p) => p.id)

/**
 * Deadline notifications for one student, from their own deadline records.
 * `seen` maps deadline id → due time already known. Returns { items, seen } — items to notify, updated map.
 * A missing `seen` map (older saved data) is initialised silently, so existing deadlines don't all fire at once.
 */
export const REMIND_HOURS = 24
export function deadlineNotifications(userId, deadlines, seen, now = new Date()) {
  const items = []
  const next = { ...(seen || {}) }
  const initialising = !seen
  for (const d of deadlines || []) {
    const due = Date.parse(d.due)
    if (!initialising) {
      if (!(d.id in next)) items.push({ userId, key: `dl-new:${d.id}`, category: 'deadline', title: 'New deadline added', body: `${d.title}${d.subject ? ' · ' + d.subject : ''} — due ${fmt(d.due)}`, href: `#/?dl=${d.id}` })
      else if (next[d.id] !== d.due) items.push({ userId, key: `dl-chg:${d.id}:${d.due}`, category: 'deadline', title: 'Deadline changed', body: `${d.title} is now due ${fmt(d.due)}`, href: `#/?dl=${d.id}` })
    }
    next[d.id] = d.due
    if (!d.done && Number.isFinite(due) && due > now.getTime() && due - now.getTime() <= REMIND_HOURS * 3600000) {
      items.push({ userId, key: `dl-soon:${d.id}:${d.due}`, category: 'deadline', title: 'Deadline approaching', body: `${d.title} is due ${fmt(d.due)}`, href: `#/?dl=${d.id}` })
    }
  }
  for (const id of Object.keys(next)) if (!(deadlines || []).some((d) => d.id === id)) delete next[id]
  return { items, seen: next }
}

const fmt = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
