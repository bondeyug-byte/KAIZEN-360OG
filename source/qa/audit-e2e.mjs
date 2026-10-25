// Audit 2026-10 end-to-end: attendance single source + division change + CSP, in real browsers against the real
// API handlers (MiniMoth stubbed, PGlite) with the vercel.json headers applied. Synthetic numbers and names only.
import { chromium } from 'playwright' // or the path to your Playwright install
const BASE = process.env.BASE || 'http://localhost:4340/'
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const out = []; const check = (n, ok, i = '') => { out.push({ n, ok }); console.log(ok ? 'PASS' : 'FAIL', n, !ok && i ? '→ ' + String(i).slice(0, 300) : '') }
const wait = (x, ms = 900) => x.p.waitForTimeout(ms)
const csp = []
const E = (n) => (n === '9100000001' ? 'hod.cmpn@ves.ac.in' : `u${n}@ves.ac.in`)
async function person(name, phone, role = 'student', viewport = { width: 1300, height: 900 }) {
  const ctx = await b.newContext({ viewport, timezoneId: 'Asia/Kolkata' }); await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort()); const p = await ctx.newPage()
  const errs = []; p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(name + ': ' + t.slice(0, 200)); else if (m.type() === 'error' && !/^Failed to load resource/.test(t)) errs.push(t) })
  const x = { name, p, errs, ctx }
  await ctx.addInitScript((email) => { window.__e2eGoogle = async () => (await (await fetch('/__test/idtoken', { method: 'POST', body: JSON.stringify({ email }) })).json()).idToken }, E(phone))
  await p.goto(BASE + '#/login?role=' + role); await wait(x, 900)
  await p.getByRole('button', { name: 'Continue with Google' }).click(); await wait(x, 2200)
  return x
}
const api = (x, route, opt = {}) => x.p.evaluate(async ([route, opt]) => { const q = opt.query ? '?' + new URLSearchParams(opt.query) : ''; const r = await fetch('/api/app/' + route + q, { method: opt.method || 'GET', headers: opt.body ? { 'Content-Type': 'application/json' } : {}, body: opt.body ? JSON.stringify(opt.body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) } }, [route, opt])
const main = (x) => x.p.locator('main').innerText()
const go = async (x, hash, ms = 1600) => { await x.p.goto(BASE + '#' + hash); await x.p.reload(); await wait(x, ms) }

// headers
const hres = await fetch(BASE)
check('security headers are sent (CSP, nosniff, frame, referrer, HSTS, permissions)', ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'strict-transport-security', 'permissions-policy'].every((h) => hres.headers.get(h)))

// setup: HOD adds teachers; students sign in, name themselves, join
const hod = await person('HOD', '9100000001', 'hod')
await api(hod, 'teachers', { method: 'POST', body: { email: E('9100000011'), name: 'Prof A', code: 'PA' } }); await api(hod, 'teacher-division', { method: 'POST', body: { email: E('9100000011'), division: 'D2A', subject: 'M1' } })
await api(hod, 'teachers', { method: 'POST', body: { email: E('9100000012'), name: 'Prof B', code: 'PB' } }); await api(hod, 'teacher-division', { method: 'POST', body: { email: E('9100000012'), division: 'D2B', subject: 'M1' } })
const s1 = await person('S1', '9100000101'), s2 = await person('S2', '9100000102')
const ids = {}
for (const [x, nm] of [[s1, 'Asha Test'], [s2, 'Ravi Test']]) {
  await go(x, '/profile?onboard=1', 1800); await x.p.getByLabel('Name', { exact: true }).fill(nm); await x.p.getByRole('button', { name: /Save/ }).first().click(); await wait(x, 1800)
  const r = await api(x, 'join-requests', { method: 'POST', body: { division: 'D2A' } }); await api(hod, 'join-decision', { method: 'POST', body: { ids: [r.body.joinRequest.id], decision: 'approve' } })
  ids[x.name] = (await api(x, 'me')).body.account.id
}

// ---- attendance: teacher records in the UI → persists → student Attendance page, Overview, College portal agree ----
const t1 = await person('Teacher A', '9100000011', 'teacher')
await go(t1, '/?tab=attendance', 2500)
await t1.p.getByRole('button', { name: /Asha Test/ }).click(); await t1.p.getByRole('button', { name: 'Save attendance' }).click(); await wait(t1, 1600)
const yest = new Date(Date.now() - 86400000 + 5.5 * 3600000).toISOString().slice(0, 10)
await t1.p.getByLabel('Date').fill(yest); await wait(t1, 1500); await t1.p.getByRole('button', { name: 'Save attendance' }).click(); await wait(t1, 1500)
const saved = await api(t1, 'attendance', { query: { division: 'D2A', subject: 'M1', date: yest } })
check('teacher attendance persisted on the server', saved.status === 200, JSON.stringify(saved.body).slice(0, 200))

