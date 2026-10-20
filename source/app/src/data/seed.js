// Fictional demo data. Every record carries `demo: true`.
// People, phone numbers, emails and map pins are invented and labelled as such in the UI.
import { DEMO_GRADE_SCALE, DEFAULT_ACADEMIC_SETTINGS, checkTarget, RESULT } from '../lib/academic.js'
import { pin, CAMPUS_CENTER } from './config.js'
import { stationByName } from '../lib/journey.js'
import { makeMenu } from './menus.js'

const iso = (now, minutes) => new Date(now.getTime() + minutes * 60000).toISOString()
const H = 60, DAY = 1440
// Campus-hour times: every sample time is a real IST clock time (08:00–20:00) on a day relative to today.
const IST = 330
const istParts = (now) => { const d = new Date(now.getTime() + IST * 60000); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), mins: d.getUTCHours() * 60 + d.getUTCMinutes(), wd: d.getUTCDay() } }
/** ISO time for IST date (today + dayOffset) at hh:mm. */
export const at = (now, dayOffset, hhmm) => { const p = istParts(now); const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(p.y, p.m, p.d + dayOffset, h, m) - IST * 60000).toISOString() }
const hm = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
/** Next campus-hours slot at hh:mm that is still in the future (today, else tomorrow). */
const nextAt = (now, hhmm) => { const t = at(now, 0, hhmm); return Date.parse(t) > now.getTime() + 30 * 60000 ? t : at(now, 1, hhmm) }

export const DEMO_USERS = ['u_aarav', 'u_diya', 'u_kabir', 'u_ishaan', 'u_tanvi', 'u_sneha', 'u_t_meera', 'u_t_arjun', 'u_admin', 'u_org']

function profiles() {
  const p = (id, name, classId, branch, interests, subjects, extra = {}) => ({
    id, name, classId, branch, year: classId.startsWith('SE') ? '2' : '1', interests, subjects,
    phone: null, phoneVerified: false, authMethod: 'demo', email: `${id.slice(2)}.demo@campus360.example`, demo: true, ...extra,
  })
  return {
    u_aarav: p('u_aarav', 'Aarav Mehta', 'FE-A', 'Computer Engineering', ['coding', 'robotics', 'music'], ['Engineering Mathematics I', 'Programming in C', 'Engineering Physics', 'Basic Electrical Engineering', 'Engineering Graphics'], { branchId: 'CS', division: 'D1CSA', roll: 'D1CSA-01' , classRep: true }),
    u_diya: p('u_diya', 'Diya Nair', 'FE-A', 'Information Technology', ['design', 'dance', 'coding'], ['Engineering Mathematics I', 'Programming in C', 'Engineering Chemistry', 'Communication Skills'], { branchId: 'IT', division: 'D1ITA', roll: 'D1ITA-07' , classRep: true }),
    u_kabir: p('u_kabir', 'Kabir Shah', 'FE-B', 'AI & Data Science', ['ai', 'chess', 'photography'], ['Engineering Mathematics I', 'Python Programming', 'Engineering Physics'], { branchId: 'AIDS', division: 'D1ADA', roll: 'D1ADA-12' , classRep: true }),
    u_ishaan: p('u_ishaan', 'Ishaan Kulkarni', 'FE-B', 'AI & Data Science', ['ai', 'coding', 'cricket'], ['Engineering Mathematics I', 'Python Programming'], { branchId: 'AIDS', division: 'D1ADA', roll: 'D1ADA-15' }),
    u_tanvi: p('u_tanvi', 'Tanvi Rao', 'FE-B', 'AI & Data Science', ['design', 'music'], ['Engineering Mathematics I', 'Python Programming'], { branchId: 'AIDS', division: 'D1ADB', roll: 'D1ADB-03' , classRep: true }),
    u_sneha: p('u_sneha', 'Sneha Iyer', 'FE-C', 'Electronics & Telecom', ['electronics', 'debate', 'music'], ['Engineering Mathematics I', 'Basic Electrical Engineering', 'Engineering Chemistry'], { branchId: 'ENTC', division: 'D1EXA', roll: 'D1EXA-21' , classRep: true }),
    u_rohan: p('u_rohan', 'Rohan Desai', 'SE-A', 'Computer Engineering', ['coding', 'cricket', 'entrepreneurship'], ['Data Structures', 'Programming in C'], { senior: true, branchId: 'CS', division: 'D2CSA', roll: 'D2CSA-04' }),
    // Teachers (fictional demo records, same names as the demo directory). `teaches` = authorised division + subject.
    u_t_meera: p('u_t_meera', 'Prof. Meera Kulkarni', '', 'Applied Mathematics', [], [], { role: 'teacher', year: null, teaches: [{ division: 'D1ADA', subject: 'Engineering Mathematics I' }, { division: 'D1ADB', subject: 'Engineering Mathematics I' }, { division: 'D1CSA', subject: 'Engineering Mathematics I' }, { division: 'D1ITA', subject: 'Engineering Mathematics I' }] }),
    u_t_arjun: p('u_t_arjun', 'Dr. Arjun Pillai', '', 'Computer Engineering', [], [], { role: 'teacher', year: null, teaches: [{ division: 'D1CSA', subject: 'Programming in C' }, { division: 'D1ITA', subject: 'Programming in C' }, { division: 'D1ADA', subject: 'Python Programming' }, { division: 'D1ADB', subject: 'Python Programming' }, { division: 'D1EXA', subject: 'Basic Electrical Engineering' }] }),
    u_admin: p('u_admin', 'Campus Admin (demo)', '', 'Administration', [], [], { role: 'admin', year: null }),
    // Organiser role for the event-approval and submission-review demo. Not a real person or office.
    u_org: p('u_org', 'Events Office (demo organiser)', '', 'Student activities', [], [], { role: 'organiser', year: null }),
    pool: { id: 'pool', name: 'Peer Help Desk (programme account)', classId: 'ALL', system: true, interests: [], subjects: [], demo: true },
  }
}

