import { describe, it, expect } from 'vitest'
import { createRide, requestSeat, confirmRequest, withdrawRequest, seatStatusFor, seatsInfo, SEAT } from '../src/lib/rides.js'
import { postChallenge, completeChallenge, leaderboard } from '../src/lib/challenges.js'
import { eventStatus, EVENT_STATUS, requestRegistration, decideRequest, isRegistered, regCounts, REG, suggestEvents } from '../src/lib/events.js'
import { addOffer, addLearnRequest, createMatch, bookSession, completeSession, cancelBooking, creditsOf, findMatches, SESSION } from '../src/lib/peer.js'

const now = new Date('2026-10-14T10:00:00Z')
const A = { id: 'a', name: 'Aarav', classId: 'FE-A' }
const B = { id: 'b', name: 'Diya', classId: 'FE-A' }
const C = { id: 'c', name: 'Kabir', classId: 'FE-B' }
const later = (min) => new Date(now.getTime() + min * 60000).toISOString()

describe('rides', () => {
  const base = { rides: [], rideRequests: [] }
  const input = { from: { name: 'North Gate' }, to: { name: 'Campus' }, departAt: later(60), seats: 1 }
  it('creates a valid ride and rejects invalid ones', () => {
    expect(createRide(base, input, A, now).ok).toBe(true)
    expect(createRide(base, { ...input, seats: 0 }, A, now).ok).toBe(false)
    expect(createRide(base, { ...input, departAt: later(-5) }, A, now).ok).toBe(false)
    expect(createRide(base, { ...input, to: { name: 'north gate' } }, A, now).ok).toBe(false)
    expect(createRide(base, input, null, now).ok).toBe(false)
  })
  it('runs Available → Requested → Confirmed and blocks overbooking and duplicates', () => {
    let s = createRide(base, input, A, now).state
    const ride = s.rides[0]
    expect(seatStatusFor(ride, s.rideRequests, 'b')).toBe(SEAT.AVAILABLE)
    expect(requestSeat(s, ride.id, A, now).ok).toBe(false) // own ride
    const r1 = requestSeat(s, ride.id, B, now); s = r1.state
    expect(seatStatusFor(ride, s.rideRequests, 'b')).toBe(SEAT.REQUESTED)
    expect(requestSeat(s, ride.id, B, now).ok).toBe(false) // duplicate
    s = requestSeat(s, ride.id, C, now).state // second request allowed while seat unconfirmed
    expect(confirmRequest(s, r1.item.id, B, now).ok).toBe(false) // not the creator
    const c1 = confirmRequest(s, r1.item.id, A, now); s = c1.state
    expect(seatStatusFor(ride, s.rideRequests, 'b')).toBe(SEAT.CONFIRMED)
    expect(confirmRequest(s, r1.item.id, A, now).ok).toBe(false) // duplicate confirmation
    const cReq = s.rideRequests.find((r) => r.userId === 'c')
    expect(confirmRequest(s, cReq.id, A, now).ok).toBe(false) // would overbook (1 seat)
    expect(seatsInfo(ride, s.rideRequests).full).toBe(true)
    expect(requestSeat(s, ride.id, { id: 'd', name: 'Sneha' }, now).ok).toBe(false) // full
    expect(withdrawRequest(s, cReq.id, C).ok).toBe(true)
    expect(withdrawRequest(s, r1.item.id, B).ok).toBe(false) // confirmed can't be withdrawn
  })
  it('survives a JSON round-trip (refresh)', () => {
    let s = createRide(base, input, A, now).state
    s = requestSeat(s, s.rides[0].id, B, now).state
    const reloaded = JSON.parse(JSON.stringify(s))
    expect(seatStatusFor(reloaded.rides[0], reloaded.rideRequests, 'b')).toBe(SEAT.REQUESTED)
  })
})

