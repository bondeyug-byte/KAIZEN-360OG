// Campus360 auth proxy for MiniMoth phone OTP (Netlify Functions v2).
// The MiniMoth API key lives ONLY here, in the server-side env var MINIMOTH_API_KEY.
// The refresh token lives ONLY in an HttpOnly, Secure cookie; the browser never sees it.
//
// Routes (all under /api/auth/*):
//   GET  /api/auth/health    -> { configured, mode: 'live' | 'test' | 'unknown' | null }   (never the key)
//   GET  /api/auth/status?otp_id=…  -> MiniMoth GET /v1/otp/status/:otp_id  (delivery channel + state)
//   POST /api/auth/send      { phone }          -> MiniMoth POST /v1/otp/send
//   POST /api/auth/verify    { phone, code }    -> MiniMoth POST /v1/otp/verify   (sets refresh cookie)
//   POST /api/auth/session   (cookie)           -> MiniMoth POST /v1/session/refresh + /v1/session/validate (rotates cookie)
//   POST /api/auth/validate  { access_token }   -> MiniMoth POST /v1/session/validate
//   POST /api/auth/logout    { access_token }   -> MiniMoth POST /v1/session/logout (clears cookies)

export const MINIMOTH_BASE = 'https://api.minimoth.dev'
const RT_COOKIE = 'c360_rt'
const PHONE_COOKIE = 'c360_ph'

export function normalizePhone(input) {
  const raw = String(input || '').replace(/[\s-]/g, '')
  const digits = raw.startsWith('+91') ? raw.slice(3) : raw.startsWith('91') && raw.length === 12 ? raw.slice(2) : raw
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null
}

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
}
const clearCookies = () => [cookie(RT_COOKIE, '', 0), cookie(PHONE_COOKIE, '', 0)]

