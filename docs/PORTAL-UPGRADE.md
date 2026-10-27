# Portal upgrade (migration 7): profile set-up, academic workflow, class roles, HOD branch view, clubs

Google sign-in and the emailed 6-digit code are unchanged. Everything below runs on the college server
(`api/app.js` → `api/_portal.js`), is checked by `can()` in `api/_policy.js` (or the club permission check), and is
written to the audit log.

## Migration 7 (additive; runs automatically on the first request after deploy)

| Change | Existing data |
|---|---|
| `academic_years`: SE/TE/BE 2026-27 (levels 2–4) | FE row unchanged. **No SE/TE/BE divisions are created**: HODs add them. |
| `divisions.created_by`, `divisions.source` | Existing rows get `source = 'seed'`. |
| `account_state.setup`, `setup_at` | Empty until each person completes "Set up your profile". |
| `posts`: kind check widened (assignment, notice, exam, ca, tutorial, practical, other, sports, cultural); `subject`, `due_at`, `event_date`, `publish_at`, `status` (draft/published/archived/cancelled), `updated_at` | Existing posts keep their kind and become `status = 'published'`. |
| `assignment_submissions` (new) | — |
| `cr_assignments.position` (male/female) + exclusion constraint (one active CR per position, deferred so "replace" is one change) | Existing CRs keep their rows with no position; the teacher sets one. |
| `cr_requests.role` (cr/si/ci) | Existing requests become `role = 'cr'`. |
| `class_roles` (SI, CI; one active each per class, same kind of constraint) | — |
| `clubs`, `club_members`, `club_announcements`, `event_registrations` (new) | — |
| `college_events`: `branch_code` may be empty for club events (owner check: branch or club); status adds `archived`; organizer, contact, audience, registration mode/link/capacity/deadline/count, poster, instructions, terms, layout | Existing branch events unchanged (`reg_mode = 'none'`, `layout = 'card'`). |

Nothing is dropped or deleted. Re-running migration 7 is safe (checked on a database with migrations 1–6 and data).

## Authorization (server)

| Action | Student | CR | SI | CI | Teacher | HOD |
|---|---|---|---|---|---|---|
| View own class feed | Yes | Yes | Yes | Yes | Authorized classes | Authorized branch |
| Publish sports updates | No | Only if also SI | Own class | No | Assigned classes | Own branch |
| Publish cultural updates | No | Only if also CI | No | Own class | Assigned classes | Own branch |
| Manage academic assignments | No | No | No | No | Assigned classes | Own branch |
| Approve/remove class roles | No | No | No | No | Assigned classes | Own branch |
| View branch-wide records | No | No | No | No | No | Own branch |

- New policy actions: `publish.academic`, `publish.sports`, `publish.cultural`, `submission.create`, `submission.view`,
  `calendar.view`, `role.request`, `role.decide|assign|remove`, `branch.view`, `division.provision`, `syllabus.manage`,
  `club.provision`. Roles never overlap implicitly: CR + SI gets exactly the union.
- Students and parents only ever see published (or cancelled) items whose publish time has passed: drafts,
  archived and scheduled items (and their attachments) are hidden in the feed, the class items, the calendar,
  the parent record and file downloads.
- A hand-in file is downloadable only by the student and the teachers/HOD of that class.
- Clubs: an HOD creates a club and appoints its head (college account). The head invites teammates by college
  email; the invitee accepts with their own signed-in account. Permissions: drafts, posters, publish,
  registration details, view registrations, announcements, manage team, archive/cancel. Only the head grants
  "manage team". Membership and permissions are read from the database on every request, so removal is immediate.
  Organisers see registrants' names and masked emails only, never classes, rolls, attendance or marks.
- Profile set-up is validated on the server and stored apart from the synced profile; editing it never changes a
  role or a class. An enrolled student's branch/year must match the verified class (otherwise: division-change request).
- CR positions are chosen by the teacher; nothing reads the student's gender to decide them.

## Blockers and data the college must supply

1. **SE, TE and BE division lists** for every branch (only FE 2026-27 came from a verified timetable). HODs add them
   in HOD portal → Divisions & syllabus. Until then those students can complete set-up but can't join a class.
2. **Unconfirmed FE division names**: D2C, D5A, D5C (timetable header cut off). The HOD confirms or corrects them.
3. **Syllabus link** per branch (official URL). The banner says "not added yet" until the HOD sets it.
4. **Attendance threshold** per branch, for defaulter lists (not assumed).
5. **Club/council list and heads** (college accounts), entered by an HOD.
6. Messaging/chat is unchanged and is not described as end-to-end encrypted.

## Decisions to confirm

- Any HOD may create clubs (clubs are college-wide). If a separate admin should do this, add that role.
- One SI and one CI per class; two CRs (male CR, female CR). Change the constraints if the college wants more.
- Students who change division lose SI/CI/CR roles in the old class (same as CR before).
