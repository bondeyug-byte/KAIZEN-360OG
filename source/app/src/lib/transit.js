import TRAINS from '../data/trains.json'
import { BUS_STOPS, BUS_SOURCE } from '../data/buses.js'

export const TRAIN_SOURCE = { text: TRAINS.source, effective: TRAINS.effective, count: TRAINS.trains.length }
export const TYPE_LABEL = { S: 'Slow', F: 'Fast', AS: 'AC Slow', AF: 'AC Fast' }
export const LINE_LABEL = { M: 'Main line', H: 'Harbour line' }
export const HOME_STATIONS = ['Kurla', 'Chembur']

const ST = TRAINS.stations
const idxOf = Object.fromEntries(ST.map((n, i) => [n.toLowerCase(), i]))

const ALIASES = { 'seawoods-darave': 'Seawoods Darave Karave', 'seawoods darave': 'Seawoods Darave Karave', cst: 'CSMT', vt: 'CSMT', 'mumbai cst': 'CSMT', 'chhatrapati shivaji': 'CSMT', csmt: 'CSMT', 'tilaknagar': 'Tilak Nagar', 'belapur': 'Belapur CBD', 'seawoods': 'Seawoods Darave Karave', 'vadala': 'Vadala Road', 'vileparle': 'Vile Parle', 'kalyan jn': 'Kalyan', 'panvel jn': 'Panvel', 'gtb': 'GTB Nagar', 'ghatkoper': 'Ghatkopar', 'kurla station': 'Kurla', 'chembur station': 'Chembur', 'ram mandir': 'Ram Mandir', 'nerul jn': 'Nerul' }

/** Fuzzy station lookup used by the UI and voice assistant. */
export function findStation(q) {
  if (!q) return null
  const s = String(q).toLowerCase().replace(/station|stn|railway/g, '').trim()
  if (ALIASES[s]) return ALIASES[s]
  if (idxOf[s] != null) return ST[idxOf[s]]
  const hit = ST.find((n) => n.toLowerCase().startsWith(s)) || ST.find((n) => n.toLowerCase().includes(s)) || ST.find((n) => s.includes(n.toLowerCase()))
  return hit || null
}
export const allStations = () => [...ST].sort()

/** Minutes since midnight in India time. */
export function istMinutes(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const h = +p.find((x) => x.type === 'hour').value % 24, m = +p.find((x) => x.type === 'minute').value
  return h * 60 + m
}
export function istDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(now)
}
export const hhmm = (m) => { m = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }
export function fmt12(m) {
  m = ((m % 1440) + 1440) % 1440
  const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0')
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? 'AM' : 'PM'}`
}

function directionText(line, dir, fromName) {
  if (line === 'H') return dir === 'UP' ? 'Towards CSMT / Andheri' : 'Towards Vashi / Panvel'
  return dir === 'UP' ? 'Towards CSMT' : 'Towards Thane / Kalyan'
}

/**
 * Next departures from a station.
 * opts: { from, to, line ('M'|'H'), dir ('UP'|'DN'), types (array of S/F/AS/AF), now (Date), limit }
 */
export function nextTrains({ from = 'Chembur', to, line, dir, types, now = new Date(), limit = 6 } = {}) {
  const fromName = findStation(from)
  if (!fromName) return { error: `I don't have a station called "${from}". Try Kurla or Chembur.` }
  if (!HOME_STATIONS.includes(fromName) && !to) return { error: `Timetables here cover trains through Kurla and Chembur. Try "from Kurla" or "from Chembur".` }
  const toName = to ? findStation(to) : null
  if (to && !toName) return { error: `I couldn't find a station called "${to}".` }
  const fi = idxOf[fromName.toLowerCase()], ti = toName ? idxOf[toName.toLowerCase()] : null
  const nowMin = istMinutes(now)
  const out = []
  for (const [no, code, type, ln, dr, stops] of TRAINS.trains) {
    if (line && ln !== line) continue
    if (dir && dr !== dir) continue
    if (types && types.length && !types.includes(type)) continue
    const a = stops.findIndex((s) => s[0] === fi)
    if (a < 0 || a === stops.length - 1) continue
    let arr = null
    if (ti != null) {
      const b = stops.findIndex((s, k) => k > a && s[0] === ti)
      if (b < 0) continue
      arr = stops[b][1]
    }
    const dep = stops[a][1]
    const wait = (((dep % 1440) - nowMin) + 1440) % 1440
    out.push({
      no, code, type, typeLabel: TYPE_LABEL[type], line: ln, lineLabel: LINE_LABEL[ln], dir: dr, direction: directionText(ln, dr, fromName),
      from: fromName, to: toName, dest: ST[stops[stops.length - 1][0]], origin: ST[stops[0][0]],
      dep: dep % 1440, depText: fmt12(dep), wait, arr: arr == null ? null : arr % 1440, arrText: arr == null ? null : fmt12(arr), mins: arr == null ? null : arr - dep,
    })
  }
  out.sort((x, y) => x.wait - y.wait || x.no.localeCompare(y.no))
  return { from: fromName, to: toName, nowText: fmt12(nowMin), trains: out.slice(0, limit), total: out.length }
}

/** Counts per station/direction, for the summary chips. */
export function trainCounts(station) {
  const fi = idxOf[station.toLowerCase()]
  const c = {}
  for (const [, , , ln, dr, stops] of TRAINS.trains) {
    const a = stops.findIndex((s) => s[0] === fi)
    if (a < 0 || a === stops.length - 1) continue
    const k = ln + dr
    c[k] = (c[k] || 0) + 1
  }
  return c
}

// ---------- buses ----------
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

/** Gap between the sample departures (median), or null. */
export function busEvery(r) {
  const t = r.sample?.times?.map(toMin)
  if (!t || t.length < 2) return null
  const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}

/**
 * What we can honestly say about the next bus on a route.
 * kind: 'sample' (an actual printed departure is still ahead in the sampled window),
 *       'estimate' (frequency known, outside the window), 'unknown'.
 */
export function busNext(r, now = new Date()) {
  const nowMin = istMinutes(now)
  const every = busEvery(r)
  const times = r.sample?.times?.map(toMin) || []
  const ahead = times.find((t) => t >= nowMin && t - nowMin <= 60)
  if (ahead != null) return { kind: 'sample', text: `${fmt12(ahead)} towards ${r.sample.toward}`, wait: ahead - nowMin, every }
  if (r.last && r.first) {
    const first = toMin(r.first), last = toMin(r.last)
    const inService = last < first ? (nowMin >= first || nowMin <= last) : (nowMin >= first && nowMin <= last)
    if (!inService) return { kind: 'closed', text: `Not running now. First bus about ${fmt12(first)}.`, every }
  }
  if (every) return { kind: 'estimate', text: `Roughly every ${every} min, so usually a wait of up to ${every} min (estimate).`, wait: null, every }
  return { kind: 'unknown', text: 'Timings not published. Check the BEST Chalo app.', every: null }
}

export function busesNear({ toward, now = new Date() } = {}) {
  const q = toward ? String(toward).toLowerCase() : null
  return BUS_STOPS.map((s) => ({
    ...s,
    routes: s.routes
      .filter((r) => !q || r.ends.join(' ').toLowerCase().includes(q) || r.no.toLowerCase().replace(/\s/g, '') === q.replace(/\s/g, ''))
      .map((r) => ({ ...r, every: busEvery(r), next: busNext(r, now) })),
  })).filter((s) => s.routes.length)
}
export { BUS_STOPS, BUS_SOURCE }
