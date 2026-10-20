// Timetable import validation (api/_timetable.js) — pure unit tests, no database.
const assert = require('assert');
const { validate } = require(require('path').join(__dirname, '../../api/_timetable'));
const known = { divisions: new Set(['D2A', 'D2B', 'D1ADA']) };
const H = ['Division', 'Day', 'Start (HH:MM)', 'End (HH:MM)', 'Subject', 'Teacher', 'Room', 'Batch', 'Type'];
const lk = [{ name: 'Subjects', rows: [['Code', 'Name'], ['M1', 'Maths'], ['CP', 'C'], ['BEE', 'BEE']] }, { name: 'Teachers', rows: [['Code', 'Name'], ['KD', 'K'], ['AD', 'A'], ['RS', 'R']] }];
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS', name); };
t('valid rows, batch-split labs at the same time are allowed', () => {
  const r = validate([{ name: 'Timetable', rows: [H, ['D2A', 'Monday', '13:30', '15:30', 'CP', 'AD', '406', '1', 'Lab'], ['D2A', 'Monday', '13:30', '15:30', 'BEE', 'RS', '109', '2', 'Lab'], ['D2A', 'Mon', '8.30', '9:30 AM', 'M1', 'KD', '', '', '']] }, ...lk], known);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors)); assert.equal(r.entries.length, 3);
});
t('every problem reported with sheet and cell; nothing silently dropped', () => {
  const rows = [H, ['D9X', 'Monday', '08:30', '09:30', 'M1', 'KD'], ['D2A', 'Funday', '08:30', '09:30', 'M1', 'KD'], ['D2A', 'Tuesday', '10:30', '09:30', 'M1', 'KD'], ['D2A', 'Tuesday', '11:30', '12:30', '', 'KD'],
    ['D2A', 'Wednesday', '8:30', '9:30', 'M1', 'KD'], ['D2A', 'Wednesday', '09:00', '10:00', 'CP', 'AD'], ['D1ADA', 'Wednesday', '08:30', '09:30', 'BEE', 'KD'], ['D2A', 'Thursday', '8.75', '9:30', 'ZZ', 'QQ', '', '7', 'Seminar']];
  const msgs = validate([{ name: 'Timetable', rows }, ...lk], known).errors.map((e) => `${e.cell || ''} ${e.message}`).join('\n');
  for (const re of [/A2 Unknown division "D9X"/, /B3 "Funday" is not a day/, /D4 End time must be later/, /E5 Subject is missing/, /Overlaps sheet "Timetable" row 6/, /Teacher KD is also teaching D2A/, /Start time "8.75"/, /Unknown subject code "ZZ"/, /Unknown teacher code "QQ"/, /Batch "7"/, /Type "Seminar"/]) assert.match(msgs, re);
});
t('one sheet per division (Division column optional)', () => {
  const r = validate([{ name: 'D2B', rows: [['Day', 'Start', 'End', 'Subject'], ['Friday', '08:30', '09:30', 'M1']] }, ...lk], known);
  assert.equal(r.errors.length, 0); assert.deepEqual(r.divisions, ['D2B']);
});
t('missing columns and empty files are errors', () => {
  assert.match(validate([{ name: 'Timetable', rows: [['Day', 'Subject'], ['Monday', 'M1']] }], known).errors[0].message, /Missing columns/);
  assert.match(validate([], known).errors[0].message, /no worksheets/);
});
console.log(`${n} passed`);
