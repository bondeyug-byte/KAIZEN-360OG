// Teacher posts: assignments, notices, lecture announcements and documents, each sent to an explicit audience
// of divisions. All access checks live here (pure functions over shared state) so the same rules can run on the
// server once the database phase lands. Students only ever receive posts through visiblePosts()/getPost().
import { uid } from './ids.js'
import { notify } from './notifications.js'
import { allDivisions, hasAcademicIdentity } from '../data/academics.js'

export const KIND = { assignment: 'Assignment', notice: 'Notice', lecture: 'Lecture announcement', document: 'Document' }
export const STATUS = { OPEN: 'Published', CLOSED: 'Closed', ARCHIVED: 'Archived' }
export const SUBST = { SUBMITTED: 'Submitted', REVIEWED: 'Reviewed', CHANGES: 'Changes requested', SUPERSEDED: 'Superseded' }
const fail = (state, error, errors) => ({ ok: false, state, error, errors })

export const isTeacher = (u) => u?.role === 'teacher'
export const isAdmin = (u) => u?.role === 'admin'
export const isStudent = (u) => !!u && !u.system && !['teacher', 'admin', 'organiser', 'hod', 'parent'].includes(u.role)
/** Divisions this staff member may send to: a teacher's own classes; an admin may send anywhere. */
export const allowedDivisions = (u) => (isAdmin(u) ? allDivisions() : isTeacher(u) ? [...new Set((u.teaches || []).map((t) => t.division))] : [])

/** Students (with a complete academic identity) in the audience. */
export function recipients(profiles, audience) {
  const set = new Set(audience?.divisions || [])
  return Object.values(profiles || {}).filter((p) => isStudent(p) && hasAcademicIdentity(p) && set.has(p.division)).sort((a, b) => (a.division + a.roll).localeCompare(b.division + b.roll))
}

export function validateAudience(audience, actor) {
  const divs = audience?.divisions || []
  if (!divs.length) return 'Choose at least one division.'
  const known = new Set(allDivisions()), allowed = new Set(allowedDivisions(actor))
  const bad = divs.find((d) => !known.has(d))
  if (bad) return `${bad} isn't a configured division.`
  const notMine = divs.find((d) => !allowed.has(d))
  if (notMine) return `You aren't assigned to ${notMine}.`
  return null
}

export function validatePost(input) {
  const e = {}
  if (!KIND[input.kind]) e.kind = 'Choose what you are sending.'
  if (!input.title?.trim()) e.title = 'Add a title.'
  else if (input.title.trim().length > 120) e.title = 'Keep the title under 120 characters.'
  if (!input.body?.trim() && input.kind !== 'document') e.body = 'Write the message or instructions.'
  if (input.kind === 'document' && !(input.attachments || []).length) e.attachments = 'Attach the document.'
  if (input.kind === 'assignment') { if (!Number.isFinite(Date.parse(input.deadline))) e.deadline = 'Set a deadline.' }
  if (input.kind === 'lecture') {
    if (!input.subject?.trim()) e.subject = 'Which subject?'
    if (!Number.isFinite(Date.parse(input.lectureAt))) e.lectureAt = 'Set the lecture date and time.'
  }
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) e.expiresAt = 'Expiry date is not valid.'
  return e
}

const audienceLabel = (a) => (a.divisions.length > 3 ? `${a.divisions.length} divisions` : a.divisions.join(', '))

