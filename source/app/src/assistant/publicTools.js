// Tools that only need public campus data. Pure functions: they run in the browser (voice assistant)
// and in the server-side MCP function. No React, no DOM.
import { allPlaces, place, buildRoute, routeSummary, floorName, floorPlaces } from '../navigator/building.js'
import { nextTrains, busesNear, findStation, TRAIN_SOURCE, BUS_SOURCE, istMinutes } from '../lib/transit.js'
import { campusInfoTool } from './knowledge.js'
import { planJourney } from '../lib/journey.js'

const strip = (s) => s.replace(/\*\*/g, '')

// Hindi / Marathi / Hinglish words for common places → English search words.
const SYN = [
  [/लाइब्रेरी|लायब्ररी|ग्रंथालय|पुस्तकालय|library|lib\b|kitab/i, 'library'],
  [/कैंटीन|कॅन्टीन|कँटीन|canteen|cafeteria|khana|nashta|jevan|जेवण|खाना|नाश्ता/i, 'canteen'],
  [/टॉयलेट|शौचालय|वॉशरूम|बाथरूम|washroom|toilet|restroom|bathroom|loo|\bwc\b/i, 'washroom'],
  [/लिफ्ट|lift|elevator/i, 'lift'],
  [/सीढ़ी|सीढ़ियाँ|जिना|stairs|staircase|sidhi/i, 'stairs'],
  [/प्रिंसिपल|प्राचार्य|principal/i, 'principal'],
  [/परीक्षा|exam/i, 'exam'],
  [/एडमिन|प्रशासन|admin|fees|फी|id card/i, 'admin'],
  [/hod|एचओडी|विभाग|department/i, 'hod'],
  [/अॅम्फी|एम्फी|amphi|amphitheatre|open section/i, 'amphitheatre'],
  [/लॉबी|lobby|entrance|gate|reception/i, 'lobby'],
]
const FLOOR_WORDS = [
  [/ground|तळ|भूतल|g floor|ground floor/i, 0], [/first|1st|पहली|पहिल्या|पहला/i, 1], [/second|2nd|दूसरी|दुसऱ्या|दुसरा/i, 2],
  [/third|3rd|तीसरी|तिसऱ्या|तिसरा/i, 3], [/fourth|4th|चौथी|चौथ्या|चौथा/i, 4], [/fifth|5th|पांचवीं|पाचव्या|पाचवा/i, 5],
]
const DEFAULT_FROM = { f: 0, id: 'lobby' }

function floorFrom(q) {
  const m = q.match(/floor\s*(\d)|(\d)\s*(?:st|nd|rd|th)?\s*floor|मंजिल\s*(\d)|मजला\s*(\d)/i)
  if (m) return +(m[1] || m[2] || m[3] || m[4])
  for (const [re, f] of FLOOR_WORDS) if (re.test(q) && /floor|मंजिल|मजल|माळ/i.test(q)) return f
  return null
}

function placeOut(p, from) {
  const R = from ? buildRoute(from, { f: p.f, id: p.id }) : null
  const s = R && !R.same ? routeSummary(R) : null
  return { id: p.id, f: p.f, name: p.name, floor: floorName(p.f), wing: p.wing, side: p.where || null, walk: s ? `${s.t} (${s.meta})` : null, link: `#/navigator?f=${p.f}&id=${p.id}` }
}

/** Resolve free text to a place. `from` is used to pick the nearest washroom / lift. */
export function resolvePlace(query, from = DEFAULT_FROM) {
  if (!query) return []
  let q = String(query).trim()
  for (const [re, w] of SYN) if (re.test(q)) q += ' ' + w
  const ql = q.toLowerCase()
  const floor = floorFrom(ql)
  // Room / lab codes like 305, G17, room 1 05
  const code = ql.match(/\b(g|[0-5])\s?(\d{2})\b/)
  const places = allPlaces()
  if (code) {
    const c = (code[1] === 'g' ? 'G' : code[1]) + code[2]
    const hit = places.find((p) => p.code === c)
    if (hit) return [hit]
  }
  const words = ql.split(/[^a-z0-9&/]+/).filter((w) => w.length > 2 && !['the', 'where', 'take', 'room', 'floor', 'near', 'nearest', 'how', 'and', 'get', 'can', 'find', 'show', 'me', 'kaha', 'hai'].includes(w))
  if (!words.length) return []
  let scored = places.map((p) => ({ p, s: words.reduce((n, w) => n + (p.search.includes(w) ? 1 : 0), 0) })).filter((x) => x.s > 0)
  if (floor != null) scored = scored.filter((x) => x.p.f === floor)
  if (!scored.length) return []
  const best = Math.max(...scored.map((x) => x.s))
  let top = scored.filter((x) => x.s === best).map((x) => x.p)
  // For things that exist on every floor, nearest first.
  if (top.length > 1 && from && place(from.f, from.id)) {
    const dist = (p) => { const R = buildRoute(from, { f: p.f, id: p.id }); return !R ? 1e9 : R.same ? 0 : R.secs }
    top = top.map((p) => [p, dist(p)]).sort((a, b) => a[1] - b[1]).map((x) => x[0])
  }
  return top
}

