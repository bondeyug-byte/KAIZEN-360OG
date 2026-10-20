// Journey planning over the Central Railway suburban network (see src/data/network.js for scope and source).
// Finds the route with the fewest changes, then the fewest stops, using only service patterns that run end to end.
// Train times come from the timetable data where it covers a leg (trains through Kurla or Chembur).
import { NETWORK, LINE_INFO, NETWORK_SOURCE } from '../data/network.js'
import { nextTrains, findStation as findTimetableStation, fmt12, istMinutes } from './transit.js'
import { KNOWLEDGE } from '../assistant/knowledge.js'

export { NETWORK_SOURCE, LINE_INFO }
export const STATIONS = NETWORK.stations
const byCode = Object.fromEntries(STATIONS.map((s) => [s.code, s]))
const byName = Object.fromEntries(STATIONS.map((s) => [s.name.toLowerCase(), s]))
export const stationByName = (n) => byName[String(n || '').toLowerCase()] || null

const ALIASES = {
  Dombivli: ['dombivali', 'dombili', 'dombivili', 'dombivly', 'dombiwali', 'dombivli east', 'dombivli west'],
  CSMT: ['cst', 'vt', 'victoria terminus', 'mumbai cst', 'chhatrapati shivaji maharaj terminus', 'bombay vt'],
  Thane: ['thana'], Kalyan: ['kalyan junction', 'kalyan jn'], Kurla: ['kurla junction', 'lokmanya tilak'],
  'Belapur CBD': ['belapur', 'cbd belapur', 'cbd'], 'Seawoods-Darave': ['seawoods', 'darave', 'seawood'],
  'Vile Parle': ['vileparle', 'parle'], 'Kopar Khairane': ['koparkhairane', 'kopar khairne'], Sion: ['shiv'],
  'Uran City': ['uran'], 'GTB Nagar': ['guru tegh bahadur nagar', 'gtb'], 'Ram Mandir': ['ram mandir road'],
  Vithalwadi: ['vitthalwadi'], Ulhasnagar: ['ulhas nagar'], Kalva: ['kalwa'], Kanjurmarg: ['kanjur marg', 'kanjur'],
  'Digha Gaon': ['digha'], Panvel: ['panvel junction'], Nerul: ['nerul junction'], Vadala: [], 'Vadala Road': ['wadala', 'vadala'],
  Chinchpokli: ['chinchpokali'], Umbermali: ['umbermalli'], Khadavli: ['khadavali'], Ghatkopar: ['ghatkoper'], 'Tilak Nagar': ['tilaknagar'],
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const keys = STATIONS.map((s) => ({ s, names: [s.name, s.code, ...(ALIASES[s.name] || [])].map(norm) }))

/** Search stations by name, code, alias or a near-miss spelling ("Dombili" → Dombivli). */
export function searchStations(q, limit = 8) {
  const t = norm(q)
  if (!t) return []
  const out = []
  for (const { s, names } of keys) {
    let score = 0, fuzzy = false
    for (const n of names) {
      if (n === t) score = Math.max(score, 100)
      else if (n.startsWith(t)) score = Math.max(score, 80 - n.length / 10)
      else if (n.split(' ').some((w) => w.startsWith(t))) score = Math.max(score, 60)
      else if (t.length >= 3 && n.includes(t)) score = Math.max(score, 40)
      else if (t.length >= 4) {
        const dist = Math.min(lev(t, n), ...n.split(' ').map((w) => lev(t, w)))
        const allowed = t.length >= 7 ? 2 : 1
        if (dist <= allowed) { score = Math.max(score, 30 - dist * 5); fuzzy = true }
      }
    }
    if (score > 0) out.push({ station: s, score, fuzzy: fuzzy && score < 40 })
  }
  return out.sort((a, b) => b.score - a.score || a.station.name.localeCompare(b.station.name)).slice(0, limit)
}
export const resolveStation = (q) => stationByName(q) || searchStations(q, 1)[0]?.station || null

// ---------- routing (Dijkstra over station × service pattern) ----------
const TRANSFER = 100
function shortest(fromCode, toCode) {
  const routes = NETWORK.routes
  const key = (c, r) => c + '|' + r
  const dist = new Map(), prev = new Map(), queue = []
  for (const r of routes) if (r.stations.includes(fromCode)) { dist.set(key(fromCode, r.id), 0); queue.push([0, fromCode, r.id]) }
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0])
    const [d, c, rid] = queue.shift()
    if (d > (dist.get(key(c, rid)) ?? Infinity)) continue
    if (c === toCode) return unwind(prev, key(c, rid), d)
    const r = routes.find((x) => x.id === rid)
    const i = r.stations.indexOf(c)
    const nexts = [[r.stations[i - 1], rid, 1], [r.stations[i + 1], rid, 1], ...routes.filter((x) => x.id !== rid && x.stations.includes(c)).map((x) => [c, x.id, TRANSFER])]
    for (const [nc, nr, w] of nexts) {
      if (!nc) continue
      const k = key(nc, nr), nd = d + w
      if (nd < (dist.get(k) ?? Infinity)) { dist.set(k, nd); prev.set(k, key(c, rid)); queue.push([nd, nc, nr]) }
    }
  }
  return null
}
function unwind(prev, k, cost) {
  const path = [k]
  while (prev.has(path[0])) path.unshift(prev.get(path[0]))
  return { cost, path: path.map((p) => { const [c, r] = p.split('|'); return { c, r } }) }
}

