// The signed-in identity: a verified Google email (see api/auth.js), kept in an HttpOnly, Secure, SameSite=Strict
// cookie signed with SESSION_SECRET. The browser can't read or change it. Roles are NOT in the cookie: every API
// request looks them up again (api/_access.js), and the domain rule is re-checked there too.
const crypto = require('crypto');
const { normalizeEmail } = require('./_roles');

const COOKIE = 'c360_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days; a sign-out ends it everywhere (accounts.sessions_valid_after)
const LEGACY = ['mm_phone', 'mm_refresh']; // earlier phone sign-in: cleared, never accepted

function readCookie(req, name) {
  for (const part of String((req.headers && req.headers.cookie) || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}
const secret = () => process.env.SESSION_SECRET || '';
const mac = (data) => crypto.createHmac('sha256', secret()).update('c360:' + data).digest('base64url');

/** Set-Cookie value for a new session. */
function sessionCookie(email, nowSec = Math.floor(Date.now() / 1000)) {
  const data = Buffer.from(JSON.stringify({ e: email, iat: nowSec, exp: nowSec + MAX_AGE })).toString('base64url');
  return `${COOKIE}=${data}.${mac(data)}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${MAX_AGE}`;
}
function clearCookies() {
  return [`${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0`,
    ...LEGACY.flatMap((n) => [`${n}=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0`, `${n}=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0`])];
}

/** { email, iat } from a valid, unexpired session cookie, or null. */
function getSession(req, nowSec = Math.floor(Date.now() / 1000)) {
  if (secret().length < 32) return null; // not configured: nobody is signed in
  const raw = readCookie(req, COOKIE);
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 1) return null;
  const data = raw.slice(0, i), given = Buffer.from(raw.slice(i + 1)), want = Buffer.from(mac(data));
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  let p; try { p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch (e) { return null; }
  const email = normalizeEmail(p && p.e);
  if (!email || typeof p.exp !== 'number' || p.exp <= nowSec || typeof p.iat !== 'number') return null;
  return { email, iat: p.iat };
}
/** The signed-in identity (email) or null. */
const getIdentity = (req) => { const s = getSession(req); return s ? s.email : null; };

module.exports = { getSession, getIdentity, getPhone: getIdentity, sessionCookie, clearCookies, readCookie, COOKIE, MAX_AGE };
