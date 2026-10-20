import { describe, it, expect } from 'vitest'
import { makeSeed } from '../src/data/seed.js'
import { TRUSTED_DEMO, canAccess, demoIdsFor, roleOf } from '../src/lib/roles.js'
import { postChallenge, updateChallenge, deleteChallenge, setChallengeStatus, addResources, submitSolution, reviewSubmission, completeChallenge } from '../src/lib/challenges.js'
import { requestNotes, setNoteRequestStatus, addNote, requestsFor, REQ_STATUS } from '../src/lib/notes.js'
import { addOffer, saveTutorReview, deleteTutorReview, tutorRating } from '../src/lib/peer.js'
import { sendEventMessage, messagesIn, threadsFor } from '../src/lib/events.js'
import { searchAll } from '../src/lib/search.js'

const now = new Date('2026-10-16T06:00:00Z')
const db = makeSeed(now)
const P = db.profiles, S = db.shared
const later = (h) => new Date(now.getTime() + h * 3600e3).toISOString()

describe('roles and route permissions', () => {
  it('demo roles come from the trusted table, one portal per role', () => {
    expect(TRUSTED_DEMO.u_t_meera.role).toBe('teacher')
    expect(TRUSTED_DEMO.u_org.role).toBe('organiser')
    expect(TRUSTED_DEMO.u_kabir.role).toBe('student')
    expect(Object.isFrozen(TRUSTED_DEMO.u_kabir)).toBe(true)
    expect(demoIdsFor('organiser')).toEqual(['u_org'])
    expect(demoIdsFor('teacher')).toEqual(['u_t_meera', 'u_t_arjun'])
  })
  it('a forged role value on a student-shaped object is ignored by roleOf only if unknown', () => {
    expect(roleOf({ role: 'superuser' })).toBe('student')
  })
  it('teachers cannot open academics, events, peer, rides or directory', () => {
    for (const r of ['/planner', '/events', '/peer', '/rides', '/directory', '/organiser', '/admin']) expect(canAccess(P.u_t_meera, r)).toBe(false)
    for (const r of ['/', '/teacher', '/challenges', '/notes']) expect(canAccess(P.u_t_meera, r)).toBe(true)
  })
  it('council sees only its desk, events and personal pages', () => {
    for (const r of ['/', '/organiser', '/events', '/notifications', '/profile']) expect(canAccess(P.u_org, r)).toBe(true)
    for (const r of ['/classwork', '/challenges', '/teacher', '/peer', '/planner', '/navigator', '/notes']) expect(canAccess(P.u_org, r)).toBe(false)
  })
  it('students cannot open teacher, council or admin pages', () => {
    for (const r of ['/teacher', '/organiser', '/admin']) expect(canAccess(P.u_kabir, r)).toBe(false)
  })
  it('global search never offers pages outside the role', () => {
    const hits = searchAll('peer', { db, me: P.u_t_meera, pages: [{ path: '/peer', label: 'Peer learning' }] })
    expect(hits.some((h) => h.href.startsWith('#/peer'))).toBe(false)
  })
})

