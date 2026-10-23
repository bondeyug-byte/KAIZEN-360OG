// api/app.js — Campus360 college portal API (one serverless function, routed by ?route=).
// Every request: verified cookie → load user from DB (api/_access.js) → can() (api/_policy.js) → validate →
// act (multi-row changes in single SQL statements, so they succeed or fail together) → audit log → clear error.
const { getPhone } = require('./_session');
const { normalizePhone } = require('./_roles');
const access = require('./_access');
const { can, allowedDivisions } = require('./_policy');
const tt = require('./_timetable');
const db = require('./_db');
const records = require('./_records');

const MAX_PROFILE = 8 * 1024, MAX_DATA = 200 * 1024, MAX_FILE = 3 * 1024 * 1024, PAGE = 50;
const PROTECTED = ['id', 'role', 'roles', 'teaches', 'phone', 'phoneVerified', 'authMethod', 'demo', 'classRep', 'academicHistory', 'admin', 'teacher', 'hod'];
const FILE_TYPES = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
const TERM_RE = /^[A-Za-z0-9 _.-]{2,40}$/;
const SENT = Symbol('sent'); // a handler already wrote the response (file download)

class HttpError extends Error { constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; } }
const bad = (code, message, extra) => new HttpError(400, code, message, extra);
const forbidden = (message = 'You are not allowed to do this.') => new HttpError(403, 'FORBIDDEN', message);
const conflict = (code, message) => new HttpError(409, code, message);
const notFound = (message) => new HttpError(404, 'NOT_FOUND', message);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const txt = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
const mask = (p) => (p ? `${p.slice(0, 3)} ${p.slice(3, 5)}xxxx ${p.slice(-4)}` : '');
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const page = (req) => Math.max(0, Math.min(1000, parseInt(req.query.page, 10) || 0));
function body(req) {
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  if (!isObj(b)) throw bad('INVALID_BODY', 'Send a JSON object.');
  return b;
}
async function limit(key, max, sec) { if (!(await db.allow(key, max, sec))) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Wait a few minutes and try again.'); }
const need = (who, action, res, message) => { if (!can(who, action, res)) throw forbidden(message); };
const branchOf = (who, code) => (who.divisions.get(code) || {}).branch_code || null;
const roleName = (who, division) => (who.base === 'student' && who.crDivisions.includes(division) ? 'cr' : who.base);
async function setting(key, fallback) { const [r] = await db.q('select value from settings where key = $1', [key]); return r ? Number(r.value) : fallback; }
const displayName = (who) => txt((who.teacher && who.teacher.name) || who.account.name || (who.base === 'hod' ? 'HOD' : who.base === 'teacher' ? 'Teacher' : 'Class rep'), 80);
function division(who, v) { const code = txt(v, 10).toUpperCase(); if (!who.divisions.has(code)) throw bad('UNKNOWN_DIVISION', 'Choose a division from the list.'); return code; }

/* ============================== account ============================== */
async function getMe(who) {
  await db.q('insert into account_state (account_id) values ($1) on conflict (account_id) do nothing', [who.account.id]);
  const [state] = await db.q('select profile, data, version, updated_at from account_state where account_id = $1', [who.account.id]);
  const [joinRequest] = await db.q(`select id, division_code, status, kind, from_division, reason, note, created_at, decided_at from join_requests where student_id = $1 order by created_at desc limit 1`, [who.account.id]);
  const [crRequest] = await db.q(`select id, division_code, status, note, created_at from cr_requests where student_id = $1 order by created_at desc limit 1`, [who.account.id]);
  const reviewDivs = allowedDivisions(who, 'join.decide');
  const [{ n: pendingJoins }] = reviewDivs.length ? await db.q(`select count(*)::int as n from join_requests where status = 'pending' and division_code = any($1) and student_id <> $2`, [reviewDivs, who.account.id]) : [{ n: 0 }];
  const crDivs = allowedDivisions(who, 'cr.decide');
  const [{ n: pendingCr }] = crDivs.length ? await db.q(`select count(*)::int as n from cr_requests where status = 'pending' and division_code = any($1)`, [crDivs]) : [{ n: 0 }];
  const [{ n: openInstructions }] = who.base === 'teacher' ? await db.q(`select count(*)::int as n from instruction_recipients where teacher_phone = $1 and status = 'sent'`, [who.phone]) : [{ n: 0 }];
  return {
    account: { id: who.account.id, name: who.account.name, createdAt: who.account.created_at },
    profile: state.profile, data: state.data, version: state.version, updatedAt: state.updated_at,
    role: who.base, hod: who.base === 'hod' ? { branches: who.hodBranches } : null, teacher: who.teacher, parent: who.base === 'parent' ? { children: who.parentOf.length } : null,
    cr: who.crDivisions.filter((d) => who.enrollment && who.enrollment.division_code === d),
    enrollment: who.enrollment, joinRequest: joinRequest || null, crRequest: crRequest || null,
    counts: { pendingJoins, pendingCr, openInstructions }, admin: false,
  };
}
async function putMe(who, req) {
  const { profile, data, baseVersion } = body(req);
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw bad('INVALID_VERSION', 'baseVersion is required.');
  if (profile !== undefined && !isObj(profile)) throw bad('INVALID_PROFILE', 'profile must be an object.');
  if (data !== undefined && !isObj(data)) throw bad('INVALID_DATA', 'data must be an object.');
  const clean = profile === undefined ? null : Object.fromEntries(Object.entries(profile).filter(([k]) => !PROTECTED.includes(k)));
  const p = clean && JSON.stringify(clean), d = data === undefined ? null : JSON.stringify(data);
  if (p && p.length > MAX_PROFILE) throw new HttpError(413, 'PROFILE_TOO_LARGE', 'Profile is too large.');
  if (d && d.length > MAX_DATA) throw new HttpError(413, 'DATA_TOO_LARGE', 'Saved data is too large.');
  await db.q('insert into account_state (account_id) values ($1) on conflict (account_id) do nothing', [who.account.id]);
  const rows = await db.q(
    `update account_state set profile = coalesce($2::jsonb, profile), data = coalesce($3::jsonb, data), version = version + 1, updated_at = now()
      where account_id = $1 and version = $4 returning version, updated_at`, [who.account.id, p, d, baseVersion]);
  if (!rows.length) {
    const [cur] = await db.q('select profile, data, version, updated_at from account_state where account_id = $1', [who.account.id]);
    throw new HttpError(409, 'VERSION_CONFLICT', 'This account was updated on another device.', { profile: cur.profile, data: cur.data, version: cur.version, updatedAt: cur.updated_at });
  }
  if (clean) { const name = txt(clean.name, 80); if (name !== who.account.name) await db.q('update accounts set name = $2 where id = $1', [who.account.id, name]); }
  return { version: rows[0].version, updatedAt: rows[0].updated_at };
}

/** Branches → years → divisions, all from the database, with what THIS user may do in each division. */
async function catalog(who) {
  const branches = await db.q('select code, name from branches where active order by name');
  const years = await db.q('select id, label, calendar, level from academic_years where active order by level, calendar');
  const flags = (code) => ({ post: can(who, 'post.create', { division: code }), notice: can(who, 'notice.create', { division: code }), publish: can(who, 'timetable.publish', { division: code }), review: can(who, 'join.decide', { division: code }), record: can(who, 'attendance.record', { division: code }), alertPublish: can(who, 'alert.publish', { division: code }), parents: can(who, 'parent.link.decide', { division: code }) });
  const divisions = [...who.divisions.values()].filter((d) => d.year_id).sort((a, b) => a.code.localeCompare(b.code)).map((d) => ({ code: d.code, name: d.name, branch_code: d.branch_code, year_id: d.year_id, confirmed: d.confirmed, can: flags(d.code) }));
  return { branches, years, divisions };
}

/* ============================== joining a class ============================== */
async function joinRequest(who, req) {
  need(who, 'join.request', {}, who.base === 'student' ? undefined : 'Teacher and HOD numbers cannot join a class as a student.');
  await limit(`join:${who.account.id}`, 10, 3600);
  const b = body(req);
  const div = division(who, b.division);
  const [pending] = await db.q(`select division_code, kind from join_requests where student_id = $1 and status = 'pending'`, [who.account.id]);
  if (pending) throw conflict('PENDING_EXISTS', `You already asked to ${pending.kind === 'transfer' ? 'move to' : 'join'} ${pending.division_code}. Cancel that request first.`);
  // Already in a class: this becomes a change-of-division request (same branch and year), decided by the
  // target class teacher or the HOD. The student stays in the current class until it is approved.
  let transfer = null;
  if (who.enrollment) {
    need(who, 'transfer.request', {});
    const from = who.enrollment.division_code, cur = who.divisions.get(from), to = who.divisions.get(div);
    if (div === from) throw bad('SAME_DIVISION', `You are already in ${div}.`);
    if (!cur || cur.year_id !== to.year_id || cur.branch_code !== to.branch_code) throw bad('OTHER_BRANCH_OR_YEAR', `You can move only to another division of your own branch and year. For a branch or year change, ask your HOD.`);
    const reason = txt(b.reason, 300);
    if (reason.length < 5) throw bad('REASON_REQUIRED', 'Say briefly why you need to change division.');
    transfer = { from, reason };
  }
  const cap = await setting('division_capacity', 65);
  const [{ n }] = await db.q(`select count(*)::int as n from class_enrollments where division_code = $1 and status = 'active'`, [div]);
  if (n >= cap) throw conflict('DIVISION_FULL', `${div} is full (${cap} students). Check your division or contact your HOD.`);
  const [r] = await db.q(`insert into join_requests (student_id, division_code, kind, from_division, reason) values ($1, $2, $3, $4, $5)
    returning id, division_code, status, kind, from_division, reason, created_at`, [who.account.id, div, transfer ? 'transfer' : 'join', transfer ? transfer.from : null, transfer ? transfer.reason : '']);
  await db.audit(who.account.id, transfer ? 'transfer.request' : 'join.request', r.id, transfer ? { division: div, from: transfer.from } : { division: div }, branchOf(who, div));
  return { joinRequest: r };
}
async function cancelJoin(who, req) {
  if (!isUuid(req.query.id)) throw bad('INVALID_ID', 'Unknown request.');
  const rows = await db.q(`update join_requests set status = 'cancelled', decided_at = now(), decided_by = $2, decided_as = 'student' where id = $1 and student_id = $2 and status = 'pending' returning division_code`, [req.query.id, who.account.id]);
  if (!rows.length) throw notFound('No waiting request to cancel.');
  await db.audit(who.account.id, 'join.cancel', req.query.id, { division: rows[0].division_code }, branchOf(who, rows[0].division_code));
  return { cancelled: req.query.id };
}
async function listJoins(who, req) {
  const scope = allowedDivisions(who, 'join.view');
  if (!scope.length) throw forbidden('You review join requests only for classes you teach, represent or head.');
  const divs = req.query.division ? [division(who, req.query.division)] : scope;
  if (divs.some((d) => !scope.includes(d))) throw forbidden('That class is not yours to manage.');
  const history = req.query.status === 'decided';
  const showPhone = who.base !== 'student'; // class reps never see phone numbers
  const rows = await db.q(
    `select j.id, j.student_id, j.division_code, j.status, j.kind, j.from_division, j.reason, j.note, j.created_at, j.decided_at, j.decided_as, a.name, a.phone,
            s.profile->>'roll' as roll, dec.name as decided_by_name
       from join_requests j join accounts a on a.id = j.student_id left join account_state s on s.account_id = j.student_id
       left join accounts dec on dec.id = j.decided_by
      where j.division_code = any($1) and ${history ? `j.status in ('approved', 'rejected')` : `j.status = 'pending'`}
        and (j.kind = 'join' or $3::boolean)
      order by ${history ? 'j.decided_at desc' : 'j.created_at asc'} limit ${PAGE + 1} offset $2`, [divs, page(req) * PAGE, showPhone]);
  // class reps see new-student requests only; changes of division (with the student's reason) go to staff
  const [{ n }] = await db.q(`select count(*)::int as n from join_requests where status = 'pending' and division_code = any($1) and (kind = 'join' or $2::boolean)`, [scope, showPhone]);
  return { requests: rows.slice(0, PAGE).map(({ phone, ...r }) => ({ ...r, phone: showPhone ? mask(phone) : undefined, self: r.student_id === who.account.id })), more: rows.length > PAGE, pendingTotal: n };
}
/** Accept/reject up to 50 requests. The first valid decision wins: every update is conditional on the status. */
async function decideJoins(who, req) {
  const b = body(req);
  const decision = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : null;
  if (!decision) throw bad('INVALID_DECISION', 'Decision must be approve or reject.');
  const ids = Array.isArray(b.ids) ? [...new Set(b.ids)] : [];
  if (!ids.length || ids.length > 50 || !ids.every(isUuid)) throw bad('INVALID_IDS', 'Choose between 1 and 50 requests.');
  const note = txt(b.note, 300);
  const cap = await setting('division_capacity', 65);
  const results = [];
  for (const id of ids) {
    const [r] = await db.q('select id, student_id, division_code, status, kind, from_division from join_requests where id = $1', [id]);
    const fail = (error) => results.push({ id, ok: false, error });
    if (!r) { fail('Request not found.'); continue; }
    if (!can(who, 'join.decide', { division: r.division_code })) { fail(`You can't manage ${r.division_code}.`); continue; }
    if (r.student_id === who.account.id) { fail('You cannot decide your own request.'); continue; }
    const isTransfer = r.kind === 'transfer';
    if (isTransfer && !can(who, 'transfer.decide', { division: r.division_code })) { fail(`A change of division into ${r.division_code} is decided by its class teacher or the HOD.`); continue; }
    const hodOverride = !isTransfer && can(who, 'join.override', { division: r.division_code });
    const from = hodOverride && decision === 'approved' ? ['pending', 'rejected'] : ['pending'];
    const as = roleName(who, r.division_code);
    let done;
    if (decision === 'approved' && isTransfer) {
      // One statement: approve, archive the old class, end any CR role there, open the new class.
      // If the student is no longer in from_division (or the target is full) nothing changes.
      done = await db.q(
        `with r as (
           update join_requests j set status = 'approved', decided_by = $2, decided_at = now(), decided_as = $3, note = $4
            where j.id = $1 and j.status = 'pending' and j.kind = 'transfer'
              and exists (select 1 from class_enrollments e where e.student_id = j.student_id and e.division_code = j.from_division and e.status = 'active')
              and (select count(*) from class_enrollments e where e.division_code = j.division_code and e.status = 'active') < $5
            returning j.id, j.student_id, j.division_code, j.from_division),
         old as (
           update class_enrollments e set status = 'archived', archived_by = $2, archived_at = now()
             from r where e.student_id = r.student_id and e.division_code = r.from_division and e.status = 'active'
           returning e.student_id),
         cr as (
           update cr_assignments c set active = false, removed_by = $2, removed_at = now()
             from r where c.student_id = r.student_id and c.division_code = r.from_division and c.active
           returning c.student_id),
         crq as (
           update cr_requests q set status = 'cancelled', decided_at = now(), note = 'Moved to another division'
             from r where q.student_id = r.student_id and q.division_code = r.from_division and q.status = 'pending'
           returning q.id)
         insert into class_enrollments (student_id, division_code, year_id, approved_by, request_id)
         select r.student_id, r.division_code, d.year_id, $2, r.id from r join old on old.student_id = r.student_id join divisions d on d.code = r.division_code
         on conflict (student_id, division_code, year_id) do update set status = 'active', approved_by = excluded.approved_by, approved_at = now(), request_id = excluded.request_id, archived_by = null, archived_at = null
         returning student_id`, [id, who.account.id, as, note, cap]);
    } else if (decision === 'approved') {
      done = await db.q(
        `with r as (
           update join_requests j set status = 'approved', decided_by = $2, decided_at = now(), decided_as = $4, note = $5
            where j.id = $1 and j.status = any($3::text[])
              and not exists (select 1 from class_enrollments e join divisions d on d.code = j.division_code where e.student_id = j.student_id and e.year_id = d.year_id and e.status = 'active')
              and (select count(*) from class_enrollments e where e.division_code = j.division_code and e.status = 'active') < $6
            returning j.id, j.student_id, j.division_code)
         insert into class_enrollments (student_id, division_code, year_id, approved_by, request_id)
         select r.student_id, r.division_code, d.year_id, $2, r.id from r join divisions d on d.code = r.division_code
         on conflict (student_id, division_code, year_id) do update set status = 'active', approved_by = excluded.approved_by, approved_at = now(), request_id = excluded.request_id, archived_by = null, archived_at = null
         returning student_id`, [id, who.account.id, from, as, note, cap]);
    } else {
      done = await db.q(`update join_requests set status = 'rejected', decided_by = $2, decided_at = now(), decided_as = $3, note = $4 where id = $1 and status = 'pending' returning id`, [id, who.account.id, as, note]);
    }
    if (!done.length) {
      const [now] = await db.q(`select j.status, a.name from join_requests j left join accounts a on a.id = j.decided_by where j.id = $1`, [id]);
      const [{ n }] = await db.q(`select count(*)::int as n from class_enrollments where division_code = $1 and status = 'active'`, [r.division_code]);
      fail(now.status !== r.status || !from.includes(now.status) ? `Already ${now.status}${now.name ? ` by ${now.name}` : ''}.` : n >= cap ? `${r.division_code} is full (${cap}).` : isTransfer ? `This student is no longer in ${r.from_division}.` : 'This student is already in a class this year.');
      continue;
    }
    await db.audit(who.account.id, `${isTransfer ? 'transfer' : 'join'}.${decision === 'approved' ? 'approve' : 'reject'}`, id, { division: r.division_code, ...(isTransfer ? { from: r.from_division } : {}), by: as, override: r.status !== 'pending' }, branchOf(who, r.division_code));
    results.push({ id, ok: true, status: decision });
  }
  return { results, approved: results.filter((x) => x.ok).length };
}
async function revokeEnrollment(who, req) {
  const b = body(req);
  const div = division(who, b.division);
  need(who, 'enrollment.revoke', { division: div }, 'Only the HOD of this branch can remove a student from a class.');
  if (!isUuid(b.studentId)) throw bad('INVALID_ID', 'Unknown student.');
  const rows = await db.q(`update class_enrollments set status = 'archived', archived_by = $3, archived_at = now() where student_id = $1 and division_code = $2 and status = 'active' returning student_id`, [b.studentId, div, who.account.id]);
  if (!rows.length) throw notFound('That student is not in this class.');
  await db.q(`update cr_assignments set active = false, removed_by = $3, removed_at = now() where student_id = $1 and division_code = $2 and active`, [b.studentId, div, who.account.id]);
  await db.audit(who.account.id, 'enrollment.revoke', b.studentId, { division: div, note: txt(b.note, 200) }, branchOf(who, div));
  return { revoked: true };
}
async function roster(who, req) {
  const div = division(who, req.query.division);
  need(who, 'roster.view', { division: div });
  const showPhone = who.base !== 'student';
  const rows = await db.q(
    `select a.id, a.name, a.phone, s.profile->>'roll' as roll, e.approved_at,
            exists (select 1 from cr_assignments c where c.student_id = a.id and c.division_code = $1 and c.active) as is_cr
       from class_enrollments e join accounts a on a.id = e.student_id left join account_state s on s.account_id = a.id
      where e.division_code = $1 and e.status = 'active' order by nullif(s.profile->>'roll', '') nulls last, a.name limit 300`, [div]);
  return { division: div, students: rows.map(({ phone, ...r }) => ({ ...r, phone: showPhone ? mask(phone) : undefined })) };
}

/* ============================== class representatives ============================== */
async function crRequest(who) {
  const div = who.enrollment && who.enrollment.division_code;
  if (!div) throw forbidden('Join your class first.');
  need(who, 'cr.request', { division: div }, 'You are already a class representative.');
  await limit(`crreq:${who.account.id}`, 5, 3600);
  const max = await setting('max_crs_per_division', 2);
  const [{ n }] = await db.q(`select count(*)::int as n from cr_assignments where division_code = $1 and active`, [div]);
  if (n >= max) throw conflict('CR_FULL', `${div} already has ${max} class representatives.`);
  const [p] = await db.q(`select 1 from cr_requests where student_id = $1 and status = 'pending'`, [who.account.id]);
  if (p) throw conflict('PENDING_EXISTS', 'Your request is already waiting for a decision.');
  const [r] = await db.q(`insert into cr_requests (student_id, division_code) values ($1, $2) returning id, division_code, status, created_at`, [who.account.id, div]);
  await db.audit(who.account.id, 'cr.request', r.id, { division: div }, branchOf(who, div));
  return { crRequest: r };
}
async function cancelCr(who, req) {
  if (!isUuid(req.query.id)) throw bad('INVALID_ID', 'Unknown request.');
  const rows = await db.q(`update cr_requests set status = 'cancelled', decided_at = now(), decided_by = $2 where id = $1 and student_id = $2 and status = 'pending' returning id`, [req.query.id, who.account.id]);
  if (!rows.length) throw notFound('No waiting request to cancel.');
  return { cancelled: req.query.id };
}
async function listCr(who, req) {
  const scope = allowedDivisions(who, 'cr.decide');
  if (!scope.length) throw forbidden('Only teachers and HODs review class-representative requests.');
  const history = req.query.status === 'decided';
  const rows = await db.q(
    `select c.id, c.student_id, c.division_code, c.status, c.note, c.created_at, c.decided_at, a.name, s.profile->>'roll' as roll, dec.name as decided_by_name
       from cr_requests c join accounts a on a.id = c.student_id left join account_state s on s.account_id = c.student_id left join accounts dec on dec.id = c.decided_by
      where c.division_code = any($1) and ${history ? `c.status in ('approved', 'rejected')` : `c.status = 'pending'`}
      order by c.created_at desc limit ${PAGE + 1} offset $2`, [scope, page(req) * PAGE]);
  return { requests: rows.slice(0, PAGE), more: rows.length > PAGE };
}
async function decideCr(who, req) {
  const b = body(req);
  const decision = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : null;
  if (!decision || !isUuid(b.id)) throw bad('INVALID', 'Choose a request and approve or reject.');
  const [r] = await db.q('select id, student_id, division_code, status from cr_requests where id = $1', [b.id]);
  if (!r) throw notFound('Request not found.');
  need(who, 'cr.decide', { division: r.division_code }, `You can't decide class-rep requests for ${r.division_code}.`);
  const note = txt(b.note, 300);
  if (decision === 'rejected') {
    const rows = await db.q(`update cr_requests set status = 'rejected', decided_by = $2, decided_at = now(), note = $3 where id = $1 and status = 'pending' returning id`, [b.id, who.account.id, note]);
    if (!rows.length) throw conflict('ALREADY_DECIDED', 'This request was already decided.');
  } else {
    const max = await setting('max_crs_per_division', 2);
    const rows = await db.q(
      `with r as (
         update cr_requests c set status = 'approved', decided_by = $2, decided_at = now(), note = $3
          where c.id = $1 and c.status = 'pending'
            and exists (select 1 from class_enrollments e where e.student_id = c.student_id and e.division_code = c.division_code and e.status = 'active')
            and (select count(*) from cr_assignments x where x.division_code = c.division_code and x.active) < $4
          returning c.student_id, c.division_code)
       insert into cr_assignments (student_id, division_code, assigned_by) select student_id, division_code, $2 from r
       on conflict (student_id, division_code) do update set active = true, assigned_by = excluded.assigned_by, assigned_at = now(), removed_by = null, removed_at = null
       returning student_id`, [b.id, who.account.id, note, max]);
    if (!rows.length) throw conflict('CANNOT_APPROVE', `Not approved: already decided, the student left ${r.division_code}, or it already has ${max} class reps.`);
  }
  await db.audit(who.account.id, `cr.${decision === 'approved' ? 'approve' : 'reject'}`, b.id, { division: r.division_code }, branchOf(who, r.division_code));
  return { status: decision };
}
async function assignCr(who, req) {
  const b = body(req);
  const div = division(who, b.division);
  if (!isUuid(b.studentId)) throw bad('INVALID_ID', 'Unknown student.');
  if (b.action === 'remove') {
    need(who, 'cr.remove', { division: div }, 'Only the HOD of this branch can remove a class rep.');
    const rows = await db.q(`update cr_assignments set active = false, removed_by = $3, removed_at = now() where student_id = $1 and division_code = $2 and active returning student_id`, [b.studentId, div, who.account.id]);
    if (!rows.length) throw notFound('That student is not a class rep of this class.');
    await db.audit(who.account.id, 'cr.remove', b.studentId, { division: div }, branchOf(who, div));
    return { removed: true };
  }
  need(who, 'cr.assign', { division: div }, 'Only the HOD of this branch can appoint a class rep.');
  const max = await setting('max_crs_per_division', 2);
  const rows = await db.q(
    `insert into cr_assignments (student_id, division_code, assigned_by)
     select $1, $2, $3 where exists (select 1 from class_enrollments e where e.student_id = $1 and e.division_code = $2 and e.status = 'active')
       and (select count(*) from cr_assignments x where x.division_code = $2 and x.active and x.student_id <> $1) < $4
     on conflict (student_id, division_code) do update set active = true, assigned_by = excluded.assigned_by, assigned_at = now(), removed_by = null, removed_at = null
     returning student_id`, [b.studentId, div, who.account.id, max]);
  if (!rows.length) throw conflict('CANNOT_ASSIGN', `A class rep must be an approved student of ${div}, and a class can have at most ${max}.`);
  await db.q(`update cr_requests set status = 'approved', decided_by = $2, decided_at = now() where student_id = $1 and status = 'pending'`, [b.studentId, who.account.id]);
  await db.audit(who.account.id, 'cr.assign', b.studentId, { division: div }, branchOf(who, div));
  return { assigned: true };
}

/* ============================== HOD: teachers, instructions, dashboard ============================== */
const teacherCols = `w.phone, w.name, w.code, w.branch_code, w.active, w.can_publish_timetable, w.added_at,
  coalesce((select json_agg(json_build_object('division', t.division_code, 'subject', t.subject) order by t.division_code) from teacher_divisions t where t.teacher_phone = w.phone), '[]') as teaches`;
async function listTeachers(who) {
  if (who.base !== 'hod') throw forbidden('Only HODs manage teachers.');
  const rows = await db.q(`select ${teacherCols} from teacher_whitelist w
    where w.branch_code = any($1) or exists (select 1 from teacher_divisions t join divisions d on d.code = t.division_code where t.teacher_phone = w.phone and d.branch_code = any($1))
    order by w.active desc, w.name limit 500`, [who.hodBranches]);
  return { teachers: rows };
}
async function saveTeacher(who, req) {
  const b = body(req);
  const phone = normalizePhone(txt(b.phone, 20));
  if (!phone) throw bad('INVALID_PHONE', 'Enter a 10-digit Indian mobile number.');
  const branch = txt(b.branch || who.hodBranches[0], 10).toUpperCase();
  need(who, 'teacher.manage', { branch }, 'You can only add teachers to your own branch.');
  const [isHod] = await db.q('select 1 from hod_assignments where phone = $1 and active', [phone]);
  if (isHod) throw conflict('IS_HOD', 'That number belongs to an HOD. HOD outranks teacher, so it cannot be added as a teacher.');
  const [existing] = await db.q('select branch_code from teacher_whitelist where phone = $1', [phone]);
  if (existing && existing.branch_code && existing.branch_code !== branch && !who.hodBranches.includes(existing.branch_code)) {
    throw conflict('OTHER_BRANCH', `This teacher belongs to ${existing.branch_code}. You can still assign them to your divisions below.`);
  }
  const name = txt(b.name, 80), code = txt(b.code, 12).toUpperCase();
  if (name.length < 2) throw bad('INVALID_NAME', 'Enter the teacher’s name.');
  await db.q(
    `insert into teacher_whitelist (phone, name, code, branch_code, can_publish_timetable, active, added_by) values ($1, $2, $3, $4, $5, true, $6)
     on conflict (phone) do update set name = excluded.name, code = excluded.code, branch_code = excluded.branch_code, can_publish_timetable = excluded.can_publish_timetable, active = true`,
    [phone, name, code, branch, b.canPublishTimetable !== false, who.account.id]);
  await db.audit(who.account.id, existing ? 'teacher.update' : 'teacher.add', mask(phone), { name, code }, branch);
  return { saved: mask(phone), phone };
}
async function teacherStatus(who, req) {
  const b = body(req);
  const phone = normalizePhone(txt(b.phone, 20));
  const [t] = phone ? await db.q('select branch_code from teacher_whitelist where phone = $1', [phone]) : [];
  if (!t) throw notFound('That number is not on the teacher list.');
  need(who, 'teacher.manage', { branch: t.branch_code }, 'You can only manage teachers of your own branch.');
  const active = b.active === true;
  await db.q('update teacher_whitelist set active = $2 where phone = $1', [phone, active]);
  await db.audit(who.account.id, active ? 'teacher.reactivate' : 'teacher.deactivate', mask(phone), null, t.branch_code);
  return { active };
}
async function teacherDivision(who, req) {
  const b = body(req);
  const phone = normalizePhone(txt(b.phone, 20));
  const div = division(who, b.division);
  need(who, 'teacher.assign', { division: div }, 'You can only assign teachers to your own branch’s divisions.');
  const [t] = phone ? await db.q('select active from teacher_whitelist where phone = $1', [phone]) : [];
  if (!t) throw notFound('Add the teacher first.');
  const subject = txt(b.subject, 80);
  if (b.action === 'remove') await db.q('delete from teacher_divisions where teacher_phone = $1 and division_code = $2', [phone, div]);
  else {
    if (!subject) throw bad('INVALID_SUBJECT', 'Enter the subject they teach in this division.');
    await db.q('insert into teacher_divisions (teacher_phone, division_code, subject) values ($1, $2, $3) on conflict do nothing', [phone, div, subject]);
  }
  await db.audit(who.account.id, b.action === 'remove' ? 'teacher.unassign' : 'teacher.assign', mask(phone), { division: div, subject }, branchOf(who, div));
  return { ok: true };
}
async function sendInstruction(who, req) {
  const b = body(req);
  const branch = txt(b.branch || who.hodBranches[0], 10).toUpperCase();
  need(who, 'instruction.send', { branch }, 'Only the HOD of this branch can send instructions to its teachers.');
  const title = txt(b.title, 140), text = txt(b.body, 4000);
  if (title.length < 3) throw bad('INVALID_TITLE', 'Give the instruction a title.');
  const due = b.dueDate ? txt(b.dueDate, 10) : null;
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw bad('INVALID_DATE', 'Due date must be a date.');
  const pool = (await db.q(`select w.phone from teacher_whitelist w where w.active and (w.branch_code = $1 or exists (select 1 from teacher_divisions t join divisions d on d.code = t.division_code where t.teacher_phone = w.phone and d.branch_code = $1))`, [branch])).map((r) => r.phone);
  const pick = b.teachers === 'all' ? pool : (Array.isArray(b.teachers) ? b.teachers : []).map((p) => normalizePhone(txt(p, 20)));
  const outside = pick.filter((p) => !pool.includes(p));
  if (outside.length) throw forbidden('Some selected teachers are not active teachers of your branch.');
  if (!pick.length) throw bad('NO_RECIPIENTS', 'Choose at least one teacher.');
  const [ins] = await db.q(
    `with i as (insert into teacher_instructions (from_id, branch_code, title, body, due_date) values ($1, $2, $3, $4, $5::date) returning id),
          r as (insert into instruction_recipients (instruction_id, teacher_phone) select i.id, unnest($6::text[]) from i returning 1)
     select i.id, (select count(*) from r)::int as recipients from i`, [who.account.id, branch, title, text, due, pick]);
  await db.audit(who.account.id, 'instruction.send', ins.id, { recipients: ins.recipients, title }, branch);
  return { instruction: ins };
}
async function listInstructions(who) {
  if (who.base === 'hod') {
    const rows = await db.q(
      `select i.id, i.title, i.body, i.due_date, i.created_at, i.branch_code,
              coalesce(json_agg(json_build_object('name', w.name, 'status', r.status, 'updated_at', r.updated_at) order by w.name) filter (where r.teacher_phone is not null), '[]') as recipients
         from teacher_instructions i left join instruction_recipients r on r.instruction_id = i.id left join teacher_whitelist w on w.phone = r.teacher_phone
        where i.branch_code = any($1) group by i.id order by i.created_at desc limit 100`, [who.hodBranches]);
    return { sent: rows };
  }
  if (!can(who, 'instruction.receive')) throw forbidden('Only teachers receive instructions.');
  const rows = await db.q(
    `select i.id, i.title, i.body, i.due_date, i.created_at, r.status, a.name as from_name
       from instruction_recipients r join teacher_instructions i on i.id = r.instruction_id left join accounts a on a.id = i.from_id
      where r.teacher_phone = $1 order by (r.status = 'done'), i.created_at desc limit 100`, [who.phone]);
  return { received: rows };
}
async function instructionStatus(who, req) {
  const b = body(req);
  if (!can(who, 'instruction.receive')) throw forbidden();
  if (!isUuid(b.id) || !['seen', 'done'].includes(b.status)) throw bad('INVALID', 'Mark as seen or done.');
  const rows = await db.q(`update instruction_recipients set status = $3, updated_at = now() where instruction_id = $1 and teacher_phone = $2 and (status <> 'done' or $3 = 'done') returning status`, [b.id, who.phone, b.status]);
  if (!rows.length) throw notFound('Instruction not found.');
  return { status: rows[0].status };
}
async function hodSummary(who) {
  if (who.base !== 'hod') throw forbidden('HOD only.');
  const divisions = await db.q(
    `select d.code, d.branch_code, d.confirmed,
            (select count(*)::int from class_enrollments e where e.division_code = d.code and e.status = 'active') as students,
            (select count(*)::int from join_requests j where j.division_code = d.code and j.status = 'pending') as pending,
            (select count(*)::int from cr_assignments c where c.division_code = d.code and c.active) as crs,
            (select count(distinct t.teacher_phone)::int from teacher_divisions t join teacher_whitelist w on w.phone = t.teacher_phone and w.active where t.division_code = d.code) as teachers
       from divisions d where d.branch_code = any($1) order by d.code`, [who.hodBranches]);
  const [{ n: pendingCr }] = await db.q(`select count(*)::int as n from cr_requests c join divisions d on d.code = c.division_code where c.status = 'pending' and d.branch_code = any($1)`, [who.hodBranches]);
  return { branches: who.hodBranches, divisions, pendingCr, capacity: await setting('division_capacity', 65), maxCrs: await setting('max_crs_per_division', 2) };
}
async function audit(who, req) {
  if (who.base !== 'hod') throw forbidden('Only HODs can read the audit log.');
  const before = req.query.before && /^\d+$/.test(req.query.before) ? Number(req.query.before) : null;
  const rows = await db.q(`select l.id, l.at, l.action, l.target, l.detail, l.branch_code, a.name as actor_name
    from audit_log l left join accounts a on a.id = l.actor where l.branch_code = any($1) and ($2::bigint is null or l.id < $2) order by l.id desc limit 100`, [who.hodBranches, before]);
  return { entries: rows.map((r) => ({ ...r, id: Number(r.id), target: r.action.startsWith('teacher') ? r.target : undefined })) };
}

/* ============================== posts, notices, reminders, files ============================== */
async function createPost(who, req) {
  await limit(`post:${who.account.id}`, 30, 600);
  const b = body(req);
  const kind = b.kind === 'material' ? 'material' : b.kind === 'announcement' ? 'announcement' : null;
  if (!kind) throw bad('INVALID_KIND', 'Choose announcement or material.');
  const title = txt(b.title, 140), text = txt(b.body, 4000);
  if (title.length < 3) throw bad('INVALID_TITLE', 'Give the post a title (at least 3 characters).');
  const targets = Array.isArray(b.divisions) ? [...new Set(b.divisions.map((x) => txt(x, 10).toUpperCase()))] : [];
  if (!targets.length) throw bad('NO_TARGETS', 'Choose at least one division.');
  if (targets.length > 60) throw bad('TOO_MANY_TARGETS', 'Choose at most 60 divisions.');
  const isCrNotice = who.base === 'student';
  const action = isCrNotice ? 'notice.create' : 'post.create'; // class reps send notices only; teachers/HODs post
  const notAllowed = targets.filter((d) => !can(who, action, { division: d }));
  if (notAllowed.length) throw forbidden(`Nothing was sent: you can't post to ${notAllowed.join(', ')}.`); // whole request rejected
  let file = null;
  if (b.file !== undefined && b.file !== null) {
    if (action !== 'post.create') throw forbidden('Class reps can send notices, not files.');
    if (!isObj(b.file)) throw bad('INVALID_FILE', 'File is malformed.');
    const mime = txt(b.file.mime, 120), name = txt(b.file.name, 120).replace(/[\\/:*?"<>|]/g, '_');
    if (!FILE_TYPES[mime]) throw bad('FILE_TYPE', 'Allowed files: PDF, Word, PowerPoint, Excel, PNG, JPG or text.');
    if (typeof b.file.dataBase64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(b.file.dataBase64)) throw bad('INVALID_FILE', 'File data is malformed.');
    const bytes = Buffer.from(b.file.dataBase64, 'base64');
    if (!bytes.length) throw bad('INVALID_FILE', 'The file is empty.');
    if (bytes.length > MAX_FILE) throw new HttpError(413, 'FILE_TOO_LARGE', 'Files can be up to 3 MB.');
    file = { name: name || `file.${FILE_TYPES[mime]}`, mime, bytes };
  } else if (kind === 'material') throw bad('NO_FILE', 'Attach the material file.');
  const authorRole = isCrNotice ? 'cr' : who.base;
  const [row] = await db.q(
    `with f as (insert into files (owner_id, name, mime, size, bytes) select $1, $5, $6, $7, decode($8, 'hex') where $5::text is not null returning id),
          p as (insert into posts (author_id, author_name, kind, title, body, file_id, author_role) values ($1, $2, $3, $4, $9, (select id from f), $11) returning id, created_at),
          t as (insert into post_targets (post_id, division_code) select p.id, unnest($10::text[]) from p returning 1)
     select p.id, p.created_at, (select count(*) from t)::int as targets from p`,
    [who.account.id, displayName(who), kind, title, file ? file.name : null, file ? file.mime : null, file ? file.bytes.length : null, file ? file.bytes.toString('hex') : null, text, targets, authorRole]);
  for (const br of [...new Set(targets.map((d) => branchOf(who, d)))]) await db.audit(who.account.id, 'post.create', row.id, { kind, divisions: targets.filter((d) => branchOf(who, d) === br), by: authorRole, file: file ? { name: file.name, size: file.bytes.length } : null }, br);
  return { post: { id: row.id, createdAt: row.created_at, divisions: targets, kind, title } };
}
const POST_COLS = `p.id, p.kind, p.title, p.body, p.author_name, p.author_role, p.created_at,
  f.id as file_id, f.name as file_name, f.mime as file_mime, f.size as file_size,
  (select array_agg(division_code order by division_code) from post_targets where post_id = p.id) as divisions`;
async function myPosts(who, req) {
  const rows = await db.q(`select ${POST_COLS} from posts p left join files f on f.id = p.file_id
    where p.author_id = $1 and p.deleted_at is null order by p.created_at desc limit ${PAGE} offset $2`, [who.account.id, page(req) * PAGE]);
  return { posts: rows };
}
async function deletePost(who, req) {
  const id = req.query.id;
  if (!isUuid(id)) throw bad('INVALID_ID', 'Unknown post.');
  const [p] = await db.q(`select p.author_id, (select array_agg(division_code) from post_targets where post_id = p.id) as divisions from posts p where p.id = $1 and p.deleted_at is null`, [id]);
  if (!p) throw notFound('Post not found.');
  const hodOfAll = (p.divisions || []).every((d) => can(who, 'join.override', { division: d }));
  if (p.author_id !== who.account.id && !hodOfAll) throw notFound('Post not found, or you are not its author.');
  await db.q('update posts set deleted_at = now() where id = $1', [id]);
  await db.audit(who.account.id, 'post.delete', id, null, branchOf(who, (p.divisions || [])[0]));
  return { deleted: id };
}
/** Which division's content may this person read? Students: only their own class (any ?division is ignored). */
function viewDivision(who, req) {
  if (who.base === 'student') return who.enrollment ? who.enrollment.division_code : null;
  if (!req.query.division) return null;
  const d = division(who, req.query.division);
  need(who, 'content.view', { division: d });
  return d;
}
async function feed(who, req) {
  const div = viewDivision(who, req);
  if (!div) return { division: null, posts: [], message: who.base === 'student' ? 'Join a class to see posts from your teachers.' : 'Choose a division.' };
  const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
  const rows = await db.q(`select ${POST_COLS} from post_targets t join posts p on p.id = t.post_id left join files f on f.id = p.file_id
    where t.division_code = $1 and p.deleted_at is null and ($2::timestamptz is null or p.created_at < $2)
    order by p.created_at desc limit ${PAGE}`, [div, before]);
  return { division: div, posts: rows, more: rows.length === PAGE };
}
async function createReminder(who, req) {
  await limit(`rem:${who.account.id}`, 30, 600);
  const b = body(req);
  const div = division(who, b.division);
  need(who, 'reminder.create', { division: div }, `You can't set reminders for ${div}.`);
  const title = txt(b.title, 140), text = txt(b.body, 1000);
  if (title.length < 3) throw bad('INVALID_TITLE', 'Give the reminder a title.');
  const at = Date.parse(b.remindAt);
  if (Number.isNaN(at) || at < Date.now() - 60000 || at > Date.now() + 366 * 86400000) throw bad('INVALID_TIME', 'Pick a date and time within the next year.');
  const [r] = await db.q(`insert into reminders (author_id, author_name, author_role, division_code, title, body, remind_at) values ($1, $2, $3, $4, $5, $6, $7) returning id, remind_at`,
    [who.account.id, displayName(who), roleName(who, div), div, title, text, new Date(at).toISOString()]);
  await db.audit(who.account.id, 'reminder.create', r.id, { division: div, title }, branchOf(who, div));
  return { reminder: r };
}
async function listReminders(who, req) {
  const div = viewDivision(who, req);
  if (!div) return { division: null, reminders: [] };
  const rows = await db.q(`select id, title, body, remind_at, author_name, author_role, author_id = $2 as mine from reminders
    where division_code = $1 and deleted_at is null and remind_at > now() - interval '1 day' order by remind_at limit ${PAGE}`, [div, who.account.id]);
  return { division: div, reminders: rows };
}
async function deleteReminder(who, req) {
  if (!isUuid(req.query.id)) throw bad('INVALID_ID', 'Unknown reminder.');
  const [r] = await db.q('select author_id, division_code from reminders where id = $1 and deleted_at is null', [req.query.id]);
  if (!r || (r.author_id !== who.account.id && !can(who, 'join.override', { division: r.division_code }))) throw notFound('Reminder not found.');
  await db.q('update reminders set deleted_at = now() where id = $1', [req.query.id]);
  return { deleted: true };
}
async function getFile(who, req, res) {
  const id = req.query.id;
  if (!isUuid(id)) throw bad('INVALID_ID', 'Unknown file.');
  const viewable = [...who.divisions.keys()].filter((d) => can(who, 'content.view', { division: d }));
  const [f] = await db.q(
    `select f.name, f.mime, encode(f.bytes, 'base64') as b64 from files f where f.id = $1 and (
       f.owner_id = $2 or exists (select 1 from posts p join post_targets t on t.post_id = p.id
          where p.file_id = f.id and p.deleted_at is null and t.division_code = any($3)))`, [id, who.account.id, viewable]);
  if (!f) throw notFound('File not found, or it was not shared with your class.');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200);
  res.end(Buffer.from(f.b64.replace(/\s/g, ''), 'base64'));
  return SENT;
}

/* ============================== timetables ============================== */
async function ttPreview(who, req) {
  need(who, 'timetable.upload', {}, 'Only HODs and teachers allowed to publish timetables can upload one.');
  await limit(`ttprev:${who.account.id}`, 20, 600);
  const b = body(req);
  const term = txt(b.term, 40);
  if (!TERM_RE.test(term)) throw bad('INVALID_TERM', 'Give the timetable a term name, e.g. "FE 2026-27 Sem I".');
  const fileName = txt(b.fileName, 120);
  if (!/\.(xlsx|csv)$/i.test(fileName)) throw bad('FILE_TYPE', 'Upload an .xlsx or .csv file.');
  if (!Array.isArray(b.sheets) || b.sheets.length > 20) throw bad('INVALID_SHEETS', 'The file could not be read.');
  const known = {
    divisions: new Set(who.divisions.keys()),
    subjects: new Map((await db.q('select code, name from subjects')).map((r) => [r.code, r.name])),
    faculty: new Map((await db.q('select code, name from faculty')).map((r) => [r.code, r.name])),
  };
  const result = tt.validate(b.sheets.map((s) => ({ name: txt(s && s.name, 60), rows: Array.isArray(s && s.rows) ? s.rows.slice(0, 6000).map((r) => (Array.isArray(r) ? r.slice(0, 30) : [])) : [] })), known);
  // Permission per division. Either the whole file is allowed, or the uploader explicitly chooses "only my divisions".
  const notAllowed = result.divisions.filter((d) => !can(who, 'timetable.publish', { division: d }));
  if (notAllowed.length && !result.errors.length) {
    if (!b.onlyMine) {
      return { ok: false, canFilter: notAllowed.length < result.divisions.length, notAllowed, errors: [{ sheet: null, row: null, cell: null, message: `You can't publish timetables for ${notAllowed.join(', ')}. Ask your HOD to assign these divisions, or publish only your own divisions.` }], warnings: result.warnings, divisions: result.divisions, rowCount: result.entries.length };
    }
    const skipped = result.entries.filter((e) => notAllowed.includes(e.division)).length;
    result.entries = result.entries.filter((e) => !notAllowed.includes(e.division));
    result.divisions = result.divisions.filter((d) => !notAllowed.includes(d));
    result.warnings.unshift({ sheet: null, row: null, message: `Not included (you can't publish them): ${notAllowed.join(', ')} — ${skipped} rows left out on purpose.` });
    if (!result.entries.length) result.errors.push({ sheet: null, row: null, cell: null, message: 'None of the divisions in this file are yours to publish.' });
  }
  const out = { ok: !result.errors.length, errors: result.errors, warnings: result.warnings, divisions: result.divisions, rowCount: result.entries.length };
  if (result.errors.length) return out;
  await db.q(`delete from timetable_versions where status = 'draft' and created_by = $1`, [who.account.id]); // one open draft per uploader
  const [v] = await db.q(
    `insert into timetable_versions (term, created_by, file_name, file_size, row_count, divisions, lookups, status)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft') returning id, created_at`,
    [term, who.account.id, fileName, Number.isInteger(b.fileSize) ? b.fileSize : null, result.entries.length, result.divisions, JSON.stringify(result.lookups)]);
  await db.q(
    `insert into timetable_entries (version_id, division_code, day, start_min, end_min, subject, teacher_code, room, batch, type, source_row)
     select $1, x.division, x.day, x.start, x."end", x.subject, x.teacher, x.room, x.batch, x.type, x.row
       from jsonb_to_recordset($2::jsonb) as x(division text, day int, start int, "end" int, subject text, teacher text, room text, batch text, type text, row int)`,
    [v.id, JSON.stringify(result.entries)]);
  return { ...out, versionId: v.id, term, preview: result.entries.map(({ sheet, ...e }) => e) };
}
async function ttPublish(who, req) {
  const { versionId } = body(req);
  if (!isUuid(versionId)) throw bad('INVALID_ID', 'Unknown timetable version.');
  const [v] = await db.q(`select id, term, created_at, created_by, status, divisions from timetable_versions where id = $1`, [versionId]);
  if (!v || v.status !== 'draft') throw notFound('That preview is no longer open. Upload the file again.');
  const notAllowed = v.divisions.filter((d) => !can(who, 'timetable.publish', { division: d }));
  if (notAllowed.length) throw forbidden(`You can't publish for ${notAllowed.join(', ')}.`); // re-checked at publish time
  if (v.created_by !== who.account.id && who.base !== 'hod') throw forbidden('Only the uploader (or an HOD) can publish this preview.');
  const [newer] = await db.q(`select id from timetable_versions where status = 'published' and published_at > $1 and divisions && $2::text[] limit 1`, [v.created_at, v.divisions]);
  if (newer) throw conflict('PUBLISHED_SINCE', 'Someone published a timetable for these divisions after your preview. Check it, then upload again.');
  const rows = await db.q(`update timetable_versions set status = 'published', published_at = now(), published_by = $2 where id = $1 and status = 'draft' returning published_at, lookups`, [versionId, who.account.id]);
  if (!rows.length) throw conflict('ALREADY_PUBLISHED', 'This preview was already published.');
  const lk = rows[0].lookups || {};
  if ((lk.subjects || []).length) await db.q(`insert into subjects (code, name) select x->>0, x->>1 from jsonb_array_elements($1::jsonb) x on conflict (code) do update set name = excluded.name`, [JSON.stringify(lk.subjects)]);
  if ((lk.faculty || []).length) await db.q(`insert into faculty (code, name, dept) select x->>0, x->>1, x->>2 from jsonb_array_elements($1::jsonb) x on conflict (code) do update set name = excluded.name, dept = excluded.dept`, [JSON.stringify(lk.faculty)]);
  for (const br of [...new Set(v.divisions.map((d) => branchOf(who, d)))]) await db.audit(who.account.id, 'timetable.publish', versionId, { term: v.term, divisions: v.divisions.filter((d) => branchOf(who, d) === br) }, br);
  return { published: versionId, publishedAt: rows[0].published_at, divisions: v.divisions };
}
async function ttRollback(who, req) {
  const { versionId } = body(req);
  if (!isUuid(versionId)) throw bad('INVALID_ID', 'Unknown timetable version.');
  const [v] = await db.q(`select divisions, term from timetable_versions where id = $1 and status = 'published'`, [versionId]);
  if (!v) throw notFound('Only a previously published version can be restored.');
  const notAllowed = v.divisions.filter((d) => !can(who, 'timetable.publish', { division: d }));
  if (notAllowed.length) throw forbidden(`You can't restore timetables for ${notAllowed.join(', ')}.`);
  await db.q(`update timetable_versions set published_at = now(), published_by = $2 where id = $1`, [versionId, who.account.id]);
  for (const br of [...new Set(v.divisions.map((d) => branchOf(who, d)))]) await db.audit(who.account.id, 'timetable.rollback', versionId, { term: v.term }, br);
  return { restored: versionId, divisions: v.divisions };
}
async function ttVersions(who) {
  need(who, 'timetable.upload');
  const mine = allowedDivisions(who, 'timetable.publish');
  const rows = await db.q(
    `select v.id, v.term, v.file_name, v.row_count, v.divisions, v.status, v.created_at, v.published_at, a.name as uploader,
            not exists (select 1 from timetable_versions w where w.status = 'published' and w.published_at > v.published_at and w.divisions && v.divisions) as current
       from timetable_versions v left join accounts a on a.id = v.created_by
      where (v.status = 'published' and v.divisions && $2::text[]) or (v.status = 'draft' and v.created_by = $1)
      order by coalesce(v.published_at, v.created_at) desc limit 50`, [who.account.id, mine]);
  return { versions: rows };
}
/** The single source for every timetable view (Overview widget and College portal). */
async function timetable(who, req) {
  const div = viewDivision(who, req);
  if (!div) return { division: null, entries: [], message: who.base === 'student' ? 'Join a class to see your timetable.' : 'Choose a division.' };
  // The newest published version that includes this division. A version only becomes visible once all its rows exist.
  const [v] = await db.q(`select id, term, published_at from timetable_versions where status = 'published' and $1 = any(divisions) order by published_at desc limit 1`, [div]);
  if (!v) return { division: div, entries: [], message: 'No timetable published yet.' };
  const entries = await db.q(
    `select e.day, e.start_min, e.end_min, e.subject, e.teacher_code, e.room, e.batch, e.type, s.name as subject_name, f.name as teacher_name
       from timetable_entries e left join subjects s on s.code = e.subject left join faculty f on f.code = e.teacher_code
      where e.version_id = $1 and e.division_code = $2 order by e.day, e.start_min, e.batch`, [v.id, div]);
  return { division: div, term: v.term, versionId: v.id, publishedAt: v.published_at, entries };
}

/* ============================== router ============================== */
const ROUTES = {
  'GET me': getMe, 'PUT me': putMe, 'GET catalog': catalog, 'GET divisions': async (w) => ({ divisions: (await catalog(w)).divisions }),
  'POST join-requests': joinRequest, 'DELETE join-requests': cancelJoin, 'GET join-requests': listJoins, 'POST join-decision': decideJoins,
  'POST enrollment-revoke': revokeEnrollment, 'GET roster': roster,
  'POST cr-requests': crRequest, 'DELETE cr-requests': cancelCr, 'GET cr-requests': listCr, 'POST cr-decision': decideCr, 'POST cr-assign': assignCr,
  'GET teachers': listTeachers, 'POST teachers': saveTeacher, 'POST teacher-status': teacherStatus, 'POST teacher-division': teacherDivision,
  'POST instructions': sendInstruction, 'GET instructions': listInstructions, 'POST instruction-status': instructionStatus,
  'GET hod-summary': hodSummary, 'GET audit': audit,
  'POST posts': createPost, 'GET posts': myPosts, 'DELETE posts': deletePost, 'GET feed': feed, 'GET file': getFile,
  'POST reminders': createReminder, 'GET reminders': listReminders, 'DELETE reminders': deleteReminder,
  'POST timetable-preview': ttPreview, 'POST timetable-publish': ttPublish, 'POST timetable-rollback': ttRollback,
  'GET timetable-versions': ttVersions, 'GET timetable': timetable,
  // parent portal, attendance, marks, alerts, events (api/_records.js)
  ...records({ db, can, need, bad, forbidden, notFound, conflict, body, txt, isUuid, division, limit, branchOf, displayName, allowedDivisions, normalizePhone, mask }),
};

module.exports = async (req, res) => {
  req.query = req.query || {};
  const route = req.query.route || (req.url || '').split('?')[0].replace(/^.*\/app\/?/, '').replace(/\/+$/, '');
  res.setHeader('Cache-Control', 'no-store');
  const handler = ROUTES[`${req.method} ${route}`];
  try {
    const phone = getPhone(req);
    if (!phone) throw new HttpError(401, 'NO_SESSION', 'Sign in required.');
    if (!handler) throw notFound('Unknown route.');
    await db.ensureSchema();
    const who = await access.resolve(phone);
    const out = await handler(who, req, res);
    if (out === SENT) return undefined;
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ ok: false, code: e.code, error: e.message, ...(e.extra || {}) });
    if (e && e.code === 'DB_NOT_CONFIGURED') return res.status(503).json({ ok: false, code: 'DB_NOT_CONFIGURED', error: 'Cloud sync is not configured on the server.' });
    if (e && e.code === '23505') return res.status(409).json({ ok: false, code: 'CONFLICT', error: 'Someone else just made that change. Refresh and try again.' });
    console.error('app api error', route, e && e.code); // no personal data in logs
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Something went wrong. Try again.' });
  }
};
