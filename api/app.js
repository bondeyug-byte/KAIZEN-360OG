// api/app.js — Campus360 account API (one serverless function, routed by ?route=).
//   GET /api/app/me        → the signed-in account, its profile and private data (creates the account on first call)
//   PUT /api/app/me        → save profile and/or private data { profile?, data?, baseVersion }
//   GET /api/app/divisions → the division list
// Identity comes only from the signed, HttpOnly login cookie set after OTP verification (api/_session.js).
// Roles come only from server settings and the database, never from the request body.
const { getPhone } = require('./_session');
const { isAdminPhone, teacherFor } = require('./_roles');
const db = require('./_db');

const MAX_PROFILE = 8 * 1024;
const MAX_DATA = 200 * 1024;
// Profile fields a user may never set for themselves.
const PROTECTED = ['id', 'role', 'roles', 'teaches', 'phone', 'phoneVerified', 'authMethod', 'demo', 'classRep', 'academicHistory', 'admin', 'teacher'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function cleanProfile(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) if (!PROTECTED.includes(k)) out[k] = v;
  return out;
}
const send = (res, status, body) => { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); };
const fail = (res, status, code, error, extra) => send(res, status, { ok: false, code, error, ...extra });

async function rolesFor(account, phone) {
  const rows = await db.q('select role, scope from account_roles where account_id = $1', [account.id]);
  const teacher = teacherFor(phone);
  return {
    admin: isAdminPhone(phone) || rows.some((r) => r.role === 'hod'),
    teacher,
    cr: rows.filter((r) => r.role === 'cr').map((r) => r.scope),
  };
}

async function loadMe(phone) {
  const [account] = await db.q(
    `insert into accounts (phone) values ($1)
     on conflict (phone) do update set last_seen_at = now()
     returning id, name, created_at, (xmax = 0) as created`, [phone]);
  await db.q('insert into account_state (account_id) values ($1) on conflict (account_id) do nothing', [account.id]);
  if (account.created) await db.q('insert into audit_log (actor, action, target) values ($1, $2, $3)', [account.id, 'account.create', account.id]);
  const [state] = await db.q('select profile, data, version, updated_at from account_state where account_id = $1', [account.id]);
  const [enr] = await db.q(`select division_code, status from enrollments where account_id = $1 order by created_at desc limit 1`, [account.id]);
  return { account, state, enrollment: enr || null };
}

async function getMe(req, res, phone) {
  const { account, state, enrollment } = await loadMe(phone);
  const roles = await rolesFor(account, phone);
  return send(res, 200, {
    ok: true,
    account: { id: account.id, name: account.name, createdAt: account.created_at },
    profile: state.profile, data: state.data, version: state.version, updatedAt: state.updated_at,
    enrollment, ...roles,
  });
}

async function putMe(req, res, phone) {
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!isPlainObject(body)) return fail(res, 400, 'INVALID_BODY', 'Send a JSON object.');
  const { profile, data, baseVersion } = body;
  if (!Number.isInteger(baseVersion) || baseVersion < 0) return fail(res, 400, 'INVALID_VERSION', 'baseVersion is required.');
  if (profile !== undefined && !isPlainObject(profile)) return fail(res, 400, 'INVALID_PROFILE', 'profile must be an object.');
  if (data !== undefined && !isPlainObject(data)) return fail(res, 400, 'INVALID_DATA', 'data must be an object.');
  const p = profile === undefined ? null : JSON.stringify(cleanProfile(profile));
  const d = data === undefined ? null : JSON.stringify(data);
  if (p && p.length > MAX_PROFILE) return fail(res, 413, 'PROFILE_TOO_LARGE', 'Profile is too large.');
  if (d && d.length > MAX_DATA) return fail(res, 413, 'DATA_TOO_LARGE', 'Saved data is too large.');

  const { account } = await loadMe(phone);
  const rows = await db.q(
    `update account_state
        set profile = coalesce($2::jsonb, profile), data = coalesce($3::jsonb, data),
            version = version + 1, updated_at = now()
      where account_id = $1 and version = $4
      returning profile, data, version, updated_at`, [account.id, p, d, baseVersion]);
  if (!rows.length) {
    // Another device saved first: hand back the newer copy so the client can adopt it.
    const [cur] = await db.q('select profile, data, version, updated_at from account_state where account_id = $1', [account.id]);
    return fail(res, 409, 'VERSION_CONFLICT', 'This account was updated on another device.', { profile: cur.profile, data: cur.data, version: cur.version, updatedAt: cur.updated_at });
  }
  const name = p ? String(JSON.parse(p).name || '').trim().slice(0, 80) : null;
  if (name !== null && name !== account.name) await db.q('update accounts set name = $2 where id = $1', [account.id, name]);
  return send(res, 200, { ok: true, version: rows[0].version, updatedAt: rows[0].updated_at });
}

async function getDivisions(req, res) {
  const rows = await db.q('select code, branch_code, year, confirmed from divisions order by year, code');
  return send(res, 200, { ok: true, divisions: rows });
}

module.exports = async (req, res) => {
  const route = (req.query && req.query.route) || (req.url || '').split('?')[0].replace(/^.*\/app\/?/, '').replace(/\/+$/, '');
  try {
    const phone = getPhone(req);
    if (!phone) return fail(res, 401, 'NO_SESSION', 'Sign in required.');
    await db.ensureSchema();
    if (route === 'me' && req.method === 'GET') return await getMe(req, res, phone);
    if (route === 'me' && req.method === 'PUT') return await putMe(req, res, phone);
    if (route === 'divisions' && req.method === 'GET') return await getDivisions(req, res);
    return fail(res, 404, 'NOT_FOUND', 'Unknown route.');
  } catch (e) {
    if (e && e.code === 'DB_NOT_CONFIGURED') return fail(res, 503, 'DB_NOT_CONFIGURED', 'Cloud sync is not configured on the server.');
    console.error('app api error', route, e && e.code); // no personal data in logs
    return fail(res, 500, 'SERVER_ERROR', 'Something went wrong. Try again.');
  }
};
