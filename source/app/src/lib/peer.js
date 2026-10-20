// Peer learning with time credits.
// Fixed rule: teach 1 completed hour = earn 1 credit; learn 1 completed hour = spend 1 credit.
// Balances are ALWAYS derived from the ledger. Booking reserves credits (shown separately);
// credits only move when a session is Completed, exactly once per session.
import { uid } from './ids.js'
import { isStudent } from './posts.js'
import { notify } from './notifications.js'
const other = (s, actor) => (actor.id === s.teacherId ? s.learnerId : s.teacherId)
const N = (state, list) => (state.notifications ? notify(state, list) : state)

export const SESSION = { MATCHED: 'Matched', BOOKED: 'Booked', COMPLETED: 'Completed' }
const fail = (state, error) => ({ ok: false, state, error })
const norm = (s) => String(s || '').trim().toLowerCase()

export function balanceOf(state, userId) {
  return state.ledger.filter((t) => t.userId === userId).reduce((a, t) => a + (t.type === 'earn' ? t.amount : -t.amount), 0)
}
export function reservedOf(state, userId) {
  return state.sessions.filter((s) => s.learnerId === userId && s.status === SESSION.BOOKED).reduce((a, s) => a + s.hours, 0)
}
export function creditsOf(state, userId) {
  const balance = balanceOf(state, userId), reserved = reservedOf(state, userId)
  return { balance, reserved, available: balance - reserved }
}