describe('challenge CRUD is teacher-only', () => {
  const mk = () => postChallenge(S, { title: 'Integrals', description: 'Q1–5', points: 20, audience: { divisions: ['D1ADA'] }, submission: { required: true } }, P.u_t_meera, now, P)
  it('students and council cannot create, edit, delete or add resources', () => {
    for (const u of [P.u_ishaan, P.u_org]) expect(postChallenge(S, { title: 'x', description: 'y', points: 5, audience: { divisions: ['D1ADA'] } }, u, now, P).ok).toBe(false)
    const c = mk()
    for (const u of [P.u_kabir, P.u_org, P.u_t_arjun]) {
      expect(updateChallenge(c.state, c.item.id, { title: 'hacked' }, u, now).ok).toBe(false)
      expect(deleteChallenge(c.state, c.item.id, u).ok).toBe(false)
      expect(setChallengeStatus(c.state, c.item.id, 'archived', u, now).ok).toBe(false)
      expect(addResources(c.state, c.item.id, [{ fileId: 'f', name: 'a.png', type: 'image/png', size: 1 }], u).ok).toBe(false)
    }
  })
  it('the author edits (validated), and audience stays fixed', () => {
    const c = mk()
    expect(updateChallenge(c.state, c.item.id, { points: 999 }, P.u_t_meera, now).ok).toBe(false)
    expect(updateChallenge(c.state, c.item.id, { title: '' }, P.u_t_meera, now).ok).toBe(false)
    const u = updateChallenge(c.state, c.item.id, { title: 'Integrals (v2)', points: 25, audience: { divisions: ['D1ADB'] } }, P.u_t_meera, now)
    expect(u.ok).toBe(true)
    expect(u.item.title).toBe('Integrals (v2)')
    expect(u.item.audience.divisions).toEqual(['D1ADA'])
    expect(u.item.history.at(-1).action).toMatch(/title/)
  })
  it('the author deletes; refused once points were awarded', () => {
    const c = mk()
    const sub = submitSolution(c.state, c.item.id, P.u_kabir, { fileId: 'img1', name: 'sol.png', type: 'image/png', size: 100 }, '', now)
    expect(sub.ok).toBe(true)
    expect(submitSolution(sub.state, c.item.id, P.u_t_meera, { fileId: 'x', name: 'x.png', type: 'image/png', size: 1 }, '', now).ok).toBe(false) // teachers don't submit
    const d = deleteChallenge(sub.state, c.item.id, P.u_t_meera)
    expect(d.ok).toBe(true)
    expect(d.fileIds).toContain('img1')
    expect(d.state.submissions.some((s) => s.challengeId === c.item.id)).toBe(false)
    const acc = reviewSubmission(sub.state, sub.item.id, P.u_t_meera, 'accept', 'Good', now)
    expect(acc.ok).toBe(true)
    expect(deleteChallenge(acc.state, c.item.id, P.u_t_meera).ok).toBe(false)
  })
  it('council can no longer review solutions', () => {
    const c = mk()
    const sub = submitSolution(c.state, c.item.id, P.u_kabir, { fileId: 'img1', name: 'sol.png', type: 'image/png', size: 100 }, '', now)
    expect(reviewSubmission(sub.state, sub.item.id, P.u_org, 'accept', '', now).ok).toBe(false)
    expect(completeChallenge(sub.state, c.item.id, P.u_org, now).ok).toBe(false)
  })
})

describe('notes requests', () => {
  it('students request, duplicates and empty input are refused, status shows', () => {
    expect(requestNotes(S, { subject: '', topic: '' }, P.u_kabir, now).ok).toBe(false)
    expect(requestNotes(S, { subject: 'EM-I', topic: 'Laplace' }, P.u_t_meera, now).ok).toBe(false) // teachers answer, not request
    const r = requestNotes(S, { subject: 'Engineering Mathematics I', topic: 'Laplace transform', details: 'Solved examples' }, P.u_kabir, now)
    expect(r.ok).toBe(true)
    expect(r.item.status).toBe(REQ_STATUS.OPEN)
    expect(requestNotes(r.state, { subject: 'engineering mathematics i', topic: 'LAPLACE TRANSFORM' }, P.u_kabir, now).ok).toBe(false)
    expect(requestsFor(r.state, P.u_ishaan).some((x) => x.id === r.item.id)).toBe(true) // same year+branch
    expect(requestsFor(r.state, P.u_aarav).some((x) => x.id === r.item.id)).toBe(false) // CS
    expect(setNoteRequestStatus(r.state, r.item.id, REQ_STATUS.CLOSED, P.u_ishaan).ok).toBe(false)
    expect(setNoteRequestStatus(r.state, r.item.id, REQ_STATUS.CLOSED, P.u_kabir).ok).toBe(true)
  })
  it('answering with a note marks it fulfilled and notifies the requester', () => {
    const r = requestNotes(S, { subject: 'Python Programming', topic: 'Loops' }, P.u_kabir, now)
    const n = addNote(r.state, { title: 'Loops cheat sheet', description: '', year: '1', branch: 'AIDS', subject: 'Python Programming', topic: 'Loops', subtopic: '', scope: 'all', fulfils: r.item.id }, { fileId: 'f', name: 'l.pdf', type: 'application/pdf', size: 10 }, P.u_t_meera, now)
    expect(n.ok).toBe(true)
    const req = n.state.noteRequests.find((x) => x.id === r.item.id)
    expect(req.status).toBe(REQ_STATUS.FULFILLED)
    expect(req.noteId).toBe(n.item.id)
    expect(n.state.notifications.some((x) => x.userId === 'u_kabir' && x.key === `noteReq:${r.item.id}`)).toBe(true)
    expect(addNote(n.state, { title: 'again', year: '1', branch: 'AIDS', subject: 'x', topic: 'y', scope: 'all', fulfils: r.item.id }, { fileId: 'g', name: 'g.pdf', type: 'application/pdf', size: 1 }, P.u_ishaan, now).ok).toBe(false)
  })
})

