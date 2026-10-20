// Timetable import validation (pure functions, no database). Used by api/app.js and the tests.
// Contract (agreed with the college): one row per lecture/lab/tutorial with columns
//   Division | Day | Start | End | Subject | Teacher | Room | Batch | Type
// Several divisions per sheet, or one sheet per division (sheet named after the division, Division column optional).
// Optional lookup sheets "Subjects" (code, name) and "Teachers" (initials, name, dept) define valid codes.
// Nothing is silently dropped: every problem is an error (blocks publishing) or a warning (shown in the preview).

const DAYS = { mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TYPES = { lecture: 'Lecture', lab: 'Lab', practical: 'Lab', tutorial: 'Tutorial', tut: 'Tutorial' };
const HEADERS = {
  division: ['division', 'div', 'class', 'division code'],
  day: ['day'],
  start: ['start', 'start time', 'start (hh:mm)', 'from'],
  end: ['end', 'end time', 'end (hh:mm)', 'to'],
  subject: ['subject', 'subject code', 'course'],
  teacher: ['teacher', 'teacher code', 'faculty', 'initials'],
  room: ['room', 'room no', 'venue'],
  batch: ['batch'],
  type: ['type', 'session type'],
};
const IGNORED = /^check note|^note|^remarks?$/i;
const MAX_ROWS = 5000;

const col = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const str = (v) => (v === null || v === undefined ? '' : String(v)).trim();
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function parseTime(v) {
  if (typeof v === 'number' && v >= 0 && v < 1) return Math.round(v * 1440);
  const s = str(v).toUpperCase().replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?(AM|PM)?$/);
  if (!m) return null;
  let h = +m[1]; const mi = +m[2];
  if (mi > 59) return null;
  if (m[3]) { if (h < 1 || h > 12) return null; if (m[3] === 'PM' && h !== 12) h += 12; if (m[3] === 'AM' && h === 12) h = 0; }
  if (h > 23) return null;
  return h * 60 + mi;
}
function parseBatch(v) {
  const s = str(v).toUpperCase().replace(/^BATCH\s*-?\s*/, '');
  if (!s) return '';
  const roman = { I: '1', II: '2', III: '3', IV: '4' };
  if (roman[s]) return roman[s];
  return /^[1-4]$/.test(s) ? s : null;
}
function headerMap(row) {
  const map = {}; const unknown = [];
  row.forEach((h, i) => {
    const k = str(h).toLowerCase();
    if (!k) return;
    const field = Object.keys(HEADERS).find((f) => HEADERS[f].includes(k));
    if (field && map[field] === undefined) map[field] = i;
    else if (!field && !IGNORED.test(k)) unknown.push(str(h));
  });
  return { map, unknown };
}

/**
 * @param sheets [{ name, rows: [[cell, ...], ...] }]  rows[0] is the header row (worksheet row 1)
 * @param known  { divisions: Set<string>, subjects?: Map<code,name>, faculty?: Map<code,name> } from the database
 */
