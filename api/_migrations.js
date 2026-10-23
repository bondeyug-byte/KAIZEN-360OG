// Schema for Campus360. Add new migrations at the end; never edit or remove one that has shipped.
// New tables only: the existing `users`, `rides` and `kaizen_reviews` tables are left untouched.
const BRANCHES = [
  ['AIDS', 'Artificial Intelligence & Data Science'], ['ECS', 'Electronics & Computer Science'],
  ['CMPN', 'Computer Engineering'], ['INFT', 'Information Technology'],
  ['EXTC', 'Electronics & Telecommunication'], ['AURO', 'Automation & Robotics'],
];
// FE 2026-27 divisions from the college timetable. confirmed=false where the timetable header was cut off.
const FE_DIVISIONS = [
  ['D1ADA', 'AIDS', true], ['D1ADB', 'AIDS', true], ['D1EC', 'ECS', true],
  ['D2A', 'CMPN', true], ['D2B', 'CMPN', true], ['D2C', 'CMPN', false],
  ['D3', 'AURO', true], ['D4A', 'EXTC', true], ['D4B', 'EXTC', true],
  ['D5A', 'INFT', false], ['D5B', 'INFT', true], ['D5C', 'INFT', false],
];
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

module.exports = [
  {
    id: 1,
    name: 'accounts, roles, divisions, enrollments, account state, audit log',
    up: [
      `create table if not exists accounts (
        id uuid primary key default gen_random_uuid(),
        phone text not null unique check (phone ~ '^\\+91[6-9][0-9]{9}$'),
        name text not null default '',
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now())`,
      `create table if not exists account_roles (
        account_id uuid not null references accounts(id) on delete cascade,
        role text not null check (role in ('teacher', 'cr', 'hod')),
        scope text not null default '',
        granted_by uuid references accounts(id),
        granted_at timestamptz not null default now(),
        primary key (account_id, role, scope))`,
      `create table if not exists branches (code text primary key, name text not null)`,
      `create table if not exists divisions (
        code text primary key,
        branch_code text not null references branches(code),
        year smallint not null check (year between 1 and 4),
        confirmed boolean not null default false)`,
      `create table if not exists enrollments (
        account_id uuid not null references accounts(id) on delete cascade,
        division_code text not null references divisions(code),
        status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
        decided_by uuid references accounts(id),
        decided_at timestamptz,
        created_at timestamptz not null default now(),
        primary key (account_id, division_code))`,
      `create index if not exists enrollments_by_division on enrollments (division_code, status)`,
      `create table if not exists account_state (
        account_id uuid primary key references accounts(id) on delete cascade,
        profile jsonb not null default '{}'::jsonb,
        data jsonb not null default '{}'::jsonb,
        version integer not null default 0,
        updated_at timestamptz not null default now())`,
      `create table if not exists audit_log (
        id bigserial primary key,
        at timestamptz not null default now(),
        actor uuid,
        action text not null,
        target text,
        detail jsonb)`,
      `create index if not exists audit_log_by_time on audit_log (at desc)`,
      `insert into branches (code, name) values ${BRANCHES.map(([c, n]) => `(${lit(c)}, ${lit(n)})`).join(', ')} on conflict (code) do nothing`,
      `insert into divisions (code, branch_code, year, confirmed) values ${FE_DIVISIONS.map(([c, b, ok]) => `(${lit(c)}, ${lit(b)}, 1, ${ok})`).join(', ')} on conflict (code) do nothing`,
    ],
  },
  {
    id: 2,
    name: 'teacher whitelist, posts and files, timetables, rate limits, one approved class per student',
    up: [
      `create table if not exists teacher_whitelist (
        phone text primary key check (phone ~ '^\\+91[6-9][0-9]{9}$'),
        name text not null default '',
        code text not null default '',
        teaches jsonb not null default '[]'::jsonb,
        can_publish_timetable boolean not null default true,
        added_by uuid references accounts(id),
        added_at timestamptz not null default now())`,
      `create table if not exists files (
        id uuid primary key default gen_random_uuid(),
        owner_id uuid not null references accounts(id),
        name text not null, mime text not null, size integer not null check (size > 0 and size <= 3145728),
        bytes bytea not null,
        created_at timestamptz not null default now())`,
      `create table if not exists posts (
        id uuid primary key default gen_random_uuid(),
        author_id uuid not null references accounts(id),
        author_name text not null default '',
        kind text not null check (kind in ('announcement', 'material')),
        title text not null, body text not null default '',
        file_id uuid references files(id),
        created_at timestamptz not null default now(),
        deleted_at timestamptz)`,
      `create index if not exists posts_by_author on posts (author_id, created_at desc)`,
      `create table if not exists post_targets (
        post_id uuid not null references posts(id) on delete cascade,
        division_code text not null references divisions(code),
        primary key (post_id, division_code))`,
      `create index if not exists post_targets_by_division on post_targets (division_code, post_id)`,
      `create table if not exists subjects (code text primary key, name text not null default '')`,
      `create table if not exists faculty (code text primary key, name text not null default '', dept text not null default '')`,
      `create table if not exists timetable_versions (
        id uuid primary key default gen_random_uuid(),
        term text not null,
        created_by uuid not null references accounts(id),
        file_name text not null default '', file_size integer,
        row_count integer not null default 0,
        divisions text[] not null default '{}',
        lookups jsonb not null default '{}'::jsonb,
        status text not null check (status in ('draft', 'published')),
        created_at timestamptz not null default now(),
        published_at timestamptz, published_by uuid references accounts(id))`,
      `create index if not exists timetable_versions_by_term on timetable_versions (term, status, published_at desc)`,
      `create table if not exists timetable_entries (
        version_id uuid not null references timetable_versions(id) on delete cascade,
        division_code text not null references divisions(code),
        day smallint not null check (day between 1 and 6),
        start_min smallint not null, end_min smallint not null check (end_min > start_min),
        subject text not null, teacher_code text not null default '', room text not null default '',
        batch text not null default '', type text not null default 'Lecture',
        source_row integer)`,
      `create index if not exists timetable_entries_lookup on timetable_entries (version_id, division_code, day, start_min)`,
      `create table if not exists rate_limits (key text primary key, window_start timestamptz not null, count integer not null)`,
      `create unique index if not exists one_approved_class on enrollments (account_id) where status = 'approved'`,
      `create unique index if not exists one_pending_request on enrollments (account_id) where status = 'pending'`,
      `create index if not exists account_roles_by_scope on account_roles (role, scope)`,
    ],
  },
  {
    id: 3,
    name: 'roles v2: academic years, HODs per branch, teacher divisions, join requests, class enrollments, class reps, instructions, reminders, settings',
    // Adds only. Old tables (enrollments, account_roles 'cr') are copied, never changed, so the previous
    // deployment keeps working if this one is rolled back.
    up: [
      `create table if not exists academic_years (id text primary key, label text not null, calendar text not null, level smallint not null check (level between 1 and 4), active boolean not null default true)`,
      `insert into academic_years (id, label, calendar, level) values ('FE-2026-27', 'FE', '2026-27', 1) on conflict (id) do nothing`,
      `alter table branches add column if not exists active boolean not null default true`,
      `alter table divisions add column if not exists year_id text references academic_years(id)`,
      `alter table divisions add column if not exists name text`,
      `update divisions set year_id = 'FE-2026-27' where year = 1 and year_id is null`,
      `update divisions set name = code where name is null`,
      `create unique index if not exists divisions_unique_name on divisions (branch_code, year_id, name)`,
      `create table if not exists hod_assignments (
        phone text not null check (phone ~ '^\\+91[6-9][0-9]{9}$'),
        branch_code text not null references branches(code),
        active boolean not null default true,
        updated_at timestamptz not null default now(),
        primary key (phone, branch_code))`,
      `alter table teacher_whitelist add column if not exists branch_code text references branches(code)`,
      `alter table teacher_whitelist add column if not exists active boolean not null default true`,
      `create table if not exists teacher_divisions (
        teacher_phone text not null references teacher_whitelist(phone) on delete cascade,
        division_code text not null references divisions(code),
        subject text not null default '',
        primary key (teacher_phone, division_code, subject))`,
      `create index if not exists teacher_divisions_by_division on teacher_divisions (division_code)`,
      `insert into teacher_divisions (teacher_phone, division_code, subject)
         select w.phone, x->>'division', coalesce(x->>'subject', '') from teacher_whitelist w, jsonb_array_elements(w.teaches) x
          where exists (select 1 from divisions d where d.code = x->>'division') on conflict do nothing`,
      `update teacher_whitelist w set branch_code = (select d.branch_code from teacher_divisions t join divisions d on d.code = t.division_code where t.teacher_phone = w.phone limit 1) where branch_code is null`,
      `create table if not exists join_requests (
        id uuid primary key default gen_random_uuid(),
        student_id uuid not null references accounts(id) on delete cascade,
        division_code text not null references divisions(code),
        status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
        decided_by uuid references accounts(id), decided_at timestamptz,
        decided_as text, note text not null default '',
        created_at timestamptz not null default now())`,
      `create unique index if not exists one_pending_join on join_requests (student_id) where status = 'pending'`,
      `create index if not exists join_requests_by_division on join_requests (division_code, status, created_at desc)`,
      `create table if not exists class_enrollments (
        student_id uuid not null references accounts(id) on delete cascade,
        division_code text not null references divisions(code),
        year_id text not null references academic_years(id),
        status text not null default 'active' check (status in ('active', 'archived')),
        approved_by uuid references accounts(id), approved_at timestamptz not null default now(),
        request_id uuid references join_requests(id),
        archived_by uuid references accounts(id), archived_at timestamptz,
        primary key (student_id, division_code, year_id))`,
      `create unique index if not exists one_active_class_per_year on class_enrollments (student_id, year_id) where status = 'active'`,
      `create index if not exists class_enrollments_by_division on class_enrollments (division_code, status)`,
      `insert into join_requests (student_id, division_code, status, decided_by, decided_at, created_at)
         select e.account_id, e.division_code, e.status, e.decided_by, e.decided_at, e.created_at from enrollments e
          where not exists (select 1 from join_requests j where j.student_id = e.account_id and j.division_code = e.division_code)`,
      `insert into class_enrollments (student_id, division_code, year_id, approved_by, approved_at)
         select e.account_id, e.division_code, d.year_id, e.decided_by, coalesce(e.decided_at, e.created_at)
           from enrollments e join divisions d on d.code = e.division_code where e.status = 'approved' and d.year_id is not null
         on conflict do nothing`,
      `create table if not exists cr_assignments (
        student_id uuid not null references accounts(id) on delete cascade,
        division_code text not null references divisions(code),
        active boolean not null default true,
        assigned_by uuid references accounts(id), assigned_at timestamptz not null default now(),
        removed_by uuid references accounts(id), removed_at timestamptz,
        primary key (student_id, division_code))`,
      `create index if not exists cr_assignments_by_division on cr_assignments (division_code) where active`,
      `insert into cr_assignments (student_id, division_code, assigned_by, assigned_at)
         select account_id, scope, granted_by, granted_at from account_roles where role = 'cr' and exists (select 1 from divisions d where d.code = scope)
         on conflict do nothing`,
      `create table if not exists cr_requests (
        id uuid primary key default gen_random_uuid(),
        student_id uuid not null references accounts(id) on delete cascade,
        division_code text not null references divisions(code),
        status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
        decided_by uuid references accounts(id), decided_at timestamptz, note text not null default '',
        created_at timestamptz not null default now())`,
      `create unique index if not exists one_pending_cr_request on cr_requests (student_id) where status = 'pending'`,
      `create index if not exists cr_requests_by_division on cr_requests (division_code, status)`,
      `create table if not exists teacher_instructions (
        id uuid primary key default gen_random_uuid(),
        from_id uuid not null references accounts(id),
        branch_code text not null references branches(code),
        title text not null, body text not null default '', due_date date,
        created_at timestamptz not null default now())`,
      `create table if not exists instruction_recipients (
        instruction_id uuid not null references teacher_instructions(id) on delete cascade,
        teacher_phone text not null references teacher_whitelist(phone) on delete cascade,
        status text not null default 'sent' check (status in ('sent', 'seen', 'done')),
        updated_at timestamptz not null default now(),
        primary key (instruction_id, teacher_phone))`,
      `create index if not exists instruction_recipients_by_teacher on instruction_recipients (teacher_phone, status)`,
      `create table if not exists reminders (
        id uuid primary key default gen_random_uuid(),
        author_id uuid not null references accounts(id), author_name text not null default '', author_role text not null,
        division_code text not null references divisions(code),
        title text not null, body text not null default '', remind_at timestamptz not null,
        created_at timestamptz not null default now(), deleted_at timestamptz)`,
      `create index if not exists reminders_by_division on reminders (division_code, remind_at)`,
      `alter table posts add column if not exists author_role text not null default 'teacher'`,
      `create table if not exists settings (key text primary key, value jsonb not null)`,
      `insert into settings (key, value) values ('division_capacity', '65'), ('max_crs_per_division', '2') on conflict (key) do nothing`,
      `alter table audit_log add column if not exists branch_code text`,
      `create index if not exists audit_log_by_branch on audit_log (branch_code, id desc)`,
    ],
  },
  {
    id: 4,
    name: 'parent portal: parent links, attendance, assessments and marks, attendance alerts, college events, parent read state',
    up: [
      // Parent ↔ student: requested by the student, confirmed by the class teacher or HOD (the college).
      `create table if not exists parent_links (
        id uuid primary key default gen_random_uuid(),
        parent_phone text not null check (parent_phone ~ '^\\+91[6-9][0-9]{9}$'),
        student_id uuid not null references accounts(id) on delete cascade,
        relation text not null default 'Parent',
        status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revoked')),
        requested_at timestamptz not null default now(),
        decided_by uuid references accounts(id), decided_at timestamptz, note text not null default '')`,
      `create unique index if not exists one_open_link on parent_links (parent_phone, student_id) where status in ('pending', 'approved')`,
      `create index if not exists parent_links_by_phone on parent_links (parent_phone) where status = 'approved'`,
      `create index if not exists parent_links_by_student on parent_links (student_id)`,
      // Attendance: one session per division + subject + date + start time; one mark per student.
      `create table if not exists attendance_sessions (
        id uuid primary key default gen_random_uuid(),
        division_code text not null references divisions(code),
        subject text not null, on_date date not null, start_time text not null default '',
        taken_by uuid not null references accounts(id), taken_by_name text not null default '',
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique (division_code, subject, on_date, start_time))`,
      `create index if not exists attendance_sessions_by_division on attendance_sessions (division_code, on_date desc)`,
      `create table if not exists attendance_marks (
        session_id uuid not null references attendance_sessions(id) on delete cascade,
        student_id uuid not null references accounts(id) on delete cascade,
        present boolean not null,
        primary key (session_id, student_id))`,
      `create index if not exists attendance_marks_by_student on attendance_marks (student_id)`,
      // Assessments: drafts stay private; parents and students see only published ones.
      `create table if not exists assessments (
        id uuid primary key default gen_random_uuid(),
        division_code text not null references divisions(code),
        subject text not null, name text not null, term text not null default '', held_on date,
        max_marks numeric not null check (max_marks > 0 and max_marks <= 1000),
        status text not null default 'draft' check (status in ('draft', 'published')),
        created_by uuid not null references accounts(id), created_by_name text not null default '',
        published_at timestamptz, updated_at timestamptz not null default now(), created_at timestamptz not null default now())`,
      `create index if not exists assessments_by_division on assessments (division_code, status, held_on desc)`,
      `create table if not exists assessment_marks (
        assessment_id uuid not null references assessments(id) on delete cascade,
        student_id uuid not null references accounts(id) on delete cascade,
        obtained numeric, absent boolean not null default false, grade text not null default '', remark text not null default '',
        updated_at timestamptz not null default now(),
        primary key (assessment_id, student_id))`,
      `create index if not exists assessment_marks_by_student on assessment_marks (student_id)`,
      // Attendance alerts (defaulter notices): teacher or HOD drafts, the branch HOD publishes.
      `create table if not exists attendance_alerts (
        id uuid primary key default gen_random_uuid(),
        student_id uuid not null references accounts(id) on delete cascade,
        division_code text not null references divisions(code),
        subject text not null default '', title text not null, details text not null default '',
        next_steps text not null default '', contact text not null default '',
        status text not null default 'draft' check (status in ('draft', 'published', 'withdrawn')),
        created_by uuid not null references accounts(id), published_by uuid references accounts(id),
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(), published_at timestamptz)`,
      `create index if not exists attendance_alerts_by_student on attendance_alerts (student_id, status)`,
      `create index if not exists attendance_alerts_by_division on attendance_alerts (division_code, status)`,
      // College events published by the HOD for their branch (organiser accounts are not on the server yet).
      `create table if not exists college_events (
        id uuid primary key default gen_random_uuid(),
        branch_code text not null references branches(code),
        title text not null, description text not null default '', venue text not null default '',
        starts_at timestamptz not null, ends_at timestamptz, registration text not null default '',
        status text not null default 'draft' check (status in ('draft', 'published', 'cancelled')),
        created_by uuid not null references accounts(id), created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), published_at timestamptz)`,
      `create index if not exists college_events_by_branch on college_events (branch_code, status, starts_at)`,
      // What a parent has already seen (for "new since your last visit"); the parent's own state only.
      `create table if not exists parent_seen (
        parent_phone text not null, student_id uuid not null references accounts(id) on delete cascade,
        seen_at timestamptz not null default now(), primary key (parent_phone, student_id))`,
    ],
  },
  {
    id: 5,
    name: 'division change requests: join_requests.kind, from_division, reason (additive)',
    up: [
      // A student already in a class asks to move to another division of the same year; the target class
      // teacher or the branch HOD approves. Existing rows stay 'join'. Nothing is dropped or rewritten.
      `alter table join_requests add column if not exists kind text not null default 'join' check (kind in ('join', 'transfer'))`,
      `alter table join_requests add column if not exists from_division text references divisions(code)`,
      `alter table join_requests add column if not exists reason text not null default ''`,
    ],
  },
];
module.exports.FE_DIVISIONS = FE_DIVISIONS;