const S = (id, name, code, credits, internalScored, o = {}) => ({ id, name, code, credits, internalMax: 40, internalScored, externalMax: 60, internalMin: 16, externalMin: 24, demo: true, ...o })

function subjectsFor(uid) {
  if (uid === 'u_aarav') return [
    S('sub_em1', 'Engineering Mathematics I', 'EM-I', 4, 31),
    S('sub_pc', 'Programming in C', 'PIC', 4, 34),
    S('sub_ph', 'Engineering Physics', 'EP', 3, 22),
    S('sub_bee', 'Basic Electrical Engineering', 'BEE', 3, 17),
    S('sub_eg', 'Engineering Graphics', 'EG', 2, 21, { internalMax: 25, externalMax: 25, internalMin: 10, externalMin: 10 }),
  ]
  if (uid === 'u_diya') return [
    S('sub_em1', 'Engineering Mathematics I', 'EM-I', 4, 27),
    S('sub_pc', 'Programming in C', 'PIC', 4, 36),
    S('sub_ch', 'Engineering Chemistry', 'EC', 3, 29),
    S('sub_cs', 'Communication Skills', 'CS', 2, 14, { internalMax: 25, externalMax: 25, internalMin: 10, externalMin: 10 }),
  ]
  return [
    S('sub_em1', 'Engineering Mathematics I', 'EM-I', 4, 25),
    S('sub_ph', 'Engineering Physics', 'EP', 3, 28),
  ]
}

// Weekly timetable by class. day: 1 = Monday … 5 = Friday. place = navigator floor + id.
const TT = {
  'FE-A': [
    [1, '09:00', '10:00', 'Engineering Mathematics I', 'Lecture', 1, 'r01'], [1, '10:15', '12:15', 'Programming in C Lab', 'Lab', 1, 'l21'], [1, '13:15', '14:15', 'Engineering Physics', 'Lecture', 1, 'r05'],
    [2, '09:00', '10:00', 'Basic Electrical Engineering', 'Lecture', 1, 'r02'], [2, '10:15', '12:15', 'Engineering Physics Lab', 'Lab', 3, 'l24'], [2, '13:15', '14:15', 'Programming in C', 'Lecture', 1, 'r03'],
    [3, '09:00', '10:00', 'Engineering Mathematics I', 'Lecture', 1, 'r01'], [3, '10:15', '12:15', 'Engineering Chemistry Lab', 'Lab', 3, 'l25'], [3, '14:30', '16:30', 'Engineering Graphics', 'Lab', 2, 'r12'],
    [4, '09:00', '10:00', 'Programming in C', 'Lecture', 1, 'r03'], [4, '10:15', '11:15', 'Engineering Physics', 'Lecture', 1, 'r05'], [4, '13:15', '15:15', 'BEE Lab', 'Lab', 2, 'l23'],
    [5, '09:00', '10:00', 'Engineering Mathematics I', 'Tutorial', 1, 'r04'], [5, '10:15', '11:15', 'Basic Electrical Engineering', 'Lecture', 1, 'r02'], [5, '11:30', '12:30', 'Mentoring hour', 'Mentoring', 1, 'r18'],
  ],
  'FE-B': [
    [1, '09:00', '10:00', 'Introduction to AI & DS', 'Lecture', 2, 'r04'], [1, '10:15', '12:15', 'Python / ML Lab', 'Lab', 2, 'l26'],
    [2, '09:00', '10:00', 'Engineering Mathematics I', 'Lecture', 2, 'r02'], [2, '10:15', '11:15', 'Engineering Physics', 'Lecture', 2, 'r05'],
    [3, '09:00', '11:00', 'Physics Lab', 'Lab', 3, 'l24'], [3, '11:15', '12:15', 'Python Programming', 'Lecture', 2, 'r04'],
    [4, '09:00', '10:00', 'Engineering Mathematics I', 'Lecture', 2, 'r02'], [5, '09:00', '11:00', 'Python / ML Lab', 'Lab', 2, 'l26'],
  ],
  'FE-C': [
    [1, '09:00', '11:00', 'Basic Electrical Lab', 'Lab', 3, 'l23'], [2, '11:15', '12:15', 'Engineering Chemistry', 'Lecture', 3, 'r08'],
    [3, '09:00', '10:00', 'Engineering Mathematics I', 'Lecture', 3, 'r06'], [4, '13:15', '15:15', 'Circuit Simulation Lab', 'Lab', 3, 'l21'], [5, '09:00', '10:00', 'Engineering Mathematics I', 'Lecture', 3, 'r06'],
  ],
  'SE-A': [[1, '09:00', '11:00', 'Data Structures Lab', 'Lab', 4, 'l21'], [3, '10:15', '11:15', 'Data Structures', 'Lecture', 4, 'r03']],
}
const timetableFor = (classId) => (TT[classId] || []).map(([day, start, end, title, type, f, placeId], i) => ({ id: `tt_${classId}_${i}`, day, start, end, title, type, place: { f, id: placeId }, demo: true }))

