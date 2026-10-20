// Cross-module links: attendance → planner, planner → peer tutors. Pure functions over saved data.
import { studentSummary } from './attendance.js'
import { tutorRating } from './peer.js'

export const ATTENDANCE_REFERENCE = 75 // shown as a reference line only, not as a college rule

/** Subjects where the student's recorded attendance is below the reference line (needs ≥3 recorded lectures). */
export function lowAttendance(state, userId, now = new Date()) {
  return studentSummary(state, userId, now).bySubject.filter((s) => s.total >= 3 && s.pct != null && s.pct < ATTENDANCE_REFERENCE).sort((a, b) => a.pct - b.pct)
}

/** Planner subject with the lowest internal score ratio (the one most likely to pull the SGPA down). */
export function weakestSubject(subjects = []) {
  return subjects.filter((s) => s.internalScored != null && s.internalMax > 0).sort((a, b) => a.internalScored / a.internalMax - b.internalScored / b.internalMax)[0] || null
}

const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** Peer tutors whose offer matches a subject (name or code), best rated first; never the student themself. */
export function tutorsFor(state, subject, userId) {
  const names = [norm(subject?.name || subject), norm(subject?.code)].filter(Boolean)
  return state.offers.filter((o) => o.userId !== userId && names.some((n) => { const sk = norm(o.skill); return sk === n || sk.includes(n) || n.includes(sk) || (o.topics || []).some((t) => norm(t) === n) }))
    .map((o) => ({ offer: o, rating: tutorRating(state, o.userId) })).sort((a, b) => (b.rating.avg || 0) - (a.rating.avg || 0))
}
