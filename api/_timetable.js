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


/* ---------------- the college's own grid layout ----------------
 * How VESIT sends timetables (e.g. "2026-27 SEM1 FE Time Table.xlsx"): one sheet, one block per day and group.
 *   A3  "MONDAY"            I3 "MONDAY"              (a second group sits to the right)
 *   B4… "D2A\n524"          division code + its room for the day
 *   A5  "8.30 AM-9.30AM"    then one row per time slot; a cell merged down two rows is a two-hour session
 *   cells: "M1\n(KD)", "ES-C(MB) 519", "CP(SU) BATCH I\n10A/\nCAD (VS) BATCH II\n501",
 *          "M1 TUT\n(AD) 521 /(KD) 522", "BWP\n(Batch-1)\n(008)\n FOP-C (Batch-2) (MG) (406)", "BREAK",
 *          "Extra lecture by teacher" (not a timetabled session: skipped, with a warning)
 * Each cell becomes ordinary rows (Division, Day, Start, End, Subject, Teacher, Room, Batch, Type), which then go
 * through exactly the same checks as the template. Problems point at the original cell (e.g. "cell F5").
 */
const DIV_RE = /^(D\d[A-Z0-9]{0,5})\b\s*([\s\S]*)$/i;
const RANGE_RE = /^\s*(\d{1,2}[.:]\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}[.:]\d{2}\s*(?:AM|PM)?)\s*$/i;
const ROOM_RE = /^(?:B\d{1,3}|\d{2,3}[A-Z]?|\d{1,2}[A-Z])$/i;
const TEACHER_RE = /^[A-Z]{1,4}$/;
function cellRef(r, c) { return `${col(c)}${r + 1}`; }
function parseRef(ref) { const m = /^([A-Z]+)(\d+)$/.exec(ref); if (!m) return null; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return { r: +m[2] - 1, c: n - 1 }; }
function rangeOf(v) {
  const m = RANGE_RE.exec(str(v));
  if (!m) return null;
  let a = parseTime(m[1]), b = parseTime(m[2]);
  if (a === null || b === null) return null;
  // "1.30-2.30" without AM/PM in an afternoon row: read as PM when it would otherwise run backwards
  if (b <= a && b + 720 > a) b += 720;
  return { start: a, end: b };
}
/** "CP(SU) BATCH I\n10A/\nCAD (VS) BATCH II\n501" → [{ subject, teacher, room, batch }], plus whether it is a tutorial. */
function parseSession(text) {
  let t = str(text).replace(/\bB\s+(\d{2,3})\b/g, 'B$1').replace(/([A-Z0-9])TUT\b/g, '$1 TUT');
  const tokens = t.match(/\([^)]*\)|BATCH\s*-?\s*(?:IV|I{1,3}|[1-4])\b|\/|[^\s()\/]+/gi) || [];
  const items = []; let cur = null, tut = false, lastSubject = '';
  const close = () => { if (cur && (cur.subject || cur.teacher || cur.room)) items.push(cur); cur = null; };
  const open = () => (cur = cur || { subject: '', teacher: '', room: '', batch: '' });
  for (const raw of tokens) {
    const paren = raw.startsWith('(') ? raw.slice(1, -1).trim() : null;
    const tok = paren !== null ? paren : raw;
    const batchM = /^BATCH\s*-?\s*(IV|I{1,3}|[1-4])$/i.exec(tok);
    if (raw === '/') { close(); continue; }
    if (batchM) { open().batch = parseBatch(batchM[1]) || ''; continue; }
    if (/^TUT$/i.test(tok)) { tut = true; continue; }
    if (paren !== null && TEACHER_RE.test(tok)) { open(); if (cur.teacher) { close(); open(); } cur.teacher = tok; continue; }
    if (ROOM_RE.test(tok) && (paren !== null || cur)) { open(); if (cur.room) { close(); open(); } cur.room = tok.toUpperCase(); continue; }
    if (paren !== null || /^\d$/.test(tok)) continue; // e.g. "(Batch-1)" handled above; a stray "1" in "M1 1 TUT"
    // a subject word: a new session starts once the current one already has a teacher or a room
    if (cur && (cur.teacher || cur.room) && cur.subject) close();
    open(); cur.subject = (cur.subject ? cur.subject + ' ' : '') + tok;
  }
  close();
  for (const it of items) { if (it.subject) lastSubject = it.subject; else it.subject = lastSubject; }
  for (let i = 0; i < items.length; i++) if (!items[i].subject && i + 1 < items.length) items[i].subject = items[i + 1].subject;
  if (items.length > 1) items.forEach((it, i) => { if (!it.batch) it.batch = String(i + 1); });
  return { items: items.filter((x) => x.subject), tut };
}
function looksLikeGrid(sheet) {
  let days = 0, ranges = 0;
  for (const r of (sheet.rows || []).slice(0, 400)) for (const c of r || []) { const v = str(c).toLowerCase(); if (DAYS[v] && v.length > 3) days++; else if (rangeOf(c)) ranges++; }
  return days >= 1 && ranges >= 2;
}
/** Grid sheet → { rows (template layout with a header row), origin: [cell ref per row], skipped } */
function fromGrid(sheet) {
  const rows = sheet.rows || [];
  const at = (r, c) => str((rows[r] || [])[c]);
  // merged cells: top-left → bottom row; covered cells are skipped
  const mergeEnd = new Map(), covered = new Set();
  for (const ref of Array.isArray(sheet.merges) ? sheet.merges : []) {
    const [a, b] = String(ref).split(':').map(parseRef); if (!a || !b) continue;
    mergeEnd.set(`${a.r},${a.c}`, b.r);
    for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) if (r !== a.r || c !== a.c) covered.add(`${r},${c}`);
  }
  const out = [['Division', 'Day', 'Start', 'End', 'Subject', 'Teacher', 'Room', 'Batch', 'Type']], origin = [null];
  let skipped = 0;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < (rows[r] || []).length; c++) {
    const day = DAYS[at(r, c).toLowerCase()];
    if (!day || at(r, c).length <= 3) continue;
    // division headers on the next row, to the right of the day label, until the first gap
    const divs = [];
    for (let k = c + 1; k < c + 40; k++) { const m = DIV_RE.exec(at(r + 1, k)); if (!m) { if (divs.length) break; continue; } divs.push({ c: k, code: m[1].toUpperCase(), room: m[2].replace(/\s+/g, ' ').trim().split(' ')[0] || '' }); }
    if (!divs.length) continue;
    // time rows below
    const slots = [];
    for (let k = r + 2; k < rows.length; k++) { const rg = rangeOf(at(k, c)); if (!rg) break; slots.push({ r: k, ...rg }); }
    for (const s of slots) for (const d of divs) {
      const key = `${s.r},${d.c}`;
      if (covered.has(key)) continue;
      const text = at(s.r, d.c);
      if (!text || /^break$/i.test(text) || /^lunch/i.test(text)) continue;
      if (/extra\s+lecture/i.test(text)) { skipped++; continue; }
      const lastRow = mergeEnd.has(key) ? mergeEnd.get(key) : s.r;
      const last = slots.find((x) => x.r === lastRow) || s;
      const { items, tut } = parseSession(text);
      const ref = cellRef(s.r, d.c);
      if (!items.length) { out.push([d.code, DAY_NAMES[day], hhmm(s.start), hhmm(last.end), '', '', '', '', '']); origin.push(ref); continue; }
      const long = last.end - s.start >= 120;
      for (const it of items) {
        const type = tut ? 'Tutorial' : items.length > 1 || long ? 'Lab' : 'Lecture';
        out.push([d.code, DAY_NAMES[day], hhmm(s.start), hhmm(last.end), it.subject.slice(0, 40), it.teacher, it.room || d.room, it.batch, type]);
        origin.push(ref);
      }
    }
  }
  return { rows: out, origin, skipped };
}