describe('challenges', () => {
  it('only teachers post; students complete once; leaderboard derives from completions', () => {
    const T = { id: 't', name: 'Prof T', role: 'teacher', teaches: [{ division: 'D1CSA', subject: 'Maths' }] }
    const SA = { id: 'a', name: 'A', classId: 'FE-A', division: 'D1CSA' }, SB = { id: 'b', name: 'B', classId: 'FE-A', division: 'D1CSA' }, SC = { id: 'c', name: 'C', classId: 'FE-B', division: 'D1ITA' }
    let s = { challenges: [], completions: [] }
    expect(postChallenge(s, { title: 'Hunt', description: 'x', points: 30, audience: { divisions: ['D1CSA'] } }, SA, now).ok).toBe(false) // students can't create
    const p = postChallenge(s, { title: 'Library hunt', description: 'Find 3 books', points: 30, audience: { divisions: ['D1CSA'] } }, T, now); s = p.state
    expect(p.ok).toBe(true)
    expect(postChallenge(s, { title: '', description: 'x', points: 30, audience: { divisions: ['D1CSA'] } }, T, now).ok).toBe(false)
    s = completeChallenge(s, p.item.id, SA, now).state
    expect(completeChallenge(s, p.item.id, SA, now).ok).toBe(false)
    expect(completeChallenge(s, p.item.id, SC, now).ok).toBe(false) // other division
    expect(completeChallenge(s, p.item.id, T, now).ok).toBe(false) // teachers don't complete
    s = completeChallenge(s, p.item.id, SB, now).state
    const lb = leaderboard(s)
    expect(lb.classes).toEqual([{ classId: 'FE-A', points: 60 }])
    expect(lb.students[0].points).toBe(30)
    expect(s.completions).toHaveLength(2)
  })
})

describe('events', () => {
  const ev = { id: 'e', title: 'Jam', start: later(240), end: later(300), regCloses: later(200), tags: ['coding'], capacity: 2 }
  const at = (min) => new Date(now.getTime() + min * 60000)
  it('moves through the four statuses at the right boundaries', () => {
    expect(eventStatus(ev, at(0))).toBe(EVENT_STATUS.OPEN)
    expect(eventStatus(ev, at(119))).toBe(EVENT_STATUS.OPEN) // start is 121 min away
    expect(eventStatus(ev, at(121))).toBe(EVENT_STATUS.SOON) // inside the 120-min window
    expect(eventStatus(ev, at(200))).toBe(EVENT_STATUS.SOON) // registration closed exactly now
    expect(eventStatus(ev, at(239))).toBe(EVENT_STATUS.SOON)
    expect(eventStatus(ev, at(240))).toBe(EVENT_STATUS.LIVE) // starts exactly now
    expect(eventStatus(ev, at(299))).toBe(EVENT_STATUS.LIVE)
    expect(eventStatus(ev, at(300))).toBe(EVENT_STATUS.ENDED) // ends exactly now
  })
  it('requests only while Registration Open, once; approval respects capacity and role', () => {
    const org = { id: 'o', name: 'Org', role: 'organiser' }
    const e2 = { ...ev, organiserId: 'o', capacity: 1 }
    const form = (u) => ({ name: u.name || 'Student', classId: 'FE-A', email: 'a@b.co' })
    let s = { events: [e2], registrations: [], notifications: [] }
    let r = requestRegistration(s, 'e', A, form(A), at(0)); s = r.state
    expect(r.item.status).toBe(REG.PENDING)
    expect(isRegistered(s, 'e', A.id)).toBe(false) // pending is not registered
    expect(requestRegistration(s, 'e', A, form(A), at(0)).ok).toBe(false) // duplicate
    expect(requestRegistration(s, 'e', B, form(B), at(130)).ok).toBe(false) // starting soon → closed
    expect(requestRegistration(s, 'e', B, { name: 'B', classId: '' }, at(1)).ok).toBe(false) // invalid form
    s = requestRegistration(s, 'e', B, form(B), at(1)).state
    expect(decideRequest(s, s.registrations[0].id, A, 'approve', '', at(2)).ok).toBe(false) // students can't approve
    s = decideRequest(s, s.registrations[0].id, org, 'approve', '', at(2)).state
    expect(isRegistered(s, 'e', A.id)).toBe(true)
    expect(s.notifications.some((n) => n.userId === A.id && n.title === 'Registration approved')).toBe(true)
    expect(decideRequest(s, s.registrations[1].id, org, 'approve', '', at(3)).ok).toBe(false) // capacity 1 → full
    s = decideRequest(s, s.registrations[1].id, org, 'reject', 'Full', at(3)).state
    expect(regCounts(s, 'e')).toMatchObject({ approved: 1, rejected: 1, pending: 0 })
    const c = requestRegistration(s, 'e', C, form(C), at(4)); expect(c.item.status).toBe(REG.WAITLISTED) // full → waitlist
  })
  it('suggests by interest', () => {
    expect(suggestEvents([ev], { interests: ['Coding'] }, now)).toHaveLength(1)
    expect(suggestEvents([ev], { interests: ['dance'] }, now)).toHaveLength(0)
  })
})

