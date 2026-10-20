// Class challenge board. Leaderboard is always derived from recorded completions.
import { uid } from './ids.js'
import { notify, studentIds } from './notifications.js'
import { validateAudience, recipients, isAdmin, isStudent } from './posts.js'

/** Teachers (and admins) create and manage challenges; students only view, complete and submit solutions. */
export const canManageChallenges = (u) => u?.role === 'teacher' || isAdmin(u)
/** A class representative (flag set by the app, not by the student) may post challenges for their own division only. */
export const isClassRep = (u) => isStudent(u) && !!u.classRep && !!u.division
export const canPostChallenge = (u) => canManageChallenges(u) || isClassRep(u)
/** Who posted it, for labels: teacher, class rep, or (older sample data) a student. */
export const authorRole = (c) => c.byRole || (c.audience ? 'teacher' : 'student')
const isAuthor = (ch, u) => !!u && ((canManageChallenges(u) && (ch.createdBy === u.id || isAdmin(u))) || (isClassRep(u) && ch.createdBy === u.id))

const fail = (state, error) => ({ ok: false, state, error })

export function validateChallenge(input) {
  const e = []
  if (!input?.title?.trim()) e.push('Give the challenge a title.')
  else if (input.title.trim().length > 80) e.push('Keep the title under 80 characters.')
  if (!input?.description?.trim()) e.push('Describe what students need to do.')
  if (!input?.classId && !input?.audience) e.push('Choose which class the challenge is for.')
  if (!Number.isInteger(input?.points) || input.points < 1 || input.points > 500) e.push('Points must be a whole number from 1 to 500.')
  if (input?.deadline && !Number.isFinite(Date.parse(input.deadline))) e.push('Deadline is not a valid date.')
  return e
}

export const DEFAULT_SUBMISSION = { required: false, types: ['pdf', 'jpg', 'png'], maxMB: 10 }
export const SUB = { SUBMITTED: 'Submitted', ACCEPTED: 'Accepted', CHANGES: 'Changes requested', REJECTED: 'Rejected', SUPERSEDED: 'Superseded' }
export const needsSubmission = (ch) => !!ch?.submission?.required

/** Post a challenge. profiles (optional) → every eligible student except the author is notified. */
export function postChallenge(state, input, user, now = new Date(), profiles = null) {
  if (!user?.id) return fail(state, 'Sign in to post a challenge.')
  if (!canPostChallenge(user)) return fail(state, 'Only teachers and class representatives can create challenges.')
  if (!input?.audience) return fail(state, 'Choose the divisions this challenge is for.')
  const rep = !canManageChallenges(user)
  const errors = validateChallenge(input)
  if (rep) { if (input.audience.divisions?.length !== 1 || input.audience.divisions[0] !== user.division) errors.push(`As class rep you can post only for ${user.division}.`); if (input.points > 100) errors.push('Class rep challenges are worth at most 100 points.') }
  else { const a = validateAudience(input.audience, user); if (a) errors.push(a) }
  if (errors.length) return { ...fail(state, errors[0]), errors }
  const ch = {
    id: uid('ch'), title: input.title.trim(), description: input.description.trim(), classId: input.audience ? 'DIV' : input.classId,
    audience: input.audience ? { divisions: [...new Set(input.audience.divisions)].sort() } : null, status: 'open',
    points: input.points, deadline: input.deadline ? new Date(input.deadline).toISOString() : null,
    createdBy: user.id, createdByName: user.name, byRole: rep ? 'classRep' : 'teacher', createdAt: now.toISOString(), demo: false,
    attachments: (input.attachments || []).map(({ fileId, name, type, size }) => ({ fileId, name, type, size })),
    submission: !rep && input.submission?.required ? { required: true, types: input.submission.types?.length ? input.submission.types : DEFAULT_SUBMISSION.types, maxMB: input.submission.maxMB || DEFAULT_SUBMISSION.maxMB } : null,
  }
  let next = { ...state, challenges: [ch, ...state.challenges] }
  if (profiles) {
    const who = ch.audience ? recipients(profiles, ch.audience).map((p) => p.id).filter((id) => id !== user.id) : studentIds(profiles).filter((id) => id !== user.id && eligible(ch, profiles[id]))
    next = notify(next, who.map((id) => ({ userId: id, key: `ch-new:${ch.id}`, category: 'challenge', title: rep ? `Class rep ${user.name} posted a challenge` : 'New challenge for your class', body: `${ch.title} · +${ch.points} points${ch.deadline ? '' : ''}`, href: `#/challenges?id=${ch.id}` })), now)
  }
  return { ok: true, state: next, item: ch }
}