/**
 * @param sheets [{ name, rows: [[cell, ...], ...] }]  rows[0] is the header row (worksheet row 1)
 * @param known  { divisions: Set<string>, subjects?: Map<code,name>, faculty?: Map<code,name> } from the database
 */
function validate(sheetsIn, known) {
  let sheets = sheetsIn;
  const errors = [], warnings = [], entries = [];
  // Sheets in the college's grid layout are turned into template rows first; messages then name the original cell.
  const origins = new Map(), gridSheets = new Set();
  if (Array.isArray(sheets)) sheets = sheets.map((sh) => {
    if (!sh || headerMap((sh.rows || [])[0] || []).map.day !== undefined || !looksLikeGrid(sh)) return sh;
    const g = fromGrid(sh);
    origins.set(str(sh.name), g.origin); gridSheets.add(str(sh.name));
    if (g.skipped) warnings.push({ sheet: str(sh.name), row: null, message: `${g.skipped} “Extra lecture by teacher” slot${g.skipped > 1 ? 's were' : ' was'} left out (not a timetabled session).` });
    return { name: sh.name, rows: g.rows };
  });
  const orig = (sheet, row) => { const o = origins.get(str(sheet)); return o && o[row - 1] ? o[row - 1] : null; };
  const err = (sheet, row, c, message) => errors.length < 500 && errors.push(typeof row === 'string' ? { sheet, row: null, cell: row, message } : orig(sheet, row) ? { sheet, row: null, cell: orig(sheet, row), message } : { sheet, row, cell: c === null ? null : `${col(c)}${row}`, message });
  const warn = (sheet, row, message) => warnings.length < 500 && warnings.push(typeof row === 'string' ? { sheet, row, message } : orig(sheet, row) ? { sheet, row: orig(sheet, row), message } : { sheet, row, message });
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
      if (!subject) err(name, rowNo, at('subject'), gridSheets.has(name) ? 'Could not read a subject from this cell. Write it like "M1 (KD)" or "CP (SU) BATCH I 10A / CAD (VS) BATCH II 501".' : 'Subject is missing.');
      else if (subjects.size && !subjects.has(subject)) (gridSheets.has(name) ? warn(name, rowNo, `Subject "${subject}" has no full name in Campus360 yet; students will see the code.`) : err(name, rowNo, at('subject'), `Unknown subject code "${subject}" (not in the Subjects list).`));
      const teacher = str(get('teacher'));
      if (!teacher) warn(name, rowNo, 'No teacher given.');
      else if (faculty.size && !faculty.has(teacher)) (gridSheets.has(name) ? warn(name, rowNo, `Teacher initials "${teacher}" have no name in Campus360 yet.`) : err(name, rowNo, at('teacher'), `Unknown teacher code "${teacher}" (not in the Teachers list).`));
      const batch = parseBatch(get('batch'));
      if (batch === null) err(name, rowNo, at('batch'), `Batch "${str(get('batch'))}" must be empty (whole division) or 1–4.`);
      const typeRaw = str(get('type')); const type = typeRaw ? TYPES[typeRaw.toLowerCase()] : 'Lecture';
      if (!type) err(name, rowNo, at('type'), `Type "${typeRaw}" must be Lecture, Lab or Tutorial.`);
      if (noteCol >= 0 && str(r[noteCol])) warn(name, rowNo, `Has a check note: ${str(r[noteCol]).slice(0, 160)}`);
      if (errors.length === before) entries.push({ sheet: name, row: orig(name, rowNo) || rowNo, division, day, start: s, end: e, subject, teacher, room: str(get('room')).slice(0, 20), batch, type });
    }
  }
  if (tableSheets && !entries.length && !errors.length) err(null, null, null, 'The file has no sessions to publish: every timetable cell is empty.');
  if (!tableSheets && !errors.length) err(null, null, null, 'No timetable found. Upload the college timetable as it is sent (days, time slots and division columns), or the Campus360 template (sheet "Timetable").');

  // Cross-row checks: duplicates, overlaps inside a division, teacher double-booking, room clashes.
  const where = (x) => `sheet "${x.sheet}" ${typeof x.row === 'string' ? 'cell' : 'row'} ${x.row}`;
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

module.exports = { validate, parseTime, parseBatch, parseSession, fromGrid, DAY_NAMES, hhmm };
