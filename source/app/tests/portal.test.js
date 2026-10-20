import { describe, it, expect } from 'vitest'
import { makeSeed } from '../src/data/seed.js'
import { createPost, visiblePosts, getPost, recipients, submitAssignment, reviewAssignment, canSubmitAssignment, setPostStatus, updatePost } from '../src/lib/posts.js'
import { postChallenge, eligible, canView } from '../src/lib/challenges.js'
import { createSession, editSession, studentSummary, makeSecret, verifyEditPassword, roster } from '../src/lib/attendance.js'
import { menuView, saveReview, deleteReview, ratingOf, upsertDish, categoriesOf } from '../src/lib/canteen.js'
import { addNote, browseNotes, reportNote, canSeeNote, removeNote } from '../src/lib/notes.js'
import { validateAcademic } from '../src/data/academics.js'
import { saveStaff } from '../src/lib/admin.js'

const db = makeSeed(new Date('2026-10-16T06:00:00Z'))
const P = db.profiles
const now = new Date('2026-10-16T06:00:00Z')

describe('Test A — batch targeting', () => {
  it('a teacher challenge to D1ADA reaches every D1ADA student and no one else', () => {
    const r = postChallenge(db.shared, { title: 'Integrals sheet', description: 'Solve 1–10', points: 20, audience: { divisions: ['D1ADA'] } }, P.u_t_meera, now, P)
    expect(r.ok).toBe(true)
    const ch = r.item
    expect(eligible(ch, P.u_kabir) && eligible(ch, P.u_ishaan)).toBe(true)
    expect(eligible(ch, P.u_tanvi)).toBe(false) // D1ADB
    expect(canView(ch, P.u_tanvi)).toBe(false)
    expect(canView(ch, P.u_aarav)).toBe(false) // other branch
    expect(r.state.notifications.filter((n) => n.key === `ch-new:${ch.id}`).map((n) => n.userId).sort()).toEqual(['u_ishaan', 'u_kabir'])
  })
  it('teachers can only target their own divisions', () => {
    expect(postChallenge(db.shared, { title: 'x', description: 'y', points: 5, audience: { divisions: ['D1EXA'] } }, P.u_t_meera, now, P).ok).toBe(false)
    expect(createPost(db.shared, { kind: 'notice', title: 'Hi', body: 'b', audience: { divisions: ['D1ADA'] } }, P.u_kabir, P, now).ok).toBe(false) // student
  })
})

describe('Test B/C — assignments and notices', () => {
  it('assignment visibility, direct access, submission, review', () => {
    let s = db.shared
    const r = createPost(s, { kind: 'assignment', title: 'EM-I Assignment 3', body: 'Do Q1–5', deadline: '2026-10-20T12:00:00Z', audience: { divisions: ['D1ADA'] } }, P.u_t_meera, P, now)
    expect(r.ok).toBe(true); s = r.state
    expect(r.recipients.map((p) => p.id).sort()).toEqual(['u_ishaan', 'u_kabir'])
    expect(visiblePosts(s, P.u_kabir, now).filter((p) => !p.demo)).toHaveLength(1)
    expect(visiblePosts(s, P.u_tanvi, now).filter((p) => !p.demo)).toHaveLength(0)
    expect(getPost(s, r.item.id, P.u_tanvi, now)).toBeNull() // direct id from another division
    expect(canSubmitAssignment(s, r.item, P.u_tanvi, now).ok).toBe(false)
    s = submitAssignment(s, r.item.id, P.u_kabir, { fileId: 'f', name: 'a.pdf', type: 'application/pdf', size: 9 }, '', now).state
    const sub = s.postSubs[0]
    expect(reviewAssignment(s, sub.id, P.u_t_arjun, 'reviewed', '', now).ok).toBe(false) // not the author
    s = reviewAssignment(s, sub.id, P.u_t_meera, 'reviewed', 'Good', now).state
    expect(s.notifications.some((n) => n.userId === 'u_kabir' && n.title === 'Assignment reviewed')).toBe(true)
    expect(updatePost(s, r.item.id, { title: 'EM-I Assignment 3 (updated)' }, P.u_t_arjun, P, now).ok).toBe(false)
    s = setPostStatus(s, r.item.id, 'Archived', P.u_t_meera, P, now).state
    expect(visiblePosts(s, P.u_kabir, now).filter((p) => !p.demo)).toHaveLength(0)
  })
  it('lecture notice to one division', () => {
    const r = createPost(db.shared, { kind: 'lecture', title: 'Extra lecture', body: 'Bring calculators', subject: 'Engineering Mathematics I', lectureAt: '2026-10-17T05:30:00Z', room: { f: 1, id: 'r01' }, audience: { divisions: ['D1ADB'] } }, P.u_t_meera, P, now)
    expect(visiblePosts(r.state, P.u_tanvi, now).filter((p) => !p.demo)).toHaveLength(1)
    expect(visiblePosts(r.state, P.u_kabir, now).filter((p) => !p.demo)).toHaveLength(0)
  })
})

