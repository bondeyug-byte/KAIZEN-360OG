# Campus360 college portal — architecture and handover


## 0. Roles v2 (October 2026) — read this first
| Role | How someone gets it | Where they work |
|---|---|---|
| **HOD** | Only through the server setting `HOD_PHONES` (`98xxxxxxxx=CMPN;97xxxxxxxx=AIDS` — one HOD per branch). Copied into `hod_assignments` on every server start; numbers removed from the setting lose HOD access. | Separate **HOD portal** (`/hod`, "HOD" tab on the login page) |
| **Teacher** | The HOD adds the number in HOD portal → Teachers and assigns divisions. (`TEACHER_PHONES` is copied in once, then remove it.) | Teacher portal |
| **Class rep (CR)** | A student asks ("Request CR role") and the division's teacher or the HOD approves, or the HOD assigns directly. Max 2 per division. | Student login → College portal → **CR Tools** |
| **Student** | Anyone else. Joins one division by request; a teacher of that division, its CR or the branch HOD approves (first decision wins). Max 65 per division. | College portal |

Precedence when a number fits several roles: **HOD > teacher > student**. A teacher or HOD number cannot join a class.
All rules are in ONE function, `can(user, action, resource)` in `api/_policy.js`; every route calls it; it is unit-tested.
Roles are re-read from the database on every request, so removing a teacher or CR takes effect on their next action.
`ADMIN_PHONES` is no longer used.

Settings (table `settings`): `division_capacity` = 65, `max_crs_per_division` = 2. Change with SQL in the Neon console, e.g.
`update settings set value = '70' where key = 'division_capacity';`

Timetables: one loader (`src/lib/timetable.js`) feeds the Overview widget, College portal → Timetable and the assistant.
Students see a new publish the next time they open the app, switch back to the tab (after 60 s) or refresh — not instant push.
A teacher uploading a file with other divisions must choose "Check only my divisions"; skipped divisions are listed.

Not built: academic-year rollover (the schema keeps `year_id` on enrollments and an `archived` status for it),
SE/TE/BE divisions (add rows to `academic_years` and `divisions`), push/SMS notifications, a super-admin.

## 0b. Parent portal, attendance and marks (October 2026)
One source of truth on the server (`api/_records.js`, migration 4). Parents only ever **read**.

| Who | Does what | Where |
|---|---|---|
| Student | Adds up to 4 parent/guardian numbers (College portal → My class → Parents & guardians); can remove them | Student app |
| Class teacher or branch HOD | Confirms or rejects each parent number (Teacher portal / HOD portal → Parents) | Teacher / HOD portal |
| Teacher (of that division) | Records attendance per lecture (Attendance), creates assessments, enters marks, **publishes** them (Marks), drafts attendance alerts | Teacher portal |
| HOD (of that branch) | Publishes / withdraws attendance alerts, sets the attendance requirement % (empty = none shown), creates/publishes/cancels branch events | HOD portal → Attendance alerts, Events |
| Parent | Signs in on the **Parent** tab with the confirmed number; sees each confirmed child: attendance (overall, by subject, by month, day by day), published marks (per assessment and per term), published alerts, class notices, reminders, branch events, and “new since your last visit” | `/parent` |