function deadlinesFor(uid, now) {
  const d = (id, title, subject, day, time, done = false) => ({ id, title, subject, due: at(now, day, time), done, demo: true })
  if (uid === 'u_aarav') return [d('dl1', 'EM-I Assignment 2 (Laplace transforms)', 'EM-I', 1, '17:00'), d('dl2', 'Physics lab journal — experiments 3 & 4', 'EP', 2, '09:00'), d('dl3', 'C mini-project proposal', 'PIC', 6, '17:00'), d('dl4', 'BEE tutorial sheet 1', 'BEE', -1, '17:00', true)]
  if (uid === 'u_diya') return [d('dl1', 'Chemistry lab write-up', 'EC', 1, '10:00'), d('dl2', 'Communication Skills presentation', 'CS', 3, '11:30')]
  return [d('dl1', 'EM-I Assignment 2', 'EM-I', 2, '17:00'), d('dl2', 'Lab journal sign-off', 'Lab', 4, '13:00')]
}

function directory() {
  const E = (id, category, name, purpose, place, coords, extra = {}) => ({ id, category, name, purpose, place, coords, demo: true, ...extra })
  return [
    E('dir_f1', 'faculty', 'Prof. Meera Kulkarni', 'Engineering Mathematics I · FE class coordinator', { f: 1, id: 'r15', label: 'Department office, Floor 1' }, pin(0.0004, -0.0002), { email: 'meera.kulkarni@campus360.example', phone: 'Ext. 201 (demo)', hours: 'Mon–Fri 14:30–16:00' }),
    E('dir_f2', 'faculty', 'Dr. Arjun Pillai', 'Programming in C · lab in-charge', { f: 1, id: 'l21', label: 'Lab 121, Floor 1' }, pin(0.0005, 0.0001), { email: 'arjun.pillai@campus360.example', phone: 'Ext. 214 (demo)', hours: 'Tue & Thu 12:15–13:15' }),
    E('dir_f3', 'faculty', 'Prof. Farah Sheikh', 'Engineering Physics · FE mentor', { f: 3, id: 'r15', label: 'Department office, Floor 3' }, pin(0.0004, 0.0003), { email: 'farah.sheikh@campus360.example', phone: 'Ext. 305 (demo)', hours: 'Wed 11:15–12:15' }),
    E('dir_f4', 'faculty', 'Dr. Vikram Rao', 'Head of Department (demo record)', { f: 4, id: 'r15', label: 'HOD cabin, Floor 4' }, pin(0.0003, 0.0004), { email: 'hod.office@campus360.example', phone: 'Ext. 401 (demo)', hours: 'By appointment' }),
    E('dir_s1', 'senior', 'Rohan Desai (SE)', 'Senior mentor — C programming, coding club', { f: 4, id: 'l21', label: 'Usually at Lab 421, Floor 4' }, pin(0.0005, 0.0005), { email: 'rohan.mentor@campus360.example', phone: '+91 90000 00001 (demo)', userId: 'u_rohan' }),
    E('dir_s2', 'senior', 'Ishita Rao (TE)', 'Senior mentor — robotics club, hostel tips', { f: 2, id: 'amphi', label: 'Amphitheatre, Floor 2 (club meets)' }, pin(0.0002, 0.0002), { email: 'ishita.mentor@campus360.example', phone: '+91 90000 00002 (demo)' }),
    E('dir_s3', 'senior', 'Nikhil Joshi (SE)', 'Senior mentor — maths doubts, exam strategy', { f: 1, id: 'library', label: 'Library, Floor 1' }, pin(0.0001, -0.0004), { email: 'nikhil.mentor@campus360.example', phone: '+91 90000 00003 (demo)' }),
    E('dir_l1', 'lab', 'Programming Lab', 'C and Python practicals, open hours after 4 pm', { f: 1, id: 'l21', label: 'Lab 121, Floor 1' }, pin(0.0005, 0.0001)),
    E('dir_l2', 'lab', 'Physics Lab', 'Engineering Physics experiments', { f: 3, id: 'l24', label: 'Lab 324, Floor 3' }, pin(0.0005, 0.0002)),
    E('dir_l3', 'lab', 'Chemistry Lab', 'Engineering Chemistry practicals', { f: 3, id: 'l25', label: 'Lab 325, Floor 3' }, pin(0.0005, 0.0003)),
    E('dir_l4', 'lab', 'VLSI & Hardware Lab', 'BEE and hardware practicals', { f: 2, id: 'l23', label: 'Lab 223, Floor 2' }, pin(0.0006, -0.0001)),
    E('dir_l5', 'lab', 'Python / ML Lab', 'AI & DS practicals', { f: 2, id: 'l26', label: 'Lab 226, Floor 2' }, pin(0.0006, 0.0003)),
    E('dir_lib', 'library', 'Central Library', 'Borrow books, reading hall, journals and question papers', { f: 1, id: 'library', label: 'Floor 1, window side' }, pin(0.0001, -0.0004), { hours: 'Mon–Sat 08:30–19:00 (demo hours)', email: 'library@campus360.example' }),
    E('dir_can', 'canteen', 'Canteen', 'Breakfast, lunch, snacks', { f: 0, id: 'canteen', label: 'Ground floor, west wing' }, pin(-0.0002, -0.0007), { hours: '08:00–18:00 (demo hours)' }),
    E('dir_o1', 'office', 'Examination cell', 'Hall tickets, results, revaluation forms', { f: 0, id: 'r17', label: 'Ground floor, centre' }, pin(0, 0)),
    E('dir_o2', 'office', 'Administrative office', 'Fees, ID cards, bonafide certificates', { f: 0, id: 'r16', label: 'Ground floor, west wing' }, pin(0, -0.0003)),
  ]
}

