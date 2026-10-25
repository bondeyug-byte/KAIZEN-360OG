// Browser side of sign-in: "Continue with Google" through Firebase Authentication.
//
// 1. The Firebase web config comes from this app's server (/api/auth/health), not from the build, so the same
//    build works on every domain the college authorises.
// 2. Google sign-in runs in a popup; when the popup is blocked or unsupported (some phone browsers) it falls back to
//    a full-page redirect and finishes when the page loads again.
// 3. The Firebase ID token is sent ONCE to /api/auth/google. The server verifies it, applies the portal rule
//    (…@ves.ac.in for Student/Teacher/HOD; a confirmed parent link for Parent) and sets an HttpOnly session cookie.
//    The browser then signs out of Firebase, so no Google token is kept in the page.
// Nothing here decides access: the server checks the domain and the role again on every request.
const API = '/api/auth'
const PENDING = 'c360.googleRedirect' // which portal a redirect sign-in was for (sessionStorage, this tab only)

export class AuthError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

const FRIENDLY = {
  NO_SESSION: 'Not signed in.',
  SESSION_ENDED: 'You signed out. Sign in again.',
  CONFIG_MISSING: 'Google sign-in isn’t set up on the server yet. The college needs to finish the Firebase settings.',
  AUTH_UNAVAILABLE: 'Sign-in is temporarily unavailable. Try again.',
  RATE_LIMITED: 'Too many sign-in attempts. Wait a few minutes and try again.',
  FORBIDDEN_ORIGIN: 'Sign-in must be used from this site.',
  TOKEN_EXPIRED: 'Your Google sign-in expired. Try again.',
}
// Firebase client error codes → what the person should do.
const FIREBASE = {
  'auth/popup-closed-by-user': ['CANCELLED', 'Sign-in was cancelled.'],
  'auth/cancelled-popup-request': ['CANCELLED', 'Sign-in was cancelled.'],
  'auth/user-cancelled': ['CANCELLED', 'Sign-in was cancelled.'],
  'auth/network-request-failed': ['NETWORK', 'Couldn’t reach Google. Check your connection and try again.'],
  'auth/unauthorized-domain': ['UNAUTHORIZED_DOMAIN', 'This web address isn’t on the app’s list of allowed sign-in domains yet (Firebase → Authentication → Settings → Authorized domains).'],
  'auth/operation-not-allowed': ['PROVIDER_DISABLED', 'Google sign-in isn’t switched on for this app yet (Firebase → Authentication → Sign-in method → Google).'],
  'auth/invalid-api-key': ['CONFIG_INVALID', 'The app’s Firebase settings are wrong (invalid API key).'],
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': ['CONFIG_INVALID', 'The app’s Firebase settings are wrong (invalid API key).'],
  'auth/user-disabled': ['DISABLED', 'This Google account has been disabled for this app.'],
  'auth/too-many-requests': ['RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'],
  'auth/internal-error': ['AUTH_UNAVAILABLE', 'Google sign-in failed. Try again.'],
  'auth/web-storage-unsupported': ['STORAGE_BLOCKED', 'This browser is blocking the storage Google sign-in needs. Turn off private mode or allow cookies for this site.'],
}
const POPUP_FALLBACK = ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment']

async function call(path, body, method = 'POST') {
  let res
  try {
    res = await fetch(API + path, { method, credentials: 'same-origin', headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? JSON.stringify(body || {}) : undefined })
  } catch {
    throw new AuthError('NETWORK', 'Couldn’t reach the sign-in server. Check your connection and try again.')
  }
  const type = res.headers.get('content-type') || ''
  if (!type.includes('application/json')) throw new AuthError('SERVER_UNAVAILABLE', 'The sign-in server isn’t available here. Google sign-in needs the deployed app and its server functions.')
  let data = null
  try { data = await res.json() } catch { data = null }
  if (!res.ok) throw new AuthError(data?.code || `HTTP_${res.status}`, FRIENDLY[data?.code] || data?.error || 'Something went wrong. Try again.')
  return data
}

let health = null
/** { available, configured, missing[], firebase|null, institutionDomain } */
export async function serverAvailable() {
  try { const r = await call('/health', null, 'GET'); health = r; return { available: true, configured: !!r.configured, missing: r.missing || [], firebase: r.firebase || null, institutionDomain: r.institutionDomain || 'ves.ac.in' } }
  catch (e) { return { available: false, configured: false, missing: [], reason: e.message } }
}