describe('Test D — attendance', () => {
  it('records, protects edits with a hashed password, audits, and computes %', async () => {
    let s = db.shared
    const ros = roster(P, 'D1ADA').map((p) => p.id)
    expect(ros).toEqual(['u_kabir', 'u_ishaan'])
    const input = { division: 'D1ADA', subject: 'Engineering Mathematics I', date: '2026-10-15', start: '15:00', end: '16:00', records: { u_kabir: 'P' } }
    expect(createSession(s, input, P.u_t_meera, P, now).ok).toBe(false) // incomplete roster
    expect(createSession(s, { ...input, records: { u_kabir: 'P', u_ishaan: 'A' } }, P.u_kabir, P, now).ok).toBe(false) // student
    expect(createSession(s, { ...input, records: { u_kabir: 'P', u_ishaan: 'A' } }, P.u_t_arjun, P, now).ok).toBe(false) // not assigned
    const before = studentSummary(s, 'u_ishaan', now).overall
    const r = createSession(s, { ...input, records: { u_kabir: 'P', u_ishaan: 'A' } }, P.u_t_meera, P, now); s = r.state
    expect(createSession(s, { ...input, records: { u_kabir: 'P', u_ishaan: 'A' } }, P.u_t_meera, P, now).ok).toBe(false) // duplicate session
    const after = studentSummary(s, 'u_ishaan', now).overall
    expect(after.total).toBe(before.total + 1); expect(after.absent).toBe(before.absent + 1)
    const secret = await makeSecret('chalk2026')
    expect(secret.hash).not.toContain('chalk')
    expect(editSession(s, r.item.id, { records: { u_ishaan: 'P' } }, P.u_t_meera, { verified: false, reason: 'late' }, now).ok).toBe(false)
    const bad = await verifyEditPassword(secret, 'wrong', now); expect(bad.ok).toBe(false)
    const good = await verifyEditPassword(secret, 'chalk2026', now); expect(good.ok).toBe(true)
    const e = editSession(s, r.item.id, { records: { u_ishaan: 'P' } }, P.u_t_meera, { verified: good.ok, reason: 'Arrived late, was present', version: 1 }, now)
    expect(e.ok).toBe(true); s = e.state
    expect(studentSummary(s, 'u_ishaan', now).overall.present).toBe(after.present + 1)
    expect(s.attAudit.at(-1).changes).toEqual([{ studentId: 'u_ishaan', from: 'A', to: 'P' }])
    expect(editSession(s, r.item.id, { records: { u_ishaan: 'A' } }, P.u_t_meera, { verified: true, reason: 'x', version: 1 }, now).ok).toBe(false) // stale version
    expect(studentSummary(s, 'u_rohan', now).overall.pct).toBeNull() // no records → no invented %
    let sec = secret; for (let i = 0; i < 5; i++) sec = (await verifyEditPassword(sec, 'nope', now)).secret
    expect((await verifyEditPassword(sec, 'chalk2026', now)).ok).toBe(false) // locked
  })
})

describe('Test E — canteen', () => {
  it('keeps canteens separate, sorts numerically, one review per student', () => {
    let s = db.shared
    const vesit = menuView(s, { canteen: 'VESIT', category: 'Milkshakes', sort: 'price_asc' })
    expect(vesit.every((d) => d.canteen === 'VESIT')).toBe(true)
    expect(vesit[0].name).toBe('Banana milkshake') // ₹30 cheapest
    const desc = menuView(s, { canteen: 'VESIM', sort: 'price_desc' })
    expect(desc[0].price).toBe(150); expect(desc.at(-1).price).toBe(10)
    expect(categoriesOf(s, 'VESIM')).toContain('Chaat (Anuj Caterers)')
    const dish = vesit[0]
    s = saveReview(s, dish.id, P.u_kabir, { rating: 4, text: 'Thick <b>and</b> cold' }, now).state
    s = saveReview(s, dish.id, P.u_tanvi, { rating: 2, text: '' }, now).state
    expect(ratingOf(s, dish.id)).toEqual({ avg: 3, count: 2 })
    const upd = saveReview(s, dish.id, P.u_kabir, { rating: 5, text: 'Even better' }, now); s = upd.state
    expect(upd.updated).toBe(true); expect(ratingOf(s, dish.id)).toEqual({ avg: 3.5, count: 2 })
    expect(s.reviews[0].text).not.toContain('<')
    expect(saveReview(s, dish.id, P.u_kabir, { rating: 7 }, now).ok).toBe(false)
    expect(deleteReview(s, s.reviews[1].id, P.u_kabir).ok).toBe(false) // not mine
    expect(upsertDish(s, { ...dish, price: 32 }, P.u_kabir).ok).toBe(false) // students can't edit prices
    expect(upsertDish(s, { ...dish, price: 32 }, P.u_admin).ok).toBe(true)
  })
})

