// Phases 2–4 server tests: real handlers + real Postgres (PGlite) + production-style signed cookies.
process.env.MINIMOTH_API_KEY = 'mm_test_k'; process.env.DATABASE_URL = 'postgres://u:p@h/db';
process.env.ADMIN_PHONES = '9100000001'; process.env.TEACHER_PHONES = '';
const path = require('path');
const R = process.env.API_DIR || path.join(__dirname, '../../api/');
const crypto = require('crypto'), assert = require('assert'), fs = require('fs');
const { PGlite } = require('@electric-sql/pglite');
const db = require(R + '/_db'); const app = require(R + '/app');
const sign = (p) => crypto.createHmac('sha256', 'mm_test_k').update('phone:' + p).digest('hex').slice(0, 32);
const C = (n) => `mm_phone=${encodeURIComponent('+91' + n)}.${sign('+91' + n)}`;
const call = (who, method, route, body, query = {}) => new Promise((ok) => {
  const res = { h: {}, headersSent: false, writableEnded: false, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; },
    json(b) { this.writableEnded = true; ok({ status: this.c, body: b }); }, end(buf) { ok({ status: this.c, raw: buf, headers: this.h }); } };
  app({ method, query: { ...query, route }, url: '/api/app/' + route, headers: { cookie: C(who), 'x-forwarded-for': '1.1.1.1' }, body }, res);
});
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '→', e.message); } };
const HOD = '9100000001', T1 = '9100000011', T2 = '9100000012', S1 = '9100000101', S2 = '9100000102', S3 = '9100000103', S4 = '9100000104', X = '9100000999';
const id = async (who) => (await call(who, 'GET', 'me')).body.account.id;
const sheet = (rows, name = 'Timetable') => ({ name, rows: [['Division', 'Day', 'Start (HH:MM)', 'End (HH:MM)', 'Subject', 'Teacher', 'Room', 'Batch', 'Type'], ...rows] });
const lookups = [{ name: 'Subjects', rows: [['Subject code', 'Full name'], ['M1', 'Mathematics 1'], ['CP', 'Programming in C'], ['BEE', 'Basic Electrical']] },
  { name: 'Teachers', rows: [['Initials', 'Name', 'Dept'], ['KD', 'Teacher K', 'FE'], ['AD', 'Teacher A', 'FE'], ['RS', 'Teacher R', 'FE']] }];
