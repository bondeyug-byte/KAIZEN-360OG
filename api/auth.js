// api/auth.js  (Vercel Serverless Function)
// Campus360 sign-in with Google through Firebase Authentication.
//
// Routes (all under /api/auth, rewritten to this file by vercel.json):
//   GET  /api/auth/health    public Firebase web config + which settings are missing (names only, never values)
//   POST /api/auth/google    { idToken, portal }  verify the Firebase ID token, apply the portal rule, email a 6-digit code
//   POST /api/auth/otp       { code }             check the code, apply the portal rule again, start the session
//   POST /api/auth/session   restore the session from the cookie (roles and the domain rule are checked again)
//   POST /api/auth/logout    end the session on this and every other device
//
// Portal rules (checked here at sign-in AND on every API request in api/_access.js):
//   student / teacher / hod : Google account with a verified email that is exactly …@ves.ac.in, plus the role
//                             from the database (a valid college email never grants teacher or HOD by itself)
//   parent                  : any verified Google account, but ONLY once a class teacher or HOD has confirmed it
//                             as the parent of a student (api/_records.js parent links)
//
// Settings (Vercel → Project → Settings → Environment Variables; none of them start with VITE_):
//   FIREBASE_*      optional: the public web config defaults to the college's project "kaizen-360" below
//                   (FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY or FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_APP_ID)
//   SESSION_SECRET  (secret, required: long random text that signs the session cookie; 32+ characters recommended)
//   HOD_EMAILS      (hod@ves.ac.in=CMPN;… the only way to become HOD; @ves.ac.in entries in HOD_PHONES also count)
//   GMAIL_USER, GMAIL_APP_PASSWORD  (secret: sends the 6-digit sign-in code; EMAIL_OTP=off switches the code step off)

const { verifyIdToken } = require('./_firebase');
const { sessionCookie, clearCookies, getSession, readCookie } = require('./_session');
const { normalizeEmail, isInstitutional, INSTITUTION_DOMAIN, maskIdentity } = require('./_roles');
const { signInRole } = require('./_access');
const dbmod = require('./_db');

const PORTALS = ['student', 'teacher', 'hod', 'parent'];
const crypto = require('crypto');

/* ---------- emailed 6-digit code (second step after Google) ---------- */
// Sent from the college Gmail account in GMAIL_USER with a Google "app password" in GMAIL_APP_PASSWORD.
// The code itself is never stored: a short-lived cookie holds an HMAC of (email, portal, expiry, code).
const OTP_TTL = 10 * 60;
const PENDING = 'c360_pending';
const otpRequired = () => String(process.env.EMAIL_OTP || '').toLowerCase() !== 'off';
const mailConfigured = () => !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
const otpMac = (e, p, x, code) => crypto.createHmac('sha256', process.env.SESSION_SECRET || '').update(`otp:${e}:${p}:${x}:${code}`).digest('hex');
const pendingCookie = (o) => `${PENDING}=${Buffer.from(JSON.stringify(o)).toString('base64url')}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=${OTP_TTL}`;
const expired = (name) => `${name}=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0`;
function readPending(req) {
  try {
    const raw = readCookie(req, PENDING); if (!raw) return null;
    const o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!o || typeof o.e !== 'string' || !PORTALS.includes(o.p) || !Number.isFinite(o.x) || typeof o.m !== 'string') return null;
    if (o.x < Math.floor(Date.now() / 1000)) return null;
    return o;
  } catch (e) { return null; }
}
let sendMail = async (to, code) => {
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } });
  await t.sendMail({
    from: `Campus360 <${process.env.GMAIL_USER}>`, to,
    subject: `Your Campus360 code: ${code}`,
    text: `Your Campus360 sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't try to sign in, ignore this email.`,
  });
};
// The college's Firebase project "kaizen-360" (web config: public by design; access is controlled by Firebase's
// authorised domains and by this server's checks). Each value can be overridden in the hosting settings.
const FIREBASE_DEFAULTS = {
  projectId: 'kaizen-360',
  authDomain: 'kaizen-360.firebaseapp.com',
  apiKey: 'AIzaSyB21D4LTMbu3F-X-GyZ_FsQt4VTNCLE2ds',
  appId: '1:921924970190:web:6d5e8f55ffce97ccc3529f',
};
function firebaseConfig(env = process.env) {
  const pick = (...v) => v.map((x) => String(x || '').trim()).find(Boolean) || '';
  return {
    apiKey: pick(env.FIREBASE_WEB_API_KEY, env.FIREBASE_API_KEY, FIREBASE_DEFAULTS.apiKey),
    authDomain: pick(env.FIREBASE_AUTH_DOMAIN, FIREBASE_DEFAULTS.authDomain),
    projectId: pick(env.FIREBASE_PROJECT_ID, FIREBASE_DEFAULTS.projectId),
    appId: pick(env.FIREBASE_APP_ID, FIREBASE_DEFAULTS.appId),
  };
}