function rides(now) {
  const R = (id, creatorId, creatorName, from, to, departAt, seats, notes) => ({ id, creatorId, creatorName, from, to, departAt, seats, notes, createdAt: at(now, -1, '19:10'), demo: true })
  const st = (n) => { const x = stationByName(n); return { name: `${x.name} station`, lat: x.lat, lng: x.lng } }
  const gate = { name: 'VESIT main gate', lat: CAMPUS_CENTER.lat, lng: CAMPUS_CENTER.lng }
  return [
    R('ride_1', 'u_rohan', 'Rohan Desai', st('Chembur'), gate, nextAt(now, '08:15'), 3, 'Leaving sharp, can wait 5 min.'),
    R('ride_2', 'u_diya', 'Diya Nair', st('Kurla'), gate, nextAt(now, '08:30'), 2, 'Auto share, split fare.'),
    R('ride_3', 'u_aarav', 'Aarav Mehta', gate, st('Ghatkopar'), nextAt(now, '17:30'), 2, 'Bike, one helmet spare.'),
    R('ride_4', 'u_kabir', 'Kabir Shah', st('Govandi'), gate, at(now, 2, '08:00'), 1, 'Car pool — full already?'),
  ]
}
const rideRequests = (now) => [
  { id: 'req_1', rideId: 'ride_1', userId: 'u_aarav', userName: 'Aarav Mehta', status: 'Requested', requestedAt: at(now, -1, '19:30'), demo: true },
  { id: 'req_2', rideId: 'ride_3', userId: 'u_diya', userName: 'Diya Nair', status: 'Requested', requestedAt: at(now, -1, '19:40'), demo: true },
  { id: 'req_3', rideId: 'ride_4', userId: 'u_sneha', userName: 'Sneha Iyer', status: 'Confirmed', requestedAt: at(now, -1, '18:05'), confirmedAt: at(now, -1, '18:20'), demo: true },
  { id: 'req_4', rideId: 'ride_1', userId: 'u_ishaan', userName: 'Ishaan Kulkarni', status: 'Confirmed', requestedAt: at(now, -1, '17:50'), confirmedAt: at(now, -1, '18:00'), demo: true },
  { id: 'req_5', rideId: 'ride_2', userId: 'u_tanvi', userName: 'Tanvi Rao', status: 'Requested', requestedAt: at(now, -1, '19:55'), demo: true },
]

function challenges(now) {
  const C = (id, title, description, classId, points, day, by, byName, byRole) => ({ id, title, description, classId, points, deadline: day ? at(now, day, '20:00') : null, createdBy: by, createdByName: byName, byRole, createdAt: at(now, -2, '11:30'), status: 'open', demo: true })
  return [
    C('ch_1', 'Library treasure hunt', 'Find three Data Structures books in the library and note their shelf codes.', 'FE-A', 30, 5, 'u_t_arjun', 'Dr. Arjun Pillai', 'teacher'),
    C('ch_2', 'Solve 5 problems on the C practice sheet', 'Pick any five problems from sheet 2 and push your solutions to the class repo.', 'FE-A', 40, 3, 'u_diya', 'Diya Nair', 'classRep'),
    C('ch_3', 'Courtyard clean-up hour', 'Join the Saturday clean-up around the statue plaza. Bring gloves.', 'ALL', 20, 6, 'u_t_meera', 'Prof. Meera Kulkarni', 'teacher'),
    { ...C('ch_4', 'Build a voltage divider', 'Build and photograph a working voltage divider in the hardware lab.', 'FE-C', 25, 4, 'u_t_arjun', 'Dr. Arjun Pillai', 'teacher'), submission: { required: true, types: ['jpg', 'png', 'pdf'], maxMB: 10 } },
    C('ch_5', 'Campus quiz', 'Answer the 10-question quiz on the notice board near the exam cell.', 'FE-B', 15, 2, 'u_kabir', 'Kabir Shah', 'classRep'),
    C('ch_6', 'Draw the BEE circuit symbols chart', 'Make a one-page chart of the 20 circuit symbols from unit 1 and pin it in class.', 'FE-C', 15, 3, 'u_sneha', 'Sneha Iyer', 'classRep'),
  ]
}
const completions = (now) => {
  const D = (id, challengeId, userId, userName, classId, points, day, time) => ({ id, challengeId, userId, userName, classId, points, completedAt: at(now, day, time), demo: true })
  return [
    D('done_1', 'ch_3', 'u_kabir', 'Kabir Shah', 'FE-B', 20, -1, '16:10'),
    D('done_3', 'ch_2', 'u_diya', 'Diya Nair', 'FE-A', 40, -1, '18:40'),
    D('done_4', 'ch_4', 'u_sneha', 'Sneha Iyer', 'FE-C', 25, -2, '15:20'),
    D('done_5', 'ch_3', 'u_aarav', 'Aarav Mehta', 'FE-A', 20, -2, '12:30'),
    D('done_6', 'ch_3', 'u_ishaan', 'Ishaan Kulkarni', 'FE-B', 20, -1, '12:45'),
    D('done_7', 'ch_3', 'u_tanvi', 'Tanvi Rao', 'FE-B', 20, -3, '13:05'),
  ]
}

