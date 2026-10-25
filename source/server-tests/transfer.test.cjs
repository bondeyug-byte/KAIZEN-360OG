// Division change (transfer) + attendance single-source tests: real handlers, real Postgres (PGlite), signed cookies.
// Synthetic numbers and names only. Run: npm test (in this folder).
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefgh'; process.env.DATABASE_URL = 'postgres://u:p@h.example/db';
process.env.HOD_EMAILS = 'u9100000001@ves.ac.in=CMPN;u9100000002@ves.ac.in=AIDS';
const path = require('path'), crypto = require('crypto'), assert = require('assert');
const API = process.env.API_DIR || path.join(__dirname, '../../api');
const { PGlite } = require('@electric-sql/pglite');
const db = require(API + '/_db'); const app = require(API + '/app'); const sync = require(API + '/sync');
const { sessionCookie } = require(API + '/_session');
// Synthetic identities: 91000002xx = parents (personal Gmail), everyone else = @ves.ac.in college accounts.
const E = (n) => (String(n).includes('@') ? String(n) : /^91000002/.test(String(n)) ? `p${n}@gmail.com` : `u${n}@ves.ac.in`);
const C = (n) => sessionCookie(E(n)).split(';')[0];
const mkRes = (ok) => ({ h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; }, json(b) { ok({ status: this.c, body: b }); }, end(buf) { ok({ status: this.c, raw: buf }); } });
const call = (who, method, route, body, query = {}) => new Promise((ok) => app({ method, query: { ...query, route }, url: '/api/app/' + route, headers: { cookie: C(who) }, body }, mkRes(ok)));
const syncCall = (who, method, body) => new Promise((ok) => sync({ method, query: {}, url: '/api/sync', headers: { cookie: C(who) }, body }, mkRes(ok)));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '→', e.message); } };
const HOD = '9100000001', HOD_AI = '9100000002', TA = '9100000011', TB = '9100000012';
const S1 = '9100000101', S2 = '9100000102', S3 = '9100000103';
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
(async () => {
  const pg = new PGlite(); const run = (x, p) => pg.query(x, p).then((r) => r.rows); db._setClient(run);
  await db.ensureSchema();
  await call(HOD, 'POST', 'teachers', { email: E(TA), name: 'Prof A' }); await call(HOD, 'POST', 'teacher-division', { email: E(TA), division: 'D2A', subject: 'Maths' })
  await call(HOD, 'POST', 'teachers', { email: E(TB), name: 'Prof B' }); await call(HOD, 'POST', 'teacher-division', { email: E(TB), division: 'D2B', subject: 'Maths' })
  const ids = {}
  for (const [s, d, name] of [[S1, 'D2A', 'Student One'], [S2, 'D2A', 'Student Two'], [S3, 'D2B', 'Student Three']]) {
    await call(s, 'PUT', 'me', { profile: { name, roll: s.slice(-2) }, data: {}, baseVersion: 0 })
    const r = await call(s, 'POST', 'join-requests', { division: d }); await call(HOD, 'POST', 'join-decision', { ids: [r.body.joinRequest.id], decision: 'approve' })
    ids[s] = (await call(s, 'GET', 'me')).body.account.id
  }

  await t('migration 5 is additive: earlier join requests keep kind = join', async () => {
    const rows = await run(`select kind, from_division, reason from join_requests`)
    assert.ok(rows.length >= 3); assert.ok(rows.every((r) => r.kind === 'join' && r.from_division === null && r.reason === ''))
    assert.equal((await run(`select count(*)::int as n from schema_migrations where id = 5`))[0].n, 1)
  })
  await t('a student in a class can ask to change division, with a reason; validation errors are clear', async () => {
    assert.equal((await call(S1, 'POST', 'join-requests', { division: 'D2A', reason: 'wrong one' })).body.code, 'SAME_DIVISION')
    assert.equal((await call(S1, 'POST', 'join-requests', { division: 'D1ADA', reason: 'other branch' })).body.code, 'OTHER_BRANCH_OR_YEAR')
    assert.equal((await call(S1, 'POST', 'join-requests', { division: 'D2B' })).body.code, 'REASON_REQUIRED')
    assert.equal((await call(S1, 'POST', 'join-requests', { division: 'NOPE', reason: 'abcdef' })).body.code, 'UNKNOWN_DIVISION')
    const r = await call(S1, 'POST', 'join-requests', { division: 'D2B', reason: 'Picked the wrong division at sign-up' })
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.joinRequest.kind, 'transfer'); assert.equal(r.body.joinRequest.from_division, 'D2A')
    assert.equal((await call(S1, 'POST', 'join-requests', { division: 'D2B', reason: 'again please' })).body.code, 'PENDING_EXISTS')
  })
  await t('until approved the student stays in the old class; me shows the pending change', async () => {
    const me = (await call(S1, 'GET', 'me')).body
    assert.equal(me.enrollment.division_code, 'D2A'); assert.equal(me.joinRequest.status, 'pending'); assert.equal(me.joinRequest.kind, 'transfer')
  })
  let reqId
  await t('only the target class teacher or the HOD may approve; old-class teacher, other HOD, a CR and the student cannot', async () => {
    reqId = (await call(TB, 'GET', 'join-requests', null, { division: 'D2B' })).body.requests.find((x) => x.kind === 'transfer').id
    assert.equal((await call(TA, 'POST', 'join-decision', { ids: [reqId], decision: 'approve' })).body.results[0].ok, false)
    assert.equal((await call(HOD_AI, 'POST', 'join-decision', { ids: [reqId], decision: 'approve' })).body.results[0].ok, false)
    assert.equal((await call(S1, 'POST', 'join-decision', { ids: [reqId], decision: 'approve' })).body.results[0].ok, false)
    // make S3 the CR of D2B: a CR sees new-student requests only, and cannot decide a transfer
    await run(`insert into cr_assignments (student_id, division_code, assigned_by) values ($1, 'D2B', $1)`, [ids[S3]]).catch(async () => run(`insert into cr_assignments (student_id, division_code) values ($1, 'D2B')`, [ids[S3]]))
    const crView = await call(S3, 'GET', 'join-requests', null, { division: 'D2B' })
    assert.equal(crView.status, 200, JSON.stringify(crView.body)); assert.ok(!crView.body.requests.some((x) => x.id === reqId))
    assert.equal((await call(S3, 'POST', 'join-decision', { ids: [reqId], decision: 'approve' })).body.results[0].ok, false)
  })
  await t('attendance recorded in the old class before the move', async () => {
    const r = await call(TA, 'POST', 'attendance', { division: 'D2A', subject: 'Maths', date: daysAgo(2), start: '09:00', marks: [{ studentId: ids[S1], present: true }, { studentId: ids[S2], present: false }] })
    assert.equal(r.status, 200, JSON.stringify(r.body))
  })
  await t('approval moves the student in one step: old class archived, new class active, CR role and CR request ended', async () => {
    await run(`insert into cr_requests (student_id, division_code) values ($1, 'D2A')`, [ids[S1]])
    const ok = await call(TB, 'POST', 'join-decision', { ids: [reqId], decision: 'approve', note: 'ok' }); assert.equal(ok.body.results[0].ok, true, JSON.stringify(ok.body))
    const en = await run(`select division_code, status from class_enrollments where student_id = $1 order by status`, [ids[S1]])
    assert.deepEqual(en.map((e) => [e.division_code, e.status]), [['D2B', 'active'], ['D2A', 'archived']])
    assert.equal((await run(`select status from cr_requests where student_id = $1`, [ids[S1]]))[0].status, 'cancelled')
    assert.equal((await call(HOD, 'POST', 'join-decision', { ids: [reqId], decision: 'reject' })).body.results[0].error, 'Already approved.')
  })
  await t('after approval (and a fresh sign-in) everything follows the confirmed division', async () => {
    const me = (await call(S1, 'GET', 'me')).body; assert.equal(me.enrollment.division_code, 'D2B')
    // asking for the old division is ignored: a student is always served their confirmed division
    assert.equal((await call(S1, 'GET', 'timetable', null, { division: 'D2A' })).body.division, 'D2B')
    assert.equal((await call(S1, 'GET', 'feed', null, { division: 'D2A' })).body.division, 'D2B')
    const rec = (await call(S1, 'GET', 'my-record')).body; assert.equal(rec.student.division, 'D2B')
    // the earlier lecture stays in the student's own history (not deleted by the move)
    assert.equal(rec.attendance.total, 1); assert.equal(rec.attendance.history[0].division, 'D2A')
  })
  await t('correcting an old-class sheet later does not delete the moved student’s mark', async () => {
    const r = await call(TA, 'POST', 'attendance', { division: 'D2A', subject: 'Maths', date: daysAgo(2), start: '09:00', marks: [{ studentId: ids[S2], present: true }] })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal((await call(S1, 'GET', 'my-record')).body.attendance.total, 1)
    assert.equal((await call(S2, 'GET', 'my-record')).body.attendance.present, 1)
  })
  await t('rejected and cancelled change requests leave the class unchanged', async () => {
    const r = await call(S2, 'POST', 'join-requests', { division: 'D2B', reason: 'Closer to my lab batch' }); const id = r.body.joinRequest.id
    await call(TB, 'POST', 'join-decision', { ids: [id], decision: 'reject', note: 'Division is full for labs' })
    assert.equal((await call(S2, 'GET', 'me')).body.enrollment.division_code, 'D2A')
    const r2 = await call(S2, 'POST', 'join-requests', { division: 'D2B', reason: 'Trying again' }); assert.equal(r2.status, 200)
    assert.equal((await call(S2, 'DELETE', 'join-requests', null, { id: r2.body.joinRequest.id })).status, 200)
    assert.equal((await call(S2, 'GET', 'me')).body.enrollment.division_code, 'D2A')
  })
  await t('a stale transfer (student no longer in from_division) is refused, nothing changes', async () => {
    const r = await call(S2, 'POST', 'join-requests', { division: 'D2B', reason: 'Moving for electives' }); const id = r.body.joinRequest.id
    await call(HOD, 'POST', 'enrollment-revoke', { studentId: ids[S2], division: 'D2A' })
    const res = await call(HOD, 'POST', 'join-decision', { ids: [id], decision: 'approve' })
    assert.equal(res.body.results[0].ok, false); assert.match(res.body.results[0].error, /no longer in D2A/)
    assert.equal((await run(`select count(*)::int as n from class_enrollments where student_id = $1 and status = 'active'`, [ids[S2]]))[0].n, 0)
  })
  await t('protected fields: a student cannot set role, division or enrollment through the profile', async () => {
    await call(S3, 'PUT', 'me', { profile: { name: 'Student Three', role: 'hod', division: 'D2A', enrollment: 'D2A' }, data: {}, baseVersion: (await call(S3, 'GET', 'me')).body.version || 0 })
    const me = (await call(S3, 'GET', 'me')).body; assert.equal(me.role, 'student'); assert.equal(me.enrollment.division_code, 'D2B')
  })

  // ---------- attendance: one source of truth ----------
  await t('teacher records + corrects → student record has the same numbers; duplicate save does not double count', async () => {
    const m = (p1, p3) => [{ studentId: ids[S1], present: p1 }, { studentId: ids[S3], present: p3 }]
    await call(TB, 'POST', 'attendance', { division: 'D2B', subject: 'Maths', date: daysAgo(1), start: '10:00', marks: m(true, true) })
    await call(TB, 'POST', 'attendance', { division: 'D2B', subject: 'Maths', date: daysAgo(1), start: '10:00', marks: m(true, true) }) // same lecture again
    await call(TB, 'POST', 'attendance', { division: 'D2B', subject: 'Physics', date: daysAgo(1), start: '11:00', marks: m(false, true) })
    await call(TB, 'POST', 'attendance', { division: 'D2B', subject: 'Physics', date: daysAgo(1), start: '11:00', marks: m(true, true) }) // correction
    const rec = (await call(S1, 'GET', 'my-record')).body.attendance
    assert.equal(rec.total, 3); assert.equal(rec.present, 3); assert.equal(rec.percent, 100)
    assert.equal(rec.history.length, rec.total); assert.ok(rec.rules)
    const sub = Object.fromEntries(rec.bySubject.map((x) => [x.key, x.total])); assert.deepEqual(sub, { Maths: 2, Physics: 1 })
  })
  await t('a student only ever gets their own record (no student id parameter is honoured)', async () => {
    const mine = (await call(S3, 'GET', 'my-record', null, { student: ids[S1], child: ids[S1] })).body
    assert.equal(mine.student.id, ids[S3])
    assert.equal((await call(S3, 'GET', 'parent-record', null, { child: ids[S1] })).status, 404)
    assert.equal((await call(S3, 'GET', 'attendance', null, { division: 'D2B' })).status, 403)
  })

  // ---------- /api/sync privacy ----------
  await t('sync: students get their own attendance mark only, posts for their division, registrations without others’ details', async () => {
    const acc = (s) => `acc_${ids[s]}`
    const items = [
      { c: 'attSessions', id: 'att_1', data: { id: 'att_1', division: 'D2B', records: { [acc(S1)]: 'P', [acc(S3)]: 'A' } } },
      { c: 'posts', id: 'post_b', data: { id: 'post_b', audience: { divisions: ['D2B'] }, title: 'For B' } },
      { c: 'posts', id: 'post_a', data: { id: 'post_a', audience: { divisions: ['D2A'] }, title: 'For A' } },
      { c: 'events', id: 'ev_1', data: { id: 'ev_1', title: 'Fest' } },
    ]
    assert.equal((await syncCall(TB, 'POST', { items })).body.saved, 4)
    await syncCall(S1, 'POST', { items: [{ c: 'registrations', id: 'reg_1', data: { id: 'reg_1', eventId: 'ev_1', userId: acc(S1), userName: 'Student One', status: 'pending', form: { email: E('9100000101'), email: 'x@example.com' } } }] })
    const got = (await syncCall(S3, 'GET')).body.items, by = (id) => got.find((x) => x.id === id)
    assert.deepEqual(by('att_1').data.records, { [acc(S3)]: 'A' })
    assert.ok(by('post_b') && !by('post_a'))
    assert.equal(by('reg_1').data.form, undefined); assert.equal(by('reg_1').data.userName, undefined); assert.equal(by('reg_1').data.eventId, 'ev_1')
    const own = (await syncCall(S1, 'GET')).body.items.find((x) => x.id === 'reg_1'); assert.equal(own.data.form.email, 'x@example.com')
    const staff = (await syncCall(TB, 'GET')).body.items; assert.ok(staff.find((x) => x.id === 'post_a')); assert.equal(Object.keys(staff.find((x) => x.id === 'att_1').data.records).length, 2)
    assert.equal((await syncCall(S3, 'POST', { items: [{ c: 'attSessions', id: 'att_2', data: { id: 'att_2', records: {} } }] })).body.rejected, 1)
  })

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
