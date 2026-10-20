// Campus events: statuses are computed from timestamps, never stored.
import { uid } from './ids.js'
import { notify, studentIds } from './notifications.js'

export const EVENT_STATUS = { OPEN: 'Registration Open', SOON: 'Starting Soon', LIVE: 'Live Now', ENDED: 'Event Ended' }
export const DEFAULT_EVENT_SETTINGS = { timeZone: 'Asia/Kolkata', soonWindowMinutes: 120 }

/**
 * Rules (all comparisons on UTC instants, so the campus timezone only affects display):
 *  now ≥ end                                   → Event Ended
 *  start ≤ now < end                           → Live Now
 *  before start, registration open, and more
 *    than the "soon" window away                → Registration Open
 *  otherwise before start                      → Starting Soon (registration closed or start is close)
 */
export function eventStatus(ev, now = new Date(), settings = DEFAULT_EVENT_SETTINGS) {
  const t = now.getTime(), start = Date.parse(ev.start), end = Date.parse(ev.end)
  const regCloses = ev.regCloses ? Date.parse(ev.regCloses) : start
  if (t >= end) return EVENT_STATUS.ENDED
  if (t >= start) return EVENT_STATUS.LIVE
  const soon = settings.soonWindowMinutes * 60000
  if (t < regCloses && start - t > soon) return EVENT_STATUS.OPEN
  return EVENT_STATUS.SOON
}

export function validateEvent(ev) {
  const e = []
  if (!ev?.title?.trim()) e.push('Event title is required.')
  const s = Date.parse(ev?.start), en = Date.parse(ev?.end)
  if (!Number.isFinite(s) || !Number.isFinite(en)) e.push('Start and end must be valid times.')
  else if (en <= s) e.push('End must be after start.')
  if (ev?.regCloses && Date.parse(ev.regCloses) > s) e.push('Registration must close before the event starts.')
  return e
}

/* ---------------- Registration requests (request → organiser decision) ----------------
 * A request is never a registration until an organiser approves it. Statuses:
 *   Pending approval → Approved | Rejected | Waitlisted ; any active request → Withdrawn (by the student)
 * Pending and waitlisted requests never count towards capacity; only Approved does.
 * Records saved before this workflow existed have no status and were real registrations → read as Approved.
 */
export const REG = { PENDING: 'Pending approval', APPROVED: 'Approved', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn', WAITLISTED: 'Waitlisted' }
const ACTIVE = [REG.PENDING, REG.APPROVED, REG.WAITLISTED]
export const regStatus = (r) => r.status || REG.APPROVED
export const registrationsFor = (state, eventId) => state.registrations.filter((r) => r.eventId === eventId)
export const approvedCount = (state, eventId) => registrationsFor(state, eventId).filter((r) => regStatus(r) === REG.APPROVED).length
export function regCounts(state, eventId) {
  const c = { pending: 0, approved: 0, waitlisted: 0, rejected: 0, withdrawn: 0 }
  for (const r of registrationsFor(state, eventId)) {
    const st = regStatus(r)
    if (st === REG.PENDING) c.pending++; else if (st === REG.APPROVED) c.approved++; else if (st === REG.WAITLISTED) c.waitlisted++; else if (st === REG.REJECTED) c.rejected++; else c.withdrawn++
  }
  return c
}
/** The student's most recent request for an event (any status), or null. */
export const myRequest = (state, eventId, userId) => registrationsFor(state, eventId).filter((r) => r.userId === userId).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] || null
/** Confirmed registration = an APPROVED request. */
export const isRegistered = (state, eventId, userId) => registrationsFor(state, eventId).some((r) => r.userId === userId && regStatus(r) === REG.APPROVED)
export const isOrganiserOf = (user, ev) => !!user && user.role === 'organiser' && ev.organiserId === user.id

