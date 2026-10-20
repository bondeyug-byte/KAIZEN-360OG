// api/auth.js  (Vercel Serverless Function)
// Campus360 phone sign-in via MiniMoth (WhatsApp/SMS OTP).
//
// Routes (all under /api/auth, rewritten to this file by vercel.json):
//   GET  /api/auth/health   POST /api/auth/send    GET  /api/auth/status?otp_id=...
//   POST /api/auth/verify   POST /api/auth/session POST /api/auth/logout
//
// Needs the env var MINIMOTH_API_KEY (mm_test_... or mm_live_...). Never exposed to the browser.
// The refresh token lives in an httpOnly cookie, never in the page.

const crypto = require('crypto');

const API_BASE = 'https://api.minimoth.dev';
const REFRESH_COOKIE = 'mm_refresh';
const PHONE_COOKIE = 'mm_phone';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 10; // 10 days

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
const clearAll = () => [expired(REFRESH_COOKIE), expired(PHONE_COOKIE, '/api'), expired(PHONE_COOKIE)];

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// The verified phone is remembered in a signed cookie so it can't be edited in the browser.
const sign = (phone) =>
  crypto.createHmac('sha256', process.env.MINIMOTH_API_KEY).update('phone:' + phone).digest('hex').slice(0, 32);
const phoneCookie = (phone) => cookie(PHONE_COOKIE, `${encodeURIComponent(phone)}.${sign(phone)}`, '/api');
function readPhone(req) {
  const raw = readCookie(req, PHONE_COOKIE);
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const phone = decodeURIComponent(raw.slice(0, i));
  const given = Buffer.from(raw.slice(i + 1));
  const expected = Buffer.from(sign(phone));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return phone;
}

// Accepts 9876543210, 919876543210, +919876543210 (spaces and hyphens ignored).
const { normalizePhone } = require('./_roles'); // one shared rule for every phone format

async function minimoth(path, { method = 'POST', body } = {}) {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'X-Api-Key': process.env.MINIMOTH_API_KEY,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await r.json();
  } catch (_) {}
  return { ok: r.ok, status: r.status, data };
}

function upstreamError(res, r, cookies) {
  const code = r.data.code || 'UNKNOWN_ERROR';
  if (code === 'MISSING_API_KEY' || code === 'INVALID_API_KEY') {
    console.error('MiniMoth rejected the API key:', code, r.data.request_id);
    return fail(res, 502, 'CONFIG_INVALID', 'Sign-in is misconfigured on the server.', cookies);
  }
  if (r.status >= 500 && code !== 'SMS_FAILED' && !code.startsWith('INTERNATIONAL_')) {
    console.error('MiniMoth server error:', r.status, code, r.data.error, r.data.request_id);
    return fail(res, 502, 'UPSTREAM_UNREACHABLE', 'Sign-in service error.', cookies);
  }
  if (code === 'INSUFFICIENT_BALANCE') console.error('MiniMoth wallet is empty. Top up at app.minimoth.dev');
  const status = r.status >= 400 && r.status < 600 ? r.status : 400;
  return fail(res, status, code, r.data.error || 'Something went wrong.', cookies);
}

/* ---------- handler ---------- */

const { signInRole } = require('./_access');
const dbmod = require('./_db');

