// Builds `who` for api/_policy.js from the verified phone, on EVERY request (so removing a teacher, HOD or CR
// takes effect on the very next request, not at next login).
const db = require('./_db');
const { normalizePhone, teacherFor, hodEntries } = require('./_roles');

/**
 * Settings → database, once per server instance:
 *  - HOD_PHONES is the only way to become HOD. Rows not in the setting are deactivated.
 *  - TEACHER_PHONES is copied into teacher_whitelist ONCE per number (never re-activates a teacher the HOD removed).
 */
let synced = null;
function syncFromEnv() {
  synced = synced || (async () => {
    const hods = hodEntries().filter((h) => h);
    const branches = new Set((await db.q('select code from branches')).map((r) => r.code));
    const valid = hods.filter((h) => branches.has(h.branch));
    for (const h of valid) await db.q(`insert into hod_assignments (phone, branch_code, active) values ($1, $2, true) on conflict (phone, branch_code) do update set active = true, updated_at = now()`, [h.phone, h.branch]);
    await db.q(`update hod_assignments set active = false, updated_at = now() where active and not ((phone || '=' || branch_code) = any($1::text[]))`, [valid.map((h) => `${h.phone}=${h.branch}`)]);
    for (const raw of String(process.env.TEACHER_PHONES || '').split(';')) {
      const phone = normalizePhone(raw.slice(0, raw.indexOf('=')).trim());
      const rec = phone && teacherFor(phone);
      if (!rec) continue;
      const added = await db.q(`insert into teacher_whitelist (phone, name, teaches) values ($1, $2, '[]'::jsonb) on conflict (phone) do nothing returning phone`, [phone, rec.name]);
      if (!added.length) continue;
      for (const t of rec.teaches) await db.q(`insert into teacher_divisions (teacher_phone, division_code, subject) select $1, $2, $3 where exists (select 1 from divisions where code = $2) on conflict do nothing`, [phone, t.division, t.subject]);
      await db.q(`update teacher_whitelist w set branch_code = (select d.branch_code from teacher_divisions t join divisions d on d.code = t.division_code where t.teacher_phone = w.phone limit 1) where phone = $1`, [phone]);
    }
  })().catch((e) => { synced = null; throw e; });
  return synced;
}

async function hodBranches(phone) {
  return (await db.q('select branch_code from hod_assignments where phone = $1 and active order by branch_code', [normalizePhone(phone)])).map((r) => r.branch_code);
}

/** Active teacher record from the database, or null. */
async function teacherRecord(phone) {
  const p = normalizePhone(phone);
  const [row] = await db.q('select name, code, branch_code, can_publish_timetable from teacher_whitelist where phone = $1 and active', [p]);
  if (!row) return null;
  const divs = await db.q('select division_code, subject from teacher_divisions where teacher_phone = $1 order by division_code', [p]);
  return {
    name: row.name, code: row.code, branch: row.branch_code, canPublishTimetable: !!row.can_publish_timetable,
    divisions: [...new Set(divs.map((r) => r.division_code))],
    teaches: divs.map((r) => ({ division: r.division_code, subject: r.subject })), // shape the app already uses
  };
}

/** Student accounts this phone is an APPROVED parent/guardian of (the college confirmed the link). */
async function parentOf(phone) {
  return (await db.q(`select student_id from parent_links where parent_phone = $1 and status = 'approved'`, [normalizePhone(phone)])).map((r) => r.student_id);
}
async function isEnrolledPhone(phone) {
  return (await db.q(`select 1 from accounts a join class_enrollments e on e.student_id = a.id and e.status = 'active' where a.phone = $1 limit 1`, [normalizePhone(phone)])).length > 0;
}

/** Role for the sign-in server (works before an account exists). */
async function signInRole(phone) {
  await db.ensureSchema(); await syncFromEnv();
  const branches = await hodBranches(phone);
  if (branches.length) return { base: 'hod', hod: { branches }, teacher: null };
  const teacher = await teacherRecord(phone);
  if (teacher) return { base: 'teacher', hod: null, teacher };
  const children = await parentOf(phone)
  if (children.length && !(await isEnrolledPhone(phone))) return { base: 'parent', hod: null, teacher: null, parent: { children: children.length } };
  return { base: 'student', hod: null, teacher: null };
}

async function resolve(phone) {
  await syncFromEnv();
  const [account] = await db.q(
    `insert into accounts (phone) values ($1) on conflict (phone) do update set last_seen_at = now()
     returning id, name, created_at, (xmax = 0) as created`, [phone]);
  if (account.created) await db.audit(account.id, 'account.create', account.id);
  const divisions = new Map((await db.q('select code, branch_code, year_id, name, confirmed from divisions')).map((r) => [r.code, r]));
  const branches = await hodBranches(phone);
  const teacher = branches.length ? null : await teacherRecord(phone);
  let base = branches.length ? 'hod' : teacher ? 'teacher' : 'student';
  let enrollment = null, crDivisions = [], parentIds = [];
  if (base === 'student') {
    parentIds = await parentOf(phone);
    if (parentIds.length && !(await isEnrolledPhone(phone))) base = 'parent'; // an enrolled student stays a student
  }
  if (base === 'student') {
    [enrollment] = await db.q(`select division_code, year_id, approved_at from class_enrollments where student_id = $1 and status = 'active' order by approved_at desc limit 1`, [account.id]);
    crDivisions = (await db.q('select division_code from cr_assignments where student_id = $1 and active', [account.id])).map((r) => r.division_code);
  }
  return { account, phone, base, hodBranches: branches, teacher, crDivisions, enrollment: enrollment || null, divisions, parentOf: base === 'parent' ? parentIds : [] };
}

module.exports = { resolve, signInRole, teacherRecord, hodBranches, syncFromEnv, parentOf };