export function findPlaceTool({ query, from } = {}) {
  const fromP = from ? resolvePlace(from)[0] : null
  const start = fromP ? { f: fromP.f, id: fromP.id } : DEFAULT_FROM
  const hits = resolvePlace(query, start).slice(0, 4)
  if (!hits.length) return { found: false, message: `No place on campus matches "${query}". Try a room number, a lab name, library, canteen or washroom.` }
  return { found: true, from: place(start.f, start.id).name, matches: hits.map((p) => placeOut(p, start)), note: 'Room numbers and lab positions are placeholders until the college confirms them.' }
}

export function campusRouteTool({ from, to } = {}) {
  const A = from ? resolvePlace(from)[0] : place(DEFAULT_FROM.f, DEFAULT_FROM.id)
  if (!A) return { ok: false, message: `I couldn't find "${from}" on campus.` }
  const B = resolvePlace(to, { f: A.f, id: A.id })[0]
  if (!B) return { ok: false, message: `I couldn't find "${to}" on campus.` }
  const R = buildRoute({ f: A.f, id: A.id }, { f: B.f, id: B.id })
  if (R.same) return { ok: true, from: A.name, to: B.name, summary: 'You are already there.', steps: [] }
  const s = routeSummary(R)
  return { ok: true, from: `${A.name} (${floorName(A.f)})`, to: `${B.name} (${floorName(B.f)})`, time: s.t, summary: s.meta, steps: R.steps.map((x) => strip(x.text)), link: `#/navigator?f=${B.f}&id=${B.id}&go=1` }
}

