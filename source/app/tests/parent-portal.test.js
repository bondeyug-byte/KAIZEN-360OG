import { describe, it, expect } from 'vitest'
import { canAccess, roleOf, ROLE_LABEL } from '../src/lib/roles.js'
import { isStudent } from '../src/lib/posts.js'
import { adoptAccount } from '../src/lib/account.js'

describe('parent role (client side; the server enforces the same rules)', () => {
  const parent = { id: 'acc_1', role: 'parent', name: 'A Parent' }
  it('is its own role, not a student', () => {
    expect(roleOf(parent)).toBe('parent'); expect(ROLE_LABEL.parent).toBe('Parent'); expect(isStudent(parent)).toBe(false)
  })
  it('opens only the parent portal and public campus pages', () => {
    for (const p of ['/', '/parent', '/navigator', '/commute', '/profile']) expect(canAccess(parent, p)).toBe(true)
    for (const p of ['/teacher', '/hod', '/portal', '/attendance', '/classwork', '/admin', '/planner', '/organiser']) expect(canAccess(parent, p)).toBe(false)
  })
  it('students and teachers cannot open the parent portal route', () => {
    expect(canAccess({ role: undefined }, '/parent')).toBe(false); expect(canAccess({ role: 'teacher' }, '/parent')).toBe(false)
  })
  it('a new phone account always gets a string name (no "damaged data" warning on reload)', () => {
    const r = adoptAccount({ profiles: {}, userData: {} }, { account: { id: 'x', name: null }, profile: {}, data: {} }, '+919100000201', () => ({ subjects: [], deadlines: [] }))
    expect(r.db.profiles.acc_x.name).toBe('')
  })
})
import { sanitizeDb } from '../src/lib/storage.js'
describe('stored-data sanitiser and new phone accounts', () => {
  it('an empty name is not "damage" (it would skip onboarding and show a scary toast)', () => {
    const db = { shared: {}, profiles: { a: { id: 'a', name: '', interests: [], subjects: [] } }, userData: { a: { subjects: [], deadlines: [] } } }
    for (const k of ['rides', 'rideRequests', 'challenges', 'posts', 'events', 'notes', 'attSessions', 'notifications', 'dishes', 'reviews', 'noteRequests', 'tutorReviews', 'eventChats']) db.shared[k] = []
    const r = sanitizeDb(db, () => ({ subjects: [], deadlines: [] }))
    expect(r.fixed).toBe(0); expect(r.db.profiles.a.name).toBe('')
  })
})