/** Division-targeted challenges (teacher posts) reach only their divisions; older class challenges keep classId rules. Archived ones reach no one. */
export const eligible = (challenge, user) => {
  if (!user || challenge.status === 'archived') return false
  if (challenge.audience) return !!user.division && challenge.audience.divisions.includes(user.division)
  return !!user.classId && (challenge.classId === 'ALL' || challenge.classId === user.classId)
}
/** Can this user see the challenge at all (list, direct link, search)? */
export const canView = (challenge, user) => !challenge.audience || eligible(challenge, user) || challenge.createdBy === user?.id || isAdmin(user)
export const audienceText = (c) => (c.audience ? c.audience.divisions.join(', ') : c.classId)

/** Author closes (no more completions/submissions) or archives (hidden from students) a challenge. */
export function setChallengeStatus(state, challengeId, status, actor, now = new Date()) {
  const ch = state.challenges.find((c) => c.id === challengeId)
  if (!ch) return fail(state, 'That challenge no longer exists.')
  if (!isAuthor(ch, actor)) return fail(state, 'Only the teacher who posted this challenge can change it.')
  if (!['open', 'closed', 'archived'].includes(status)) return fail(state, 'Unknown status.')
  const upd = { ...ch, status, deadline: status === 'closed' && (!ch.deadline || Date.parse(ch.deadline) > now.getTime()) ? now.toISOString() : ch.deadline, updatedAt: now.toISOString() }
  return { ok: true, state: { ...state, challenges: state.challenges.map((c) => (c.id === challengeId ? upd : c)) }, item: upd }
}
/** Author edits a challenge. Audience stays fixed after sending (students were already notified). */
export function updateChallenge(state, challengeId, patch, actor, now = new Date()) {
  const ch = state.challenges.find((c) => c.id === challengeId)
  if (!ch) return fail(state, 'That challenge no longer exists.')
  if (!isAuthor(ch, actor)) return fail(state, 'Only the teacher who posted this challenge can edit it.')
  const next = {
    title: patch.title !== undefined ? String(patch.title) : ch.title,
    description: patch.description !== undefined ? String(patch.description) : ch.description,
    points: patch.points !== undefined ? Number(patch.points) : ch.points,
    deadline: patch.deadline !== undefined ? (patch.deadline || null) : ch.deadline,
  }
  const errors = validateChallenge({ ...next, audience: ch.audience, classId: ch.classId })
  if (next.deadline && Date.parse(next.deadline) <= now.getTime() && next.deadline !== ch.deadline) errors.push('A new deadline must be in the future.')
  if (errors.length) return { ...fail(state, errors[0]), errors }
  const changes = Object.keys(next).filter((k) => String(next[k] ?? '') !== String(ch[k] ?? ''))
  if (!changes.length) return fail(state, 'Nothing changed.')
  const upd = { ...ch, title: next.title.trim(), description: next.description.trim(), points: next.points, deadline: next.deadline ? new Date(next.deadline).toISOString() : null, updatedAt: now.toISOString(), history: [...(ch.history || []), { at: now.toISOString(), by: actor.id, action: `edited ${changes.join(', ')}` }] }
  return { ok: true, state: { ...state, challenges: state.challenges.map((c) => (c.id === challengeId ? upd : c)) }, item: upd }
}

/**
 * Author deletes a challenge and its pending submissions. Refused once points were awarded (the leaderboard is
 * built from those records) — archive it instead. Returns the file ids the caller should remove from storage.
 */
export function deleteChallenge(state, challengeId, actor) {
  const ch = state.challenges.find((c) => c.id === challengeId)
  if (!ch) return fail(state, 'That challenge no longer exists.')
  if (!isAuthor(ch, actor)) return fail(state, 'Only the teacher who posted this challenge can delete it.')
  if (state.completions.some((c) => c.challengeId === challengeId)) return fail(state, 'Points were already awarded for this challenge, so it can’t be deleted. Archive it instead.')
  const subs = (state.submissions || []).filter((s) => s.challengeId === challengeId)
  const fileIds = [...(ch.attachments || []).map((a) => a.fileId), ...subs.map((s) => s.file?.fileId)].filter(Boolean)
  return { ok: true, state: { ...state, challenges: state.challenges.filter((c) => c.id !== challengeId), submissions: (state.submissions || []).filter((s) => s.challengeId !== challengeId), notifications: (state.notifications || []).filter((n) => !String(n.href || '').includes(`id=${challengeId}`)) }, fileIds }
}