/**
 * Sample events. Times are real campus-hour clock times; whenever the demo is opened (see refreshDemoTimes)
 * one event is Live Now, one Starting Soon, at least one Registration Open and one Event Ended.
 * Outside campus hours the live sample is an overnight hackathon (20:00–08:00), which is plausible at night.
 */
export function events(now) {
  // form: per-event registration fields (teamMax → team size 1..n, roll → roll number required, question → extra question)
  const FORM = { ev_1: { teamMax: 2, roll: true }, ev_4: { roll: true }, ev_5: { question: 'What will you perform (instrument, style or band)?', questionRequired: true } }
  const E = (id, title, description, start, end, regCloses, place, tags, capacity) => ({ id, title, description, start, end, regCloses, place, tags, capacity, organiserId: 'u_org', organiserName: 'Events Office (demo organiser)', form: FORM[id] || {}, demo: true })
  const { mins } = istParts(now)
  const open = mins >= 8 * 60 + 30 && mins < 20 * 60
  // Live: in campus hours a 2½-hour jam that began on the last half hour; at night an overnight hackathon.
  const liveStart = open ? at(now, 0, hm(Math.floor((mins - 30) / 30) * 30)) : at(now, mins < 8 * 60 + 30 ? -1 : 0, '20:00')
  const liveEnd = open ? new Date(Date.parse(liveStart) + 150 * 60000).toISOString() : at(now, mins < 8 * 60 + 30 ? 0 : 1, '08:30')
  const ev1 = open
    ? E('ev_1', "Freshers' Coding Jam", 'Two-hour beginner-friendly problem solving in pairs. Bring a laptop.', liveStart, liveEnd, at(now, -1, '18:00'), { f: 1, id: 'l21', label: 'Programming Lab, Floor 1' }, ['coding'], 60)
    : E('ev_1', "Freshers' Overnight Hackathon", 'Build anything in pairs from 8 pm to 8:30 am. Mentors on call; snacks at midnight.', liveStart, liveEnd, at(now, mins < 8 * 60 + 30 ? -1 : 0, '18:00'), { f: 1, id: 'l21', label: 'Programming Lab, Floor 1' }, ['coding'], 60)
  // Starting Soon: tomorrow's (or today's, if still ahead) club demo whose registration has already closed.
  const soonDay = mins < 13 * 60 ? 0 : 1
  return [
    ev1,
    E('ev_2', 'Robotics club open demo', 'See line-followers and a robotic arm, and sign up for the club.', at(now, soonDay, '16:00'), at(now, soonDay, '17:30'), new Date(Math.min(Date.parse(at(now, soonDay, '12:00')), now.getTime() - 60000)).toISOString(), { f: 2, id: 'amphi', label: 'Amphitheatre, Floor 2' }, ['robotics', 'electronics'], 120),
    E('ev_3', 'Photography walk around campus', 'Golden-hour walk through the courtyard and terraces.', at(now, 3, '17:00'), at(now, 3, '19:00'), at(now, 2, '20:00'), { f: 0, id: 'lobby', label: 'Meet at main lobby' }, ['photography', 'design'], 25),
    E('ev_4', 'Inter-class debate: AI in exams', 'FE divisions face off. Audience welcome.', at(now, 5, '14:00'), at(now, 5, '16:00'), at(now, 4, '18:00'), { f: 2, id: 'amphi', label: 'Amphitheatre, Floor 2' }, ['debate', 'ai'], 200),
    E('ev_5', 'Music night auditions', 'Solo and band auditions for the annual fest.', at(now, 2, '16:30'), at(now, 2, '19:30'), at(now, 1, '20:00'), { f: 2, id: 'amphi', label: 'Amphitheatre, Floor 2' }, ['music', 'dance'], 80),
    E('ev_6', 'Orientation talk: surviving first year', 'Seniors share what they wish they knew.', at(now, -1, '11:00'), at(now, -1, '12:30'), at(now, -2, '18:00'), { f: 0, id: 'lobby', label: 'Main lobby' }, ['volunteering'], 300),
  ]
}

// Sample registration requests so the organiser queue isn't empty in a demo (all labelled Sample).
function registrations(now) {
  const R = (id, eventId, userId, name, classId, status, when, form = {}) => ({ id, eventId, userId, userName: name, status, form: { name, classId, email: '', phone: '', roll: '', teamSize: null, answer: '', ...form }, at: when, history: [{ status, at: when, by: userId }], demo: true })
  return [
    R('reg_d1', 'ev_3', 'u_diya', 'Diya Nair', 'FE-A', 'Pending approval', at(now, -1, '15:40'), { email: 'diya.demo@campus360.example' }),
    R('reg_d2', 'ev_4', 'u_kabir', 'Kabir Shah', 'FE-B', 'Pending approval', at(now, -1, '16:20'), { email: 'kabir.demo@campus360.example', roll: 'FEB-12 (demo)' }),
    R('reg_d3', 'ev_5', 'u_sneha', 'Sneha Iyer', 'FE-C', 'Approved', at(now, -2, '13:10'), { email: 'sneha.demo@campus360.example', answer: 'Keyboard solo' }),
  ]
}