describe('peer learning credits', () => {
  const seedLedger = [{ id: 't0', sessionId: 'old', userId: 'b', type: 'earn', amount: 2, at: now.toISOString() }]
  const fresh = () => ({ offers: [], learnRequests: [], sessions: [], ledger: [...seedLedger] })
  it('Matched → Booked → Completed moves exactly 1 credit per hour, once', () => {
    let s = fresh()
    const o = addOffer(s, { skill: 'Python' }, A); s = o.state
    const r = addLearnRequest(s, { skill: 'python', hours: 2 }, B); s = r.state
    expect(findMatches(s, { a: { subjects: ['Python'] }, b: { subjects: ['Python'] } }, 'b')[0].teachers).toHaveLength(1)
    const m = createMatch(s, o.item.id, r.item.id, B); s = m.state
    expect(m.item.status).toBe(SESSION.MATCHED)
    expect(completeSession(s, m.item.id, B, now).ok).toBe(false) // must book first
    const bk = bookSession(s, m.item.id, B, later(60)); s = bk.state
    expect(creditsOf(s, 'b')).toEqual({ balance: 2, reserved: 2, available: 0 })
    expect(creditsOf(s, 'a').balance).toBe(0) // no reward for booking
    const done = completeSession(s, m.item.id, A, now); s = done.state
    expect(creditsOf(s, 'a')).toEqual({ balance: 2, reserved: 0, available: 2 })
    expect(creditsOf(s, 'b')).toEqual({ balance: 0, reserved: 0, available: 0 })
    expect(completeSession(s, m.item.id, A, now).ok).toBe(false) // no double settlement
    const reloaded = JSON.parse(JSON.stringify(s))
    expect(completeSession(reloaded, m.item.id, B, now).ok).toBe(false) // nor after a refresh
    expect(reloaded.ledger.filter((t) => t.sessionId === m.item.id)).toHaveLength(2)
  })
  it('never lets a balance go negative', () => {
    let s = fresh()
    const o = addOffer(s, { skill: 'Chess' }, B); s = o.state
    const r = addLearnRequest(s, { skill: 'Chess', hours: 1 }, A); s = r.state // A has 0 credits
    const m = createMatch(s, o.item.id, r.item.id, A); s = m.state
    expect(bookSession(s, m.item.id, A, later(30)).ok).toBe(false)
    expect(creditsOf(s, 'a').balance).toBe(0)
  })
  it('cancelling a booking releases the reservation', () => {
    let s = fresh()
    const o = addOffer(s, { skill: 'Figma' }, A); s = o.state
    const r = addLearnRequest(s, { skill: 'Figma', hours: 1 }, B); s = r.state
    const m = createMatch(s, o.item.id, r.item.id, B); s = m.state
    s = bookSession(s, m.item.id, B, later(30)).state
    expect(creditsOf(s, 'b').available).toBe(1)
    s = cancelBooking(s, m.item.id, B).state
    expect(creditsOf(s, 'b')).toEqual({ balance: 2, reserved: 0, available: 2 })
  })
})