export function canRequest(state, ev, user, now = new Date(), settings = DEFAULT_EVENT_SETTINGS) {
  if (!user?.id) return { ok: false, reason: 'Sign in to request a place.' }
  if (user.role === 'organiser') return { ok: false, reason: 'Organiser accounts manage requests; they can\u2019t register.' }
  const mine = myRequest(state, ev.id, user.id)
  if (mine && ACTIVE.includes(regStatus(mine))) return { ok: false, reason: regStatus(mine) === REG.APPROVED ? "You're registered." : `Your request is ${regStatus(mine).toLowerCase()}.`, status: regStatus(mine) }
  if (mine && regStatus(mine) === REG.REJECTED) return { ok: false, reason: 'Your request was not approved.', status: REG.REJECTED }
  if (eventStatus(ev, now, settings) !== EVENT_STATUS.OPEN) return { ok: false, reason: 'Registration is closed.' }
  return { ok: true, full: !!ev.capacity && approvedCount(state, ev.id) >= ev.capacity }
}
export const canRegister = canRequest // older name, kept for callers

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
/** Validate a registration form against the event's own form settings. Returns { field: message }. */
export function validateRegistrationForm(ev, f) {
  const e = {}, cfg = ev.form || {}
  if (!f.name?.trim() || f.name.trim().length < 2) e.name = 'Enter your full name.'
  if (!f.classId) e.classId = 'Choose your class.'
  const email = f.email?.trim(), phone = (f.phone || '').replace(/[\s-]/g, '').replace(/^\+91/, '')
  if (!email && !phone) e.email = 'Give an email or a phone number so the organiser can reach you.'
  if (email && !EMAIL.test(email)) e.email = 'That email doesn\u2019t look right.'
  if (phone && !/^[6-9]\d{9}$/.test(phone)) e.phone = 'Enter a 10-digit Indian mobile number.'
  if (cfg.roll && !f.roll?.trim()) e.roll = 'Your roll number is required for this event.'
  if (cfg.teamMax) { const n = Number(f.teamSize); if (!Number.isInteger(n) || n < 1 || n > cfg.teamMax) e.teamSize = `Team size must be 1 to ${cfg.teamMax}.` }
  if (cfg.question && cfg.questionRequired && !f.answer?.trim()) e.answer = 'Please answer this question.'
  return e
}

export function requestRegistration(state, eventId, user, form, now = new Date(), settings = DEFAULT_EVENT_SETTINGS) {
  const ev = state.events.find((e) => e.id === eventId)
  if (!ev) return { ok: false, state, error: 'That event no longer exists.' }
  const c = canRequest(state, ev, user, now, settings) // registration window re-checked at submission time
  if (!c.ok) return { ok: false, state, error: c.reason }
  const errors = validateRegistrationForm(ev, form)
  if (Object.keys(errors).length) return { ok: false, state, error: Object.values(errors)[0], errors }
  const status = c.full ? REG.WAITLISTED : REG.PENDING
  const clean = { name: form.name.trim(), classId: form.classId, email: form.email?.trim() || '', phone: (form.phone || '').trim(), roll: form.roll?.trim() || '', teamSize: ev.form?.teamMax ? Number(form.teamSize) : null, answer: form.answer?.trim() || '' }
  const reg = { id: uid('reg'), eventId, userId: user.id, userName: clean.name, status, form: clean, at: now.toISOString(), history: [{ status, at: now.toISOString(), by: user.id }] }
  let next = { ...state, registrations: [...state.registrations, reg] }
  if (ev.organiserId) next = notify(next, [{ userId: ev.organiserId, key: `reg-new:${reg.id}`, category: 'event', title: 'New registration request', body: `${clean.name} (${clean.classId}) asked to join ${ev.title}`, href: `#/organiser?ev=${ev.id}` }], now)
  return { ok: true, state: next, item: reg }
}

export function withdrawRequest(state, regId, user, now = new Date()) {
  const r = state.registrations.find((x) => x.id === regId)
  if (!r || r.userId !== user?.id) return { ok: false, state, error: 'That request isn\u2019t yours.' }
  if (!ACTIVE.includes(regStatus(r))) return { ok: false, state, error: 'Only active requests can be withdrawn.' }
  const upd = { ...r, status: REG.WITHDRAWN, history: [...(r.history || []), { status: REG.WITHDRAWN, at: now.toISOString(), by: user.id }] }
  return { ok: true, state: { ...state, registrations: state.registrations.map((x) => (x.id === regId ? upd : x)) }, item: upd }
}