// Sample attendance (labelled demo): every lecture/lab of each demo division's timetable over the last 3 weeks.
// Each demo student has one weaker subject (about 2 in 3 attended) so the under-75% warning shows; never today.
const ATT_SUBJECT = { 'Programming in C Lab': 'Programming in C', 'Engineering Physics Lab': 'Engineering Physics', 'Engineering Chemistry Lab': 'Engineering Chemistry', 'BEE Lab': 'Basic Electrical Engineering', 'Physics Lab': 'Engineering Physics', 'Python / ML Lab': 'Python Programming', 'Basic Electrical Lab': 'Basic Electrical Engineering', 'Circuit Simulation Lab': 'Basic Electrical Engineering' }
const WEAK = { u_aarav: 'Engineering Mathematics I', u_diya: 'Programming in C', u_kabir: 'Python Programming', u_ishaan: 'Engineering Mathematics I', u_tanvi: 'Python Programming', u_sneha: 'Engineering Mathematics I' }
const DIV_CLASS = { D1CSA: 'FE-A', D1ITA: 'FE-A', D1ADA: 'FE-B', D1ADB: 'FE-B', D1EXA: 'FE-C' }
function attendance(now, profs) {
  const out = []
  const teacherFor = (subj) => (/Programming|Python|Electrical/.test(subj) ? 'u_t_arjun' : 'u_t_meera')
  for (const [division, classId] of Object.entries(DIV_CLASS)) {
    const roster = Object.values(profs).filter((p) => p.division === division && !p.role && p.demo)
    if (!roster.length) continue
    const count = {}
    for (let k = 21; k >= 1; k--) {
      const date = at(now, -k, '12:00').slice(0, 10) // IST noon → same calendar date in UTC
      const wd = new Date(date + 'T00:00:00Z').getUTCDay()
      for (const t of timetableFor(classId).filter((x) => x.day === wd && x.type !== 'Mentoring')) {
        const subject = ATT_SUBJECT[t.title] || t.title
        const records = {}
        for (const p of roster) {
          const i = (count[p.id + subject] = (count[p.id + subject] || 0) + 1)
          records[p.id] = WEAK[p.id] === subject ? (i % 3 === 2 ? 'A' : 'P') : (i % 8 === 4 ? 'A' : 'P')
        }
        out.push({ id: `att_demo_${division}_${date}_${t.start.replace(':', '')}`, division, subject, date, start: t.start, end: t.end, teacherId: teacherFor(subject), status: 'recorded', records, note: '', createdAt: at(now, -k, t.end), updatedAt: at(now, -k, t.end), version: 1, demo: true })
      }
    }
  }
  return out
}

// Two classwork posts per demo division, from that division's teachers.
function posts(now) {
  const P = (id, kind, title, body, division, by, byName, subject, extra = {}) => ({ id, kind, title, body, audience: { divisions: [division] }, deadline: null, subject, lectureAt: null, room: null, expiresAt: null, attachments: [], acceptsUploads: kind === 'assignment', status: 'Published', createdBy: by, createdByName: byName, createdAt: at(now, -2, '10:30'), updatedAt: at(now, -2, '10:30'), recipientCount: 0, history: [{ at: at(now, -2, '10:30'), by, action: 'published' }], demo: true, ...extra })
  const M = ['u_t_meera', 'Prof. Meera Kulkarni'], A = ['u_t_arjun', 'Dr. Arjun Pillai']
  const out = []
  for (const d of ['D1CSA', 'D1ITA', 'D1ADA', 'D1ADB']) out.push(P(`post_${d}_1`, 'assignment', 'EM-I Assignment 3: Laplace transforms', 'Solve problems 1–6 from sheet 3. Upload one PDF.', d, ...M, 'Engineering Mathematics I', { deadline: at(now, 4, '17:00') }))
  for (const d of ['D1CSA', 'D1ITA']) out.push(P(`post_${d}_2`, 'notice', 'C lab: bring your journal on Monday', 'Journals will be checked for experiments 1–4 at the start of the lab.', d, ...A, 'Programming in C', { createdAt: at(now, -1, '15:00') }))
  for (const d of ['D1ADA', 'D1ADB']) out.push(P(`post_${d}_2`, 'lecture', 'Extra Python lecture: file handling', 'Revision of file handling with CSV examples.', d, ...A, 'Python Programming', { lectureAt: at(now, 2, '14:30'), createdAt: at(now, -1, '15:00') }))
  out.push(P('post_D1EXA_1', 'assignment', 'BEE tutorial sheet 2', 'Solve all five network problems. Upload one PDF.', 'D1EXA', ...A, 'Basic Electrical Engineering', { deadline: at(now, 3, '17:00') }))
  out.push(P('post_D1EXA_2', 'notice', 'BEE lab moved to Thursday', 'This week the BEE lab runs on Thursday at 13:15 in Lab 223.', 'D1EXA', ...A, 'Basic Electrical Engineering', { createdAt: at(now, -1, '15:00') }))
  return out
}

