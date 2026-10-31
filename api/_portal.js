// api/_portal.js — portal upgrade (migration 7): verified profile set-up, unified publishing (assignments, notices,
// CA/tutorial/exam dates, material, announcements, sports/cultural updates), assignment hand-in, the academic
// calendar, class roles (CR positions, SI, CI), the HOD branch dashboard and division set-up, the syllabus link,
// and clubs/councils with their events, registrations and announcements. Routes are registered in api/app.js.
//
// Rules kept from the rest of the server: identity and roles come from the verified session + database (never the
// request); every action calls can() (api/_policy.js) or the club permission check below; multi-row changes are one
// SQL statement; every change is written to the audit log; nothing is invented (empty states name the missing data).
module.exports = (H) => {
  const { db, can, need, bad, forbidden, notFound, conflict, body, txt, isUuid, division, limit, branchOf, displayName, allowedDivisions, normalizeEmail, isInstitutional, mask, HttpError, FILE_TYPES, MAX_FILE, PAGE, setting, INSTITUTION_DOMAIN } = H;
  const TZ = 'Asia/Kolkata';
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const validDay = (s) => DATE_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  const DAY = 86400000;
  const isStaff = (who) => who.base === 'hod' || who.base === 'teacher';
  const httpsUrl = (v, max = 500) => { const s = txt(v, max); if (!s) return ''; let u; try { u = new URL(s); } catch { return null; } return u.protocol === 'https:' && s.length <= max ? u.toString() : null; };

  /* ---------------- shared file reader (same rules as posts) ---------------- */
  function readFile(f, { images = false } = {}) {
    if (f === undefined || f === null) return null;
    if (typeof f !== 'object' || Array.isArray(f)) throw bad('INVALID_FILE', 'File is malformed.');
    const mime = txt(f.mime, 120), name = txt(f.name, 120).replace(/[\\/:*?"<>|]/g, '_');
    if (images ? !['image/png', 'image/jpeg'].includes(mime) : !FILE_TYPES[mime]) throw bad('FILE_TYPE', images ? 'Posters must be PNG or JPG images.' : 'Allowed files: PDF, Word, PowerPoint, Excel, PNG, JPG or text.');
    if (typeof f.dataBase64 !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(f.dataBase64)) throw bad('INVALID_FILE', 'File data is malformed.');
    const bytes = Buffer.from(f.dataBase64, 'base64');
    if (!bytes.length) throw bad('INVALID_FILE', 'The file is empty.');
    if (bytes.length > MAX_FILE) throw new HttpError(413, 'FILE_TOO_LARGE', 'Files can be up to 3 MB.');
    return { name: name || `file.${FILE_TYPES[mime]}`, mime, bytes };
  }
  async function storeFile(who, file) {
    if (!file) return null;
    const [r] = await db.q(`insert into files (owner_id, name, mime, size, bytes) values ($1, $2, $3, $4, decode($5, 'hex')) returning id`, [who.account.id, file.name, file.mime, file.bytes.length, file.bytes.toString('hex')]);
    return r.id;
  }

  /* ============================== 1. profile set-up ============================== */
  const GENDERS = ['female', 'male', 'other', 'prefer_not_to_say'];
  const ROLL_RE = /^[A-Za-z0-9/-]{1,20}$/;
  function mobileOf(v) {
    const digits = String(v === undefined || v === null ? '' : v).replace(/[\s()-]/g, '').replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
    if (!/^[6-9]\d{9}$/.test(digits)) throw bad('INVALID_MOBILE', 'Enter a 10-digit Indian mobile number.');
    return '+91' + digits;
  }
  async function setupState(who) {
    const [s] = await db.q('select setup, setup_at from account_state where account_id = $1', [who.account.id]);
    return { setup: (s && s.setup) || null, setupAt: (s && s.setup_at) || null };
  }
  async function getSetup(who) {
    const { setup, setupAt } = await setupState(who);
    const fixed = { email: who.phone, role: who.base };
    if (who.base === 'teacher') Object.assign(fixed, { name: who.teacher.name, branch: who.teacher.branch, teaches: who.teacher.teaches });
    if (who.base === 'hod') fixed.branches = who.hodBranches;
    if (who.base === 'student') fixed.enrollment = who.enrollment ? { ...who.enrollment, branch: branchOf(who, who.enrollment.division_code), level: (who.divisions.get(who.enrollment.division_code) || {}).level || null } : null;
    return { setup, setupAt, required: who.base !== 'parent', done: who.base === 'parent' || !!setup, fixed };
  }
  async function putSetup(who, req) {
    if (who.base === 'parent') throw forbidden('Parents don’t need to set up a profile.');
    await limit(`setup:${who.account.id}`, 20, 600);
    const b = body(req);
    const name = txt(b.name, 80);
    if (name.length < 2) throw bad('INVALID_NAME', 'Enter your full name.');
    const mobile = mobileOf(b.mobile);
    let setup;
    if (who.base === 'student') {
      const gender = txt(b.gender, 20);
      if (!GENDERS.includes(gender)) throw bad('INVALID_GENDER', 'Choose a gender, or “Prefer not to say”.');
      const level = Number(b.yearLevel);
      if (![1, 2, 3, 4].includes(level)) throw bad('INVALID_YEAR', 'Choose your academic year.');
      const branch = txt(b.branch, 10).toUpperCase();
      const [br] = await db.q('select code from branches where code = $1 and active', [branch]);
      if (!br) throw bad('INVALID_BRANCH', 'Choose your branch from the list.');
      const roll = txt(b.roll, 20);
      if (!ROLL_RE.test(roll)) throw bad('INVALID_ROLL', 'Enter your roll number (letters, digits, - or /).');
      // A verified class wins over what the profile says: a mismatch is a division-change request, not a profile edit.
      if (who.enrollment) {
        const d = who.divisions.get(who.enrollment.division_code) || {};
        if (d.branch_code !== branch || (d.level && d.level !== level)) throw conflict('CLASS_MISMATCH', `Your confirmed class is ${who.enrollment.division_code} (${d.branch_code}). To change it, request a division change; your profile can’t override it.`);
      }
      setup = { name, gender, mobile, yearLevel: level, branch, roll };
    } else {
      if (b.confirm !== true) throw bad('CONFIRM_REQUIRED', 'Confirm that your details are correct.');
      setup = { name, mobile, confirmed: true };
    }
    await db.q('insert into account_state (account_id) values ($1) on conflict (account_id) do nothing', [who.account.id]);
    // The validated copy goes to `setup`; name and roll are mirrored into the synced profile (used by class lists).
    await db.q(`update account_state set setup = $2::jsonb, setup_at = now(),
        profile = profile || jsonb_strip_nulls(jsonb_build_object('name', $3::text, 'roll', $4::text)) where account_id = $1`,
      [who.account.id, JSON.stringify(setup), name, setup.roll || null]);
    if (name !== who.account.name) await db.q('update accounts set name = $2 where id = $1', [who.account.id, name]);
    await db.audit(who.account.id, 'profile.setup', who.account.id, { role: who.base }, who.base === 'student' ? setup.branch : (who.hodBranches[0] || (who.teacher && who.teacher.branch) || null));
    return { setup };
  }

  /* ============================== 2. unified publishing ============================== */
  const KINDS = { assignment: 'Assignment', notice: 'Academic notice', exam: 'Exam', ca: 'CA', tutorial: 'Tutorial', practical: 'Practical', material: 'Study material', announcement: 'Class announcement', other: 'Other', sports: 'Sports update', cultural: 'Cultural update' };
  const DATED = ['exam', 'ca', 'tutorial', 'practical'];
  const NEEDS_SUBJECT = ['assignment', 'exam', 'ca', 'tutorial', 'practical', 'material'];
  const actionFor = (kind) => (kind === 'sports' ? 'publish.sports' : kind === 'cultural' ? 'publish.cultural' : 'publish.academic');
  // What students see: published (or cancelled, shown as cancelled), never drafts, archived or not-yet-scheduled items.
  const VISIBLE = `p.deleted_at is null and p.status in ('published', 'cancelled') and (p.publish_at is null or p.publish_at <= now())`;
  const ITEM_COLS = `p.id, p.kind, p.title, p.body, p.subject, p.status, p.author_name, p.author_role, p.author_id, p.created_at, p.updated_at, p.publish_at,
    p.due_at, to_char(p.event_date, 'YYYY-MM-DD') as event_date, f.id as file_id, f.name as file_name, f.mime as file_mime, f.size as file_size,
    (select array_agg(division_code order by division_code) from post_targets where post_id = p.id) as divisions`;

  function parseWhen(b, kind, editing) {
    let due = null, eventDate = null, publishAt = null;
    if (b.dueAt) {
      const t = Date.parse(b.dueAt);
      if (Number.isNaN(t)) throw bad('INVALID_DEADLINE', 'Check the deadline.');
      if (!editing && t < Date.now() - 5 * 60000) throw bad('INVALID_DEADLINE', 'The deadline has already passed.');
      if (t > Date.now() + 400 * DAY) throw bad('INVALID_DEADLINE', 'Choose a deadline within the next year.');
      due = new Date(t).toISOString();
    }
    if (b.eventDate) {
      const s = txt(b.eventDate, 10);
      if (!validDay(s)) throw bad('INVALID_DATE', 'Pick a valid date.');
      const t = Date.parse(s + 'T00:00:00Z');
      if (t < Date.now() - 400 * DAY || t > Date.now() + 400 * DAY) throw bad('INVALID_DATE', 'That date is outside the allowed range.');
      eventDate = s;
    }
    if (DATED.includes(kind) && !eventDate) throw bad('DATE_REQUIRED', `Give the ${KINDS[kind]} date.`);
    if (b.publishAt) {
      const t = Date.parse(b.publishAt);
      if (Number.isNaN(t) || t > Date.now() + 366 * DAY) throw bad('INVALID_PUBLISH_DATE', 'Choose a publish date within the next year.');
      publishAt = t > Date.now() ? new Date(t).toISOString() : null; // a past date means "now"
    }
    return { due, eventDate, publishAt };
  }
  function targetsOf(who, b, action) {
    const targets = Array.isArray(b.divisions) ? [...new Set(b.divisions.map((x) => txt(x, 12).toUpperCase()))] : [];
    if (!targets.length) throw bad('NO_TARGETS', 'Choose at least one division.');
    if (targets.length > 60) throw bad('TOO_MANY_TARGETS', 'Choose at most 60 divisions.');
    const notAllowed = targets.filter((d) => !can(who, action, { division: d }));
    if (notAllowed.length) throw forbidden(`Nothing was published: you can't publish this to ${notAllowed.join(', ')}.`);
    return targets;
  }
  /** May this person change an existing item? Its author (while still allowed for every target) or the HOD of all targets. */
  const manages = (who, p) => (p.divisions || []).length > 0 && ((p.author_id === who.account.id && p.divisions.every((d) => can(who, actionFor(p.kind), { division: d }))) || p.divisions.every((d) => can(who, 'join.override', { division: d })));

  async function publish(who, req) {
    await limit(`pub:${who.account.id}`, 40, 600);
    const b = body(req);
    const kind = txt(b.kind, 20);
    if (!KINDS[kind]) throw bad('INVALID_KIND', 'Choose what you are publishing.');
    const action = actionFor(kind);
    const title = txt(b.title, 140), text = txt(b.body, 4000), subject = txt(b.subject, 80);
    if (title.length < 3) throw bad('INVALID_TITLE', 'Give it a title (at least 3 characters).');
    if (NEEDS_SUBJECT.includes(kind) && !subject) throw bad('SUBJECT_REQUIRED', 'Choose the subject.');
    const targets = targetsOf(who, b, action);
    const editing = b.id !== undefined && b.id !== null;
    const { due, eventDate, publishAt } = parseWhen(b, kind, editing);
    const file = readFile(b.file);
    if (file && who.base === 'student') throw forbidden('Class roles can publish text updates, not files.');
    const audit = async (act, id, extra) => { for (const br of [...new Set(targets.map((d) => branchOf(who, d)))]) await db.audit(who.account.id, act, id, { kind, title, divisions: targets.filter((d) => branchOf(who, d) === br), ...extra }, br); };
    if (editing) {
      if (!isUuid(b.id)) throw bad('INVALID_ID', 'Unknown item.');
      const [p] = await db.q(`select p.id, p.kind, p.status, p.author_id, p.file_id, (select array_agg(division_code) from post_targets where post_id = p.id) as divisions from posts p where p.id = $1 and p.deleted_at is null`, [b.id]);
      if (!p || !manages(who, p)) throw notFound('Item not found, or you can’t change it.');
      if (p.status === 'archived') throw conflict('ARCHIVED', 'This item is archived. Restore it before editing.');
      if (kind === 'material' && !file && (!p.file_id || b.removeFile)) throw bad('NO_FILE', 'Attach the material file.');
      const fileId = await storeFile(who, file);
      const rows = await db.q(
        `with u as (update posts set kind = $2, title = $3, body = $4, subject = $5, due_at = $6, event_date = $7::date,
              publish_at = case when status = 'draft' or publish_at > now() then $8::timestamptz else publish_at end,
              file_id = case when $9::uuid is not null then $9::uuid when $10::boolean then null else file_id end, updated_at = now()
            where id = $1 and deleted_at is null and status <> 'archived' returning id),
         d as (delete from post_targets t using u where t.post_id = u.id and not (t.division_code = any($11::text[])) returning 1),
         i as (insert into post_targets (post_id, division_code) select u.id, unnest($11::text[]) from u on conflict do nothing returning 1)
         select (select count(*) from u)::int as n`,
        [b.id, kind, title, text, subject, due, eventDate, publishAt, fileId, b.removeFile === true, targets]);
      if (!rows[0].n) throw conflict('CHANGED', 'This item changed meanwhile. Refresh and try again.');
      await audit('publish.edit', b.id, {});
      return { item: { id: b.id, status: p.status } };
    }
    if (kind === 'material' && !file) throw bad('NO_FILE', 'Attach the material file.');
    const status = b.draft === true ? 'draft' : 'published';
    const authorRole = who.base === 'student' ? (kind === 'sports' ? 'si' : 'ci') : who.base;
    const fileId = await storeFile(who, file);
    const [row] = await db.q(
      `with p as (insert into posts (author_id, author_name, kind, title, body, file_id, author_role, subject, due_at, event_date, publish_at, status, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11, $12, now()) returning id, created_at),
        t as (insert into post_targets (post_id, division_code) select p.id, unnest($13::text[]) from p returning 1)
       select p.id, p.created_at, (select count(*) from t)::int as targets from p`,
      [who.account.id, displayName(who), kind, title, text, fileId, authorRole, subject, due, eventDate, publishAt, status, targets]);
    await audit(status === 'draft' ? 'publish.draft' : 'publish.create', row.id, { scheduled: publishAt });
    return { item: { id: row.id, createdAt: row.created_at, status, divisions: targets, kind, title, publishAt } };
  }
  async function publishStatus(who, req) {
    const b = body(req);
    const to = txt(b.status, 12);
    if (!isUuid(b.id) || !['published', 'archived', 'cancelled'].includes(to)) throw bad('INVALID', 'Choose publish, archive or cancel.');
    const [p] = await db.q(`select p.id, p.kind, p.title, p.status, p.author_id, (select array_agg(division_code) from post_targets where post_id = p.id) as divisions from posts p where p.id = $1 and p.deleted_at is null`, [b.id]);
    if (!p || !manages(who, p)) throw notFound('Item not found, or you can’t change it.');
    const from = { published: ['draft', 'archived', 'cancelled'], archived: ['published', 'cancelled', 'draft'], cancelled: ['published'] }[to];
    const rows = await db.q(`update posts set status = $2, updated_at = now(), publish_at = case when $2 = 'published' and status = 'draft' and (publish_at is null or publish_at <= now()) then null else publish_at end
      where id = $1 and status = any($3::text[]) returning status`, [b.id, to, from]);
    if (!rows.length) throw conflict('INVALID_TRANSITION', `This item is ${p.status}; it can’t be ${to === 'published' ? 'published' : to} from there.`);
    for (const br of [...new Set(p.divisions.map((d) => branchOf(who, d)))]) await db.audit(who.account.id, `publish.${to}`, b.id, { from: p.status, title: p.title }, br);
    return { status: to };
  }
  async function listPublished(who, req) {
    const branchWide = req.query.scope === 'branch';
    if (branchWide && who.base !== 'hod') throw forbidden('Only HODs see everything published in the branch.');
    const divs = branchWide ? allowedDivisions(who, 'branch.view') : null;
    const rows = await db.q(
      `select ${ITEM_COLS},
          (select count(*)::int from assignment_submissions s where s.post_id = p.id) as submitted,
          (select count(*)::int from class_enrollments e join post_targets t on t.division_code = e.division_code where t.post_id = p.id and e.status = 'active') as class_size
         from posts p left join files f on f.id = p.file_id
        where p.deleted_at is null and (case when $5::boolean then exists (select 1 from post_targets t where t.post_id = p.id and t.division_code = any($2::text[])) else p.author_id = $1 end)
          and ($3::text = '' or p.status = $3)
        order by p.created_at desc limit ${PAGE} offset $4`,
      [who.account.id, divs || [], txt(req.query.status, 12), Math.max(0, Math.min(1000, parseInt(req.query.page, 10) || 0)) * PAGE, branchWide]);
    return { items: rows.map(({ author_id, ...r }) => ({ ...r, mine: author_id === who.account.id })) };
  }
  /** Items for one class, as students see them (staff may look at their own classes). */
  async function classItems(who, req) {
    const div = who.base === 'student' ? (who.enrollment ? who.enrollment.division_code : null) : req.query.division ? division(who, req.query.division) : null;
    if (!div) return { division: null, items: [], message: who.base === 'student' ? 'Join your class to see work from your teachers.' : 'Choose a division.' };
    need(who, 'calendar.view', { division: div });
    const kinds = txt(req.query.kinds, 200).split(',').map((k) => k.trim()).filter((k) => KINDS[k]);
    const rows = await db.q(
      `select ${ITEM_COLS}, s.submitted_at as my_submitted_at, s.note as my_note, s.file_id as my_file_id
         from post_targets t join posts p on p.id = t.post_id left join files f on f.id = p.file_id
         left join assignment_submissions s on s.post_id = p.id and s.student_id = $2
        where t.division_code = $1 and ${VISIBLE} and (cardinality($3::text[]) = 0 or p.kind = any($3::text[]))
        order by (p.due_at is null), p.due_at, p.created_at desc limit 100`, [div, who.account.id, kinds]);
    return { division: div, items: rows.map(({ author_id, my_submitted_at, my_note, my_file_id, ...r }) => ({ ...r, submission: who.base === 'student' && my_submitted_at ? { submittedAt: my_submitted_at, note: my_note, fileId: my_file_id, late: !!(r.due_at && new Date(my_submitted_at) > new Date(r.due_at)) } : null })) };
  }

  /* ============================== 3. assignment hand-in ============================== */
  async function visibleAssignment(who, id) {
    if (!isUuid(id)) throw bad('INVALID_ID', 'Unknown assignment.');
    const div = who.enrollment && who.enrollment.division_code;
    if (!div) throw forbidden('Join your class first.');
    const [p] = await db.q(`select p.id, p.kind, p.status, p.due_at, p.title from posts p join post_targets t on t.post_id = p.id and t.division_code = $2 where p.id = $1 and ${VISIBLE}`, [id, div]);
    if (!p || p.kind !== 'assignment') throw notFound('Assignment not found for your class.');
    return { p, div };
  }
  async function submit(who, req) {
    if (who.base !== 'student') throw forbidden('Only students hand in assignments.');
    await limit(`sub:${who.account.id}`, 30, 600);
    const b = body(req);
    const { p, div } = await visibleAssignment(who, b.postId);
    need(who, 'submission.create', { division: div });
    if (p.status === 'cancelled') throw conflict('CANCELLED', 'This assignment was cancelled by your teacher.');
    const note = txt(b.note, 2000), file = readFile(b.file);
    if (!note && !file) throw bad('EMPTY_SUBMISSION', 'Add a file or a note to hand in.');
    const fileId = await storeFile(who, file);
    const [r] = await db.q(
      `insert into assignment_submissions (post_id, student_id, division_code, note, file_id) values ($1, $2, $3, $4, $5)
       on conflict (post_id, student_id) do update set note = excluded.note, file_id = coalesce(excluded.file_id, assignment_submissions.file_id), updated_at = now(), submitted_at = now()
       returning submitted_at, (xmax = 0) as created`, [p.id, who.account.id, div, note, fileId]);
    const late = !!(p.due_at && new Date(r.submitted_at) > new Date(p.due_at));
    await db.audit(who.account.id, r.created ? 'submission.create' : 'submission.update', p.id, { division: div, late, file: file ? { name: file.name, size: file.bytes.length } : null }, branchOf(who, div));
    return { submission: { submittedAt: r.submitted_at, late } };
  }
  async function withdraw(who, req) {
    if (who.base !== 'student') throw forbidden();
    const { p, div } = await visibleAssignment(who, req.query.postId);
    if (p.due_at && new Date(p.due_at) < new Date()) throw conflict('PAST_DEADLINE', 'The deadline has passed; ask your teacher to return it.');
    const rows = await db.q('delete from assignment_submissions where post_id = $1 and student_id = $2 returning 1', [p.id, who.account.id]);
    if (!rows.length) throw notFound('Nothing handed in yet.');
    await db.audit(who.account.id, 'submission.withdraw', p.id, { division: div }, branchOf(who, div));
    return { withdrawn: true };
  }
  async function listSubmissions(who, req) {
    if (!isUuid(req.query.postId)) throw bad('INVALID_ID', 'Unknown assignment.');
    const [p] = await db.q(`select p.id, p.title, p.due_at, p.kind, (select array_agg(division_code) from post_targets where post_id = p.id) as divisions from posts p where p.id = $1 and p.deleted_at is null`, [req.query.postId]);
    const divs = p ? (p.divisions || []).filter((d) => can(who, 'submission.view', { division: d })) : [];
    if (!p || !divs.length) throw notFound('Assignment not found, or not for your classes.');
    const rows = await db.q(
      `select a.id as student_id, a.name, st.profile->>'roll' as roll, e.division_code, s.submitted_at, s.note, s.file_id, f.name as file_name
         from class_enrollments e join accounts a on a.id = e.student_id left join account_state st on st.account_id = a.id
         left join assignment_submissions s on s.post_id = $1 and s.student_id = a.id left join files f on f.id = s.file_id
        where e.division_code = any($2) and e.status = 'active' order by e.division_code, nullif(st.profile->>'roll', '') nulls last, a.name limit 600`, [p.id, divs]);
    const students = rows.map((r) => ({ ...r, state: !r.submitted_at ? (p.due_at && new Date(p.due_at) < new Date() ? 'missing' : 'not_yet') : p.due_at && new Date(r.submitted_at) > new Date(p.due_at) ? 'late' : 'on_time' }));
    return { assignment: { id: p.id, title: p.title, dueAt: p.due_at, divisions: divs }, students, counts: { submitted: students.filter((s) => s.submitted_at).length, total: students.length } };
  }

  /* ============================== 4. academic calendar ============================== */
  /** Club events a person may see: audience empty = everyone; otherwise their verified branch and year must match. */
  const audienceSql = (br, lvl) => `(coalesce(jsonb_array_length(e.audience->'branches'), 0) = 0 or e.audience->'branches' ? ${br})
      and (coalesce(jsonb_array_length(e.audience->'years'), 0) = 0 or e.audience->'years' @> to_jsonb(${lvl}::int))`;
  function viewer(who) {
    if (who.base === 'student') {
      const div = who.enrollment ? who.enrollment.division_code : null, d = div ? who.divisions.get(div) || {} : {};
      return { divisions: div ? [div] : [], branches: d.branch_code ? [d.branch_code] : [], branch: d.branch_code || '', level: d.level || 0, staff: false };
    }
    if (who.base === 'teacher') { const divisions = who.teacher.divisions; return { divisions, branches: [...new Set([who.teacher.branch, ...divisions.map((x) => branchOf(who, x))].filter(Boolean))], branch: '', level: 0, staff: true }; }
    if (who.base === 'hod') return { divisions: allowedDivisions(who, 'branch.view'), branches: who.hodBranches, branch: '', level: 0, staff: true };
    return { divisions: [], branches: [], branch: '', level: 0, staff: false };
  }
  async function calendar(who, req) {
    if (who.base === 'parent') throw forbidden('Parents see dates in the Parent portal.');
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const from = validDay(txt(req.query.from, 10)) ? txt(req.query.from, 10) : today;
    const to = validDay(txt(req.query.to, 10)) ? txt(req.query.to, 10) : new Date(Date.parse(from + 'T00:00:00Z') + 41 * DAY).toISOString().slice(0, 10);
    const span = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY;
    if (span < 0 || span > 100) throw bad('INVALID_RANGE', 'Choose a range of up to 100 days.');
    const v = viewer(who);
    let divs = v.divisions;
    if (req.query.division) { const d = division(who, req.query.division); need(who, 'calendar.view', { division: d }); divs = [d]; }
    const items = [];
    if (divs.length) {
      const posts = await db.q(
        `select p.id, p.kind, p.title, p.subject, p.status, p.body,
            to_char(p.due_at at time zone '${TZ}', 'YYYY-MM-DD') as due_day, to_char(p.due_at at time zone '${TZ}', 'HH24:MI') as due_time,
            to_char(p.event_date, 'YYYY-MM-DD') as event_day,
            (select array_agg(division_code order by division_code) from post_targets x where x.post_id = p.id and x.division_code = any($1)) as divisions
           from posts p where ${VISIBLE} and exists (select 1 from post_targets t where t.post_id = p.id and t.division_code = any($1))
            and (((p.due_at at time zone '${TZ}')::date between $2::date and $3::date) or p.event_date between $2::date and $3::date)
          order by p.created_at limit 500`, [divs, from, to]);
      for (const p of posts) {
        const base = { refId: p.id, kind: p.kind, label: KINDS[p.kind], title: p.title, subject: p.subject, divisions: p.divisions, cancelled: p.status === 'cancelled', source: 'post', body: p.body };
        if (p.event_day && p.event_day >= from && p.event_day <= to) items.push({ ...base, key: `post:${p.id}:date`, type: DATED.includes(p.kind) ? p.kind : 'date', date: p.event_day, time: null });
        if (p.due_day && p.due_day >= from && p.due_day <= to) items.push({ ...base, key: `post:${p.id}:due`, type: p.kind === 'assignment' ? 'assignment' : 'deadline', date: p.due_day, time: p.due_time, label: p.kind === 'assignment' ? 'Assignment due' : `${KINDS[p.kind]} deadline` });
      }
      for (const a of await db.q(`select id, subject, name, division_code, to_char(held_on, 'YYYY-MM-DD') as day from assessments where status = 'published' and division_code = any($1) and held_on between $2::date and $3::date limit 200`, [divs, from, to])) {
        items.push({ key: `assessment:${a.id}`, refId: a.id, type: 'assessment', label: 'Assessment', title: a.name, subject: a.subject, divisions: [a.division_code], date: a.day, time: null, source: 'marks' });
      }
      for (const r of await db.q(`select id, title, body, division_code, to_char(remind_at at time zone '${TZ}', 'YYYY-MM-DD') as day, to_char(remind_at at time zone '${TZ}', 'HH24:MI') as time from reminders
          where deleted_at is null and division_code = any($1) and (remind_at at time zone '${TZ}')::date between $2::date and $3::date limit 200`, [divs, from, to])) {
        items.push({ key: `reminder:${r.id}`, refId: r.id, type: 'reminder', label: 'Reminder', title: r.title, body: r.body, divisions: [r.division_code], date: r.day, time: r.time, source: 'reminder' });
      }
    }
    for (const e of await eventsFor(who, v, { from, to })) {
      if (e.day >= from && e.day <= to) items.push({ key: `event:${e.id}`, refId: e.id, type: 'event', label: e.club_name ? `${e.club_name} event` : 'College event', title: e.title, venue: e.venue, date: e.day, time: e.time, cancelled: e.status === 'cancelled', source: e.club_id ? 'club' : 'college' });
      if (e.reg_day && e.reg_day >= from && e.reg_day <= to && e.status === 'published') items.push({ key: `event:${e.id}:reg`, refId: e.id, type: 'registration', label: 'Registration closes', title: e.title, date: e.reg_day, time: e.reg_time, source: e.club_id ? 'club' : 'college' });
    }
    // One entry per thing: the same title on the same date from two sources (e.g. a CA notice and its marks sheet) is shown once.
    const seen = new Set(), out = [];
    for (const i of items.sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')))) {
      const k = i.type === 'registration' ? i.key : `${i.title.trim().toLowerCase()}|${i.date}|${i.type === 'event' ? 'e' : 'a'}`;
      if (seen.has(k) || seen.has(i.key)) continue;
      seen.add(k); seen.add(i.key); out.push(i);
    }
    return { from, to, divisions: divs, items: out, empty: !divs.length && who.base === 'student' ? 'Join your class to see class dates. College and club events still show.' : null };
  }
  async function eventsFor(who, v, { from, to } = {}) {
    // Every parameter is referenced in every variant (Postgres needs a type for each).
    const params = [v.branches, v.branch, v.level || 0, v.staff, from || null, to || null];
    return db.q(
      `select e.id, e.club_id, c.name as club_name, e.branch_code, e.title, e.description, e.venue, e.starts_at, e.ends_at, e.status, e.updated_at, e.layout,
          e.reg_mode, e.reg_link, e.capacity, e.reg_count, e.reg_deadline, e.organizer, e.contact, e.instructions, e.terms, e.poster_file_id, e.registration, e.audience,
          to_char(e.starts_at at time zone '${TZ}', 'YYYY-MM-DD') as day, to_char(e.starts_at at time zone '${TZ}', 'HH24:MI') as time,
          to_char(e.reg_deadline at time zone '${TZ}', 'YYYY-MM-DD') as reg_day, to_char(e.reg_deadline at time zone '${TZ}', 'HH24:MI') as reg_time
         from college_events e left join clubs c on c.id = e.club_id
        where e.status in ('published', 'cancelled')
          and (case when $5::date is null then e.starts_at > now() - interval '60 days'
                    else (e.starts_at at time zone '${TZ}')::date between $5::date - 31 and $6::date end)
          and ((e.club_id is null and e.branch_code = any($1::text[])) or (e.club_id is not null and c.active and ($4::boolean or (${audienceSql('$2::text', '$3')}))))
        order by e.starts_at limit 300`, params);
  }

  /* ============================== 5. overview (student) and syllabus ============================== */
  async function syllabusFor(br) {
    if (!br) return null;
    const [r] = await db.q('select value from settings where key = $1', [`syllabus:${br}`]);
    return r ? r.value : null;
  }
  async function overview(who) {
    const v = viewer(who);
    const branch = v.branches[0] || (who.base === 'student' ? ((await setupState(who)).setup || {}).branch : null) || null;
    const syllabus = await syllabusFor(branch);
    const assignments = who.base === 'student' && who.enrollment ? (await classItems(who, { query: { kinds: 'assignment' } })).items.filter((i) => !i.due_at || new Date(i.due_at) > new Date(Date.now() - 14 * DAY)) : [];
    const events = (await eventsFor(who, v)).filter((e) => new Date(e.ends_at || e.starts_at) > new Date(Date.now() - DAY));
    const eventIds = events.filter((e) => e.club_id).map((e) => e.id);
    const announcements = eventIds.length ? await db.q(`select a.id, a.title, a.body, a.created_at, a.created_by_name, a.event_id, c.name as club_name from club_announcements a join clubs c on c.id = a.club_id
      where a.deleted_at is null and a.event_id = any($1::uuid[]) and a.created_at > now() - interval '30 days' order by a.created_at desc limit 20`, [eventIds]) : [];
    return { branch, syllabus, assignments, events: events.map(eventOut), announcements };
  }
  async function setSyllabus(who, req) {
    const b = body(req);
    const br = txt(b.branch, 10).toUpperCase() || who.hodBranches[0];
    need(who, 'syllabus.manage', { branch: br }, 'Only the HOD of this branch can set its syllabus link.');
    const url = httpsUrl(b.url), image = httpsUrl(b.image);
    if (url === null) throw bad('INVALID_URL', 'The syllabus link must be a full https:// address.');
    if (image === null) throw bad('INVALID_IMAGE', 'The photo link must be a full https:// address, or leave it empty to use the college photo.');
    if (!url) { await db.q('delete from settings where key = $1', [`syllabus:${br}`]); await db.audit(who.account.id, 'syllabus.clear', br, null, br); return { syllabus: null }; }
    const value = { url, image: image || '', label: txt(b.label, 80), updatedAt: new Date().toISOString() };
    await db.q(`insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [`syllabus:${br}`, JSON.stringify(value)]);
    await db.audit(who.account.id, 'syllabus.set', br, { url }, br);
    return { syllabus: value };
  }

  /* ============================== 6. class roles: CR (two positions), SI, CI ============================== */
  const ROLE_NAME = { cr: 'class representative', si: 'sports incharge', ci: 'cultural incharge' };
  async function roleRequest(who, req) {
    const b = body(req);
    const role = txt(b.role, 4);
    if (!ROLE_NAME[role]) throw bad('INVALID_ROLE', 'Choose CR, SI or CI.');
    const div = who.enrollment && who.enrollment.division_code;
    if (!div) throw forbidden('Join your class first.');
    need(who, 'role.request', { division: div });
    await limit(`rolereq:${who.account.id}`, 6, 3600);
    const holds = role === 'cr' ? who.crDivisions.includes(div) : (role === 'si' ? who.siDivisions : who.ciDivisions).includes(div);
    if (holds) throw conflict('ALREADY_HOLDS', `You are already the ${ROLE_NAME[role]} of ${div}.`);
    const [p] = await db.q(`select role from cr_requests where student_id = $1 and status = 'pending'`, [who.account.id]);
    if (p) throw conflict('PENDING_EXISTS', `Your ${ROLE_NAME[p.role] || 'role'} request is already waiting for a decision. Cancel it to ask for another role.`);
    if (role === 'cr') {
      const max = await setting('max_crs_per_division', 2);
      const [{ n }] = await db.q(`select count(*)::int as n from cr_assignments where division_code = $1 and active`, [div]);
      if (n >= max) throw conflict('ROLE_FULL', `${div} already has ${max} class representatives.`);
    } else {
      const [taken] = await db.q(`select 1 from class_roles where division_code = $1 and role = $2 and active`, [div, role]);
      if (taken) throw conflict('ROLE_FULL', `${div} already has a ${ROLE_NAME[role]}.`);
    }
    const [r] = await db.q(`insert into cr_requests (student_id, division_code, role) values ($1, $2, $3) returning id, division_code, role, status, created_at`, [who.account.id, div, role]);
    await db.audit(who.account.id, 'role.request', r.id, { division: div, role }, branchOf(who, div));
    return { request: r };
  }
  async function classRoles(who, req) {
    const scope = allowedDivisions(who, 'role.decide');
    if (!scope.length) throw forbidden('Only class teachers and the HOD manage class roles.');
    const divs = req.query.division ? [division(who, req.query.division)] : scope;
    if (divs.some((d) => !scope.includes(d))) throw forbidden('That class is not yours to manage.');
    const crs = await db.q(`select c.division_code, c.student_id, c.position, c.assigned_at, a.name, s.profile->>'roll' as roll from cr_assignments c join accounts a on a.id = c.student_id left join account_state s on s.account_id = a.id where c.active and c.division_code = any($1) order by c.division_code, c.position nulls last`, [divs]);
    const others = await db.q(`select c.division_code, c.student_id, c.role, c.assigned_at, a.name, s.profile->>'roll' as roll from class_roles c join accounts a on a.id = c.student_id left join account_state s on s.account_id = a.id where c.active and c.division_code = any($1) order by c.division_code, c.role`, [divs]);
    const requests = await db.q(`select q.id, q.division_code, q.role, q.created_at, q.student_id, a.name, s.profile->>'roll' as roll from cr_requests q join accounts a on a.id = q.student_id left join account_state s on s.account_id = a.id where q.status = 'pending' and q.division_code = any($1) order by q.created_at`, [divs]);
    const history = await db.q(`select l.id, l.at, l.action, l.detail, a.name as actor_name from audit_log l left join accounts a on a.id = l.actor where l.action like 'role.%' and l.detail->>'division' = any($1) order by l.id desc limit 50`, [divs]);
    return { divisions: divs, max: await setting('max_crs_per_division', 2), crs, others, requests, history: history.map((h) => ({ ...h, id: Number(h.id) })) };
  }
  async function assignRole(who, { div, studentId, role, position, replace, requestId, note }) {
    let rows;
    if (role === 'cr') {
      if (!['male', 'female'].includes(position)) throw bad('POSITION_REQUIRED', 'Choose the CR position: male CR or female CR.');
      const max = await setting('max_crs_per_division', 2);
      rows = await db.q(
        `with cand as (select $1::uuid as sid where exists (select 1 from class_enrollments e where e.student_id = $1 and e.division_code = $2 and e.status = 'active')
              and ($6::uuid is null or exists (select 1 from cr_requests q where q.id = $6 and q.status = 'pending' and q.role = 'cr' and q.student_id = $1 and q.division_code = $2))),
          occ as (select student_id from cr_assignments where division_code = $2 and position = $3 and active and student_id <> $1),
          ins as (insert into cr_assignments (student_id, division_code, assigned_by, position)
              select sid, $2, $4, $3 from cand
               where ($5::boolean or not exists (select 1 from occ))
                 and (select count(*) from cr_assignments x where x.division_code = $2 and x.active and x.student_id <> $1 and not ($5::boolean and x.position is not distinct from $3)) < $8
              on conflict (student_id, division_code) do update set active = true, position = excluded.position, assigned_by = excluded.assigned_by, assigned_at = now(), removed_by = null, removed_at = null
              returning student_id),
          old as (update cr_assignments c set active = false, removed_by = $4, removed_at = now()
              where c.division_code = $2 and c.position = $3 and c.active and c.student_id <> $1 and exists (select 1 from ins) returning c.student_id),
          req as (update cr_requests q set status = 'approved', decided_by = $4, decided_at = now(), note = $7 where q.id = $6 and q.status = 'pending' and exists (select 1 from ins) returning q.id)
         select (select count(*) from ins)::int as assigned, (select count(*) from occ)::int as occupied, (select count(*) from cand)::int as eligible, (select array_agg(student_id) from old) as replaced`,
        [studentId, div, position, who.account.id, replace === true, requestId || null, note || '', max]);
    } else {
      rows = await db.q(
        `with cand as (select $1::uuid as sid where exists (select 1 from class_enrollments e where e.student_id = $1 and e.division_code = $2 and e.status = 'active')
              and ($6::uuid is null or exists (select 1 from cr_requests q where q.id = $6 and q.status = 'pending' and q.role = $3 and q.student_id = $1 and q.division_code = $2))),
          occ as (select student_id from class_roles where division_code = $2 and role = $3 and active and student_id <> $1),
          ins as (insert into class_roles (student_id, division_code, role, assigned_by) select sid, $2, $3, $4 from cand where ($5::boolean or not exists (select 1 from occ))
              on conflict (student_id, division_code, role) do update set active = true, assigned_by = excluded.assigned_by, assigned_at = now(), removed_by = null, removed_at = null
              returning student_id),
          old as (update class_roles c set active = false, removed_by = $4, removed_at = now() where c.division_code = $2 and c.role = $3 and c.active and c.student_id <> $1 and exists (select 1 from ins) returning c.student_id),
          req as (update cr_requests q set status = 'approved', decided_by = $4, decided_at = now(), note = $7 where q.id = $6 and q.status = 'pending' and exists (select 1 from ins) returning q.id)
         select (select count(*) from ins)::int as assigned, (select count(*) from occ)::int as occupied, (select count(*) from cand)::int as eligible, (select array_agg(student_id) from old) as replaced`,
        [studentId, div, role, who.account.id, replace === true, requestId || null, note || '']);
    }
    const r = rows[0];
    if (!r.assigned) {
      if (!r.eligible) throw conflict('NOT_ELIGIBLE', requestId ? 'Not changed: the request was already decided, or the student is no longer in this class.' : `The student must be an approved member of ${div}.`);
      if (r.occupied) throw conflict('POSITION_TAKEN', role === 'cr' ? `The ${position} CR position of ${div} is taken. Choose “Replace” to hand it over.` : `${div} already has a ${ROLE_NAME[role]}. Choose “Replace” to hand it over.`);
      throw conflict('ROLE_FULL', `${div} already has the maximum number of class representatives.`);
    }
    await db.audit(who.account.id, replace && (r.replaced || []).length ? 'role.replace' : 'role.assign', studentId, { division: div, role, position: role === 'cr' ? position : undefined, replaced: (r.replaced || []).length ? r.replaced : undefined, request: requestId || undefined }, branchOf(who, div));
    return { assigned: true, replaced: r.replaced || [] };
  }
  async function roleDecision(who, req) {
    const b = body(req);
    const decision = b.decision === 'approve' ? 'approve' : b.decision === 'reject' ? 'reject' : null;
    if (!decision || !isUuid(b.id)) throw bad('INVALID', 'Choose a request and approve or reject.');
    const [q] = await db.q('select id, student_id, division_code, role, status from cr_requests where id = $1', [b.id]);
    if (!q) throw notFound('Request not found.');
    need(who, 'role.decide', { division: q.division_code }, `You can’t decide class-role requests for ${q.division_code}.`);
    if (q.student_id === who.account.id) throw forbidden('You cannot decide your own request.');
    const note = txt(b.note, 300);
    if (decision === 'reject') {
      const rows = await db.q(`update cr_requests set status = 'rejected', decided_by = $2, decided_at = now(), note = $3 where id = $1 and status = 'pending' returning id`, [b.id, who.account.id, note]);
      if (!rows.length) throw conflict('ALREADY_DECIDED', 'This request was already decided.');
      await db.audit(who.account.id, 'role.reject', b.id, { division: q.division_code, role: q.role }, branchOf(who, q.division_code));
      return { status: 'rejected' };
    }
    if (q.status !== 'pending') throw conflict('ALREADY_DECIDED', 'This request was already decided.');
    const out = await assignRole(who, { div: q.division_code, studentId: q.student_id, role: q.role, position: txt(b.position, 8), replace: b.replace === true, requestId: q.id, note });
    return { status: 'approved', ...out };
  }
  async function roleAssign(who, req) {
    const b = body(req);
    const div = division(who, b.division), role = txt(b.role, 4);
    if (!ROLE_NAME[role]) throw bad('INVALID_ROLE', 'Choose CR, SI or CI.');
    if (!isUuid(b.studentId)) throw bad('INVALID_ID', 'Choose a student.');
    need(who, 'role.assign', { division: div }, `You can’t appoint class roles in ${div}.`);
    return assignRole(who, { div, studentId: b.studentId, role, position: txt(b.position, 8), replace: b.replace === true, note: txt(b.note, 300) });
  }
  async function roleRemove(who, req) {
    const b = body(req);
    const div = division(who, b.division), role = txt(b.role, 4);
    if (!ROLE_NAME[role] || !isUuid(b.studentId)) throw bad('INVALID', 'Choose a student and a role.');
    need(who, 'role.remove', { division: div }, `You can’t remove class roles in ${div}.`);
    const rows = role === 'cr'
      ? await db.q(`update cr_assignments set active = false, removed_by = $3, removed_at = now() where student_id = $1 and division_code = $2 and active returning student_id`, [b.studentId, div, who.account.id])
      : await db.q(`update class_roles set active = false, removed_by = $3, removed_at = now() where student_id = $1 and division_code = $2 and role = $4 and active returning student_id`, [b.studentId, div, who.account.id, role]);
    if (!rows.length) throw notFound(`That student is not the ${ROLE_NAME[role]} of ${div}.`);
    await db.audit(who.account.id, 'role.remove', b.studentId, { division: div, role, note: txt(b.note, 200) }, branchOf(who, div));
    return { removed: true };
  }

  /* ============================== 7. HOD: branch dashboard, divisions ============================== */
  async function branchOverview(who, req) {
    const br = txt(req.query.branch, 10).toUpperCase() || who.hodBranches[0];
    need(who, 'branch.view', { branch: br }, 'You can view only your own branch.');
    const year = txt(req.query.year, 20), subject = txt(req.query.subject, 80);
    const from = validDay(txt(req.query.from, 10)) ? txt(req.query.from, 10) : null, to = validDay(txt(req.query.to, 10)) ? txt(req.query.to, 10) : null;
    if (from && to && from > to) throw bad('INVALID_RANGE', 'The start date is after the end date.');
    let divs = [...who.divisions.values()].filter((d) => d.branch_code === br && (!year || d.year_id === year)).map((d) => d.code).sort();
    if (req.query.division) { const d = division(who, req.query.division); if (!divs.includes(d)) throw forbidden('That division is not in your branch.'); divs = [d]; }
    const years = await db.q('select id, label, calendar, level from academic_years where active order by level');
    const threshold = await (async () => { const [r] = await db.q('select value from settings where key = $1', [`attendance_threshold:${br}`]); return r ? Number(r.value) : null; })();
    const divisions = await db.q(
      `select d.code, d.name, d.year_id, d.confirmed, d.source,
          (select count(*)::int from class_enrollments e where e.division_code = d.code and e.status = 'active') as students,
          (select count(*)::int from join_requests j where j.division_code = d.code and j.status = 'pending') as pending_joins,
          (select count(distinct t.teacher_phone)::int from teacher_divisions t join teacher_whitelist w on w.phone = t.teacher_phone and w.active where t.division_code = d.code) as teachers,
          exists (select 1 from timetable_versions v where v.status = 'published' and d.code = any(v.divisions)) as has_timetable,
          (select count(*)::int from class_enrollments e left join account_state s on s.account_id = e.student_id where e.division_code = d.code and e.status = 'active' and coalesce(s.profile->>'roll', '') = '') as no_roll,
          (select count(*)::int from class_enrollments e left join account_state s on s.account_id = e.student_id where e.division_code = d.code and e.status = 'active' and s.setup is null) as no_setup
         from divisions d where d.code = any($1) order by d.code`, [divs]);
    const teachers = await db.q(
      `select w.phone as email, w.name, w.active, coalesce(json_agg(json_build_object('division', t.division_code, 'subject', t.subject) order by t.division_code) filter (where t.division_code is not null), '[]') as teaches
         from teacher_whitelist w left join teacher_divisions t on t.teacher_phone = w.phone and t.division_code = any($2)
        where w.branch_code = $1 or exists (select 1 from teacher_divisions x where x.teacher_phone = w.phone and x.division_code = any($2))
        group by w.phone, w.name, w.active order by w.active desc, w.name limit 300`, [br, divs]); // every selected column is grouped, so it doesn't rely on table keys
    const attendance = await db.q(
      `select a.id, a.name, s.profile->>'roll' as roll, e.division_code, t.total, t.present
         from class_enrollments e join accounts a on a.id = e.student_id left join account_state s on s.account_id = a.id
         cross join lateral (select count(*)::int as total, count(*) filter (where m.present)::int as present from attendance_marks m join attendance_sessions x on x.id = m.session_id
             where m.student_id = e.student_id and x.division_code = e.division_code and ($2::text = '' or x.subject = $2) and ($3::date is null or x.on_date >= $3::date) and ($4::date is null or x.on_date <= $4::date)) t
        where e.status = 'active' and e.division_code = any($1) order by e.division_code, nullif(s.profile->>'roll', '') nulls last, a.name limit 3000`, [divs, subject, from, to]);
    const withPct = attendance.map((r) => ({ ...r, percent: r.total ? Math.round((1000 * r.present) / r.total) / 10 : null }));
    const defaulters = threshold === null ? null : withPct.filter((r) => r.percent !== null && r.percent < threshold).sort((x, y) => x.percent - y.percent);
    const marks = await db.q(
      `select a.id, a.division_code, a.subject, a.name, to_char(a.held_on, 'YYYY-MM-DD') as held_on, a.max_marks, a.status,
          count(m.obtained)::int as entered, round(avg(m.obtained)::numeric, 1) as average, count(*) filter (where m.absent)::int as absent
         from assessments a left join assessment_marks m on m.assessment_id = a.id
        where a.division_code = any($1) and ($2::text = '' or a.subject = $2) and ($3::date is null or a.held_on >= $3::date) and ($4::date is null or a.held_on <= $4::date)
        group by a.id, a.division_code, a.subject, a.name, a.held_on, a.max_marks, a.status order by a.held_on desc nulls last limit 200`, [divs, subject, from, to]);
    const items = await db.q(
      `select p.id, p.kind, p.title, p.subject, p.status, p.author_name, p.created_at, p.due_at, to_char(p.event_date, 'YYYY-MM-DD') as event_date,
          (select array_agg(division_code order by division_code) from post_targets x where x.post_id = p.id and x.division_code = any($1)) as divisions
         from posts p where p.deleted_at is null and exists (select 1 from post_targets t where t.post_id = p.id and t.division_code = any($1))
          and ($2::text = '' or p.subject = $2) and ($3::date is null or p.created_at >= $3::date or p.event_date >= $3::date) and ($4::date is null or p.created_at < $4::date + 1)
        order by p.created_at desc limit 200`, [divs, subject, from, to]);
    const roles = await db.q(
      `select c.division_code, 'cr' as role, c.position, a.name from cr_assignments c join accounts a on a.id = c.student_id where c.active and c.division_code = any($1)
       union all select r.division_code, r.role, null, a.name from class_roles r join accounts a on a.id = r.student_id where r.active and r.division_code = any($1)`, [divs]);
    const events = await db.q(`select id, title, venue, starts_at, status from college_events where branch_code = $1 and ($2::date is null or starts_at >= $2::date) and ($3::date is null or starts_at < $3::date + 1) order by starts_at desc limit 50`, [br, from, to]);
    const syllabus = await syllabusFor(br);
    // Data-quality checks: each names the record and where to fix it. Nothing is filled in automatically.
    const issues = [];
    const branchDivs = [...who.divisions.values()].filter((d) => d.branch_code === br);
    for (const y of years) if (!branchDivs.some((d) => d.year_id === y.id)) issues.push({ kind: 'no_divisions', severity: 'warn', text: `No ${y.label} ${y.calendar} divisions are set up for ${br}. Add them under Divisions once the college confirms the list.` });
    for (const d of divisions) {
      if (!d.confirmed) issues.push({ kind: 'unconfirmed', severity: 'warn', division: d.code, text: `${d.code}: the division name was not confirmed from the timetable. Confirm or correct it under Divisions.` });
      if (!d.teachers) issues.push({ kind: 'no_teacher', severity: 'warn', division: d.code, text: `${d.code}: no teacher assigned.` });
      if (!d.has_timetable) issues.push({ kind: 'no_timetable', severity: 'info', division: d.code, text: `${d.code}: no timetable published.` });
      if (d.no_roll) issues.push({ kind: 'no_roll', severity: 'info', division: d.code, text: `${d.code}: ${d.no_roll} student${d.no_roll > 1 ? 's have' : ' has'} no roll number.` });
      if (d.no_setup) issues.push({ kind: 'no_setup', severity: 'info', division: d.code, text: `${d.code}: ${d.no_setup} student${d.no_setup > 1 ? 's have' : ' has'} not completed profile set-up.` });
    }
    for (const t of teachers) if (t.active && !t.teaches.length) issues.push({ kind: 'teacher_unassigned', severity: 'info', text: `${t.name || mask(t.email)} has no divisions in this view.` });
    const legacyCr = roles.filter((r) => r.role === 'cr' && !r.position);
    if (legacyCr.length) issues.push({ kind: 'cr_position', severity: 'info', text: `${legacyCr.length} class representative${legacyCr.length > 1 ? 's have' : ' has'} no position (male/female CR) set yet.` });
    if (threshold === null) issues.push({ kind: 'threshold', severity: 'warn', text: 'No attendance threshold is set, so defaulter lists can’t be produced. Set it under Attendance alerts.' });
    if (!syllabus) issues.push({ kind: 'syllabus', severity: 'info', text: 'No syllabus link is set for the student Overview banner.' });
    return { branch: br, filters: { year, division: req.query.division || '', subject, from, to }, years, threshold, divisions, teachers, attendance: withPct, defaulters, marks, items, roles, events, syllabus, issues, subjects: [...new Set([...marks.map((m) => m.subject), ...items.map((i) => i.subject)].filter(Boolean))].sort() };
  }
  const CODE_RE = /^[A-Z0-9][A-Z0-9-]{0,11}$/;
  async function addDivision(who, req) {
    const b = body(req);
    const br = txt(b.branch, 10).toUpperCase() || who.hodBranches[0];
    need(who, 'division.provision', { branch: br }, 'You can add divisions only to your own branch.');
    const code = txt(b.code, 12).toUpperCase(), name = txt(b.name, 40) || code;
    if (!CODE_RE.test(code)) throw bad('INVALID_CODE', 'Use the division code from the college list (letters, digits and -, up to 12).');
    const [y] = await db.q('select id, level from academic_years where id = $1 and active', [txt(b.yearId, 20)]);
    if (!y) throw bad('INVALID_YEAR', 'Choose the academic year.');
    const rows = await db.q(`insert into divisions (code, branch_code, year, year_id, name, confirmed, created_by, source) values ($1, $2, $3, $4, $5, true, $6, 'hod') on conflict do nothing returning code`, [code, br, y.level, y.id, name, who.account.id]);
    if (!rows.length) throw conflict('DIVISION_EXISTS', `A division with code ${code} (or the name ${name} for this year) already exists.`);
    await db.audit(who.account.id, 'division.add', code, { year: y.id, name }, br);
    return { division: { code, name, branch_code: br, year_id: y.id, confirmed: true } };
  }
  async function confirmDivision(who, req) {
    const b = body(req);
    const code = division(who, b.code);
    need(who, 'division.provision', { division: code }, 'You can change only your own branch’s divisions.');
    const name = txt(b.name, 40);
    const rows = await db.q(`update divisions set confirmed = true, name = coalesce(nullif($2, ''), name) where code = $1 returning code, name`, [code, name]);
    await db.audit(who.account.id, 'division.confirm', code, { name: rows[0].name }, branchOf(who, code));
    return { division: rows[0] };
  }

  /* ============================== 8. clubs, councils, committees ============================== */
  const PERMS = ['draft', 'poster', 'publish', 'registration', 'view_registrations', 'announce', 'manage_team', 'archive'];
  const memberCan = (m, perm) => !!m && m.status === 'active' && m.active && (m.is_head || (m.permissions || []).includes(perm));
  async function membership(who, clubId) {
    if (!isUuid(clubId)) throw bad('INVALID_ID', 'Unknown club.');
    const [m] = await db.q(`select m.*, c.name as club_name, c.active from club_members m join clubs c on c.id = m.club_id where m.club_id = $1 and m.email = $2`, [clubId, who.phone]);
    return m || null;
  }
  async function needClub(who, clubId, perm, message) {
    const m = await membership(who, clubId);
    if (!memberCan(m, perm)) throw forbidden(message || 'Your club role doesn’t include this.');
    return m;
  }
  const permsOf = (v, { head = false } = {}) => {
    const list = Array.isArray(v) ? [...new Set(v.map((x) => txt(x, 24)))] : [];
    const unknown = list.filter((p) => !PERMS.includes(p));
    if (unknown.length) throw bad('INVALID_PERMISSION', `Unknown permission: ${unknown.join(', ')}.`);
    if (!head && list.includes('manage_team')) return { list, needsHead: true };
    return { list, needsHead: false };
  };
  const institutional = (v) => { const e = normalizeEmail(txt(v, 254)); if (!e || !isInstitutional(e)) throw bad('INVALID_EMAIL', `Use a college Google account (…@${INSTITUTION_DOMAIN}).`); return e; };

  async function listClubs(who) {
    if (who.base === 'hod') {
      const rows = await db.q(`select c.id, c.name, c.kind, c.description, c.active, c.created_at, (select json_agg(json_build_object('email', m.email, 'status', m.status)) from club_members m where m.club_id = c.id and m.is_head) as heads,
        (select count(*)::int from club_members m where m.club_id = c.id and m.status = 'active') as members from clubs c order by c.active desc, c.name limit 300`);
      return { clubs: rows, provision: true, permissions: PERMS };
    }
    if (who.base === 'parent') return { clubs: [], provision: false, permissions: PERMS };
    const rows = await db.q(`select c.id, c.name, c.kind, c.description, m.is_head, m.permissions, m.status, m.invited_at from club_members m join clubs c on c.id = m.club_id where m.email = $1 and c.active and m.status in ('active', 'invited') order by c.name`, [who.phone]);
    return { clubs: rows, provision: false, permissions: PERMS };
  }
  async function createClub(who, req) {
    need(who, 'club.provision', {}, 'Only an HOD can set up a club, council or committee and appoint its head.');
    const b = body(req);
    const name = txt(b.name, 80), kind = ['club', 'council', 'committee'].includes(b.kind) ? b.kind : 'club';
    if (name.length < 2) throw bad('INVALID_NAME', 'Enter the club’s name.');
    const head = institutional(b.headEmail);
    const rows = await db.q(
      `with c as (insert into clubs (name, kind, description, created_by) values ($1, $2, $3, $4) on conflict do nothing returning id),
          h as (insert into club_members (club_id, email, is_head, status, invited_by, accepted_at) select c.id, $5, true, 'active', $4, now() from c returning 1)
       select (select id from c) as id`, [name, kind, txt(b.description, 600), who.account.id, head]);
    if (!rows[0].id) throw conflict('CLUB_EXISTS', `A club named ${name} already exists.`);
    await db.audit(who.account.id, 'club.create', rows[0].id, { name, head: mask(head) }, who.hodBranches[0]);
    return { club: { id: rows[0].id, name } };
  }
  async function clubAdmin(who, req) {
    need(who, 'club.provision', {}, 'Only an HOD can change a club’s head or status.');
    const b = body(req);
    if (!isUuid(b.clubId)) throw bad('INVALID_ID', 'Unknown club.');
    const [c] = await db.q('select id, name from clubs where id = $1', [b.clubId]);
    if (!c) throw notFound('Club not found.');
    if (typeof b.active === 'boolean') {
      await db.q('update clubs set active = $2 where id = $1', [c.id, b.active]);
      await db.audit(who.account.id, b.active ? 'club.reactivate' : 'club.deactivate', c.id, { name: c.name }, who.hodBranches[0]);
      return { active: b.active };
    }
    const head = institutional(b.headEmail);
    // One statement: the old head steps down (stays a member without head rights), the new head is active.
    await db.q(
      `with old as (update club_members set is_head = false where club_id = $1 and is_head and email <> $2 returning 1)
       insert into club_members (club_id, email, is_head, status, invited_by, accepted_at) values ($1, $2, true, 'active', $3, now())
       on conflict (club_id, email) do update set is_head = true, status = 'active', accepted_at = coalesce(club_members.accepted_at, now()), revoked_at = null, revoked_by = null`, [c.id, head, who.account.id]);
    await db.audit(who.account.id, 'club.head', c.id, { name: c.name, head: mask(head) }, who.hodBranches[0]);
    return { head: mask(head) };
  }
  async function clubDetail(who, req) {
    const m = await membership(who, req.query.id);
    if (!m || m.status !== 'active' || !m.active) throw notFound('Club not found, or you are not an active member.');
    const members = memberCan(m, 'manage_team') ? await db.q(`select m.email, m.is_head, m.permissions, m.status, m.invited_at, m.accepted_at, a.name from club_members m left join accounts a on a.phone = m.email where m.club_id = $1 order by m.is_head desc, m.status, m.email`, [m.club_id]) : [];
    const events = await db.q(`select id, title, description, venue, starts_at, ends_at, status, layout, reg_mode, reg_link, capacity, reg_count, reg_deadline, organizer, contact, audience, instructions, terms, poster_file_id, updated_at from college_events where club_id = $1 order by starts_at desc limit 100`, [m.club_id]);
    const announcements = await db.q(`select id, event_id, title, body, created_at, created_by_name from club_announcements where club_id = $1 and deleted_at is null order by created_at desc limit 50`, [m.club_id]);
    return {
      club: { id: m.club_id, name: m.club_name }, me: { isHead: m.is_head, permissions: m.is_head ? PERMS : m.permissions },
      members: members.map((x) => ({ ...x, email: x.email, contact: mask(x.email) })), events, announcements, permissions: PERMS,
    };
  }
  async function clubInvite(who, req) {
    const b = body(req);
    const m = await needClub(who, b.clubId, 'manage_team', 'You need the “manage team” permission to invite people.');
    const email = institutional(b.email);
    if (email === who.phone) throw bad('SELF', 'You are already in this club.');
    const { list, needsHead } = permsOf(b.permissions, { head: m.is_head });
    if (needsHead) throw forbidden('Only the club head can give the “manage team” permission.');
    const rows = await db.q(
      `insert into club_members (club_id, email, permissions, status, invited_by) values ($1, $2, $3, 'invited', $4)
       on conflict (club_id, email) do update set permissions = excluded.permissions, status = 'invited', invited_by = excluded.invited_by, invited_at = now(), revoked_at = null, revoked_by = null
         where club_members.status in ('declined', 'revoked') returning email`, [m.club_id, email, list, who.account.id]);
    if (!rows.length) throw conflict('ALREADY_MEMBER', 'This person is already invited or a member.');
    await db.audit(who.account.id, 'club.invite', m.club_id, { invitee: mask(email), permissions: list });
    return { invited: mask(email) };
  }
  async function clubInviteResponse(who, req) {
    const b = body(req);
    if (!isUuid(b.clubId)) throw bad('INVALID_ID', 'Unknown club.');
    if (!isInstitutional(who.phone)) throw forbidden('Club membership needs a college account.');
    const rows = await db.q(`update club_members set status = $3, accepted_at = case when $3 = 'active' then now() else null end where club_id = $1 and email = $2 and status = 'invited' returning status`, [b.clubId, who.phone, b.accept === true ? 'active' : 'declined']);
    if (!rows.length) throw notFound('No open invitation for your account.');
    await db.audit(who.account.id, b.accept === true ? 'club.accept' : 'club.decline', b.clubId, null);
    return { status: rows[0].status };
  }
  async function clubMember(who, req) {
    const b = body(req);
    const m = await needClub(who, b.clubId, 'manage_team', 'You need the “manage team” permission.');
    const email = normalizeEmail(txt(b.email, 254));
    const [t] = email ? await db.q('select email, is_head, permissions, status from club_members where club_id = $1 and email = $2', [m.club_id, email]) : [];
    if (!t) throw notFound('Not a member of this club.');
    if (t.is_head) throw forbidden('The club head is changed by an HOD.');
    if (!m.is_head && (t.permissions || []).includes('manage_team')) throw forbidden('Only the club head can change another team manager.');
    if (b.revoke === true) {
      await db.q(`update club_members set status = 'revoked', revoked_at = now(), revoked_by = $3 where club_id = $1 and email = $2`, [m.club_id, email, who.account.id]);
      await db.audit(who.account.id, 'club.revoke', m.club_id, { member: mask(email) });
      return { revoked: true };
    }
    const { list, needsHead } = permsOf(b.permissions, { head: m.is_head });
    if (needsHead) throw forbidden('Only the club head can give the “manage team” permission.');
    await db.q('update club_members set permissions = $3 where club_id = $1 and email = $2', [m.club_id, email, list]);
    await db.audit(who.account.id, 'club.permissions', m.club_id, { member: mask(email), permissions: list });
    return { permissions: list };
  }
  const LAYOUTS = ['card', 'banner', 'announcement'];
  async function saveClubEvent(who, req) {
    await limit(`cev:${who.account.id}`, 40, 600);
    const b = body(req);
    const m = await needClub(who, b.clubId, 'draft', 'You need the “drafts” permission to create or edit events.');
    const title = txt(b.title, 120);
    if (title.length < 3) throw bad('INVALID_TITLE', 'Give the event a name.');
    const starts = Date.parse(b.startsAt), ends = b.endsAt ? Date.parse(b.endsAt) : null;
    if (Number.isNaN(starts) || (ends !== null && (Number.isNaN(ends) || ends < starts))) throw bad('INVALID_TIME', 'Check the date, start and end time.');
    if (starts > Date.now() + 400 * DAY) throw bad('INVALID_TIME', 'Choose a date within the next year.');
    const venue = txt(b.venue, 120);
    if (!venue) throw bad('VENUE_REQUIRED', 'Enter the venue.');
    const branches = new Set((await db.q('select code from branches')).map((r) => r.code));
    const aud = b.audience && typeof b.audience === 'object' ? b.audience : {};
    const audience = { branches: [...new Set((Array.isArray(aud.branches) ? aud.branches : []).map((x) => txt(x, 10).toUpperCase()))].filter((x) => branches.has(x)), years: [...new Set((Array.isArray(aud.years) ? aud.years : []).map(Number))].filter((x) => [1, 2, 3, 4].includes(x)).sort() };
    const regMode = ['none', 'link', 'builtin'].includes(b.regMode) ? b.regMode : 'none';
    const regLink = httpsUrl(b.regLink);
    if (regMode === 'link' && !regLink) throw bad('INVALID_LINK', 'Give the registration link (https://…).');
    const capacity = b.capacity === undefined || b.capacity === null || b.capacity === '' ? null : Number(b.capacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) throw bad('INVALID_CAPACITY', 'Capacity must be a whole number, or empty for no limit.');
    const regDeadline = b.regDeadline ? Date.parse(b.regDeadline) : null;
    if (regDeadline !== null && (Number.isNaN(regDeadline) || regDeadline > starts)) throw bad('INVALID_DEADLINE', 'The registration deadline must be before the event starts.');
    const layout = LAYOUTS.includes(b.layout) ? b.layout : 'card';
    const poster = readFile(b.poster, { images: true });
    if (poster && !memberCan(m, 'poster')) throw forbidden('You need the “posters” permission to upload a poster.');
    const reg = { mode: regMode, link: regMode === 'link' ? regLink : '', capacity: regMode === 'builtin' ? capacity : null, deadline: regMode === 'none' ? null : regDeadline === null ? null : new Date(regDeadline).toISOString() };
    const vals = [title, txt(b.description, 3000), venue, new Date(starts).toISOString(), ends === null ? null : new Date(ends).toISOString(), txt(b.organizer, 120) || m.club_name, txt(b.contact, 160), JSON.stringify(audience), txt(b.instructions, 2000), txt(b.terms, 2000), layout];
    if (b.id) {
      if (!isUuid(b.id)) throw bad('INVALID_ID', 'Unknown event.');
      const [e] = await db.q('select id, status, reg_mode, reg_link, capacity, reg_deadline, reg_count from college_events where id = $1 and club_id = $2', [b.id, m.club_id]);
      if (!e) throw notFound('Event not found in this club.');
      if (e.status === 'published' && !memberCan(m, 'publish')) throw forbidden('This event is published; editing it needs the “publish” permission.');
      if (e.status === 'archived') throw conflict('ARCHIVED', 'Archived events can’t be edited.');
      const regChanged = e.reg_mode !== reg.mode || (e.reg_link || '') !== reg.link || (e.capacity === null ? null : Number(e.capacity)) !== reg.capacity || (e.reg_deadline ? new Date(e.reg_deadline).toISOString() : null) !== reg.deadline;
      if (regChanged && !memberCan(m, 'registration')) throw forbidden('Changing registration details needs the “registration” permission.');
      if (reg.capacity !== null && reg.capacity < e.reg_count) throw bad('INVALID_CAPACITY', `${e.reg_count} people have already registered; capacity can’t be lower.`);
      const posterId = await storeFile(who, poster);
      await db.q(`update college_events set title = $2, description = $3, venue = $4, starts_at = $5, ends_at = $6, organizer = $7, contact = $8, audience = $9::jsonb, instructions = $10, terms = $11, layout = $12,
          reg_mode = $13, reg_link = $14, capacity = $15, reg_deadline = $16, poster_file_id = coalesce($17::uuid, case when $18::boolean then null else poster_file_id end), updated_at = now() where id = $1`,
        [b.id, ...vals, reg.mode, reg.link, reg.capacity, reg.deadline, posterId, b.removePoster === true && memberCan(m, 'poster')]);
      await db.audit(who.account.id, 'club.event.update', b.id, { club: m.club_id, title });
      return { event: { id: b.id, status: e.status } };
    }
    if (reg.mode !== 'none' && !memberCan(m, 'registration')) throw forbidden('Setting up registration needs the “registration” permission.');
    const posterId = await storeFile(who, poster);
    const [r] = await db.q(`insert into college_events (club_id, branch_code, title, description, venue, starts_at, ends_at, organizer, contact, audience, instructions, terms, layout, reg_mode, reg_link, capacity, reg_deadline, poster_file_id, created_by, registration)
        values ($1, null, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18, '') returning id, status`,
      [m.club_id, ...vals, reg.mode, reg.link, reg.capacity, reg.deadline, posterId, who.account.id]);
    await db.audit(who.account.id, 'club.event.create', r.id, { club: m.club_id, title });
    return { event: r };
  }
  async function clubEventStatus(who, req) {
    const b = body(req);
    const to = txt(b.status, 12);
    if (!isUuid(b.id) || !['draft', 'published', 'cancelled', 'archived'].includes(to)) throw bad('INVALID', 'Unknown event or status.');
    const [e] = await db.q('select id, club_id, status, title, starts_at from college_events where id = $1 and club_id is not null', [b.id]);
    if (!e) throw notFound('Event not found.');
    await needClub(who, e.club_id, to === 'published' || to === 'draft' ? 'publish' : 'archive', to === 'published' || to === 'draft' ? 'Publishing needs the “publish” permission.' : 'Cancelling or archiving needs the “archive/cancel” permission.');
    const from = { published: ['draft', 'cancelled'], draft: ['published'], cancelled: ['published', 'draft'], archived: ['draft', 'published', 'cancelled'] }[to];
    const rows = await db.q(`update college_events set status = $2, published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end, updated_at = now() where id = $1 and status = any($3::text[]) returning status`, [e.id, to, from]);
    if (!rows.length) throw conflict('INVALID_TRANSITION', `This event is ${e.status}.`);
    await db.audit(who.account.id, `club.event.${to}`, e.id, { club: e.club_id, title: e.title });
    return { status: to };
  }
  async function clubRegistrations(who, req) {
    if (!isUuid(req.query.eventId)) throw bad('INVALID_ID', 'Unknown event.');
    const [e] = await db.q('select id, club_id, title, capacity, reg_count from college_events where id = $1 and club_id is not null', [req.query.eventId]);
    if (!e) throw notFound('Event not found.');
    await needClub(who, e.club_id, 'view_registrations', 'Viewing registrations needs the “view registrations” permission.');
    // Organisers see who registered, never academic records (no class, roll, attendance or marks).
    const rows = await db.q(`select a.name, a.phone, r.status, r.registered_at from event_registrations r join accounts a on a.id = r.account_id where r.event_id = $1 order by r.registered_at limit 5000`, [e.id]);
    return { event: { id: e.id, title: e.title, capacity: e.capacity, registered: e.reg_count }, registrations: rows.map(({ phone, ...r }) => ({ ...r, contact: mask(phone) })) };
  }
  async function clubAnnounce(who, req) {
    const b = body(req);
    const m = await needClub(who, b.clubId, 'announce', 'Announcements need the “announcements” permission.');
    const title = txt(b.title, 140), text = txt(b.body, 2000);
    if (title.length < 3) throw bad('INVALID_TITLE', 'Give the announcement a title.');
    if (!isUuid(b.eventId)) throw bad('EVENT_REQUIRED', 'Choose the event this announcement is about.');
    const [e] = await db.q(`select id from college_events where id = $1 and club_id = $2 and status in ('published', 'cancelled')`, [b.eventId, m.club_id]);
    if (!e) throw bad('EVENT_NOT_PUBLISHED', 'Announcements go to the audience of a published event.');
    const [r] = await db.q(`insert into club_announcements (club_id, event_id, title, body, created_by, created_by_name) values ($1, $2, $3, $4, $5, $6) returning id, created_at`, [m.club_id, e.id, title, text, who.account.id, displayName(who)]);
    await db.audit(who.account.id, 'club.announce', r.id, { club: m.club_id, event: e.id, title });
    return { announcement: r };
  }
  const eventOut = (e) => ({ ...e, audience: e.audience || {}, poster: e.poster_file_id ? `/api/app/file?id=${e.poster_file_id}&inline=1` : null });
  /** One event for a student/staff viewer, with registration state and announcements. */
  async function eventDetail(who, req) {
    if (!isUuid(req.query.id)) throw bad('INVALID_ID', 'Unknown event.');
    const v = viewer(who);
    const [e] = (await eventsFor(who, v)).filter((x) => x.id === req.query.id);
    if (!e) throw notFound('Event not found, or it isn’t for your class.');
    const [mine] = await db.q('select status, registered_at from event_registrations where event_id = $1 and account_id = $2', [e.id, who.account.id]);
    const announcements = e.club_id ? await db.q(`select id, title, body, created_at, created_by_name from club_announcements where event_id = $1 and deleted_at is null order by created_at desc limit 20`, [e.id]) : [];
    const open = e.status === 'published' && e.reg_mode === 'builtin' && (!e.reg_deadline || new Date(e.reg_deadline) > new Date()) && new Date(e.starts_at) > new Date();
    return { event: eventOut(e), registration: { mine: mine && mine.status === 'registered' ? mine : null, open, full: e.capacity !== null && e.reg_count >= e.capacity, count: e.reg_count }, announcements };
  }
  async function register(who, req) {
    if (!isInstitutional(who.phone)) throw forbidden('Registration needs a college account.');
    await limit(`reg:${who.account.id}`, 30, 600);
    const b = body(req);
    const d = await eventDetail(who, { query: { id: b.eventId } });
    if (d.registration.mine) return { registered: true, already: true };
    if (!d.registration.open) throw conflict('REGISTRATION_CLOSED', 'Registration for this event is closed.');
    const rows = await db.q(
      `with u as (update college_events set reg_count = reg_count + 1 where id = $1 and status = 'published' and reg_mode = 'builtin'
            and (reg_deadline is null or reg_deadline > now()) and starts_at > now() and (capacity is null or reg_count < capacity)
            and not exists (select 1 from event_registrations r where r.event_id = $1 and r.account_id = $2 and r.status = 'registered') returning id)
       insert into event_registrations (event_id, account_id) select id, $2 from u
       on conflict (event_id, account_id) do update set status = 'registered', updated_at = now(), registered_at = now() returning 1`, [b.eventId, who.account.id]);
    await recount(b.eventId);
    if (!rows.length) throw conflict('EVENT_FULL', 'This event is full.');
    await db.audit(who.account.id, 'event.register', b.eventId, null);
    return { registered: true };
  }
  async function unregister(who, req) {
    if (!isUuid(req.query.eventId)) throw bad('INVALID_ID', 'Unknown event.');
    const rows = await db.q(`update event_registrations set status = 'cancelled', updated_at = now() where event_id = $1 and account_id = $2 and status = 'registered' returning 1`, [req.query.eventId, who.account.id]);
    if (!rows.length) throw notFound('You are not registered for this event.');
    await recount(req.query.eventId);
    await db.audit(who.account.id, 'event.unregister', req.query.eventId, null);
    return { registered: false };
  }
  /** The counter is a cache of the registrations table; it is re-derived after every change so it can't drift. */
  const recount = (id) => db.q(`update college_events set reg_count = (select count(*) from event_registrations r where r.event_id = $1 and r.status = 'registered') where id = $1`, [id]);

  /* ============================== for api/app.js ============================== */
  /** Extra state for GET me (roles held, set-up, invitations). */
  async function meExtras(who) {
    const { setup } = await setupState(who);
    const div = who.enrollment && who.enrollment.division_code;
    const [cr] = div && who.crDivisions.includes(div) ? await db.q('select position from cr_assignments where student_id = $1 and division_code = $2 and active', [who.account.id, div]) : [];
    const invites = isInstitutional(who.phone) ? (await db.q(`select count(*)::int as n from club_members m join clubs c on c.id = m.club_id where m.email = $1 and m.status = 'invited' and c.active`, [who.phone]))[0].n : 0;
    const clubs = isInstitutional(who.phone) ? (await db.q(`select count(*)::int as n from club_members m join clubs c on c.id = m.club_id where m.email = $1 and m.status = 'active' and c.active`, [who.phone]))[0].n : 0;
    const roleScope = allowedDivisions(who, 'role.decide');
    const [{ n: pendingRoles }] = roleScope.length ? await db.q(`select count(*)::int as n from cr_requests where status = 'pending' and division_code = any($1)`, [roleScope]) : [{ n: 0 }];
    return {
      setup, setupDone: who.base === 'parent' || !!setup,
      classRoles: { cr: div && who.crDivisions.includes(div) ? [div] : [], crPosition: cr ? cr.position : null, si: who.siDivisions.filter((d) => d === div), ci: who.ciDivisions.filter((d) => d === div) },
      clubs: { member: clubs, invites }, pendingRoles,
    };
  }

  return {
    routes: {
      'GET setup': getSetup, 'PUT setup': putSetup,
      'POST publish': publish, 'POST publish-status': publishStatus, 'GET published': listPublished, 'GET class-items': classItems,
      'POST submissions': submit, 'DELETE submissions': withdraw, 'GET submissions': listSubmissions,
      'GET calendar': calendar, 'GET overview': overview, 'POST syllabus': setSyllabus,
      'POST role-requests': roleRequest, 'GET class-roles': classRoles, 'POST role-decision': roleDecision, 'POST role-assign': roleAssign, 'POST role-remove': roleRemove,
      'GET branch-overview': branchOverview, 'POST divisions': addDivision, 'POST division-confirm': confirmDivision,
      'GET clubs': listClubs, 'POST clubs': createClub, 'POST club-admin': clubAdmin, 'GET club': clubDetail, 'POST club-invite': clubInvite, 'POST club-invite-response': clubInviteResponse,
      'POST club-member': clubMember, 'POST club-events': saveClubEvent, 'POST club-event-status': clubEventStatus, 'GET club-registrations': clubRegistrations, 'POST club-announcements': clubAnnounce,
      'GET event': eventDetail, 'POST event-register': register, 'DELETE event-register': unregister,
    },
    meExtras, VISIBLE, audienceSql, KINDS,
  };
};
