// Portal upgrade (migration 7) tests: real handlers, real Postgres (PGlite), signed cookies.
// Roles covered: Student, Teacher, HOD, Event head, Club member, CR, SI, CI, Parent. Synthetic identities only.
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefgh'; process.env.DATABASE_URL = 'postgres://u:p@h.example/db';
process.env.HOD_EMAILS = 'u9100000001@ves.ac.in=CMPN;u9100000002@ves.ac.in=AIDS';
const path = require('path'), assert = require('assert');
const API = process.env.API_DIR || path.join(__dirname, '../../api');
const { PGlite } = require('@electric-sql/pglite');
const db = require(API + '/_db'); const app = require(API + '/app');
const { sessionCookie } = require(API + '/_session');
const E = (n) => (String(n).includes('@') ? String(n) : /^91000002/.test(String(n)) ? `p${n}@gmail.com` : `u${n}@ves.ac.in`);
const C = (n) => sessionCookie(E(n)).split(';')[0];
const mkRes = (ok) => ({ h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; }, json(b) { ok({ status: this.c, body: b, h: this.h }); }, end(buf) { ok({ status: this.c, raw: buf, h: this.h }); } });
const call = (who, method, route, body, query = {}) => new Promise((ok) => app({ method, query: { ...query, route }, url: '/api/app/' + route, headers: { cookie: C(who), 'x-forwarded-for': '10.0.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250) }, body }, mkRes(ok)));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '→', e.message); } };
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const code = (r) => r.body && r.body.code;
const HOD = '9100000001', HOD_AI = '9100000002', TA = '9100000011', TB = '9100000012';
const S1 = '9100000101', S2 = '9100000102', S3 = '9100000103', S4 = '9100000104', S5 = '9100000105', SB = '9100000106', SAI = '9100000107', FRESH = '9100000108';
const PARENT = '9100000201';
const IST = (ms) => new Date(Date.now() + ms + 5.5 * 3600000).toISOString().slice(0, 10);
const DAY = 86400000;
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');

(async () => {
  const pg = new PGlite(); const run = (x, p) => pg.query(x, p).then((r) => r.rows); db._setClient(run);
  await db.ensureSchema();
  ok(await call(HOD, 'POST', 'teachers', { email: E(TA), name: 'Prof A' })); ok(await call(HOD, 'POST', 'teacher-division', { email: E(TA), division: 'D2A', subject: 'Maths' }))
  ok(await call(HOD, 'POST', 'teachers', { email: E(TB), name: 'Prof B' })); ok(await call(HOD, 'POST', 'teacher-division', { email: E(TB), division: 'D2B', subject: 'Physics' }))
  const ids = {}
  for (const [s, d] of [[S1, 'D2A'], [S2, 'D2A'], [S3, 'D2A'], [S4, 'D2A'], [S5, 'D2A'], [SB, 'D2B'], [SAI, 'D1ADA']]) {
    const r = ok(await call(s, 'POST', 'join-requests', { division: d }));
    ok(await call(d === 'D1ADA' ? HOD_AI : HOD, 'POST', 'join-decision', { ids: [r.joinRequest.id], decision: 'approve' }))
    ids[s] = ok(await call(s, 'GET', 'me')).account.id
  }

  /* ---------- migration ---------- */
  await t('migration 7 is applied and additive: years 2-4 exist with NO invented divisions; old rows unchanged', async () => {
    assert.equal((await run(`select count(*)::int as n from schema_migrations where id = 7`))[0].n, 1)
    assert.deepEqual((await run(`select id from academic_years order by level`)).map((r) => r.id), ['FE-2026-27', 'SE-2026-27', 'TE-2026-27', 'BE-2026-27'])
    assert.equal((await run(`select count(*)::int as n from divisions where year_id <> 'FE-2026-27'`))[0].n, 0)
    assert.equal((await run(`select count(*)::int as n from divisions`))[0].n, 12)
  })

  /* ---------- student profile set-up ---------- */
  await t('student set-up: required, validated on the server, and editable', async () => {
    const g = ok(await call(FRESH, 'GET', 'setup')); assert.equal(g.done, false); assert.equal(g.fixed.email, E(FRESH))
    assert.equal(ok(await call(FRESH, 'GET', 'me')).setupDone, false)
    const base = { name: 'Fresh Student', gender: 'female', mobile: '98765 43210', yearLevel: 1, branch: 'CMPN', roll: '24-101' }
    assert.equal(code(await call(FRESH, 'PUT', 'setup', { ...base, name: 'x' })), 'INVALID_NAME')
    assert.equal(code(await call(FRESH, 'PUT', 'setup', { ...base, gender: 'robot' })), 'INVALID_GENDER')
    assert.equal(code(await call(FRESH, 'PUT', 'setup', { ...base, mobile: '12345' })), 'INVALID_MOBILE')
    assert.equal(code(await call(FRESH, 'PUT', 'setup', { ...base, yearLevel: 5 })), 'INVALID_YEAR')
    assert.equal(code(await call(FRESH, 'PUT', 'setup', { ...base, branch: 'XYZ' })), 'INVALID_BRANCH')
    assert.equal(code(await call(FRESH, 'PUT', 'setup', { ...base, roll: '<b>' })), 'INVALID_ROLL')
    const r = ok(await call(FRESH, 'PUT', 'setup', base)); assert.equal(r.setup.mobile, '+919876543210'); assert.equal(r.setup.gender, 'female')
    const me = ok(await call(FRESH, 'GET', 'me')); assert.equal(me.setupDone, true); assert.equal(me.account.name, 'Fresh Student'); assert.equal(me.profile.roll, '24-101')
    ok(await call(FRESH, 'PUT', 'setup', { ...base, gender: 'prefer_not_to_say' }))
    assert.equal(ok(await call(FRESH, 'GET', 'setup')).setup.gender, 'prefer_not_to_say')
  })
  await t('profile edits never grant roles; the synced profile cannot change set-up or roles', async () => {
    const me = ok(await call(FRESH, 'GET', 'me'))
    ok(await call(FRESH, 'PUT', 'me', { profile: { name: 'Fresh', role: 'hod', teaches: [{ division: 'D2A' }], setup: { branch: 'AIDS' } }, data: {}, baseVersion: me.version }))
    const after = ok(await call(FRESH, 'GET', 'me')); assert.equal(after.role, 'student'); assert.equal(after.setup.branch, 'CMPN'); assert.equal(after.profile.role, undefined)
  })
  await t('an enrolled student cannot use the profile to override the verified class (division change instead)', async () => {
    assert.equal(code(await call(S1, 'PUT', 'setup', { name: 'Student One', gender: 'male', mobile: '9876543211', yearLevel: 1, branch: 'AIDS', roll: '1' })), 'CLASS_MISMATCH')
    assert.equal(code(await call(S1, 'PUT', 'setup', { name: 'Student One', gender: 'male', mobile: '9876543211', yearLevel: 2, branch: 'CMPN', roll: '1' })), 'CLASS_MISMATCH')
    ok(await call(S1, 'PUT', 'setup', { name: 'Student One', gender: 'male', mobile: '9876543211', yearLevel: 1, branch: 'CMPN', roll: '1' }))
  })
  await t('teacher and HOD set-up: confirm details; identity, branch and classes stay as assigned', async () => {
    const g = ok(await call(TA, 'GET', 'setup')); assert.deepEqual(g.fixed.teaches, [{ division: 'D2A', subject: 'Maths' }])
    assert.equal(code(await call(TA, 'PUT', 'setup', { name: 'Prof A', mobile: '9876500001' })), 'CONFIRM_REQUIRED')
    ok(await call(TA, 'PUT', 'setup', { name: 'Prof. A. Kumar', mobile: '9876500001', confirm: true, teaches: [{ division: 'D2B' }], role: 'hod' }))
    const me = ok(await call(TA, 'GET', 'me')); assert.equal(me.role, 'teacher'); assert.deepEqual(me.teacher.divisions, ['D2A'])
    const h = ok(await call(HOD, 'GET', 'setup')); assert.deepEqual(h.fixed.branches, ['CMPN'])
    ok(await call(HOD, 'PUT', 'setup', { name: 'HOD CMPN', mobile: '9876500002', confirm: true }))
    assert.equal(code(await call(PARENT, 'PUT', 'setup', { name: 'P' })), 'NO_ACCESS') // not yet a confirmed parent: no access at all
  })

  /* ---------- publishing ---------- */
  let asg, draft, exam
  await t('teacher publishes an assignment to own class; validation errors are clear', async () => {
    assert.equal(code(await call(TA, 'POST', 'publish', { kind: 'essay', title: 'x', divisions: ['D2A'] })), 'INVALID_KIND')
    assert.equal(code(await call(TA, 'POST', 'publish', { kind: 'assignment', title: 'Sheet 1', divisions: ['D2A'] })), 'SUBJECT_REQUIRED')
    assert.equal(code(await call(TA, 'POST', 'publish', { kind: 'exam', title: 'Unit test', subject: 'Maths', divisions: ['D2A'] })), 'DATE_REQUIRED')
    assert.equal(code(await call(TA, 'POST', 'publish', { kind: 'assignment', title: 'Sheet 1', subject: 'Maths', divisions: ['D2A'], dueAt: new Date(Date.now() - 3 * DAY).toISOString() })), 'INVALID_DEADLINE')
    assert.equal(code(await call(TA, 'POST', 'publish', { kind: 'assignment', title: 'Sheet 1', subject: 'Maths', divisions: [] })), 'NO_TARGETS')
    const r = ok(await call(TA, 'POST', 'publish', { kind: 'assignment', title: 'Sheet 1', subject: 'Maths', body: 'Q1-Q5', divisions: ['D2A'], dueAt: new Date(Date.now() + 3 * DAY).toISOString() }))
    asg = r.item.id; assert.equal(r.item.status, 'published')
  })
  await t('nothing is published to classes outside the teacher’s assignment, and nothing college-wide', async () => {
    const r = await call(TA, 'POST', 'publish', { kind: 'notice', title: 'Notice', divisions: ['D2A', 'D2B'] })
    assert.equal(r.status, 403); assert.match(r.body.error, /D2B/)
    assert.equal((await run(`select count(*)::int as n from posts where title = 'Notice'`))[0].n, 0)
    assert.equal((await call(S1, 'POST', 'publish', { kind: 'assignment', title: 'Fake work', subject: 'Maths', divisions: ['D2A'] })).status, 403)
  })
  await t('drafts and scheduled items are invisible to students until published; the HOD can publish to several divisions', async () => {
    draft = ok(await call(TA, 'POST', 'publish', { kind: 'material', title: 'Notes', subject: 'Maths', divisions: ['D2A'], draft: true, file: { name: 'n.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-1').toString('base64') } })).item.id
    const sched = ok(await call(TA, 'POST', 'publish', { kind: 'announcement', title: 'Later', divisions: ['D2A'], publishAt: new Date(Date.now() + 2 * DAY).toISOString() })).item.id
    exam = ok(await call(HOD, 'POST', 'publish', { kind: 'exam', title: 'Mid-sem exam', subject: 'Maths', divisions: ['D2A', 'D2B'], eventDate: IST(10 * DAY) })).item.id
    const items = ok(await call(S1, 'GET', 'class-items')).items.map((i) => i.id)
    assert.ok(items.includes(asg) && items.includes(exam)); assert.ok(!items.includes(draft) && !items.includes(sched))
    assert.ok(!ok(await call(S1, 'GET', 'feed')).posts.some((p) => p.id === draft || p.id === sched))
    assert.ok(!ok(await call(S1, 'GET', 'my-record')).notices.some((p) => p.id === draft))
    const fileId = (await run(`select file_id from posts where id = $1`, [draft]))[0].file_id
    assert.equal((await call(S1, 'GET', 'file', null, { id: fileId })).status, 404) // a draft's attachment is not downloadable
    ok(await call(TA, 'POST', 'publish-status', { id: draft, status: 'published' }))
    assert.ok(ok(await call(S1, 'GET', 'class-items')).items.some((i) => i.id === draft))
    assert.equal((await call(S1, 'GET', 'file', null, { id: fileId })).status, 200)
    assert.ok(!ok(await call(SB, 'GET', 'class-items')).items.some((i) => i.id === draft)) // other class
  })
  await t('edits and cancellations propagate; students can’t edit; other teachers can’t change it', async () => {
    ok(await call(TA, 'POST', 'publish', { id: asg, kind: 'assignment', title: 'Sheet 1 (revised)', subject: 'Maths', divisions: ['D2A'], dueAt: new Date(Date.now() + 4 * DAY).toISOString() }))
    assert.equal(ok(await call(S1, 'GET', 'class-items')).items.find((i) => i.id === asg).title, 'Sheet 1 (revised)')
    assert.equal((await call(TB, 'POST', 'publish-status', { id: asg, status: 'cancelled' })).status, 404)
    assert.equal((await call(S1, 'POST', 'publish-status', { id: asg, status: 'cancelled' })).status, 404)
    assert.equal((await call(S1, 'POST', 'publish', { id: asg, kind: 'assignment', title: 'mine', subject: 'Maths', divisions: ['D2A'] })).status, 403)
    const c = ok(await call(TA, 'POST', 'publish', { kind: 'notice', title: 'Trip notice', divisions: ['D2A'] })).item.id
    ok(await call(TA, 'POST', 'publish-status', { id: c, status: 'cancelled' }))
    assert.equal(ok(await call(S1, 'GET', 'class-items')).items.find((i) => i.id === c).status, 'cancelled')
    ok(await call(TA, 'POST', 'publish-status', { id: c, status: 'archived' }))
    assert.ok(!ok(await call(S1, 'GET', 'class-items')).items.some((i) => i.id === c))
    assert.equal(code(await call(TA, 'POST', 'publish-status', { id: c, status: 'cancelled' })), 'INVALID_TRANSITION')
    assert.ok(ok(await call(TA, 'GET', 'published')).items.some((i) => i.id === c && i.status === 'archived'))
  })

  /* ---------- hand-in ---------- */
  await t('students hand in assignments; teachers see who submitted; other classes and students can’t', async () => {
    assert.equal(code(await call(S1, 'POST', 'submissions', { postId: asg })), 'EMPTY_SUBMISSION')
    assert.equal((await call(SB, 'POST', 'submissions', { postId: asg, note: 'hi' })).status, 404)
    const s = ok(await call(S1, 'POST', 'submissions', { postId: asg, note: 'Done', file: { name: 'a.pdf', mime: 'application/pdf', dataBase64: Buffer.from('%PDF-2').toString('base64') } }))
    assert.equal(s.submission.late, false)
    assert.ok(ok(await call(S1, 'GET', 'class-items')).items.find((i) => i.id === asg).submission)
    const list = ok(await call(TA, 'GET', 'submissions', null, { postId: asg }))
    assert.equal(list.counts.submitted, 1); assert.equal(list.counts.total, 5); assert.equal(list.students.find((x) => x.student_id === ids[S1]).state, 'on_time')
    assert.equal((await call(TB, 'GET', 'submissions', null, { postId: asg })).status, 404)
    assert.equal((await call(S2, 'GET', 'submissions', null, { postId: asg })).status, 404)
    const fid = (await run(`select file_id from assignment_submissions where student_id = $1`, [ids[S1]]))[0].file_id
    assert.equal((await call(S2, 'GET', 'file', null, { id: fid })).status, 404) // a classmate can't download it
    assert.equal((await call(TA, 'GET', 'file', null, { id: fid })).status, 200)
    ok(await call(S1, 'DELETE', 'submissions', null, { postId: asg }))
    assert.equal(ok(await call(TA, 'GET', 'submissions', null, { postId: asg })).counts.submitted, 0)
    ok(await call(S1, 'POST', 'submissions', { postId: asg, note: 'Again' }))
  })

  /* ---------- calendar ---------- */
  await t('calendar: real dates only, in IST, no duplicates, scoped to the class', async () => {
    ok(await call(TA, 'POST', 'reminders', { division: 'D2A', title: 'Bring calculators', remindAt: new Date(Date.now() + 5 * DAY).toISOString() }))
    const cal = ok(await call(S1, 'GET', 'calendar', null, { from: IST(0), to: IST(30 * DAY) }))
    const examItems = cal.items.filter((i) => i.refId === exam); assert.equal(examItems.length, 1); assert.equal(examItems[0].date, IST(10 * DAY)); assert.equal(examItems[0].type, 'exam')
    const due = cal.items.find((i) => i.refId === asg); assert.equal(due.type, 'assignment'); assert.ok(/^\d{2}:\d{2}$/.test(due.time))
    assert.ok(cal.items.some((i) => i.type === 'reminder'))
    assert.equal(new Set(cal.items.map((i) => i.key)).size, cal.items.length)
    const b = ok(await call(SB, 'GET', 'calendar', null, { from: IST(0), to: IST(30 * DAY) })); assert.ok(!b.items.some((i) => i.refId === asg)); assert.ok(b.items.some((i) => i.refId === exam))
    assert.equal(code(await call(S1, 'GET', 'calendar', null, { from: IST(0), to: IST(200 * DAY) })), 'INVALID_RANGE')
    const none = ok(await call(FRESH, 'GET', 'calendar')); assert.equal(none.items.length, 0); assert.ok(none.empty)
    // a student asking for another division gets 400/403, never that class's dates
    assert.notEqual((await call(S1, 'GET', 'calendar', null, { division: 'D2B' })).status, 200)
  })

  /* ---------- class roles ---------- */
  await t('CR: request → teacher approves with a chosen position; positions are unique; duplicates refused', async () => {
    const r1 = ok(await call(S1, 'POST', 'role-requests', { role: 'cr' })).request
    assert.equal(code(await call(S1, 'POST', 'role-requests', { role: 'si' })), 'PENDING_EXISTS')
    const r2 = ok(await call(S2, 'POST', 'role-requests', { role: 'cr' })).request
    const r3 = ok(await call(S3, 'POST', 'role-requests', { role: 'cr' })).request
    assert.equal((await call(TB, 'POST', 'role-decision', { id: r1.id, decision: 'approve', position: 'male' })).status, 403) // not their class
    assert.equal((await call(S2, 'POST', 'role-decision', { id: r1.id, decision: 'approve', position: 'male' })).status, 403)
    assert.equal(code(await call(TA, 'POST', 'role-decision', { id: r1.id, decision: 'approve' })), 'POSITION_REQUIRED') // never inferred from gender
    ok(await call(TA, 'POST', 'role-decision', { id: r1.id, decision: 'approve', position: 'male' }))
    assert.equal(code(await call(TA, 'POST', 'role-decision', { id: r2.id, decision: 'approve', position: 'male' })), 'POSITION_TAKEN')
    assert.equal((await run(`select status from cr_requests where id = $1`, [r2.id]))[0].status, 'pending') // nothing half-done
    ok(await call(TA, 'POST', 'role-decision', { id: r2.id, decision: 'approve', position: 'female' }))
    assert.equal(code(await call(TA, 'POST', 'role-decision', { id: r1.id, decision: 'approve', position: 'female' })), 'ALREADY_DECIDED')
    ok(await call(TA, 'POST', 'role-decision', { id: r3.id, decision: 'reject', note: 'two CRs already' }))
    const me = ok(await call(S1, 'GET', 'me')); assert.deepEqual(me.classRoles.cr, ['D2A']); assert.equal(me.classRoles.crPosition, 'male')
    assert.equal(code(await call(S4, 'POST', 'role-requests', { role: 'cr' })), 'ROLE_FULL')
  })
  await t('CR replace is one atomic change, with an audit trail; the teacher can remove a CR', async () => {
    const r = ok(await call(TA, 'POST', 'role-assign', { division: 'D2A', studentId: ids[S3], role: 'cr', position: 'male', replace: true }))
    assert.deepEqual(r.replaced, [ids[S1]])
    const active = await run(`select student_id, position from cr_assignments where division_code = 'D2A' and active order by position`)
    assert.deepEqual(active.map((x) => [x.student_id, x.position]), [[ids[S2], 'female'], [ids[S3], 'male']])
    assert.equal(code(await call(TA, 'POST', 'role-assign', { division: 'D2A', studentId: ids[S4], role: 'cr', position: 'female' })), 'POSITION_TAKEN')
    assert.equal(code(await call(TA, 'POST', 'role-assign', { division: 'D2A', studentId: ids[SB], role: 'cr', position: 'female', replace: true })), 'NOT_ELIGIBLE') // not in the class
    assert.equal((await run(`select count(*)::int as n from cr_assignments where division_code = 'D2A' and active`))[0].n, 2)
    const roles = ok(await call(TA, 'GET', 'class-roles', null, { division: 'D2A' }))
    assert.ok(roles.history.some((h) => h.action === 'role.replace')); assert.equal(roles.crs.length, 2)
    ok(await call(TA, 'POST', 'role-remove', { division: 'D2A', studentId: ids[S3], role: 'cr' }))
    assert.deepEqual(ok(await call(S3, 'GET', 'me')).classRoles.cr, [])
    assert.equal((await call(S2, 'GET', 'class-roles', null, { division: 'D2A' })).status, 403) // a CR does not manage roles
  })
  await t('two approvals at once never create two CRs in one position (database constraint)', async () => {
    const results = await Promise.all([S4, S5].map((s) => call(TA, 'POST', 'role-assign', { division: 'D2A', studentId: ids[s], role: 'cr', position: 'male' })))
    assert.equal(results.filter((x) => x.status === 200).length, 1, JSON.stringify(results.map((x) => x.body)))
    assert.equal((await run(`select count(*)::int as n from cr_assignments where division_code = 'D2A' and position = 'male' and active`))[0].n, 1)
  })
  await t('SI and CI: request → approval; they publish sports/cultural updates to their own class only', async () => {
    const si = ok(await call(S4, 'POST', 'role-requests', { role: 'si' })).request
    ok(await call(HOD, 'POST', 'role-decision', { id: si.id, decision: 'approve' }))
    assert.equal(code(await call(S5, 'POST', 'role-requests', { role: 'si' })), 'ROLE_FULL')
    const ci = ok(await call(S5, 'POST', 'role-requests', { role: 'ci' })).request
    ok(await call(TA, 'POST', 'role-decision', { id: ci.id, decision: 'approve' }))
    const me4 = ok(await call(S4, 'GET', 'me')); assert.deepEqual(me4.classRoles.si, ['D2A'])
    ok(await call(S4, 'POST', 'publish', { kind: 'sports', title: 'Cricket trials Friday', divisions: ['D2A'] }))
    assert.equal((await call(S4, 'POST', 'publish', { kind: 'cultural', title: 'Dance practice', divisions: ['D2A'] })).status, 403)
    assert.equal((await call(S4, 'POST', 'publish', { kind: 'sports', title: 'Cricket trials', divisions: ['D2B'] })).status, 403)
    assert.equal((await call(S4, 'POST', 'publish', { kind: 'notice', title: 'Exam moved', divisions: ['D2A'] })).status, 403)
    assert.equal((await call(S4, 'POST', 'publish', { kind: 'sports', title: 'With file', divisions: ['D2A'], file: { name: 'a.png', mime: 'image/png', dataBase64: png } })).status, 403)
    ok(await call(S5, 'POST', 'publish', { kind: 'cultural', title: 'Rangoli entries open', divisions: ['D2A'] }))
    assert.equal((await call(S5, 'POST', 'publish', { kind: 'sports', title: 'Football', divisions: ['D2A'] })).status, 403)
    // CR without SI/CI: no sports or cultural publishing (no implicit overlap)
    assert.equal((await call(S2, 'POST', 'publish', { kind: 'sports', title: 'CR sports post', divisions: ['D2A'] })).status, 403)
    assert.equal((await call(S2, 'POST', 'publish', { kind: 'cultural', title: 'CR cultural post', divisions: ['D2A'] })).status, 403)
    const feed = ok(await call(S1, 'GET', 'class-items')).items.map((i) => i.kind); assert.ok(feed.includes('sports') && feed.includes('cultural'))
    // combined roles = combined permissions only: S2 (CR) also becomes SI elsewhere? (one SI per class) → make S2 CI instead of S5
    ok(await call(TA, 'POST', 'role-assign', { division: 'D2A', studentId: ids[S2], role: 'ci', replace: true }))
    ok(await call(S2, 'POST', 'publish', { kind: 'cultural', title: 'CR+CI cultural post', divisions: ['D2A'] }))
    assert.equal((await call(S2, 'POST', 'publish', { kind: 'sports', title: 'still no sports', divisions: ['D2A'] })).status, 403)
    assert.equal((await call(S5, 'POST', 'publish', { kind: 'cultural', title: 'old CI', divisions: ['D2A'] })).status, 403) // replaced: rights end at once
  })
  await t('legacy CR endpoint refuses SI/CI requests instead of making them CRs', async () => {
    const q = ok(await call(SB, 'POST', 'role-requests', { role: 'si' })).request
    assert.equal(code(await call(TB, 'POST', 'cr-decision', { id: q.id, decision: 'approve' })), 'USE_CLASS_ROLES')
    assert.equal((await run(`select count(*)::int as n from cr_assignments where student_id = $1`, [ids[SB]]))[0].n, 0)
  })
  await t('moving division ends SI/CI roles in the old class', async () => {
    const r = ok(await call(S4, 'POST', 'join-requests', { division: 'D2B', reason: 'Wrong division chosen' }))
    ok(await call(TB, 'POST', 'join-decision', { ids: [r.joinRequest.id], decision: 'approve' }))
    assert.equal((await run(`select count(*)::int as n from class_roles where student_id = $1 and active`, [ids[S4]]))[0].n, 0)
    assert.equal((await call(S4, 'POST', 'publish', { kind: 'sports', title: 'old class post', divisions: ['D2A'] })).status, 403)
  })

  /* ---------- HOD ---------- */
  await t('HOD branch view: own branch only, with filters, defaulters and data-quality issues', async () => {
    ok(await call(TA, 'POST', 'attendance', { division: 'D2A', subject: 'Maths', date: IST(-DAY), start: '09:00', marks: [ids[S1], ids[S2], ids[S3], ids[S5]].map((id, i) => ({ studentId: id, present: i !== 0 })) }))
    const v = ok(await call(HOD, 'GET', 'branch-overview'))
    assert.equal(v.branch, 'CMPN'); assert.ok(v.divisions.every((d) => d.code.startsWith('D2')))
    assert.equal(v.defaulters, null); assert.ok(v.issues.some((i) => i.kind === 'threshold'))
    assert.ok(v.issues.some((i) => i.kind === 'no_divisions' && /SE/.test(i.text))) // missing data is named, not invented
    assert.ok(v.issues.some((i) => i.kind === 'unconfirmed' && i.division === 'D2C'))
    ok(await call(HOD, 'POST', 'attendance-threshold', { branch: 'CMPN', value: 75 }))
    const v2 = ok(await call(HOD, 'GET', 'branch-overview', null, { division: 'D2A', subject: 'Maths' }))
    assert.equal(v2.defaulters.length, 1); assert.equal(v2.defaulters[0].id, ids[S1]); assert.equal(v2.defaulters[0].percent, 0)
    assert.ok(v2.items.some((i) => i.id === exam)); assert.ok(v2.roles.some((r) => r.role === 'cr'))
    assert.equal((await call(HOD, 'GET', 'branch-overview', null, { branch: 'AIDS' })).status, 403)
    assert.equal((await call(HOD, 'GET', 'branch-overview', null, { division: 'D1ADA' })).status, 403)
    assert.equal((await call(TA, 'GET', 'branch-overview')).status, 403) // teachers: not without separate authorisation
    assert.equal((await call(S1, 'GET', 'branch-overview')).status, 403)
  })
  await t('HOD adds SE divisions for the branch (nothing else may), confirms an unverified name, sets the syllabus link', async () => {
    assert.equal(code(await call(HOD, 'POST', 'divisions', { yearId: 'SE-2026-27', code: 'bad code!' })), 'INVALID_CODE')
    const d = ok(await call(HOD, 'POST', 'divisions', { yearId: 'SE-2026-27', code: 'SE-CMPN-A', name: 'SE A' }))
    assert.equal(d.division.branch_code, 'CMPN')
    assert.equal(code(await call(HOD, 'POST', 'divisions', { yearId: 'SE-2026-27', code: 'SE-CMPN-A' })), 'DIVISION_EXISTS')
    assert.equal((await call(HOD, 'POST', 'divisions', { branch: 'AIDS', yearId: 'SE-2026-27', code: 'SE-AI-A' })).status, 403)
    assert.equal((await call(TA, 'POST', 'divisions', { yearId: 'SE-2026-27', code: 'SE-X' })).status, 403)
    const cat = ok(await call(S1, 'GET', 'catalog')); assert.ok(cat.divisions.some((x) => x.code === 'SE-CMPN-A' && x.year_id === 'SE-2026-27'))
    ok(await call(HOD, 'POST', 'division-confirm', { code: 'D2C', name: 'D2C' }))
    assert.equal((await run(`select confirmed from divisions where code = 'D2C'`))[0].confirmed, true)
    assert.equal((await call(HOD, 'POST', 'division-confirm', { code: 'D5A' })).status, 403)
    assert.equal(code(await call(HOD, 'POST', 'syllabus', { url: 'http://insecure.example/s' })), 'INVALID_URL')
    ok(await call(HOD, 'POST', 'syllabus', { url: 'https://example.org/cmpn-syllabus.pdf' }))
    assert.equal(ok(await call(S1, 'GET', 'overview')).syllabus.url, 'https://example.org/cmpn-syllabus.pdf')
    assert.equal(ok(await call(SAI, 'GET', 'overview')).syllabus, null) // another branch: not set, not borrowed
    assert.equal((await call(TA, 'POST', 'syllabus', { url: 'https://example.org/x' })).status, 403)
  })

  /* ---------- clubs ---------- */
  let club, ev
  const HEAD = '9100000301', MEM = '9100000302', MEM2 = '9100000303'
  await t('only an HOD provisions a club and its head; heads must use a college account', async () => {
    assert.equal((await call(TA, 'POST', 'clubs', { name: 'Coding Club', headEmail: E(HEAD) })).status, 403)
    assert.equal((await call(S1, 'POST', 'clubs', { name: 'Coding Club', headEmail: E(HEAD) })).status, 403)
    assert.equal(code(await call(HOD, 'POST', 'clubs', { name: 'Coding Club', headEmail: 'someone@gmail.com' })), 'INVALID_EMAIL')
    club = ok(await call(HOD, 'POST', 'clubs', { name: 'Coding Club', kind: 'club', headEmail: E(HEAD) })).club.id
    assert.equal(code(await call(HOD, 'POST', 'clubs', { name: 'coding club', headEmail: E(HEAD) })), 'CLUB_EXISTS')
    const mine = ok(await call(HEAD, 'GET', 'clubs')); assert.equal(mine.clubs[0].is_head, true)
  })
  await t('event head invites teammates by college email; invitees accept with their own accounts; permissions are granular', async () => {
    assert.equal(code(await call(HEAD, 'POST', 'club-invite', { clubId: club, email: 'friend@gmail.com', permissions: ['draft'] })), 'INVALID_EMAIL')
    assert.equal(code(await call(HEAD, 'POST', 'club-invite', { clubId: club, email: E(MEM), permissions: ['root'] })), 'INVALID_PERMISSION')
    ok(await call(HEAD, 'POST', 'club-invite', { clubId: club, email: E(MEM), permissions: ['draft', 'poster'] }))
    assert.equal(code(await call(HEAD, 'POST', 'club-invite', { clubId: club, email: E(MEM), permissions: ['draft'] })), 'ALREADY_MEMBER')
    assert.equal((await call(MEM, 'GET', 'club', null, { id: club })).status, 404) // not active until accepted
    assert.equal(ok(await call(MEM, 'GET', 'me')).clubs.invites, 1)
    assert.equal((await call(MEM2, 'POST', 'club-invite-response', { clubId: club, accept: true })).status, 404) // someone else can't accept it
    ok(await call(MEM, 'POST', 'club-invite-response', { clubId: club, accept: true }))
    assert.equal((await call(MEM, 'POST', 'club-invite', { clubId: club, email: E(MEM2), permissions: [] })).status, 403) // no manage_team
  })
  await t('event editor: drafts by members; registration and publish need their permissions; poster upload needs “poster”', async () => {
    const base = { clubId: club, title: 'Hackathon', description: '24 hours', venue: 'Seminar hall', startsAt: new Date(Date.now() + 20 * DAY).toISOString(), audience: { branches: ['CMPN'], years: [1] }, layout: 'banner' }
    assert.equal((await call(MEM, 'POST', 'club-events', { ...base, regMode: 'builtin', capacity: 2 })).status, 403)
    ev = ok(await call(MEM, 'POST', 'club-events', { ...base, poster: { name: 'p.png', mime: 'image/png', dataBase64: png } })).event.id
    assert.equal(code(await call(MEM, 'POST', 'club-events', { ...base, title: 'x' })), 'INVALID_TITLE')
    assert.equal(code(await call(HEAD, 'POST', 'club-events', { ...base, id: ev, regMode: 'builtin', capacity: 2, regDeadline: new Date(Date.now() + 30 * DAY).toISOString() })), 'INVALID_DEADLINE')
    ok(await call(HEAD, 'POST', 'club-events', { ...base, id: ev, regMode: 'builtin', capacity: 2, regDeadline: new Date(Date.now() + 10 * DAY).toISOString() }))
    assert.equal((await call(MEM, 'POST', 'club-event-status', { id: ev, status: 'published' })).status, 403)
    assert.ok(!ok(await call(S1, 'GET', 'overview')).events.some((e) => e.id === ev)) // a draft is not in feeds
    ok(await call(HEAD, 'POST', 'club-event-status', { id: ev, status: 'published' }))
    assert.equal((await call(MEM, 'POST', 'club-events', { ...base, id: ev, title: 'Hackathon 2' })).status, 403) // published: editing needs publish
  })
  await t('published club events reach the right audience in feeds and calendars only', async () => {
    assert.ok(ok(await call(S1, 'GET', 'overview')).events.some((e) => e.id === ev))
    assert.ok(ok(await call(S1, 'GET', 'my-record')).events.some((e) => e.id === ev))
    assert.ok(ok(await call(S1, 'GET', 'calendar', null, { from: IST(0), to: IST(40 * DAY) })).items.some((i) => i.refId === ev && i.type === 'event'))
    assert.ok(ok(await call(S1, 'GET', 'calendar', null, { from: IST(0), to: IST(40 * DAY) })).items.some((i) => i.refId === ev && i.type === 'registration'))
    assert.ok(!ok(await call(SAI, 'GET', 'overview')).events.some((e) => e.id === ev)) // audience: CMPN only
    assert.equal((await call(SAI, 'GET', 'event', null, { id: ev })).status, 404)
    const posterId = (await run(`select poster_file_id from college_events where id = $1`, [ev]))[0].poster_file_id
    const f = await call(S1, 'GET', 'file', null, { id: posterId, inline: '1' }); assert.equal(f.status, 200); assert.match(f.h['Content-Disposition'], /^inline/)
  })
  await t('built-in registration: capacity and deadline enforced, no double counting, cancel frees the place', async () => {
    const d = ok(await call(S1, 'GET', 'event', null, { id: ev })); assert.equal(d.registration.open, true)
    ok(await call(S1, 'POST', 'event-register', { eventId: ev })); assert.equal(ok(await call(S1, 'POST', 'event-register', { eventId: ev })).already, true)
    ok(await call(S2, 'POST', 'event-register', { eventId: ev }))
    assert.equal(code(await call(S3, 'POST', 'event-register', { eventId: ev })), 'EVENT_FULL')
    assert.equal((await run(`select reg_count from college_events where id = $1`, [ev]))[0].reg_count, 2)
    ok(await call(S2, 'DELETE', 'event-register', null, { eventId: ev }))
    ok(await call(S3, 'POST', 'event-register', { eventId: ev }))
    assert.equal((await run(`select reg_count from college_events where id = $1`, [ev]))[0].reg_count, 2)
  })
  await t('organisers see registrations only with the permission, and never academic records', async () => {
    assert.equal((await call(MEM, 'GET', 'club-registrations', null, { eventId: ev })).status, 403)
    const r = ok(await call(HEAD, 'GET', 'club-registrations', null, { eventId: ev }))
    assert.equal(r.registrations.length, 3); const keys = Object.keys(r.registrations[0]).sort()
    assert.deepEqual(keys, ['contact', 'name', 'registered_at', 'status']); assert.ok(r.registrations.every((x) => x.contact.includes('•')))
    assert.equal((await call(HEAD, 'GET', 'roster', null, { division: 'D2A' })).status, 403)
    assert.equal((await call(HEAD, 'GET', 'attendance', null, { division: 'D2A' })).status, 403)
  })
  await t('announcements need the permission; revocation is immediate', async () => {
    assert.equal((await call(MEM, 'POST', 'club-announcements', { clubId: club, eventId: ev, title: 'Venue changed' })).status, 403)
    ok(await call(HEAD, 'POST', 'club-member', { clubId: club, email: E(MEM), permissions: ['draft', 'announce'] }))
    ok(await call(MEM, 'POST', 'club-announcements', { clubId: club, eventId: ev, title: 'Venue changed', body: 'Now in the auditorium' }))
    assert.ok(ok(await call(S1, 'GET', 'event', null, { id: ev })).announcements.some((a) => a.title === 'Venue changed'))
    assert.ok(ok(await call(S1, 'GET', 'overview')).announcements.some((a) => a.title === 'Venue changed'))
    ok(await call(HEAD, 'POST', 'club-member', { clubId: club, email: E(MEM), revoke: true }))
    assert.equal((await call(MEM, 'POST', 'club-announcements', { clubId: club, eventId: ev, title: 'After revoke' })).status, 403)
    assert.equal((await call(MEM, 'GET', 'club', null, { id: club })).status, 404)
    assert.equal((await call(MEM, 'POST', 'club-member', { clubId: club, email: E(HEAD), revoke: true })).status, 403)
  })
  await t('cancelled club events stay visible as cancelled; the HOD event tools cannot edit club events', async () => {
    ok(await call(HEAD, 'POST', 'club-event-status', { id: ev, status: 'cancelled' }))
    assert.equal(ok(await call(S1, 'GET', 'event', null, { id: ev })).event.status, 'cancelled')
    assert.equal(ok(await call(S1, 'GET', 'event', null, { id: ev })).registration.open, false)
    assert.equal((await call(HOD, 'POST', 'event-status', { id: ev, status: 'published' })).status, 404)
    ok(await call(HOD, 'POST', 'club-admin', { clubId: club, active: false }))
    assert.ok(!ok(await call(S1, 'GET', 'overview')).events.some((e) => e.id === ev))
    assert.equal((await call(HEAD, 'GET', 'club', null, { id: club })).status, 404)
  })

  /* ---------- parent ---------- */
  await t('parent: read-only; sees published class notices only, never drafts; no publishing, roles or clubs', async () => {
    const link = ok(await call(S1, 'POST', 'parent-links', { email: E(PARENT), relation: 'Mother' }))
    ok(await call(TA, 'POST', 'parent-link-decision', { ids: [link.link.id], decision: 'approve' }))
    const rec = ok(await call(PARENT, 'GET', 'parent-record', null, { child: ids[S1] }))
    assert.ok(rec.notices.length > 0); assert.ok(rec.notices.every((n) => n.id !== undefined))
    const d2 = ok(await call(TA, 'POST', 'publish', { kind: 'notice', title: 'Secret draft', divisions: ['D2A'], draft: true })).item.id
    assert.ok(!ok(await call(PARENT, 'GET', 'parent-record', null, { child: ids[S1] })).notices.some((n) => n.id === d2))
    assert.equal((await call(PARENT, 'POST', 'publish', { kind: 'notice', title: 'Parent post', divisions: ['D2A'] })).status, 403)
    assert.equal((await call(PARENT, 'POST', 'role-requests', { role: 'cr' })).status, 403)
    assert.equal((await call(PARENT, 'PUT', 'setup', { name: 'Parent', mobile: '9876500009' })).status, 403)
    assert.equal(ok(await call(PARENT, 'GET', 'clubs')).clubs.length, 0)
    assert.equal((await call(PARENT, 'GET', 'calendar')).status, 403)
    assert.equal((await call(PARENT, 'POST', 'event-register', { eventId: ev })).status, 403)
  })

  /* ---------- branch rules for joining and moving ---------- */
  await t('a first join must match the branch and year in the profile (CMPN profile can’t join an AIDS class)', async () => {
    const r = await call(FRESH, 'POST', 'join-requests', { division: 'D1ADA' })
    assert.equal(code(r), 'PROFILE_MISMATCH'); assert.match(r.body.error, /your profile says CMPN/)
    assert.equal((await run(`select count(*)::int as n from join_requests j join accounts a on a.id = j.student_id where a.phone = $1`, [E(FRESH)]))[0].n, 0)
    ok(await call(FRESH, 'POST', 'join-requests', { division: 'D2B' })) // own branch and year: fine
  })
  await t('an enrolled student can ask to move to another branch; only the target class teacher or that branch’s HOD decides; the profile follows', async () => {
    const r = ok(await call(S1, 'POST', 'join-requests', { division: 'D1ADA', reason: 'My branch is AIDS, joined CMPN by mistake' }))
    assert.equal(r.joinRequest.kind, 'transfer'); assert.equal(r.joinRequest.from_division, 'D2A')
    assert.equal((await call(TA, 'POST', 'join-decision', { ids: [r.joinRequest.id], decision: 'approve' })).body.results[0].ok, false) // old-class teacher
    assert.equal((await call(HOD, 'POST', 'join-decision', { ids: [r.joinRequest.id], decision: 'approve' })).body.results[0].ok, false) // CMPN HOD
    const okd = ok(await call(HOD_AI, 'POST', 'join-decision', { ids: [r.joinRequest.id], decision: 'approve' })); assert.equal(okd.results[0].ok, true, JSON.stringify(okd))
    const me = ok(await call(S1, 'GET', 'me')); assert.equal(me.enrollment.division_code, 'D1ADA'); assert.equal(me.setup.branch, 'AIDS'); assert.equal(me.setup.yearLevel, 1)
    assert.equal(ok(await call(S1, 'GET', 'class-items')).division, 'D1ADA')
  })

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
