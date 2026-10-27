// The ONE place that decides who may do what. Every API route calls can(); nothing else checks roles.
//
// `who` is built on the server from the verified phone + database (api/_access.js), never from the request:
//   base           'hod' | 'teacher' | 'parent' | 'student'   (HOD > teacher > parent > student)
//   parentOf       student account ids this phone is an approved parent/guardian of
//   hodBranches    branches this HOD heads (from HOD_PHONES → hod_assignments)
//   teacher        { divisions: [codes], canPublishTimetable } for active whitelisted teachers
//   crDivisions    divisions where this student is an active class representative
//   siDivisions / ciDivisions   divisions where this student is the sports / cultural incharge
//   enrollment     { division_code, year_id } — the student's active class, or null
//   divisions      Map(code → { code, branch_code, year_id })
//
// Resources: { division: 'D2A' } or { branch: 'CMPN' }.

function can(who, action, res = {}) {
  if (!who || !who.account) return false;
  const d = res.division !== undefined ? who.divisions.get(res.division) : null;
  if (res.division !== undefined && !d) return false; // unknown division → nobody may act on it
  const branch = d ? d.branch_code : res.branch;

  const isHod = who.base === 'hod';
  const isTeacher = who.base === 'teacher';
  const isStudent = who.base === 'student';
  const hodOf = (b) => isHod && !!b && who.hodBranches.includes(b);
  const teaches = (code) => isTeacher && who.teacher.divisions.includes(code);
  const enrolledIn = (code) => isStudent && !!who.enrollment && who.enrollment.division_code === code;
  const crOf = (code) => enrolledIn(code) && who.crDivisions.includes(code); // a CR must still be in the class
  const siOf = (code) => enrolledIn(code) && (who.siDivisions || []).includes(code); // sports incharge of their own class
  const ciOf = (code) => enrolledIn(code) && (who.ciDivisions || []).includes(code); // cultural incharge of their own class
  const staff = hodOf(branch) || teaches(d && d.code);

  switch (action) {
    // joining a class
    case 'join.request': return isStudent;
    case 'join.view':
    case 'join.decide': return hodOf(branch) || teaches(d && d.code) || crOf(d && d.code);
    // changing division: an enrolled student asks; only the target class teacher or the HOD decides (never a CR)
    case 'transfer.request': return isStudent && !!who.enrollment;
    case 'transfer.decide': return hodOf(branch) || teaches(d && d.code);
    case 'join.override':
    case 'enrollment.revoke': return hodOf(branch);
    // class representatives
    case 'cr.request': return enrolledIn(d && d.code) && !who.crDivisions.includes(d.code);
    case 'cr.decide': return hodOf(branch) || teaches(d && d.code);
    case 'cr.assign':
    case 'cr.remove': return hodOf(branch);
    case 'roster.view': return hodOf(branch) || teaches(d && d.code) || crOf(d && d.code);
    // content
    case 'post.create': return hodOf(branch) || teaches(d && d.code); // announcements, materials, files
    case 'notice.create':
    case 'reminder.create': return hodOf(branch) || teaches(d && d.code) || crOf(d && d.code);
    case 'content.view': return hodOf(branch) || teaches(d && d.code) || enrolledIn(d && d.code);
    // timetables
    case 'timetable.upload': return isHod || (isTeacher && who.teacher.canPublishTimetable);
    case 'timetable.publish': return hodOf(branch) || (teaches(d && d.code) && who.teacher.canPublishTimetable);
    // HOD tools
    case 'teacher.manage':
    case 'teacher.assign':
    case 'instruction.send':
    case 'audit.view': return hodOf(branch);
    case 'hod.portal': return isHod;
    case 'instruction.receive': return isTeacher;
    // parent portal and the records it reads (parents only ever read; see api/_records.js)
    case 'parent.link.request': return enrolledIn(d && d.code);
    case 'parent.link.decide': return hodOf(branch) || teaches(d && d.code);
    case 'parent.read': return who.base === 'parent' && !!res.student && (who.parentOf || []).includes(res.student);
    case 'attendance.record':
    case 'marks.manage':
    case 'alert.draft': return hodOf(branch) || teaches(d && d.code);
    case 'alert.publish':
    case 'event.manage':
    case 'settings.manage': return hodOf(branch);
    // portal upgrade (migration 7). Roles never overlap implicitly: a CR who is not also SI cannot post sports updates.
    case 'publish.academic': return staff; // assignments, notices, CA/tutorial/exam dates, study material, announcements
    case 'publish.sports': return staff || siOf(d && d.code);
    case 'publish.cultural': return staff || ciOf(d && d.code);
    case 'submission.create': return enrolledIn(d && d.code);
    case 'submission.view': return staff;
    case 'calendar.view': return staff || enrolledIn(d && d.code);
    case 'role.request': return enrolledIn(d && d.code);
    case 'role.decide':
    case 'role.assign':
    case 'role.remove': return staff; // class teacher (assigned classes) or the branch HOD
    case 'branch.view':
    case 'division.provision':
    case 'syllabus.manage': return hodOf(branch);
    case 'club.provision': return isHod; // an HOD appoints club/council heads
    default: return false;
  }
}

/** Division codes (among all known) for which `action` is allowed. */
const allowedDivisions = (who, action) => [...who.divisions.keys()].filter((code) => can(who, action, { division: code }));

module.exports = { can, allowedDivisions };