describe('peer tutors', () => {
  it('offers carry course, year, qualifications and topics; only students tutor', () => {
    expect(addOffer(S, { skill: 'Physics' }, P.u_t_meera).ok).toBe(false)
    const o = addOffer(S, { skill: 'Physics', course: 'AI & DS', studyYear: 'FE', qualifications: 'x', topics: ['Optics', 'Waves'] }, P.u_tanvi)
    expect(o.ok).toBe(true)
    expect(o.item.topics).toEqual(['Optics', 'Waves'])
    expect(addOffer(S, { skill: 'X', topics: Array(9).fill('t') }, P.u_tanvi).ok).toBe(false)
  })
  it('reviews: one per student per tutor, not self, 1–5 stars, averages', () => {
    expect(saveTutorReview(S, 'u_kabir', P.u_kabir, { rating: 5 }, now).ok).toBe(false)
    expect(saveTutorReview(S, 'u_kabir', P.u_t_meera, { rating: 5 }, now).ok).toBe(false)
    expect(saveTutorReview(S, 'u_kabir', P.u_tanvi, { rating: 0 }, now).ok).toBe(false)
    expect(saveTutorReview(S, 'nobody', P.u_tanvi, { rating: 3 }, now).ok).toBe(false)
    const a = saveTutorReview(S, 'u_kabir', P.u_tanvi, { rating: 2, text: 'ok' }, now)
    const b = saveTutorReview(a.state, 'u_kabir', P.u_tanvi, { rating: 4, text: 'better' }, now)
    expect(b.updated).toBe(true)
    expect(b.state.tutorReviews.filter((r) => r.tutorId === 'u_kabir' && r.userId === 'u_tanvi')).toHaveLength(1)
    expect(tutorRating(b.state, 'u_kabir')).toMatchObject({ count: 2, avg: 4 }) // seed 4 + 4
    expect(deleteTutorReview(b.state, b.item.id, P.u_ishaan).ok).toBe(false)
    expect(deleteTutorReview(b.state, b.item.id, P.u_tanvi).ok).toBe(true)
  })
})

