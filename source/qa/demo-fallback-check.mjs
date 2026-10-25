import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH })
const out = []; const check = (n, ok, i = '') => { out.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, !ok ? '→ ' + String(i).slice(0, 300) : '') }
async function page(base) { const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }); await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort()); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); return { p, errs } }
// A: Google sign-in NOT configured → demo works
{ const { p, errs } = await page('http://localhost:4351/')
  await p.goto('http://localhost:4351/#/login?role=student'); await p.waitForTimeout(1500)
  const t = await p.locator('body').innerText()
  check('not configured: friendly message + demo accounts offered', /being set up/.test(t) && /Until then, use a demo account below/.test(t) && /Demo sign-in · Student/.test(t), t.slice(0, 400))
  await p.getByRole('button', { name: /Kabir Shah/ }).first().click(); await p.waitForTimeout(1800)
  const m = await p.locator('main').innerText()
  check('not configured: demo student signs in and sees the Overview', /Overview/.test(m) && /Today’s timetable/.test(m), m.slice(0, 200))
  await p.reload(); await p.waitForTimeout(1800)
  check('not configured: demo session survives refresh', /Overview/.test(await p.locator('main').innerText()))
  const w = await (await page('x')).p; await w.goto('http://localhost:4351/#/welcome'); await w.waitForTimeout(1500)
  check('not configured: landing shows the Guided demo button', /Guided demo/.test(await w.locator('body').innerText()))
  check('no page errors (A)', errs.length === 0, errs.join(' | ')) }
// B: Google sign-in configured → no demo at all, even with a stored demo session
{ const { p, errs } = await page('http://localhost:4352/')
  await p.goto('http://localhost:4352/#/login?role=student'); await p.waitForTimeout(1500)
  const t = await p.locator('body').innerText()
  check('configured: Continue with Google, no demo accounts', /Continue with Google/.test(t) && !/Demo sign-in/.test(t) && !/Kabir Shah/.test(t), t.slice(0, 300))
  await p.evaluate(() => localStorage.setItem('campus360.pref.demoUser', JSON.stringify('u_kabir')))
  await p.goto('http://localhost:4352/#/attendance'); await p.reload(); await p.waitForTimeout(1800)
  const a = await p.locator('body').innerText()
  check('configured: a demo session planted in browser storage is ignored (sign-in page shown)', /Continue with Google/.test(a) && !/My attendance/.test(a), a.slice(0, 200))
  check('no page errors (B)', errs.length === 0, errs.join(' | ')) }
console.log(`${out.filter(Boolean).length}/${out.length} passed`); await b.close()
