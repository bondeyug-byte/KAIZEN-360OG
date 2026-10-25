// Cloud account sync. The server identifies the user from the signed login cookie only; nothing here is trusted
// for identity or roles. The browser keeps a cached copy for speed, but the server copy is the source of truth.
const API = '/api/app'

export class SyncError extends Error {
  constructor(code, message, data) { super(message); this.code = code; this.data = data }
}

async function call(path, method = 'GET', body) {
  let res
  try {
    res = await fetch(API + path, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  } catch { throw new SyncError('NETWORK', 'You appear to be offline. Changes will sync when you reconnect.') }
  if (!(res.headers.get('content-type') || '').includes('application/json')) throw new SyncError('UNAVAILABLE', 'Cloud sync is not available here.')
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new SyncError(data?.code || `HTTP_${res.status}`, data?.error || 'Sync failed.', data)
  return data
}

export const loadAccount = () => call('/me')
export const saveAccount = (payload) => call('/me', 'PUT', payload)

// Fields the server never accepts from the user; also kept out of what we send.
const PROTECTED = ['id', 'role', 'roles', 'teaches', 'phone', 'phoneVerified', 'authMethod', 'demo', 'classRep', 'academicHistory', 'admin', 'teacher', 'email']
export function syncableProfile(p) {
  const out = {}
  for (const [k, v] of Object.entries(p || {})) if (!PROTECTED.includes(k)) out[k] = v
  return out
}
const isEmpty = (o) => !o || !Object.keys(o).length

/**
 * Merge a server account into the local cache. On the very first sync (server copy empty) the user's own data
 * from the browser-only profile for the SAME verified Google email is carried over once, so nothing is lost.
 * Never matched on a name or a phone number. Returns { db, uid, migrated }.
 */
export function adoptAccount(db, r, email, emptyUserData) {
  const uid = `acc_${r.account.id}`
  const legacy = email && isEmpty(r.profile) && isEmpty(r.data)
    ? Object.values(db.profiles).find((p) => p && p.authMethod === 'google' && p.id !== uid && p.email === email)
    : null
  const profile = { ...(legacy ? syncableProfile(legacy) : syncableProfile(r.profile)), id: uid, email: email || '', phone: null, phoneVerified: false, authMethod: 'google', demo: false }
  if (!profile.name) profile.name = r.account.name || '' // always a string (a new account has no name yet)
  const data = !isEmpty(r.data) ? r.data : (legacy && db.userData[legacy.id]) || emptyUserData()
  return {
    uid, migrated: !!legacy,
    db: { ...db, profiles: { ...db.profiles, [uid]: profile }, userData: { ...db.userData, [uid]: data } },
  }
}
