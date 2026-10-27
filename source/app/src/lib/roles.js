// Role model and route permissions — the single place that decides who may open what.
//
// SIMULATED AUTHORISATION: everything here runs in the browser. It stops the app from offering or performing
// actions a role may not take, and it never trusts a role value read from browser storage or a profile edit:
// demo roles come from the trusted table below (code, not data), and OTP roles are re-derived from the
// sign-in server's admin flag and the admin's staff allowlist (see AppContext). A production deployment must
// enforce the same rules on the server; client-side checks are not security on their own.
import { makeSeed, DEMO_USERS } from '../data/seed.js'

export const ROLES = ['student', 'teacher', 'organiser', 'admin', 'hod', 'parent']
export const ROLE_LABEL = { student: 'Student', teacher: 'Teacher', organiser: 'Council / Club', admin: 'Admin', hod: 'HOD', parent: 'Parent' }

/** App-controlled demo accounts: role and class assignments are fixed in code, never read from storage. */
const seed = makeSeed(new Date('2026-01-01T00:00:00Z'))
export const TRUSTED_DEMO = Object.freeze(Object.fromEntries(DEMO_USERS.map((id) => {
  const p = seed.profiles[id]
  return [id, Object.freeze({ role: p.role || 'student', classRep: !!p.classRep, teaches: p.teaches ? Object.freeze(p.teaches.map((t) => Object.freeze({ ...t }))) : undefined })]
})))
export const demoIdsFor = (role) => DEMO_USERS.filter((id) => TRUSTED_DEMO[id].role === role)

/** Normalised role of a (trusted, already-derived) user object. Anything unknown is a student. */
export const roleOf = (u) => (u && ['teacher', 'organiser', 'admin', 'hod', 'parent'].includes(u.role) ? u.role : 'student')

/** Routes each role may open. Admin keeps oversight of everything. */
const ACCESS = {
  student: ['/', '/portal', '/setup', '/clubs', '/navigator', '/classwork', '/attendance', '/planner', '/events', '/commute', '/canteen', '/rides', '/challenges', '/peer', '/notes', '/directory', '/notifications', '/profile', '/about'],
  teacher: ['/', '/teacher', '/setup', '/clubs', '/challenges', '/notes', '/navigator', '/commute', '/canteen', '/notifications', '/profile', '/about'],
  organiser: ['/', '/organiser', '/events', '/notifications', '/profile', '/about'],
  // HOD: separate portal, no classroom screens (no own timetable, classes or attendance).
  hod: ['/', '/hod', '/setup', '/navigator', '/commute', '/canteen', '/notifications', '/profile', '/about'],
  // Parent: read-only portal for their confirmed child(ren); nothing that edits college records.
  parent: ['/', '/parent', '/navigator', '/commute', '/profile', '/about'],
  admin: ['/', '/admin', '/teacher', '/navigator', '/classwork', '/attendance', '/planner', '/events', '/commute', '/canteen', '/rides', '/challenges', '/peer', '/notes', '/directory', '/notifications', '/profile', '/about'],
}
export const canAccess = (user, path) => ACCESS[roleOf(user)].includes(path)
export const routesFor = (user) => ACCESS[roleOf(user)]