const TYPE_FILTER = { fast: ['F', 'AF'], slow: ['S', 'AS'], ac: ['AS', 'AF'] }
export function nextTrainsTool({ from, to, type, direction, time, limit = 4 } = {}, now = new Date()) {
  let at = now
  if (time && /^\d{1,2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(':').map(Number)
    at = new Date(now.getTime() + (h * 60 + m - istMinutes(now)) * 60000)
  }
  let origin = findStation(from || '')
  const dest = to ? findStation(to) : null
  if (!origin || !['Kurla', 'Chembur'].includes(origin)) origin = 'Chembur'
  if (dest === origin) return { ok: false, message: `You're already at ${origin}. Where are you going?` }
  const dir = direction === 'up' || direction === 'UP' ? 'UP' : direction === 'down' || direction === 'DN' ? 'DN' : undefined
  const r = nextTrains({ from: origin, to: dest || undefined, dir, types: TYPE_FILTER[type] || null, now: at, limit: Math.min(8, Math.max(1, limit)) })
  if (r.error) return { ok: false, message: r.error }
  return {
    ok: true, from: r.from, to: r.to, asOf: r.nowText,
    trains: r.trains.map((t) => ({ departs: t.depText, inMinutes: t.wait, type: t.typeLabel, line: t.lineLabel, towards: t.dest, direction: t.direction, arrives: t.arrText, journeyMin: t.mins, train: t.code })),
    source: `${TRAIN_SOURCE.text}. Scheduled times, not live running status.`,
    link: `#/commute?tab=trains&from=${r.from}${r.to ? '&to=' + encodeURIComponent(r.to) : ''}`,
  }
}

export function busesTool({ toward } = {}, now = new Date()) {
  const stops = busesNear({ toward, now })
  if (!stops.length) return { ok: false, message: `No BEST route at the stops near campus goes to "${toward}".` }
  return {
    ok: true,
    stops: stops.map((s) => ({ stop: s.name, walk: s.walk, routes: s.routes.slice(0, 6).map((r) => ({ route: r.no, between: r.ends.filter((e) => e !== '—').join(' ⇄ '), next: r.next.text, kind: r.next.kind })) })),
    caution: BUS_SOURCE.note,
    link: `#/commute?tab=buses${toward ? '&toward=' + encodeURIComponent(toward) : ''}`,
  }
}

export function floorGuideTool({ floor } = {}) {
  const f = Math.max(0, Math.min(5, Number(floor) || 0))
  const ps = floorPlaces(f)
  const by = (t) => ps.filter((p) => p.type === t).map((p) => p.short)
  return { floor: floorName(f), rooms: by('room').length, labs: by('lab'), offices: by('office'), special: [...by('library'), ...by('canteen'), ...by('amphi')], washrooms: by('wc'), lifts: by('lift').length, note: 'Room numbers and lab positions are placeholders.' }
}

// ---------- tool definitions (JSON Schema) ----------
const S = (description, properties = {}, required = []) => ({ type: 'object', properties, required })
const str = (description, extra = {}) => ({ type: 'string', description, ...extra })

export const PUBLIC_TOOLS = [
  { name: 'plan_journey', description: 'Plan a local-train journey from any Central main line, Harbour, Trans-Harbour or Uran-line station to VESIT (via Chembur or Kurla) or to another station. Returns legs, where to change, next scheduled trains where the timetable covers the leg, and the last leg to campus. Handles misspellings like "Dombili".', parameters: S('', { from: str('Starting station, e.g. Dombivli, Thane, Panvel'), to: str('Optional destination station; omit for VESIT campus'), time: str('Optional HH:MM (24h, India time) to leave at') }, ['from']) },
  { name: 'campus_info', description: 'Facts about VESIT itself, with sources: address, history, affiliation, what is on each floor, how to reach campus from Chembur or Kurla, labs, the Praxis fest, emergency number, and how each Campus360 feature works. Call this for any general question about the college before answering.', parameters: S('', { query: str('The question or topic, e.g. "how do I reach from Kurla", "where is the library", "is VESIT autonomous"') }, ['query']) },
  { name: 'find_place', description: 'Find a room, lab, office, library, canteen, washroom, lift or stairs in the VESIT main building. Returns floor, wing and walking time from the main lobby (or from `from`).', parameters: S('', { query: str('What to find, e.g. "library", "room 305", "physics lab", "nearest washroom", "principal office"'), from: str('Optional starting place') }, ['query']) },
  { name: 'campus_route', description: 'Turn-by-turn walking directions between two places inside the main building.', parameters: S('', { from: str('Start place; defaults to the main entrance lobby'), to: str('Destination place') }, ['to']) },
  { name: 'next_trains', description: 'Next scheduled Mumbai local trains from Kurla (Central main + Harbour lines) or Chembur (Harbour line), optionally to a destination station. Official Central Railway timetable, not live status.', parameters: S('', { from: str('Kurla or Chembur'), to: str('Optional destination station, e.g. Thane, CSMT, Vashi, Panvel'), type: str('fast, slow or ac', { enum: ['any', 'fast', 'slow', 'ac'] }), direction: str('up = towards CSMT, down = towards Thane/Kalyan/Panvel', { enum: ['any', 'up', 'down'] }), time: str('Optional HH:MM (24h, India time) to search from instead of now'), limit: { type: 'integer', description: 'How many trains (1-8)' } }, ['from']) },
  { name: 'buses_near_campus', description: 'BEST bus routes at the stops near the VES Collector Colony campus (Chembur Colony, Vivekanand College, Chembur Camp), with frequency estimates. BEST does not publish full timetables, so waits are estimates.', parameters: S('', { toward: str('Optional destination or route number, e.g. Kurla, Ghatkopar, 501 LTD') }) },
  { name: 'floor_guide', description: 'What is on a floor of the main building.', parameters: S('', { floor: { type: 'integer', description: '0 = ground floor … 5' } }, ['floor']) },
]

export function runPublicTool(name, args = {}, now = new Date()) {
  switch (name) {
    case 'campus_info': return campusInfoTool(args)
    case 'plan_journey': return planJourneyTool(args, now)
    case 'find_place': return findPlaceTool(args)
    case 'campus_route': return campusRouteTool(args)
    case 'next_trains': return nextTrainsTool(args, now)
    case 'buses_near_campus': return busesTool(args, now)
    case 'floor_guide': return floorGuideTool(args)
    default: return undefined
  }
}

export function planJourneyTool({ from, to, time } = {}, now = new Date()) {
  let at = now
  if (time && /^\d{1,2}:\d{2}$/.test(time)) { const [h, m] = time.split(':').map(Number); at = new Date(now.getTime() + (h * 60 + m - istMinutes(now)) * 60000) }
  const p = planJourney({ from, to: to || 'campus', now: at })
  if (p.error) return { ok: false, message: p.error }
  return {
    ok: true, from: p.from.name, to: p.to,
    options: p.options.slice(0, 2).map((o) => ({
      via: o.via, best: !!o.best, changes: o.transfers, stops: o.stops,
      legs: o.legs.map((l) => ({ ride: `${l.from.name} to ${l.to.name}`, line: l.lineName, towards: l.towards.join(' / '), stops: l.stops, nextTrains: l.trains ? l.trains.map((t) => `${t.depText} ${t.typeLabel}${t.arrText ? `, arrives ${t.arrText}` : ''}`) : 'timetable not loaded for this leg' })),
      departs: o.departs, arrives: o.arrives, lastLeg: o.finalLeg ? `${o.finalLeg.bus}, then ${o.finalLeg.walk}. ${o.finalLeg.auto}.` : null,
    })),
    note: 'Scheduled times, not live. Stations listed do not mean every train stops there.',
    link: `#/commute?tab=plan&from=${encodeURIComponent(p.from.name)}`,
  }
}