describe('Test F — notes', () => {
  it('categorised upload, search, scope and reports', () => {
    let s = db.shared
    const meta = { title: 'Laplace transform notes', description: 'Worked examples', year: '1', branch: 'AIDS', subject: 'Engineering Mathematics I', topic: 'Chapter 3: Laplace', subtopic: 'Inverse Laplace', scope: 'group' }
    expect(addNote(s, { ...meta, topic: '' }, { fileId: 'f' }, P.u_kabir, now).ok).toBe(false)
    s = addNote(s, meta, { fileId: 'f1', name: 'laplace.pdf', type: 'application/pdf', size: 1000 }, P.u_kabir, now).state
    expect(browseNotes(s, P.u_ishaan, { q: 'inverse' })).toHaveLength(1) // same year+branch
    expect(browseNotes(s, P.u_aarav, {})).toHaveLength(0) // CS student: group-scoped note hidden
    expect(browseNotes(s, P.u_ishaan, { year: '1', branch: 'AIDS', subject: 'Engineering Mathematics I', topic: 'Chapter 3: Laplace', subtopic: 'Inverse Laplace' })).toHaveLength(1)
    const n = s.notes[0]
    expect(removeNote(s, n.id, P.u_ishaan).ok).toBe(false)
    s = reportNote(s, n.id, P.u_ishaan, 'Duplicate', '', now).state
    expect(reportNote(s, n.id, P.u_ishaan, 'Duplicate', '', now).ok).toBe(false)
    expect(canSeeNote(n, P.u_ishaan, s)).toBe(true)
  })
})

describe('profiles and staff', () => {
  it('validates academic identity and duplicate roll numbers within a cohort', () => {
    expect(validateAcademic({ year: '1', branchId: 'AIDS', division: 'D1ADA', roll: 'D1ADA-12' }, P, 'new').roll).toMatch(/already/)
    expect(validateAcademic({ year: '1', branchId: 'AIDS', division: 'D1CSA', roll: 'X1' }, P, 'new').division).toBeTruthy()
    expect(Object.keys(validateAcademic({ year: '1', branchId: 'AIDS', division: 'D1ADB', roll: 'D1ADB-09' }, P, 'new'))).toHaveLength(0)
  })
  it('only admins manage the teacher allowlist', () => {
    const t = { name: 'Prof. Demo', phone: '9876500000', teaches: [{ division: 'D1ADA', subject: 'Engineering Physics' }] }
    expect(saveStaff(db.shared, t, P.u_t_meera, now).ok).toBe(false)
    expect(saveStaff(db.shared, t, P.u_admin, now).ok).toBe(true)
  })
})

describe('Test G/H — rides and peer learning across accounts', async () => {
  const { requestSeat, confirmRequest, declineRequest, cancelRide, seatsInfo } = await import('../src/lib/rides.js')
  const { createMatch, bookSession } = await import('../src/lib/peer.js')
  it('request → owner notified → decline/confirm → requester notified; seat limits hold', () => {
    let s = db.shared
    const ride = s.rides.find((r) => r.id === 'ride_4') // Kabir, 1 seat, already confirmed for Sneha
    expect(requestSeat(s, ride.id, P.u_aarav, now).ok).toBe(false) // full
    const r2 = s.rides.find((r) => r.id === 'ride_2') // Diya, 2 seats
    s = requestSeat(s, r2.id, P.u_kabir, now).state
    expect(s.notifications.some((n) => n.userId === 'u_diya' && n.title === 'New seat request')).toBe(true)
    expect(requestSeat(s, r2.id, P.u_kabir, now).ok).toBe(false) // duplicate
    const q = s.rideRequests.find((x) => x.rideId === r2.id && x.userId === 'u_kabir')
    expect(confirmRequest(s, q.id, P.u_kabir, now).ok).toBe(false) // not the owner
    s = declineRequest(s, q.id, P.u_diya, now).state
    expect(s.notifications.some((n) => n.userId === 'u_kabir' && n.title === 'Seat request declined')).toBe(true)
    expect(seatsInfo(r2, s.rideRequests).seatsLeft).toBe(2)
    s = requestSeat(s, r2.id, P.u_ishaan, now).state
    s = cancelRide(s, r2.id, P.u_diya, now).state
    expect(s.notifications.some((n) => n.userId === 'u_ishaan' && n.title === 'Ride cancelled')).toBe(true)
    expect(requestSeat(s, r2.id, P.u_tanvi, now).ok).toBe(false)
  })
  it('peer match and booking notify the other person', () => {
    let s = db.shared
    const m = createMatch(s, 'offer_1', 'learn_2', P.u_diya); expect(m.ok).toBe(true); s = m.state
    expect(s.notifications.some((n) => n.userId === 'u_rohan' && n.category === 'peer')).toBe(true)
  })
})
