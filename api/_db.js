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

/** Tests inject an in-memory Postgres. */
function _setClient(fn) { client = fn; ready = null; }

module.exports = { q, ensureSchema, migrate, _setClient };
