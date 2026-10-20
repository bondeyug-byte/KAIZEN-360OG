// Personal and action tools for the in-app assistant. They read the signed-in student's data from the
// app state (LocalStorage), so they run in the browser. Actions never run directly: they return a
// `pending` action that the student must confirm (by voice or tap) before anything changes.
import { PUBLIC_TOOLS, runPublicTool, resolvePlace } from './publicTools.js'
import { timetableForClass } from '../data/seed.js'
import { currentTimetable } from '../lib/timetable.js'
// Phone accounts: the server timetable (same source as the Overview and College portal); demo: the sample.
const ttOf = (me) => { const c = currentTimetable(); return me?.authMethod === 'minimoth' ? (c.entries || []) : timetableForClass(me?.classId) }
import { place, floorName } from '../navigator/building.js'
import { checkTarget, marksTable, RESULT } from '../lib/academic.js'
import { leaderboard, eligible, hasCompleted, completeChallenge } from '../lib/challenges.js'
import { creditsOf, findMatches } from '../lib/peer.js'
import { eventStatus, suggestEvents, isRegistered, requestRegistration, canRegister, validateRegistrationForm, myRequest, regStatus, EVENT_STATUS } from '../lib/events.js'
import { seatsInfo, seatStatusFor, departed, requestSeat } from '../lib/rides.js'
import { uid } from '../lib/ids.js'
import { CAMPUS_TIMEZONE, STARTING_SOON_MINUTES } from '../data/config.js'

const EV = { timeZone: CAMPUS_TIMEZONE, soonWindowMinutes: STARTING_SOON_MINUTES }
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const t12 = (s) => { const m = toMin(s), h = Math.floor(m / 60); return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` }
const fmt = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
function istParts(now) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: CAMPUS_TIMEZONE, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  return { wd: DAYS.indexOf(p.find((x) => x.type === 'weekday').value.toLowerCase()), mins: (+p.find((x) => x.type === 'hour').value % 24) * 60 + +p.find((x) => x.type === 'minute').value }
}
function relDue(iso, now) {
  const d = Date.parse(iso) - now.getTime(), h = Math.round(Math.abs(d) / 3600000)
  const s = h < 1 ? 'under an hour' : h < 36 ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.round(h / 24)} days`
  return d < 0 ? `overdue by ${s}` : `due in ${s}`
}

const S = (properties = {}, required = []) => ({ type: 'object', properties, required })
const str = (description, extra = {}) => ({ type: 'string', description, ...extra })

export const PERSONAL_TOOLS = [
  { name: 'my_schedule', description: "The student's lectures and labs for a day, with rooms and floors.", parameters: S({ day: str('today, tomorrow, or a weekday name like monday') }) },
  { name: 'my_deadlines', description: "The student's pending assignments and deadlines (and overdue ones), soonest first.", parameters: S({}) },
  { name: 'my_academics', description: "The student's subjects, internal marks, what is needed in the external exam for each grade, and whether their target SGPA is achievable.", parameters: S({}) },
  { name: 'my_events', description: 'Campus events: status (Registration Open / Starting Soon / Live Now / Ended), what the student registered for, and suggestions from their interests. Includes event ids.', parameters: S({}) },
  { name: 'my_rides', description: 'Ride sharing: rides with free seats (ids, from, to, time), and the status of seats the student requested or rides they offer.', parameters: S({ to: str('Optional place to filter by') }) },
  { name: 'my_challenges', description: "Open class challenges the student can complete (ids, points) and the student's points and class rank.", parameters: S({}) },
  { name: 'my_peer_learning', description: "Peer learning: the student's time credits and suggested teachers for what they want to learn.", parameters: S({}) },
  { name: 'directory_search', description: 'Who to contact: faculty, senior mentors, labs, library, canteen and offices (sample records).', parameters: S({ query: str('Name, subject or need, e.g. "maths doubts", "exam cell", "C programming"') }, ['query']) },
  { name: 'open_page', description: 'Open a section of the app for the student. No confirmation needed.', parameters: S({ page: str('Which page', { enum: ['dashboard', 'planner', 'rides', 'commute', 'challenges', 'directory', 'events', 'peer', 'profile', 'navigator'] }) }, ['page']) },
  { name: 'navigate_to', description: 'Open the 3D campus navigator and start turn-by-turn navigation to a place. No confirmation needed.', parameters: S({ place: str('Destination, e.g. "library", "room 305", "physics lab", "nearest washroom"'), from: str('Optional start place') }, ['place']) },
]
export const ACTION_TOOLS = [
  { name: 'request_ride_seat', description: 'Request a seat on a ride. The student must confirm first.', parameters: S({ ride_id: str('Ride id from my_rides') }, ['ride_id']) },
  { name: 'register_event', description: 'Send a registration REQUEST for an event, using the student profile details. The organiser approves or rejects it later; never say the student is registered. The student must confirm first.', parameters: S({ event_id: str('Event id from my_events') }, ['event_id']) },
  { name: 'mark_deadline_done', description: 'Mark one of the student\'s deadlines as done. The student must confirm first.', parameters: S({ deadline_id: str('Deadline id from my_deadlines') }, ['deadline_id']) },
  { name: 'add_deadline', description: 'Add a deadline/reminder to the student\'s list. The student must confirm first.', parameters: S({ title: str('What is due'), subject: str('Optional subject code'), due: str('Due date-time, ISO 8601 in India time, e.g. 2026-10-20T17:00') }, ['title', 'due']) },
  { name: 'complete_challenge', description: 'Mark a class challenge as completed to earn points. The student must confirm first.', parameters: S({ challenge_id: str('Challenge id from my_challenges') }, ['challenge_id']) },
]
export const ALL_TOOLS = [...PUBLIC_TOOLS, ...PERSONAL_TOOLS, ...ACTION_TOOLS]
const ACTIONS = new Set(ACTION_TOOLS.map((t) => t.name))
export const isAction = (name) => ACTIONS.has(name)