export const hasCompleted = (state, challengeId, userId) => state.completions.some((c) => c.challengeId === challengeId && c.userId === userId)

export function completeChallenge(state, challengeId, user, now = new Date()) {
  if (!user?.id) return fail(state, 'Sign in to complete challenges.')
  if (!isStudent(user)) return fail(state, 'Only students complete challenges.')
  const ch = state.challenges.find((c) => c.id === challengeId)
  if (!ch) return fail(state, 'That challenge no longer exists.')
  if (ch.createdBy === user.id) return fail(state, 'You posted this challenge, so you can’t earn its points.')
  if (ch.status === 'closed') return fail(state, 'This challenge has closed.')
  if (!eligible(ch, user)) return fail(state, `This challenge is for ${ch.classId}.`)
  if (ch.deadline && Date.parse(ch.deadline) < now.getTime()) return fail(state, 'This challenge has closed.')
  if (hasCompleted(state, challengeId, user.id)) return fail(state, 'You have already completed this challenge — points are only awarded once.')
  if (needsSubmission(ch)) return fail(state, 'This challenge needs a solution upload. Use “Submit solution”; points are added when the reviewer accepts it.')
  const rec = { id: uid('done'), challengeId, userId: user.id, userName: user.name, classId: user.classId, points: ch.points, completedAt: now.toISOString() }
  return { ok: true, state: { ...state, completions: [...state.completions, rec] }, item: rec }
}