describe('event organiser chat', () => {
  it('students write only in their own thread; organiser replies; outsiders refused', () => {
    expect(sendEventMessage(S, { eventId: 'ev_2', text: '   ' }, P.u_kabir, now).ok).toBe(false)
    expect(sendEventMessage(S, { eventId: 'ev_2', text: 'x'.repeat(501) }, P.u_kabir, now).ok).toBe(false)
    const m = sendEventMessage(S, { eventId: 'ev_2', studentId: 'u_ishaan', text: 'Can I bring my own robot?' }, P.u_kabir, now)
    expect(m.ok).toBe(true)
    expect(m.item.studentId).toBe('u_kabir') // forged thread ignored
    expect(sendEventMessage(m.state, { eventId: 'ev_2', text: 'Can I bring my own robot?' }, P.u_kabir, now).ok).toBe(false) // double send
    expect(sendEventMessage(m.state, { eventId: 'ev_2', studentId: 'u_kabir', text: 'hi' }, P.u_t_meera, now).ok).toBe(false)
    expect(sendEventMessage(m.state, { eventId: 'ev_2', studentId: 'u_tanvi', text: 'hi' }, P.u_org, now).ok).toBe(false) // no such thread
    const r = sendEventMessage(m.state, { eventId: 'ev_2', studentId: 'u_kabir', text: 'Yes <b>sure</b>' }, P.u_org, now)
    expect(r.ok).toBe(true)
    expect(messagesIn(r.state, 'ev_2', 'u_kabir').map((x) => x.fromRole)).toEqual(['student', 'organiser'])
    expect(r.item.text).toBe('Yes <b>sure</b>') // stored as plain text; React escapes it on render
    expect(threadsFor(r.state, 'ev_2')[0]).toMatchObject({ studentId: 'u_kabir', studentName: 'Kabir Shah', count: 2 })
    expect(r.state.notifications.some((n) => n.userId === 'u_kabir' && n.title.startsWith('Reply'))).toBe(true)
    expect(m.state.notifications.some((n) => n.userId === 'u_org' && n.title.startsWith('Message about'))).toBe(true)
  })
})

import { authorRole } from '../src/lib/challenges.js'
import { creditsOf, createMatch, bookSession, completeSession } from '../src/lib/peer.js'
import { verificationOf, requestSeat as reqSeat, createRide as mkRide } from '../src/lib/rides.js'
import { lowAttendance, weakestSubject, tutorsFor } from '../src/lib/insights.js'
import { studentSummary } from '../src/lib/attendance.js'

describe('class reps', () => {
  const rep = { ...P.u_kabir, classRep: true }
  it('a class rep posts only for their own division, labelled as class rep, no uploads', () => {
    expect(postChallenge(S, { title: 'Quiz', description: 'x', points: 10, audience: { divisions: ['D1ADB'] } }, rep, now, P).ok).toBe(false)
    expect(postChallenge(S, { title: 'Quiz', description: 'x', points: 150, audience: { divisions: ['D1ADA'] } }, rep, now, P).ok).toBe(false)
    const r = postChallenge(S, { title: 'Quiz', description: 'x', points: 10, audience: { divisions: ['D1ADA'] }, submission: { required: true } }, rep, now, P)
    expect(r.ok).toBe(true)
    expect(authorRole(r.item)).toBe('classRep')
    expect(r.item.submission).toBeNull()
    expect(r.state.notifications.filter((n) => n.key === `ch-new:${r.item.id}`).map((n) => n.userId)).toEqual(['u_ishaan']) // classmates, not the rep
    expect(setChallengeStatus(r.state, r.item.id, 'closed', rep, now).ok).toBe(true)
    expect(setChallengeStatus(r.state, r.item.id, 'closed', P.u_ishaan, now).ok).toBe(false)
    expect(updateChallenge(r.state, 'ch_1', { title: 'x' }, rep, now).ok).toBe(false) // a teacher's challenge
    expect(completeChallenge(r.state, r.item.id, rep, now).ok).toBe(false) // no points for your own challenge
    const done = completeChallenge(r.state, r.item.id, P.u_ishaan, now); expect(done.ok).toBe(true)
    const closed = setChallengeStatus(r.state, r.item.id, 'closed', rep, now).state
    expect(completeChallenge(closed, r.item.id, P.u_ishaan, now).ok).toBe(false) // Open → Closed stops completions
  })
  it('seed labels teacher and class-rep challenges', () => {
    expect(authorRole(S.challenges.find((c) => c.id === 'ch_1'))).toBe('teacher')
    expect(authorRole(S.challenges.find((c) => c.id === 'ch_2'))).toBe('classRep')
  })
})

