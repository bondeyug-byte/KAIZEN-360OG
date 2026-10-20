// Who is this signed-in person? Resolved on the server from the verified phone only.
//   HOD/admin : ADMIN_PHONES setting, or an 'hod' row in account_roles
//   teacher   : TEACHER_PHONES setting and/or the HOD-managed teacher_whitelist table
//   class rep : 'cr' rows in account_roles (scope = division code)
//   class     : the student's approved enrollment
const db = require('./_db');
const { normalizePhone, isAdminPhone, teacherFor } = require('./_roles');

/** Teacher record from settings + database, or null. Works without a database (settings only). */
async function teacherRecord(phone) {
  const fromEnv = teacherFor(phone);
  let row = null;
  try { [row] = await db.q('select name, code, teaches, can_publish_timetable from teacher_whitelist where phone = $1', [normalizePhone(phone)]); }
  catch (e) { if (e.code !== 'DB_NOT_CONFIGURED') throw e; }
  if (!fromEnv && !row) return null;
  const teaches = [...(fromEnv ? fromEnv.teaches : []), ...((row && row.teaches) || [])];
  const seen = new Set();
  return {
    name: (row && row.name) || (fromEnv && fromEnv.name) || '',
    code: (row && row.code) || '',
    teaches: teaches.filter((t) => { const k = t.division + '|' + t.subject; if (seen.has(k)) return false; seen.add(k); return true; }),
    canPublishTimetable: row ? !!row.can_publish_timetable : true,
  };
}

async function upsertAccount(phone) {
  const [account] = await db.q(
    `insert into accounts (phone) values ($1) on conflict (phone) do update set last_seen_at = now()
     returning id, name, created_at, (xmax = 0) as created`, [phone]);
  if (account.created) await db.audit(account.id, 'account.create', account.id);
  return account;
}

async function resolve(phone) {
  const account = await upsertAccount(phone);
  const roles = await db.q('select role, scope from account_roles where account_id = $1', [account.id]);
  const [enr] = await db.q(
    `select division_code, status, decided_at from enrollments where account_id = $1
     order by (status = 'approved') desc, created_at desc limit 1`, [account.id]);
  return {
    account, phone,
    admin: isAdminPhone(phone) || roles.some((r) => r.role === 'hod'),
    teacher: await teacherRecord(phone),
    cr: roles.filter((r) => r.role === 'cr').map((r) => r.scope),
    enrollment: enr || null,
    approvedDivision: enr && enr.status === 'approved' ? enr.division_code : null,
  };
}

/** Divisions this person may publish to. HOD: all. Teacher: their assigned divisions. */
async function postableDivisions(who) {
  if (who.admin) return (await db.q('select code from divisions')).map((r) => r.code);
  return who.teacher ? [...new Set(who.teacher.teaches.map((t) => t.division))] : [];
}

module.exports = { resolve, teacherRecord, postableDivisions };