export function leaderboard(state) {
  const byClass = new Map(), byStudent = new Map()
  for (const c of state.completions) {
    byClass.set(c.classId, (byClass.get(c.classId) || 0) + c.points)
    const s = byStudent.get(c.userId) || { userId: c.userId, name: c.userName, classId: c.classId, points: 0, done: 0 }
    s.points += c.points; s.done += 1
    byStudent.set(c.userId, s)
  }
  const classes = [...byClass].map(([classId, points]) => ({ classId, points })).sort((a, b) => b.points - a.points || a.classId.localeCompare(b.classId))
  const students = [...byStudent.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
  return { classes, students }
}

/* ---------------- Resources and solution submissions ---------------- */
export const canReview = (ch, user) => isAuthor(ch, user)

/** Creator adds resource files (already stored; only metadata is recorded here). */
export function addResources(state, challengeId, files, user) {
  const ch = state.challenges.find((c) => c.id === challengeId)
  if (!ch) return fail(state, 'That challenge no longer exists.')
  if (!isAuthor(ch, user)) return fail(state, 'Only the teacher who posted this challenge can add resources.')
  if (!files?.length) return fail(state, 'Choose at least one file.')
  const upd = { ...ch, attachments: [...(ch.attachments || []), ...files.map(({ fileId, name, type, size }) => ({ fileId, name, type, size }))] }
  return { ok: true, state: { ...state, challenges: state.challenges.map((c) => (c.id === challengeId ? upd : c)) }, item: upd }
}

export const submissionsFor = (state, challengeId) => (state.submissions || []).filter((s) => s.challengeId === challengeId)
export const mySubmissions = (state, challengeId, userId) => submissionsFor(state, challengeId).filter((s) => s.userId === userId).sort((a, b) => b.attempt - a.attempt)

/** Can this student submit (or resubmit) now? Rules: open challenge, eligible class, not already accepted or rejected. */
export function canSubmit(state, ch, user, now = new Date()) {
  if (!user?.id) return { ok: false, reason: 'Sign in to submit.' }
  if (!isStudent(user)) return { ok: false, reason: 'Only students submit solutions.' }
  if (!needsSubmission(ch)) return { ok: false, reason: 'This challenge doesn\u2019t take uploads.' }
  if (!eligible(ch, user)) return { ok: false, reason: `This challenge is for ${ch.classId}.` }
  if (ch.deadline && Date.parse(ch.deadline) < now.getTime()) return { ok: false, reason: 'This challenge has closed.' }
  const last = mySubmissions(state, ch.id, user.id)[0]
  if (last?.status === SUB.ACCEPTED || hasCompleted(state, ch.id, user.id)) return { ok: false, reason: 'Your solution was accepted.' }
  if (last?.status === SUB.REJECTED) return { ok: false, reason: 'Your solution was rejected; resubmission is closed.' }
  return { ok: true, resubmit: !!last }
}

/** Record a submission AFTER its file has been stored. A pending earlier attempt is marked Superseded. */
export function submitSolution(state, challengeId, user, file, notes = '', now = new Date()) {
  const ch = state.challenges.find((c) => c.id === challengeId)
  if (!ch) return fail(state, 'That challenge no longer exists.')
  const c = canSubmit(state, ch, user, now)
  if (!c.ok) return fail(state, c.reason)
  if (!file?.fileId) return fail(state, 'The file wasn\u2019t saved, so nothing was submitted.')
  const mine = mySubmissions(state, challengeId, user.id)
  const sub = { id: uid('sub'), challengeId, userId: user.id, userName: user.name, classId: user.classId, attempt: (mine[0]?.attempt || 0) + 1, at: now.toISOString(), file: { fileId: file.fileId, name: file.name, type: file.type, size: file.size }, notes: notes.trim().slice(0, 1000), status: SUB.SUBMITTED, feedback: '', reviewedBy: null, reviewedAt: null }
  const subs = (state.submissions || []).map((s) => (s.challengeId === challengeId && s.userId === user.id && s.status === SUB.SUBMITTED ? { ...s, status: SUB.SUPERSEDED } : s))
  let next = { ...state, submissions: [...subs, sub] }
  next = notify(next, [{ userId: ch.createdBy, key: `sub-new:${sub.id}`, category: 'challenge', title: 'New solution to review', body: `${user.name} submitted attempt ${sub.attempt} for ${ch.title}`, href: `#/challenges?id=${ch.id}&review=1` }], now)
  return { ok: true, state: next, item: sub }
}

/** Reviewer decision. 'accept' awards the challenge points exactly once through the normal completion record. */
export function reviewSubmission(state, subId, actor, decision, feedback = '', now = new Date()) {
  const sub = (state.submissions || []).find((s) => s.id === subId)
  if (!sub) return fail(state, 'That submission no longer exists.')
  const ch = state.challenges.find((c) => c.id === sub.challengeId)
  if (!ch) return fail(state, 'That challenge no longer exists.')
  if (!canReview(ch, actor)) return fail(state, 'Only the teacher who posted this challenge can review submissions.')
  if (sub.userId === actor.id) return fail(state, 'You can\u2019t review your own submission.')
  if (sub.status !== SUB.SUBMITTED) return fail(state, `This attempt is already ${sub.status.toLowerCase()}.`)
  const status = decision === 'accept' ? SUB.ACCEPTED : decision === 'changes' ? SUB.CHANGES : decision === 'reject' ? SUB.REJECTED : null
  if (!status) return fail(state, 'Unknown decision.')
  if (status !== SUB.ACCEPTED && !feedback.trim()) return fail(state, 'Add feedback so the student knows what to change.')
  const upd = { ...sub, status, feedback: feedback.trim(), reviewedBy: actor.id, reviewedAt: now.toISOString() }
  let next = { ...state, submissions: state.submissions.map((s) => (s.id === subId ? upd : s)) }
  let awarded = 0
  if (status === SUB.ACCEPTED && !hasCompleted(next, ch.id, sub.userId)) {
    next = { ...next, completions: [...next.completions, { id: uid('done'), challengeId: ch.id, userId: sub.userId, userName: sub.userName, classId: sub.classId, points: ch.points, completedAt: now.toISOString(), submissionId: sub.id }] }
    awarded = ch.points
  }
  const title = status === SUB.ACCEPTED ? 'Solution accepted' : status === SUB.CHANGES ? 'Changes requested on your solution' : 'Solution rejected'
  const body = status === SUB.ACCEPTED ? `${ch.title}: +${awarded} points added to your class.${feedback.trim() ? ' “' + feedback.trim() + '”' : ''}` : `${ch.title}: ${feedback.trim()}`
  next = notify(next, [{ userId: sub.userId, key: `sub-rev:${sub.id}:${status}`, category: 'challenge', title, body, href: `#/challenges?id=${ch.id}` }], now)
  return { ok: true, state: next, item: upd, awarded }
}