const cleanText = (t) => String(t || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()
export function validateOffer(input) {
  const e = []
  if (!input?.skill?.trim()) e.push('Name the skill or subject.')
  else if (input.skill.trim().length > 60) e.push('Keep the skill under 60 characters.')
  if (cleanText(input?.course).length > 60) e.push('Keep the course under 60 characters.')
  if (cleanText(input?.qualifications).length > 200) e.push('Keep qualifications under 200 characters.')
  const topics = input?.topics || []
  if (topics.length > 8) e.push('List at most 8 topics.')
  if (topics.some((t) => cleanText(t).length > 40)) e.push('Keep each topic under 40 characters.')
  return e
}
export function validateLearnRequest(input) {
  const e = []
  if (!input?.skill?.trim()) e.push('Name the skill or subject you want to learn.')
  if (!Number.isInteger(input?.hours) || input.hours < 1 || input.hours > 4) e.push('Hours must be a whole number from 1 to 4.')
  return e
}

export function addOffer(state, input, user) {
  if (!user?.id) return fail(state, 'Sign in to offer teaching.')
  if (!isStudent(user)) return fail(state, 'Peer tutoring is for students.')
  const errors = validateOffer(input)
  if (errors.length) return fail(state, errors[0])
  if (state.offers.some((o) => o.userId === user.id && norm(o.skill) === norm(input.skill))) return fail(state, 'You already offer this skill.')
  const offer = { id: uid('offer'), userId: user.id, userName: user.name, skill: cleanText(input.skill), level: cleanText(input.level) || 'Beginner-friendly', course: cleanText(input.course), studyYear: cleanText(input.studyYear), qualifications: cleanText(input.qualifications), topics: (input.topics || []).map(cleanText).filter(Boolean), demo: false }
  return { ok: true, state: { ...state, offers: [...state.offers, offer] }, item: offer }
}

export function addLearnRequest(state, input, user) {
  if (!user?.id) return fail(state, 'Sign in to ask for help.')
  const errors = validateLearnRequest(input)
  if (errors.length) return fail(state, errors[0])
  if (state.learnRequests.some((r) => r.userId === user.id && norm(r.skill) === norm(input.skill))) return fail(state, 'You already asked to learn this.')
  const req = { id: uid('learn'), userId: user.id, userName: user.name, skill: input.skill.trim(), hours: input.hours, demo: false }
  return { ok: true, state: { ...state, learnRequests: [...state.learnRequests, req] }, item: req }
}

/** Suggest teachers for each of the user's learning requests, scored on skill + shared subjects/interests. */
export function findMatches(state, profiles, userId) {
  const me = profiles[userId] || {}
  const mine = new Set([...(me.subjects || []), ...(me.interests || [])].map(norm))
  return state.learnRequests
    .filter((r) => r.userId === userId)
    .map((req) => ({
      request: req,
      teachers: state.offers
        .filter((o) => o.userId !== userId && (norm(o.skill) === norm(req.skill) || norm(o.skill).includes(norm(req.skill)) || norm(req.skill).includes(norm(o.skill))))
        .map((o) => {
          const p = profiles[o.userId] || {}
          const shared = [...(p.subjects || []), ...(p.interests || [])].filter((x) => mine.has(norm(x)))
          return { offer: o, score: (norm(o.skill) === norm(req.skill) ? 3 : 1) + shared.length, shared }
        })
        .sort((a, b) => b.score - a.score),
    }))
}

const activeStatuses = [SESSION.MATCHED, SESSION.BOOKED]

export function createMatch(state, offerId, requestId, actor) {
  if (!actor?.id) return fail(state, 'Sign in first.')
  const offer = state.offers.find((o) => o.id === offerId)
  const req = state.learnRequests.find((r) => r.id === requestId)
  if (!offer || !req) return fail(state, 'That offer or request no longer exists.')
  if (offer.userId === req.userId) return fail(state, "You can't match with yourself.")
  if (actor.id !== req.userId && actor.id !== offer.userId) return fail(state, 'Only the learner or the teacher can create this match.')
  if (state.sessions.some((s) => s.offerId === offerId && s.requestId === requestId && activeStatuses.includes(s.status)))
    return fail(state, 'You are already matched for this.')
  const s = { id: uid('sess'), offerId, requestId, teacherId: offer.userId, teacherName: offer.userName, learnerId: req.userId, learnerName: req.userName, skill: req.skill, hours: req.hours, status: SESSION.MATCHED, scheduledAt: null, createdAt: new Date().toISOString() }
  return { ok: true, state: N({ ...state, sessions: [...state.sessions, s] }, [{ userId: other(s, actor), key: `peer-m:${s.id}`, category: 'peer', title: `New peer-learning match: ${s.skill}`, body: `${actor.name} matched with you (${s.learnerName} learns from ${s.teacherName}).`, href: '#/peer' }]), item: s }
}

export function bookSession(state, sessionId, actor, scheduledAt) {
  const s = state.sessions.find((x) => x.id === sessionId)
  if (!s) return fail(state, 'That session no longer exists.')
  if (actor?.id !== s.learnerId && actor?.id !== s.teacherId) return fail(state, 'Only the two students in this session can book it.')
  if (s.status !== SESSION.MATCHED) return fail(state, `A ${s.status} session can't be booked.`)
  if (!Number.isFinite(Date.parse(scheduledAt))) return fail(state, 'Choose a valid time for the session.')
  const { available } = creditsOf(state, s.learnerId)
  if (available < s.hours) return fail(state, `${s.learnerName} needs ${s.hours} available credit${s.hours > 1 ? 's' : ''} (has ${available}). Teach a session to earn more.`)
  const u = { ...s, status: SESSION.BOOKED, scheduledAt: new Date(scheduledAt).toISOString() }
  return { ok: true, state: N({ ...state, sessions: state.sessions.map((x) => (x.id === sessionId ? u : x)) }, [{ userId: other(s, actor), key: `peer-b:${s.id}:${u.scheduledAt}`, category: 'peer', title: `Session booked: ${s.skill}`, body: `${actor.name} booked ${new Date(u.scheduledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}.`, href: '#/peer' }]), item: u }
}

export function cancelBooking(state, sessionId, actor) {
  const s = state.sessions.find((x) => x.id === sessionId)
  if (!s) return fail(state, 'That session no longer exists.')
  if (actor?.id !== s.learnerId && actor?.id !== s.teacherId) return fail(state, 'Only the two students in this session can cancel it.')
  if (s.status !== SESSION.BOOKED) return fail(state, 'Only booked sessions can be cancelled.')
  const u = { ...s, status: SESSION.MATCHED, scheduledAt: null }
  return { ok: true, state: N({ ...state, sessions: state.sessions.map((x) => (x.id === sessionId ? u : x)) }, [{ userId: other(s, actor), key: `peer-c:${s.id}:${Date.now()}`, category: 'peer', title: `Booking cancelled: ${s.skill}`, body: `${actor.name} cancelled the booked time.`, href: '#/peer' }]), item: u }
}

export function completeSession(state, sessionId, actor, now = new Date()) {
  const s = state.sessions.find((x) => x.id === sessionId)
  if (!s) return fail(state, 'That session no longer exists.')
  if (actor?.id !== s.learnerId && actor?.id !== s.teacherId) return fail(state, 'Only the two students in this session can complete it.')
  if (state.ledger.some((t) => t.sessionId === sessionId)) return fail(state, 'Credits for this session were already settled.')
  if (s.status === SESSION.COMPLETED) return fail(state, 'This session is already completed.')
  if (s.status !== SESSION.BOOKED) return fail(state, 'Book the session before marking it completed.')
  if (balanceOf(state, s.learnerId) < s.hours) return fail(state, `${s.learnerName} doesn't have enough credits.`)
  const at = now.toISOString()
  const tx = [
    { id: uid('tx'), sessionId, userId: s.teacherId, type: 'earn', amount: s.hours, at, note: `Taught ${s.skill} to ${s.learnerName}` },
    { id: uid('tx'), sessionId, userId: s.learnerId, type: 'spend', amount: s.hours, at, note: `Learned ${s.skill} from ${s.teacherName}` },
  ]
  const u = { ...s, status: SESSION.COMPLETED, completedAt: at }
  return { ok: true, state: { ...state, sessions: state.sessions.map((x) => (x.id === sessionId ? u : x)), ledger: [...state.ledger, ...tx] }, item: u }
}

/* ---------- tutor reviews (demo: one review per student per tutor, editable) ---------- */
export function tutorRating(state, tutorId) {
  const list = (state.tutorReviews || []).filter((r) => r.tutorId === tutorId)
  return { count: list.length, avg: list.length ? Math.round((list.reduce((a, r) => a + r.rating, 0) / list.length) * 10) / 10 : null, list: list.sort((a, b) => b.at.localeCompare(a.at)) }
}
export function saveTutorReview(state, tutorId, user, { rating, text }, now = new Date()) {
  if (!isStudent(user)) return fail(state, 'Only students can review tutors.')
  if (!state.offers.some((o) => o.userId === tutorId)) return fail(state, 'That tutor no longer offers sessions.')
  if (tutorId === user.id) return fail(state, 'You can’t review yourself.')
  const r = Number(rating)
  if (!Number.isInteger(r) || r < 1 || r > 5) return fail(state, 'Choose 1 to 5 stars.')
  const body = cleanText(text)
  if (body.length > 300) return fail(state, 'Keep the review under 300 characters.')
  const list = state.tutorReviews || []
  const mine = list.find((x) => x.tutorId === tutorId && x.userId === user.id)
  if (mine) { const upd = { ...mine, rating: r, text: body, at: now.toISOString() }; return { ok: true, state: { ...state, tutorReviews: list.map((x) => (x.id === mine.id ? upd : x)) }, item: upd, updated: true } }
  const rec = { id: uid('trev'), tutorId, userId: user.id, userName: user.name, rating: r, text: body, at: now.toISOString() }
  return { ok: true, state: { ...state, tutorReviews: [...list, rec] }, item: rec }
}
export function deleteTutorReview(state, reviewId, user) {
  const r = (state.tutorReviews || []).find((x) => x.id === reviewId)
  if (!r) return fail(state, 'That review no longer exists.')
  if (r.userId !== user?.id && user?.role !== 'admin') return fail(state, 'You can only remove your own review.')
  return { ok: true, state: { ...state, tutorReviews: state.tutorReviews.filter((x) => x.id !== reviewId) } }
}
