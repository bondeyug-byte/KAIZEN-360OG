// api/auth.js  (Vercel Serverless Function)
// Campus360 sign-in with Google, restricted to @ves.ac.in accounts and verified through Firebase.
//
// Routes (under /api/auth, rewritten to this file by vercel.json):
//   GET  /api/auth/health   POST /api/auth/google   POST /api/auth/session   POST /api/auth/logout
//
// Env vars: FIREBASE_API_KEY (the Firebase web apiKey) and SESSION_SECRET (any long random text).
// The signed-in email lives in a signed httpOnly cookie. It keeps the old "mm_phone" name so the
// rest of the API, which reads that cookie, works unchanged. It now holds the email.

const crypto = require('crypto');
const { signInRole } = require('./_access');
const dbmod = require('./_db');

const SESSION_COOKIE = 'mm_phone';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 10; // 10 days
const GOOGLE_DOMAIN = '@ves.ac.in';
const secret = () => process.env.SESSION_SECRET || process.env.MINIMOTH_API_KEY || '';

/* ---------- helpers ---------- */

function respond(res, status, body, cookies) {
  res.setHeader('Cache-Control', 'no-store');
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  return res.status(status).json(body);
}
const fail = (res, status, code, message, cookies) =>
  respond(res, status, { ok: false, code, error: message }, cookies);

const cookie = (name, value, path = '/api/auth') =>
  `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=${path}; Max-Age=${COOKIE_MAX_AGE}`;
const expired = (name, path = '/api/auth') =>
  `${name}=; HttpOnly; Secure; SameSite=Strict; Path=${path}; Max-Age=0`;
const clearAll = () => [
  expired(SESSION_COOKIE, '/api'), expired(SESSION_COOKIE),
  expired('mm_refresh'), expired('g_email', '/api'),
];

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// The signed-in email is stored in a signed cookie so it can't be edited in the browser.
const sign = (v) => crypto.createHmac('sha256', secret()).update('phone:' + v).digest('hex').slice(0, 32);
const sessionCookie = (email) => cookie(SESSION_COOKIE, `${encodeURIComponent(email)}.${sign(email)}`, '/api');
function readSession(req) {
  if (!secret()) return null;
  const raw = readCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const email = decodeURIComponent(raw.slice(0, i));
  const given = Buffer.from(raw.slice(i + 1));
  const expected = Buffer.from(sign(email));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return email;
}

// Rate limits use the database when it is configured.
async function allowed(key, max, sec) {
  try { await dbmod.ensureSchema(); return await dbmod.allow(key, max, sec); }
  catch (e) { return true; }
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

/** Role for sign-in: HOD outranks teacher outranks student. Never fails sign-in. */
async function roleFor(id) {
  try { return await signInRole(id); }
  catch (e) { return { base: 'student', hod: null, teacher: null, unavailable: true }; }
}
const roleSummary = async (id) => {
  const r = await roleFor(id);
  return { role: r.base, hod: r.hod, teacher: r.teacher, parent: r.parent || null, admin: false };
};
const sessionBody = async (email, name) => ({
  ok: true,
  phone: email, // the app calls this field "phone"; it now holds the email
  email,
  name: name || null,
  access_token: null,
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  ...(await roleSummary(email)),
});

/* ---------- handler ---------- */

module.exports = async (req, res) => {
  const route =
    (req.query && req.query.route) ||
    (req.url || '').split('?')[0].replace(/^.*\/auth\/?/, '').replace(/\/+$/, '');
  const method = req.method;

  try {
    if (route === 'health' && method === 'GET') {
      return respond(res, 200, {
        ok: true,
        configured: !!process.env.FIREBASE_API_KEY && !!secret(),
        mode: 'live',
        teachersConfigured: !!String(process.env.TEACHER_PHONES || '').trim(),
        hodsConfigured: !!String(process.env.HOD_PHONES || '').trim(),
        databaseConfigured: !!process.env.DATABASE_URL,
      });
    }

    if (method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');

    // Block cross-site POSTs (cookies are also SameSite=Strict)
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin) {
      let originHost = null;
      try { originHost = new URL(origin).host; } catch (_) {}
      if (!originHost || originHost !== host) {
        return fail(res, 403, 'FORBIDDEN_ORIGIN', 'Sign-in must be used from this site.');
      }
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); }
      catch (_) { return fail(res, 400, 'BAD_REQUEST', 'Invalid request.'); }
    }
    body = body || {};

    // POST /google { idToken }: verify a Firebase Google sign-in, @ves.ac.in only
    if (route === 'google') {
      if (!process.env.FIREBASE_API_KEY || !secret()) {
        console.error('FIREBASE_API_KEY or SESSION_SECRET is not set.');
        return fail(res, 503, 'CONFIG_MISSING', 'Sign-in is not configured on the server yet.');
      }
      const idToken = String(body.idToken || '');
      if (!idToken) return fail(res, 400, 'BAD_REQUEST', 'Missing token.');
      if (!(await allowed(`google:${clientIp(req)}`, 20, 600))) {
        return fail(res, 429, 'RATE_LIMITED', 'Too many attempts. Wait 10 minutes and try again.');
      }
      // Google checks the token for us; no extra library needed.
      const r = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
      );
      const data = await r.json().catch(() => ({}));
      const u = data.users && data.users[0];
      if (!r.ok || !u) return fail(res, 401, 'INVALID_GOOGLE_TOKEN', 'Google sign-in failed. Try again.');

      const email = String(u.email || '').toLowerCase();
      const viaGoogle = (u.providerUserInfo || []).some((p) => p.providerId === 'google.com');
      if (!viaGoogle || !u.emailVerified || !email.endsWith(GOOGLE_DOMAIN)) {
        return fail(res, 403, 'WRONG_DOMAIN', 'Please use your @ves.ac.in account.');
      }
      return respond(res, 200, await sessionBody(email, u.displayName), [sessionCookie(email)]);
    }

    // POST /session: restore the login from the cookie (keeps people signed in after a refresh)
    if (route === 'session') {
      const email = readSession(req);
      if (!email) return fail(res, 401, 'NO_SESSION', 'Not signed in.');
      if (!email.endsWith(GOOGLE_DOMAIN)) return fail(res, 401, 'SESSION_EXPIRED', 'Session expired.', clearAll());
      return respond(res, 200, await sessionBody(email), [sessionCookie(email)]);
    }

    // POST /logout
    if (route === 'logout') return respond(res, 200, { ok: true }, clearAll());

    return fail(res, 404, 'NOT_FOUND', 'Unknown route.');
  } catch (err) {
    console.error('auth function error:', err);
    return fail(res, 502, 'UPSTREAM_UNREACHABLE', "Couldn't reach the sign-in service.");
  }
};
