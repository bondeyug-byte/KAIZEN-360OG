// Unit tests for the central permission function (api/_policy.js). No database needed.
const assert = require('assert');
const { can, allowedDivisions } = require(require('path').join(__dirname, '../../api/_policy'));
const divisions = new Map([['D2A', { code: 'D2A', branch_code: 'CMPN' }], ['D2B', { code: 'D2B', branch_code: 'CMPN' }], ['D1ADA', { code: 'D1ADA', branch_code: 'AIDS' }], ['D5A', { code: 'D5A', branch_code: 'INFT' }]]);
const mk = (o) => ({ account: { id: 'x' }, base: 'student', hodBranches: [], teacher: null, crDivisions: [], enrollment: null, divisions, ...o });
const hodCS = mk({ base: 'hod', hodBranches: ['CMPN'] });
const teacher = mk({ base: 'teacher', teacher: { divisions: ['D2A'], canPublishTimetable: true } });
const teacherNoTT = mk({ base: 'teacher', teacher: { divisions: ['D2A'], canPublishTimetable: false } });
const teacherNone = mk({ base: 'teacher', teacher: { divisions: [], canPublishTimetable: true } });
const student = mk({ enrollment: { division_code: 'D2A' } });
const cr = mk({ enrollment: { division_code: 'D2A' }, crDivisions: ['D2A'] });
const crMoved = mk({ enrollment: { division_code: 'D2B' }, crDivisions: ['D2A'] }); // stale CR row after a move
const newbie = mk({});
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS', name); };
t('HOD acts only inside their branch', () => {
  for (const a of ['join.decide', 'join.override', 'enrollment.revoke', 'cr.assign', 'cr.remove', 'cr.decide', 'post.create', 'roster.view', 'timetable.publish', 'content.view']) {
    assert.ok(can(hodCS, a, { division: 'D2A' }), a); assert.ok(!can(hodCS, a, { division: 'D1ADA' }), a + ' other branch');
  }
  assert.ok(can(hodCS, 'teacher.manage', { branch: 'CMPN' })); assert.ok(!can(hodCS, 'teacher.manage', { branch: 'AIDS' }));
  assert.ok(can(hodCS, 'hod.portal')); assert.ok(!can(hodCS, 'join.request'));
});
t('teacher acts only on assigned divisions', () => {
  assert.ok(can(teacher, 'join.decide', { division: 'D2A' })); assert.ok(!can(teacher, 'join.decide', { division: 'D2B' }));
  assert.ok(can(teacher, 'cr.decide', { division: 'D2A' })); assert.ok(!can(teacher, 'cr.assign', { division: 'D2A' }));
  assert.ok(!can(teacher, 'teacher.manage', { branch: 'CMPN' })); assert.ok(!can(teacher, 'hod.portal')); assert.ok(can(teacher, 'instruction.receive'));
  assert.ok(can(teacher, 'timetable.publish', { division: 'D2A' })); assert.ok(!can(teacherNoTT, 'timetable.publish', { division: 'D2A' }));
  assert.deepStrictEqual(allowedDivisions(teacherNone, 'post.create'), []);
});
t('class rep: own division only, limited tools', () => {
  assert.ok(can(cr, 'join.decide', { division: 'D2A' })); assert.ok(!can(cr, 'join.decide', { division: 'D2B' }));
  assert.ok(can(cr, 'notice.create', { division: 'D2A' })); assert.ok(can(cr, 'reminder.create', { division: 'D2A' }));
  for (const a of ['post.create', 'cr.decide', 'cr.assign', 'timetable.upload', 'timetable.publish', 'enrollment.revoke', 'instruction.receive']) assert.ok(!can(cr, a, { division: 'D2A' }), a);
  assert.ok(!can(crMoved, 'join.decide', { division: 'D2A' }), 'CR who left the class loses CR powers');
});
t('student: request to join, view only own class, request CR once', () => {
  assert.ok(can(newbie, 'join.request')); assert.ok(!can(newbie, 'content.view', { division: 'D2A' }));
  assert.ok(can(student, 'content.view', { division: 'D2A' })); assert.ok(!can(student, 'content.view', { division: 'D2B' }));
  assert.ok(can(student, 'cr.request', { division: 'D2A' })); assert.ok(!can(cr, 'cr.request', { division: 'D2A' }));
  for (const a of ['join.decide', 'post.create', 'notice.create', 'roster.view', 'timetable.upload']) assert.ok(!can(student, a, { division: 'D2A' }), a);
});
t('unknown division, unknown action, missing user → denied', () => {
  assert.ok(!can(hodCS, 'join.decide', { division: 'D9Z' })); assert.ok(!can(hodCS, 'drop.tables', { division: 'D2A' })); assert.ok(!can(null, 'join.request'));
});
console.log(`${n} passed`);
