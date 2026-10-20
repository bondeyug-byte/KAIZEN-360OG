// api/_records.js — parent links, attendance, assessments/marks, attendance alerts, college events, and the
// read-only record a parent (or the student themself) sees. Routes are registered in api/app.js.
//
// Data flow (single source of truth): teachers record attendance and marks for divisions they teach; teachers or the
// HOD draft attendance alerts and the branch HOD publishes them; the HOD publishes branch events. Parents only READ,
// and only for students the college confirmed them for (parent_links.status = 'approved', checked on every request).
module.exports = (H) => {
  const { db, can, need, bad, forbidden, notFound, conflict, body, txt, isUuid, division, limit, branchOf, displayName, allowedDivisions, normalizePhone, mask } = H;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const RELATIONS = ['Mother', 'Father', 'Guardian', 'Parent'];
  const ymd = (d) => new Date(d).toISOString().slice(0, 10);
  const isoDay = (v, { past = 400, future = 0 } = {}) => {
    const s = txt(v, 10);
    if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z')) || ymd(s + 'T00:00:00Z') !== s) throw bad('INVALID_DATE', 'Pick a valid date.');
    const t = Date.parse(s + 'T00:00:00Z'), now = Date.now();
    if (t > now + (future + 1) * 86400000 || t < now - past * 86400000) throw bad('INVALID_DATE', future ? 'That date is outside the allowed range.' : 'Attendance can be recorded for today or earlier dates only.');
    return s;
  };
  const subjectOf = (v) => { const s = txt(v, 40); if (s.length < 1) throw bad('INVALID_SUBJECT', 'Choose a subject.'); return s; };
  /** All students must be active in the division; returns the de-duplicated id list. */
  async function enrolled(div, ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 300 || !ids.every(isUuid)) throw bad('INVALID_STUDENTS', 'Send between 1 and 300 students.');
    const uniq = [...new Set(ids)];
    const [{ n }] = await db.q(`select count(*)::int as n from class_enrollments where division_code = $1 and status = 'active' and student_id = any($2::uuid[])`, [div, uniq]);
    if (n !== uniq.length) throw bad('NOT_IN_CLASS', 'Some students are not in this class.');
    return uniq;
  }
  async function activeDivisionOf(studentId) {
    const [r] = await db.q(`select e.division_code from class_enrollments e where e.student_id = $1 and e.status = 'active' order by e.approved_at desc limit 1`, [studentId]);
    return r ? r.division_code : null;
  }

  /* ---------------- parent ↔ student links ---------------- */
  async function requestLink(who, req) {
    if (who.base !== 'student' || !who.enrollment) throw forbidden('Join your class first, then add a parent or guardian.');
    need(who, 'parent.link.request', { division: who.enrollment.division_code });
    await limit(`plink:${who.account.id}`, 10, 3600);
    const b = body(req);
    const phone = normalizePhone(b.phone);
    if (!phone) throw bad('INVALID_PHONE', 'Enter a 10-digit Indian mobile number.');
    if (phone === who.phone) throw bad('OWN_NUMBER', 'Enter your parent\'s number, not yours.');
    const staff = await db.q(`select 1 from hod_assignments where phone = $1 and active union all select 1 from teacher_whitelist where phone = $1 and active`, [phone]);
    if (staff.length) throw bad('STAFF_NUMBER', 'That number belongs to college staff. Use a parent\'s personal number.');
    const relation = RELATIONS.includes(b.relation) ? b.relation : 'Parent';
    const open = await db.q(`select parent_phone from parent_links where student_id = $1 and status in ('pending', 'approved')`, [who.account.id]);
    if (open.some((r) => r.parent_phone === phone)) throw conflict('ALREADY_LINKED', 'This number is already added.');
    if (open.length >= 4) throw conflict('TOO_MANY', 'You can add up to 4 parents or guardians.');
    const [r] = await db.q(`insert into parent_links (parent_phone, student_id, relation) values ($1, $2, $3) returning id, status, requested_at`, [phone, who.account.id, relation]);
    await db.audit(who.account.id, 'parent.link.request', r.id, { relation }, branchOf(who, who.enrollment.division_code));
    return { link: { ...r, phone: mask(phone), relation } };
  }
  async function listLinks(who, req) {
    if (who.base === 'student') {
      const rows = await db.q(`select id, parent_phone, relation, status, requested_at, decided_at, note from parent_links where student_id = $1 and status <> 'revoked' order by requested_at desc limit 20`, [who.account.id]);
      return { links: rows.map(({ parent_phone, ...r }) => ({ ...r, phone: mask(parent_phone) })) };
    }
    const divs = req.query.division ? [division(who, req.query.division)] : allowedDivisions(who, 'parent.link.decide');
    divs.forEach((d) => need(who, 'parent.link.decide', { division: d }));
    if (!divs.length) return { links: [] };
    const rows = await db.q(
      `select l.id, l.parent_phone, l.relation, l.status, l.requested_at, l.decided_at, a.id as student_id, a.name as student_name, s.profile->>'roll' as roll, e.division_code
         from parent_links l join accounts a on a.id = l.student_id
         join class_enrollments e on e.student_id = l.student_id and e.status = 'active' left join account_state s on s.account_id = a.id
        where e.division_code = any($1) and (l.status = 'pending' or l.decided_at > now() - interval '30 days')
        order by (l.status = 'pending') desc, l.requested_at desc limit 300`, [divs]);
    return { links: rows.map(({ parent_phone, ...r }) => ({ ...r, phone: mask(parent_phone) })) };
  }
  async function decideLinks(who, req) {
    const b = body(req);
    const decision = b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : null;
    if (!decision) throw bad('INVALID_DECISION', 'Decision must be approve or reject.');
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids)] : [];
    if (!ids.length || ids.length > 50 || !ids.every(isUuid)) throw bad('INVALID_IDS', 'Choose between 1 and 50 requests.');
    const results = [];
    for (const id of ids) {
      const [l] = await db.q('select id, student_id, status from parent_links where id = $1', [id]);
      const div = l && (await activeDivisionOf(l.student_id));
      if (!l || !div) { results.push({ id, ok: false, error: 'Request not found.' }); continue; }
      if (!can(who, 'parent.link.decide', { division: div })) { results.push({ id, ok: false, error: `You can't confirm parents for ${div}.` }); continue; }
      const done = await db.q(`update parent_links set status = $2, decided_by = $3, decided_at = now(), note = $4 where id = $1 and status = 'pending' returning id`, [id, decision, who.account.id, txt(b.note, 200)]);
      if (!done.length) { results.push({ id, ok: false, error: `Already ${l.status}.` }); continue; }
      await db.audit(who.account.id, `parent.link.${decision === 'approved' ? 'approve' : 'reject'}`, id, { division: div }, branchOf(who, div));
      results.push({ id, ok: true, status: decision });
    }
    return { results };
  }
  async function revokeLink(who, req) {
    if (!isUuid(req.query.id)) throw bad('INVALID_ID', 'Unknown link.');
    const [l] = await db.q(`select id, student_id from parent_links where id = $1 and status in ('pending', 'approved')`, [req.query.id]);
    if (!l) throw notFound('Link not found.');
    const div = await activeDivisionOf(l.student_id);
    const own = who.base === 'student' && l.student_id === who.account.id;
    if (!own && !(div && can(who, 'enrollment.revoke', { division: div }))) throw notFound('Link not found.');
    await db.q(`update parent_links set status = 'revoked', decided_by = $2, decided_at = now() where id = $1`, [l.id, who.account.id]);
    await db.audit(who.account.id, 'parent.link.revoke', l.id, { by: own ? 'student' : 'hod' }, div ? branchOf(who, div) : null);
    return { revoked: true };
  }

  /* ---------------- attendance ---------------- */
  async function saveAttendance(who, req) {
    await limit(`att:${who.account.id}`, 120, 600);
    const b = body(req);
    const div = division(who, b.division);
    need(who, 'attendance.record', { division: div }, `You don't teach ${div}.`);
    const subject = subjectOf(b.subject), on = isoDay(b.date, { past: 180 }), start = txt(b.start, 5);
    if (start && !TIME_RE.test(start)) throw bad('INVALID_TIME', 'Use HH:MM for the lecture time.');
    if (!Array.isArray(b.marks)) throw bad('INVALID_MARKS', 'Mark each student present or absent.');
    const ids = await enrolled(div, b.marks.map((m) => m && m.studentId));
    const present = new Map(b.marks.map((m) => [m.studentId, m.present === true]));
    const [r] = await db.q(
      `with s as (insert into attendance_sessions (division_code, subject, on_date, start_time, taken_by, taken_by_name) values ($1, $2, $3, $4, $5, $6)
          on conflict (division_code, subject, on_date, start_time) do update set updated_at = now(), taken_by = excluded.taken_by, taken_by_name = excluded.taken_by_name
          returning id, (xmax = 0) as created),
        d as (delete from attendance_marks m using s where m.session_id = s.id and not (m.student_id = any($7::uuid[]))),
        i as (insert into attendance_marks (session_id, student_id, present) select s.id, x.sid, x.p from s, unnest($7::uuid[], $8::boolean[]) as x(sid, p)
          on conflict (session_id, student_id) do update set present = excluded.present returning present)
       select (select id from s) as id, (select created from s) as created, (select count(*) from i where present)::int as present, (select count(*) from i)::int as total`,
      [div, subject, on, start, who.account.id, displayName(who), ids, ids.map((id) => present.get(id))]);
    await db.audit(who.account.id, r.created ? 'attendance.record' : 'attendance.update', r.id, { division: div, subject, date: on, present: r.present, total: r.total }, branchOf(who, div));
    return { session: { id: r.id, created: r.created, present: r.present, total: r.total } };
  }
  async function getAttendance(who, req) {
    const div = division(who, req.query.division);
    need(who, 'attendance.record', { division: div });
    const roster = await db.q(`select a.id, a.name, s.profile->>'roll' as roll from class_enrollments e join accounts a on a.id = e.student_id left join account_state s on s.account_id = a.id
      where e.division_code = $1 and e.status = 'active' order by nullif(s.profile->>'roll', '') nulls last, a.name limit 300`, [div]);
    let session = null, marks = {};
    if (req.query.subject && req.query.date) {
      const [s] = await db.q(`select id, subject, on_date, start_time, taken_by_name, updated_at from attendance_sessions where division_code = $1 and subject = $2 and on_date = $3 and start_time = $4`, [div, txt(req.query.subject, 40), isoDay(req.query.date, { past: 400 }), txt(req.query.start, 5)]);
      if (s) { session = s; for (const m of await db.q('select student_id, present from attendance_marks where session_id = $1', [s.id])) marks[m.student_id] = m.present; }
    }
    const recent = await db.q(`select s.id, s.subject, s.on_date, s.start_time, s.taken_by_name, count(m.*)::int as total, count(m.*) filter (where m.present)::int as present
      from attendance_sessions s left join attendance_marks m on m.session_id = s.id where s.division_code = $1 group by s.id order by s.on_date desc, s.start_time desc limit 40`, [div]);
    return { division: div, roster, session, marks, recent };
  }

  /* ---------------- assessments and marks ---------------- */
  async function saveAssessment(who, req) {
    const b = body(req);
    const name = txt(b.name, 80), term = txt(b.term, 40), max = Number(b.maxMarks);
    if (name.length < 2) throw bad('INVALID_NAME', 'Name the assessment (e.g. "Unit test 1").');
    if (!Number.isFinite(max) || max <= 0 || max > 1000) throw bad('INVALID_MAX', 'Maximum marks must be between 1 and 1000.');
    const held = b.date ? isoDay(b.date, { past: 400, future: 60 }) : null;
    if (b.id) {
      if (!isUuid(b.id)) throw bad('INVALID_ID', 'Unknown assessment.');
      const [a] = await db.q('select division_code from assessments where id = $1', [b.id]);
      if (!a) throw notFound('Assessment not found.');
      need(who, 'marks.manage', { division: a.division_code });
      const [{ over }] = await db.q('select count(*)::int as over from assessment_marks where assessment_id = $1 and obtained > $2', [b.id, max]);
      if (over) throw bad('MARKS_ABOVE_MAX', 'Some entered marks are above the new maximum. Fix them first.');
      await db.q(`update assessments set name = $2, term = $3, held_on = $4, max_marks = $5, subject = $6, updated_at = now() where id = $1`, [b.id, name, term, held, max, subjectOf(b.subject)]);
      await db.audit(who.account.id, 'assessment.update', b.id, { name }, branchOf(who, a.division_code));
      return { assessment: { id: b.id } };
    }
    const div = division(who, b.division);
    need(who, 'marks.manage', { division: div }, `You don't teach ${div}.`);
    const [r] = await db.q(`insert into assessments (division_code, subject, name, term, held_on, max_marks, created_by, created_by_name) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, status`,
      [div, subjectOf(b.subject), name, term, held, max, who.account.id, displayName(who)]);
    await db.audit(who.account.id, 'assessment.create', r.id, { division: div, name }, branchOf(who, div));
    return { assessment: r };
  }
  async function listAssessments(who, req) {
    const div = division(who, req.query.division);
    need(who, 'marks.manage', { division: div });
    const rows = await db.q(`select a.id, a.subject, a.name, a.term, a.held_on, a.max_marks, a.status, a.published_at, a.updated_at, a.created_by_name, count(m.*)::int as entered
      from assessments a left join assessment_marks m on m.assessment_id = a.id where a.division_code = $1 group by a.id order by coalesce(a.held_on, a.created_at::date) desc limit 100`, [div]);
    return { division: div, assessments: rows };
  }
  async function getAssessment(who, req) {
    if (!isUuid(req.query.id)) throw bad('INVALID_ID', 'Unknown assessment.');
    const [a] = await db.q('select id, division_code, subject, name, term, held_on, max_marks, status, published_at from assessments where id = $1', [req.query.id]);
    if (!a) throw notFound('Assessment not found.');
    need(who, 'marks.manage', { division: a.division_code });
    const rows = await db.q(`select a.id, a.name, s.profile->>'roll' as roll, m.obtained, m.absent, m.grade, m.remark from class_enrollments e join accounts a on a.id = e.student_id
      left join account_state s on s.account_id = a.id left join assessment_marks m on m.assessment_id = $2 and m.student_id = a.id
      where e.division_code = $1 and e.status = 'active' order by nullif(s.profile->>'roll', '') nulls last, a.name limit 300`, [a.division_code, a.id]);
    return { assessment: a, students: rows };
  }
  async function saveMarks(who, req) {
    await limit(`marks:${who.account.id}`, 120, 600);
    const b = body(req);
    if (!isUuid(b.id)) throw bad('INVALID_ID', 'Unknown assessment.');
    const [a] = await db.q('select id, division_code, max_marks, status from assessments where id = $1', [b.id]);
    if (!a) throw notFound('Assessment not found.');
    need(who, 'marks.manage', { division: a.division_code });
    if (!Array.isArray(b.marks)) throw bad('INVALID_MARKS', 'Send the marks list.');
    const ids = await enrolled(a.division_code, b.marks.map((m) => m && m.studentId));
    const max = Number(a.max_marks), by = new Map(b.marks.map((m) => [m.studentId, m]));
    const ob = [], ab = [], gr = [], rm = [];
    for (const id of ids) {
      const m = by.get(id), absent = m.absent === true
      const v = m.obtained === null || m.obtained === '' || m.obtained === undefined ? null : Number(m.obtained);
      if (!absent && v !== null && (!Number.isFinite(v) || v < 0 || v > max)) throw bad('INVALID_MARK', `Marks must be between 0 and ${max}.`);
      ob.push(absent ? null : v); ab.push(absent); gr.push(txt(m.grade, 8)); rm.push(txt(m.remark, 200));
    }
    const rows = await db.q(`insert into assessment_marks (assessment_id, student_id, obtained, absent, grade, remark)
      select $1, x.sid, x.ob, x.ab, x.gr, x.rm from unnest($2::uuid[], $3::numeric[], $4::boolean[], $5::text[], $6::text[]) as x(sid, ob, ab, gr, rm)
      on conflict (assessment_id, student_id) do update set obtained = excluded.obtained, absent = excluded.absent, grade = excluded.grade, remark = excluded.remark, updated_at = now() returning 1`, [a.id, ids, ob, ab, gr, rm]);
    await db.q('update assessments set updated_at = now() where id = $1', [a.id]);
    await db.audit(who.account.id, 'marks.save', a.id, { count: rows.length, published: a.status === 'published' }, branchOf(who, a.division_code));
    return { saved: rows.length };
  }
  async function assessmentStatus(who, req) {
    const b = body(req);
    if (!isUuid(b.id) || !['draft', 'published'].includes(b.status)) throw bad('INVALID', 'Unknown assessment or status.');
    const [a] = await db.q('select division_code from assessments where id = $1', [b.id]);
    if (!a) throw notFound('Assessment not found.');
    need(who, 'marks.manage', { division: a.division_code });
    await db.q(`update assessments set status = $2, published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end, updated_at = now() where id = $1`, [b.id, b.status]);
    await db.audit(who.account.id, b.status === 'published' ? 'assessment.publish' : 'assessment.unpublish', b.id, {}, branchOf(who, a.division_code));
    return { status: b.status };
  }

  /* ---------------- attendance alerts (defaulter notices) ---------------- */
  async function saveAlert(who, req) {
    const b = body(req);
    const title = txt(b.title, 120);
    if (title.length < 4) throw bad('INVALID_TITLE', 'Give the alert a short title.');
    const fields = [txt(b.subject, 40), title, txt(b.details, 1000), txt(b.nextSteps, 500), txt(b.contact, 120)];
    if (b.id) {
      if (!isUuid(b.id)) throw bad('INVALID_ID', 'Unknown alert.');
      const [a] = await db.q('select division_code, status from attendance_alerts where id = $1', [b.id]);
      if (!a) throw notFound('Alert not found.');
      need(who, 'alert.draft', { division: a.division_code });
      if (a.status !== 'draft' && !can(who, 'alert.publish', { division: a.division_code })) throw forbidden('Only the HOD can change a published alert.');
      await db.q(`update attendance_alerts set subject = $2, title = $3, details = $4, next_steps = $5, contact = $6, updated_at = now() where id = $1`, [b.id, ...fields]);
      await db.audit(who.account.id, 'alert.update', b.id, {}, branchOf(who, a.division_code));
      return { alert: { id: b.id } };
    }
    const div = division(who, b.division);
    need(who, 'alert.draft', { division: div });
    if (!isUuid(b.studentId)) throw bad('INVALID_STUDENT', 'Choose a student.');
    await enrolled(div, [b.studentId]);
    const [r] = await db.q(`insert into attendance_alerts (student_id, division_code, subject, title, details, next_steps, contact, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, status`,
      [b.studentId, div, ...fields, who.account.id]);
    await db.audit(who.account.id, 'alert.draft', r.id, { division: div }, branchOf(who, div));
    return { alert: r };
  }
  async function listAlerts(who, req) {
    const divs = req.query.division ? [division(who, req.query.division)] : allowedDivisions(who, 'alert.draft');
    divs.forEach((d) => need(who, 'alert.draft', { division: d }));
    if (!divs.length) return { alerts: [] };
    const rows = await db.q(`select l.id, l.division_code, l.subject, l.title, l.details, l.next_steps, l.contact, l.status, l.created_at, l.updated_at, l.published_at, a.name as student_name, a.id as student_id
      from attendance_alerts l join accounts a on a.id = l.student_id where l.division_code = any($1) order by (l.status = 'draft') desc, l.updated_at desc limit 200`, [divs]);
    return { alerts: rows.map((r) => ({ ...r, canPublish: can(who, 'alert.publish', { division: r.division_code }) })) };
  }
  async function alertStatus(who, req) {
    const b = body(req);
    if (!isUuid(b.id) || !['draft', 'published', 'withdrawn'].includes(b.status)) throw bad('INVALID', 'Unknown alert or status.');
    const [a] = await db.q('select division_code from attendance_alerts where id = $1', [b.id]);
    if (!a) throw notFound('Alert not found.');
    need(who, 'alert.publish', { division: a.division_code }, 'Only the HOD of this branch can publish or withdraw alerts.');
    await db.q(`update attendance_alerts set status = $2, published_by = case when $2 = 'published' then $3::uuid else published_by end, published_at = case when $2 = 'published' then now() else published_at end, updated_at = now() where id = $1`, [b.id, b.status, who.account.id]);
    await db.audit(who.account.id, `alert.${b.status}`, b.id, {}, branchOf(who, a.division_code));
    return { status: b.status };
  }

  /* ---------------- college events (HOD, per branch) ---------------- */
  const branchArg = (who, v) => { const br = txt(v, 10).toUpperCase() || who.hodBranches[0]; if (!can(who, 'event.manage', { branch: br })) throw forbidden('Only the HOD of this branch can manage its events.'); return br; };
  async function saveEvent(who, req) {
    const b = body(req);
    const title = txt(b.title, 120), starts = Date.parse(b.startsAt), ends = b.endsAt ? Date.parse(b.endsAt) : null;
    if (title.length < 3) throw bad('INVALID_TITLE', 'Give the event a title.');
    if (Number.isNaN(starts) || (ends !== null && (Number.isNaN(ends) || ends < starts))) throw bad('INVALID_TIME', 'Check the start and end time.');
    const vals = [title, txt(b.description, 2000), txt(b.venue, 120), new Date(starts).toISOString(), ends ? new Date(ends).toISOString() : null, txt(b.registration, 300)];
    if (b.id) {
      if (!isUuid(b.id)) throw bad('INVALID_ID', 'Unknown event.');
      const [e] = await db.q('select branch_code from college_events where id = $1', [b.id]);
      if (!e) throw notFound('Event not found.');
      branchArg(who, e.branch_code);
      await db.q('update college_events set title = $2, description = $3, venue = $4, starts_at = $5, ends_at = $6, registration = $7, updated_at = now() where id = $1', [b.id, ...vals]);
      await db.audit(who.account.id, 'event.update', b.id, { title }, e.branch_code);
      return { event: { id: b.id } };
    }
    const br = branchArg(who, b.branch);
    const [r] = await db.q('insert into college_events (branch_code, title, description, venue, starts_at, ends_at, registration, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, status', [br, ...vals, who.account.id]);
    await db.audit(who.account.id, 'event.create', r.id, { title }, br);
    return { event: r };
  }
  async function eventStatus(who, req) {
    const b = body(req);
    if (!isUuid(b.id) || !['draft', 'published', 'cancelled'].includes(b.status)) throw bad('INVALID', 'Unknown event or status.');
    const [e] = await db.q('select branch_code from college_events where id = $1', [b.id]);
    if (!e) throw notFound('Event not found.');
    branchArg(who, e.branch_code);
    await db.q(`update college_events set status = $2, published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end, updated_at = now() where id = $1`, [b.id, b.status]);
    await db.audit(who.account.id, `event.${b.status}`, b.id, {}, e.branch_code);
    return { status: b.status };
  }
  async function listEvents(who) {
    if (who.base === 'hod') return { events: await db.q(`select id, branch_code, title, description, venue, starts_at, ends_at, registration, status, updated_at from college_events where branch_code = any($1) order by starts_at desc limit 100`, [who.hodBranches]) };
    const br = who.base === 'student' && who.enrollment ? branchOf(who, who.enrollment.division_code) : who.teacher ? who.teacher.branch : null;
    if (!br) return { events: [] };
    return { events: await db.q(`select id, title, description, venue, starts_at, ends_at, registration, status, updated_at from college_events where branch_code = $1 and status in ('published', 'cancelled') and starts_at > now() - interval '30 days' order by starts_at limit 50`, [br]) };
  }

  /* ---------------- settings ---------------- */
  async function setThreshold(who, req) {
    const b = body(req), br = txt(b.branch, 10).toUpperCase() || who.hodBranches[0];
    need(who, 'settings.manage', { branch: br }, 'Only the HOD of this branch can change this.');
    const v = b.value === null || b.value === '' ? null : Number(b.value);
    if (v !== null && (!Number.isFinite(v) || v < 1 || v > 100)) throw bad('INVALID_VALUE', 'Enter a percentage from 1 to 100, or leave it empty.');
    if (v === null) await db.q('delete from settings where key = $1', [`attendance_threshold:${br}`]);
    else await db.q(`insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [`attendance_threshold:${br}`, JSON.stringify(v)]);
    await db.audit(who.account.id, 'settings.attendance_threshold', br, { value: v }, br);
    return { branch: br, attendanceThreshold: v };
  }
  async function threshold(br) { const [r] = await db.q('select value from settings where key = $1', [`attendance_threshold:${br}`]); return r ? Number(r.value) : null; }
  async function getSettings(who, req) {
    const br = txt(req.query.branch, 10).toUpperCase() || who.hodBranches[0];
    need(who, 'settings.manage', { branch: br });
    return { branch: br, attendanceThreshold: await threshold(br) };
  }

  /* ---------------- the read-only record (parent and student view) ---------------- */
  async function recordFor(studentId, divisionsMap) {
    const [stu] = await db.q(`select a.id, a.name, s.profile->>'roll' as roll from accounts a left join account_state s on s.account_id = a.id where a.id = $1`, [studentId]);
    const [enr] = await db.q(`select e.division_code, e.year_id, y.label as year_label, d.name as division_name, d.branch_code, b.name as branch_name
      from class_enrollments e join divisions d on d.code = e.division_code left join academic_years y on y.id = e.year_id left join branches b on b.code = d.branch_code
      where e.student_id = $1 and e.status = 'active' order by e.approved_at desc limit 1`, [studentId]);
    const student = { id: stu.id, name: stu.name || '', roll: stu.roll || null, division: enr ? enr.division_code : null, divisionName: enr ? enr.division_name : null, branch: enr ? enr.branch_code : null, branchName: enr ? enr.branch_name : null, year: enr ? enr.year_label || enr.year_id : null };
    // attendance: computed from the recorded marks only
    const att = await db.q(`select s.on_date, s.subject, s.start_time, s.updated_at, m.present from attendance_marks m join attendance_sessions s on s.id = m.session_id where m.student_id = $1 order by s.on_date desc, s.start_time desc limit 2000`, [studentId]);
    const sum = (rows) => { const p = rows.filter((r) => r.present).length; return { total: rows.length, present: p, absent: rows.length - p, percent: rows.length ? Math.round((1000 * p) / rows.length) / 10 : null } };
    const group = (key) => { const m = new Map(); for (const r of att) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) } return [...m].map(([k, rows]) => ({ key: k, ...sum(rows) })) };
    const day = (d) => (typeof d === 'string' ? d.slice(0, 10) : ymd(d));
    const attendance = {
      ...sum(att), period: att.length ? { from: day(att[att.length - 1].on_date), to: day(att[0].on_date) } : null,
      bySubject: group((r) => r.subject).sort((a, b) => a.key.localeCompare(b.key)),
      byMonth: group((r) => day(r.on_date).slice(0, 7)).sort((a, b) => a.key.localeCompare(b.key)),
      history: att.slice(0, 120).map((r) => ({ date: day(r.on_date), subject: r.subject, start: r.start_time, present: r.present })),
    };
    // marks: published assessments of the class that have an entry for this student
    const mk = enr ? await db.q(`select a.id, a.subject, a.name, a.term, a.held_on, a.max_marks, a.published_at, a.updated_at, m.obtained, m.absent, m.grade, m.remark
      from assessments a join assessment_marks m on m.assessment_id = a.id and m.student_id = $1 where a.division_code = $2 and a.status = 'published' order by a.held_on desc nulls last, a.published_at desc limit 300`, [studentId, enr.division_code]) : [];
    const items = mk.map((r) => ({ id: r.id, subject: r.subject, name: r.name, term: r.term, date: r.held_on ? day(r.held_on) : null, max: Number(r.max_marks), obtained: r.obtained === null ? null : Number(r.obtained), absent: r.absent, grade: r.grade || null, remark: r.remark || null, percent: r.obtained === null || r.absent ? null : Math.round((1000 * Number(r.obtained)) / Number(r.max_marks)) / 10, publishedAt: r.published_at, updatedAt: r.updated_at }));
    const termMap = new Map(); for (const i of items) { if (i.obtained === null) continue; const k = i.term || '—'; const t = termMap.get(k) || { term: k, obtained: 0, max: 0, count: 0 }; t.obtained += i.obtained; t.max += i.max; t.count++; termMap.set(k, t) }
    const marks = { items, byTerm: [...termMap.values()].map((t) => ({ ...t, percent: Math.round((1000 * t.obtained) / t.max) / 10 })) };
    const alerts = await db.q(`select id, subject, title, details, next_steps, contact, published_at, updated_at from attendance_alerts where student_id = $1 and status = 'published' order by published_at desc limit 50`, [studentId]);
    const notices = enr ? await db.q(`select p.id, p.kind, p.title, p.body, p.author_name, p.author_role, p.created_at, (p.file_id is not null) as has_file from post_targets t join posts p on p.id = t.post_id
      where t.division_code = $1 and p.deleted_at is null order by p.created_at desc limit 20`, [enr.division_code]) : [];
    const reminders = enr ? await db.q(`select id, title, body, remind_at, author_name from reminders where division_code = $1 and deleted_at is null and remind_at > now() - interval '1 day' order by remind_at limit 20`, [enr.division_code]) : [];
    const events = enr ? await db.q(`select id, title, description, venue, starts_at, ends_at, registration, status, updated_at from college_events where branch_code = $1 and status in ('published', 'cancelled') and starts_at > now() - interval '60 days' order by starts_at limit 50`, [enr.branch_code]) : [];
    return { student, enrolled: !!enr, attendance, attendanceThreshold: enr ? await threshold(enr.branch_code) : null, marks, alerts, notices, reminders, events };
  }
  async function parentChildren(who) {
    if (who.base !== 'parent') throw forbidden('This is for parents and guardians.');
    const rows = await db.q(`select l.student_id as id, l.relation, a.name, e.division_code from parent_links l join accounts a on a.id = l.student_id
      left join class_enrollments e on e.student_id = l.student_id and e.status = 'active' where l.parent_phone = $1 and l.status = 'approved' order by a.name`, [who.phone]);
    return { children: rows };
  }
  async function parentRecord(who, req) {
    const child = req.query.child;
    if (!isUuid(child) || !can(who, 'parent.read', { student: child })) throw notFound('Student not found.'); // same answer for "not yours" and "doesn't exist"
    const rec = await recordFor(child);
    const [seen] = await db.q('select seen_at from parent_seen where parent_phone = $1 and student_id = $2', [who.phone, child]);
    const since = seen ? new Date(seen.seen_at).getTime() : 0, after = (t) => t && new Date(t).getTime() > since;
    const news = [
      ...rec.alerts.filter((a) => after(a.updated_at)).map((a) => ({ kind: 'alert', id: a.id, title: a.title, at: a.updated_at })),
      ...rec.marks.items.filter((m) => after(m.updatedAt)).map((m) => ({ kind: 'marks', id: m.id, title: `${m.subject} · ${m.name}`, at: m.updatedAt })),
      ...rec.notices.filter((n) => after(n.created_at)).map((n) => ({ kind: 'notice', id: n.id, title: n.title, at: n.created_at })),
      ...rec.events.filter((e) => after(e.updated_at)).map((e) => ({ kind: e.status === 'cancelled' ? 'event-cancelled' : 'event', id: e.id, title: e.title, at: e.updated_at })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30);
    const newAttendance = (await db.q(`select count(*)::int as n from attendance_marks m join attendance_sessions s on s.id = m.session_id where m.student_id = $1 and s.updated_at > $2`, [child, new Date(since).toISOString()]))[0].n;
    return { ...rec, whatsNew: { since: seen ? seen.seen_at : null, items: news, newAttendance } };
  }
  async function parentSeen(who, req) {
    const b = body(req);
    if (!isUuid(b.child) || !can(who, 'parent.read', { student: b.child })) throw notFound('Student not found.');
    await db.q(`insert into parent_seen (parent_phone, student_id) values ($1, $2) on conflict (parent_phone, student_id) do update set seen_at = now()`, [who.phone, b.child]);
    return { seen: true };
  }
  async function myRecord(who) {
    if (who.base !== 'student') throw forbidden('This is the student view.');
    return recordFor(who.account.id);
  }

  return {
    'POST parent-links': requestLink, 'GET parent-links': listLinks, 'POST parent-link-decision': decideLinks, 'DELETE parent-links': revokeLink,
    'POST attendance': saveAttendance, 'GET attendance': getAttendance,
    'POST assessments': saveAssessment, 'GET assessments': listAssessments, 'GET assessment': getAssessment, 'POST assessment-marks': saveMarks, 'POST assessment-status': assessmentStatus,
    'POST alerts': saveAlert, 'GET alerts': listAlerts, 'POST alert-status': alertStatus,
    'POST events': saveEvent, 'POST event-status': eventStatus, 'GET events': listEvents,
    'POST attendance-threshold': setThreshold, 'GET settings': getSettings,
    'GET parent-children': parentChildren, 'GET parent-record': parentRecord, 'POST parent-seen': parentSeen, 'GET my-record': myRecord,
  };
};
