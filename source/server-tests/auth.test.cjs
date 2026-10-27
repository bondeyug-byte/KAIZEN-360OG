// Google sign-in (Firebase ID tokens) server tests: real api/auth.js + api/app.js + PGlite. The Firebase token
// signature check is real RSA-SHA256; only the Google certificate download is replaced by a locally generated key.
// Synthetic accounts only. Run: npm test (in this folder).
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefgh'; process.env.DATABASE_URL = 'postgres://u:p@h.example/db';
process.env.HOD_EMAILS = 'hod.cmpn@ves.ac.in=CMPN';
const FB = { FIREBASE_PROJECT_ID: 'campus360-test', FIREBASE_WEB_API_KEY: 'test-web-key', FIREBASE_AUTH_DOMAIN: 'campus360-test.firebaseapp.com', FIREBASE_APP_ID: '1:1:web:1' };
Object.assign(process.env, FB, { GMAIL_USER: 'campus360.test@gmail.com', GMAIL_APP_PASSWORD: 'test-app-password' });
const path = require('path'), crypto = require('crypto'), assert = require('assert');
const API = process.env.API_DIR || path.join(__dirname, '../../api');
const { PGlite } = require('@electric-sql/pglite');
const db = require(API + '/_db'); const auth = require(API + '/auth'); const app = require(API + '/app'); const fb = require(API + '/_firebase');
const { sessionCookie } = require(API + '/_session');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
fb._setCertFetcher(async () => ({ k1: publicKey.export({ type: 'spki', format: 'pem' }) }));
const now = () => Math.floor(Date.now() / 1000);
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims = {}, { kid = 'k1', alg = 'RS256', key = privateKey } = {}) {
  const t = now();
  const p = { iss: `https://securetoken.google.com/${FB.FIREBASE_PROJECT_ID}`, aud: FB.FIREBASE_PROJECT_ID, sub: 'uid-' + (claims.email || 'x'), iat: t - 10, exp: t + 3600, auth_time: t - 10, email_verified: true, firebase: { sign_in_provider: 'google.com' }, ...claims };
  const h = b64({ alg, kid, typ: 'JWT' }), b = b64(p);
  return `${h}.${b}.${crypto.createSign('RSA-SHA256').update(`${h}.${b}`).sign(key).toString('base64url')}`;
}
const mkRes = (ok) => ({ h: {}, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, status(c) { this.c = c; return this; }, json(b) { ok({ status: this.c, body: b, headers: this.h }); } });
const authCall = (route, { method = 'POST', body = {}, cookie = '', origin } = {}) => new Promise((ok) => auth({ method, query: { route }, url: '/api/auth/' + route, headers: { cookie, host: 'campus.test', 'x-forwarded-for': '10.0.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), ...(origin ? { origin } : {}) }, body }, mkRes(ok)));
// Emails are captured instead of sent (the real sender is nodemailer over Gmail)
const inbox = []; auth._setMailer(async (to, code) => { inbox.push({ to, code }); })
const pendingOf = (r) => [].concat(r.headers['set-cookie'] || []).find((c) => c.startsWith('c360_pending=') && !c.includes('Max-Age=0'))?.split(';')[0]
const step1 = (email, portal = 'student', claims = {}, opts) => authCall('google', { body: { idToken: token({ email, ...claims }, opts), portal } });
/** Google, then the emailed code: the full sign-in. A refusal at either step is returned as-is. */
async function google(email, portal = 'student', claims = {}, opts) {
  const r = await step1(email, portal, claims, opts)
  if (r.status !== 200 || !r.body.otpRequired) return r
  const mail = inbox.filter((m) => m.to === String(email).toLowerCase()).at(-1)
  return authCall('otp', { body: { code: mail.code }, cookie: pendingOf(r) })
}
const cookieOf = (r) => [].concat(r.headers['set-cookie'] || []).find((c) => c.startsWith('c360_session=') && !c.includes('Max-Age=0'))?.split(';')[0]
const appCall = (cookie, method, route, body, query = {}) => new Promise((ok) => app({ method, query: { ...query, route }, url: '/api/app/' + route, headers: { cookie }, body }, mkRes(ok)));
const C = (email) => sessionCookie(email).split(';')[0];
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '→', e.message); } };

(async () => {
  const pg = new PGlite(); db._setClient((x, p) => pg.query(x, p).then((r) => r.rows)); await db.ensureSchema();

  await t('12. missing settings: health names what is missing (never values) and sign-in refuses clearly', async () => {
    const saved = { ...process.env }; delete process.env.GMAIL_APP_PASSWORD; delete process.env.SESSION_SECRET
    const h = (await authCall('health', { method: 'GET' })).body
    assert.equal(h.configured, false); assert.deepEqual(h.missing.sort(), ['GMAIL_APP_PASSWORD', 'SESSION_SECRET'])
    assert.ok(!JSON.stringify(h).includes('test-session-secret'))
    const r = await google('a@ves.ac.in'); assert.equal(r.status, 503); assert.equal(r.body.code, 'CONFIG_MISSING')
    Object.assign(process.env, saved)
  })
  await t('health returns only the public Firebase web config', async () => {
    const h = (await authCall('health', { method: 'GET' })).body
    assert.equal(h.configured, true); assert.deepEqual(h.firebase, { apiKey: 'test-web-key', authDomain: 'campus360-test.firebaseapp.com', projectId: 'campus360-test', appId: '1:1:web:1' })
    assert.ok(!JSON.stringify(h).includes('test-session-secret'))
  })
  let studentCookie
  await t('1. authorised @ves.ac.in Google account signs in (HttpOnly, Secure, SameSite=Strict cookie)', async () => {
    const r = await google('Asha.Test@VES.AC.IN'); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.email, 'asha.test@ves.ac.in'); assert.equal(r.body.role, 'student')
    const c = [].concat(r.headers['set-cookie']).find((x) => x.startsWith('c360_session=') && !x.includes('Max-Age=0'))
    assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Strict/); assert.match(c, /Path=\/api/)
    studentCookie = cookieOf(r)
    assert.equal((await appCall(studentCookie, 'GET', 'me')).status, 200)
  })
  await t('2–4. personal Gmail, external domain, look-alike and sub-domain accounts are refused on Student/Teacher/HOD', async () => {
    for (const e of ['student@gmail.com', 'student@otherdomain.com', 'user@ves.ac.in.example.com', 'user@mail.ves.ac.in', 'user@vesacin.in', 'user@ves-ac.in'])
      for (const portal of ['student', 'teacher', 'hod']) {
        const r = await google(e, portal); assert.equal(r.status, 403, `${e} ${portal}`); assert.equal(cookieOf(r), undefined)
        if (portal === 'student') assert.equal(r.body.code, 'NOT_INSTITUTIONAL')
      }
  })
  await t('5. missing or unverified email, non-Google provider, wrong project, expired and forged tokens are refused', async () => {
    const codes = async (claims, opts) => (await authCall('google', { body: { idToken: token(claims, opts), portal: 'student' } })).body.code
    assert.equal(await codes({ email: 'a@ves.ac.in', email_verified: false }), 'EMAIL_NOT_VERIFIED')
    assert.equal(await codes({ email: undefined }), 'NO_EMAIL')
    assert.equal(await codes({ email: 'a@ves.ac.in', firebase: { sign_in_provider: 'password' } }), 'NOT_GOOGLE')
    assert.equal(await codes({ email: 'a@ves.ac.in', aud: 'someone-else' }), 'WRONG_PROJECT')
    assert.equal(await codes({ email: 'a@ves.ac.in', iss: 'https://securetoken.google.com/someone-else' }), 'WRONG_PROJECT')
    assert.equal(await codes({ email: 'a@ves.ac.in', exp: now() - 5 }), 'TOKEN_EXPIRED')
    assert.equal(await codes({ email: 'a@ves.ac.in' }, { key: other.privateKey }), 'INVALID_TOKEN')
    assert.equal(await codes({ email: 'a@ves.ac.in' }, { kid: 'unknown' }), 'INVALID_TOKEN')
    assert.equal(await codes({ email: 'a@ves.ac.in' }, { alg: 'HS256' }), 'INVALID_TOKEN')
    assert.equal((await authCall('google', { body: { idToken: 'not.a.token', portal: 'student' } })).body.code, 'INVALID_TOKEN')
    assert.equal((await authCall('google', { body: { portal: 'student' } })).body.code, 'INVALID_TOKEN')
  })
  await t('6. a college account without a role cannot use the Teacher or HOD portal', async () => {
    assert.equal((await google('plain@ves.ac.in', 'teacher')).body.code, 'NOT_TEACHER')
    assert.equal((await google('plain@ves.ac.in', 'hod')).body.code, 'NOT_HOD')
  })
  let hodCookie, teacherCookie
  await t('HOD from HOD_EMAILS signs in on the HOD tab; adds a teacher who can then use the Teacher tab', async () => {
    const h = await google('hod.cmpn@ves.ac.in', 'hod'); assert.equal(h.status, 200, JSON.stringify(h.body)); assert.equal(h.body.role, 'hod'); hodCookie = cookieOf(h)
    assert.equal((await appCall(hodCookie, 'POST', 'teachers', { email: 'prof.a@ves.ac.in', name: 'Prof A' })).status, 200)
    assert.equal((await appCall(hodCookie, 'POST', 'teacher-division', { email: 'prof.a@ves.ac.in', division: 'D2A', subject: 'Maths' })).status, 200)
    const r = await google('prof.a@ves.ac.in', 'teacher'); assert.equal(r.status, 200); assert.equal(r.body.role, 'teacher'); teacherCookie = cookieOf(r)
    assert.equal((await google('prof.a@ves.ac.in', 'hod')).body.code, 'NOT_HOD')
  })
  await t('7. a student cannot reach teacher or HOD operations by calling them directly', async () => {
    for (const [m, route, body] of [['GET', 'teachers'], ['POST', 'teachers', { email: 'x@ves.ac.in', name: 'X Y' }], ['GET', 'hod-summary'], ['GET', 'audit'], ['POST', 'attendance', { division: 'D2A', subject: 'Maths', date: '2026-10-20', marks: [] }]])
      assert.equal((await appCall(studentCookie, m, route, body)).status, 403, route)
  })
  await t('8. a teacher cannot use HOD operations', async () => {
    for (const [m, route, body] of [['GET', 'teachers'], ['POST', 'teachers', { email: 'y@ves.ac.in', name: 'Y Z' }], ['POST', 'teacher-status', { email: 'prof.a@ves.ac.in', active: false }], ['GET', 'audit'], ['POST', 'attendance-threshold', { branch: 'CMPN', value: 75 }]])
      assert.equal((await appCall(teacherCookie, m, route, body)).status, 403, route)
  })
  await t('parent portal: any Google account, but only after the class teacher confirms the link', async () => {
    assert.equal((await google('mom.test@gmail.com', 'parent')).body.code, 'NOT_PARENT')
    await appCall(studentCookie, 'PUT', 'me', { profile: { name: 'Asha Test' }, data: {}, baseVersion: 0 })
    const jr = await appCall(studentCookie, 'POST', 'join-requests', { division: 'D2A' }); await appCall(hodCookie, 'POST', 'join-decision', { ids: [jr.body.joinRequest.id], decision: 'approve' })
    const l = await appCall(studentCookie, 'POST', 'parent-links', { email: 'Mom.Test@Gmail.com', relation: 'Mother' }); assert.equal(l.status, 200, JSON.stringify(l.body)); assert.equal(l.body.link.contact, 'mo•••@gmail.com')
    assert.equal((await google('mom.test@gmail.com', 'parent')).body.code, 'NOT_PARENT') // pending is not enough
    const tl = (await appCall(teacherCookie, 'GET', 'parent-links', null, { division: 'D2A' })).body.links
    assert.ok(tl.every((x) => x.contact && !x.contact.includes('mom.test'))); // teachers see a masked email
    await appCall(teacherCookie, 'POST', 'parent-link-decision', { ids: [l.body.link.id], decision: 'approve' })
    const p = await google('mom.test@gmail.com', 'parent'); assert.equal(p.status, 200); assert.equal(p.body.role, 'parent')
    const pc = cookieOf(p), kids = (await appCall(pc, 'GET', 'parent-children')).body.children; assert.equal(kids.length, 1)
    assert.equal((await appCall(pc, 'GET', 'parent-record', null, { child: kids[0].id })).status, 200)
    assert.equal((await appCall(pc, 'GET', 'parent-record', null, { child: '00000000-0000-4000-8000-000000000000' })).status, 404)
    assert.equal((await appCall(pc, 'POST', 'attendance', { division: 'D2A', subject: 'Maths', date: '2026-10-20', marks: [] })).status, 403) // read-only
    assert.equal((await google('mom.test@gmail.com', 'student')).body.code, 'NOT_INSTITUTIONAL') // a parent Gmail can't open the student portal
    assert.equal((await google('asha.test@ves.ac.in', 'parent')).body.code, 'NOT_PARENT') // a student can't use the parent portal
  })
  await t('parent changes Google account: the old one loses access when the link is revoked; the new one needs a fresh confirmation', async () => {
    const links = (await appCall(studentCookie, 'GET', 'parent-links')).body.links
    await appCall(studentCookie, 'DELETE', 'parent-links', null, { id: links[0].id })
    assert.equal((await appCall(C('mom.test@gmail.com'), 'GET', 'parent-children')).body.code, 'NO_ACCESS')
    const n = await appCall(studentCookie, 'POST', 'parent-links', { email: 'mom.new@outlook.com', relation: 'Mother' }); assert.equal(n.body.link.status, 'pending')
    assert.equal((await google('mom.new@outlook.com', 'parent')).body.code, 'NOT_PARENT')
  })
  await t('9. a valid session survives a reload (session restore re-checks role and domain)', async () => {
    const s = await authCall('session', { cookie: studentCookie }); assert.equal(s.status, 200); assert.equal(s.body.role, 'student'); assert.equal(s.body.email, 'asha.test@ves.ac.in')
    assert.equal((await authCall('session', { cookie: C('random@gmail.com') })).body.code, 'NO_ACCESS')
    assert.equal((await authCall('session', {})).body.code, 'NO_SESSION')
  })
  await t('10. sign-out ends the session everywhere (an old cookie copy is refused too)', async () => {
    const copy = studentCookie; await new Promise((r) => setTimeout(r, 1100)) // sessions are compared at one-second resolution
    assert.equal((await authCall('logout', { cookie: studentCookie })).status, 200)
    assert.equal((await authCall('session', { cookie: copy })).body.code, 'SESSION_ENDED')
    const r = await appCall(copy, 'GET', 'me'); assert.equal(r.status, 401); assert.equal(r.body.code, 'SESSION_ENDED')
    const again = await google('asha.test@ves.ac.in'); assert.equal(again.status, 200); assert.equal((await appCall(cookieOf(again), 'GET', 'me')).status, 200) // signing in again works
  })
  await t('role changes apply on the next request (HOD deactivates the teacher)', async () => {
    await appCall(hodCookie, 'POST', 'teacher-status', { email: 'prof.a@ves.ac.in', active: false })
    assert.equal((await appCall(teacherCookie, 'GET', 'attendance', null, { division: 'D2A', subject: 'Maths', date: '2026-10-20' })).status, 403)
    assert.equal((await google('prof.a@ves.ac.in', 'teacher')).body.code, 'NOT_TEACHER')
  })
  await t('cross-site sign-in POST is refused; tampered cookies are refused', async () => {
    assert.equal((await authCall('google', { body: { idToken: token({ email: 'a@ves.ac.in' }), portal: 'student' }, origin: 'https://evil.example' })).body.code, 'FORBIDDEN_ORIGIN')
    assert.equal((await appCall('c360_session=eyJlIjoiaG9kLmNtcG5AdmVzLmFjLmluIn0.forged', 'GET', 'me')).status, 401)
    assert.equal((await appCall('mm_phone=%2B919100000001.' + 'f'.repeat(32), 'GET', 'me')).status, 401) // old phone cookie never accepted
  })
  await t('emailed code: no session after Google alone; the code goes to the same verified email', async () => {
    const before = inbox.length
    const r = await step1('code.check@ves.ac.in')
    assert.equal(r.status, 200); assert.equal(r.body.otpRequired, true); assert.equal(r.body.email, 'co•••@ves.ac.in')
    assert.equal(cookieOf(r), undefined) // no session cookie yet
    assert.equal(inbox.length, before + 1); assert.equal(inbox.at(-1).to, 'code.check@ves.ac.in'); assert.match(inbox.at(-1).code, /^\d{6}$/)
    const pc = pendingOf(r); assert.match([].concat(r.headers['set-cookie']).find((c) => c.startsWith('c360_pending=')), /HttpOnly; Secure; SameSite=Strict; Path=\/api\/auth; Max-Age=600/)
    assert.ok(!Buffer.from(pc.split('=')[1], 'base64url').toString().includes(inbox.at(-1).code)) // the code itself isn't in the cookie
  })
  await t('emailed code: wrong, malformed, missing or expired codes are refused; too many wrong tries are blocked', async () => {
    const r = await step1('code.wrong@ves.ac.in'); const pc = pendingOf(r), right = inbox.at(-1).code
    const bad = right === '000000' ? '111111' : '000000'
    assert.equal((await authCall('otp', { body: { code: bad }, cookie: pc })).body.code, 'INVALID_OTP')
    assert.equal((await authCall('otp', { body: { code: '12ab' }, cookie: pc })).body.code, 'INVALID_OTP_CODE')
    assert.equal((await authCall('otp', { body: { code: right } })).body.code, 'OTP_NOT_FOUND') // no pending cookie
    const raw = JSON.parse(Buffer.from(pc.split('=')[1], 'base64url')); raw.x = now() - 1
    assert.equal((await authCall('otp', { body: { code: right }, cookie: 'c360_pending=' + Buffer.from(JSON.stringify(raw)).toString('base64url') })).body.code, 'OTP_NOT_FOUND')
    for (let i = 0; i < 5; i++) await authCall('otp', { body: { code: bad }, cookie: pc })
    assert.equal((await authCall('otp', { body: { code: right }, cookie: pc })).body.code, 'VERIFY_RATE_LIMITED')
  })
  await t('emailed code: the pending cookie can’t be edited to another email or portal', async () => {
    const r = await step1('code.swap@ves.ac.in'); const pc = pendingOf(r), right = inbox.at(-1).code
    const raw = JSON.parse(Buffer.from(pc.split('=')[1], 'base64url'))
    for (const change of [{ e: 'hod.cmpn@ves.ac.in' }, { p: 'hod' }]) {
      const forged = 'c360_pending=' + Buffer.from(JSON.stringify({ ...raw, ...change })).toString('base64url')
      assert.equal((await authCall('otp', { body: { code: right }, cookie: forged })).body.code, 'INVALID_OTP')
    }
    const ok = await authCall('otp', { body: { code: right }, cookie: pc }); assert.equal(ok.status, 200); assert.ok(cookieOf(ok))
  })
  await t('emailed code: refused accounts never get a code (Gmail on Student tab, unlinked parent)', async () => {
    const before = inbox.length
    assert.equal((await step1('x@gmail.com')).body.code, 'NOT_INSTITUTIONAL'); assert.equal((await step1('y@gmail.com', 'parent')).body.code, 'NOT_PARENT')
    assert.equal(inbox.length, before)
  })
  await t('emailed code: mail failure gives a clear error and no session', async () => {
    auth._setMailer(async () => { throw Object.assign(new Error('smtp down'), { code: 'EAUTH' }) })
    const r = await step1('mailfail@ves.ac.in'); assert.equal(r.status, 502); assert.equal(r.body.code, 'EMAIL_FAILED'); assert.equal(cookieOf(r), undefined)
    auth._setMailer(async (to, code) => { inbox.push({ to, code }) })
  })
  await t('EMAIL_OTP=off: Google alone starts the session (switch kept for local testing)', async () => {
    process.env.EMAIL_OTP = 'off'; const r = await step1('nocode@ves.ac.in'); delete process.env.EMAIL_OTP
    assert.equal(r.status, 200); assert.ok(cookieOf(r))
  })
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
