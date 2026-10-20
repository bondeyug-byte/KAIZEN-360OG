// QA phase I — authorization and malformed-input checks on every state transition.
// These run against the pure logic layer that the UI calls. There is no server yet, so they prove the
// client-side rules only; server-side enforcement is BLOCKED until a backend exists.
import { describe, it, expect } from 'vitest'
import { makeSeed } from '../src/data/seed.js'
import { createPost, updatePost, setPostStatus, getPost, reviewAssignment, submitAssignment } from '../src/lib/posts.js'
import { postChallenge, setChallengeStatus, canView } from '../src/lib/challenges.js'
import { createSession, editSession, studentSummary } from '../src/lib/attendance.js'
import { saveReview, deleteReview, upsertDish, removeDish } from '../src/lib/canteen.js'
import { addNote, canSeeNote, updateNote, removeNote, resolveReports } from '../src/lib/notes.js'
import { saveStaff, removeStaff, changeStudentAcademic } from '../src/lib/admin.js'
import { createRide, requestSeat, confirmRequest, cancelRide, withdrawRequest } from '../src/lib/rides.js'

const now = new Date('2026-10-16T06:00:00Z')
const db = makeSeed(now)
const P = db.profiles
const S = db.shared
const later = (h) => new Date(now.getTime() + h * 3600e3).toISOString()

describe('teacher-only and admin-only operations reject students', () => {
  it('students cannot publish posts, challenges to divisions, or attendance', () => {
    expect(createPost(S, { kind: 'notice', title: 'x', body: 'y', audience: { divisions: ['D1ADA'] } }, P.u_kabir, P, now).ok).toBe(false)
    const ch = postChallenge(S, { title: 'Sneaky', description: 'x', points: 10, audience: { divisions: ['D1ADB'] } }, P.u_kabir, now, P)
    expect(ch.ok).toBe(false)
    expect(createSession(S, { division: 'D1ADA', subject: 'Engineering Mathematics I', date: '2026-10-15', start: '09:00', end: '10:00', records: {} }, P.u_kabir, P, now).ok).toBe(false)
  })
  it('students cannot edit attendance even with verified=true forged', () => {
    const s = S.attSessions.find((x) => x.division === 'D1ADA')
    const r = editSession(S, s.id, { records: { u_kabir: 'P' } }, P.u_kabir, { verified: true, reason: 'me', version: s.version }, now)
    expect(r.ok).toBe(false)
  })
  it('a teacher cannot record or edit a class they are not assigned to', () => {
    expect(createSession(S, { division: 'D1EXA', subject: 'Engineering Mathematics I', date: '2026-10-15', start: '09:00', end: '10:00', records: {} }, P.u_t_meera, P, now).ok).toBe(false)
    expect(createPost(S, { kind: 'notice', title: 'x', body: 'y', audience: { divisions: ['D1EXA'] } }, P.u_t_meera, P, now).ok).toBe(false)
  })
  it('non-admins cannot manage teachers, menus, divisions or note reports', () => {
    for (const u of [P.u_kabir, P.u_t_meera, P.u_org]) {
      expect(saveStaff(S, { name: 'X', phone: '9999999999', teaches: [{ division: 'D1ADA', subject: 'Maths' }] }, u, now).ok).toBe(false)
      expect(removeStaff(S, 'anything', u).ok).toBe(false)
      expect(upsertDish(S, { canteen: 'VESIT', category: 'Snacks', name: 'Free food', price: 0 }, u).ok).toBe(false)
      expect(removeDish(S, S.dishes[0].id, u).ok).toBe(false)
      expect(changeStudentAcademic(P, 'u_tanvi', { division: 'D1ADA' }, u, now).ok).toBe(false)
      expect(resolveReports(S, 'n', u, 'remove').ok).toBe(false)
    }
  })
})