export function createPost(state, input, actor, profiles, now = new Date()) {
  if (!isTeacher(actor) && !isAdmin(actor)) return fail(state, 'Only teachers can publish to classes.')
  const errors = validatePost(input)
  const aErr = validateAudience(input.audience, actor)
  if (aErr) errors.audience = aErr
  if (Object.keys(errors).length) return fail(state, Object.values(errors)[0], errors)
  if (input.kind === 'assignment' && Date.parse(input.deadline) <= now.getTime()) return fail(state, 'The deadline must be in the future.', { deadline: 'The deadline must be in the future.' })
  const to = recipients(profiles, input.audience)
  const post = {
    id: uid('post'), kind: input.kind, title: input.title.trim(), body: (input.body || '').trim(), audience: { divisions: [...new Set(input.audience.divisions)].sort() },
    deadline: input.kind === 'assignment' ? new Date(input.deadline).toISOString() : null,
    subject: input.subject?.trim() || '', lectureAt: input.kind === 'lecture' ? new Date(input.lectureAt).toISOString() : null, room: input.room || null,
    expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null, attachments: (input.attachments || []).map(({ fileId, name, type, size }) => ({ fileId, name, type, size })),
    acceptsUploads: input.kind === 'assignment' ? input.acceptsUploads !== false : false,
    status: STATUS.OPEN, createdBy: actor.id, createdByName: actor.name, createdAt: now.toISOString(), updatedAt: now.toISOString(), recipientCount: to.length, history: [{ at: now.toISOString(), by: actor.id, action: 'published' }],
  }
  let next = { ...state, posts: [post, ...(state.posts || [])] }
  next = notify(next, to.map((p) => ({ userId: p.id, key: `post-new:${post.id}`, category: 'classwork', title: `New ${KIND[post.kind].toLowerCase()} from ${actor.name}`, body: post.title, href: `#/classwork?id=${post.id}` })), now)
  return { ok: true, state: next, item: post, recipients: to }
}

