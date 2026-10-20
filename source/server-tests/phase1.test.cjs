// Phase 1 server tests: real Postgres (PGlite), real handlers, signed cookies like production.
process.env.MINIMOTH_API_KEY = 'mm_test_k'; process.env.DATABASE_URL = 'postgres://u:p@h/db';
process.env.TEACHER_PHONES = '9000000001=Teacher|D2A:Maths'; process.env.ADMIN_PHONES = '';
const R = require('path').join(__dirname, '../../api/') + '/';
const crypto = require('crypto');
const assert = require('assert');
const { PGlite } = require('@electric-sql/pglite');
const db = require(R + '_db');
const app = require(R + 'app');
const sign = (p) => crypto.createHmac('sha256', 'mm_test_k').update('phone:' + p).digest('hex').slice(0, 32);
const cookieFor = (p) => `mm_phone=${encodeURIComponent(p)}.${sign(p)}`;
const call = (route, method, cookie, body) => new Promise((ok) => {
  const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(b) { ok({ status: this.c, body: b }); } };
  app({ method, query: { route }, url: '/api/app/' + route, headers: cookie ? { cookie } : {}, body }, res);
});
let pass = 0; const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message); process.exitCode = 1; } };
(async () => {
  const pg = new PGlite();
  db._setClient((text, params) => pg.query(text, params).then((r) => r.rows));
  const A = cookieFor('+919812341345'), B = cookieFor('+919800000001');
  await t('no cookie → 401', async () => assert.equal((await call('me', 'GET')).status, 401));
  await t('forged cookie → 401', async () => assert.equal((await call('me', 'GET', 'mm_phone=%2B919812341345.deadbeefdeadbeefdeadbeefdeadbeef')).status, 401));
  let laptop, phone;
  await t('first sign-in creates one account (laptop)', async () => { laptop = (await call('me', 'GET', A)).body; assert.ok(laptop.account.id); assert.equal(laptop.version, 0); });
  await t('migrations ran: 12 FE divisions seeded', async () => { const r = await call('divisions', 'GET', A); assert.equal(r.body.divisions.length, 12); });
  await t('laptop saves profile + data', async () => {
    const r = await call('me', 'PUT', A, { baseVersion: 0, profile: { name: 'Riya', division: 'D2A', role: 'teacher', teaches: [{ division: 'D2A' }] }, data: { subjects: [{ name: 'M1', ise: 18 }] } });
    assert.equal(r.status, 200); assert.equal(r.body.version, 1);
  });
  await t('second device, same number → same account and data', async () => {
    phone = (await call('me', 'GET', A)).body;
    assert.equal(phone.account.id, laptop.account.id); assert.equal(phone.profile.name, 'Riya'); assert.equal(phone.data.subjects[0].ise, 18); assert.equal(phone.account.name, 'Riya');
  });
  await t('role fields in profile are ignored (no self-promotion)', async () => { assert.equal(phone.profile.role, undefined); assert.equal(phone.profile.teaches, undefined); assert.equal(phone.teacher, null); assert.equal(phone.admin, false); });
  await t('stale device write → 409 with the newer copy', async () => {
    const r = await call('me', 'PUT', A, { baseVersion: 0, profile: { name: 'Old' } });
    assert.equal(r.status, 409); assert.equal(r.body.code, 'VERSION_CONFLICT'); assert.equal(r.body.profile.name, 'Riya'); assert.equal(r.body.version, 1);
  });
  await t('another student gets a different account and cannot see A', async () => {
    const b = (await call('me', 'GET', B)).body; assert.notEqual(b.account.id, laptop.account.id); assert.deepEqual(b.profile, {}); assert.deepEqual(b.data, {});
  });
  await t('teacher role comes from server settings only', async () => { const r = (await call('me', 'GET', cookieFor('+919000000001'))).body; assert.equal(r.teacher.teaches[0].division, 'D2A'); });
  await t('bad bodies rejected', async () => {
    assert.equal((await call('me', 'PUT', A, { profile: {} })).status, 400);
    assert.equal((await call('me', 'PUT', A, { baseVersion: 1, data: [1] })).status, 400);
    assert.equal((await call('me', 'PUT', A, { baseVersion: 1, data: { x: 'a'.repeat(210000) } })).status, 413);
  });
  await t('one account per phone (unique), audit row written', async () => {
    const n = await pg.query("select count(*)::int n from accounts where phone = '+919812341345'"); assert.equal(n.rows[0].n, 1);
    const a = await pg.query("select count(*)::int n from audit_log where action = 'account.create'"); assert.equal(a.rows[0].n, 3);
  });
  await t('migrations are idempotent (second run is a no-op)', async () => { await db.migrate((x, p) => pg.query(x, p).then((r) => r.rows)); const m = await pg.query('select count(*)::int n from schema_migrations'); assert.equal(m.rows[0].n, 1); });
  await t('unknown route → 404', async () => {
    assert.equal((await call('nope', 'GET', A)).status, 404);
  });
  console.log(`${pass} passed`);
})();
