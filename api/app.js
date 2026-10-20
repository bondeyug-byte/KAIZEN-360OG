// api/app.js — Campus360 college portal API (one serverless function, routed by ?route=).
// Identity: the signed, HttpOnly login cookie set after OTP verification (api/_session.js). Roles: api/_access.js.
// Nothing in a request body can grant a role, a class or another person's data.
//
// Phase 1  GET  me · PUT me · GET divisions
// Phase 2  GET  feed · GET file?id= · POST posts · GET posts · DELETE posts?id=
//          GET/POST/DELETE hod-teachers   (HOD manages the teacher whitelist)
// Phase 3  POST timetable-preview · POST timetable-publish · POST timetable-rollback · GET timetable-versions
//          GET  timetable[?division=]
// Phase 4  POST join · GET requests[?division=] · POST decide · POST hod-cr · GET hod-students?division=
//          GET  hod-audit
const { getPhone } = require('./_session');
const { normalizePhone } = require('./_roles');
const access = require('./_access');
const tt = require('./_timetable');
const db = require('./_db');

const MAX_PROFILE = 8 * 1024, MAX_DATA = 200 * 1024, MAX_FILE = 3 * 1024 * 1024;
const PROTECTED = ['id', 'role', 'roles', 'teaches', 'phone', 'phoneVerified', 'authMethod', 'demo', 'classRep', 'academicHistory', 'admin', 'teacher'];
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
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const txt = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
const mask = (p) => (p ? `${p.slice(0, 3)} ${p.slice(3, 5)}xxxx ${p.slice(-4)}` : '');
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
function body(req) {
  let b = req.body || {};
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  if (!isObj(b)) throw bad('INVALID_BODY', 'Send a JSON object.');
  return b;
}
async function limit(key, max, sec) { if (!(await db.allow(key, max, sec))) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Wait a few minutes and try again.'); }
const needTeacherOrHod = (who) => { if (!who.admin && !who.teacher) throw forbidden('Only registered teachers can do this.'); };
const needHod = (who) => { if (!who.admin) throw forbidden('Only the HOD can do this.'); };

/* ------------------------------ Phase 1: account ------------------------------ */
async function getMe(who) {
  await db.q('insert into account_state (account_id) values ($1) on conflict (account_id) do nothing', [who.account.id]);
  const [state] = await db.q('select profile, data, version, updated_at from account_state where account_id = $1', [who.account.id]);
  return {
    account: { id: who.account.id, name: who.account.name, createdAt: who.account.created_at },
    profile: state.profile, data: state.data, version: state.version, updatedAt: state.updated_at,
    enrollment: who.enrollment, admin: who.admin, teacher: who.teacher, cr: who.cr,
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
const getDivisions = async () => ({ divisions: await db.q('select code, branch_code, year, confirmed from divisions order by year, code') });

/* ------------------------------ Phase 2: teacher → students ------------------------------ */
async function createPost(who, req) {
  needTeacherOrHod(who);
  await limit(`post:${who.account.id}`, 30, 600);
  const b = body(req);
  const kind = b.kind === 'material' ? 'material' : b.kind === 'announcement' ? 'announcement' : null;
  if (!kind) throw bad('INVALID_KIND', 'Choose announcement or material.');
  const title = txt(b.title, 140), text = txt(b.body, 4000);
  if (title.length < 3) throw bad('INVALID_TITLE', 'Give the post a title (at least 3 characters).');
  const targets = Array.isArray(b.divisions) ? [...new Set(b.divisions.map((x) => txt(x, 10).toUpperCase()))] : [];
  if (!targets.length) throw bad('NO_TARGETS', 'Choose at least one division.');
  const allowed = new Set(await access.postableDivisions(who));
  const notAllowed = targets.filter((d) => !allowed.has(d));
  if (notAllowed.length) throw forbidden(`You can't post to ${notAllowed.join(', ')}. Ask the HOD to add those divisions to your teacher record.`);
  let file = null;
  if (b.file !== undefined && b.file !== null) {
    if (!isObj(b.file)) throw bad('INVALID_FILE', 'File is malformed.');
    const mime = txt(b.file.mime, 120), name = txt(b.file.name, 120).replace(/[\\/:*?"<>|]/g, '_');
    if (!FILE_TYPES[mime]) throw bad('FILE_TYPE', 'Allowed files: PDF, Word, PowerPoint, Excel, PNG, JPG or text.');
    if (typeof b.file.dataBase64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(b.file.dataBase64)) throw bad('INVALID_FILE', 'File data is malformed.');
    const bytes = Buffer.from(b.file.dataBase64, 'base64');
    if (!bytes.length) throw bad('INVALID_FILE', 'The file is empty.');
    if (bytes.length > MAX_FILE) throw new HttpError(413, 'FILE_TOO_LARGE', 'Files can be up to 3 MB.');
    file = { name: name || `file.${FILE_TYPES[mime]}`, mime, bytes };
  } else if (kind === 'material') throw bad('NO_FILE', 'Attach the material file.');
  const authorName = txt((who.teacher && who.teacher.name) || who.account.name || (who.admin ? 'HOD' : 'Teacher'), 80);
  // One statement: the file, the post and its targets are saved together or not at all.
  const [row] = await db.q(
    `with f as (insert into files (owner_id, name, mime, size, bytes) select $1, $5, $6, $7, decode($8, 'hex') where $5::text is not null returning id),
          p as (insert into posts (author_id, author_name, kind, title, body, file_id) values ($1, $2, $3, $4, $9, (select id from f)) returning id, created_at),
          t as (insert into post_targets (post_id, division_code) select p.id, unnest($10::text[]) from p returning 1)
     select p.id, p.created_at, (select count(*) from t)::int as targets from p`,
    [who.account.id, authorName, kind, title, file ? file.name : null, file ? file.mime : null, file ? file.bytes.length : null, file ? file.bytes.toString('hex') : null, text, targets]);
  await db.audit(who.account.id, 'post.create', row.id, { kind, divisions: targets, file: file ? { name: file.name, size: file.bytes.length } : null });
  return { post: { id: row.id, createdAt: row.created_at, divisions: targets, kind, title } };
}
const POST_COLS = `p.id, p.kind, p.title, p.body, p.author_name, p.created_at,
  f.id as file_id, f.name as file_name, f.mime as file_mime, f.size as file_size,
  (select array_agg(division_code order by division_code) from post_targets where post_id = p.id) as divisions`;
async function myPosts(who) {
  needTeacherOrHod(who);
  const rows = await db.q(`select ${POST_COLS} from posts p left join files f on f.id = p.file_id
    where p.author_id = $1 and p.deleted_at is null order by p.created_at desc limit 100`, [who.account.id]);
  return { posts: rows };
}
async function deletePost(who, req) {
  const id = req.query.id;
  if (!isUuid(id)) throw bad('INVALID_ID', 'Unknown post.');
  const rows = await db.q('update posts set deleted_at = now() where id = $1 and deleted_at is null and (author_id = $2 or $3) returning id', [id, who.account.id, who.admin]);
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Post not found, or you are not its author.');
  await db.audit(who.account.id, 'post.delete', id);
  return { deleted: id };
}
async function feed(who, req) {
  // Students see only posts targeted at their APPROVED division. Teachers/HOD may preview a division they can post to.
  let division = who.approvedDivision;
  if (req.query.division && (who.admin || who.teacher)) {
    const d = txt(req.query.division, 10).toUpperCase();
    if (!(await access.postableDivisions(who)).includes(d)) throw forbidden();
    division = d;
  }
  if (!division) return { division: null, posts: [], message: 'Join your class (and wait for approval) to see posts from your teachers.' };
  const before = req.query.before && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
  const rows = await db.q(`select ${POST_COLS} from post_targets t join posts p on p.id = t.post_id left join files f on f.id = p.file_id
    where t.division_code = $1 and p.deleted_at is null and ($2::timestamptz is null or p.created_at < $2)
    order by p.created_at desc limit 50`, [division, before]);
  return { division, posts: rows, more: rows.length === 50 };
}
async function getFile(who, req, res) {
  const id = req.query.id;
  if (!isUuid(id)) throw bad('INVALID_ID', 'Unknown file.');
  const [f] = await db.q(
    `select f.name, f.mime, encode(f.bytes, 'base64') as b64 from files f where f.id = $1 and (
       f.owner_id = $2 or $3 or exists (
         select 1 from posts p join post_targets t on t.post_id = p.id
          where p.file_id = f.id and p.deleted_at is null and t.division_code = $4))`,
    [id, who.account.id, who.admin, who.approvedDivision]);
  if (!f) throw new HttpError(404, 'NOT_FOUND', 'File not found, or it was not shared with your class.');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200);
  res.end(Buffer.from(f.b64.replace(/\s/g, ''), 'base64'));
  return SENT;
}

async function hodTeachers(who, req) {
  needHod(who);
  if (req.method === 'GET') {
    return { teachers: await db.q('select phone, name, code, teaches, can_publish_timetable, added_at from teacher_whitelist order by name, phone') };
  }
  if (req.method === 'DELETE') {
    const phone = normalizePhone(txt(req.query.phone, 20));
    if (!phone) throw bad('INVALID_PHONE', 'Enter a 10-digit mobile number.');
    const rows = await db.q('delete from teacher_whitelist where phone = $1 returning phone', [phone]);
    if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'That number is not on the teacher list.');
    await db.audit(who.account.id, 'teacher.remove', mask(phone));
    return { removed: mask(phone) };
  }
  const b = body(req);
  const phone = normalizePhone(txt(b.phone, 20));
  if (!phone) throw bad('INVALID_PHONE', 'Enter a 10-digit Indian mobile number.');
  const known = new Set((await db.q('select code from divisions')).map((r) => r.code));
  const teaches = (Array.isArray(b.teaches) ? b.teaches : []).map((t) => ({ division: txt(t && t.division, 10).toUpperCase(), subject: txt(t && t.subject, 80) }));
  const badDiv = teaches.filter((t) => !known.has(t.division) || !t.subject);
  if (!teaches.length || badDiv.length) throw bad('INVALID_TEACHES', 'Give at least one division and subject, using known division codes.');
  const name = txt(b.name, 80), code = txt(b.code, 12).toUpperCase();
  await db.q(
    `insert into teacher_whitelist (phone, name, code, teaches, can_publish_timetable, added_by) values ($1, $2, $3, $4::jsonb, $5, $6)
     on conflict (phone) do update set name = excluded.name, code = excluded.code, teaches = excluded.teaches, can_publish_timetable = excluded.can_publish_timetable`,
    [phone, name, code, JSON.stringify(teaches), b.canPublishTimetable !== false, who.account.id]);
  await db.audit(who.account.id, 'teacher.upsert', mask(phone), { name, code, divisions: teaches.map((t) => t.division) });
  return { saved: mask(phone) };
}

/* ------------------------------ Phase 3: timetables ------------------------------ */
const canPublishTT = (who) => who.admin || (who.teacher && who.teacher.canPublishTimetable);
async function ttPreview(who, req) {
  if (!canPublishTT(who)) throw forbidden('Only the HOD or teachers allowed to publish timetables can upload one.');
  await limit(`ttprev:${who.account.id}`, 20, 600);
  const b = body(req);
  const term = txt(b.term, 40);
  if (!TERM_RE.test(term)) throw bad('INVALID_TERM', 'Give the timetable a term name, e.g. "FE 2026-27 Sem I".');
  const fileName = txt(b.fileName, 120);
  if (!/\.(xlsx|csv)$/i.test(fileName)) throw bad('FILE_TYPE', 'Upload an .xlsx or .csv file.');
  if (!Array.isArray(b.sheets) || b.sheets.length > 20) throw bad('INVALID_SHEETS', 'The file could not be read.');
  const known = {
    divisions: new Set((await db.q('select code from divisions')).map((r) => r.code)),
    subjects: new Map((await db.q('select code, name from subjects')).map((r) => [r.code, r.name])),
    faculty: new Map((await db.q('select code, name from faculty')).map((r) => [r.code, r.name])),
  };
  const result = tt.validate(b.sheets.map((s) => ({ name: txt(s && s.name, 60), rows: Array.isArray(s && s.rows) ? s.rows.slice(0, 6000).map((r) => (Array.isArray(r) ? r.slice(0, 30) : [])) : [] })), known);
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
  await db.audit(who.account.id, 'timetable.preview', v.id, { term, fileName, rows: result.entries.length });
  return { ...out, versionId: v.id, term, preview: result.entries.map(({ sheet, ...e }) => e) };
}
async function ttPublish(who, req) {
  if (!canPublishTT(who)) throw forbidden('Only the HOD or teachers allowed to publish timetables can publish.');
  const { versionId } = body(req);
  if (!isUuid(versionId)) throw bad('INVALID_ID', 'Unknown timetable version.');
  const [v] = await db.q(`select id, term, created_at, created_by, status, divisions from timetable_versions where id = $1`, [versionId]);
  if (!v || v.status !== 'draft') throw new HttpError(404, 'NOT_FOUND', 'That preview is no longer open. Upload the file again.');
  if (v.created_by !== who.account.id && !who.admin) throw forbidden('Only the person who uploaded this preview (or the HOD) can publish it.');
  // Revalidate the stored rows (lookup lists or divisions may have changed since the preview).
  const known = new Set((await db.q('select code from divisions')).map((r) => r.code));
  const stale = v.divisions.filter((d) => !known.has(d));
  if (stale.length) throw new HttpError(409, 'STALE_PREVIEW', `Divisions no longer exist: ${stale.join(', ')}. Upload the file again.`);
  // Concurrency: refuse if someone published this term after this preview was made.
  const [newer] = await db.q(`select id from timetable_versions where term = $1 and status = 'published' and published_at > $2 limit 1`, [v.term, v.created_at]);
  if (newer) throw new HttpError(409, 'PUBLISHED_SINCE', 'Someone published a timetable for this term after your preview. Check it, then upload again.');
  const rows = await db.q(`update timetable_versions set status = 'published', published_at = now(), published_by = $2 where id = $1 and status = 'draft' returning published_at, lookups`, [versionId, who.account.id]);
  if (!rows.length) throw new HttpError(409, 'ALREADY_PUBLISHED', 'This preview was already published.');
  const lk = rows[0].lookups || {};
  if ((lk.subjects || []).length) await db.q(`insert into subjects (code, name) select x->>0, x->>1 from jsonb_array_elements($1::jsonb) x on conflict (code) do update set name = excluded.name`, [JSON.stringify(lk.subjects)]);
  if ((lk.faculty || []).length) await db.q(`insert into faculty (code, name, dept) select x->>0, x->>1, x->>2 from jsonb_array_elements($1::jsonb) x on conflict (code) do update set name = excluded.name, dept = excluded.dept`, [JSON.stringify(lk.faculty)]);
  await db.audit(who.account.id, 'timetable.publish', versionId, { term: v.term, divisions: v.divisions });
  return { published: versionId, publishedAt: rows[0].published_at, divisions: v.divisions };
}
async function ttRollback(who, req) {
  if (!canPublishTT(who)) throw forbidden();
  const { versionId } = body(req);
  if (!isUuid(versionId)) throw bad('INVALID_ID', 'Unknown timetable version.');
  const rows = await db.q(`update timetable_versions set published_at = now(), published_by = $2 where id = $1 and status = 'published' returning term, divisions`, [versionId, who.account.id]);
  if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Only a previously published version can be restored.');
  await db.audit(who.account.id, 'timetable.rollback', versionId, { term: rows[0].term });
  return { restored: versionId, divisions: rows[0].divisions };
}
async function ttVersions(who) {
  if (!canPublishTT(who)) throw forbidden();
  const rows = await db.q(
    `select v.id, v.term, v.file_name, v.row_count, v.divisions, v.status, v.created_at, v.published_at, a.name as uploader,
            v.published_at = (select max(published_at) from timetable_versions w where w.term = v.term and w.status = 'published') as current
       from timetable_versions v left join accounts a on a.id = v.created_by
      where v.status = 'published' or v.created_by = $1 order by coalesce(v.published_at, v.created_at) desc limit 50`, [who.account.id]);
  return { versions: rows };
}
async function timetable(who, req) {
  let division = who.approvedDivision;
  if (req.query.division && (who.admin || who.teacher)) division = txt(req.query.division, 10).toUpperCase();
  if (!division) return { division: null, entries: [], message: 'Join your class (and wait for approval) to see its timetable.' };
  const [v] = await db.q(`select id, term, published_at from timetable_versions where status = 'published' and $1 = any(divisions) order by published_at desc limit 1`, [division]);
  if (!v) return { division, entries: [], message: 'No timetable has been published for your class yet.' };
  const entries = await db.q(
    `select e.day, e.start_min, e.end_min, e.subject, e.teacher_code, e.room, e.batch, e.type, s.name as subject_name, f.name as teacher_name
       from timetable_entries e left join subjects s on s.code = e.subject left join faculty f on f.code = e.teacher_code
      where e.version_id = $1 and e.division_code = $2 order by e.day, e.start_min, e.batch`, [v.id, division]);
  return { division, term: v.term, publishedAt: v.published_at, entries };
}

/* ------------------------------ Phase 4: joining a class ------------------------------ */
async function join(who, req) {
  if (who.teacher || who.admin) throw forbidden('Teacher and HOD accounts do not join a class.');
  await limit(`join:${who.account.id}`, 10, 3600);
  const division = txt(body(req).division, 10).toUpperCase();
  const [d] = await db.q('select code from divisions where code = $1', [division]);
  if (!d) throw bad('UNKNOWN_DIVISION', 'Choose a division from the list.');
  if (who.approvedDivision) throw new HttpError(409, 'ALREADY_APPROVED', `You are already in ${who.approvedDivision}. Ask the HOD to move you.`);
  await db.q(`delete from enrollments where account_id = $1 and status in ('pending', 'rejected')`, [who.account.id]);
  await db.q(`insert into enrollments (account_id, division_code, status) values ($1, $2, 'pending')`, [who.account.id, division]);
  await db.audit(who.account.id, 'join.request', division);
  return { enrollment: { division_code: division, status: 'pending' } };
}
async function requests(who, req) {
  const scopes = who.admin ? null : who.cr;
  if (!who.admin && !scopes.length) throw forbidden('Only class representatives and the HOD can review join requests.');
  let division = req.query.division ? txt(req.query.division, 10).toUpperCase() : null;
  if (division && scopes && !scopes.includes(division)) throw forbidden('You can only manage your own class.');
  const divs = division ? [division] : scopes; // null = all (HOD)
  const rows = await db.q(
    `select e.account_id, e.division_code, e.status, e.created_at, e.decided_at, a.name, a.phone, s.profile->>'roll' as roll,
            d.name as decided_by_name, exists (select 1 from account_roles r where r.account_id = e.account_id and r.role = 'cr' and r.scope = e.division_code) as is_cr
       from enrollments e join accounts a on a.id = e.account_id left join account_state s on s.account_id = e.account_id
       left join accounts d on d.id = e.decided_by
      where ($1::text[] is null or e.division_code = any($1))
      order by (e.status = 'pending') desc, e.created_at desc limit 300`, [divs]);
  return { requests: rows.map(({ phone, ...r }) => ({ ...r, phone: mask(phone) })) };
}
async function decide(who, req) {
  const b = body(req);
  const decision = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : null;
  if (!decision) throw bad('INVALID_DECISION', 'Decision must be approve or reject.');
  if (!isUuid(b.accountId)) throw bad('INVALID_ID', 'Unknown student.');
  const division = txt(b.division, 10).toUpperCase();
  const asCr = !who.admin;
  if (asCr && !who.cr.includes(division)) throw forbidden('You can only manage requests for your own class.');
  if (b.accountId === who.account.id && !who.admin) throw forbidden('You cannot decide your own request.');
  const [cur] = await db.q('select status from enrollments where account_id = $1 and division_code = $2', [b.accountId, division]);
  if (!cur) throw new HttpError(404, 'NOT_FOUND', 'No such request.');
  if (asCr && cur.status !== 'pending') throw forbidden('This request was already decided. Only the HOD can change it.');
  if (decision === 'approved') {
    const [other] = await db.q(`select division_code from enrollments where account_id = $1 and status = 'approved' and division_code <> $2`, [b.accountId, division]);
    if (other && asCr) throw new HttpError(409, 'IN_OTHER_CLASS', `This student is already approved in ${other.division_code}.`);
    if (other) { // HOD moves the student: the old approval is closed first.
      await db.q(`update enrollments set status = 'rejected', decided_by = $3, decided_at = now() where account_id = $1 and division_code = $2`, [b.accountId, other.division_code, who.account.id]);
      await db.q(`delete from account_roles where account_id = $1 and role = 'cr' and scope = $2`, [b.accountId, other.division_code]);
    }
  } else {
    await db.q(`delete from account_roles where account_id = $1 and role = 'cr' and scope = $2`, [b.accountId, division]);
  }
  await db.q(`update enrollments set status = $3, decided_by = $4, decided_at = now() where account_id = $1 and division_code = $2`, [b.accountId, division, decision, who.account.id]);
  await db.audit(who.account.id, `join.${decision === 'approved' ? 'approve' : 'reject'}`, `${division}:${b.accountId}`, { by: asCr ? 'cr' : 'hod', previous: cur.status, override: cur.status !== 'pending' });
  return { division, accountId: b.accountId, status: decision };
}
async function hodCr(who, req) {
  needHod(who);
  const b = body(req);
  const division = txt(b.division, 10).toUpperCase();
  if (!isUuid(b.accountId)) throw bad('INVALID_ID', 'Unknown student.');
  if (b.action === 'remove') {
    await db.q(`delete from account_roles where account_id = $1 and role = 'cr' and scope = $2`, [b.accountId, division]);
    await db.audit(who.account.id, 'cr.remove', `${division}:${b.accountId}`);
    return { removed: true };
  }
  const [e] = await db.q(`select 1 from enrollments where account_id = $1 and division_code = $2 and status = 'approved'`, [b.accountId, division]);
  if (!e) throw bad('NOT_IN_CLASS', 'A class representative must be an approved student of that class.');
  await db.q(`insert into account_roles (account_id, role, scope, granted_by) values ($1, 'cr', $2, $3) on conflict do nothing`, [b.accountId, division, who.account.id]);
  await db.audit(who.account.id, 'cr.appoint', `${division}:${b.accountId}`);
  return { appointed: true };
}
async function hodAudit(who, req) {
  needHod(who);
  const before = req.query.before && /^\d+$/.test(req.query.before) ? Number(req.query.before) : null;
  const rows = await db.q(`select l.id, l.at, l.action, l.target, l.detail, a.name as actor_name
    from audit_log l left join accounts a on a.id = l.actor where ($1::bigint is null or l.id < $1) order by l.id desc limit 100`, [before]);
  return { entries: rows.map((r) => ({ ...r, id: Number(r.id) })) };
}

/* ------------------------------ router ------------------------------ */
const ROUTES = {
  'GET me': (w) => getMe(w), 'PUT me': putMe, 'GET divisions': getDivisions,
  'GET feed': feed, 'GET file': getFile, 'POST posts': createPost, 'GET posts': myPosts, 'DELETE posts': deletePost,
  'GET hod-teachers': hodTeachers, 'POST hod-teachers': hodTeachers, 'DELETE hod-teachers': hodTeachers,
  'POST timetable-preview': ttPreview, 'POST timetable-publish': ttPublish, 'POST timetable-rollback': ttRollback,
  'GET timetable-versions': ttVersions, 'GET timetable': timetable,
  'POST join': join, 'GET requests': requests, 'POST decide': decide, 'POST hod-cr': hodCr, 'GET hod-audit': hodAudit,
  'GET hod-students': async (w, req) => {
    needHod(w);
    const d = txt(req.query.division, 10).toUpperCase();
    const rows = await db.q(`select a.id, a.name, a.phone, s.profile->>'roll' as roll, exists (select 1 from account_roles r where r.account_id = a.id and r.role = 'cr' and r.scope = $1) as is_cr
      from enrollments e join accounts a on a.id = e.account_id left join account_state s on s.account_id = a.id
      where e.division_code = $1 and e.status = 'approved' order by a.name limit 200`, [d]);
    return { students: rows.map(({ phone, ...r }) => ({ ...r, phone: mask(phone) })) };
  },
};

module.exports = async (req, res) => {
  req.query = req.query || {};
  const route = req.query.route || (req.url || '').split('?')[0].replace(/^.*\/app\/?/, '').replace(/\/+$/, '');
  res.setHeader('Cache-Control', 'no-store');
  const handler = ROUTES[`${req.method} ${route}`];
  try {
    const phone = getPhone(req);
    if (!phone) throw new HttpError(401, 'NO_SESSION', 'Sign in required.');
    if (!handler) throw new HttpError(404, 'NOT_FOUND', 'Unknown route.');
    await db.ensureSchema();
    const who = await access.resolve(phone);
    const out = await handler(who, req, res);
    if (out === SENT) return undefined;
    return res.status(200).json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ ok: false, code: e.code, error: e.message, ...(e.extra || {}) });
    if (e && e.code === 'DB_NOT_CONFIGURED') return res.status(503).json({ ok: false, code: 'DB_NOT_CONFIGURED', error: 'Cloud sync is not configured on the server.' });
    if (e && e.code === '23505') return res.status(409).json({ ok: false, code: 'CONFLICT', error: 'That change conflicts with an existing record. Refresh and try again.' });
    console.error('app api error', route, e && e.code); // no personal data in logs
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Something went wrong. Try again.' });
  }
};