// Three announcements per demo student (two read, one unread).
function announcements(now, profs) {
  const out = []
  for (const p of Object.values(profs).filter((x) => x.demo && !x.role && !x.system && x.division)) {
    const N = (k, category, title, body, href, day, time, read) => out.push({ id: `ntf_demo_${p.id}_${k}`, userId: p.id, key: `demo:${k}`, category, title, body, href, at: at(now, day, time), read, demo: true })
    N('att', 'attendance', 'Attendance recorded', 'Your attendance for last week is up to date.', '#/attendance', -2, '16:00', true)
    N('post', 'classwork', 'New classwork for your division', `A teacher posted new work for ${p.division}.`, '#/classwork', -1, '15:05', true)
    N('event', 'event', 'Registration open: Music night auditions', 'Solo and band auditions for the annual fest.', '#/events?id=ev_5', 0, '09:00', false)
  }
  return out
}

function peer(now) {
  const offers = [
    { id: 'offer_1', userId: 'u_rohan', userName: 'Rohan Desai', skill: 'Programming in C', level: 'Exam-focused', course: 'Computer Engineering', studyYear: 'Second year (SE)', qualifications: 'Scored well in FE Programming in C; helps juniors in the coding club (sample)', topics: ['Pointers', 'Arrays and strings', 'Structures', 'File handling'], demo: true },
    { id: 'offer_2', userId: 'u_diya', userName: 'Diya Nair', skill: 'Figma basics', level: 'Beginner-friendly', course: 'Information Technology', studyYear: 'First year (FE)', qualifications: 'Designed posters and app mock-ups for two college events (sample)', topics: ['Frames and auto layout', 'Components', 'Prototyping'], demo: true },
    { id: 'offer_3', userId: 'u_kabir', userName: 'Kabir Shah', skill: 'Python', level: 'Beginner-friendly', course: 'AI & Data Science', studyYear: 'First year (FE)', qualifications: 'Two years of Python projects before college (sample)', topics: ['Basics and loops', 'Functions', 'Lists and dictionaries'], demo: true },
    { id: 'offer_4', userId: 'u_sneha', userName: 'Sneha Iyer', skill: 'Arduino', level: 'Hands-on', course: 'Electronics & Telecommunication', studyYear: 'First year (FE)', qualifications: 'Built line-follower robots in the robotics club (sample)', topics: ['Sensors', 'Motors and drivers', 'Serial debugging'], demo: true },
    { id: 'offer_6', userId: 'u_rohan', userName: 'Rohan Desai', skill: 'Engineering Mathematics I', level: 'Exam-focused', course: 'Computer Engineering', studyYear: 'Second year (SE)', qualifications: 'Cleared EM-I with an A; runs weekend doubt sessions (sample)', topics: ['Laplace transforms', 'Matrices', 'Partial differentiation'], demo: true },
    { id: 'offer_5', userId: 'u_aarav', userName: 'Aarav Mehta', skill: 'Guitar', level: 'Beginner-friendly', course: 'Computer Engineering', studyYear: 'First year (FE)', qualifications: 'Five years of playing; performs at music night (sample)', topics: ['Open chords', 'Strumming patterns'], demo: true },
  ]
  const learnRequests = [
    { id: 'learn_1', userId: 'u_aarav', userName: 'Aarav Mehta', skill: 'Python', hours: 1, demo: true },
    { id: 'learn_2', userId: 'u_diya', userName: 'Diya Nair', skill: 'Programming in C', hours: 2, demo: true },
    { id: 'learn_3', userId: 'u_kabir', userName: 'Kabir Shah', skill: 'Arduino', hours: 1, demo: true },
  ]
  // History: students earned credits by teaching at the Peer Help Desk, a programme account funded
  // by an explicit, auditable grant. No one is rewarded for creating a profile.
  const hist = [['u_aarav', 'Aarav Mehta', 'C basics', 2], ['u_diya', 'Diya Nair', 'Figma basics', 3], ['u_kabir', 'Kabir Shah', 'Python', 1], ['u_rohan', 'Rohan Desai', 'Data Structures', 4], ['u_ishaan', 'Ishaan Kulkarni', 'Python basics', 1], ['u_tanvi', 'Tanvi Rao', 'Poster design', 1], ['u_sneha', 'Sneha Iyer', 'Arduino basics', 2]]
  const sessions = hist.map(([uid, name, skill, h], i) => ({ id: `sess_h${i}`, offerId: null, requestId: null, teacherId: uid, teacherName: name, learnerId: 'pool', learnerName: 'Peer Help Desk', skill, hours: h, status: 'Completed', scheduledAt: at(now, -(i + 3), '16:00'), completedAt: at(now, -(i + 3), '17:00'), demo: true }))
  const ledger = [{ id: 'tx_grant', sessionId: null, userId: 'pool', type: 'earn', amount: 20, at: at(now, -30, '10:00'), note: 'Programme grant for the Peer Help Desk (demo)', demo: true }]
  sessions.forEach((s) => {
    ledger.push({ id: `tx_${s.id}_t`, sessionId: s.id, userId: s.teacherId, type: 'earn', amount: s.hours, at: s.completedAt, note: `Taught ${s.skill} at the Peer Help Desk`, demo: true })
    ledger.push({ id: `tx_${s.id}_l`, sessionId: s.id, userId: 'pool', type: 'spend', amount: s.hours, at: s.completedAt, note: `${s.teacherName} taught ${s.skill}`, demo: true })
  })
  // One live match so the Matched → Booked → Completed flow can be shown immediately.
  sessions.push({ id: 'sess_m1', offerId: 'offer_3', requestId: 'learn_1', teacherId: 'u_kabir', teacherName: 'Kabir Shah', learnerId: 'u_aarav', learnerName: 'Aarav Mehta', skill: 'Python', hours: 1, status: 'Matched', scheduledAt: null, createdAt: at(now, -1, '18:30'), demo: true })
  return { offers, learnRequests, sessions, ledger }
}

