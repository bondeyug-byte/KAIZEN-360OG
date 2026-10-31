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
// The college's own layout (synthetic cells in the same shapes as the real FE timetable).
const grid = (cells, merges = []) => {
  const rows = [['VES Institute of Technology'], ['FE Timetable SEM-I GROUP A'], ['MONDAY  '], ['', 'D2A \n524', 'D2B   523'],
    ['8.30 AM-9.30AM'], ['9.30 AM-10.30AM'], ['10.30 AM-11.30AM'], ['11.30 AM-12.30PM'], ['12.30 PM-1.30PM', 'BREAK'], ['1.30 PM-2.30PM'], ['2.30 PM-3.30PM']];
  for (const [ref, v] of Object.entries(cells)) { const c = ref.charCodeAt(0) - 65, r = +ref.slice(1) - 1; rows[r] = rows[r] || []; rows[r][c] = v; }
  return [{ name: 'Sheet1', rows: rows.map((r) => Array.from(r, (x) => x ?? '')), merges }];
};
t('college grid: lectures, room overrides, merged two-hour labs, batch splits and tutorials', () => {
  const r = validate(grid({ B5: 'M1\n(KD)', C5: 'BEE (RS) 519', B6: 'CP(AD) BATCH I\n10A/\nBEE (RS) BATCH II\n109', C7: 'M1 TUT\n(KD) 523/(SS) 518', B8: 'Extra lecture by teacher', C10: 'BWP\n(Batch-1)\n(008)\n CP     (Batch-2)   (AD)   (406)' }, ['B6:B7', 'B9:C9', 'C10:C11']), known);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  const s = r.entries.map((e) => [e.row, e.division, e.start, e.end, e.subject, e.teacher, e.room, e.batch, e.type].join(' '));
  assert.deepEqual(s, ['B5 D2A 510 570 M1 KD 524  Lecture', 'C5 D2B 510 570 BEE RS 519  Lecture',
    'B6 D2A 570 690 CP AD 10A 1 Lab', 'B6 D2A 570 690 BEE RS 109 2 Lab', 'C7 D2B 630 690 M1 KD 523 1 Tutorial', 'C7 D2B 630 690 M1 SS 518 2 Tutorial',
    'C10 D2B 810 930 BWP  008 1 Lab', 'C10 D2B 810 930 CP AD 406 2 Lab']);
  assert.ok(r.warnings.some((w) => /Extra lecture/.test(w.message)));
});
t('college grid: problems point at the original cell; an empty grid is refused', () => {
  const r = validate(grid({ B5: 'M1 (KD)', B6: 'M1 (KD)', C6: 'CP (KD)' }), known);
  assert.ok(r.errors.some((e) => e.cell === 'C6' && /Teacher KD is also teaching D2A at sheet "Sheet1" cell B6/.test(e.message)), JSON.stringify(r.errors));
  assert.match(validate(grid({}), known).errors[0].message, /no sessions/);
});
console.log(`${n} passed`);
