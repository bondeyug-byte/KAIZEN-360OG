// Lecture-based attendance. One session = one division + subject + date + start time (unique). Records map
// studentId → 'P' | 'A'. Rules:
//  • only a teacher assigned to that division + subject (or an admin) may create or edit a session;
//  • editing a saved session needs the teacher's attendance edit password (PBKDF2-SHA-256, salted, never stored
//    in plain text) and is written to the audit log with before/after values and a reason;
//  • students see only their own records;
//  • % = present ÷ recorded lectures × 100. Cancelled sessions and lectures with no saved record are NOT counted —
//    and are never turned into absences.
// In this build the data lives in the browser (see README); the same functions are meant to run server-side.
import { uid } from './ids.js'
import { notify } from './notifications.js'
import { isAdmin, isStudent } from './posts.js'

export const MARK = { P: 'Present', A: 'Absent' }
const fail = (state, error) => ({ ok: false, state, error })
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/

export const canManage = (user, division, subject) => isAdmin(user) || (user?.role === 'teacher' && (user.teaches || []).some((t) => t.division === division && t.subject === subject))
export const sessionKey = (s) => `${s.division}|${s.subject}|${s.date}|${s.start}`
export const roster = (profiles, division) => Object.values(profiles || {}).filter((p) => isStudent(p) && p.division === division).sort((a, b) => (a.roll || '').localeCompare(b.roll || '', undefined, { numeric: true }))

/** Create a new session (first save — no edit password needed). */
export function createSession(state, input, actor, profiles, now = new Date()) {
  if (!canManage(actor, input.division, input.subject)) return fail(state, 'You are not assigned to this division and subject.')
  if (!DATE.test(input.date || '') || !TIME.test(input.start || '') || !TIME.test(input.end || '') || input.end <= input.start) return fail(state, 'Choose a date and a valid start and end time.')
  if (input.date > new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)) return fail(state, 'Attendance can’t be recorded for a future date.')
  const key = sessionKey(input)
  if ((state.attSessions || []).some((s) => sessionKey(s) === key)) return fail(state, 'This lecture already has attendance. Open it to edit instead.')
  const ids = new Set(roster(profiles, input.division).map((p) => p.id))
  const records = {}
  if (input.status !== 'cancelled') {
    for (const id of ids) { const m = input.records?.[id]; if (m !== 'P' && m !== 'A') return fail(state, 'Mark every student Present or Absent before saving.'); records[id] = m }
  }
  const s = { id: uid('att'), division: input.division, subject: input.subject, date: input.date, start: input.start, end: input.end, teacherId: actor.id, status: input.status === 'cancelled' ? 'cancelled' : 'recorded', records, note: (input.note || '').trim(), createdAt: now.toISOString(), updatedAt: now.toISOString(), version: 1 }
  let next = { ...state, attSessions: [...(state.attSessions || []), s], attAudit: [...(state.attAudit || []), { id: uid('aud'), sessionId: s.id, by: actor.id, byName: actor.name, at: now.toISOString(), action: s.status === 'cancelled' ? 'marked cancelled' : 'recorded', changes: [], reason: '' }] }
  if (s.status === 'recorded') next = notify(next, Object.keys(records).map((id) => ({ userId: id, key: `att:${s.id}`, category: 'attendance', title: `Attendance recorded: ${s.subject}`, body: `${s.date} ${s.start} · ${MARK[records[id]]}`, href: '#/attendance' })), now)
  return { ok: true, state: next, item: s }
}

/** Edit a saved session. `verified` must come from verifyEditPassword(); `version` guards against overwriting someone else's newer save. */
export function editSession(state, sessionId, changes, actor, { verified, reason = '', version, profiles } = {}, now = new Date()) {
  const s = (state.attSessions || []).find((x) => x.id === sessionId)
  if (!s) return fail(state, 'That lecture record no longer exists.')
  if (!canManage(actor, s.division, s.subject)) return fail(state, 'You are not assigned to this division and subject.')
  if (verified !== true) return fail(state, 'Enter your attendance edit password to change saved attendance.')
  if (version != null && version !== s.version) return fail(state, 'This record was changed after you opened it. Reload it and try again.')
  if (!reason.trim()) return fail(state, 'Give a short reason for the correction.')
  const status = changes.status || s.status
  if (!['recorded', 'cancelled'].includes(status)) return fail(state, 'A lecture can only be marked held or cancelled.')
  // Students who may appear on this record: the saved marks, plus (for a lecture that was cancelled) the division roster.
  const allowed = new Set([...Object.keys(s.records || {}), ...(profiles ? roster(profiles, s.division).map((p) => p.id) : [])])
  const diff = []
  const records = { ...s.records }
  for (const [id, m] of Object.entries(changes.records || {})) {
    if (!allowed.has(id)) return fail(state, 'One of those students is not on this lecture’s roster.')
    if (m !== 'P' && m !== 'A') return fail(state, 'Marks must be Present or Absent.')
    if (records[id] !== m) { diff.push({ studentId: id, from: records[id] || null, to: m }); records[id] = m }
  }
  if (status === 'recorded' && s.status === 'cancelled') {
    // Reinstating a cancelled lecture: every student on the roster needs a mark, or the percentage would be built on gaps.
    if (!profiles) return fail(state, 'The class roster is needed to reinstate a cancelled lecture.')
    if (roster(profiles, s.division).some((p) => records[p.id] !== 'P' && records[p.id] !== 'A')) return fail(state, 'Mark every student Present or Absent before marking the lecture as held.')
  }
  if (!diff.length && status === s.status) return fail(state, 'Nothing changed.')
  const upd = { ...s, records, status, updatedAt: now.toISOString(), version: s.version + 1 }
  let next = { ...state, attSessions: state.attSessions.map((x) => (x.id === sessionId ? upd : x)), attAudit: [...(state.attAudit || []), { id: uid('aud'), sessionId, by: actor.id, byName: actor.name, at: now.toISOString(), action: status !== s.status ? `status ${s.status} → ${status}` : 'corrected', changes: diff, reason: reason.trim() }] }
  next = notify(next, diff.map((d) => ({ userId: d.studentId, key: `att-fix:${sessionId}:${upd.version}`, category: 'attendance', title: `Attendance corrected: ${s.subject}`, body: `${s.date} ${s.start} · now ${MARK[d.to]}`, href: '#/attendance' })), now)
  return { ok: true, state: next, item: upd, diff }
}

