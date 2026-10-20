// Stairs and lifts: geometry rules, walkable heights, floor transitions and the lift state machine.
// Pure JavaScript (no Three.js, no DOM) so it can be unit-tested and survives WebGL context loss.
//
// Plan coordinates are polar like building.js: radius r (m) and angle a (degrees); heights in metres.
// Both stair cores sit on the courtyard side, r 64–74, with their doorway on the corridor wall at r = 74.
import { H, FLOORS, floorPlaces, CONNECTORS } from './building.js'

/* ============================== stairs ============================== */
export const RISER_TARGET = 0.17, TREAD = 0.28
export const RISERS = Math.ceil(H / RISER_TARGET)          // 27 risers per storey
export const RISE = H / RISERS                             // 0.1667 m each
export const R1 = Math.ceil(RISERS / 2), R2 = RISERS - R1  // 14 risers up to the mid-landing, 13 after it
const DOOR_R = 74                                          // corridor-side edge of the core
export const ENTRY = 1.4                                   // depth of the floor landing inside the core (m)
export const RUN1 = (R1 - 1) * TREAD                       // 13 treads of 0.28 m = 3.64 m
export const MID = [ENTRY + RUN1, ENTRY + RUN1 + 1.45]     // mid-landing depth range (m from the door line)
export const RUN2 = RUN1, TREAD2 = RUN2 / (R2 - 1)          // flight 2 covers the same run with 12 treads (0.303 m)
const LANE_GAP = 0.06                                      // central wall between the two flights (degrees)

/** Stair cores with their angles. Lane A (flight up from a floor) is the higher-angle half, lane B the other. */
export function stairCores() {
  return floorPlaces(1).filter((p) => p.type === 'stairs').map((p) => {
    const mid = (p.lo + p.hi) / 2
    return { id: p.id, lo: p.lo, hi: p.hi, mid, laneA: [mid + LANE_GAP, p.hi - 0.12], laneB: [p.lo + 0.12, mid - LANE_GAP] }
  })
}
const CORES = stairCores()
export const coreAt = (r, a) => CORES.find((c) => r >= 64 && r <= DOOR_R && a >= c.lo && a <= c.hi) || null
const depthOf = (r) => DOOR_R - r // metres into the core from the corridor wall
const inLane = (lane, a) => a >= lane[0] && a <= lane[1]

/**
 * Walkable surfaces in a core at plan point (r, a): every stair storey k (floor k → k+1) contributes
 * flight 1 (lane A, rising inward), the mid-landing, and flight 2 (lane B, rising back to the door line).
 * Floor landings (depth < ENTRY) exist at every level 0…FLOORS-1.
 */
function surfaces(core, r, a) {
  const u = depthOf(r), out = []
  if (u < 0 || u > 10) return out
  if (u <= ENTRY) { for (let f = 0; f < FLOORS; f++) out.push({ h: f * H, kind: 'landing', level: f }); return out }
  for (let k = 0; k < FLOORS - 1; k++) {
    const base = k * H
    if (u >= MID[0] && u <= MID[1]) { out.push({ h: base + R1 * RISE, kind: 'mid', storey: k }); continue }
    if (u > MID[1]) continue
    if (inLane(core.laneA, a)) { // flight 1: step i (1..R1-1) covers depth ENTRY+(i-1)*TREAD … ENTRY+i*TREAD at height i*RISE
      const i = Math.min(R1 - 1, Math.floor((u - ENTRY) / TREAD) + 1)
      out.push({ h: base + i * RISE, kind: 'flight1', storey: k, step: i })
    } else if (inLane(core.laneB, a)) { // flight 2 runs back towards the door, rising
      const j = Math.min(R2 - 1, Math.floor((MID[0] - u) / TREAD2) + 1) // 1 at the mid-landing end
      out.push({ h: base + R1 * RISE + j * RISE, kind: 'flight2', storey: k, step: j })
    }
  }
  return out
}

/**
 * Height of the walkable surface under (r, a) that continues from the walker's current foot height `ref`
 * (so the same plan point on different storeys never gets confused). null = not walkable here.
 * Smooth version: steps are treated as a ramp for the eye (ease), while `step` keeps the discrete tread.
 */
export function heightAt(r, a, ref) {
  const core = coreAt(r, a)
  if (!core) return null
  let best = null
  for (const s of surfaces(core, r, a)) if (Math.abs(s.h - ref) <= 0.75 && (!best || Math.abs(s.h - ref) < Math.abs(best.h - ref))) best = s
  return best
}

/** Continuous (ramp) height along a flight, used for smooth eye movement and the navigation marker. */
export function rampHeight(r, a, ref) {
  const s = heightAt(r, a, ref)
  if (!s) return null
  const u = depthOf(r), k = s.storey
  if (s.kind === 'flight1') return k * H + Math.max(0, Math.min(R1 * RISE, ((u - ENTRY) / RUN1) * R1 * RISE))
  if (s.kind === 'flight2') return k * H + R1 * RISE + Math.max(0, Math.min(R2 * RISE, ((MID[0] - u) / RUN2) * R2 * RISE))
  return s.h
}