describe('cross-student isolation', () => {
  it('a D1ADB student cannot fetch a D1ADA assignment by id', () => {
    const r = createPost(S, { kind: 'assignment', title: 'A3', body: 'Do it', deadline: later(48), audience: { divisions: ['D1ADA'] } }, P.u_t_meera, P, now)
    expect(r.ok).toBe(true)
    expect(getPost(r.state, r.item.id, P.u_tanvi, now)).toBeNull()
    expect(getPost(r.state, r.item.id, P.u_kabir, now)).not.toBeNull()
    expect(submitAssignment(r.state, r.item.id, P.u_tanvi, { fileId: 'f', name: 'a.pdf', type: 'application/pdf', size: 10 }, '', now).ok).toBe(false)
  })
  it('a student cannot review submissions or close/edit a teacher post', () => {
    const r = createPost(S, { kind: 'assignment', title: 'A4', body: 'Do it', deadline: later(48), audience: { divisions: ['D1ADA'] } }, P.u_t_meera, P, now)
    const sub = submitAssignment(r.state, r.item.id, P.u_kabir, { fileId: 'f', name: 'a.pdf', type: 'application/pdf', size: 10 }, '', now)
    expect(sub.ok).toBe(true)
    expect(reviewAssignment(sub.state, sub.item.id, P.u_ishaan, 'Reviewed', '', now).ok).toBe(false)
    expect(setPostStatus(sub.state, r.item.id, 'Closed', P.u_kabir, P, now).ok).toBe(false)
    expect(updatePost(sub.state, r.item.id, { title: 'hacked' }, P.u_kabir, P, now).ok).toBe(false)
    expect(updatePost(sub.state, r.item.id, { title: 'hacked' }, P.u_t_arjun, P, now).ok).toBe(false) // another teacher
  })
  it('a challenge for D1ADA is invisible to D1ADB and cannot be closed by a student', () => {
    const r = postChallenge(S, { title: 'Int', description: 'x', points: 10, audience: { divisions: ['D1ADA'] } }, P.u_t_meera, now, P)
    expect(canView(r.item, P.u_tanvi)).toBe(false)
    expect(setChallengeStatus(r.state, r.item.id, 'archived', P.u_kabir, now).ok).toBe(false)
  })
  it('students cannot delete or overwrite another student’s review', () => {
    const dish = S.dishes[0]
    const a = saveReview(S, dish.id, P.u_kabir, { rating: 4, text: 'Good' }, now)
    expect(deleteReview(a.state, a.item.id, P.u_ishaan).ok).toBe(false)
    const b = saveReview(a.state, dish.id, P.u_ishaan, { rating: 1, text: 'Bad' }, now)
    expect(b.state.reviews.find((x) => x.id === a.item.id).rating).toBe(4) // Kabir's untouched
  })
  it('group-scoped notes are hidden from other branches; only the uploader can edit or remove', () => {
    const r = addNote(S, { title: 'AIDS EM-I notes', description: '', year: '1', branch: 'AIDS', subject: 'Engineering Mathematics I', topic: 'Laplace', subtopic: '', scope: 'group' }, { fileId: 'f1', name: 'n.pdf', type: 'application/pdf', size: 100 }, P.u_kabir, now)
    expect(r.ok).toBe(true)
    expect(canSeeNote(r.item, P.u_ishaan, r.state)).toBe(true)
    expect(canSeeNote(r.item, P.u_aarav, r.state)).toBe(false) // CS
    expect(updateNote(r.state, r.item.id, { title: 'mine now' }, P.u_ishaan, now).ok).toBe(false)
    expect(removeNote(r.state, r.item.id, P.u_ishaan).ok).toBe(false)
  })
})

describe('malformed input', () => {
  it('unknown ids fail cleanly instead of throwing', () => {
    expect(() => editSession(S, '__nope__', {}, P.u_t_meera, { verified: true, reason: 'x' }, now)).not.toThrow()
    expect(editSession(S, '__nope__', {}, P.u_t_meera, { verified: true, reason: 'x' }, now).ok).toBe(false)
    expect(getPost(S, '__nope__', P.u_kabir, now)).toBeNull()
    expect(deleteReview(S, '__nope__', P.u_kabir).ok).toBe(false)
    expect(requestSeat(S, '__nope__', P.u_kabir, now).ok).toBe(false)
    expect(saveReview(S, '__nope__', P.u_kabir, { rating: 3, text: '' }, now).ok).toBe(false)
  })
  it('review ratings outside 1–5 or non-integers are rejected', () => {
    for (const rating of [0, 6, 2.5, '5; drop', NaN, null, -1]) expect(saveReview(S, S.dishes[0].id, P.u_kabir, { rating, text: '' }, now).ok).toBe(false)
  })
  it('dish prices must be valid rupee amounts', () => {
    for (const price of [-1, 'abc', 1e9, 10.001, NaN]) expect(upsertDish(S, { canteen: 'VESIT', category: 'Snacks', name: 'X', price }, P.u_admin).ok).toBe(false)
  })
  it('attendance marks other than P/A are rejected', () => {
    const s = S.attSessions.find((x) => x.division === 'D1ADA' && x.status === 'recorded')
    expect(editSession(S, s.id, { records: { u_kabir: 'L' } }, P.u_t_meera, { verified: true, reason: 'late', version: s.version }, now).ok).toBe(false)
  })
  it('attendance status can only be recorded or cancelled', () => {
    const s = S.attSessions.find((x) => x.division === 'D1ADA' && x.status === 'recorded')
    const r = editSession(S, s.id, { status: 'deleted' }, P.u_t_meera, { verified: true, reason: 'x', version: s.version }, now)
    expect(r.ok).toBe(false)
  })
  it('a cancelled lecture switched back to held must mark the whole roster, and only roster students', () => {
    const c = createSession(S, { division: 'D1ADA', subject: 'Engineering Mathematics I', date: '2026-10-15', start: '15:00', end: '16:00', status: 'cancelled' }, P.u_t_meera, P, now)
    expect(c.ok).toBe(true)
    const id = c.item.id
    // outsider (D1ADB) cannot be added
    expect(editSession(c.state, id, { status: 'recorded', records: { u_kabir: 'P', u_ishaan: 'P', u_tanvi: 'P' } }, P.u_t_meera, { verified: true, reason: 'held after all', version: 1, profiles: P }, now).ok).toBe(false)
    // partial roster refused
    expect(editSession(c.state, id, { status: 'recorded', records: { u_kabir: 'P' } }, P.u_t_meera, { verified: true, reason: 'held after all', version: 1, profiles: P }, now).ok).toBe(false)
    // full roster accepted and counted
    const ok = editSession(c.state, id, { status: 'recorded', records: { u_kabir: 'P', u_ishaan: 'A' } }, P.u_t_meera, { verified: true, reason: 'held after all', version: 1, profiles: P }, now)
    expect(ok.ok).toBe(true)
    expect(studentSummary(ok.state, 'u_ishaan', now).rows.some((r) => r.id === id && r.mark === 'A')).toBe(true)
  })
})