// Rate limits use the database when it is configured; without it, MiniMoth's own limits still apply.
async function allowed(key, max, sec) {
  try { await dbmod.ensureSchema(); return await dbmod.allow(key, max, sec); }
  catch (e) { return true; }
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
const roleSummary = async (phone) => { const r = await roleFor(phone); return { role: r.base, hod: r.hod, teacher: r.teacher, parent: r.parent || null, admin: false }; };
/** Role for sign-in: HOD (HOD_PHONES) outranks teacher (HOD's teacher list) outranks student. Never fails sign-in. */
async function roleFor(phone) {
  try { return await signInRole(phone); }
  catch (e) { return { base: 'student', hod: null, teacher: null, unavailable: true }; }
}

module.exports = async (req, res) => {
  const key = process.env.MINIMOTH_API_KEY;
  const route =
    (req.query && req.query.route) ||
    (req.url || '').split('?')[0].replace(/^.*\/auth\/?/, '').replace(/\/+$/, '');
  const method = req.method;

  try {
    // GET /health: tells the page whether real OTP is available
    if (route === 'health' && method === 'GET') {
      const mode = !key ? null : key.startsWith('mm_test_') ? 'test' : key.startsWith('mm_live_') ? 'live' : null;
      return respond(res, 200, { ok: true, configured: !!key && !!mode, mode, teachersConfigured: !!String(process.env.TEACHER_PHONES || '').trim(), hodsConfigured: !!String(process.env.HOD_PHONES || '').trim(), databaseConfigured: !!process.env.DATABASE_URL });
    }

    if (!key) {
      console.error('MINIMOTH_API_KEY is not set.');
      return fail(res, 503, 'CONFIG_MISSING', 'MINIMOTH_API_KEY is not set.');
    }

    // GET /status?otp_id=...
    if (route === 'status' && method === 'GET') {
      const otpId = req.query && req.query.otp_id;
      if (!otpId) return fail(res, 400, 'BAD_REQUEST', 'Missing otp_id.');
      const r = await minimoth(`/v1/otp/status/${encodeURIComponent(otpId)}`, { method: 'GET' });
      if (!r.ok) return upstreamError(res, r);
      return respond(res, 200, {
        ok: true,
        channel: r.data.channel,
        status: r.data.status,
        delivered_at: r.data.delivered_at,
      });
    }

    if (method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');

    // Block cross-site POSTs (cookies are also SameSite=Strict)
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin) {
      let originHost = null;
      try {
        originHost = new URL(origin).host;
      } catch (_) {}
      if (!originHost || originHost !== host) {
        return fail(res, 403, 'FORBIDDEN_ORIGIN', 'Sign-in must be used from this site.');
      }
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body || '{}');
      } catch (_) {
        return fail(res, 400, 'BAD_REQUEST', 'Invalid request.');
      }
    }
    body = body || {};

    // POST /send { phone }
    if (route === 'send') {
      const phone = normalizePhone(body.phone);
      if (!phone) return fail(res, 422, 'INVALID_PHONE', 'Invalid phone number.');
      // Teacher tab: only registered numbers get a code. Everyone else is told straight away.
      // Abuse protection: codes per number and per network, and how often the teacher list can be probed.
      if (!(await allowed(`otp:${phone}`, 5, 600)) || !(await allowed(`otpip:${clientIp(req)}`, 20, 600))) {
        return fail(res, 429, 'OTP_RATE_LIMITED', 'Too many codes requested. Wait 10 minutes and try again.');
      }
      if ((body.portal === 'teacher' || body.portal === 'hod' || body.portal === 'parent') && !(await allowed(`probe:${clientIp(req)}`, 10, 600))) {
        return fail(res, 429, 'RATE_LIMITED', 'Too many attempts. Wait 10 minutes and try again.');
      }
      // Teacher and HOD tabs: only registered numbers get a code. Everyone else is told straight away.
      if (body.portal === 'teacher' || body.portal === 'hod' || body.portal === 'parent') {
        const role = await roleFor(phone);
        if (body.portal === 'parent' && role.base !== 'parent') return fail(res, 403, 'NOT_PARENT', 'This number isn\'t linked to a student yet. Ask your child to add your number in Campus360 (College portal → My class) and their class teacher to confirm it.');
        if (body.portal === 'hod' && role.base !== 'hod') return fail(res, 403, 'NOT_HOD', 'This number isn\'t registered as an HOD.');
        if (body.portal === 'teacher' && (role.base === 'student' || role.base === 'parent')) {
          let anyTeacher = false;
          try { anyTeacher = (await dbmod.q('select 1 from teacher_whitelist where active limit 1')).length > 0; } catch (e) { /* no database */ }
          if (!anyTeacher) return fail(res, 403, 'TEACHERS_NOT_CONFIGURED', 'No teacher numbers are set up yet. The HOD adds them in the HOD portal.');
          return fail(res, 403, 'NOT_TEACHER', 'This number isn\'t registered for the Teacher portal.');
        }
      }
      const r = await minimoth('/v1/otp/send', { body: { phone } });
      if (!r.ok) return upstreamError(res, r);
      return respond(res, 200, { ok: true, phone, otp_id: r.data.otp_id, expires_at: r.data.expires_at });
    }

    // POST /verify { phone, code }
    if (route === 'verify') {
      const phone = normalizePhone(body.phone);
      if (!phone) return fail(res, 422, 'INVALID_PHONE', 'Invalid phone number.');
      const code = String(body.code || '').trim();
      if (!/^\d{6}$/.test(code)) return fail(res, 422, 'INVALID_OTP_CODE', 'The code must be 6 digits.');

      const r = await minimoth('/v1/otp/verify', { body: { phone, code } });
      if (!r.ok) return upstreamError(res, r);

      return respond(
        res,
        200,
        {
          ok: true,
          phone,
          access_token: r.data.access_token,
          expires_at: r.data.expires_at,
          identity_id: r.data.identity_id, // absent for mm_test_ keys: normal
          ...(await roleSummary(phone)),
        },
        [cookie(REFRESH_COOKIE, encodeURIComponent(r.data.refresh_token)), phoneCookie(phone)]
      );
    }

    // POST /session: restore or refresh the session from the cookie
    if (route === 'session') {
      const refreshToken = readCookie(req, REFRESH_COOKIE);
      if (!refreshToken) return fail(res, 401, 'NO_SESSION', 'Not signed in.');

      const r = await minimoth('/v1/session/refresh', { body: { refresh_token: decodeURIComponent(refreshToken) } });
      if (!r.ok) {
        if (r.status === 401) return fail(res, 401, 'SESSION_EXPIRED', 'Session expired.', clearAll());
        return upstreamError(res, r);
      }

      let identityId;
      try {
        const v = await minimoth('/v1/session/validate', { body: { access_token: r.data.access_token } });
        if (v.ok) identityId = v.data.identity_id;
      } catch (_) {}

      const phone = readPhone(req);
      return respond(
        res,
        200,
        { ok: true, phone, access_token: r.data.access_token, expires_at: r.data.expires_at, identity_id: identityId,
          ...(phone ? await roleSummary(phone) : { role: 'student', hod: null, teacher: null, admin: false }) },
        // Both tokens rotate on every refresh: always store the new refresh token
        [cookie(REFRESH_COOKIE, encodeURIComponent(r.data.refresh_token)), ...(phone ? [phoneCookie(phone)] : [])]
      );
    }

    // POST /logout { access_token }
    if (route === 'logout') {
      if (body.access_token) {
        const r = await minimoth('/v1/session/logout', { body: { access_token: body.access_token } });
        // An expired access token can't log out: refresh first, then log out.
        if (!r.ok && r.status === 401) {
          const refreshToken = readCookie(req, REFRESH_COOKIE);
          if (refreshToken) {
            const f = await minimoth('/v1/session/refresh', {
              body: { refresh_token: decodeURIComponent(refreshToken) },
            });
            if (f.ok) await minimoth('/v1/session/logout', { body: { access_token: f.data.access_token } });
          }
        }
      }
      return respond(res, 200, { ok: true }, clearAll());
    }

    return fail(res, 404, 'NOT_FOUND', 'Unknown route.');
  } catch (err) {
    console.error('auth function error:', err);
    return fail(res, 502, 'UPSTREAM_UNREACHABLE', "Couldn't reach the sign-in service.");
  }
};
