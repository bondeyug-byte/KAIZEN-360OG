// Google sign-in end-to-end in real browsers against the real API handlers (PGlite; Firebase ID tokens signed by a
// local test key, verified by the real server code). The "Google" step is the only simulated part: the button calls
// window.__e2eGoogle (compiled into --mode e2e builds only) instead of opening Google's popup.
import { chromium } from 'playwright' // or the path to your Playwright install
const BASE = process.env.BASE || 'http://localhost:4340/'
const BAD = process.env.BAD_BASE // a server started with a broken Firebase setting (test 12)
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const out = []; const check = (n, ok, i = '') => { out.push({ n, ok }); console.log(ok ? 'PASS' : 'FAIL', n, !ok && i ? '→ ' + String(i).slice(0, 300) : '') }
const wait = (x, ms = 900) => x.p.waitForTimeout(ms)
const csp = [], people = []
async function browser(name, viewport = { width: 1300, height: 900 }, base = BASE) {
  const ctx = await b.newContext({ viewport, timezoneId: 'Asia/Kolkata' }); await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort())
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(name + ': ' + t.slice(0, 200)); else if (m.type() === 'error' && !/^Failed to load resource/.test(t)) errs.push(t) })
  const x = { name, p, ctx, errs, base }; people.push(x); return x
}
// "Google" hands back whatever account this browser is set to (like picking an account in Google's chooser)
async function google(x, portal, email, claims = {}) {
  await x.ctx.addInitScript(([email, claims]) => { window.__e2eGoogle = async () => (await (await fetch('/__test/idtoken', { method: 'POST', body: JSON.stringify({ email, ...claims }) })).json()).idToken }, [email, claims])
  await x.p.goto(x.base + '#/login?role=' + portal); await x.p.reload(); await wait(x, 900)
  await x.p.getByRole('button', { name: 'Continue with Google' }).click(); await wait(x, 2200)
  // step 2: the emailed 6-digit code (captured by the test server)
  if (await x.p.getByLabel('6-digit code').count()) {
    const c = await x.p.evaluate(async (email) => (await (await fetch('/__test/lastcode', { method: 'POST', body: JSON.stringify({ email }) })).json()).code, email)
    await x.p.getByLabel('6-digit code').fill(c || ''); await x.p.getByRole('button', { name: 'Verify and sign in' }).click(); await wait(x, 2200)
  }
  return { url: x.p.url(), alert: await x.p.locator('[role=alert]').first().innerText().catch(() => '') }
}
const person = async (name, portal, email, claims) => { const x = await browser(name); x.res = await google(x, portal, email, claims); return x }
const api = (x, route, opt = {}) => x.p.evaluate(async ([route, opt]) => { const q = opt.query ? '?' + new URLSearchParams(opt.query) : ''; const r = await fetch('/api/app/' + route + q, { method: opt.method || 'GET', headers: opt.body ? { 'Content-Type': 'application/json' } : {}, body: opt.body ? JSON.stringify(opt.body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) } }, [route, opt])
const main = (x) => x.p.locator('main').innerText().catch(() => '')
// First sign-in now goes to "Set up your profile" (migration 7); these helpers complete it like the form does.
// The page is reloaded afterwards so it reads the saved profile (the form does this itself via refreshAccount).
const setupStudent = async (x, name, roll) => { const r = await api(x, 'setup', { method: 'PUT', body: { name, gender: 'prefer_not_to_say', mobile: '9876543210', yearLevel: 1, branch: 'CMPN', roll } }); await x.p.reload(); await x.p.waitForTimeout(1500); return r }
const setupStaff = async (x, name) => { const r = await api(x, 'setup', { method: 'PUT', body: { name, mobile: '9876500000', confirm: true } }); await x.p.reload(); await x.p.waitForTimeout(1500); return r }
const go = async (x, hash, ms = 1600) => { await x.p.goto(x.base + '#' + hash); await x.p.reload(); await wait(x, ms) }

// headers needed for Google's popup
const hr = await fetch(BASE)
check('COOP allows the Google popup to report back; CSP allows Firebase endpoints', hr.headers.get('cross-origin-opener-policy') === 'same-origin-allow-popups' && /identitytoolkit\.googleapis\.com/.test(hr.headers.get('content-security-policy')) && /apis\.google\.com/.test(hr.headers.get('content-security-policy')))

// 1 · authorised college account
const s1 = await person('S1', 'student', 'asha.test@ves.ac.in')
check('1. authorised @ves.ac.in account signs in (lands in “Set up your profile”, then the portal)', /#\/setup/.test(s1.res.url) && !s1.res.alert, `${s1.res.url} ${s1.res.alert}`)
check('login page shows no demo sign-in on this build', !/Demo sign-in/.test(await (async () => { const y = await browser('look'); await y.p.goto(BASE + '#/login?role=student'); await wait(y, 800); return y.p.locator('body').innerText() })()))
// emailed code step, seen in the browser
{ const y = await browser('code-step')
  await y.ctx.addInitScript(() => { window.__e2eGoogle = async () => (await (await fetch('/__test/idtoken', { method: 'POST', body: JSON.stringify({ email: 'code.ui@ves.ac.in' }) })).json()).idToken })
  await y.p.goto(BASE + '#/login?role=student'); await wait(y, 900); await y.p.getByRole('button', { name: 'Continue with Google' }).click(); await wait(y, 1800)
  const t1 = await y.p.locator('body').innerText()
  const noSession = (await api(y, 'me')).status === 401
  await y.p.getByLabel('6-digit code').fill('000000'); await y.p.getByRole('button', { name: 'Verify and sign in' }).click(); await wait(y, 1200)
  const t2 = await y.p.locator('body').innerText()
  const c = await y.p.evaluate(async () => (await (await fetch('/__test/lastcode', { method: 'POST', body: JSON.stringify({ email: 'code.ui@ves.ac.in' }) })).json()).code)
  const wrongShown = c === '000000' || /That code isn’t right/.test(t2)
  await y.p.getByLabel('6-digit code').fill(c); await y.p.getByRole('button', { name: 'Verify and sign in' }).click(); await wait(y, 2200)
  check('emailed code: after Google the page asks for the code sent to the masked email; no session until it is entered', /We emailed a 6-digit code to co•••@ves\.ac\.in/.test(t1) && noSession, t1.slice(0, 300))
  check('emailed code: a wrong code is refused with a clear message; the right one signs in', wrongShown && (await api(y, 'me')).status === 200 && !/#\/login/.test(y.p.url()), t2.slice(0, 300) + ' ' + y.p.url())
}
// 2–5 · refused accounts never get a session
for (const [n, email, claims, re] of [
  ['2. personal Gmail is refused on the Student portal', 'someone@gmail.com', {}, /college Google account/],
  ['3. external domain is refused', 'someone@otherdomain.com', {}, /college Google account/],
  ['4. look-alike user@ves.ac.in.example.com is refused', 'user@ves.ac.in.example.com', {}, /college Google account/],
  ['4b. sub-domain user@mail.ves.ac.in is refused', 'user@mail.ves.ac.in', {}, /college Google account/],
  ['5. unverified Google email is refused', 'asha2@ves.ac.in', { verified: false }, /isn’t verified/],
  ['5b. missing email is refused', '', {}, /email/i],
]) {
  const x = await person(n, 'student', email, claims)
  const me = await api(x, 'me')
  check(n, re.test(x.res.alert) && /#\/login/.test(x.res.url) && me.status === 401, `${x.res.alert} | ${x.res.url} | ${me.status}`)
}
const tp = await person('plain-teacher', 'teacher', 'plain@ves.ac.in'), hp = await person('plain-hod', 'hod', 'plain@ves.ac.in')
check('6. a college account without a role is refused on the Teacher and HOD portals', /isn’t registered for the Teacher portal/.test(tp.res.alert) && /isn’t registered as an HOD/.test(hp.res.alert) && (await api(tp, 'me')).status === 401, `${tp.res.alert} | ${hp.res.alert}`)

// set up roles through the real UI/API: HOD (from HOD_EMAILS) adds a teacher; students join
const hod = await person('HOD', 'hod', 'hod.cmpn@ves.ac.in')
const hodSetupPage = await main(hod), hodSetup = await setupStaff(hod, 'HOD CMPN')
check('HOD from the server setting signs in on the HOD tab (set-up first, then the HOD portal)', /#\/(setup|hod)/.test(hod.res.url) && !hod.res.alert && /HOD of CMPN/.test(hodSetupPage) && hodSetup.status === 200, hod.res.url + ' ' + hod.res.alert + ' ' + hodSetupPage.slice(0, 200))
await go(hod, '/hod?tab=teachers', 1800)
await hod.p.getByLabel('College Google account').fill('Prof.A@ves.ac.in'); await hod.p.getByLabel('Teacher name').fill('Prof A'); await hod.p.getByRole('button', { name: 'Save teacher' }).click(); await wait(hod, 1500)
const tlist = await api(hod, 'teachers')
check('HOD adds a teacher by college Google account in the HOD portal', tlist.body.teachers?.some((t) => t.email === 'prof.a@ves.ac.in'), JSON.stringify(tlist.body).slice(0, 200))
await api(hod, 'teacher-division', { method: 'POST', body: { email: 'prof.a@ves.ac.in', division: 'D2A', subject: 'M1' } })
const gm = await person('gmail-teacher', 'hod', 'x@gmail.com')
check('HOD tab refuses a Gmail account', /college Google account/.test(gm.res.alert))
const t1 = await person('Teacher', 'teacher', 'prof.a@ves.ac.in')
await setupStaff(t1, 'Prof A'); await go(t1, '/', 2000)
check('the added teacher signs in on the Teacher tab and lands in the Teacher portal', /Teacher portal/.test(await main(t1)) && !t1.res.alert, t1.res.alert + ' ' + (await main(t1)).slice(0, 100))
await setupStudent(s1, 'Asha Test', '24-01')
const jr = await api(s1, 'join-requests', { method: 'POST', body: { division: 'D2A' } }); await api(t1, 'join-decision', { method: 'POST', body: { ids: [jr.body.joinRequest.id], decision: 'approve' } })
const s2 = await person('S2', 'student', 'ravi.test@ves.ac.in')
await setupStudent(s2, 'Ravi Test', '24-02')
const jr2 = await api(s2, 'join-requests', { method: 'POST', body: { division: 'D2A' } }); await api(t1, 'join-decision', { method: 'POST', body: { ids: [jr2.body.joinRequest.id], decision: 'approve' } })

// 7–8 · route and API boundaries
await go(s1, '/hod', 1500); const sh = await main(s1); await go(s1, '/teacher', 1500); const st = await main(s1)
check('7. a student opening #/hod or #/teacher sees "not part of your portal", and the APIs refuse', /Not part of the Student portal/.test(sh) && /Not part of the Student portal/.test(st) && (await api(s1, 'teachers')).status === 403 && (await api(s1, 'hod-summary')).status === 403, sh.slice(0, 120))
await go(t1, '/hod', 1500)
check('8. a teacher cannot use HOD screens or operations', /Not part of the Teacher portal/.test(await main(t1)) && (await api(t1, 'teachers')).status === 403 && (await api(t1, 'teacher-status', { method: 'POST', body: { email: 'prof.a@ves.ac.in', active: false } })).status === 403 && (await api(t1, 'audit')).status === 403)

// 14 · existing features still work: teacher records attendance → the student sees it
await go(t1, '/?tab=attendance', 2500)
await t1.p.getByRole('button', { name: /Asha Test/ }).click(); await t1.p.getByRole('button', { name: 'Save attendance' }).click(); await wait(t1, 1600)
await go(s1, '/attendance', 2200)
const am = await main(s1)
check('14. existing features intact: teacher attendance → student Attendance page (0% · 1 absent)', /0%/.test(am) && /0 present · 1 absent/.test(am), am.slice(0, 300))
await go(s1, '/', 2500)
check('14b. Overview and timetable render for the Google account', /Today’s timetable/.test(await main(s1)) && /Attendance and marks/.test(await main(s1)))

// 9 · refresh keeps the session; the session restore re-checks the server
await s1.p.reload(); await wait(s1, 2500)
check('9. a valid session survives a refresh', /Overview/.test(await main(s1)) && !/#\/login/.test(s1.p.url()), s1.p.url())

// 15 · parent: any Google account, after the class teacher confirms; CR/HOD workflows unchanged
await go(s1, '/portal?tab=class', 2200)
await s1.p.getByLabel("Parent's Google account email").fill('Mom.Test@gmail.com'); await s1.p.getByLabel('Relation').selectOption('Mother'); await s1.p.getByRole('button', { name: 'Add', exact: true }).click(); await wait(s1, 1500)
check('student adds a parent by Google account email (shown masked, waiting)', /mo•••@gmail\.com/.test(await main(s1)) && /Waiting for teacher/.test(await main(s1)), (await main(s1)).slice(0, 400))
const early = await person('Parent early', 'parent', 'mom.test@gmail.com')
check('parent cannot sign in before the teacher confirms', /isn’t linked to a student yet/.test(early.res.alert), early.res.alert)
await go(t1, '/?tab=parents', 2200)
const tm = await main(t1)
check('teacher sees the student and a masked parent email, never the full address', /Asha Test/.test(tm) && /mo•••@gmail\.com/.test(tm) && !/mom\.test@gmail\.com/i.test(tm), tm.slice(0, 300))
await t1.p.getByRole('button', { name: 'Confirm', exact: true }).click(); await wait(t1, 1500)
const par = await person('Parent', 'parent', 'mom.test@gmail.com')
const pm = await main(par)
check('15. confirmed parent (personal Gmail) signs in on the Parent tab and sees only their child', /#\/parent/.test(par.res.url) && /Parent portal/.test(pm) && /Asha Test/.test(pm) && !/Ravi Test/.test(pm), par.res.url + ' ' + par.res.alert)
const kids = (await api(par, 'parent-children')).body.children
check('parent can’t open another student by id, and can’t write records', (await api(par, 'parent-record', { query: { child: '00000000-0000-4000-8000-000000000000' } })).status === 404 && (await api(par, 'attendance', { method: 'POST', body: { division: 'D2A', subject: 'M1', date: '2026-10-20', marks: [{ studentId: kids[0].id, present: true }] } })).status === 403)
const ps = await person('Parent on student tab', 'student', 'mom.test@gmail.com')
check('a parent Gmail can’t open the Student portal', /college Google account/.test(ps.res.alert))
// CR workflow unchanged: S2 asks to be CR, teacher approves, S2 approves nothing it shouldn't
const cr = await api(s2, 'cr-requests', { method: 'POST' }); const crl = (await api(t1, 'cr-requests')).body.requests || []
await api(t1, 'cr-decision', { method: 'POST', body: { id: crl[0]?.id, decision: 'approve' } })
const s2me = (await api(s2, 'me')).body
check('CR request → teacher approves → student is class rep (unchanged workflow)', cr.status === 200 && (s2me.cr || []).includes('D2A'), JSON.stringify(s2me.cr))
const roster = (await api(s2, 'roster', { query: { division: 'D2A' } })).body.students || []
check('a class rep sees names and rolls only, no contact details', roster.length >= 2 && roster.every((r) => r.contact === undefined))

// 10 · sign-out
await go(s2, '/profile', 1500)
await s2.p.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) })
await go(s2, '/attendance', 2200)
const after = await s2.p.locator('body').innerText()
check('10. after sign-out, a protected route shows the sign-in page (no attendance shown) and the APIs refuse', /Sign in · Student portal/.test(after) && /Continue with Google/.test(after) && !/My attendance/.test(after) && (await api(s2, 'me')).status === 401, after.slice(0, 200))

// 12 · broken configuration produces a clear diagnostic
if (BAD) {
  const y = await browser('bad-config', undefined, BAD); await y.p.goto(BAD + '#/login?role=student'); await wait(y, 1200)
  const t = await y.p.locator('main, body').first().innerText()
  check('12. a missing server setting shows a clear message naming the setting (no button)', /being set up/.test(t) && /missing server settings SESSION_SECRET/.test(t) && !(await y.p.getByRole('button', { name: 'Continue with Google' }).count()), t.slice(0, 300))
}
check('no CSP violations', csp.length === 0, csp.join(' | '))
const errs = people.flatMap((x) => x.errs.map((e) => x.name + ': ' + e))
check('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${out.filter((x) => x.ok).length}/${out.length} passed`)
await b.close(); process.exit(out.every((x) => x.ok) ? 0 : 1)
