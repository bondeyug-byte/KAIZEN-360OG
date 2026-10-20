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
];
module.exports.FE_DIVISIONS = FE_DIVISIONS;