describe('notifications, submissions and review', () => {
  it('dedupes notifications and tracks read state', async () => {
    const { notify, unreadCount, markAllRead, deadlineNotifications } = await import('../src/lib/notifications.js')
    let s = { notifications: [] }
    s = notify(s, [{ userId: 'a', key: 'k1', category: 'event', title: 'x' }, { userId: 'a', key: 'k1', category: 'event', title: 'x' }])
    s = notify(s, [{ userId: 'a', key: 'k1', category: 'event', title: 'x' }])
    expect(s.notifications).toHaveLength(1)
    expect(unreadCount(s, 'a')).toBe(1)
    s = markAllRead(s, 'a'); expect(unreadCount(s, 'a')).toBe(0)
    const now = new Date('2026-10-16T06:00:00Z')
    const dl = [{ id: 'd1', title: 'A', due: '2026-10-16T12:00:00Z', done: false }, { id: 'd2', title: 'B', due: '2026-10-20T12:00:00Z', done: false }]
    const first = deadlineNotifications('a', dl, undefined, now) // older data: no "new" spam
    expect(first.items.map((i) => i.title)).toEqual(['Deadline approaching'])
    const dl2 = [...dl.slice(0, 1), { ...dl[1], due: '2026-10-21T12:00:00Z' }, { id: 'd3', title: 'C', due: '2026-10-25T12:00:00Z' }]
    const second = deadlineNotifications('a', dl2, first.seen, now)
    expect(second.items.map((i) => i.title).sort()).toEqual(['Deadline approaching', 'Deadline changed', 'New deadline added'])
  })
  it('a solution earns points only once, only when accepted by an authorised reviewer', async () => {
    const { postChallenge, submitSolution, reviewSubmission, completeChallenge, leaderboard, canSubmit } = await import('../src/lib/challenges.js')
    const author = { id: 'au', name: 'Author', role: 'teacher', teaches: [{ division: 'D1CSA', subject: 'Maths' }] }, A = { id: 'a', name: 'Aarav', classId: 'FE-A', year: '1', branchId: 'CS', division: 'D1CSA', roll: 'D1CSA-01' }, B = { id: 'b', name: 'B', classId: 'FE-A', year: '1', branchId: 'CS', division: 'D1CSA', roll: 'D1CSA-02' }
    const profiles = { au: author, a: A, b: B, c: { id: 'c', classId: 'FE-B', division: 'D1ITA' } }
    let s = { challenges: [], completions: [], submissions: [], notifications: [] }
    const now = new Date()
    s = postChallenge(s, { title: 'Draw', description: 'd', points: 30, audience: { divisions: ['D1CSA'] }, submission: { required: true } }, author, now, profiles).state
    const ch = s.challenges[0]
    expect(s.notifications.map((n) => n.userId).sort()).toEqual(['a', 'b']) // eligible class only, not the author
    expect(completeChallenge(s, ch.id, A, now).ok).toBe(false) // no self-award for upload challenges
    expect(submitSolution(s, ch.id, A, null, '', now).ok).toBe(false) // file not stored → nothing saved
    s = submitSolution(s, ch.id, A, { fileId: 'f1', name: 'a.png', type: 'image/png', size: 10 }, '', now).state
    const sub1 = s.submissions[0]
    expect(reviewSubmission(s, sub1.id, B, 'accept', '', now).ok).toBe(false) // not the author
    expect(reviewSubmission(s, sub1.id, author, 'changes', '', now).ok).toBe(false) // feedback required
    s = reviewSubmission(s, sub1.id, author, 'changes', 'Label the resistors', now).state
    expect(leaderboard(s).students).toHaveLength(0)
    s = submitSolution(s, ch.id, A, { fileId: 'f2', name: 'b.png', type: 'image/png', size: 10 }, 'v2', now).state
    const sub2 = s.submissions.find((x) => x.attempt === 2)
    s = reviewSubmission(s, sub2.id, author, 'accept', 'Nice', now).state
    expect(leaderboard(s).students[0].points).toBe(30)
    expect(reviewSubmission(s, sub2.id, author, 'accept', '', now).ok).toBe(false) // can't accept twice
    expect(canSubmit(s, ch, A, now).ok).toBe(false)
    expect(s.notifications.filter((n) => n.userId === 'a' && n.category === 'challenge').length).toBe(3) // new + changes + accepted
  })
})

describe('global search', () => {
  it('finds rooms, events, stations and pages from real data, respecting challenge eligibility', async () => {
    const { searchAll } = await import('../src/lib/search.js')
    const { makeSeed } = await import('../src/data/seed.js')
    const db = makeSeed()
    const me = db.profiles.u_kabir // FE-B
    const ctx = { db, me, pages: [{ path: '/planner', label: 'Academics', keywords: 'sgpa' }] }
    expect(searchAll('programming lab', ctx)[0]).toMatchObject({ kind: 'Room', href: '#/navigator?f=1&id=l21' })
    expect(searchAll('debate', ctx).some((r) => r.kind === 'Event')).toBe(true)
    expect(searchAll('dombivli', ctx)[0].kind).toBe('Station')
    expect(searchAll('sgpa', ctx)[0]).toMatchObject({ kind: 'Page', href: '#/planner' })
    expect(searchAll('voltage divider', ctx).some((r) => r.kind === 'Challenge')).toBe(false) // FE-C only
    expect(searchAll('x', ctx)).toEqual([])
  })
})