/** Organiser decision. decision: 'approve' | 'reject' | 'waitlist'. Only the event's organiser may decide. */
export function decideRequest(state, regId, actor, decision, reason = '', now = new Date()) {
  const r = state.registrations.find((x) => x.id === regId)
  if (!r) return { ok: false, state, error: 'That request no longer exists.' }
  const ev = state.events.find((e) => e.id === r.eventId)
  if (!ev) return { ok: false, state, error: 'That event no longer exists.' }
  if (!isOrganiserOf(actor, ev)) return { ok: false, state, error: 'Only this event\u2019s organiser can approve or reject requests.' }
  const st = regStatus(r)
  if (![REG.PENDING, REG.WAITLISTED].includes(st)) return { ok: false, state, error: `This request is already ${st.toLowerCase()}.` }
  if (now.getTime() >= Date.parse(ev.start)) return { ok: false, state, error: 'The event has already started, so requests can no longer be decided.' }
  let status
  if (decision === 'approve') {
    if (ev.capacity && approvedCount(state, ev.id) >= ev.capacity) return { ok: false, state, error: `The event is full (${ev.capacity} approved). Waitlist this request instead.` }
    status = REG.APPROVED
  } else if (decision === 'reject') status = REG.REJECTED
  else if (decision === 'waitlist') { if (st === REG.WAITLISTED) return { ok: false, state, error: 'Already waitlisted.' }; status = REG.WAITLISTED }
  else return { ok: false, state, error: 'Unknown decision.' }
  const upd = { ...r, status, decidedAt: now.toISOString(), decidedBy: actor.id, reason: reason.trim(), history: [...(r.history || []), { status, at: now.toISOString(), by: actor.id, reason: reason.trim() }] }
  let next = { ...state, registrations: state.registrations.map((x) => (x.id === regId ? upd : x)) }
  const body = status === REG.APPROVED ? `You're registered for ${ev.title}.` : status === REG.REJECTED ? `Your request for ${ev.title} was not approved.${reason.trim() ? ' Reason: ' + reason.trim() : ''}` : `You're on the waitlist for ${ev.title}. You'll be notified if a place opens.`
  next = notify(next, [{ userId: r.userId, key: `reg-dec:${r.id}:${status}`, category: 'event', title: status === REG.APPROVED ? 'Registration approved' : status === REG.REJECTED ? 'Registration not approved' : 'Added to the waitlist', body, href: `#/events?id=${ev.id}` }], now)
  return { ok: true, state: next, item: upd }
}

/** Organiser publishes a new event; every student gets a notification. */
export function publishEvent(state, input, actor, profiles, now = new Date()) {
  if (actor?.role !== 'organiser') return { ok: false, state, error: 'Only organisers can publish events.' }
  const errs = validateEvent(input)
  if (input.capacity != null && input.capacity !== '' && !(Number.isInteger(Number(input.capacity)) && Number(input.capacity) > 0)) errs.push('Capacity must be a positive whole number.')
  if (!input.place?.id) errs.push('Choose a venue.')
  if (errs.length) return { ok: false, state, error: errs[0], errors: errs }
  const ev = { id: uid('ev'), title: input.title.trim(), description: (input.description || '').trim(), start: new Date(input.start).toISOString(), end: new Date(input.end).toISOString(), regCloses: input.regCloses ? new Date(input.regCloses).toISOString() : null, place: input.place, tags: input.tags || [], capacity: input.capacity ? Number(input.capacity) : null, organiserId: actor.id, organiserName: actor.name, form: input.form || {}, createdAt: now.toISOString(), demo: false }
  let next = { ...state, events: [ev, ...state.events] }
  next = notify(next, studentIds(profiles).map((u) => ({ userId: u, key: `ev-new:${ev.id}`, category: 'event', title: 'New event published', body: `${ev.title} · ${formatEventTime(ev.start)} · ${ev.place.label}`, href: `#/events?id=${ev.id}` })), now)
  return { ok: true, state: next, item: ev }
}

/** Organiser edits an event; students with an active request are told what changed. */
export function updateEvent(state, eventId, patch, actor, now = new Date()) {
  const ev = state.events.find((e) => e.id === eventId)
  if (!ev) return { ok: false, state, error: 'That event no longer exists.' }
  if (!isOrganiserOf(actor, ev)) return { ok: false, state, error: 'Only this event\u2019s organiser can edit it.' }
  const upd = { ...ev, ...patch, start: patch.start ? new Date(patch.start).toISOString() : ev.start, end: patch.end ? new Date(patch.end).toISOString() : ev.end }
  const errs = validateEvent(upd)
  if (upd.capacity != null && !(Number.isInteger(upd.capacity) && upd.capacity >= approvedCount(state, ev.id))) errs.push(`Capacity can't be below the ${approvedCount(state, ev.id)} already approved.`)
  if (errs.length) return { ok: false, state, error: errs[0], errors: errs }
  const changed = []
  if (upd.start !== ev.start || upd.end !== ev.end) changed.push(`now ${formatEventTime(upd.start)}`)
  if (upd.place?.id !== ev.place?.id || upd.place?.f !== ev.place?.f) changed.push(`venue: ${upd.place.label}`)
  if ((upd.note || '') !== (ev.note || '') && upd.note) changed.push(upd.note)
  let next = { ...state, events: state.events.map((e) => (e.id === eventId ? upd : e)) }
  if (changed.length) {
    const who = [...new Set(registrationsFor(state, eventId).filter((r) => ACTIVE.includes(regStatus(r))).map((r) => r.userId))]
    next = notify(next, who.map((u) => ({ userId: u, key: `ev-upd:${eventId}:${now.getTime()}`, category: 'event', title: `Event updated: ${upd.title}`, body: changed.join(' · '), href: `#/events?id=${eventId}` })), now)
  }
  return { ok: true, state: next, item: upd, changed }
}

