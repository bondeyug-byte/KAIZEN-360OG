// Browser side of authentication. Talks ONLY to this app's /api/auth/* endpoints
// (the app's secure server function). The MiniMoth API key and refresh token never reach this code.
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'

const firebaseApp = initializeApp({
  apiKey: 'AIzaSyB21D4LTMbu3F-X-GyZ_FsQt4VTNCLE2ds',
  authDomain: 'kaizen-360.firebaseapp.com',
  projectId: 'kaizen-360',
  appId: '1:921924970190:web:6d5e8f55ffce97ccc3529f'
})
const API = '/api/auth'

export class AuthError extends Error {
  constructor(code, message) { super(message); this.code = code }
}

const FRIENDLY = {
  NOT_HOD: "This number isn't registered as an HOD. HOD numbers are set by the college on the server.",
  NOT_PARENT: "This number isn't linked to a student yet. Your child adds your number in Campus360 (College portal → My class) and their class teacher confirms it.",
  NOT_TEACHER: "This number isn't registered for the Teacher portal. Ask the admin to register it, or sign in on the Student tab.",
  TEACHERS_NOT_CONFIGURED: 'No teachers are registered yet. Your HOD adds teachers in the HOD portal.',
  INVALID_PHONE: 'Enter a 10-digit Indian mobile number starting with 6–9.',
  INVALID_OTP_CODE: 'The code is 6 digits.',
  INVALID_OTP: "That code isn't right. Check the message and try again.",
  OTP_NOT_FOUND: 'That code has expired or was already used. Send a new one.',
  VERIFY_RATE_LIMITED: 'Too many wrong attempts. Send a new code.',
  OTP_RATE_LIMITED: 'Too many codes sent to this number. Wait 10 minutes and try again.',
  SMS_FAILED: "We couldn't deliver the code. Try again in a moment.",
  INSUFFICIENT_BALANCE: 'Sign-in is temporarily unavailable (the OTP wallet is empty).',
  SESSION_EXPIRED: 'Your session has ended. Please sign in again.',
  NO_SESSION: 'Not signed in.',
  CONFIG_MISSING: 'Sign-in is not configured on the server yet (MINIMOTH_API_KEY is missing).',
  UPSTREAM_UNREACHABLE: "Couldn't reach the sign-in service. Try again.",
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  CONFIG_INVALID: 'Sign-in is misconfigured on the server (the MiniMoth key was rejected). Use demo sign-in for now.',
  REGION_NOT_ENABLED: 'Only Indian mobile numbers are enabled for sign-in.',
  INTERNATIONAL_WHATSAPP_FAILED: "We couldn't deliver the code on WhatsApp. Try again.",
  INTERNATIONAL_WHATSAPP_BLOCKED: 'This number is temporarily blocked after failed deliveries. Try later.',
  FORBIDDEN_ORIGIN: 'Sign-in must be used from this site.',
    WRONG_DOMAIN: 'Please sign in with your @ves.ac.in Google account.',
  INVALID_GOOGLE_TOKEN: 'Google sign-in failed. Try again.',
}

async function call(path, body, method = 'POST') {
  let res
  try {
    res = await fetch(API + path, {
      method, credentials: 'same-origin',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    })
  } catch {
    throw new AuthError('NETWORK', "Couldn't reach the sign-in server. Check your connection and try again.")
  }
  const type = res.headers.get('content-type') || ''
  if (!type.includes('application/json')) throw new AuthError('SERVER_UNAVAILABLE', 'The sign-in server is not available here. Real OTP sign-in needs the deployed app and its secure server function.')
  let data = null
  try { data = await res.json() } catch { data = null }
  if (!res.ok) throw new AuthError(data?.code || `HTTP_${res.status}`, FRIENDLY[data?.code] || data?.error || 'Something went wrong. Try again.')
  return data
}

export function normalizePhone(input) {
  const email = String(input || '').trim().toLowerCase()
  if (/^[a-z0-9._%+-]+@ves\.ac\.in$/.test(email)) return email
  const raw = String(input || '').replace(/[\s\-().]/g, '')
  const d = raw.startsWith('+91') ? raw.slice(3) : /^91[6-9]\d{9}$/.test(raw) ? raw.slice(2) : /^0[6-9]\d{9}$/.test(raw) ? raw.slice(1) : raw
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null
}
export const maskPhone = (p) => (p && p.includes('@') ? p : p && p.length >= 13 ? `${p.slice(0, 3)} ${p.slice(3, 5)}xxxx ${p.slice(-4)}` : p || '')
export async function serverAvailable() {
  try { const r = await call('/health', null, 'GET'); return { available: true, configured: !!r.configured, mode: r.mode || null } }
  catch (e) { return { available: false, configured: false, reason: e.message } }
}
export const sendOtp = (phone, portal) => call('/send', portal ? { phone, portal } : { phone })
export const otpStatus = (otpId) => call(`/status?otp_id=${encodeURIComponent(otpId)}`, null, 'GET')
export const verifyOtp = (phone, code) => call('/verify', { phone, code })
export const restoreSession = () => call('/session')
export const validateToken = (access_token) => call('/validate', { access_token })
export const logout = (access_token) => call('/logout', { access_token })
export async function googleSignIn() {
  const fbAuth = getAuth(firebaseApp)
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ hd: 'ves.ac.in', prompt: 'select_account' })
  let result
  try {
    result = await signInWithPopup(fbAuth, provider)
  } catch (e) {
    throw new AuthError('GOOGLE_CANCELLED', 'Google sign-in was cancelled or blocked. Allow popups and try again.')
  }
  try {
    const idToken = await result.user.getIdToken()
    return await call('/google', { idToken })
  } finally {
    signOut(fbAuth).catch(() => {})
  }
}