function validate(sheets, known) {
  const errors = [], warnings = [], entries = [];
  const err = (sheet, row, c, message) => errors.length < 500 && errors.push({ sheet, row, cell: c === null ? null : `${col(c)}${row}`, message });
  const warn = (sheet, row, message) => warnings.length < 500 && warnings.push({ sheet, row, message });
  if (!Array.isArray(sheets) || !sheets.length) return { errors: [{ sheet: null, row: null, cell: null, message: 'The file has no worksheets.' }], warnings, entries, divisions: [], lookups: {} };

  // Lookup sheets from the file take priority over the database lists.
  const lookup = (name) => sheets.find((s) => str(s.name).toLowerCase() === name);
  const readLookup = (sheet, width) => {
    const out = new Map();
    (sheet.rows || []).slice(1).forEach((r, i) => {
      const code = str(r[0]); if (!code) return;
      if (out.has(code)) err(sheet.name, i + 2, 0, `Code "${code}" is listed twice.`);
      out.set(code, r.slice(1, width).map(str));
    });
    return out;
  };
  const subjSheet = lookup('subjects'), teachSheet = lookup('teachers');
  const subjects = subjSheet ? readLookup(subjSheet, 2) : new Map([...(known.subjects || new Map())].map(([c, n]) => [c, [n]]));
  const faculty = teachSheet ? readLookup(teachSheet, 3) : new Map([...(known.faculty || new Map())].map(([c, n]) => [c, [n]]));

  const skip = new Set(['subjects', 'teachers', 'divisions', 'read me', 'readme', 'lists']);
  let tableSheets = 0, total = 0;
  for (const sheet of sheets) {
    const name = str(sheet.name);
    if (skip.has(name.toLowerCase())) continue;
    const rows = sheet.rows || [];
    const nonEmpty = rows.filter((r) => (r || []).some((c) => str(c)));
    if (!nonEmpty.length) continue;
    const { map, unknown } = headerMap(rows[0] || []);
    const sheetDivision = known.divisions.has(name.toUpperCase()) ? name.toUpperCase() : null;
    const missing = ['day', 'start', 'end', 'subject'].filter((f) => map[f] === undefined);
    if (map.division === undefined && !sheetDivision) missing.unshift('division');
    if (missing.length) { err(name, 1, null, `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Use the Campus360 template headers.`); continue; }
    tableSheets++;
    if (unknown.length) warn(name, 1, `Ignored column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`);
    const noteCol = (rows[0] || []).findIndex((h) => /^check note/i.test(str(h)));
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || []; const rowNo = i + 1;
      if (!r.some((c) => str(c))) continue;
      if (++total > MAX_ROWS) { err(name, rowNo, null, `Too many rows (limit ${MAX_ROWS}).`); break; }
      const get = (f) => (map[f] === undefined ? '' : r[map[f]]);
      const at = (f) => (map[f] === undefined ? null : map[f]);
      const before = errors.length;
      const division = str(get('division')).toUpperCase() || sheetDivision || '';
      if (!division) err(name, rowNo, at('division'), 'Division is missing.');
      else if (!known.divisions.has(division)) err(name, rowNo, at('division'), `Unknown division "${division}".`);
      const dayRaw = str(get('day')); const day = DAYS[dayRaw.toLowerCase()];
      if (!dayRaw) err(name, rowNo, at('day'), 'Day is missing.'); else if (!day) err(name, rowNo, at('day'), `"${dayRaw}" is not a day (use Monday … Saturday).`);
      const s = parseTime(get('start')), e = parseTime(get('end'));
      if (s === null) err(name, rowNo, at('start'), `Start time "${str(get('start'))}" is not a valid time (use HH:MM, e.g. 08:30).`);
      if (e === null) err(name, rowNo, at('end'), `End time "${str(get('end'))}" is not a valid time (use HH:MM, e.g. 09:30).`);
      if (s !== null && e !== null && e <= s) err(name, rowNo, at('end'), 'End time must be later than start time.');
      const subject = str(get('subject'));
      if (!subject) err(name, rowNo, at('subject'), 'Subject is missing.');
      else if (subjects.size && !subjects.has(subject)) err(name, rowNo, at('subject'), `Unknown subject code "${subject}" (not in the Subjects list).`);
      const teacher = str(get('teacher'));
      if (!teacher) warn(name, rowNo, 'No teacher given.');
      else if (faculty.size && !faculty.has(teacher)) err(name, rowNo, at('teacher'), `Unknown teacher code "${teacher}" (not in the Teachers list).`);
      const batch = parseBatch(get('batch'));
      if (batch === null) err(name, rowNo, at('batch'), `Batch "${str(get('batch'))}" must be empty (whole division) or 1–4.`);
      const typeRaw = str(get('type')); const type = typeRaw ? TYPES[typeRaw.toLowerCase()] : 'Lecture';
      if (!type) err(name, rowNo, at('type'), `Type "${typeRaw}" must be Lecture, Lab or Tutorial.`);
      if (noteCol >= 0 && str(r[noteCol])) warn(name, rowNo, `Has a check note: ${str(r[noteCol]).slice(0, 160)}`);
      if (errors.length === before) entries.push({ sheet: name, row: rowNo, division, day, start: s, end: e, subject, teacher, room: str(get('room')).slice(0, 20), batch, type });
    }
  }
  if (!tableSheets && !errors.length) err(null, null, null, 'No timetable sheet found. Use the Campus360 template (sheet "Timetable").');

  // Cross-row checks: duplicates, overlaps inside a division, teacher double-booking, room clashes.
  const where = (x) => `sheet "${x.sheet}" row ${x.row}`;
  const byDay = new Map();
  for (const x of entries) { if (!byDay.has(x.day)) byDay.set(x.day, []); byDay.get(x.day).push(x); }
  for (const list of byDay.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (!(a.start < b.end && b.start < a.end)) continue;
      const span = `${DAY_NAMES[a.day]} ${hhmm(Math.max(a.start, b.start))}`;
      if (a.division === b.division && a.start === b.start && a.end === b.end && a.subject === b.subject && a.teacher === b.teacher && a.batch === b.batch) {
        err(b.sheet, b.row, null, `Duplicate of ${where(a)}.`); continue;
      }
      if (a.division === b.division && (!a.batch || !b.batch || a.batch === b.batch)) {
        err(b.sheet, b.row, null, `Overlaps ${where(a)} for ${a.division}${a.batch && b.batch ? ` batch ${a.batch}` : ''} (${span}).`);
      }
      if (a.teacher && a.teacher === b.teacher && !(a.division === b.division && a.subject === b.subject && a.room === b.room)) {
        err(b.sheet, b.row, null, `Teacher ${a.teacher} is also teaching ${a.division} at ${where(a)} (${span}).`);
      }
      if (a.room && a.room === b.room && a.division !== b.division) warn(b.sheet, b.row, `Room ${a.room} is also used by ${a.division} at ${where(a)} (${span}).`);
    }
  }
  return {
    errors, warnings, entries,
    divisions: [...new Set(entries.map((x) => x.division))].sort(),
    lookups: { subjects: [...subjects].map(([c, v]) => [c, v[0] || '']), faculty: [...faculty].map(([c, v]) => [c, v[0] || '', v[1] || '']) },
  };
}

module.exports = { validate, parseTime, parseBatch, DAY_NAMES, hhmm };