export function makeSeed(now = new Date()) {
  const profs = profiles()
  const userData = {}
  for (const id of Object.keys(profs)) {
    if (profs[id].system) continue
    const staff = ['organiser', 'teacher', 'admin'].includes(profs[id].role)
    const deadlines = staff ? [] : deadlinesFor(id, now)
    userData[id] = { subjects: staff ? [] : subjectsFor(id), gradeScale: DEMO_GRADE_SCALE.map((g) => ({ ...g })), academic: { ...DEFAULT_ACADEMIC_SETTINGS }, deadlines, seenDeadlines: Object.fromEntries(deadlines.map((d) => [d.id, d.due])) }
    // A saved target SGPA that is achievable for this student's sample marks (highest of these that works).
    if (!staff && profs[id].demo) { const u = userData[id]; const t = [8.5, 8, 7.5, 7, 6.5, 6].find((x) => checkTarget(u.subjects, u.gradeScale, x, u.academic).result === RESULT.ACHIEVABLE); if (t != null) u.target = t }
  }
  return {
    version: 1, seededAt: now.toISOString(), profiles: profs, userData,
    shared: {
      rides: rides(now), rideRequests: rideRequests(now), challenges: challenges(now), completions: completions(now),
      events: events(now), registrations: registrations(now), directory: directory(), ...peer(now), notifications: announcements(now, profs), submissions: [], posts: posts(now), postSubs: [], attSessions: attendance(now, profs), attAudit: [], attSecrets: {}, staffAllowlist: [], dishes: makeMenu(), reviews: [], notes: [], noteReports: [],
      noteRequests: [{ id: 'nreq_demo1', userId: 'u_ishaan', userName: 'Ishaan Kulkarni', year: '1', branch: 'AIDS', subject: 'Python Programming', topic: 'File handling', details: 'Worked examples with CSV files would help.', status: 'Open', at: at(now, -2, '18:15'), noteId: null, fulfilledBy: null, demo: true }],
      tutorReviews: [{ id: 'trev_demo1', tutorId: 'u_rohan', userId: 'u_aarav', userName: 'Aarav Mehta', rating: 5, text: 'Explained pointers with diagrams. Very patient.', at: at(now, -3, '17:45'), demo: true }, { id: 'trev_demo2', tutorId: 'u_kabir', userId: 'u_diya', userName: 'Diya Nair', rating: 4, text: 'Good examples; went a bit fast.', at: at(now, -1, '17:20'), demo: true }],
      eventChats: [{ id: 'msg_demo1', eventId: 'ev_1', studentId: 'u_aarav', fromId: 'u_aarav', fromName: 'Aarav Mehta', fromRole: 'student', text: 'Is a laptop compulsory, or can two people share one?', at: at(now, -1, '19:05'), demo: true }, { id: 'msg_demo2', eventId: 'ev_1', studentId: 'u_aarav', fromId: 'u_org', fromName: 'Events Office (demo organiser)', fromRole: 'organiser', text: 'Pairs can share one laptop. Bring a charger if you can.', at: at(now, -1, '19:30'), demo: true }],
    },
  }
}

export const timetableForClass = timetableFor

export function emptyUserData() {
  return { subjects: [], gradeScale: DEMO_GRADE_SCALE.map((g) => ({ ...g })), academic: { ...DEFAULT_ACADEMIC_SETTINGS }, deadlines: [] }
}

/**
 * Re-time the sample events and rides each time the demo opens, so the four event states and future rides
 * are always present at plausible campus times. Only records marked demo are touched; registrations,
 * user-created events and rides are kept as they are.
 */
export function refreshDemoTimes(db, now = new Date()) {
  const fresh = makeSeed(now)
  const ev = new Map(fresh.shared.events.map((e) => [e.id, e]))
  const rd = new Map(fresh.shared.rides.map((r) => [r.id, r]))
  let changed = false
  const events = db.shared.events.map((e) => { const f = e.demo && ev.get(e.id); if (!f || (e.start === f.start && e.title === f.title)) return e; changed = true; return { ...e, title: f.title, description: f.description, start: f.start, end: f.end, regCloses: f.regCloses } })
  const rides = db.shared.rides.map((r) => { const f = r.demo && !r.cancelled && rd.get(r.id); if (!f || Date.parse(r.departAt) > now.getTime()) return r; changed = true; return { ...r, departAt: f.departAt } })
  return changed ? { ...db, shared: { ...db.shared, events, rides } } : db
}