/** Interest-based suggestions: overlap between event tags and profile interests. */
export function suggestEvents(events, profile, now = new Date(), settings = DEFAULT_EVENT_SETTINGS) {
  const interests = new Set((profile?.interests || []).map((i) => i.toLowerCase()))
  return events
    .filter((e) => eventStatus(e, now, settings) !== EVENT_STATUS.ENDED)
    .map((e) => {
      const matched = (e.tags || []).filter((t) => interests.has(t.toLowerCase()))
      return { event: e, score: matched.length, matched }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(a.event.start) - Date.parse(b.event.start))
}

export function formatEventTime(iso, timeZone = DEFAULT_EVENT_SETTINGS.timeZone) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

/* ---------- event organiser chat (one private thread per event per student) ----------
 * Demo: messages live in this browser's storage. Text is rendered by React (escaped), never as HTML. */
const fail = (state, error) => ({ ok: false, state, error })
export const MSG_MAX = 500
const cleanMsg = (t) => String(t || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
export const messagesIn = (state, eventId, studentId) => (state.eventChats || []).filter((m) => m.eventId === eventId && m.studentId === studentId).sort((a, b) => a.at.localeCompare(b.at))
export function threadsFor(state, eventId) {
  const by = new Map()
  for (const m of (state.eventChats || []).filter((x) => x.eventId === eventId)) {
    const t = by.get(m.studentId) || { studentId: m.studentId, studentName: m.fromRole === 'student' ? m.fromName : null, count: 0, last: null }
    if (m.fromRole === 'student') t.studentName = m.fromName
    t.count++; if (!t.last || m.at > t.last.at) t.last = m
    by.set(m.studentId, t)
  }
  return [...by.values()].sort((a, b) => b.last.at.localeCompare(a.last.at))
}
export function sendEventMessage(state, { eventId, studentId, text }, actor, now = new Date()) {
  const ev = (state.events || []).find((e) => e.id === eventId)
  if (!ev) return fail(state, 'That event no longer exists.')
  const body = cleanMsg(text)
  if (!body) return fail(state, 'Type a message first.')
  if (body.length > MSG_MAX) return fail(state, `Keep messages under ${MSG_MAX} characters.`)
  let thread, fromRole
  if (isOrganiserOf(actor, ev)) {
    if (!studentId || !messagesIn(state, eventId, studentId).length) return fail(state, 'Choose a conversation to reply to.')
    thread = studentId; fromRole = 'organiser'
  } else if (actor?.id && !['teacher', 'admin', 'organiser', 'hod'].includes(actor.role) && !actor.system) {
    thread = actor.id; fromRole = 'student' // a student can only ever write in their own thread
  } else return fail(state, 'Only this event’s organisers and students can use this chat.')
  const last = messagesIn(state, eventId, thread).filter((m) => m.fromId === actor.id).pop()
  if (last && last.text === body && now.getTime() - Date.parse(last.at) < 5000) return fail(state, 'That message was already sent.')
  const msg = { id: uid('msg'), eventId, studentId: thread, fromId: actor.id, fromName: actor.name, fromRole, text: body, at: now.toISOString() }
  let next = { ...state, eventChats: [...(state.eventChats || []), msg] }
  const to = fromRole === 'student' ? ev.organiserId : thread
  if (state.notifications) next = notify(next, [{ userId: to, key: `chat:${msg.id}`, category: 'event', title: fromRole === 'student' ? `Message about ${ev.title}` : `Reply from ${ev.organiserName || 'the organiser'}`, body: `${actor.name}: ${body.slice(0, 90)}`, href: fromRole === 'student' ? `#/organiser?tab=chat&ev=${ev.id}&s=${thread}` : `#/events?id=${ev.id}&chat=1` }], now)
  return { ok: true, state: next, item: msg }
}
