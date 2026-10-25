// api/auth.js  (Vercel Serverless Function)
// Campus360 sign-in with Google through Firebase Authentication.
//
// Routes (all under /api/auth, rewritten to this file by vercel.json):
//   GET  /api/auth/health    public Firebase web config + which settings are missing (names only, never values)
//   POST /api/auth/google    { idToken, portal }  verify the Firebase ID token, apply the portal rule, start a session
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
//   FIREBASE_PROJECT_ID, FIREBASE_WEB_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_APP_ID  (public web config)
//   SESSION_SECRET  (secret: 32+ random characters, signs the session cookie)
//   HOD_EMAILS      (hod@ves.ac.in=CMPN;… the only way to become HOD)

const { verifyIdToken } = require('./_firebase');
const { sessionCookie, clearCookies, getSession } = require('./_session');
const { normalizeEmail, isInstitutional, INSTITUTION_DOMAIN } = require('./_roles');
const { signInRole } = require('./_access');
const dbmod = require('./_db');

const PORTALS = ['student', 'teacher', 'hod', 'parent'];
const FIREBASE_VARS = ['FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_APP_ID'];

function respond(res, status, body, cookies) {
  res.setHeader('Cache-Control', 'no-store');
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  return res.status(status).json(body);
}
const fail = (res, status, code, message, cookies) => respond(res, status, { ok: false, code, error: message }, cookies);

function missingSettings(env = process.env) {
  const miss = FIREBASE_VARS.filter((k) => !String(env[k] || '').trim());
  if (String(env.SESSION_SECRET || '').length < 32) miss.push('SESSION_SECRET');
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

async function handler(req, res) {
  const route = (req.query && req.query.route) || (req.url || '').split('?')[0].replace(/^.*\/auth\/?/, '').replace(/\/+$/, '');
  const method = req.method;
  try {
    if (route === 'health' && method === 'GET') {
      const missing = missingSettings();
      const env = process.env;
      return respond(res, 200, {
        ok: true, configured: missing.length === 0, missing, provider: 'google', institutionDomain: INSTITUTION_DOMAIN,
        firebase: missing.some((m) => FIREBASE_VARS.includes(m)) ? null
          : { apiKey: env.FIREBASE_WEB_API_KEY, authDomain: env.FIREBASE_AUTH_DOMAIN, projectId: env.FIREBASE_PROJECT_ID, appId: env.FIREBASE_APP_ID },
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

    const missing = missingSettings();
    if (missing.length) {
      console.error('Google sign-in settings missing:', missing.join(', ')); // names only
      return fail(res, 503, 'CONFIG_MISSING', 'Google sign-in isn’t set up on the server yet.');
    }

    if (route === 'google') {
      if (!(await allowed(`gsign:${clientIp(req)}`, 30, 600))) return fail(res, 429, 'RATE_LIMITED', 'Too many sign-in attempts. Wait 10 minutes and try again.');
      const portal = PORTALS.includes(body.portal) ? body.portal : 'student';
      let id;
      try { id = await verifyIdToken(body.idToken, process.env.FIREBASE_PROJECT_ID); }
      catch (e) { return fail(res, 401, e.code || 'INVALID_TOKEN', e.code ? e.message : 'Sign-in failed. Try again.', clearCookies()); }
      const email = normalizeEmail(id.email);
      if (!email) return fail(res, 401, 'NO_EMAIL', 'Your Google account didn’t share a usable email address.', clearCookies());
      const role = await signInRole(email);
      const denied = portalDecision(portal, email, role);
      if (denied) return fail(res, denied[0], denied[1], denied[2], clearCookies());
      // Name from Google only fills an empty account name; it never changes a role.
      if (id.name) { try { await dbmod.q(`update accounts set name = $2 where phone = $1 and (name is null or name = '')`, [email, id.name]); } catch (e) { /* account is created on first API call */ } }
      return respond(res, 200, summary(email, role, id.name), [...clearCookies().slice(1), sessionCookie(email)]);
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