/* ---------- edit password (Web Crypto PBKDF2) ---------- */
const enc = new TextEncoder()
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
async function derive(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)))
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}
export const PASSWORD_RULE = 'At least 8 characters, with a letter and a number.'
export const strongEnough = (p) => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p)
export async function makeSecret(password) {
  if (!strongEnough(password)) throw new Error(PASSWORD_RULE)
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)))
  return { salt, iterations: 210000, hash: await derive(password, salt, 210000), setAt: new Date().toISOString(), failures: 0, lockedUntil: null }
}
const eq = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }
export const LOCK_AFTER = 5, LOCK_MINUTES = 10
/** Returns { ok, secret } where secret carries the updated failure counter / lock. */
export async function verifyEditPassword(secret, password, now = new Date()) {
  if (!secret) return { ok: false, error: 'Set an attendance edit password first.', secret }
  if (secret.lockedUntil && Date.parse(secret.lockedUntil) > now.getTime()) return { ok: false, error: `Too many wrong attempts. Try again after ${new Date(secret.lockedUntil).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}.`, secret }
  const h = await derive(password || '', secret.salt, secret.iterations)
  if (eq(h, secret.hash)) return { ok: true, secret: { ...secret, failures: 0, lockedUntil: null } }
  const failures = (secret.failures || 0) + 1
  const lockedUntil = failures >= LOCK_AFTER ? new Date(now.getTime() + LOCK_MINUTES * 60000).toISOString() : null
  return { ok: false, error: lockedUntil ? `Wrong password. Editing is locked for ${LOCK_MINUTES} minutes.` : `Wrong password. ${LOCK_AFTER - failures} attempt${LOCK_AFTER - failures === 1 ? '' : 's'} left.`, secret: { ...secret, failures: lockedUntil ? 0 : failures, lockedUntil } }
}

/* ---------- reporting ---------- */
const pct = (p, n) => (n ? Math.round((p / n) * 1000) / 10 : null)
/** A student's own lecture history and summaries. Unrecorded and cancelled lectures are excluded from %. */
export function studentSummary(state, studentId, now = new Date()) {
  const rows = (state.attSessions || []).filter((s) => s.status === 'recorded' && s.records && studentId in s.records).map((s) => ({ id: s.id, date: s.date, start: s.start, end: s.end, subject: s.subject, mark: s.records[studentId] })).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start))
  const agg = (list) => { const present = list.filter((r) => r.mark === 'P').length; return { present, absent: list.length - present, total: list.length, pct: pct(present, list.length) } }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
  const d = new Date(today + 'T00:00:00Z'), dow = (d.getUTCDay() + 6) % 7
  const weekStart = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10)
  const subjects = {}
  for (const r of rows) (subjects[r.subject] = subjects[r.subject] || []).push(r)
  return {
    rows, overall: agg(rows),
    week: agg(rows.filter((r) => r.date >= weekStart && r.date <= today)),
    month: agg(rows.filter((r) => r.date.slice(0, 7) === today.slice(0, 7))),
    year: agg(rows.filter((r) => r.date.slice(0, 4) === today.slice(0, 4))),
    bySubject: Object.entries(subjects).map(([subject, list]) => ({ subject, ...agg(list) })).sort((a, b) => a.subject.localeCompare(b.subject)),
  }
}
/** Sessions for one class (teacher view), newest first, with counts. */
export function classSessions(state, division, subject) {
  return (state.attSessions || []).filter((s) => s.division === division && s.subject === subject).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start))
    .map((s) => { const v = Object.values(s.records || {}); return { ...s, present: v.filter((m) => m === 'P').length, total: v.length } })
}
/** Scheduled lectures (from the division's weekly timetable) in the last `days` days that have no saved session. */
export function unrecorded(state, { division, subject, timetable, days = 14, now = new Date() }) {
  const out = []
  const have = new Set((state.attSessions || []).filter((s) => s.division === division && s.subject === subject).map((s) => s.date + '|' + s.start))
  for (let k = 1; k <= days; k++) {
    const dt = new Date(now.getTime() - k * 86400000)
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(dt)
    const wd = new Date(date + 'T00:00:00Z').getUTCDay()
    for (const t of timetable.filter((x) => x.day === wd && (x.title === subject || x.title.startsWith(subject + ' ')))) {
      if (!have.has(date + '|' + t.start)) out.push({ date, start: t.start, end: t.end })
    }
  }
  return out
}
