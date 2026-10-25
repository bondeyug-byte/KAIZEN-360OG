// Roles v2 (Phases A–F) server tests: real handlers + real Postgres (PGlite) + production-style signed cookies.
// Synthetic numbers only. Run: npm test (in this folder).
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefgh'; process.env.DATABASE_URL = 'postgres://u:p@h.example/db';
process.env.HOD_EMAILS = 'u9100000001@ves.ac.in=CMPN;u9100000002@ves.ac.in=AIDS';
const path = require('path'), fs = require('fs'), crypto = require('crypto'), assert = require('assert');
const API = process.env.API_DIR || path.join(__dirname, '../../api');
const { PGlite } = require('@electric-sql/pglite');
const db = require(API + '/_db'); const app = require(API + '/app'); const MIG = require(API + '/_migrations');
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
const HOD_CS = '9100000001', HOD_AI = '9100000002', T1 = '9100000011', T2 = '9100000021', TAI = '9100000012';
const S1 = '9100000101', S2 = '9100000102', S3 = '9100000103', S4 = '9100000104', S5 = '9100000105';
const me = async (n) => (await call(n, 'GET', 'me')).body;
(async () => {
  const pg = new PGlite(); const run = (x, p) => pg.query(x, p).then((r) => r.rows); db._setClient(run);
  // ---- Phase A: start from OLD (v2) data, then let the app migrate ----
  await run('create table schema_migrations (id int primary key, name text not null, applied_at timestamptz not null default now())');
  for (const m of MIG.slice(0, 2)) { for (const s of m.up) await run(s); await run('insert into schema_migrations (id, name) values ($1, $2)', [m.id, m.name]); }
  const [old] = await run(`insert into accounts (phone, name) values ('+919100000199', 'Old Student') returning id`);
  await run(`insert into enrollments (account_id, division_code, status) values ($1, 'D2A', 'approved')`, [old.id]);
  await run(`insert into account_roles (account_id, role, scope) values ($1, 'cr', 'D2A')`, [old.id]);
  await run(`insert into teacher_whitelist (phone, name, teaches) values ('+919100000031', 'Old Teacher', '[{"division":"D5A","subject":"CP"}]')`);
  await t('migration 3 copies old data (enrollment, class rep, teacher divisions) without touching old tables', async () => {
    await db.ensureSchema();
    assert.equal((await run(`select count(*)::int n from class_enrollments where student_id = $1 and division_code = 'D2A' and status = 'active'`, [old.id]))[0].n, 1);
    assert.equal((await run(`select count(*)::int n from cr_assignments where student_id = $1 and active`, [old.id]))[0].n, 1);
    assert.equal((await run(`select branch_code from teacher_whitelist where phone = '+919100000031'`))[0].branch_code, 'INFT');
    assert.equal((await run(`select count(*)::int n from enrollments`))[0].n, 1); // old table untouched
    assert.equal((await run(`select count(*)::int n from schema_migrations`))[0].n, MIG.length);
  });
  await t('catalog: all six branches, FE year and 12 divisions from the database', async () => {
    const c = (await call(S1, 'GET', 'catalog')).body;
    assert.equal(c.branches.length, 6); assert.equal(c.years[0].label, 'FE'); assert.equal(c.divisions.length, 12);
    assert.ok(c.divisions.every((d) => d.branch_code && d.year_id));
  });
  await t('HOD comes only from HOD_EMAILS; outranks teacher', async () => {
    assert.equal((await me(HOD_CS)).role, 'hod'); assert.deepEqual((await me(HOD_CS)).hod.branches, ['CMPN']);
    assert.equal((await call(HOD_CS, 'POST', 'teachers', { email: E(HOD_AI), name: 'AI Head', branch: 'CMPN' })).body.code, 'IS_HOD');
  });
  // (Google sign-in) teachers come only from their HOD; there is no teacher list in the settings
  await t('a college account is a student until the HOD adds it as a teacher', async () => {
    assert.equal((await me(T2)).role, 'student')
    await call(HOD_CS, 'POST', 'teachers', { email: E(T2), name: 'Env Teacher' }); await call(HOD_CS, 'POST', 'teacher-division', { email: E(T2), division: 'D2B', subject: 'Maths' })
    const m = await me(T2); assert.equal(m.role, 'teacher'); assert.deepEqual(m.teacher.divisions, ['D2B'])
  });
  await t('HOD can only add college (@ves.ac.in) accounts as teachers', async () => {
    for (const e of ['prof@gmail.com', 'prof@ves.ac.in.example.com', 'prof@x.ves.ac.in', 'not-an-email']) assert.equal((await call(HOD_CS, 'POST', 'teachers', { email: e, name: 'X Y' })).body.code, 'INVALID_EMAIL', e)
  });
  // ---- HOD manages teachers ----
  await t('HOD adds and assigns teachers only within the branch', async () => {
    assert.equal((await call(HOD_CS, 'POST', 'teachers', { email: '  U9100000011@VES.AC.IN ', name: 'Prof. One', code: 'KD' })).status, 200);
    assert.equal((await call(HOD_CS, 'POST', 'teacher-division', { email: E(T1), division: 'D2A', subject: 'Maths' })).status, 200);
    assert.equal((await call(HOD_CS, 'POST', 'teacher-division', { email: E(T1), division: 'D1ADA', subject: 'Maths' })).status, 403);
    assert.equal((await call(HOD_CS, 'POST', 'teachers', { email: E(TAI), name: 'Prof AI', branch: 'AIDS' })).status, 403);
    assert.equal((await call(HOD_AI, 'POST', 'teachers', { email: E(TAI), name: 'Prof AI' })).status, 200);
    assert.equal((await call(HOD_AI, 'POST', 'teacher-division', { email: E(TAI), division: 'D1ADA', subject: 'Maths' })).status, 200);
    const list = (await call(HOD_CS, 'GET', 'teachers')).body.teachers.map((x) => x.name);
    assert.ok(list.includes('Prof. One') && !list.includes('Prof AI'));
  });
  await t('teachers, students and other-branch HODs cannot manage teachers', async () => {
    assert.equal((await call(T1, 'POST', 'teachers', { email: E('9100000055'), name: 'X Y' })).status, 403);
    assert.equal((await call(S1, 'GET', 'teachers')).status, 403);
    assert.equal((await call(HOD_AI, 'POST', 'teacher-status', { email: E(T1), active: false })).status, 403);
  });
  // ---- F1 join flow ----
  let r1;
  await t('student requests to join; duplicate, cancel and re-request', async () => {
    r1 = (await call(S1, 'POST', 'join-requests', { division: 'D2A' })).body.joinRequest.id;
    assert.equal((await call(S1, 'POST', 'join-requests', { division: 'D2B' })).body.code, 'PENDING_EXISTS');
    assert.equal((await call(S1, 'DELETE', 'join-requests', null, { id: r1 })).status, 200);
    r1 = (await call(S1, 'POST', 'join-requests', { division: 'D2A' })).body.joinRequest.id;
    assert.equal((await me(S1)).joinRequest.status, 'pending');
    assert.match((await call(S1, 'GET', 'timetable')).body.message, /Join a class/);
  });
  await t('teacher/HOD numbers cannot join as students', async () => assert.equal((await call(T1, 'POST', 'join-requests', { division: 'D2A' })).status, 403));
  await t('teacher sees requests only for assigned divisions', async () => {
    const l = (await call(T1, 'GET', 'join-requests')).body; assert.equal(l.requests.length, 1); assert.equal(l.pendingTotal, 1); assert.match(l.requests[0].contact, /^u9•••@ves\.ac\.in$/); // masked for teachers
    assert.equal((await call(T2, 'GET', 'join-requests', null, { division: 'D2A' })).status, 403);
    assert.equal((await call(T2, 'POST', 'join-decision', { ids: [r1], decision: 'approve' })).body.results[0].ok, false);
    assert.equal((await call(HOD_AI, 'POST', 'join-decision', { ids: [r1], decision: 'approve' })).body.results[0].ok, false);
  });
  await t('two approvers at the same moment: exactly one wins, one enrollment', async () => {
    const [a, b] = await Promise.all([call(T1, 'POST', 'join-decision', { ids: [r1], decision: 'approve' }), call(HOD_CS, 'POST', 'join-decision', { ids: [r1], decision: 'approve' })]);
    assert.equal([a, b].filter((x) => x.body.results[0].ok).length, 1, JSON.stringify([a.body, b.body]));
    assert.equal((await run(`select count(*)::int n from class_enrollments e join accounts a on a.id = e.student_id where a.phone = 'u9100000101@ves.ac.in' and e.status = 'active'`))[0].n, 1);
    assert.equal((await me(S1)).enrollment.division_code, 'D2A');
    const again = (await call(T1, 'POST', 'join-decision', { ids: [r1], decision: 'approve' })).body.results[0]; assert.match(again.error, /Already approved/);
  });
  // changed in the 2026-10 audit: an enrolled student may ask to CHANGE division, but only with a reason (see transfer.test.cjs)
  await t('enrolled student cannot silently join another class (a change needs a reason and approval)', async () => assert.equal((await call(S1, 'POST', 'join-requests', { division: 'D2B' })).body.code, 'REASON_REQUIRED'));
  await t('division capacity enforced (setting)', async () => {
    await run(`update settings set value = '2' where key = 'division_capacity'`); // D2A already has 2 (old student + S1)
    assert.equal((await call(S4, 'POST', 'join-requests', { division: 'D2A' })).body.code, 'DIVISION_FULL');
    await run(`update settings set value = '65' where key = 'division_capacity'`);
  });
  await t('rejected → re-request a different division', async () => {
    const id = (await call(S4, 'POST', 'join-requests', { division: 'D2A' })).body.joinRequest.id;
    assert.equal((await call(T1, 'POST', 'join-decision', { ids: [id], decision: 'reject', note: 'Wrong class' })).body.results[0].ok, true);
    assert.equal((await me(S4)).joinRequest.note, 'Wrong class');
    assert.equal((await call(S4, 'POST', 'join-requests', { division: 'D2B' })).status, 200);
  });
  // ---- F2 class reps ----
  let cr1;
  await t('CR request: other-division teacher cannot decide; assigned teacher approves', async () => {
    cr1 = (await call(S1, 'POST', 'cr-requests')).body.crRequest.id;
    assert.equal((await call(T2, 'POST', 'cr-decision', { id: cr1, decision: 'approve' })).status, 403);
    assert.equal((await call(S2, 'POST', 'cr-decision', { id: cr1, decision: 'approve' })).status, 403);
    assert.equal((await call(T1, 'POST', 'cr-decision', { id: cr1, decision: 'approve' })).status, 200);
    assert.deepEqual((await me(S1)).cr, ['D2A']);
  });
  await t('max class reps per division (2) enforced', async () => {
    // old student is CR #1 (copied), S1 is CR #2
    const s5 = await call(S5, 'POST', 'join-requests', { division: 'D2A' }); await call(HOD_CS, 'POST', 'join-decision', { ids: [s5.body.joinRequest.id], decision: 'approve' });
    assert.equal((await call(S5, 'POST', 'cr-requests')).body.code, 'CR_FULL');
  });
  let s2req;
  await t('CR approves a join request for their class; sees no contact details', async () => {
    s2req = (await call(S2, 'POST', 'join-requests', { division: 'D2A' })).body.joinRequest.id;
    const l = (await call(S1, 'GET', 'join-requests')).body.requests; assert.ok(l.every((x) => x.contact === undefined && x.division_code === 'D2A'));
    assert.equal((await call(S1, 'POST', 'join-decision', { ids: [s2req], decision: 'approve' })).body.results[0].ok, true);
    const ro = (await call(S1, 'GET', 'roster', null, { division: 'D2A' })).body.students; assert.ok(ro.length >= 3 && ro.every((x) => x.contact === undefined));
  });
  await t('CR cannot act on another division, post files, publish timetables or decide CR requests', async () => {
    const id = (await call(S3, 'POST', 'join-requests', { division: 'D1ADA' })).body.joinRequest.id;
    assert.equal((await call(S1, 'POST', 'join-decision', { ids: [id], decision: 'approve' })).body.results[0].ok, false);
    assert.equal((await call(S1, 'GET', 'join-requests', null, { division: 'D1ADA' })).status, 403);
    assert.equal((await call(S1, 'POST', 'posts', { kind: 'announcement', title: 'Hello D2B', divisions: ['D2B'] })).status, 403);
    assert.equal((await call(S1, 'POST', 'posts', { kind: 'material', title: 'Notes', divisions: ['D2A'], file: { name: 'a.pdf', mime: 'application/pdf', dataBase64: 'JVBERg==' } })).status, 403);
    assert.equal((await call(S1, 'POST', 'timetable-preview', { term: 'FE x', fileName: 'a.xlsx', sheets: [] })).status, 403);
    assert.equal((await call(S1, 'GET', 'cr-requests')).status, 403);
    assert.equal((await call(S1, 'POST', 'cr-assign', { studentId: (await me(S2)).account.id, division: 'D2A' })).status, 403);
    await call(HOD_AI, 'POST', 'join-decision', { ids: [id], decision: 'approve' });
  });
  await t('CR posts a notice and a reminder; classmates see them, other classes do not', async () => {
    assert.equal((await call(S1, 'POST', 'posts', { kind: 'announcement', title: 'Bring lab coats', divisions: ['D2A'] })).status, 200);
    assert.equal((await call(S1, 'POST', 'reminders', { division: 'D2A', title: 'Assignment due', remindAt: new Date(Date.now() + 86400000).toISOString() })).status, 200);
    const f = (await call(S2, 'GET', 'feed')).body; assert.ok(f.posts.some((p) => p.title === 'Bring lab coats' && p.author_role === 'cr'));
    assert.equal((await call(S2, 'GET', 'reminders')).body.reminders[0].title, 'Assignment due');
    assert.equal((await call(S3, 'GET', 'feed')).body.posts.length, 0); assert.equal((await call(S3, 'GET', 'reminders')).body.reminders.length, 0);
    assert.equal((await call(S3, 'GET', 'feed', null, { division: 'D2A' })).body.division, 'D1ADA'); // tampered parameter ignored
  });
  await t('HOD removes the CR; the CR tools stop working on the next request', async () => {
    assert.equal((await call(HOD_CS, 'POST', 'cr-assign', { studentId: (await me(S1)).account.id, division: 'D2A', action: 'remove' })).status, 200);
    assert.deepEqual((await me(S1)).cr, []); assert.equal((await call(S1, 'GET', 'join-requests')).status, 403);
    assert.equal((await call(S1, 'POST', 'posts', { kind: 'announcement', title: 'Still CR?', divisions: ['D2A'] })).status, 403);
  });
  await t('HOD assigns a CR directly (path 2); other-branch HOD cannot', async () => {
    const sid = (await me(S1)).account.id;
    assert.equal((await call(HOD_AI, 'POST', 'cr-assign', { studentId: sid, division: 'D2A' })).status, 403);
    assert.equal((await call(HOD_CS, 'POST', 'cr-assign', { studentId: sid, division: 'D2A' })).status, 200);
  });
  await t('HOD override: approve a rejected request; revoke an enrollment', async () => {
    const s4 = (await me(S4)).account.id; const id = (await run(`select id from join_requests where student_id = $1 and division_code = 'D2A'`, [s4]))[0].id;
    await call(S4, 'DELETE', 'join-requests', null, { id: (await me(S4)).joinRequest.id }); // cancel D2B request
    assert.equal((await call(T1, 'POST', 'join-decision', { ids: [id], decision: 'approve' })).body.results[0].ok, false); // teacher can't override
    assert.equal((await call(HOD_CS, 'POST', 'join-decision', { ids: [id], decision: 'approve' })).body.results[0].ok, true);
    assert.equal((await call(HOD_CS, 'POST', 'enrollment-revoke', { studentId: s4, division: 'D2A' })).status, 200);
    assert.equal((await me(S4)).enrollment, null);
  });
  // ---- posts from teachers, F5 targets ----
  await t('teacher posts only to assigned divisions; whole request rejected otherwise', async () => {
    const bad = await call(T1, 'POST', 'posts', { kind: 'announcement', title: 'Test', divisions: ['D2A', 'D2B'] }); assert.equal(bad.status, 403); assert.match(bad.body.error, /D2B/);
    assert.equal((await run(`select count(*)::int n from posts where title = 'Test'`))[0].n, 0);
    assert.equal((await call(T1, 'POST', 'posts', { kind: 'announcement', title: 'Unit test Monday', divisions: ['D2A'] })).status, 200);
  });
  await t('HOD posts to any division of their branch, not another branch', async () => {
    assert.equal((await call(HOD_CS, 'POST', 'posts', { kind: 'announcement', title: 'CS notice', divisions: ['D2A', 'D2B', 'D2C'] })).status, 200);
    assert.equal((await call(HOD_CS, 'POST', 'posts', { kind: 'announcement', title: 'Cross', divisions: ['D2A', 'D1ADA'] })).status, 403);
  });
  // ---- instructions ----
  await t('HOD instruction → teacher marks seen/done → HOD sees status', async () => {
    assert.equal((await call(HOD_CS, 'POST', 'instructions', { title: 'Submit marks', body: 'By Friday', dueDate: '2026-10-30', teachers: 'all' })).status, 200);
    assert.equal((await call(HOD_CS, 'POST', 'instructions', { title: 'Wrong', teachers: [TAI] })).status, 403);
    const got = (await call(T1, 'GET', 'instructions')).body.received; assert.equal(got[0].title, 'Submit marks');
    assert.equal((await me(T1)).counts.openInstructions, 1);
    assert.equal((await call(T1, 'POST', 'instruction-status', { id: got[0].id, status: 'seen' })).status, 200);
    const sent = (await call(HOD_CS, 'GET', 'instructions')).body.sent[0].recipients; assert.ok(sent.some((r) => r.name === 'Prof. One' && r.status === 'seen'));
    assert.equal((await call(TAI, 'GET', 'instructions')).body.received.length, 0);
  });
  // ---- teacher removed while logged in ----
  await t('teacher deactivated mid-session: next request is refused; reactivation restores', async () => {
    assert.equal((await call(HOD_CS, 'POST', 'teacher-status', { email: E(T1), active: false })).status, 200);
    assert.equal((await me(T1)).role, 'student');
    assert.equal((await call(T1, 'POST', 'posts', { kind: 'announcement', title: 'After removal', divisions: ['D2A'] })).status, 403);
    assert.equal((await call(T1, 'GET', 'join-requests')).status, 403);
    await call(HOD_CS, 'POST', 'teacher-status', { email: E(T1), active: true }); assert.equal((await me(T1)).role, 'teacher');
  });
  // ---- F4 timetable ----
  const fe = process.env.FE_JSON || path.join(__dirname, 'fe_sheets.json');
  const sheets = fs.existsSync(fe) ? JSON.parse(fs.readFileSync(fe, 'utf8')) : [{ name: 'Timetable', rows: [['Division', 'Day', 'Start', 'End', 'Subject', 'Teacher'], ['D2A', 'Monday', '08:30', '09:30', 'M1', 'KD'], ['D1ADA', 'Monday', '08:30', '09:30', 'M1', 'AD']] }];
  await t('teacher uploading a multi-division file must choose "only my divisions" (nothing silent)', async () => {
    const r = (await call(T1, 'POST', 'timetable-preview', { term: 'FE 2026-27 Sem I', fileName: 'fe.xlsx', sheets })).body;
    assert.equal(r.ok, false); assert.equal(r.canFilter, true); assert.ok(r.notAllowed.includes('D1ADA'));
    const r2 = (await call(T1, 'POST', 'timetable-preview', { term: 'FE 2026-27 Sem I', fileName: 'fe.xlsx', sheets, onlyMine: true })).body;
    assert.equal(r2.ok, true, JSON.stringify(r2.errors)); assert.deepEqual(r2.divisions, ['D2A']); assert.match(r2.warnings[0].message, /Not included/);
    assert.equal((await call(T1, 'POST', 'timetable-publish', { versionId: r2.versionId })).status, 200);
  });
  await t('student sees own division only; another division sees nothing; staff need permission', async () => {
    const a = (await call(S2, 'GET', 'timetable')).body; assert.equal(a.division, 'D2A'); assert.ok(a.entries.length > 0);
    assert.match((await call(S3, 'GET', 'timetable')).body.message, /No timetable published yet/);
    assert.equal((await call(S3, 'GET', 'timetable', null, { division: 'D2A' })).body.division, 'D1ADA');
    assert.equal((await call(T1, 'GET', 'timetable', null, { division: 'D1ADA' })).status, 403);
  });
  await t('student who joins AFTER publishing also sees it', async () => {
    const id = (await call('9100000106', 'POST', 'join-requests', { division: 'D2A' })).body.joinRequest.id;
    await call(T1, 'POST', 'join-decision', { ids: [id], decision: 'approve' });
    assert.ok((await call('9100000106', 'GET', 'timetable')).body.entries.length > 0);
  });
  await t('HOD of AIDS publishes only AIDS divisions; CS HOD cannot restore it', async () => {
    const r = (await call(HOD_AI, 'POST', 'timetable-preview', { term: 'FE 2026-27 Sem I', fileName: 'fe.xlsx', sheets, onlyMine: true })).body;
    assert.ok(r.ok && r.divisions.every((d) => d.startsWith('D1AD')), JSON.stringify(r.divisions));
    await call(HOD_AI, 'POST', 'timetable-publish', { versionId: r.versionId });
    assert.ok((await call(S3, 'GET', 'timetable')).body.entries.length > 0);
    assert.equal((await call(HOD_CS, 'POST', 'timetable-rollback', { versionId: r.versionId })).status, 403);
  });
  // ---- audit & summary ----
  await t('audit log and dashboard are branch-scoped', async () => {
    const cs = (await call(HOD_CS, 'GET', 'audit')).body.entries; const ai = (await call(HOD_AI, 'GET', 'audit')).body.entries;
    assert.ok(cs.every((e) => e.branch_code === 'CMPN') && ai.every((e) => e.branch_code === 'AIDS'));
    for (const a of ['join.approve', 'join.reject', 'cr.approve', 'cr.remove', 'cr.assign', 'enrollment.revoke', 'teacher.add', 'instruction.send', 'timetable.publish', 'post.create']) assert.ok(cs.some((e) => e.action === a), a);
    const s = (await call(HOD_CS, 'GET', 'hod-summary')).body; assert.ok(s.divisions.every((d) => d.branch_code === 'CMPN')); assert.equal(s.capacity, 65);
    assert.equal((await call(T1, 'GET', 'audit')).status, 403); assert.equal((await call(S1, 'GET', 'hod-summary')).status, 403);
  });
  await t('red team: forged cookie, unknown division, garbage ids, oversized batch', async () => {
    const forged = await new Promise((ok) => app({ method: 'GET', query: { route: 'me' }, headers: { cookie: 'mm_phone=%2B919100000001.' + 'f'.repeat(32) } }, { setHeader() {}, status(c) { this.c = c; return this; }, json() { ok(this.c); } }));
    assert.equal(forged, 401);
    assert.equal((await call(S3, 'POST', 'join-requests', { division: "D2A'; drop table accounts;--" })).status, 400);
    assert.equal((await call(HOD_CS, 'POST', 'join-decision', { ids: ['nope'], decision: 'approve' })).status, 400);
    assert.equal((await call(HOD_CS, 'POST', 'join-decision', { ids: Array.from({ length: 51 }, () => crypto.randomUUID()), decision: 'approve' })).status, 400);
    assert.equal((await call(S2, 'PUT', 'me', { baseVersion: 0, profile: { name: 'x', role: 'hod', hod: { branches: ['CMPN'] } } })).status, 200);
    assert.equal((await me(S2)).role, 'student');
  });
  console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})();