const PAGE = { dashboard: '/', planner: '/planner', rides: '/rides', commute: '/commute', challenges: '/challenges', directory: '/directory', events: '/events', peer: '/peer', profile: '/profile', navigator: '/navigator' }

/**
 * Run a tool. ctx = { db, me, myData, now }.
 * Returns { result, pending?, open? }:
 *   result  — JSON for the model / offline answer
 *   pending — an action awaiting confirmation: { tool, args, summary }
 *   open    — a hash route the UI should open
 */
export function runTool(name, args = {}, ctx) {
  const { db, me, myData, now } = ctx
  const sh = db.shared
  const pub = runPublicTool(name, args, now)
  if (pub !== undefined) return { result: pub }
  if (!me) return { result: { ok: false, message: 'The student is not signed in. Ask them to sign in (demo sign-in works).' } }

  switch (name) {
    case 'my_schedule': {
      const { wd } = istParts(now)
      const q = String(args.day || 'today').toLowerCase()
      let day = q.startsWith('tom') ? (wd + 1) % 7 : DAYS.findIndex((d) => q.startsWith(d.slice(0, 3)))
      if (day < 0) day = wd
      const list = ttOf(me).filter((t) => t.day === day).sort((a, b) => toMin(a.start) - toMin(b.start))
      const { mins } = istParts(now)
      return { result: {
        day: day === wd ? 'today' : DAYS[day], class: me.classId,
        lectures: list.map((t) => { const p = place(t.place.f, t.place.id); return { time: `${t12(t.start)}–${t12(t.end)}`, title: t.title, type: t.type, room: p ? p.name : t.place.id, floor: floorName(t.place.f), status: day !== wd ? 'upcoming' : toMin(t.end) <= mins ? 'over' : toMin(t.start) <= mins ? 'happening now' : 'upcoming', link: `#/navigator?f=${t.place.f}&id=${t.place.id}` } }),
        note: list.length ? undefined : 'No lectures that day.',
      } }
    }
    case 'my_deadlines': {
      const all = myData?.deadlines || []
      const pending = all.filter((d) => !d.done).sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
      return { result: { pending: pending.map((d) => ({ id: d.id, title: d.title, subject: d.subject, due: fmt(d.due), status: relDue(d.due, now) })), doneCount: all.length - pending.length } }
    }
    case 'my_academics': {
      const subs = myData?.subjects || []
      const rows = subs.map((s) => {
        const t = marksTable(s, myData.gradeScale)
        if (!t.valid || t.missing) return { subject: s.name, internal: s.internalScored == null ? 'not entered' : `${s.internalScored}/${s.internalMax}` }
        const reach = t.rows.filter((r) => r.achievable)
        return { subject: s.name, credits: s.credits, internal: `${s.internalScored}/${s.internalMax}`, bestGradeStillPossible: reach[0]?.grade || 'none', externalNeededForIt: reach[0] ? `${reach[0].toScore}/${s.externalMax}` : null, lockedGrades: t.rows.filter((r) => r.status === 'locked').map((r) => r.grade) }
      })
      const target = myData?.target
      const tgt = target != null && subs.length ? checkTarget(subs, myData.gradeScale, target, myData.academic) : null
      return { result: { subjects: rows, targetSGPA: target ?? 'not set', targetResult: tgt ? tgt.result : null, targetNote: tgt && tgt.result === RESULT.ACHIEVABLE ? 'Achievable — the Planner shows the least-effort plan.' : tgt?.reason || null, gradingNote: 'Uses the demo grading scale set in Planner; not official college rules.', link: '#/planner' } }
    }
    case 'my_events': {
      const evs = sh.events.map((e) => ({ id: e.id, title: e.title, when: fmt(e.start), where: e.place?.label, status: eventStatus(e, now, EV), registered: isRegistered(sh, e.id, me.id), request: myRequest(sh, e.id, me.id) ? regStatus(myRequest(sh, e.id, me.id)) : null, canRequest: canRegister(sh, e, me, now, EV).ok })).filter((e) => e.status !== EVENT_STATUS.ENDED)
      const sug = suggestEvents(sh.events, me, now, EV).slice(0, 3).map((s) => ({ id: s.event.id, title: s.event.title, because: s.matched.join(', ') }))
      return { result: { events: evs, suggestedForYou: sug, link: '#/events' } }
    }
    case 'my_rides': {
      const q = args.to ? String(args.to).toLowerCase() : null
      const open = sh.rides.filter((r) => r.creatorId !== me.id && !departed(r, now) && !seatsInfo(r, sh.rideRequests).full && (!q || (r.to.name + ' ' + r.from.name).toLowerCase().includes(q))).map((r) => { const s = seatsInfo(r, sh.rideRequests); return { id: r.id, driver: r.creatorName, from: r.from.name, to: r.to.name, leaves: fmt(r.departAt), seatsLeft: s.seatsLeft, yourSeat: seatStatusFor(r, sh.rideRequests, me.id) } })
      const mine = sh.rides.filter((r) => r.creatorId === me.id).map((r) => ({ id: r.id, to: r.to.name, leaves: fmt(r.departAt), requests: sh.rideRequests.filter((x) => x.rideId === r.id).map((x) => `${x.userName}: ${x.status}`) }))
      return { result: { ridesWithSeats: open, ridesYouOffer: mine, note: 'Rides are sample records in the demo.', link: '#/rides' } }
    }
    case 'my_challenges': {
      const lb = leaderboard(sh)
      const openCh = sh.challenges.filter((c) => eligible(c, me) && !hasCompleted(sh, c.id, me.id) && (!c.deadline || Date.parse(c.deadline) > now)).map((c) => ({ id: c.id, title: c.title, points: c.points, closes: c.deadline ? fmt(c.deadline) : null, needsUpload: !!c.submission?.required }))
      return { result: { open: openCh, yourPoints: lb.students.find((s) => s.userId === me.id)?.points || 0, classRank: lb.classes.findIndex((c) => c.classId === me.classId) + 1 || null, link: '#/challenges' } }
    }
    case 'my_peer_learning': {
      const c = creditsOf(sh, me.id)
      const m = findMatches(sh, db.profiles, me.id).map((x) => ({ wantToLearn: x.request.skill, teachers: x.teachers.map((t) => t.offer.userName) }))
      return { result: { credits: c, matches: m, rule: '1 hour taught = 1 credit; 1 hour learned costs 1 credit.', link: '#/peer' } }
    }
    case 'directory_search': {
      const q = String(args.query || '').toLowerCase().split(/\s+/).filter((w) => w.length > 2)
      const hits = sh.directory.map((e) => ({ e, s: q.reduce((n, w) => n + ([e.name, e.purpose, e.category, e.place?.label].join(' ').toLowerCase().includes(w) ? 1 : 0), 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4)
      return { result: { matches: hits.map(({ e }) => ({ name: e.name, role: e.purpose, where: e.place?.label, hours: e.hours, contact: e.email || e.phone || null, link: `#/navigator?f=${e.place.f}&id=${e.place.id}` })), note: 'Sample directory records (fictional people).' } }
    }
    case 'open_page': {
      const path = PAGE[args.page] || '/'
      return { result: { opened: args.page }, open: path }
    }
    case 'navigate_to': {
      const from = args.from ? resolvePlace(args.from)[0] : null
      let p = null
      if (/next (lecture|class|lab|period)|my (lecture|class|lab)|लेक्चर|क्लास|तास/i.test(args.place || '')) {
        const { wd, mins } = istParts(now)
        const t = ttOf(me).filter((x) => x.day === wd && toMin(x.end) > mins).sort((a, b) => toMin(a.start) - toMin(b.start))[0]
        if (t) p = place(t.place.f, t.place.id)
        else return { result: { ok: false, message: 'No more lectures today.' } }
      }
      p = p || resolvePlace(args.place, from ? { f: from.f, id: from.id } : undefined)[0]
      if (!p) return { result: { ok: false, message: `No place matches "${args.place}".` } }
      return { result: { ok: true, navigatingTo: `${p.name}, ${floorName(p.f)}` }, open: `/navigator?f=${p.f}&id=${p.id}&go=1&t=${Date.now()}` }
    }
    // ---- actions: validate now, change data only after confirmation ----
    case 'request_ride_seat': {
      const r = sh.rides.find((x) => x.id === args.ride_id)
      if (!r) return { result: { ok: false, message: 'No ride with that id. Call my_rides first.' } }
      const test = requestSeat(sh, r.id, me, now)
      if (!test.ok) return { result: { ok: false, message: test.error } }
      return pending(name, args, `Request a seat on ${r.creatorName}'s ride from ${r.from.name} to ${r.to.name}, leaving ${fmt(r.departAt)}`)
    }
    case 'register_event': {
      const e = sh.events.find((x) => x.id === args.event_id)
      if (!e) return { result: { ok: false, message: 'No event with that id. Call my_events first.' } }
      const c = canRegister(sh, e, me, now, EV)
      if (!c.ok) return { result: { ok: false, message: c.reason } }
      const errs = validateRegistrationForm(e, profileForm(me))
      if (Object.keys(errs).length) return { result: { ok: false, message: `This event's form needs details your profile doesn't have (${Object.values(errs).join(' ')}). Open the event to fill in the form.`, link: `#/events?id=${e.id}&form=1` } }
      return pending(name, args, `Send a registration request for "${e.title}" (${fmt(e.start)}, ${e.place?.label}). The organiser will approve or reject it`)
    }
    case 'mark_deadline_done': {
      const d = (myData?.deadlines || []).find((x) => x.id === args.deadline_id)
      if (!d) return { result: { ok: false, message: 'No deadline with that id. Call my_deadlines first.' } }
      if (d.done) return { result: { ok: false, message: 'Already marked done.' } }
      return pending(name, args, `Mark "${d.title}" as done`)
    }
    case 'add_deadline': {
      const due = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(args.due || '') ? args.due : `${args.due}+05:30`)
      if (!args.title || !Number.isFinite(due)) return { result: { ok: false, message: 'Need a title and a valid due date/time.' } }
      return pending(name, { ...args, dueISO: new Date(due).toISOString() }, `Add "${args.title}" due ${fmt(new Date(due).toISOString())}`)
    }
    case 'complete_challenge': {
      const c = sh.challenges.find((x) => x.id === args.challenge_id)
      if (!c) return { result: { ok: false, message: 'No challenge with that id. Call my_challenges first.' } }
      const test = completeChallenge(sh, c.id, me, now)
      if (!test.ok) return { result: { ok: false, message: test.error } }
      return pending(name, args, `Mark "${c.title}" complete for +${c.points} points`)
    }
    default:
      return { result: { ok: false, message: `Unknown tool ${name}` } }
  }
}
const profileForm = (me) => ({ name: me.name || '', classId: me.classId || '', email: me.email || '', phone: me.phone || '', roll: me.roll || '', teamSize: 1, answer: '' })
function pending(tool, args, summary) {
  return { result: { status: 'awaiting_confirmation', summary, instruction: 'Tell the student in one short sentence what you will do and ask them to confirm. Do not say it is done.' }, pending: { tool, args, summary } }
}

/**
 * Perform a confirmed action. app = { runShared, updateMyData, me, now }.
 * Returns { ok, text }.
 */
export function performAction(p, app) {
  const { runShared, updateMyData, me } = app
  const now = app.now || new Date()
  switch (p.tool) {
    case 'request_ride_seat': { const r = runShared((s) => requestSeat(s, p.args.ride_id, me, now)); return r.ok ? { ok: true, text: 'Seat requested. The driver will confirm it.' } : { ok: false, text: r.error } }
    case 'register_event': { const r = runShared((s) => requestRegistration(s, p.args.event_id, me, profileForm(me), now, EV)); return r.ok ? { ok: true, text: r.item.status === 'Waitlisted' ? 'Request sent. The event is full, so you are on the waitlist.' : "Request sent. You'll be notified when the organiser reviews it." } : { ok: false, text: r.error } }
    case 'complete_challenge': { const r = runShared((s) => completeChallenge(s, p.args.challenge_id, me, now)); return r.ok ? { ok: true, text: `Done. +${r.item.points} points added.` } : { ok: false, text: r.error } }
    case 'mark_deadline_done': updateMyData((u) => ({ ...u, deadlines: u.deadlines.map((x) => (x.id === p.args.deadline_id ? { ...x, done: true } : x)) })); return { ok: true, text: 'Marked as done.' }
    case 'add_deadline': updateMyData((u) => ({ ...u, deadlines: [...(u.deadlines || []), { id: uid('dl'), title: p.args.title, subject: p.args.subject || '', due: p.args.dueISO, done: false }] })); return { ok: true, text: 'Added to your deadlines.' }
    default: return { ok: false, text: 'Unknown action.' }
  }
}