await go(s1, '/attendance', 2200)
let am = await main(s1)
check('student Attendance page reads the server record: 50% (1 present · 1 absent)', /50%/.test(am) && /1 present · 1 absent/.test(am), am.slice(0, 400))
check('Attendance page says where the numbers come from', /teachers’ records on the college server/.test(am))
check('no invented 75% rule when the HOD set none', !/75%/.test(am) && /has not set an attendance requirement/.test(am), am.slice(0, 600))
await go(s1, '/', 2500)
let ov = await main(s1)
check('Overview shows the same attendance (50%, 1 of 2 recorded lectures)', /50%/.test(ov) && /1 of 2 recorded lectures/.test(ov), ov.slice(0, 600))
check('Overview sections in order: timetable, tasks, progress, events, study, notices, quick actions', (() => { const idx = ["Today’s timetable", 'Tasks and assignments', 'Academic progress', 'Upcoming events', 'Study planner', 'Important notices', 'Quick actions'].map((h) => ov.indexOf(h)); return idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])) })(), ov.slice(0, 300))
check('Overview shows no sample records to a real account', !/Sample/.test(ov), ov.match(/.{0,60}Sample.{0,40}/)?.[0])
await go(s1, '/portal?tab=record', 2200)
check('College portal record agrees (50%)', /50%/.test(await main(s1)))
await s1.p.reload(); await wait(s1, 2000); await go(s1, '/attendance', 2000)
check('after refresh the Attendance page still shows 50%', /50%/.test(await main(s1)))
// teacher corrects → student sees the change (focus/refresh)
await api(t1, 'attendance', { method: 'POST', body: { division: 'D2A', subject: 'M1', date: yest, start: '', marks: [{ studentId: ids.S1, present: true }, { studentId: ids.S2, present: true }] } })
const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10)
await api(t1, 'attendance', { method: 'POST', body: { division: 'D2A', subject: 'M1', date: today, start: '', marks: [{ studentId: ids.S1, present: true }, { studentId: ids.S2, present: true }] } })
await go(s1, '/attendance', 2200); am = await main(s1)
check('a correction shows up after refresh (2 of 2 = 100%)', /100%/.test(am) && /2 present · 0 absent/.test(am), am.slice(0, 300))
// HOD sets a branch requirement → used everywhere
const thr = await api(hod, 'attendance-threshold', { method: 'POST', body: { branch: 'CMPN', value: 80 } })
await go(s1, '/attendance', 2200)
check('HOD requirement is used (not a hard-coded 75%)', thr.status === 200 && /requirement your HOD set/.test(await main(s1)), JSON.stringify(thr.body))
// cross-student access
const other = await api(s2, 'my-record', { query: { student: ids.S1, child: ids.S1 } })
check('another student gets only their own record', other.body.student.id === ids.S2)
check('another student cannot open a classmate via the parent route', (await api(s2, 'parent-record', { query: { child: ids.S1 } })).status === 404)
check('a student cannot read the class attendance sheet', (await api(s2, 'attendance', { query: { division: 'D2A', subject: 'M1', date: yest } })).status === 403)
// ---- division change: request in the UI → pending → target teacher approves in the UI → everything follows ----
await go(s1, '/profile', 1800)
check('profile offers “Request a change” for the division', /Wrong division\? Request a change/.test(await main(s1)))
await go(s1, '/portal?tab=class', 2200)
await s1.p.getByRole('button', { name: 'Request a change' }).click(); await wait(s1, 600)
await s1.p.getByRole('button', { name: 'Send request' }).click(); await wait(s1, 500)
check('validation: choosing nothing shows a clear error', /Choose the division you should be in/.test(await main(s1)))
await s1.p.getByLabel('Move to').selectOption('D2B'); await s1.p.getByLabel('Reason').fill('Picked D2A by mistake at sign-up'); await s1.p.getByRole('button', { name: 'Send request' }).click(); await wait(s1, 1800)
let mc = await main(s1)
check('pending state shown; student stays in D2A meanwhile', /Waiting for approval/.test(mc) && /Move from\s+D2A\s+to\s+D2B/.test(mc) && /Your class\s+D2A/i.test(mc), mc.slice(0, 400))
const tA = await api(t1, 'join-decision', { method: 'POST', body: { ids: [(await api(s1, 'me')).body.joinRequest.id], decision: 'approve' } })
check('old-class teacher cannot approve the move', tA.body.results[0].ok === false)
const t2 = await person('Teacher B', '9100000012', 'teacher')
await go(t2, '/?tab=joins', 2200)
const tm = await main(t2)
check('target teacher sees “Change from D2A” and the reason', /Change from D2A/.test(tm) && /Picked D2A by mistake/.test(tm), tm.slice(0, 400))
await t2.p.getByRole('button', { name: 'Accept', exact: true }).click(); await wait(t2, 1500)
await s1.p.reload(); await wait(s1, 2200); await go(s1, '/portal?tab=class', 2000)
mc = await main(s1)
check('after approval the student is in D2B', /Your class\s+D2B/i.test(mc), mc.slice(0, 200))
await go(s1, '/', 2500); ov = await main(s1)
check('Overview follows the confirmed division (D2B)', /· D2B/.test(ov))
await go(s1, '/attendance', 2000)
check('attendance history kept after the move (still 2 lectures)', /2 present · 0 absent/.test(await main(s1)))
// logout / login persistence
await s1.ctx.clearCookies(); const s1b = await person('S1 again', '9100000101')
check('after signing in again the division is still D2B (server is the source of truth)', (await api(s1b, 'me')).body.enrollment.division_code === 'D2B')
await go(s1b, '/classwork', 1800)
check('Classwork for a phone account shows the server feed, not sample assignments', /Announcements and materials your teachers posted for D2B/.test(await main(s1b)) && !/Sample/.test(await main(s1b)))

check('no CSP violations on any page visited', csp.length === 0, csp.join(' | '))
const errs = [hod, s1, s2, t1, t2, s1b].flatMap((x) => x.errs.map((e) => x.name + ': ' + e))
check('no page errors', errs.length === 0, errs.join(' | '))
console.log(`\n${out.filter((x) => x.ok).length}/${out.length} passed`)
await b.close(); process.exit(out.every((x) => x.ok) ? 0 : 1)