describe('rides integrity', () => {
  const mk = () => createRide(S, { from: { name: 'Chembur station', lat: 19.06, lng: 72.9 }, to: { name: 'VESIT', lat: 19.0458, lng: 72.8892 }, departAt: later(5), seats: 1, note: '' }, P.u_kabir, now)
  it('rejects self-requests, duplicates, overbooking and outsider confirmation', () => {
    const r = mk(); expect(r.ok).toBe(true)
    const id = r.item.id
    expect(requestSeat(r.state, id, P.u_kabir, now).ok).toBe(false)
    const a = requestSeat(r.state, id, P.u_ishaan, now); expect(a.ok).toBe(true)
    expect(requestSeat(a.state, id, P.u_ishaan, now).ok).toBe(false)
    expect(confirmRequest(a.state, a.item.id, P.u_ishaan, now).ok).toBe(false) // not the driver
    const c = confirmRequest(a.state, a.item.id, P.u_kabir, now); expect(c.ok).toBe(true)
    expect(requestSeat(c.state, id, P.u_tanvi, now).ok).toBe(false) // 1 seat, full
    expect(withdrawRequest(c.state, a.item.id, P.u_tanvi).ok).toBe(false)
    expect(cancelRide(c.state, id, P.u_ishaan, now).ok).toBe(false)
  })
  it('a seat cannot be confirmed on a cancelled ride', () => {
    const r = mk()
    const a = requestSeat(r.state, r.item.id, P.u_ishaan, now)
    const x = cancelRide(a.state, r.item.id, P.u_kabir, now); expect(x.ok).toBe(true)
    expect(confirmRequest(x.state, a.item.id, P.u_kabir, now).ok).toBe(false)
  })
})

describe('reviews by role', () => {
  it('organisers and admins cannot post dish reviews (matches the UI)', () => {
    expect(saveReview(S, S.dishes[0].id, P.u_org, { rating: 5, text: '' }, now).ok).toBe(false)
    expect(saveReview(S, S.dishes[0].id, P.u_admin, { rating: 5, text: '' }, now).ok).toBe(false)
  })
})

import { sanitizeDb } from '../src/lib/storage.js'
import { emptyUserData } from '../src/data/seed.js'
describe('stored-data sanitiser', () => {
  it('leaves the seed untouched', () => {
    const r = sanitizeDb(makeSeed(now), emptyUserData)
    expect(r.fixed).toBe(0)
  })
  it('drops malformed records and repairs profiles without touching good data', () => {
    const d = makeSeed(now)
    const rides = d.shared.rides.length, posts = d.shared.posts.length
    d.shared.rides.push({ id: 'bad', from: null, to: null, departAt: 'x' })
    d.shared.posts.push({ id: 'bad', audience: null })
    d.shared.challenges.push({ id: 'bad', title: null })
    d.profiles.u_kabir = { ...d.profiles.u_kabir, name: null, interests: 'x' }
    d.userData.u_kabir = null
    const r = sanitizeDb(d, emptyUserData)
    expect(r.fixed).toBeGreaterThanOrEqual(6)
    expect(r.db.shared.rides).toHaveLength(rides)
    expect(r.db.shared.posts).toHaveLength(posts)
    expect(r.db.profiles.u_kabir.name).toBe('Unnamed student')
    expect(r.db.profiles.u_kabir.division).toBe('D1ADA')
    expect(Array.isArray(r.db.userData.u_kabir.subjects)).toBe(true)
  })
})