let fb = null // { auth, mod } once loaded; the Firebase SDK is only downloaded when someone signs in
async function firebase() {
  if (fb) return fb
  if (!health) await serverAvailable()
  const cfg = health?.firebase
  if (!cfg?.apiKey || !cfg?.authDomain || !cfg?.projectId) throw new AuthError('CONFIG_MISSING', FRIENDLY.CONFIG_MISSING)
  const [{ initializeApp, getApps }, mod] = await Promise.all([import('firebase/app'), import('firebase/auth')])
  const app = getApps()[0] || initializeApp(cfg)
  // Tab-only persistence, and we sign out of Firebase straight after handing the token to the server.
  const auth = mod.initializeAuth(app, { persistence: [mod.browserSessionPersistence, mod.inMemoryPersistence], popupRedirectResolver: mod.browserPopupRedirectResolver })
  fb = { auth, mod }
  return fb
}
const toAuthError = (e) => {
  if (e instanceof AuthError) return e
  const m = FIREBASE[e?.code]
  return m ? new AuthError(m[0], m[1]) : new AuthError('AUTH_FAILED', 'Google sign-in failed. Try again.')
}
function provider(mod, portal) {
  const p = new mod.GoogleAuthProvider() // default scopes only: openid, email, profile (no Gmail, Drive or other APIs)
  // `hd` only pre-selects the college account in Google's chooser; the SERVER enforces the domain.
  p.setCustomParameters(portal === 'parent' ? { prompt: 'select_account' } : { prompt: 'select_account', hd: health?.institutionDomain || 'ves.ac.in' })
  return p
}
async function exchange(mod, auth, user, portal) {
  try {
    const idToken = await user.getIdToken(true)
    return await call('/google', { idToken, portal })
  } finally {
    try { await mod.signOut(auth) } catch { /* nothing kept anyway */ }
  }
}

let busy = false
/** Popup first; if the browser blocks popups, a redirect (the page reloads and finishPendingSignIn() completes it). */
export async function signInWithGoogle(portal) {
  if (busy) throw new AuthError('BUSY', 'Sign-in is already in progress.')
  busy = true
  try {
    // eslint-disable-next-line no-undef
    if (typeof __E2E__ !== 'undefined' && __E2E__ && typeof window !== 'undefined' && window.__e2eGoogle) {
      const idToken = await window.__e2eGoogle(portal, health?.firebase) // browser tests: a locally signed test token
      return await call('/google', { idToken, portal })
    }
    const { auth, mod } = await firebase()
    try {
      const cred = await mod.signInWithPopup(auth, provider(mod, portal))
      return await exchange(mod, auth, cred.user, portal)
    } catch (e) {
      if (!POPUP_FALLBACK.includes(e?.code)) throw e
      try { sessionStorage.setItem(PENDING, JSON.stringify({ portal, at: Date.now() })) } catch { throw new AuthError('STORAGE_BLOCKED', FIREBASE['auth/web-storage-unsupported'][1]) }
      await mod.signInWithRedirect(auth, provider(mod, portal))
      return { redirected: true }
    }
  } catch (e) { throw toAuthError(e) } finally { busy = false }
}
/** After a redirect sign-in: null if none is pending, else the server's sign-in result (or throws). */
export async function finishPendingSignIn() {
  let pending = null
  try { pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null') } catch { pending = null }
  if (!pending) return null
  try { sessionStorage.removeItem(PENDING) } catch { /* ignore */ }
  if (Date.now() - pending.at > 10 * 60000) return null
  try {
    const { auth, mod } = await firebase()
    const cred = await mod.getRedirectResult(auth)
    if (!cred?.user) return null
    return { ...(await exchange(mod, auth, cred.user, pending.portal)), portal: pending.portal }
  } catch (e) { throw toAuthError(e) }
}
export const pendingRedirectPortal = () => { try { return JSON.parse(sessionStorage.getItem(PENDING) || 'null')?.portal || null } catch { return null } }

export const restoreSession = () => call('/session')
export const logout = () => call('/logout')
// Legacy helper kept for screens that still show an old phone-account number.
export const maskPhone = (p) => (p && p.length >= 13 ? `${p.slice(0, 3)} ${p.slice(3, 5)}xxxx ${p.slice(-4)}` : p || '')
export const maskEmail = (e) => { if (!e || !e.includes('@')) return e || ''; const [u, d] = e.split('@'); return `${u.slice(0, 2)}•••@${d}` }
/** Exactly …@ves.ac.in (the same rule as the server; the server decides). */
export const isInstitutionalEmail = (e, domain = 'ves.ac.in') => { const s = String(e || '').trim().toLowerCase(); const i = s.lastIndexOf('@'); return i > 0 && s.indexOf('@') === i && s.slice(i + 1) === domain }