(async () => {
  const pg = new PGlite(); db._setClient((x, p) => pg.query(x, p).then((r) => r.rows));
  // ---------- Phase 2: whitelist ----------
  await t('non-HOD cannot read or change the teacher list', async () => {
    assert.equal((await call(X, 'GET', 'hod-teachers')).status, 403);
    assert.equal((await call(X, 'POST', 'hod-teachers', { phone: X, teaches: [{ division: 'D2A', subject: 'M1' }] })).status, 403);
  });
  await t('HOD adds teachers (unknown division rejected)', async () => {
    assert.equal((await call(HOD, 'POST', 'hod-teachers', { phone: T1, name: 'Teacher K', code: 'KD', teaches: [{ division: 'D2A', subject: 'M1' }] })).status, 200);
    assert.equal((await call(HOD, 'POST', 'hod-teachers', { phone: T2, name: 'Teacher A', code: 'AD', teaches: [{ division: 'D1ADA', subject: 'M1' }], canPublishTimetable: false })).status, 200);
    assert.equal((await call(HOD, 'POST', 'hod-teachers', { phone: X, teaches: [{ division: 'D9Z', subject: 'M1' }] })).status, 400);
    const l = (await call(HOD, 'GET', 'hod-teachers')).body.teachers; assert.equal(l.length, 2);
  });
  await t('teacher role comes from the whitelist', async () => { const me = (await call(T1, 'GET', 'me')).body; assert.equal(me.teacher.code, 'KD'); assert.equal(me.teacher.teaches[0].division, 'D2A'); });
  // ---------- Phase 4: join + CR ----------
  await t('student requests to join; sees nothing until approved', async () => {
    assert.equal((await call(S1, 'POST', 'join', { division: 'D2A' })).status, 200);
    const f = (await call(S1, 'GET', 'feed')).body; assert.equal(f.division, null); assert.match(f.message, /Join your class/);
    assert.equal((await call(S1, 'POST', 'join', { division: 'NOPE' })).status, 400);
  });
  const s1 = await id(S1), s2 = await id(S2), s3 = await id(S3), s4 = await id(S4);
  await t('HOD approves S1 and appoints them class rep of D2A', async () => {
    assert.equal((await call(HOD, 'POST', 'decide', { accountId: s1, division: 'D2A', decision: 'approve' })).status, 200);
    assert.equal((await call(HOD, 'POST', 'hod-cr', { accountId: s1, division: 'D2A' })).status, 200);
    assert.deepEqual((await call(S1, 'GET', 'me')).body.cr, ['D2A']);
  });
  await t('CR cannot be appointed for a class they are not in', async () => assert.equal((await call(HOD, 'POST', 'hod-cr', { accountId: s1, division: 'D1ADA' })).status, 400));
  await call(S2, 'POST', 'join', { division: 'D2A' }); await call(S3, 'POST', 'join', { division: 'D1ADA' }); await call(S4, 'POST', 'join', { division: 'D2A' });
  await t('CR approves S2 and rejects S4 in their own class', async () => {
    assert.equal((await call(S1, 'POST', 'decide', { accountId: s2, division: 'D2A', decision: 'approve' })).status, 200);
    assert.equal((await call(S1, 'POST', 'decide', { accountId: s4, division: 'D2A', decision: 'reject' })).status, 200);
  });
  await t('CR cannot manage another division (decide or list)', async () => {
    assert.equal((await call(S1, 'POST', 'decide', { accountId: s3, division: 'D1ADA', decision: 'approve' })).status, 403);
    assert.equal((await call(S1, 'GET', 'requests', null, { division: 'D1ADA' })).status, 403);
    const own = (await call(S1, 'GET', 'requests')).body.requests; assert.ok(own.every((r) => r.division_code === 'D2A')); assert.ok(own.every((r) => /xxxx/.test(r.phone)));
  });
  await t('CR cannot change a decided request or appoint CRs', async () => {
    assert.equal((await call(S1, 'POST', 'decide', { accountId: s4, division: 'D2A', decision: 'approve' })).status, 403);
    assert.equal((await call(S1, 'POST', 'hod-cr', { accountId: s2, division: 'D2A' })).status, 403);
  });
  await t('HOD overrides the CR rejection; history in the audit log', async () => {
    const r = await call(HOD, 'POST', 'decide', { accountId: s4, division: 'D2A', decision: 'approve' }); assert.equal(r.status, 200);
    const a = (await call(HOD, 'GET', 'hod-audit')).body.entries; const o = a.find((e) => e.action === 'join.approve' && e.detail.override);
    assert.ok(o); assert.equal(o.detail.previous, 'rejected');
  });
  await t('students cannot approve anyone, list requests or read the audit log', async () => {
    assert.equal((await call(S2, 'POST', 'decide', { accountId: s3, division: 'D1ADA', decision: 'approve' })).status, 403);
    assert.equal((await call(S2, 'GET', 'requests')).status, 403);
    assert.equal((await call(S2, 'GET', 'hod-audit')).status, 403);
  });
  await call(HOD, 'POST', 'decide', { accountId: s3, division: 'D1ADA', decision: 'approve' });
  // ---------- Phase 2: posts ----------
  let fileId;
  await t('unregistered number cannot post', async () => assert.equal((await call(X, 'POST', 'posts', { kind: 'announcement', title: 'Hi there', divisions: ['D2A'] })).status, 403));
  await t('teacher posts only to their own divisions', async () => {
    assert.equal((await call(T1, 'POST', 'posts', { kind: 'announcement', title: 'Test on Monday', body: 'Chapters 1-3', divisions: ['D2A'] })).status, 200);
    assert.equal((await call(T1, 'POST', 'posts', { kind: 'announcement', title: 'Sneaky', divisions: ['D1ADA'] })).status, 403);
  });
  await t('file uploads: type, size and presence validated', async () => {
    const pdf = Buffer.from('%PDF-1.4 test notes').toString('base64');
    const ok = await call(T1, 'POST', 'posts', { kind: 'material', title: 'Unit 1 notes', divisions: ['D2A'], file: { name: 'unit1.pdf', mime: 'application/pdf', dataBase64: pdf } });
    assert.equal(ok.status, 200);
    assert.equal((await call(T1, 'POST', 'posts', { kind: 'material', title: 'No file', divisions: ['D2A'] })).status, 400);
    assert.equal((await call(T1, 'POST', 'posts', { kind: 'material', title: 'Bad type', divisions: ['D2A'], file: { name: 'x.exe', mime: 'application/x-msdownload', dataBase64: pdf } })).status, 400);
    assert.equal((await call(T1, 'POST', 'posts', { kind: 'material', title: 'Too big', divisions: ['D2A'], file: { name: 'b.pdf', mime: 'application/pdf', dataBase64: Buffer.alloc(3 * 1024 * 1024 + 10).toString('base64') } })).status, 413);
  });
  await t('enrolled student sees the posts; file downloads intact', async () => {
    const f = (await call(S2, 'GET', 'feed')).body; assert.equal(f.division, 'D2A'); assert.equal(f.posts.length, 2);
    const m = f.posts.find((p) => p.kind === 'material'); fileId = m.file_id;
    const d = await call(S2, 'GET', 'file', null, { id: fileId }); assert.equal(d.status, 200); assert.equal(Buffer.from(d.raw).toString(), '%PDF-1.4 test notes'); assert.equal(d.headers['Content-Type'], 'application/pdf');
  });
  await t('student of another division sees nothing and cannot fetch the file', async () => {
    const f = (await call(S3, 'GET', 'feed')).body; assert.equal(f.division, 'D1ADA'); assert.equal(f.posts.length, 0);
    assert.equal((await call(S3, 'GET', 'file', null, { id: fileId })).status, 404);
    assert.equal((await call(S3, 'GET', 'feed', null, { division: 'D2A' })).body.division, 'D1ADA'); // ?division ignored for students
  });
  await t('unapproved student cannot fetch the file', async () => assert.equal((await call(X, 'GET', 'file', null, { id: fileId })).status, 404));
  await t('other teacher cannot delete the post; author can', async () => {
    const pid = (await call(T1, 'GET', 'posts')).body.posts[0].id;
    assert.equal((await call(T2, 'DELETE', 'posts', null, { id: pid })).status, 404);
    assert.equal((await call(T1, 'DELETE', 'posts', null, { id: pid })).status, 200);
    assert.equal((await call(S2, 'GET', 'feed')).body.posts.length, 1);
  });
  await t('post rate limit (31st in 10 minutes refused)', async () => {
    let last; for (let i = 0; i < 29; i++) last = await call(T1, 'POST', 'posts', { kind: 'announcement', title: 'Spam ' + i, divisions: ['D2A'] });
    assert.equal(last.status, 429);
  });
  // ---------- Phase 3: timetable ----------
  const good = [['D2A', 'Monday', '08:30', '09:30', 'M1', 'KD', '524', '', 'Lecture'], ['D2A', 'Monday', '13:30', '15:30', 'CP', 'AD', '406', '1', 'Lab'], ['D2A', 'Monday', '13:30', '15:30', 'BEE', 'RS', '109', '2', 'Lab'], ['D1ADA', 'Monday', '08:30', '09:30', 'M1', 'AD', '518', '', 'Lecture']];
  let v1;
  await t('teacher without publish permission cannot upload', async () => assert.equal((await call(T2, 'POST', 'timetable-preview', { term: 'FE 2026-27 S1', fileName: 'a.xlsx', sheets: [sheet(good), ...lookups] })).status, 403));
  await t('wrong file type refused', async () => assert.equal((await call(T1, 'POST', 'timetable-preview', { term: 'FE 2026-27 S1', fileName: 'a.xls', sheets: [sheet(good)] })).status, 400));
  await t('valid workbook: preview, nothing visible before publish', async () => {
    const r = (await call(T1, 'POST', 'timetable-preview', { term: 'FE 2026-27 S1', fileName: 'fe.xlsx', sheets: [sheet(good), ...lookups] })).body;
    assert.equal(r.ok, true, JSON.stringify(r.errors)); assert.equal(r.rowCount, 4); assert.deepEqual(r.divisions, ['D1ADA', 'D2A']); v1 = r.versionId;
    assert.match((await call(S2, 'GET', 'timetable')).body.message, /No timetable/);
  });
  await t('publish → each division sees only its own timetable', async () => {
    assert.equal((await call(T1, 'POST', 'timetable-publish', { versionId: v1 })).status, 200);
    const a = (await call(S2, 'GET', 'timetable')).body; assert.equal(a.division, 'D2A'); assert.equal(a.entries.length, 3); assert.equal(a.entries[0].subject_name, 'Mathematics 1');
    const b = (await call(S3, 'GET', 'timetable')).body; assert.equal(b.division, 'D1ADA'); assert.equal(b.entries.length, 1);
    assert.equal((await call(S3, 'GET', 'timetable', null, { division: 'D2A' })).body.division, 'D1ADA');
  });
  await t('malformed workbook: every problem reported with sheet/cell, nothing published', async () => {
    const badRows = [['D9X', 'Monday', '08:30', '09:30', 'M1', 'KD', '', '', ''], ['D2A', 'Funday', '08:30', '09:30', 'M1', 'KD', '', '', ''],
      ['D2A', 'Tuesday', '10:30', '09:30', 'M1', 'KD', '', '', ''], ['D2A', 'Tuesday', '11:30', '12:30', '', 'KD', '', '', ''],
      ['D2A', 'Wednesday', '8:30', '9:30', 'M1', 'KD', '', '', ''], ['D2A', 'Wednesday', '09:00', '10:00', 'CP', 'AD', '', '', ''],
      ['D1ADA', 'Wednesday', '08:30', '09:30', 'BEE', 'KD', '', '', ''], ['D2A', 'Thursday', '8.75', '9:30', 'ZZ', 'QQ', '', '7', 'Seminar']];
    const r = (await call(T1, 'POST', 'timetable-preview', { term: 'FE 2026-27 S1', fileName: 'bad.xlsx', sheets: [sheet(badRows), ...lookups] })).body;
    const msgs = r.errors.map((e) => `${e.cell || ''} ${e.message}`).join('\n');
    assert.equal(r.ok, false); assert.equal(r.versionId, undefined);
    for (const re of [/A2 Unknown division "D9X"/, /B3 "Funday" is not a day/, /D4 End time must be later/, /E5 Subject is missing/, /Overlaps sheet "Timetable" row 6/, /Teacher KD is also teaching D2A/, /Start time "8.75"/, /Unknown subject code "ZZ"/, /Unknown teacher code "QQ"/, /Batch "7"/, /Type "Seminar"/]) assert.match(msgs, re);
    const a = (await call(S2, 'GET', 'timetable')).body; assert.equal(a.entries.length, 3); // published one unchanged
  });
  await t('one sheet per division also works (sheet named after the division)', async () => {
    const r = (await call(T1, 'POST', 'timetable-preview', { term: 'Test per-sheet', fileName: 'p.xlsx', sheets: [{ name: 'D2B', rows: [['Day', 'Start', 'End', 'Subject', 'Teacher'], ['Friday', '08:30', '09:30', 'M1', 'KD']] }, ...lookups] })).body;
    assert.equal(r.ok, true, JSON.stringify(r.errors)); assert.deepEqual(r.divisions, ['D2B']);
  });
  let v2;
  await t('new version replaces the old; rollback restores it', async () => {
    const r = (await call(HOD, 'POST', 'timetable-preview', { term: 'FE 2026-27 S1', fileName: 'fe2.xlsx', sheets: [sheet([good[0]]), ...lookups] })).body; v2 = r.versionId;
    assert.equal((await call(HOD, 'POST', 'timetable-publish', { versionId: v2 })).status, 200);
    assert.equal((await call(S2, 'GET', 'timetable')).body.entries.length, 1);
    assert.equal((await call(T1, 'POST', 'timetable-rollback', { versionId: v1 })).status, 200);
    assert.equal((await call(S2, 'GET', 'timetable')).body.entries.length, 3);
    const vs = (await call(T1, 'GET', 'timetable-versions')).body.versions; assert.ok(vs.find((v) => v.id === v1 && v.current));
  });
  await t('concurrent imports: a stale preview cannot overwrite a newer publish', async () => {
    const a = (await call(T1, 'POST', 'timetable-preview', { term: 'FE 2026-27 S1', fileName: 'x.xlsx', sheets: [sheet(good), ...lookups] })).body.versionId;
    await new Promise((r) => setTimeout(r, 15));
    const b = (await call(HOD, 'POST', 'timetable-preview', { term: 'FE 2026-27 S1', fileName: 'y.xlsx', sheets: [sheet([good[3]]), ...lookups] })).body.versionId;
    assert.equal((await call(HOD, 'POST', 'timetable-publish', { versionId: b })).status, 200);
    const r = await call(T1, 'POST', 'timetable-publish', { versionId: a }); assert.equal(r.status, 409); assert.equal(r.body.code, 'PUBLISHED_SINCE');
  });
  await t('students cannot upload, publish or roll back', async () => {
    assert.equal((await call(S2, 'POST', 'timetable-preview', { term: 'x y', fileName: 'a.xlsx', sheets: [sheet(good)] })).status, 403);
    assert.equal((await call(S2, 'POST', 'timetable-publish', { versionId: v1 })).status, 403);
    assert.equal((await call(S2, 'POST', 'timetable-rollback', { versionId: v1 })).status, 403);
  });
  const feFile = process.env.FE_JSON || path.join(__dirname, 'fe_sheets.json');
  if (fs.existsSync(feFile)) await t('the real FE 2026-27 draft passes validation (276 rows, 12 divisions)', async () => {
    const sheets = JSON.parse(fs.readFileSync(feFile, 'utf8'));
    const r = (await call(HOD, 'POST', 'timetable-preview', { term: 'FE 2026-27 Sem I', fileName: 'FE_2026-27_Sem1_Timetable_DRAFT.xlsx', sheets })).body;
    assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 5))); assert.equal(r.rowCount, 276); assert.equal(r.divisions.length, 12);
    console.log('   warnings:', r.warnings.length, '(check notes, missing workshop teachers, room clashes)');
  });
  await t('audit log records posts, decisions, timetable actions; HOD only', async () => {
    const a = (await call(HOD, 'GET', 'hod-audit')).body.entries.map((e) => e.action);
    for (const x of ['teacher.upsert', 'join.request', 'join.approve', 'join.reject', 'cr.appoint', 'post.create', 'post.delete', 'timetable.preview', 'timetable.publish', 'timetable.rollback']) assert.ok(a.includes(x), x);
  });
  console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})();