Rules enforced on the server for every request: a parent sees a student only while an **approved** link exists (revoking ends access at once);
any other student id answers “not found”; drafts (marks, alerts, events) never leave staff screens; percentages are computed from records
(lectures without a record are not counted; nothing is shown when there is no data); no grades are calculated (only a grade a teacher typed);
no attendance cut-off is assumed (only the HOD's setting). Every write is in the audit log. Precedence: HOD > teacher > parent > student
(an enrolled student never becomes a parent). Not built: organiser accounts on the server (events come from the HOD), uploaded report-card
documents, push/SMS notifications (the portal shows what is new on each visit), notification preferences.

## 0c. 3D map: real room numbers (photos of the floor boards, 21 Oct 2026)
`src/navigator/building.js` → `BOARDS` and `FLOOR_DEPT` hold what the boards at each floor's west stair/lift lobby say:
departments (1 Automation & Robotics + MCA HOD office B11, 2 Electronics & Computer Science, 3 Computer Engineering,
4 Electronics & Telecommunication, 5 Humanities & Science + Information Technology), every room number (incl. 305A/B,
B31–B33, server room 306B), HOD offices, toilets and the Central Arcades (CA-2 = amphitheatre terrace, CA-3/CA-4 = balconies).
The boards give the ORDER of rooms left/right of the west lobby, not their exact positions, so each number is placed on the
nearest free room slot in that order: approximate until someone checks it on site. Rooms to the left beyond the end of the
curve are in the west block. Model rooms the boards don't list are shown as "Room (not on the floor board)". No board was
photographed on the ground floor, so its rooms keep generic G-numbers. The lift panel shows only the two office landlines from
the lift notice (R & M Department, Admin Office); personal mobile numbers are deliberately left out.

## 1. In one minute (for the HOD)
Students, teachers and the HOD sign in with their phone number and a one-time code (MiniMoth).
The server identifies them from a signed cookie and looks up their role in the college database (Neon Postgres):

- **HOD** (`ADMIN_PHONES` setting): manages the teacher list, class representatives, join requests, timetables; sees the audit log.
- **Teacher** (HOD's teacher list, or `TEACHER_PHONES`): posts announcements and files to the divisions they teach; publishes timetables if allowed.
- **Class representative**: an approved student the HOD appoints; approves or rejects join requests for their own division only.
- **Student**: asks to join a division; once approved, sees that division's timetable and teacher posts on any device.

Every permission is checked on the server for every request. Hiding a button in the app is never the security.
Every change (teacher added, post, approval, timetable publish/restore) is written to an audit log.

## 2. Why Neon (and not Supabase or Firebase)
| | Neon Postgres (chosen) | Supabase | Firebase |
|---|---|---|---|
| Cost now | Free tier, already connected | Free tier; projects pause when idle | Free tier; phone auth billed per SMS |
| Phone sign-in | Keeps MiniMoth, already working | Its own SMS provider to configure | Its own, paid |
| Classes, enrollments, timetables | Relational SQL, constraints, joins | Same (Postgres) | Document store, joins are manual |
| Authorization | Server routes check every request | Row Level Security | Security rules |
| Effort | Lowest — existing `api/` functions | Re-platform | Rewrite |

One provider for data (Neon), one for sign-in (MiniMoth), one host (Vercel). No new service is required.
Files are stored in Postgres (`files.bytes`, max 3 MB each) and served only through the permission-checked
`/api/app/file` route, so there are no public file links. Neon's free plan has 0.5 GB of storage: move files to
object storage before uploads become large.

## 3. Server settings (Vercel → Settings → Environment Variables, Production)
| Name | Needed for | Secret? |
|---|---|---|
| `MINIMOTH_API_KEY` | Phone codes; also signs the login cookie | Yes |
| `DATABASE_URL` | Neon connection | Yes |
| `HOD_PHONES` | HOD per branch: `98xxxxxxxx=CMPN;97xxxxxxxx=AIDS` | Private |
| `TEACHER_PHONES` | Optional, copied into the database once; then remove it | Private |
| `GEMINI_API_KEY` | AI assistant (optional) | Yes |

After changing a setting, redeploy. `/api/auth/health` reports `configured`, `teachersConfigured`, `databaseConfigured`.

## 4. Database
Created automatically on the first API call (`api/_migrations.js`, applied once, recorded in `schema_migrations`).
Migrations only add tables; the older `users`, `rides`, `kaizen_reviews` tables are untouched
(`kaizen_reviews` gains an `owner` column).

| Table | Purpose | Key constraints / indexes |
|---|---|---|
| `accounts` | one row per verified phone; stable UUID id | `phone` unique, format `+91XXXXXXXXXX` |
| `account_roles` | `hod`, `cr` (scope = division) | PK (account, role, scope); index (role, scope) |
| `branches`, `divisions` | college structure (12 FE divisions seeded) | `divisions.code` PK |
| `enrollments` | join requests and approvals | PK (account, division); one approved and one pending per student (partial unique indexes); index (division, status) |
| `account_state` | each person's profile + planner data, versioned | PK account; optimistic `version` |
| `teacher_whitelist` | HOD-managed teacher list: name, initials, divisions/subjects, timetable permission | PK phone |
| `posts`, `post_targets`, `files` | teacher announcements/materials and their target divisions | index (division, post); file size ≤ 3 MB |
| `subjects`, `faculty` | codes from the timetable's lookup sheets | PK code |
| `timetable_versions`, `timetable_entries` | every uploaded timetable; current = latest published per division | index (term, status, published_at); (version, division, day, start) |
| `audit_log` | who did what, when | index (at) |
| `rate_limits` | abuse protection | PK key |

Measured locally with 10,000 synthetic accounts, 3,000 enrollments, 2,000 posts (in-memory Postgres, not Neon):
every hot query uses an index; `me` p50 4 ms / p95 7 ms, `feed` 7 / 11 ms, `timetable` 5 / 8 ms (300 requests each).
Lists are paginated (feed 50, audit 100, requests 300). The Neon HTTP driver opens no long-lived connections, so
there is no connection-pool exhaustion from serverless functions. Real capacity depends on Neon's plan and should be
load-tested on a staging branch before rollout (never against production without approval).

## 5. API (`/api/app/<route>`, one Vercel function)
`me` (GET/PUT) · `divisions` · `feed` · `file?id=` · `posts` (GET/POST/DELETE) · `hod-teachers` (GET/POST/DELETE) ·
`timetable-preview` · `timetable-publish` · `timetable-rollback` · `timetable-versions` · `timetable` · `join` ·
`requests` · `decide` · `hod-cr` · `hod-students` · `hod-audit`. All need sign-in; the role checks are in `api/app.js`.

Rate limits: 5 codes per number and 20 per network per 10 min; 10 Teacher-tab checks per network per 10 min;
30 posts per teacher per 10 min; 20 timetable previews per 10 min; 10 join requests per hour.

## 6. Timetable import contract (agreed format)
One row per lecture/lab/tutorial: `Division | Day | Start | End | Subject | Teacher | Room | Batch | Type`.
Several divisions in one sheet, or one sheet per division (sheet named after the division; Division column optional).
Optional `Subjects` and `Teachers` sheets define the valid codes. `.xlsx` and `.csv`; old `.xls` must be re-saved.
Checks: unknown division/subject/teacher, day names, HH:MM times, end after start, missing fields, batch 1–4,
type, duplicates, overlapping sessions in a division (time ranges, batch-aware), a teacher in two places at once.
Room clashes, empty teacher and "Check note" text are warnings. Any error blocks publishing; the current timetable
stays live. Publishing needs the preview to be confirmed; a newer publish since the preview refuses the stale one.
Every version is kept; "Restore" makes an older one current. Template: `/timetable-template.xlsx`.

## 7. Browser storage (localStorage) after this change
| Kind | Examples | Where it lives now |
|---|---|---|
| UI preferences | navigator quality, remembered tabs | browser (fine) |
| Session | none — refresh token is an HttpOnly cookie | server cookie |
| Own profile + planner data | name, division, marks, deadlines | **Neon** (`account_state`), browser keeps a cache |
| Class membership, teacher posts and files, timetables, roles | — | **Neon only** |
| Demo data (sample students, rides, challenges, events, notes, peer learning) | seed | browser only — demo |

Migration: on a person's first cloud sign-in, if their cloud copy is empty, their **own** earlier browser profile
for the same verified phone is copied once (no one else's data, no roles). Nothing else is imported: older
browser-only posts, rides, challenges etc. were never verified, so they are not moved into trusted records.
Rides, challenges, events, notes and peer learning still use browser storage (see "Not done").

## 8. Rollback
Vercel → Deployments → promote the previous deployment. The new tables can stay; nothing older depends on them.
Neon keeps a restore window for the database (length depends on the plan) — check it in the Neon console.

## 9. Tests
- `source/server-tests`: `npm install && npm test` — policy, timetable, Phase 1, roles v2 and Parent portal suites against an in-memory Postgres.
- `source/app`: `npm install && npm test` — 177 app unit tests.
- Browser end-to-end runs (two devices, HOD, teacher, class rep, students) are described in the handover message.

## 10. Manual checklist on the live site
1. Set `ADMIN_PHONES` (your HOD number) and `DATABASE_URL` for Production; redeploy; open `/api/auth/health`.
2. HOD signs in → College portal → Teacher list → add 5 teacher numbers with their divisions.
3. A teacher signs in on the **Teacher** tab → College portal → Post to classes → publish to one division.
4. A student signs in → Profile (pick division) or College portal → My class → request; HOD approves.
5. The student opens the portal on a second device → sees the post and downloads the file.
6. A student of another division does not see it.
7. Teacher portal → Timetable Schedule → upload the FE file → check preview → publish → student sees it.
8. Upload a broken file → errors listed, nothing published. Restore an older version.
9. HOD appoints a class rep; the rep approves a request for their class; HOD overrides one; audit log shows all.