function readCookie(req, name) {
  const header = req.headers.get('cookie') || ''
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

/** Admins are listed server-side only: ADMIN_PHONES = comma-separated numbers (e.g. 9876543210,+919812345678). */
export function isAdminPhone(phone, env) {
  const list = String(env.ADMIN_PHONES || '').split(',').map((x) => normalizePhone(x.trim())).filter(Boolean)
  return !!phone && list.includes(normalizePhone(phone))
}
/**
 * Teachers can also be listed server-side, so they get the teacher portal on any device:
 * TEACHER_PHONES = entries separated by ";", each  phone=Name|DIVISION:Subject,DIVISION:Subject
 * e.g.  9876543210=Prof. Meera Kulkarni|D1ADA:Engineering Mathematics I,D1ADB:Engineering Mathematics I;9123456789=Dr. Arjun Pillai|D1CSA:Programming in C
 * The name is optional ("9876543210=D1ADA:Engineering Mathematics I"). Returns null when the phone isn't listed.
 */
export function teacherFor(phone, env) {
  const me = normalizePhone(phone)
  if (!me) return null
  for (const raw of String(env.TEACHER_PHONES || '').split(';')) {
    const i = raw.indexOf('='); if (i < 0) continue
    if (normalizePhone(raw.slice(0, i).trim()) !== me) continue
    const rest = raw.slice(i + 1).trim(); const bar = rest.indexOf('|')
    const name = bar >= 0 ? rest.slice(0, bar).trim().slice(0, 80) : ''
    const teaches = (bar >= 0 ? rest.slice(bar + 1) : rest).split(',').map((x) => { const c = x.indexOf(':'); return c < 0 ? null : { division: x.slice(0, c).trim().toUpperCase(), subject: x.slice(c + 1).trim().slice(0, 80) } }).filter((t) => t && /^D\d[A-Z0-9]{0,4}$/.test(t.division) && t.subject)
    return teaches.length ? { name, teaches } : null
  }
  return null
}
export const keyMode = (key) => (!key ? null : key.startsWith('mm_test_') ? 'test' : key.startsWith('mm_live_') ? 'live' : 'unknown')
const TIMEOUT_MS = 15000

async function minimoth(path, body, env, method = 'POST') {
  const key = env.MINIMOTH_API_KEY
  if (!key) return { status: 500, data: { error: 'Sign-in is not configured on the server (MINIMOTH_API_KEY is missing).', code: 'CONFIG_MISSING' } }
  let res
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    res = await fetch(MINIMOTH_BASE + path, { method, signal: ac.signal, headers: { 'X-Api-Key': key, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined })
  } catch {
    return { status: 502, data: { error: 'Could not reach the sign-in service. Please try again.', code: 'UPSTREAM_UNREACHABLE' } }
  } finally { clearTimeout(t) }
  let data = null
  try { data = await res.json() } catch { data = null } // logout returns no body
  if (!res.ok) {
    // A rejected key is a server configuration problem: report it without any detail about the key.
    if (data?.code === 'INVALID_API_KEY' || data?.code === 'MISSING_API_KEY') return { status: 500, data: { error: 'Sign-in is misconfigured on the server.', code: 'CONFIG_INVALID' } }
    return { status: res.status, data: { error: data?.error || 'Sign-in service error.', code: data?.code || `HTTP_${res.status}` } }
  }
  return { status: 200, data }
}

function withCookies(response, cookies) {
  const h = new Headers(response.headers)
  for (const c of cookies) h.append('Set-Cookie', c)
  return new Response(response.body, { status: response.status, headers: h })
}

export async function handle(req, env = process.env) {
  const url = new URL(req.url)
  const route = url.pathname.replace(/\/+$/, '').split('/').pop()
  const maxAge = Number(env.MINIMOTH_REFRESH_MAX_AGE) || 864000

  if (route === 'health' && req.method === 'GET') return json(200, { configured: !!env.MINIMOTH_API_KEY, mode: keyMode(env.MINIMOTH_API_KEY) })
  if (route === 'status' && req.method === 'GET') {
    const id = url.searchParams.get('otp_id') || ''
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return json(422, { error: 'otp_id is required.', code: 'INVALID_OTP_ID' })
    const r = await minimoth(`/v1/otp/status/${id}`, null, env, 'GET')
    if (r.status !== 200) return json(r.status, r.data)
    return json(200, { channel: r.data.channel ?? null, status: r.data.status ?? null, delivered_at: r.data.delivered_at ?? null })
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' })
  // Only this site may call the auth routes from a browser (cookies are SameSite=Lax; this blocks cross-site POSTs too).
  const origin = req.headers.get('origin')
  if (origin) { try { if (new URL(origin).host !== url.host) return json(403, { error: 'Cross-site request blocked.', code: 'FORBIDDEN_ORIGIN' }) } catch { return json(403, { error: 'Cross-site request blocked.', code: 'FORBIDDEN_ORIGIN' }) } }

  let body = {}
  try { body = (await req.json()) || {} } catch { body = {} }

  if (route === 'send') {
    const phone = normalizePhone(body.phone)
    if (!phone) return json(422, { error: 'Enter a 10-digit Indian mobile number starting with 6–9.', code: 'INVALID_PHONE' })
    if (body.portal === 'teacher' && !isAdminPhone(phone, env) && !teacherFor(phone, env)) {
      if (!String(env.TEACHER_PHONES || '').trim()) return json(403, { error: 'No teacher numbers are set up on the server yet.', code: 'TEACHERS_NOT_CONFIGURED' })
      return json(403, { error: "This number isn't registered for the Teacher portal.", code: 'NOT_TEACHER' })
    }
    const r = await minimoth('/v1/otp/send', { phone }, env)
    if (r.status !== 200) return json(r.status, r.data)
    return json(200, { otp_id: r.data.otp_id, expires_at: r.data.expires_at, phone })
  }

  if (route === 'verify') {
    const phone = normalizePhone(body.phone)
    const code = String(body.code || '').trim()
    if (!phone) return json(422, { error: 'Enter a valid mobile number.', code: 'INVALID_PHONE' })
    if (!/^\d{6}$/.test(code)) return json(422, { error: 'The code is 6 digits.', code: 'INVALID_OTP_CODE' })
    const r = await minimoth('/v1/otp/verify', { phone, code }, env)
    if (r.status !== 200) return json(r.status, r.data)
    const { access_token, refresh_token, expires_at, identity_id } = r.data
    if (!access_token || !refresh_token) return json(502, { error: 'Unexpected response from the sign-in service.', code: 'BAD_UPSTREAM_RESPONSE' })
    return withCookies(json(200, { access_token, expires_at, identity_id, phone, admin: isAdminPhone(phone, env), teacher: teacherFor(phone, env) }), [cookie(RT_COOKIE, refresh_token, maxAge), cookie(PHONE_COOKIE, phone, maxAge)])
  }

  if (route === 'session') {
    const rt = readCookie(req, RT_COOKIE)
    if (!rt) return json(401, { error: 'Not signed in.', code: 'NO_SESSION' })
    const r = await minimoth('/v1/session/refresh', { refresh_token: rt }, env)
    if (r.status !== 200) {
      // Expired, reused outside the grace window, or revoked: the session is over.
      const res = json(r.status === 401 ? 401 : r.status, r.status === 401 ? { error: 'Your session has ended. Please sign in again.', code: r.data.code || 'SESSION_EXPIRED' } : r.data)
      return r.status === 401 ? withCookies(res, clearCookies()) : res
    }
    const { access_token, refresh_token, expires_at } = r.data
    const v = await minimoth('/v1/session/validate', { access_token }, env)
    const phone = readCookie(req, PHONE_COOKIE)
    // Always replace BOTH tokens: the new refresh token goes back into the cookie.
    return withCookies(json(200, { access_token, expires_at, identity_id: v.data?.identity_id ?? null, phone, admin: isAdminPhone(phone, env), teacher: teacherFor(phone, env) }), [cookie(RT_COOKIE, refresh_token, maxAge)])
  }

  if (route === 'validate') {
    if (!body.access_token) return json(422, { error: 'access_token is required.', code: 'MISSING_ACCESS_TOKEN' })
    const r = await minimoth('/v1/session/validate', { access_token: body.access_token }, env)
    if (r.status !== 200) return json(r.status, r.data)
    return json(200, { valid: !!r.data.valid, expires_at: r.data.expires_at ?? null, identity_id: r.data.identity_id ?? null })
  }

  if (route === 'logout') {
    let token = body.access_token
    let revoked = false
    if (token) {
      let r = await minimoth('/v1/session/logout', { access_token: token }, env)
      if (r.status === 401 && r.data.code === 'INVALID_ACCESS_TOKEN') {
        // Documented: refresh first, then log out.
        const rt = readCookie(req, RT_COOKIE)
        if (rt) {
          const f = await minimoth('/v1/session/refresh', { refresh_token: rt }, env)
          if (f.status === 200) r = await minimoth('/v1/session/logout', { access_token: f.data.access_token }, env)
        }
      }
      revoked = r.status === 200
    }
    return withCookies(json(200, { ok: true, revoked }), clearCookies())
  }

  return json(404, { error: 'Unknown auth route.', code: 'NOT_FOUND' })
}

export default async (req) => handle(req, process.env)
export const config = { path: '/api/auth/*' }
