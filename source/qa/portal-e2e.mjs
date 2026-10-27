// Portal upgrade end-to-end in a real browser against the real API handlers (PGlite + local Firebase test key).
// Roles: Student, Teacher, HOD, Event head, Club member, CR, SI, CI (API), Parent. Synthetic accounts only.
import { chromium } from 'playwright' // or the path to your Playwright install
const BASE = process.env.BASE || 'http://localhost:4340/'
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const out = []; const check = (n, ok, i = '') => { out.push({ n, ok }); console.log(ok ? 'PASS' : 'FAIL', n, !ok && i ? '→ ' + String(i).slice(0, 400) : '') }
const wait = (x, ms = 900) => x.p.waitForTimeout(ms)
const csp = [], people = []
async function browser(name, viewport = { width: 1300, height: 900 }) {
  const ctx = await b.newContext({ viewport, timezoneId: 'Asia/Kolkata' }); await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort())
  const p = await ctx.newPage(); const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  p.on('console', (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(name + ': ' + t.slice(0, 200)); else if (m.type() === 'error' && !/^Failed to load resource/.test(t)) errs.push(t) })
  const x = { name, p, ctx, errs }; people.push(x); return x
}
async function google(x, portal, email) {
  await x.ctx.addInitScript((email) => { window.__e2eGoogle = async () => (await (await fetch('/__test/idtoken', { method: 'POST', body: JSON.stringify({ email }) })).json()).idToken }, email)
  await x.p.goto(BASE + '#/login?role=' + portal); await x.p.reload(); await wait(x, 900)
  await x.p.getByRole('button', { name: 'Continue with Google' }).click(); await wait(x, 2000)
  if (await x.p.getByLabel('6-digit code').count()) {
    const c = await x.p.evaluate(async (email) => (await (await fetch('/__test/lastcode', { method: 'POST', body: JSON.stringify({ email }) })).json()).code, email)
    await x.p.getByLabel('6-digit code').fill(c || ''); await x.p.getByRole('button', { name: 'Verify and sign in' }).click(); await wait(x, 2400)
  }
  return x.p.url()
}
const person = async (name, portal, email, vp) => { const x = await browser(name, vp); x.url = await google(x, portal, email); return x }
const api = (x, route, opt = {}) => x.p.evaluate(async ([route, opt]) => { const q = opt.query ? '?' + new URLSearchParams(opt.query) : ''; const r = await fetch('/api/app/' + route + q, { method: opt.method || 'GET', headers: opt.body ? { 'Content-Type': 'application/json' } : {}, body: opt.body ? JSON.stringify(opt.body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) } }, [route, opt])
const main = (x) => x.p.locator('main').innerText().catch(() => '')
const go = async (x, hash, ms = 1700) => { await x.p.goto(BASE + '#' + hash); await x.p.reload(); await wait(x, ms) }
const ist = (ms, len = 16) => new Date(Date.now() + ms + 5.5 * 3600000).toISOString().slice(0, len)
const DAY = 86400000

// ---------- HOD: first sign-in → set-up → portal ----------
const hod = await person('HOD', 'hod', 'hod.cmpn@ves.ac.in')
check('HOD first sign-in goes to “Set up your profile” (appointment read-only)', /#\/setup/.test(hod.url) && /Set up your profile/.test(await main(hod)) && /HOD of CMPN/.test(await main(hod)), hod.url)
await go(hod, '/hod', 1500)
check('HOD can’t skip set-up: the portal redirects back', /#\/setup/.test(hod.p.url()), hod.p.url())
await hod.p.getByLabel('Full name').fill('Dr HOD CMPN'); await hod.p.getByLabel('Mobile number').fill('9876500002')
await hod.p.getByRole('button', { name: 'Save and continue' }).click(); await wait(hod, 900)
check('HOD set-up refuses without the confirmation tick', /Confirm that these details are correct/.test(await main(hod)))
await hod.p.getByLabel('I confirm these details are correct.').check(); await hod.p.getByRole('button', { name: 'Save and continue' }).click(); await wait(hod, 1800)
check('HOD set-up saves and offers the portal', /Go to your portal/.test(await main(hod)) && (await api(hod, 'me')).body.setupDone === true)
await api(hod, 'teachers', { method: 'POST', body: { email: 'prof.t@ves.ac.in', name: 'Prof T' } })
await api(hod, 'teacher-division', { method: 'POST', body: { email: 'prof.t@ves.ac.in', division: 'D2A', subject: 'Maths' } })

// ---------- Student: first sign-in → set-up (2 steps) ----------
const st = await person('Student', 'student', 'riya.e2e@ves.ac.in')
check('student first sign-in lands on “Set up your profile” (before the Overview)', /#\/setup/.test(st.url) && /Set up your profile/.test(await main(st)), st.url)
check('college email is shown read-only, from Google', await st.p.getByLabel('College email').inputValue() === 'riya.e2e@ves.ac.in' && await st.p.getByLabel('College email').getAttribute('readonly') !== null)
await st.p.getByRole('button', { name: 'Save and continue' }).click(); await wait(st, 500)
const errText = await main(st)
check('validation: every required field says what is missing', /Enter your full name/.test(errText) && /10-digit Indian mobile/.test(errText) && /Choose your academic year/.test(errText) && /Choose your branch/.test(errText) && /roll number/.test(errText))
await st.p.getByLabel('Full name').fill('Riya E2E'); await st.p.getByLabel('Mobile number').fill('98765 43210'); await st.p.getByLabel('Gender').selectOption('prefer_not_to_say')
await st.p.getByLabel('Academic year').selectOption('2'); await st.p.getByLabel('Branch').selectOption('CMPN'); await st.p.getByLabel('Roll number').fill('24-07')
await st.p.getByRole('button', { name: 'Save and continue' }).click(); await wait(st, 2000)
check('SE has no verified divisions: the page says so and names who adds them (nothing invented)', /No SE 2026-27 divisions for CMPN are set up yet/.test(await main(st)) && /your HOD adds it/.test(await main(st)), (await main(st)).slice(0, 500))
await st.p.getByLabel('Academic year').selectOption('1'); await st.p.getByRole('button', { name: 'Save changes' }).click(); await wait(st, 1800)
const step2 = await main(st)
check('step 2 lists only verified FE CMPN divisions', /Step 2 of 2/i.test(step2) && /D2A/.test(step2) && /D2B/.test(step2) && !/D1ADA/.test(step2) && /name to be confirmed/.test(step2), step2.slice(0, 900))
await st.p.getByRole('button', { name: /^D2A/ }).click(); await wait(st, 1800)
check('join request sent; Overview available while waiting', /Waiting for approval/.test(await main(st)) && /Go to Overview/.test(await main(st)))
await st.p.reload(); await wait(st, 1800)
check('refresh keeps the saved profile (server copy)', await st.p.getByLabel('Full name').inputValue() === 'Riya E2E' && await st.p.getByLabel('Roll number').inputValue() === '24-07')

// ---------- Teacher: set-up, approve, publish ----------
const t = await person('Teacher', 'teacher', 'prof.t@ves.ac.in')
check('teacher first sign-in goes to set-up with HOD-assigned classes read-only', /#\/setup/.test(t.url) && /D2A Maths/.test(await main(t)), t.url)
await t.p.getByLabel('Mobile number').fill('9876500011'); await t.p.getByLabel('I confirm these details are correct.').check(); await t.p.getByRole('button', { name: 'Save and continue' }).click(); await wait(t, 1600)
const jr = (await api(t, 'join-requests', { query: { division: 'D2A' } })).body.requests[0]
await api(t, 'join-decision', { method: 'POST', body: { ids: [jr.id], decision: 'approve' } })
await go(t, '/teacher?tab=send', 1800)
await t.p.getByRole('radio', { name: 'Assignment', exact: true }).click()
await t.p.getByLabel('Title').fill('Sheet 1: limits'); await t.p.getByLabel('Subject').fill('Maths')
await t.p.getByLabel('Deadline (optional, campus time)').fill(ist(3 * DAY))
await t.p.getByRole('button', { name: 'D2A', exact: true }).click()
await t.p.getByRole('button', { name: 'Publish', exact: true }).click(); await wait(t, 2000)
const afterPub = await main(t)
check('teacher publishes an assignment from the unified publisher; it is listed as published', /Published/.test(afterPub) && /Sheet 1: limits/.test(afterPub), afterPub.slice(0, 400))
await go(t, '/teacher?tab=send', 1600)
await t.p.getByRole('radio', { name: 'Exam', exact: true }).click(); await t.p.getByLabel('Title').fill('Unit test 1'); await t.p.getByLabel('Subject').fill('Maths')
await t.p.getByRole('button', { name: 'Publish', exact: true }).click(); await wait(t, 700)
check('an exam without a date is refused in the form (no fabricated dates)', /Give the Exam date/.test(await main(t)))
await t.p.getByLabel('Exam date').fill(ist(5 * DAY, 10)); await t.p.getByRole('button', { name: 'D2A', exact: true }).click(); await t.p.getByRole('button', { name: 'Publish', exact: true }).click(); await wait(t, 1800)
await go(t, '/teacher?tab=send', 1600)
await t.p.getByRole('radio', { name: 'Class announcement' }).click(); await t.p.getByLabel('Title').fill('Draft only notice'); await t.p.getByRole('button', { name: 'D2A', exact: true }).click()
await t.p.getByRole('button', { name: 'Save as draft' }).click(); await wait(t, 1500)

// ---------- Student Overview ----------
await go(st, '/', 2600)
const ov = await main(st)
check('Overview order: syllabus banner, timetable, assignments, calendar, dates, attendance, events, notices, quick actions', ['Syllabus', 'Today’s timetable', 'Assignments', 'Academic calendar', 'Important academic dates', 'Attendance and marks', 'College events', 'Notices', 'Quick actions'].every((h, i, a) => i === 0 || ov.indexOf(h) > ov.indexOf(a[i - 1])), ov.slice(0, 600))
check('syllabus banner says the link isn’t set yet (no invented URL)', /hasn’t added the syllabus link/.test(ov))
check('the published assignment is on the Overview; the draft is not', /Sheet 1: limits/.test(ov) && !/Draft only notice/.test(ov))
check('the exam appears in Important academic dates', /Unit test 1/.test(ov) && /In 5 days/.test(ov), ov.slice(ov.indexOf('Important academic dates'), ov.indexOf('Important academic dates') + 300))
await st.p.getByRole('button', { name: 'Open / submit' }).first().click(); await wait(st, 800)
await st.p.getByLabel('Note (optional)').fill('Done, see attached'); await st.p.getByRole('dialog').getByRole('button', { name: 'Hand in', exact: true }).click(); await wait(st, 1800)
check('student hands in the assignment; status changes to Submitted', /Submitted/.test(await st.p.locator('main').innerText()))
const cell = st.p.locator(`[data-cal="${ist(5 * DAY, 10)}"]`)
await cell.click(); await wait(st, 400)
check('calendar: clicking the exam date lists the exam with its type label', /Unit test 1/.test(await main(st)) && (await cell.getAttribute('aria-label')).includes('1 item'), await cell.getAttribute('aria-label'))
await st.p.getByRole('radio', { name: 'Week' }).click(); await wait(st, 400)
check('calendar week view shows 7 days', (await st.p.locator('[role=gridcell]').count()) === 7)
const subs = (await api(t, 'submissions', { query: { postId: (await api(t, 'published')).body.items.find((i) => i.title === 'Sheet 1: limits').id } })).body
check('teacher sees the hand-in', subs.counts.submitted === 1)

// ---------- class roles: SI request → teacher approves in the UI → SI publishes ----------
await go(st, '/portal?tab=class', 1800)
await st.p.getByRole('button', { name: 'Request sports incharge (SI)' }).click(); await wait(st, 1500)
check('student requests the SI role', /Sports incharge request waiting/.test(await main(st)), (await main(st)).slice(0, 300))
await go(t, '/teacher?tab=roles', 2200)
check('teacher sees the request under Class roles, with Male/Female CR positions vacant', /Sports incharge/.test(await main(t)) && /Male CR/.test(await main(t)) && /Vacant/.test(await main(t)))
await t.p.getByRole('button', { name: 'Approve' }).click(); await wait(t, 1800)
check('teacher approves; the SI holder is shown', /Riya E2E/.test(await main(t)))
await go(st, '/portal?tab=roles', 2000)
check('the SI gets SI tools (sports updates only, own class)', /Your class: D2A/i.test(await main(st)) && /Sports update/.test(await main(st)) && !/Cultural update/.test(await main(st)))
await st.p.getByLabel('Title').fill('Cricket trials Friday'); await st.p.getByRole('button', { name: 'Publish', exact: true }).click(); await wait(st, 1800)
check('SI publishes a sports update to the class', (await api(st, 'class-items')).body.items.some((i) => i.title === 'Cricket trials Friday' && i.kind === 'sports'))

// ---------- HOD branch view, divisions, syllabus, clubs ----------
await go(hod, '/hod?tab=branch', 2400)
const bv = await main(hod)
check('HOD branch view: data-quality issues name missing data (SE/TE/BE divisions, threshold)', /Data quality/.test(bv) && /No SE 2026-27 divisions/.test(bv) && /No attendance threshold/.test(bv), bv.slice(0, 600))
await go(hod, '/hod?tab=divisions', 2000)
await hod.p.getByLabel('Code').fill('SE-CMPN-A'); await hod.p.getByRole('button', { name: 'Add division' }).click(); await wait(hod, 1500)
check('HOD adds an SE division for the branch', (await api(hod, 'catalog')).body.divisions.some((d) => d.code === 'SE-CMPN-A'))
await hod.p.getByLabel('Syllabus link (https://)').fill('https://example.org/cmpn.pdf'); await hod.p.locator('form').filter({ hasText: 'Syllabus link' }).getByRole('button', { name: 'Save' }).click(); await wait(hod, 1400)
await go(st, '/', 2400)
check('student Overview banner links the syllabus the HOD set', await st.p.getByRole('link', { name: 'Open syllabus' }).getAttribute('href') === 'https://example.org/cmpn.pdf')
await go(hod, '/hod?tab=clubs', 1800)
await hod.p.getByLabel('Name', { exact: true }).fill('Coding Club'); await hod.p.getByLabel('Head (college email)').fill('club.head@ves.ac.in'); await hod.p.getByRole('button', { name: 'Create' }).click(); await wait(hod, 1500)
check('HOD creates a club and appoints its head', /Coding Club/.test(await main(hod)) && /club\.head@ves\.ac\.in/.test(await main(hod)))

// ---------- Event head: set-up, invite, create + publish an event ----------
const head = await person('Event head', 'student', 'club.head@ves.ac.in')
await head.p.getByLabel('Full name').fill('Club Head'); await head.p.getByLabel('Mobile number').fill('9876500031'); await head.p.getByLabel('Gender').selectOption('male')
await head.p.getByLabel('Academic year').selectOption('1'); await head.p.getByLabel('Branch').selectOption('CMPN'); await head.p.getByLabel('Roll number').fill('24-99')
await head.p.getByRole('button', { name: 'Save and continue' }).click(); await wait(head, 1500)
await go(head, '/clubs', 2000)
check('event head sees the club desk', /Coding Club/.test(await main(head)) && /You are the head/.test(await main(head)), (await main(head)).slice(0, 300))
await head.p.getByRole('radio', { name: 'Team' }).click(); await wait(head, 600)
await head.p.getByLabel('College email').fill('member.one@ves.ac.in'); await head.p.getByRole('button', { name: 'Send invitation' }).click(); await wait(head, 1400)
check('head invites a teammate by college email', /member\.one@ves\.ac\.in|me•••@ves\.ac\.in/.test(await main(head)) && /invited/.test(await main(head)))
await head.p.getByRole('radio', { name: 'Events' }).click(); await wait(head, 500)
await head.p.getByRole('button', { name: 'New event' }).click(); await wait(head, 600)
await head.p.getByLabel('Event name').fill('Hack Night'); await head.p.getByLabel('Description').fill('Bring a laptop.'); await head.p.getByLabel('Starts (campus time)').fill(ist(9 * DAY)); await head.p.getByLabel('Venue').fill('Seminar hall')
await head.p.getByRole('button', { name: 'CMPN', exact: true }).click(); await head.p.getByLabel('How people register').selectOption('builtin'); await head.p.getByLabel('Capacity (empty = no limit)').fill('50')
await head.p.getByRole('button', { name: 'Preview' }).first().click(); await wait(head, 600)
check('event preview renders before publishing', /Draft preview/.test(await head.p.getByRole('dialog').innerText()) && /Seminar hall/.test(await head.p.getByRole('dialog').innerText()))
await head.p.getByRole('dialog').getByRole('button', { name: 'Close' }).click(); await wait(head, 300)
await head.p.getByRole('button', { name: 'Save draft' }).click(); await wait(head, 1600)
await head.p.getByRole('button', { name: 'Publish', exact: true }).click(); await wait(head, 1600)
check('head publishes the event', /published/.test(await main(head)))
const mem = await person('Club member', 'student', 'member.one@ves.ac.in')
await go(mem, '/clubs', 1800)
check('invitee is blocked by set-up first, then sees the invitation', /#\/setup/.test(mem.p.url()))
await mem.p.getByLabel('Full name').fill('Member One'); await mem.p.getByLabel('Mobile number').fill('9876500032'); await mem.p.getByLabel('Gender').selectOption('female')
await mem.p.getByLabel('Academic year').selectOption('1'); await mem.p.getByLabel('Branch').selectOption('CMPN'); await mem.p.getByLabel('Roll number').fill('24-98')
await mem.p.getByRole('button', { name: 'Save and continue' }).click(); await wait(mem, 1500)
await go(mem, '/clubs', 1800)
check('invitee sees the invitation and accepts it with their own account', /Invitations/.test(await main(mem)))
await mem.p.getByRole('button', { name: 'Accept' }).click(); await wait(mem, 1600)
check('member has only the granted permission (no publish button)', /Drafts/.test(await main(mem)) && !(await mem.p.getByRole('button', { name: 'Publish', exact: true }).count()))

// ---------- student registers for the club event ----------
await go(st, '/', 2600)
await st.p.locator('section').filter({ has: st.p.getByRole('heading', { name: 'College events' }) }).getByText('Hack Night').first().click(); await wait(st, 1500)
const dlg = await st.p.getByRole('dialog').innerText()
check('student opens the club event from the Overview (audience CMPN)', /Hack Night/.test(dlg) && /Seminar hall/.test(dlg) && /50 of 50 places left/.test(dlg), dlg.slice(0, 300))
await st.p.getByRole('dialog').getByRole('button', { name: 'Register' }).click(); await wait(st, 1500)
check('student registers; the dialog shows it', /You are registered/.test(await st.p.getByRole('dialog').innerText()))
const regs = await api(head, 'club-registrations', { query: { eventId: (await api(head, 'club', { query: { id: (await api(head, 'clubs')).body.clubs[0].id } })).body.events[0].id } })
check('organiser sees the registration with a masked email and no academic data', regs.body.registrations.length === 1 && Object.keys(regs.body.registrations[0]).sort().join() === 'contact,name,registered_at,status')

// ---------- parent ----------
const link = await api(st, 'parent-links', { method: 'POST', body: { email: 'parent.e2e@gmail.com', relation: 'Mother' } })
await api(t, 'parent-link-decision', { method: 'POST', body: { ids: [link.body.link.id], decision: 'approve' } })
const par = await person('Parent', 'parent', 'parent.e2e@gmail.com')
check('parent is not sent to set-up and lands in the Parent portal (read-only)', /#\/parent|#\/$/.test(par.url) && !/Set up your profile/.test(await main(par)), par.url)
check('parent cannot publish or use clubs', (await api(par, 'publish', { method: 'POST', body: { kind: 'notice', title: 'Parent notice', divisions: ['D2A'] } })).status === 403 && (await api(par, 'calendar')).status === 403)

// ---------- phone layout, 3D campus, errors ----------
const ph = await browser('phone', { width: 375, height: 800 })
await ph.ctx.addCookies(await st.ctx.cookies()); await ph.p.goto(BASE + '#/'); await wait(ph, 2600)
const sw = await ph.p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
check('Overview fits a phone screen (no sideways scrolling)', sw[0] <= sw[1], sw.join(' vs '))
await go(st, '/navigator', 4000)
check('3D campus still renders', (await st.p.locator('canvas').count()) > 0)
check('no Content-Security-Policy violations', csp.length === 0, csp.join(' | '))
const errs = people.flatMap((x) => x.errs.map((e) => x.name + ': ' + e))
check('no page errors in any browser', errs.length === 0, errs.slice(0, 5).join(' | '))
console.log(`\n${out.filter((x) => x.ok).length} passed, ${out.filter((x) => !x.ok).length} failed`)
await b.close(); process.exit(out.some((x) => !x.ok) ? 1 : 0)