describe('credit economy stays balanced', () => {
  it('total earned = total spent + credits held, before and after a full session', () => {
    const check = (st) => {
      const earned = st.ledger.filter((t) => t.type === 'earn').reduce((a, t) => a + t.amount, 0)
      const spent = st.ledger.filter((t) => t.type === 'spend').reduce((a, t) => a + t.amount, 0)
      const ids = [...new Set(st.ledger.map((t) => t.userId))]
      const held = ids.reduce((a, id) => a + creditsOf(st, id).balance, 0)
      expect(earned).toBe(spent + held)
      return held
    }
    const h0 = check(S)
    const b = bookSession(S, 'sess_m1', P.u_aarav, later(24))
    expect(b.ok).toBe(true)
    const c = completeSession(b.state, 'sess_m1', P.u_kabir, now)
    expect(c.ok).toBe(true)
    expect(check(c.state)).toBe(h0) // credits moved, none created
    expect(creditsOf(c.state, 'u_kabir').balance).toBe(creditsOf(S, 'u_kabir').balance + 1)
    expect(creditsOf(c.state, 'u_aarav').balance).toBe(creditsOf(S, 'u_aarav').balance - 1)
  })
})

describe('ride verification', () => {
  it('labels demo, verified and unverified; blocks unverified real accounts', () => {
    expect(verificationOf(P.u_aarav)).toBe('demo')
    const real = { id: 'mm_x', name: 'Real', authMethod: 'minimoth', phoneVerified: true, email: '' }
    expect(verificationOf(real)).toBe('unverified')
    expect(verificationOf({ ...real, collegeId: 'VES2026-123' })).toBe('verified')
    expect(reqSeat(S, 'ride_2', real, now).ok).toBe(false)
    expect(reqSeat(S, 'ride_2', { ...real, email: 'x@ves.ac.in' }, now).ok).toBe(true)
    expect(mkRide(S, { from: { name: 'A' }, to: { name: 'B' }, departAt: later(5), seats: 1 }, real, now).ok).toBe(false)
    expect(reqSeat(S, 'ride_2', P.u_ishaan, now).ok).toBe(true) // demo accounts may try it (labelled in the UI)
  })
})

describe('fully seeded demo students and cross-module insights', () => {
  for (const id of ['u_aarav', 'u_diya', 'u_kabir', 'u_ishaan', 'u_tanvi', 'u_sneha']) {
    it(`${id}: 3 weeks of attendance with a weak subject, 2 posts, 3 announcements (1 unread), target, points`, () => {
      const sum = studentSummary(S, id, now)
      expect(sum.overall.total).toBeGreaterThan(8)
      expect(new Set(sum.rows.map((r) => r.id)).size).toBe(sum.rows.length)
      expect(sum.rows.every((r) => r.date >= '2026-09-25' && r.date < '2026-10-16')).toBe(true)
      expect(lowAttendance(S, id, now).length).toBeGreaterThanOrEqual(1)
      const div = P[id].division
      expect(S.posts.filter((p) => p.audience.divisions.includes(div))).toHaveLength(2)
      const n = S.notifications.filter((x) => x.userId === id)
      expect(n).toHaveLength(3); expect(n.filter((x) => !x.read)).toHaveLength(1)
      expect(db.userData[id].target).toBeGreaterThan(0)
      expect(S.completions.some((c) => c.userId === id)).toBe(true)
    })
  }
  it('weakest subject has a tutor for Aarav (EM-I → Rohan)', () => {
    const w = weakestSubject(db.userData.u_aarav.subjects)
    expect(w).toBeTruthy()
    expect(tutorsFor(S, { name: 'Engineering Mathematics I' }, 'u_aarav')[0].offer.userName).toBe('Rohan Desai')
    expect(lowAttendance(S, 'u_aarav', now).map((x) => x.subject)).toContain('Engineering Mathematics I')
  })
})
