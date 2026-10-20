// Shared notes library. Hierarchy: year → branch → subject → topic/chapter → optional subtopic → file.
// Files live in IndexedDB (src/lib/files.js); records here hold metadata only. Scope: 'all' (whole institute) or
// a year+branch group. Reports flag a note for admin review; three open reports hide it pending review.
import { uid } from './ids.js'
import { isAdmin, isStudent } from './posts.js'
import { notify } from './notifications.js'
import { YEARS, BRANCHES } from '../data/academics.js'

const fail = (state, error, errors) => ({ ok: false, state, error, errors })
const clean = (t) => String(t || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()
export const NOTE_TYPES = ['pdf', 'jpg', 'png']
export const NOTE_MAX_MB = 15
export const REPORT_REASONS = ['Incorrect content', 'Duplicate', 'Inappropriate', 'Copyright / not shareable']
export const HIDE_AFTER = 3

export function validateNote(n) {
  const e = {}
  if (!clean(n.title)) e.title = 'Add a title.'
  else if (clean(n.title).length > 120) e.title = 'Keep the title under 120 characters.'
  if (!YEARS.some((y) => y.id === n.year)) e.year = 'Choose the academic year.'
  if (!BRANCHES.some((b) => b.id === n.branch)) e.branch = 'Choose the branch.'
  if (!clean(n.subject)) e.subject = 'Choose or type the subject.'
  if (!clean(n.topic)) e.topic = 'Add the topic or chapter.'
  if (!['all', 'group'].includes(n.scope)) e.scope = 'Choose who can see it.'
  return e
}
export function addNote(state, input, file, user, now = new Date()) {
  if (!user?.id || !(isStudent(user) || user.role === 'teacher' || isAdmin(user))) return fail(state, 'Sign in to share notes.')
  const errors = validateNote(input)
  if (Object.keys(errors).length) return fail(state, Object.values(errors)[0], errors)
  if (!file?.fileId) return fail(state, 'The file wasn’t saved, so the note wasn’t added.')
  const req = input.fulfils ? (state.noteRequests || []).find((r) => r.id === input.fulfils) : null
  if (input.fulfils && (!req || req.status !== REQ_STATUS.OPEN || !canSeeRequest(req, user))) return fail(state, 'That notes request is no longer open.')
  const n = { id: uid('note'), title: clean(input.title), description: clean(input.description).slice(0, 600), year: input.year, branch: input.branch, subject: clean(input.subject), topic: clean(input.topic), subtopic: clean(input.subtopic), scope: input.scope, file: { fileId: file.fileId, name: file.name, type: file.type, size: file.size }, uploaderId: user.id, uploaderName: user.name, at: now.toISOString(), updatedAt: now.toISOString(), downloads: 0 }
  let next = { ...state, notes: [n, ...(state.notes || [])] }
  if (req) {
    next = { ...next, noteRequests: next.noteRequests.map((r) => (r.id === req.id ? { ...r, status: REQ_STATUS.FULFILLED, noteId: n.id, fulfilledBy: user.name, fulfilledAt: now.toISOString() } : r)) }
    if (req.userId !== user.id) next = notify(next, [{ userId: req.userId, key: `noteReq:${req.id}`, category: 'notes', title: 'Your notes request was answered', body: `${user.name} shared “${n.title}” for ${req.subject} · ${req.topic}`, href: '#/notes?tab=requests' }], now)
  }
  return { ok: true, state: next, item: n }
}

/* ---------- notes requests ---------- */
export const REQ_STATUS = { OPEN: 'Open', FULFILLED: 'Fulfilled', CLOSED: 'Closed' }
/** Requests are visible to the requester, teachers, admins and students of the same year + branch. */
export const canSeeRequest = (r, user) => !!r && !!user && (r.userId === user.id || isAdmin(user) || user.role === 'teacher' || (isStudent(user) && user.year === r.year && user.branchId === r.branch))
export const requestsFor = (state, user) => (state.noteRequests || []).filter((r) => canSeeRequest(r, user)).sort((a, b) => b.at.localeCompare(a.at))

export function requestNotes(state, input, user, now = new Date()) {
  if (!isStudent(user)) return fail(state, 'Only students can request notes.')
  if (!user.year || !user.branchId) return fail(state, 'Add your year and branch to your profile first.')
  const subject = clean(input?.subject), topic = clean(input?.topic), details = clean(input?.details)
  const errors = {}
  if (subject.length < 2) errors.subject = 'Which course or subject?'
  else if (subject.length > 80) errors.subject = 'Keep the subject under 80 characters.'
  if (topic.length < 2) errors.topic = 'Which topic or chapter?'
  else if (topic.length > 120) errors.topic = 'Keep the topic under 120 characters.'
  if (details.length > 300) errors.details = 'Keep the details under 300 characters.'
  if (Object.keys(errors).length) return fail(state, Object.values(errors)[0], errors)
  const dup = (state.noteRequests || []).some((r) => r.userId === user.id && r.status === REQ_STATUS.OPEN && r.subject.toLowerCase() === subject.toLowerCase() && r.topic.toLowerCase() === topic.toLowerCase())
  if (dup) return fail(state, 'You already have an open request for this topic.', { topic: 'You already have an open request for this topic.' })
  const r = { id: uid('nreq'), userId: user.id, userName: user.name, year: user.year, branch: user.branchId, subject, topic, details, status: REQ_STATUS.OPEN, at: now.toISOString(), noteId: null, fulfilledBy: null }
  return { ok: true, state: { ...state, noteRequests: [r, ...(state.noteRequests || [])] }, item: r }
}

/** The requester (or an admin) closes an open request, or reopens a closed one. */
export function setNoteRequestStatus(state, id, status, user) {
  const r = (state.noteRequests || []).find((x) => x.id === id)
  if (!r) return fail(state, 'That request no longer exists.')
  if (r.userId !== user?.id && !isAdmin(user)) return fail(state, 'Only the student who asked can change this request.')
  if (!(status === REQ_STATUS.CLOSED && r.status === REQ_STATUS.OPEN) && !(status === REQ_STATUS.OPEN && r.status === REQ_STATUS.CLOSED)) return fail(state, `A ${r.status.toLowerCase()} request can’t be ${status === REQ_STATUS.OPEN ? 'reopened' : 'closed'}.`)
  return { ok: true, state: { ...state, noteRequests: state.noteRequests.map((x) => (x.id === id ? { ...x, status } : x)) } }
}
export const openReports = (state, noteId) => (state.noteReports || []).filter((r) => r.noteId === noteId && r.status === 'open')
/** Visibility: institute-wide notes for everyone signed in; group notes for that year+branch (and uploader/admin). */
export function canSeeNote(note, user, state) {
  if (!note || !user) return false
  if (note.uploaderId === user.id || isAdmin(user)) return true
  if (note.hidden || (state && openReports(state, note.id).length >= HIDE_AFTER)) return false
  if (note.scope === 'all') return true
  return user.year === note.year && user.branchId === note.branch
}
export function browseNotes(state, user, f = {}) {
  const q = clean(f.q).toLowerCase()
  const list = (state.notes || []).filter((n) => canSeeNote(n, user, state)
    && (!f.year || n.year === f.year) && (!f.branch || n.branch === f.branch) && (!f.subject || n.subject === f.subject) && (!f.topic || n.topic === f.topic) && (!f.subtopic || n.subtopic === f.subtopic)
    && (!f.type || (n.file.type || '').includes(f.type === 'pdf' ? 'pdf' : 'image')) && (!f.mine || n.uploaderId === user.id)
    && (!q || [n.title, n.description, n.subject, n.topic, n.subtopic].join(' ').toLowerCase().includes(q)))
  const sort = f.sort || 'new'
  return list.sort(sort === 'old' ? (a, b) => a.at.localeCompare(b.at) : sort === 'title' ? (a, b) => a.title.localeCompare(b.title) : (a, b) => b.at.localeCompare(a.at))
}
export function updateNote(state, id, patch, user, now = new Date()) {
  const n = (state.notes || []).find((x) => x.id === id)
  if (!n) return fail(state, 'That note no longer exists.')
  if (n.uploaderId !== user?.id && !isAdmin(user)) return fail(state, 'You can only edit notes you uploaded.')
  const upd = { ...n, ...Object.fromEntries(Object.entries(patch).filter(([k]) => ['title', 'description', 'year', 'branch', 'subject', 'topic', 'subtopic', 'scope'].includes(k)).map(([k, v]) => [k, typeof v === 'string' ? clean(v) : v])), updatedAt: now.toISOString() }
  const errors = validateNote(upd)
  if (Object.keys(errors).length) return fail(state, Object.values(errors)[0], errors)
  return { ok: true, state: { ...state, notes: state.notes.map((x) => (x.id === id ? upd : x)) }, item: upd }
}
export function removeNote(state, id, user) {
  const n = (state.notes || []).find((x) => x.id === id)
  if (!n) return fail(state, 'That note no longer exists.')
  if (n.uploaderId !== user?.id && !isAdmin(user)) return fail(state, 'You can only remove notes you uploaded.')
  return { ok: true, state: { ...state, notes: state.notes.filter((x) => x.id !== id), noteReports: (state.noteReports || []).filter((r) => r.noteId !== id) }, item: n }
}
export function reportNote(state, id, user, reason, details = '', now = new Date()) {
  const n = (state.notes || []).find((x) => x.id === id)
  if (!n || !canSeeNote(n, user, state)) return fail(state, 'That note isn’t available.')
  if (n.uploaderId === user.id) return fail(state, 'You can’t report your own note — edit or remove it instead.')
  if (!REPORT_REASONS.includes(reason)) return fail(state, 'Choose a reason.')
  if (openReports(state, id).some((r) => r.userId === user.id)) return fail(state, 'You already reported this note.')
  const r = { id: uid('rep'), noteId: id, userId: user.id, reason, details: clean(details).slice(0, 300), at: now.toISOString(), status: 'open' }
  return { ok: true, state: { ...state, noteReports: [...(state.noteReports || []), r] }, item: r }
}
export function resolveReports(state, noteId, actor, action) {
  if (!isAdmin(actor)) return fail(state, 'Only an admin can moderate notes.')
  const reports = (state.noteReports || []).map((r) => (r.noteId === noteId && r.status === 'open' ? { ...r, status: action === 'remove' ? 'upheld' : 'dismissed' } : r))
  const notes = action === 'remove' ? state.notes.filter((n) => n.id !== noteId) : state.notes.map((n) => (n.id === noteId ? { ...n, hidden: false } : n))
  return { ok: true, state: { ...state, notes, noteReports: reports } }
}