/** May this user see this post? (Authors and admins always; students only in the audience, never archived.) */
export function canSee(post, user, now = new Date()) {
  if (!post || !user) return false
  if (post.createdBy === user.id || isAdmin(user)) return true
  if (!isStudent(user) || !user.division) return false
  if (post.status === STATUS.ARCHIVED) return false
  if (post.expiresAt && Date.parse(post.expiresAt) < now.getTime() && post.kind !== 'assignment') return false
  return Array.isArray(post.audience?.divisions) && post.audience.divisions.includes(user.division)
}
export const getPost = (state, id, user, now) => { const p = (state.posts || []).find((x) => x.id === id); return canSee(p, user, now) ? p : null }
export const visiblePosts = (state, user, now = new Date()) => (state.posts || []).filter((p) => canSee(p, user, now)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
export const sentBy = (state, user) => (state.posts || []).filter((p) => p.createdBy === user.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

function editable(state, id, actor) {
  const p = (state.posts || []).find((x) => x.id === id)
  if (!p) return { error: 'That item no longer exists.' }
  if (p.createdBy !== actor?.id && !isAdmin(actor)) return { error: 'Only the teacher who sent this can change it.' }
  return { p }
}

export function updatePost(state, id, patch, actor, profiles, now = new Date()) {
  const { p, error } = editable(state, id, actor)
  if (error) return fail(state, error)
  const upd = { ...p, ...patch, audience: p.audience, kind: p.kind } // audience is fixed after publishing (kept for the audit trail)
  if (patch.deadline) upd.deadline = new Date(patch.deadline).toISOString()
  if (patch.lectureAt) upd.lectureAt = new Date(patch.lectureAt).toISOString()
  const errors = validatePost(upd)
  if (Object.keys(errors).length) return fail(state, Object.values(errors)[0], errors)
  upd.updatedAt = now.toISOString(); upd.history = [...p.history, { at: upd.updatedAt, by: actor.id, action: 'edited' }]
  let next = { ...state, posts: state.posts.map((x) => (x.id === id ? upd : x)) }
  next = notify(next, recipients(profiles, p.audience).map((s) => ({ userId: s.id, key: `post-upd:${id}:${upd.updatedAt}`, category: 'classwork', title: `Updated: ${upd.title}`, body: `${KIND[upd.kind]} from ${p.createdByName} was edited.`, href: `#/classwork?id=${id}` })), now)
  return { ok: true, state: next, item: upd }
}

export function setPostStatus(state, id, status, actor, profiles, now = new Date()) {
  const { p, error } = editable(state, id, actor)
  if (error) return fail(state, error)
  if (!Object.values(STATUS).includes(status)) return fail(state, 'Unknown status.')
  const upd = { ...p, status, updatedAt: now.toISOString(), history: [...p.history, { at: now.toISOString(), by: actor.id, action: status.toLowerCase() }] }
  let next = { ...state, posts: state.posts.map((x) => (x.id === id ? upd : x)) }
  if (status === STATUS.CLOSED) next = notify(next, recipients(profiles, p.audience).map((s) => ({ userId: s.id, key: `post-close:${id}`, category: 'classwork', title: `Closed: ${p.title}`, body: `${p.createdByName} closed this ${KIND[p.kind].toLowerCase()}.`, href: `#/classwork?id=${id}` })), now)
  return { ok: true, state: next, item: upd }
}

/* ---------- assignment submissions ---------- */
export const subsFor = (state, postId) => (state.postSubs || []).filter((s) => s.postId === postId)
export const mySubs = (state, postId, userId) => subsFor(state, postId).filter((s) => s.userId === userId).sort((a, b) => b.attempt - a.attempt)

export function canSubmitAssignment(state, post, user, now = new Date()) {
  if (!post || post.kind !== 'assignment' || !post.acceptsUploads) return { ok: false, reason: 'This item doesn’t take submissions.' }
  if (!canSee(post, user, now) || !isStudent(user)) return { ok: false, reason: 'This assignment isn’t for your division.' }
  if (post.status !== STATUS.OPEN) return { ok: false, reason: 'This assignment is closed.' }
  if (Date.parse(post.deadline) < now.getTime()) return { ok: false, reason: 'The deadline has passed.' }
  const last = mySubs(state, post.id, user.id)[0]
  if (last?.status === SUBST.REVIEWED) return { ok: false, reason: 'Your submission has been reviewed.' }
  return { ok: true, resubmit: !!last }
}

export function submitAssignment(state, postId, user, file, notes = '', now = new Date()) {
  const post = (state.posts || []).find((p) => p.id === postId)
  const c = canSubmitAssignment(state, post, user, now)
  if (!c.ok) return fail(state, c.reason)
  if (!file?.fileId) return fail(state, 'The file wasn’t saved, so nothing was submitted.')
  const prev = mySubs(state, postId, user.id)
  const sub = { id: uid('asub'), postId, userId: user.id, userName: user.name, division: user.division, roll: user.roll, attempt: (prev[0]?.attempt || 0) + 1, at: now.toISOString(), file: { fileId: file.fileId, name: file.name, type: file.type, size: file.size }, notes: notes.trim().slice(0, 1000), status: SUBST.SUBMITTED, feedback: '' }
  const subs = (state.postSubs || []).map((s) => (s.postId === postId && s.userId === user.id && s.status === SUBST.SUBMITTED ? { ...s, status: SUBST.SUPERSEDED } : s))
  let next = { ...state, postSubs: [...subs, sub] }
  next = notify(next, [{ userId: post.createdBy, key: `asub-new:${sub.id}`, category: 'classwork', title: 'New assignment submission', body: `${user.name} (${user.roll}) · ${post.title}`, href: `#/teacher?tab=subs&id=${post.id}` }], now)
  return { ok: true, state: next, item: sub }
}

export function reviewAssignment(state, subId, actor, decision, feedback = '', now = new Date()) {
  const sub = (state.postSubs || []).find((s) => s.id === subId)
  if (!sub) return fail(state, 'That submission no longer exists.')
  const post = state.posts.find((p) => p.id === sub.postId)
  if (!post || (post.createdBy !== actor?.id && !isAdmin(actor))) return fail(state, 'Only the teacher who set this assignment can review it.')
  if (sub.status !== SUBST.SUBMITTED) return fail(state, `This attempt is already ${sub.status.toLowerCase()}.`)
  const status = decision === 'reviewed' ? SUBST.REVIEWED : decision === 'changes' ? SUBST.CHANGES : null
  if (!status) return fail(state, 'Unknown decision.')
  if (status === SUBST.CHANGES && !feedback.trim()) return fail(state, 'Add feedback so the student knows what to change.')
  const upd = { ...sub, status, feedback: feedback.trim(), reviewedBy: actor.id, reviewedAt: now.toISOString() }
  let next = { ...state, postSubs: state.postSubs.map((s) => (s.id === subId ? upd : s)) }
  next = notify(next, [{ userId: sub.userId, key: `asub-rev:${subId}:${status}`, category: 'classwork', title: status === SUBST.REVIEWED ? 'Assignment reviewed' : 'Changes requested on your assignment', body: `${post.title}${feedback.trim() ? ': ' + feedback.trim() : ''}`, href: `#/classwork?id=${post.id}` }], now)
  return { ok: true, state: next, item: upd }
}