function towards(fromCode, toCode, line) {
  // Terminals of every service pattern on this line that runs from → to in that direction.
  const ends = new Set()
  for (const r of NETWORK.routes) {
    if (r.line !== line) continue
    const a = r.stations.indexOf(fromCode), b = r.stations.indexOf(toCode)
    if (a < 0 || b < 0) continue
    ends.add(byCode[b > a ? r.stations[r.stations.length - 1] : r.stations[0]].name)
  }
  return [...ends]
}

/** Station-level route: legs with line, direction and stop count. */
export function routeBetween(fromName, toName) {
  const A = resolveStation(fromName), B = resolveStation(toName)
  if (!A || !B) return null
  if (A.code === B.code) return { from: A, to: B, legs: [], transfers: 0, stops: 0 }
  const res = shortest(A.code, B.code)
  if (!res) return null
  const legs = []
  for (let i = 1; i < res.path.length; i++) {
    const p = res.path[i - 1], q = res.path[i]
    if (p.c === q.c) continue // a change of service at the same station
    const last = legs[legs.length - 1]
    if (last && last.routeId === q.r) { last.toCode = q.c; last.stops++ } else legs.push({ routeId: q.r, fromCode: p.c, toCode: q.c, stops: 1 })
  }
  // Merge consecutive legs on the same line where one service pattern covers both (e.g. trunk + branch).
  const merged = []
  for (const l of legs) {
    const prevLeg = merged[merged.length - 1]
    const cover = prevLeg && NETWORK.routes.find((r) => r.stations.includes(prevLeg.fromCode) && r.stations.includes(l.toCode) && r.stations.includes(l.fromCode) && Math.sign(r.stations.indexOf(l.fromCode) - r.stations.indexOf(prevLeg.fromCode)) === Math.sign(r.stations.indexOf(l.toCode) - r.stations.indexOf(l.fromCode)))
    if (cover) { prevLeg.toCode = l.toCode; prevLeg.stops += l.stops; prevLeg.routeId = cover.id } else merged.push({ ...l })
  }
  const out = merged.map((l) => {
    const r = NETWORK.routes.find((x) => x.id === l.routeId)
    return { line: r.line, lineName: LINE_INFO[r.line].name, color: LINE_INFO[r.line].color, from: byCode[l.fromCode], to: byCode[l.toCode], stops: l.stops, towards: towards(l.fromCode, l.toCode, r.line) }
  })
  return { from: A, to: B, legs: out, transfers: out.length - 1, stops: out.reduce((n, l) => n + l.stops, 0) }
}

// ---------- timetable for a leg (where the data covers it) ----------
function legTrains(leg, at, limit = 3) {
  const f = findTimetableStation(leg.from.name), t = findTimetableStation(leg.to.name)
  if (!f || !t) return null
  const r = nextTrains({ from: f, to: t, now: at, limit })
  if (r.error || !r.trains.length) return null
  return r.trains
}

const lastLeg = (station) => {
  const k = KNOWLEDGE.find((e) => e.id === (station === 'Kurla' ? 'reach-kurla' : 'reach-chembur'))
  return station === 'Kurla'
    ? { bus: 'BEST 432 from Kurla (E) bus station to the Vivekanand College stop', walk: 'about 9 min walk', auto: 'Auto: about 3.9 km', source: k.source }
    : { bus: 'BEST 364 from Chembur (E) to the Chembur Camp stop', walk: 'about 10 min walk', auto: 'Auto: about 3.3 km', source: k.source }
}

/**
 * Plan from a station to VESIT (via Chembur and via Kurla) or to another station.
 * Returns options sorted best first. Times are chained leg by leg when the timetable covers every leg.
 */
export function planJourney({ from, to = 'campus', now = new Date() } = {}) {
  const A = resolveStation(from)
  if (!A) return { error: `No station matches "${from}". Try the full name, e.g. Dombivli, Thane or Vashi.` }
  const targets = to === 'campus' ? ['Chembur', 'Kurla'] : [resolveStation(to)?.name].filter(Boolean)
  if (!targets.length) return { error: `No station matches "${to}".` }
  const options = []
  for (const tn of targets) {
    const r = routeBetween(A.name, tn)
    if (!r) continue
    // Chain times
    let at = now, timed = true
    const legs = r.legs.map((l, i) => {
      const trains = timed ? legTrains(l, at) : null
      if (!trains) timed = false
      let first = null
      if (trains) {
        first = trains[0]
        const arrMin = first.arr ?? first.dep
        const waitAndRide = ((arrMin - istMinutes(at)) + 1440) % 1440
        at = new Date(at.getTime() + (waitAndRide + (i < r.legs.length - 1 ? 4 : 0)) * 60000) // 4 min to change platforms
      }
      return { ...l, trains, first }
    })
    const firstDep = legs[0]?.first?.dep
    const lastArr = legs[legs.length - 1]?.first?.arr
    options.push({
      via: tn, route: r, legs, transfers: r.transfers, stops: r.stops,
      timed: timed && legs.length > 0, departs: timed && firstDep != null ? fmt12(firstDep) : null, arrives: timed && lastArr != null ? fmt12(lastArr) : null,
      rideMins: timed && firstDep != null && lastArr != null ? ((lastArr - firstDep) + 1440) % 1440 : null,
      finalLeg: to === 'campus' ? lastLeg(tn) : null,
      atStart: r.legs.length === 0,
    })
  }
  options.sort((a, b) => a.transfers - b.transfers || a.stops - b.stops)
  if (options[0]) options[0].best = true
  return { from: A, to: to === 'campus' ? 'VESIT campus' : targets[0], options }
}