/** Floor level the walker is standing on, or null while between floors (flights and mid-landings). */
export function landingLevel(r, a, footH) {
  const s = heightAt(r, a, footH)
  return s && s.kind === 'landing' ? s.level : null
}

/**
 * Movement rule inside/around a stair core. Returns the accepted point (maybe the old one when blocked).
 * - The core is entered and left only through its doorway on the corridor wall (r = 74).
 * - Between landings you stay in your flight's lane (the central wall separates the two flights).
 * - There is no flight below the ground floor or above the top floor.
 */
export function stairMove(from, to, footH) {
  const cFrom = coreAt(from.r, from.a), cTo = coreAt(to.r, to.a)
  if (!cFrom && !cTo) return to
  if (!cFrom && cTo) return to.a > cTo.lo + 0.1 && to.a < cTo.hi - 0.1 && depthOf(to.r) <= ENTRY && landingLevel(to.r, to.a, footH) !== null ? to : from
  if (cFrom && !cTo) return depthOf(from.r) <= ENTRY + 0.05 && to.r >= DOOR_R - 0.05 && landingLevel(from.r, from.a, footH) !== null ? to : from
  if (cFrom.id !== cTo.id) return from
  const s = heightAt(to.r, to.a, footH)
  if (!s) return from // e.g. the wall between lanes, or under the ground-floor flight
  const ud = depthOf(to.r)
  if (ud > ENTRY && ud < MID[0]) { // on a flight: no switching lanes
    const laneOf = (a) => (inLane(cTo.laneA, a) ? 'A' : inLane(cTo.laneB, a) ? 'B' : null)
    const lf = depthOf(from.r) > ENTRY && depthOf(from.r) < MID[0] ? laneOf(from.a) : null
    if (lf && laneOf(to.a) !== lf) return from
  }
  if (Math.abs(s.h - footH) > 0.45) return from // never jump more than a couple of risers
  return to
}

/** Path through a core between two floors as a function of u ∈ [0, 1] (navigation marker on the stairs). */
export function stairPathAt(coreId, fromF, toF, u) {
  const core = CORES.find((c) => c.id === coreId) || CORES[0]
  const n = Math.abs(toF - fromF), up = toF > fromF
  const t = Math.max(0, Math.min(1, u)) * n, k = Math.min(n - 1, Math.floor(t)), w = t - k
  const storey = up ? fromF + k : fromF - k - 1
  const wq = up ? w : 1 - w // progress within the storey, measured upwards
  const aA = (core.laneA[0] + core.laneA[1]) / 2, aB = (core.laneB[0] + core.laneB[1]) / 2
  // upward route within one storey: door → flight 1 (lane A, inward) → mid-landing → flight 2 (lane B, outward)
  const legs = [[ENTRY / 2, aA, 0], [ENTRY, aA, 0], [MID[0], aA, R1 * RISE], [(MID[0] + MID[1]) / 2, (aA + aB) / 2, R1 * RISE], [MID[0], aB, R1 * RISE], [ENTRY, aB, H], [ENTRY / 2, aB, H]]
  const lens = []; let tot = 0
  for (let i = 1; i < legs.length; i++) { const d = Math.hypot(legs[i][0] - legs[i - 1][0], legs[i][2] - legs[i - 1][2]) + Math.abs(legs[i][1] - legs[i - 1][1]) * 0.07; lens.push(d); tot += d }
  let s = wq * tot, i = 0
  while (i < lens.length - 1 && s > lens[i]) { s -= lens[i]; i++ }
  const q = lens[i] ? s / lens[i] : 0, A = legs[i], B = legs[i + 1]
  return { r: DOOR_R - (A[0] + (B[0] - A[0]) * q), a: A[1] + (B[1] - A[1]) * q, h: storey * H + A[2] + (B[2] - A[2]) * q }
}

/* ============================== lifts ============================== */
export const LIFT_STATES = ['IDLE', 'DOORS_OPENING', 'OPEN', 'DOORS_CLOSING', 'MOVING', 'ARRIVE']
const DOOR_TIME = 1.1, DWELL = 3.2, START = 1.6, PER_FLOOR = 1.15

/** Who may use which lift. Students: student lifts only. Staff (teacher, HOD, admin): every lift. */
export function liftAllowed(id, role) {
  if (CONNECTORS.student.includes(id)) return true
  return ['teacher', 'hod', 'admin'].includes(role)
}
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

/** Lift geometry (shaft rectangle in plan) from the building data. Inner lifts open to the corridor at r = 74,
 *  outer (staff) lifts at r = 78. */
export function liftSpecs() {
  return floorPlaces(1).filter((p) => p.type === 'lift').map((p) => {
    const inner = p.side === 'inner'
    return { id: p.id, name: p.short, sub: p.sub, lo: p.lo + 0.22, hi: p.hi - 0.22, am: (p.lo + p.hi) / 2, door: inner ? 73.9 : 78.1, back: inner ? 71.25 : 80.75, inner }
  })
}

