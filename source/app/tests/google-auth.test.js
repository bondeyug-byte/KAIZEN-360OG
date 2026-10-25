// Google sign-in, browser side: the email helpers mirror the server rule (the server decides).
import { describe, it, expect } from 'vitest'
import { isInstitutionalEmail, maskEmail } from '../src/lib/auth.js'
import { adoptAccount, syncableProfile } from '../src/lib/account.js'
import { verificationOf } from '../src/lib/rides.js'

describe('Google sign-in helpers', () => {
  it('exact @ves.ac.in only (case-insensitive), no look-alikes', () => {
    for (const ok of ['student@ves.ac.in', 'Student@VES.AC.IN', ' x.y@ves.ac.in ']) expect(isInstitutionalEmail(ok)).toBe(true)
    for (const no of ['student@gmail.com', 'user@ves.ac.in.example.com', 'user@mail.ves.ac.in', 'a@b@ves.ac.in', 'ves.ac.in', '', null]) expect(isInstitutionalEmail(no)).toBe(false)
  })
  it('masks emails for teachers and class reps', () => { expect(maskEmail('parent@gmail.com')).toBe('pa•••@gmail.com') })
  it('the sign-in email is never sent as an editable profile field, and adoption matches only the same email', () => {
    expect(syncableProfile({ name: 'A', email: 'a@ves.ac.in', role: 'hod' })).toEqual({ name: 'A' })
    const db = { profiles: { g_a: { id: 'g_a', authMethod: 'google', email: 'a@ves.ac.in', name: 'Mine' }, g_b: { id: 'g_b', authMethod: 'google', email: 'b@ves.ac.in', name: 'Other' } }, userData: { g_a: { subjects: [1] }, g_b: { subjects: [2] } } }
    const r = adoptAccount(db, { account: { id: '9', name: '' }, profile: {}, data: {} }, 'a@ves.ac.in', () => ({ subjects: [] }))
    expect(r.migrated).toBe(true); expect(r.db.profiles.acc_9.name).toBe('Mine'); expect(r.db.userData.acc_9.subjects).toEqual([1])
    expect(adoptAccount(db, { account: { id: '9', name: '' }, profile: {}, data: {} }, 'c@ves.ac.in', () => ({ subjects: [] })).migrated).toBe(false)
  })
  it('rides: verified only for a college Google account', () => {
    expect(verificationOf({ authMethod: 'google', email: 'a@ves.ac.in' })).toBe('verified')
    expect(verificationOf({ authMethod: 'google', email: 'a@gmail.com' })).toBe('unverified')
  })
})
