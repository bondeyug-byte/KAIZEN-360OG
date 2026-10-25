// Parent Portal server tests: real handlers + real Postgres (PGlite) + production-style signed cookies.
// Synthetic numbers and names only. Run: npm test (in this folder).
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefgh'; process.env.DATABASE_URL = 'postgres://u:p@h.example/db';
process.env.HOD_EMAILS = 'u9100000001@ves.ac.in=CMPN;u9100000002@ves.ac.in=AIDS';
const path = require('path'), crypto = require('crypto'), assert = require('assert');
const API = process.env.API_DIR || path.join(__dirname, '../../api');
const { PGlite } = require('@electric-sql/pglite');
const db = require(API + '/_db'); const app = require(API + '/app'); const { signInRole } = require(API + '/_access');
const { sessionCookie } = require(API + '/_session');
// Synthetic identities: 91000002xx = parents (personal Gmail), everyone else = @ves.ac.in college accounts.
const E = (n) => (String(n).includes('@') ? String(n) : /^91000002/.test(String(n)) ? `p${n}@gmail.com` : `u${n}@ves.ac.in`);
const C = (n) => sessionCookie(E(n)).split(';')[0];
const call = (who, method, route, body, query = {}) => new Promise((ok) => {
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; }, json(b) { ok({ status: this.c, body: b }); }, end(buf) { ok({ status: this.c, raw: buf }); } };
  app({ method, query: { ...query, route }, url: '/api/app/' + route, headers: { cookie: C(who) }, body }, res);
});
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '→', e.message); } };
const HOD = '9100000001', HOD_AI = '9100000002', T1 = '9100000011', T_OTHER = '9100000012';
const S1 = '9100000101', S2 = '9100000102', S3 = '9100000103';
const P1 = '9100000201', P2 = '9100000202', P3 = '9100000203';
const today = new Date().toISOString().slice(0, 10), daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
(async () => {
  const pg = new PGlite(); const run = (x, p) => pg.query(x, p).then((r) => r.rows); db._setClient(run);
  await db.ensureSchema();
  // setup: teacher T1 teaches D2A (CMPN); T_OTHER teaches D2B; S1 + S2 in D2A, S3 in D2B
  await call(HOD, 'POST', 'teachers', { email: E(T1), name: 'Prof Test' }); await call(HOD, 'POST', 'teacher-division', { email: E(T1), division: 'D2A', subject: 'Maths' })
  await call(HOD, 'POST', 'teachers', { email: E(T_OTHER), name: 'Prof Other' }); await call(HOD, 'POST', 'teacher-division', { email: E(T_OTHER), division: 'D2B', subject: 'Maths' })
  const ids = {}
  for (const [s, d, name, roll] of [[S1, 'D2A', 'Student One', '1'], [S2, 'D2A', 'Student Two', '2'], [S3, 'D2B', 'Student Three', '3']]) {
    await call(s, 'PUT', 'me', { profile: { name, roll }, data: {}, baseVersion: 0 }); await run('update accounts set name = $2 where phone = $1', [E(s), name])
    const r = await call(s, 'POST', 'join-requests', { division: d }); await call(HOD, 'POST', 'join-decision', { ids: [r.body.joinRequest.id], decision: 'approve' })
    ids[s] = (await call(s, 'GET', 'me')).body.account.id
  }

  await t('student adds a parent → pending; the parent is NOT a parent yet (no access)', async () => {
    const r = await call(S1, 'POST', 'parent-links', { email: E(P1), relation: 'Mother' }); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.link.status, 'pending')
    assert.equal((await signInRole(E(P1))).base, 'none') // a personal Gmail is nothing until the link is confirmed
    assert.equal((await call(P1, 'GET', 'parent-children')).status, 403)
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.code, 'NO_ACCESS')
  })
  await t('link rules: no own number, no staff number, no duplicates, needs a class', async () => {
    assert.equal((await call(S1, 'POST', 'parent-links', { email: E(S1) })).body.code, 'OWN_EMAIL')
    assert.equal((await call(S1, 'POST', 'parent-links', { email: E(T1) })).body.code, 'STAFF_EMAIL')
    assert.equal((await call(S1, 'POST', 'parent-links', { email: E(P1) })).body.code, 'ALREADY_LINKED')
    assert.equal((await call('9100000150', 'POST', 'parent-links', { email: E(P2) })).status, 403) // not in a class
  })
  let linkId
  await t('only the class teacher or branch HOD can confirm; other teachers cannot', async () => {
    linkId = (await call(T1, 'GET', 'parent-links', null, { division: 'D2A' })).body.links.find((l) => l.status === 'pending').id
    assert.equal((await call(T_OTHER, 'GET', 'parent-links', null, { division: 'D2A' })).status, 403)
    const bad = await call(T_OTHER, 'POST', 'parent-link-decision', { ids: [linkId], decision: 'approve' }); assert.equal(bad.body.results[0].ok, false)
    assert.equal((await call(HOD_AI, 'POST', 'parent-link-decision', { ids: [linkId], decision: 'approve' })).body.results[0].ok, false)
    const ok = await call(T1, 'POST', 'parent-link-decision', { ids: [linkId], decision: 'approve' }); assert.equal(ok.body.results[0].ok, true)
    assert.equal((await call(HOD, 'POST', 'parent-link-decision', { ids: [linkId], decision: 'reject' })).body.results[0].error, 'Already approved.')
  })
  await t('after confirmation the number signs in as a parent and sees exactly one child', async () => {
    assert.equal((await signInRole(E(P1))).base, 'parent')
    const me = (await call(P1, 'GET', 'me')).body; assert.equal(me.role, 'parent'); assert.equal(me.parent.children, 1)
    const kids = (await call(P1, 'GET', 'parent-children')).body.children; assert.equal(kids.length, 1); assert.equal(kids[0].id, ids[S1])
  })
  await t('multiple children: a second confirmed child appears; multiple guardians per student allowed', async () => {
    const r = await call(S3, 'POST', 'parent-links', { email: E(P1), relation: 'Mother' }); const id = r.body.link.id
    await call(T_OTHER, 'POST', 'parent-link-decision', { ids: [id], decision: 'approve' })
    assert.equal((await call(P1, 'GET', 'parent-children')).body.children.length, 2)
    const r2 = await call(S1, 'POST', 'parent-links', { email: E(P2), relation: 'Father' }); await call(HOD, 'POST', 'parent-link-decision', { ids: [r2.body.link.id], decision: 'approve' })
    assert.equal((await call(P2, 'GET', 'parent-children')).body.children.length, 1)
  })
  await t('cross-student access is refused (other student id, random id, staff-only routes, writes)', async () => {
    assert.equal((await call(P2, 'GET', 'parent-record', null, { child: ids[S2] })).status, 404)
    assert.equal((await call(P2, 'GET', 'parent-record', null, { child: ids[S3] })).status, 404)
    assert.equal((await call(P2, 'GET', 'parent-record', null, { child: '00000000-0000-4000-8000-000000000000' })).status, 404)
    assert.equal((await call(P2, 'GET', 'roster', null, { division: 'D2A' })).status, 403)
    assert.equal((await call(P2, 'GET', 'feed', null, { division: 'D2A' })).status, 403)
    assert.equal((await call(P2, 'GET', 'attendance', null, { division: 'D2A' })).status, 403)
    assert.equal((await call(P2, 'POST', 'attendance', { division: 'D2A', subject: 'Maths', date: today, marks: [{ studentId: ids[S1], present: true }] })).status, 403)
    assert.equal((await call(P2, 'POST', 'assessments', { division: 'D2A', subject: 'Maths', name: 'Hack', maxMarks: 10 })).status, 403)
    assert.equal((await call(P2, 'POST', 'alerts', { division: 'D2A', studentId: ids[S1], title: 'Hack' })).status, 403)
    assert.equal((await call(P2, 'POST', 'join-requests', { division: 'D2A' })).status, 403)
    assert.equal((await call(P2, 'POST', 'parent-links', { email: E(P3) })).status, 403)
  })
  await t('empty data: record shows no attendance percentage and no marks (nothing invented)', async () => {
    const r = (await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body
    assert.equal(r.attendance.total, 0); assert.equal(r.attendance.percent, null); assert.equal(r.attendance.period, null); assert.equal(r.marks.items.length, 0); assert.equal(r.attendanceThreshold, null)
    assert.equal(r.student.name, 'Student One'); assert.equal(r.student.division, 'D2A'); assert.equal(r.student.roll, '1')
  })
  await t('attendance: only the division teacher records; percentages computed from records', async () => {
    assert.equal((await call(T_OTHER, 'POST', 'attendance', { division: 'D2A', subject: 'Maths', date: today, marks: [{ studentId: ids[S1], present: true }] })).status, 403)
    const days = [[daysAgo(40), true, 'Maths'], [daysAgo(39), false, 'Maths'], [daysAgo(3), true, 'Physics'], [daysAgo(2), true, 'Maths'], [today, false, 'Physics']]
    for (const [d, p, sub] of days) { const r = await call(T1, 'POST', 'attendance', { division: 'D2A', subject: sub, date: d, start: '09:00', marks: [{ studentId: ids[S1], present: p }, { studentId: ids[S2], present: true }] }); assert.equal(r.status, 200, JSON.stringify(r.body)) }
    const a = (await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.attendance
    assert.equal(a.total, 5); assert.equal(a.present, 3); assert.equal(a.absent, 2); assert.equal(a.percent, 60)
    assert.deepEqual(a.bySubject.map((s) => [s.key, s.present, s.total]), [['Maths', 2, 3], ['Physics', 1, 2]])
    assert.equal(a.byMonth.reduce((n, m) => n + m.total, 0), 5); assert.equal(a.period.from, daysAgo(40)); assert.equal(a.period.to, today)
  })
  await t('attendance correction updates the same session (no duplicates); future dates and outsiders refused', async () => {
    const r = await call(T1, 'POST', 'attendance', { division: 'D2A', subject: 'Physics', date: today, start: '09:00', marks: [{ studentId: ids[S1], present: true }, { studentId: ids[S2], present: true }] })
    assert.equal(r.body.session.created, false)
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.attendance.percent, 80)
    assert.equal((await call(T1, 'POST', 'attendance', { division: 'D2A', subject: 'Maths', date: daysAgo(-5), marks: [{ studentId: ids[S1], present: true }] })).body.code, 'INVALID_DATE')
    assert.equal((await call(T1, 'POST', 'attendance', { division: 'D2A', subject: 'Maths', date: today, marks: [{ studentId: ids[S3], present: true }] })).body.code, 'NOT_IN_CLASS')
  })
  let asg
  await t('marks: drafts are private; published marks appear with computed percentages', async () => {
    asg = (await call(T1, 'POST', 'assessments', { division: 'D2A', subject: 'Maths', name: 'Unit test 1', term: 'Term 1', date: daysAgo(5), maxMarks: 25 })).body.assessment.id
    assert.equal((await call(T1, 'POST', 'assessment-marks', { id: asg, marks: [{ studentId: ids[S1], obtained: 20, remark: 'Good work' }, { studentId: ids[S2], absent: true }] })).status, 200)
    assert.equal((await call(T1, 'POST', 'assessment-marks', { id: asg, marks: [{ studentId: ids[S1], obtained: 26 }] })).body.code, 'INVALID_MARK')
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.marks.items.length, 0) // draft
    assert.equal((await call(S1, 'GET', 'my-record')).body.marks.items.length, 0)
    await call(T1, 'POST', 'assessment-status', { id: asg, status: 'published' })
    const m = (await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.marks
    assert.equal(m.items.length, 1); assert.equal(m.items[0].obtained, 20); assert.equal(m.items[0].percent, 80); assert.equal(m.items[0].remark, 'Good work'); assert.equal(m.items[0].grade, null)
    assert.deepEqual(m.byTerm.map((x) => [x.term, x.obtained, x.max, x.percent]), [['Term 1', 20, 25, 80]])
    const m2 = (await call(P2, 'GET', 'parent-record', null, { child: ids[S1] })).body.marks.items; assert.equal(m2.length, 1)
  })
  await t('a teacher correction to published marks flows through; unpublishing hides them again', async () => {
    await call(T1, 'POST', 'assessment-marks', { id: asg, marks: [{ studentId: ids[S1], obtained: 22 }] })
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.marks.items[0].obtained, 22)
    await call(T1, 'POST', 'assessment-status', { id: asg, status: 'draft' })
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.marks.items.length, 0)
    await call(T1, 'POST', 'assessment-status', { id: asg, status: 'published' })
  })
  let alert
  await t('attendance alerts: teacher drafts (private) → only the branch HOD publishes → parent sees it; withdraw hides it', async () => {
    alert = (await call(T1, 'POST', 'alerts', { division: 'D2A', studentId: ids[S1], subject: 'Physics', title: 'Attendance shortage in Physics', details: 'Missed sessions this month.', nextSteps: 'Meet the class teacher.', contact: 'Class teacher, D2A' })).body.alert.id
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.alerts.length, 0)
    assert.equal((await call(T1, 'POST', 'alert-status', { id: alert, status: 'published' })).status, 403)
    assert.equal((await call(HOD_AI, 'POST', 'alert-status', { id: alert, status: 'published' })).status, 403)
    assert.equal((await call(HOD, 'POST', 'alert-status', { id: alert, status: 'published' })).status, 200)
    const a = (await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.alerts; assert.equal(a.length, 1); assert.equal(a[0].title, 'Attendance shortage in Physics'); assert.ok(a[0].published_at)
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S3] })).body.alerts.length, 0) // other child
    assert.equal((await call(T1, 'POST', 'alerts', { id: alert, title: 'Changed by teacher' })).status, 403) // published → HOD only
    await call(HOD, 'POST', 'alert-status', { id: alert, status: 'withdrawn' })
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.alerts.length, 0)
    await call(HOD, 'POST', 'alert-status', { id: alert, status: 'published' })
  })
  let ev
  await t('events: draft hidden; published shown to the branch; edits flow; cancellation is shown as cancelled; other branch never sees it', async () => {
    ev = (await call(HOD, 'POST', 'events', { title: 'Parent–teacher meeting', description: 'Term review', venue: 'Seminar hall', startsAt: new Date(Date.now() + 7 * 86400000).toISOString() })).body.event.id
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.events.length, 0)
    assert.equal((await call(T1, 'POST', 'event-status', { id: ev, status: 'published' })).status, 403)
    assert.equal((await call(HOD_AI, 'POST', 'event-status', { id: ev, status: 'published' })).status, 403)
    await call(HOD, 'POST', 'event-status', { id: ev, status: 'published' })
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.events[0].title, 'Parent–teacher meeting')
    await call(HOD, 'POST', 'events', { id: ev, title: 'Parent–teacher meeting (new time)', venue: 'Seminar hall', startsAt: new Date(Date.now() + 8 * 86400000).toISOString() })
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.events[0].title, 'Parent–teacher meeting (new time)')
    await call(HOD, 'POST', 'event-status', { id: ev, status: 'cancelled' })
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.events[0].status, 'cancelled')
    const other = await call(HOD_AI, 'POST', 'events', { title: 'AIDS only', startsAt: new Date(Date.now() + 86400000).toISOString() }); await call(HOD_AI, 'POST', 'event-status', { id: other.body.event.id, status: 'published' })
    assert.ok(!(await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.events.some((e) => e.title === 'AIDS only'))
  })
  await t('attendance threshold: none until the HOD sets one; only that branch HOD can set it', async () => {
    assert.equal((await call(T1, 'POST', 'attendance-threshold', { branch: 'CMPN', value: 75 })).status, 403)
    assert.equal((await call(HOD_AI, 'POST', 'attendance-threshold', { branch: 'CMPN', value: 75 })).status, 403)
    assert.equal((await call(HOD, 'POST', 'attendance-threshold', { branch: 'CMPN', value: 75 })).status, 200)
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.attendanceThreshold, 75)
    assert.equal((await call(P1, 'GET', 'parent-record', null, { child: ids[S3] })).body.attendanceThreshold, 75) // D2B is CMPN too
  })
  await t("what's new: items since the parent's last visit; marking seen clears them", async () => {
    const r = (await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.whatsNew; assert.ok(r.items.length >= 2); assert.ok(r.newAttendance >= 5)
    assert.equal((await call(P1, 'POST', 'parent-seen', { child: ids[S1] })).status, 200)
    const r2 = (await call(P1, 'GET', 'parent-record', null, { child: ids[S1] })).body.whatsNew; assert.equal(r2.items.length, 0); assert.equal(r2.newAttendance, 0)
    assert.equal((await call(P1, 'POST', 'parent-seen', { child: ids[S2] })).status, 404)
  })
  await t('revoking a link removes access immediately (student or HOD)', async () => {
    const mine = (await call(S1, 'GET', 'parent-links')).body.links.find((l) => l.relation === 'Father')
    assert.equal((await call(S2, 'DELETE', 'parent-links', null, { id: mine.id })).status, 404) // not their link
    assert.equal((await call(S1, 'DELETE', 'parent-links', null, { id: mine.id })).status, 200)
    // a personal Gmail with no confirmed link has no access at all (not even a student account)
    assert.equal((await call(P2, 'GET', 'parent-record', null, { child: ids[S1] })).body.code, 'NO_ACCESS')
    assert.equal((await call(P2, 'GET', 'me')).body.code, 'NO_ACCESS')
  })
  await t('every write is in the audit log; parents created none', async () => {
    const acts = (await run('select action from audit_log')).map((r) => r.action)
    for (const a of ['parent.link.request', 'parent.link.approve', 'attendance.record', 'attendance.update', 'assessment.publish', 'marks.save', 'alert.published', 'event.cancelled', 'parent.link.revoke']) assert.ok(acts.includes(a), a)
    const p1 = (await run(`select id from accounts where phone = '${E(P1)}'`))[0].id
    assert.equal((await run(`select count(*)::int n from audit_log where actor = $1 and action <> 'account.create'`, [p1]))[0].n, 0)
  })
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