export class LiftSystem {
  constructor({ floors = FLOORS, onChange, reducedMotion = false } = {}) {
    this.floors = floors
    this.doorTime = reducedMotion ? 0.25 : DOOR_TIME // prefers-reduced-motion: doors snap instead of sliding
    this.onChange = onChange || (() => {})
    this.lifts = new Map(liftSpecs().map((s) => [s.id, { ...s, pos: 0, level: 0, state: 'IDLE', doorT: 0, t: 0, queue: [], from: 0, to: 0, dur: 0, hold: false, lock: false, available: true, dir: 0, calls: new Set() }]))
  }
  get(id) { return this.lifts.get(id) }
  validFloor(f) { return Number.isInteger(f) && f >= 0 && f < this.floors }
  /** Landing call (outside) or destination (inside). Duplicates are ignored. Returns false when refused. */
  request(id, f) {
    const L = this.lifts.get(id)
    if (!L || !L.available || !this.validFloor(f)) return false
    L.calls.add(f)
    const atFloor = L.state !== 'MOVING' && L.level === f
    if (atFloor) { // already here: (re)open the doors
      L.calls.delete(f)
      if (L.state === 'IDLE' || L.state === 'DOORS_CLOSING') { L.state = 'DOORS_OPENING'; this.changed(L) }
      else if (L.state === 'OPEN') { L.t = 0 } // restart the dwell
      return true
    }
    if (!L.queue.includes(f) && !(L.state === 'MOVING' && L.to === f)) L.queue.push(f)
    this.changed(L)
    return true
  }
  /** Cancel queued (not yet started) trips, e.g. on Escape. A running trip finishes to keep the cab consistent. */
  cancel(id) { const L = this.lifts.get(id); if (!L) return; L.queue = []; L.calls = new Set(L.state === 'MOVING' ? [L.to] : []); this.changed(L) }
  /** Keep doors open while someone stands in the doorway. */
  setHold(id, on) { const L = this.lifts.get(id); if (L) L.hold = !!on }
  setAvailable(id, on) { const L = this.lifts.get(id); if (!L) return; L.available = !!on; if (!on) this.cancel(id) }
  changed(L) { this.onChange(L) }
  /** Advance every lift by dt seconds. Returns true while anything is moving (the scene keeps rendering). */
  update(dt) {
    let busy = false
    for (const L of this.lifts.values()) {
      if (L.lock) continue // driven directly by route navigation
      const before = L.state + L.level + (L.doorT > 0 ? 1 : 0)
      switch (L.state) {
        case 'IDLE':
          if (L.queue.length) this.depart(L)
          break
        case 'DOORS_OPENING':
          L.doorT = Math.min(1, L.doorT + dt / this.doorTime); busy = true
          if (L.doorT >= 1) { L.state = 'OPEN'; L.t = 0 }
          break
        case 'OPEN':
          L.t += dt; busy = true
          if (!L.hold && L.t >= DWELL) L.state = 'DOORS_CLOSING'
          break
        case 'DOORS_CLOSING':
          if (L.hold) { L.state = 'DOORS_OPENING'; break }
          L.doorT = Math.max(0, L.doorT - dt / this.doorTime); busy = true
          if (L.doorT <= 0) { L.state = 'IDLE'; if (L.queue.length) this.depart(L) }
          break
        case 'MOVING': {
          L.t += dt; busy = true
          const k = Math.min(1, L.t / L.dur)
          L.pos = L.from + (L.to - L.from) * ease(k)
          const lvl = Math.round(L.pos); if (lvl !== L.level && Math.abs(L.pos - lvl) < 0.02) L.level = lvl
          if (k >= 1) { L.pos = L.to; L.level = L.to; L.state = 'ARRIVE' }
          break
        }
        case 'ARRIVE':
          L.calls.delete(L.level); L.dir = 0; L.state = 'DOORS_OPENING'; busy = true
          break
      }
      if (before !== L.state + L.level + (L.doorT > 0 ? 1 : 0)) this.changed(L)
    }
    return busy
  }
  depart(L) {
    // Serve the nearest request in the current direction first (simple collective control), otherwise the oldest.
    const ahead = L.queue.filter((f) => (L.dir >= 0 ? f > L.level : f < L.level)).sort((x, y) => Math.abs(x - L.level) - Math.abs(y - L.level))
    const next = ahead[0] ?? L.queue[0]
    L.queue = L.queue.filter((f) => f !== next)
    if (next === L.level) { L.state = 'DOORS_OPENING'; L.calls.delete(next); return }
    L.from = L.level; L.to = next; L.t = 0; L.dir = Math.sign(next - L.level)
    L.dur = START + PER_FLOOR * Math.abs(next - L.level)
    L.state = 'MOVING'
  }
  /** Plain snapshot (for UI and recovery). */
  snapshot(id) { const L = this.lifts.get(id); return L && { id, pos: L.pos, level: L.level, state: L.state, doorT: L.doorT, queue: [...L.queue], calls: [...L.calls], dir: L.dir, available: L.available } }
}
