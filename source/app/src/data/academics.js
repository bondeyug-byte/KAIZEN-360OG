// Academic structure: years → branches → divisions. PLACEHOLDER DIVISIONS: the team will send the college's real
// list; until then every year/branch has two divisions, named like the college's own example "D1ADA"
// (D + year + branch code + letter). Edit DIVISIONS below — everything else (targeting, rosters, attendance,
// notes filters) reads from here.
export const YEARS = [{ id: '1', label: '1st Year' }, { id: '2', label: '2nd Year' }, { id: '3', label: '3rd Year' }, { id: '4', label: '4th Year' }]
export const BRANCHES = [
  { id: 'CS', label: 'CS', code: 'CS' }, { id: 'IT', label: 'IT', code: 'IT' }, { id: 'AIDS', label: 'AI and DS', code: 'AD' },
  { id: 'ENTC', label: 'ENTC', code: 'EX' }, { id: 'ECS', label: 'ECS', code: 'EC' }, { id: 'AURO', label: 'AURO', code: 'AU' },
]
export const DIVISIONS_PLACEHOLDER = true
export const DIVISIONS = {}
for (const y of YEARS) for (const b of BRANCHES) DIVISIONS[`${y.id}:${b.id}`] = ['A', 'B'].map((l) => `D${y.id}${b.code}${l}`)

// Real FE 2026-27 divisions from the college timetable (D1 = AIDS/ECS, D2 = Computer, D3 = AURO, D4 = EXTC, D5 = IT).
// Used for real (phone-verified) accounts. Other years are not configured yet, so none are offered for them.
// The placeholder DIVISIONS above stay for the demo accounts and their sample data.
export const REAL_DIVISIONS = { '1:AIDS': ['D1ADA', 'D1ADB'], '1:ECS': ['D1EC'], '1:CS': ['D2A', 'D2B', 'D2C'], '1:AURO': ['D3'], '1:ENTC': ['D4A', 'D4B'], '1:IT': ['D5A', 'D5B', 'D5C'] }
export const divisionsFor = (year, branch, real = false) => (real ? REAL_DIVISIONS : DIVISIONS)[`${year}:${branch}`] || []
export const allDivisions = () => [...new Set([...Object.values(DIVISIONS).flat(), ...Object.values(REAL_DIVISIONS).flat()])]
/** Parse a division id back to its year and branch (null if it isn't configured). */
export function divisionInfo(div) {
  for (const [k, list] of [...Object.entries(DIVISIONS), ...Object.entries(REAL_DIVISIONS)]) if (list.includes(div)) { const [year, branch] = k.split(':'); return { year, branch, div, label: `${YEARS.find((y) => y.id === year).label} · ${BRANCHES.find((b) => b.id === branch).label} · ${div}` } }
  return null
}
export const yearLabel = (id) => YEARS.find((y) => y.id === id)?.label || ''
export const branchLabel = (id) => BRANCHES.find((b) => b.id === id)?.label || ''

/** Roll numbers: letters/digits/hyphens, 2–20 chars. Unique within the same year + branch cohort. */
export const ROLL_RE = /^[A-Za-z0-9][A-Za-z0-9-]{1,19}$/
export function validateAcademic(p, profiles, selfId, real = false) {
  const e = {}
  if (!YEARS.some((y) => y.id === p.year)) e.year = 'Choose your academic year.'
  if (!BRANCHES.some((b) => b.id === p.branchId)) e.branchId = 'Choose your branch.'
  if (!divisionsFor(p.year, p.branchId, real).includes(p.division)) e.division = real && !divisionsFor(p.year, p.branchId, true).length ? 'Only first-year divisions are set up so far.' : 'Choose your division.'
  const roll = (p.roll || '').trim()
  if (!ROLL_RE.test(roll)) e.roll = 'Enter your roll number (letters, digits or hyphens).'
  else if (Object.values(profiles || {}).some((o) => o.id !== selfId && o.year === p.year && o.branchId === p.branchId && (o.roll || '').toLowerCase() === roll.toLowerCase())) e.roll = 'That roll number is already registered in your year and branch.'
  return e
}
export const hasAcademicIdentity = (p) => !!(p && p.year && p.branchId && p.division && p.roll)

// Subjects for attendance and notes. First-year subjects are the ones already used by the app's planner and
// timetable; other years are left for the team to configure (teachers can type a subject name until then).
export const SUBJECTS = {
  '1': ['Engineering Mathematics I', 'Engineering Physics', 'Engineering Chemistry', 'Programming in C', 'Basic Electrical Engineering', 'Engineering Graphics', 'Python Programming', 'Communication Skills'],
}
export const subjectsFor = (year) => SUBJECTS[year] || []

// Which weekly timetable a division follows (placeholder mapping to the app's existing sample timetables).
export const DIVISION_TIMETABLE = { D1CSA: 'FE-A', D1ITA: 'FE-A', D1ADA: 'FE-B', D1ADB: 'FE-B', D1EXA: 'FE-C' }
