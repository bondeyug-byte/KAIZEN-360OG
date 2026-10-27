// Builds `who` for api/_policy.js from the verified Google email, on EVERY request (so removing a teacher, HOD,
// CR or parent link takes effect on the very next request, not at next login).
// `who.phone` keeps its old name but now holds the identity (the lower-cased email); see api/_roles.js.
const db = require('./_db');
const { normalizeEmail, isInstitutional, hodEntries, teacherEntries } = require('./_roles');

/**
 * Settings → database, once per server instance: HOD_EMAILS (and @ves.ac.in entries of HOD_PHONES) is the only way
 * to become HOD; Google HOD rows not in the setting are deactivated. Teachers are added by their HOD in the HOD
 * portal; teacher emails in TEACHER_EMAILS / TEACHER_PHONES are copied in once.
 */
let synced = null;
function syncFromEnv() {
  synced = synced || (async () => {
    const branches = new Set((await db.q('select code from branches')).map((r) => r.code));
    const valid = hodEntries().filter((h) => branches.has(h.branch));
    for (const h of valid) await db.q(`insert into hod_assignments (phone, branch_code, active) values ($1, $2, true) on conflict (phone, branch_code) do update set active = true, updated_at = now()`, [h.email, h.branch]);
    // Only Google (email) HOD rows are managed here; rows from the earlier phone sign-in are left exactly as they are.
    await db.q(`update hod_assignments set active = false, updated_at = now() where active and position('@' in phone) > 0 and not ((phone || '=' || branch_code) = any($1::text[]))`, [valid.map((h) => `${h.email}=${h.branch}`)]);
    for (const t of teacherEntries()) {
      const added = await db.q(`insert into teacher_whitelist (phone, name, teaches) values ($1, $2, '[]'::jsonb) on conflict (phone) do nothing returning phone`, [t.email, t.name || 'Teacher']);
      if (!added.length) continue; // copied once; the HOD manages them from then on
      for (const d of t.teaches) await db.q(`insert into teacher_divisions (teacher_phone, division_code, subject) select $1, $2, $3 where exists (select 1 from divisions where code = $2) on conflict do nothing`, [t.email, d.division, d.subject]);
      await db.q(`update teacher_whitelist w set branch_code = (select d.branch_code from teacher_divisions t join divisions d on d.code = t.division_code where t.teacher_phone = w.phone limit 1) where phone = $1`, [t.email]);
    }
  })().catch((e) => { synced = null; throw e; });
  return synced;
}
const key = (id) => normalizeEmail(id);

async function hodBranches(phone) {
  return (await db.q('select branch_code from hod_assignments where phone = $1 and active order by branch_code', [key(phone)])).map((r) => r.branch_code);
}

/** Active teacher record from the database, or null. */
async function teacherRecord(phone) {
  const p = key(phone);
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
  return (await db.q(`select student_id from parent_links where parent_phone = $1 and status = 'approved'`, [key(phone)])).map((r) => r.student_id);
}
async function isEnrolledPhone(phone) {
  return (await db.q(`select 1 from accounts a join class_enrollments e on e.student_id = a.id and e.status = 'active' where a.phone = $1 limit 1`, [key(phone)])).length > 0;
}

/**
 * Role for the sign-in server (works before an account exists).
 * Staff and students need an @ves.ac.in account; any other address can only ever be a confirmed parent.
 * base 'none' = signed in with Google but no access (wrong domain and not a confirmed parent).
 */
async function signInRole(email) {
  await db.ensureSchema(); await syncFromEnv();
  const phone = key(email);
  if (!phone) return { base: 'none', hod: null, teacher: null };
  if (!isInstitutional(phone)) {
    const children = await parentOf(phone);
    return children.length ? { base: 'parent', hod: null, teacher: null, parent: { children: children.length } } : { base: 'none', hod: null, teacher: null };
  }
  const branches = await hodBranches(phone);
  if (branches.length) return { base: 'hod', hod: { branches }, teacher: null };
  const teacher = await teacherRecord(phone);
  if (teacher) return { base: 'teacher', hod: null, teacher };
  const children = await parentOf(phone)
  if (children.length && !(await isEnrolledPhone(phone))) return { base: 'parent', hod: null, teacher: null, parent: { children: children.length } };
  return { base: 'student', hod: null, teacher: null };
}

/** `issuedAt` (seconds) is the session cookie's iat: sessions from before a sign-out are refused. */
async function resolve(email, issuedAt = null) {
  await syncFromEnv();
  const phone = key(email);
  const inst = isInstitutional(phone);
  // Only institutional accounts and confirmed parents get an account row; anyone else is refused before that.
  const parentIdsEarly = inst ? [] : await parentOf(phone);
  if (!phone || (!inst && !parentIdsEarly.length)) return { account: null, phone, base: 'none', hodBranches: [], teacher: null, crDivisions: [], enrollment: null, divisions: new Map(), parentOf: [] };
  const [account] = await db.q(
    `insert into accounts (phone) values ($1) on conflict (phone) do update set last_seen_at = now()
     returning id, name, created_at, sessions_valid_after, (xmax = 0) as created`, [phone]);
  if (account.created) await db.audit(account.id, 'account.create', account.id);
  if (issuedAt !== null && account.sessions_valid_after && issuedAt < Math.floor(new Date(account.sessions_valid_after).getTime() / 1000)) {
    return { account: null, phone, base: 'none', ended: true, hodBranches: [], teacher: null, crDivisions: [], enrollment: null, divisions: new Map(), parentOf: [] };
  }
  const divisions = new Map((await db.q('select code, branch_code, year_id, name, confirmed from divisions')).map((r) => [r.code, r]));
  const branches = inst ? await hodBranches(phone) : [];
  const teacher = !inst || branches.length ? null : await teacherRecord(phone);
  let base = branches.length ? 'hod' : teacher ? 'teacher' : inst ? 'student' : 'parent';
  let enrollment = null, crDivisions = [], parentIds = inst ? [] : parentIdsEarly;
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
