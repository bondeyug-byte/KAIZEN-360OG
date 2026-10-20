// Database access for Campus360 (Neon Postgres over HTTP).
// `q(text, params)` runs one parameterised statement and returns rows. Migrations run once per server
// instance; every statement is idempotent, so two instances starting together are safe.
const MIGRATIONS = require('./_migrations');

let client = null;
function q(text, params = []) {
  if (!client) {
    if (!process.env.DATABASE_URL) {
      const e = new Error('The database is not configured.');
      e.code = 'DB_NOT_CONFIGURED';
      throw e;
    }
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    client = (t, p) => sql.query ? sql.query(t, p) : sql(t, p);
  }
  return client(text, params);
}

let ready = null;
async function migrate(run = q) {
  await run('create table if not exists schema_migrations (id int primary key, name text not null, applied_at timestamptz not null default now())');
  const done = new Set((await run('select id from schema_migrations')).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const stmt of m.up) await run(stmt);
    await run('insert into schema_migrations (id, name) values ($1, $2) on conflict (id) do nothing', [m.id, m.name]);
  }
}
const ensureSchema = () => (ready = ready || migrate().catch((e) => { ready = null; throw e; }));

/** Fixed-window rate limit. Returns true when the call is allowed. */
async function allow(key, max, windowSec) {
  const [r] = await q(
    `insert into rate_limits (key, window_start, count) values ($1, now(), 1)
     on conflict (key) do update set
       count = case when rate_limits.window_start < now() - make_interval(secs => $2) then 1 else rate_limits.count + 1 end,
       window_start = case when rate_limits.window_start < now() - make_interval(secs => $2) then now() else rate_limits.window_start end
     returning count`, [key, windowSec]);
  return r.count <= max;
}
const audit = (actor, action, target, detail, branch) =>
  q('insert into audit_log (actor, action, target, detail, branch_code) values ($1, $2, $3, $4, $5)', [actor || null, action, target || null, detail ? JSON.stringify(detail) : null, branch || null]);

/** Tests inject an in-memory Postgres. */
function _setClient(fn) { client = fn; ready = null; }

module.exports = { q, ensureSchema, migrate, allow, audit, _setClient };