function respond(res, status, body, cookies) {
  res.setHeader('Cache-Control', 'no-store');
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  return res.status(status).json(body);
}
const fail = (res, status, code, message, cookies) => respond(res, status, { ok: false, code, error: message }, cookies);

function missingSettings(env = process.env) {
  const miss = [];
  const c = firebaseConfig(env);
  if (!c.projectId) miss.push('FIREBASE_PROJECT_ID');
  if (!c.apiKey) miss.push('FIREBASE_WEB_API_KEY');
  if (!c.authDomain) miss.push('FIREBASE_AUTH_DOMAIN');
  if (!c.appId) miss.push('FIREBASE_APP_ID');
  if (!String(env.SESSION_SECRET || '')) miss.push('SESSION_SECRET');
  if (String(env.EMAIL_OTP || '').toLowerCase() !== 'off') { if (!env.GMAIL_USER) miss.push('GMAIL_USER'); if (!env.GMAIL_APP_PASSWORD) miss.push('GMAIL_APP_PASSWORD'); }
  if (!env.DATABASE_URL) miss.push('DATABASE_URL');
  return miss;
}
async function allowed(key, max, sec) {
  try { await dbmod.ensureSchema(); return await dbmod.allow(key, max, sec); }
  catch (e) { return true; }
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
const summary = (email, role, name) => ({ ok: true, email, name: name || '', role: role.base, hod: role.hod || null, teacher: role.teacher || null, parent: role.parent || null, admin: false });

const NEED_COLLEGE = `Use your college Google account (…@${INSTITUTION_DOMAIN}). Personal Gmail and other addresses can’t open the Student, Teacher or HOD portals.`;

/** Applies the portal rule. Returns null when allowed, or [status, code, message]. */
function portalDecision(portal, email, role) {
  if (portal === 'parent') {
    if (role.base === 'parent') return null;
    if (role.base === 'student' && isInstitutional(email)) return [403, 'NOT_PARENT', 'This Google account belongs to a student. Parents sign in with their own Google account after the class teacher confirms them.'];
    return [403, 'NOT_PARENT', 'This Google account isn’t linked to a student yet. Ask your child to add this email in Campus360 (College portal → My class) and their class teacher to confirm it.'];
  }
  if (!isInstitutional(email)) return [403, 'NOT_INSTITUTIONAL', NEED_COLLEGE];
  if (portal === 'hod' && role.base !== 'hod') return [403, 'NOT_HOD', 'This college account isn’t registered as an HOD.'];
  if (portal === 'teacher' && role.base !== 'teacher' && role.base !== 'hod') return [403, 'NOT_TEACHER', 'This college account isn’t registered for the Teacher portal. Your HOD adds teachers in the HOD portal.'];
  if (portal === 'student' && role.base === 'none') return [403, 'NO_ACCESS', NEED_COLLEGE];
  return null;
}

/** Session starts: name from Google only fills an empty account name; it never changes a role. */
async function start(res, email, role, name, extraCookies = []) {
  if (name) { try { await dbmod.q(`update accounts set name = $2 where phone = $1 and (name is null or name = '')`, [email, name]); } catch (e) { /* account is created on first API call */ } }
  return respond(res, 200, summary(email, role, name), [...clearCookies().slice(1), ...extraCookies, sessionCookie(email)]);
}

async function handler(req, res) {
  const route = (req.query && req.query.route) || (req.url || '').split('?')[0].replace(/^.*\/auth\/?/, '').replace(/\/+$/, '');
  const method = req.method;
  try {
    if (route === 'health' && method === 'GET') {
      const missing = missingSettings();
      const c = firebaseConfig();
      return respond(res, 200, {
        ok: true, configured: missing.length === 0, missing, provider: 'google', emailCode: otpRequired(), institutionDomain: INSTITUTION_DOMAIN,
        firebase: missing.some((m) => m.startsWith('FIREBASE_')) ? null : c,
      });
    }
    if (method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');

    // Block cross-site POSTs (the cookie is also SameSite=Strict)
    const origin = req.headers.origin, host = req.headers['x-forwarded-host'] || req.headers.host;
    if (origin) {
      let originHost = null; try { originHost = new URL(origin).host; } catch (_) {}
      if (!originHost || originHost !== host) return fail(res, 403, 'FORBIDDEN_ORIGIN', 'Sign-in must be used from this site.');
    }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (_) { return fail(res, 400, 'BAD_REQUEST', 'Invalid request.'); } }
    body = body || {};

    if (route === 'logout') {
      const s = getSession(req);
      if (s) { try { await dbmod.q('update accounts set sessions_valid_after = now() where phone = $1', [s.email]); } catch (e) { /* cookie is cleared anyway */ } }
      return respond(res, 200, { ok: true }, clearCookies());
    }

    if (String(process.env.SESSION_SECRET || '').length && String(process.env.SESSION_SECRET).length < 32) console.warn('SESSION_SECRET is shorter than 32 characters; a longer one is recommended.');
    const missing = missingSettings();
    if (missing.length) {
      console.error('Google sign-in settings missing:', missing.join(', ')); // names only
      return fail(res, 503, 'CONFIG_MISSING', 'Google sign-in isn’t set up on the server yet.');
    }

    if (route === 'google') {
      if (!(await allowed(`gsign:${clientIp(req)}`, 30, 600))) return fail(res, 429, 'RATE_LIMITED', 'Too many sign-in attempts. Wait 10 minutes and try again.');
      const portal = PORTALS.includes(body.portal) ? body.portal : 'student';
      let id;
      try { id = await verifyIdToken(body.idToken, firebaseConfig().projectId); }
      catch (e) { return fail(res, 401, e.code || 'INVALID_TOKEN', e.code ? e.message : 'Sign-in failed. Try again.', clearCookies()); }
      const email = normalizeEmail(id.email);
      if (!email) return fail(res, 401, 'NO_EMAIL', 'Your Google account didn’t share a usable email address.', clearCookies());
      const role = await signInRole(email);
      const denied = portalDecision(portal, email, role);
      if (denied) return fail(res, denied[0], denied[1], denied[2], clearCookies());
      // Second step (unless EMAIL_OTP=off): a 6-digit code to the same verified email. No session until it's entered.
      if (otpRequired()) {
        if (!mailConfigured()) { console.error('Email code settings missing: GMAIL_USER / GMAIL_APP_PASSWORD'); return fail(res, 503, 'CONFIG_MISSING', 'Email verification isn’t set up on the server yet.', clearCookies()); }
        if (!(await allowed(`otpsend:${email}`, 5, 600))) return fail(res, 429, 'OTP_RATE_LIMITED', 'Too many codes sent to this email. Wait 10 minutes and try again.', clearCookies());
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const exp = Math.floor(Date.now() / 1000) + OTP_TTL;
        try { await sendMail(email, code); }
        catch (e) { console.error('Could not send the email code:', e && (e.code || e.name)); return fail(res, 502, 'EMAIL_FAILED', 'We couldn’t send the code. Try again in a moment.', clearCookies()); }
        return respond(res, 200, { ok: true, otpRequired: true, email: maskIdentity(email), portal, expiresIn: OTP_TTL }, [...clearCookies(), pendingCookie({ e: email, p: portal, n: id.name || '', x: exp, m: otpMac(email, portal, exp, code) })]);
      }
      return start(res, email, role, id.name);
    }

    // POST /otp { code }: the emailed code. The portal rule and role are checked again before the session starts.
    if (route === 'otp') {
      const code = String(body.code || '').trim();
      if (!/^\d{6}$/.test(code)) return fail(res, 422, 'INVALID_OTP_CODE', 'The code is 6 digits.');
      const p = readPending(req);
      if (!p) return fail(res, 401, 'OTP_NOT_FOUND', 'That code has expired. Continue with Google again to get a new one.', [expired(PENDING)]);
      if (!(await allowed(`otpcheck:${p.e}`, 6, 600))) return fail(res, 429, 'VERIFY_RATE_LIMITED', 'Too many wrong attempts. Continue with Google again in 10 minutes.', [expired(PENDING)]);
      const given = Buffer.from(otpMac(p.e, p.p, p.x, code)), want = Buffer.from(String(p.m));
      if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return fail(res, 401, 'INVALID_OTP', 'That code isn’t right. Check the email and try again.');
      const role = await signInRole(p.e);
      const denied = portalDecision(p.p, p.e, role);
      if (denied) return fail(res, denied[0], denied[1], denied[2], [...clearCookies(), expired(PENDING)]);
      return start(res, p.e, role, p.n, [expired(PENDING)]);
    }

    if (route === 'session') {
      const s = getSession(req);
      if (!s) return fail(res, 401, 'NO_SESSION', 'Not signed in.', clearCookies().slice(1));
      const role = await signInRole(s.email);
      const [acct] = await dbmod.q('select name, sessions_valid_after from accounts where phone = $1', [s.email]).catch(() => []);
      if (acct && acct.sessions_valid_after && s.iat < Math.floor(new Date(acct.sessions_valid_after).getTime() / 1000)) return fail(res, 401, 'SESSION_ENDED', 'You signed out. Sign in again.', clearCookies());
      if (role.base === 'none') return fail(res, 403, 'NO_ACCESS', isInstitutional(s.email) ? 'This account no longer has access.' : 'This Google account is no longer linked to a student.', clearCookies());
      return respond(res, 200, summary(s.email, role, acct && acct.name));
    }

    return fail(res, 404, 'NOT_FOUND', 'Unknown route.');
  } catch (err) {
    console.error('auth function error:', err && (err.code || err.name)); // no tokens or emails in logs
    return fail(res, 502, 'AUTH_UNAVAILABLE', 'Sign-in is temporarily unavailable. Try again.');
  }
}
module.exports = handler;
module.exports.portalDecision = portalDecision;
module.exports.missingSettings = missingSettings;
module.exports.firebaseConfig = firebaseConfig;
module.exports._setMailer = (f) => { sendMail = f; };
