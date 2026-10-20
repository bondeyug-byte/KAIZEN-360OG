import { describe, it, expect } from 'vitest'
import { H, FLOORS } from '../src/navigator/building.js'
import { RISERS, RISE, R1, R2, TREAD, ENTRY, MID, stairCores, heightAt, rampHeight, landingLevel, stairMove, stairPathAt, LiftSystem, liftAllowed, liftSpecs } from '../src/navigator/vertical.js'

const cores = stairCores()
const W = cores.find((c) => c.id === 'stairs_w')
const laneA = (c) => (c.laneA[0] + c.laneA[1]) / 2, laneB = (c) => (c.laneB[0] + c.laneB[1]) / 2
const rOf = (u) => 74 - u

/** Walk the switchback from floor f to f+1 in small steps, using stairMove like the scene does. */
function climb(core, f) {
  let p = { r: rOf(0.5), a: laneA(core) }, foot = f * H, maxStep = 0
  const go = (to) => { const q = stairMove(p, to, foot); if (q === p) return false; const s = heightAt(q.r, q.a, foot); maxStep = Math.max(maxStep, Math.abs(s.h - foot)); foot = s.h; p = q; return true }
  for (let u = 0.5; u <= (MID[0] + MID[1]) / 2; u += 0.05) if (!go({ r: rOf(u), a: laneA(core) })) return { ok: false, at: 'flight1', u }
  for (let a = laneA(core); a >= laneB(core); a -= 0.1) if (!go({ r: p.r, a })) return { ok: false, at: 'turn', a }
  for (let u = 74 - p.r; u >= 0.5; u -= 0.05) if (!go({ r: rOf(u), a: laneB(core) })) return { ok: false, at: 'flight2', u }
  return { ok: true, foot, level: landingLevel(p.r, p.a, foot), maxStep }
}

describe('stairs geometry', () => {
  it('uses a code-like rise and run', () => {
    expect(RISERS).toBe(27)
    expect(R1 + R2).toBe(27)
    expect(RISE).toBeGreaterThan(0.15); expect(RISE).toBeLessThanOrEqual(0.175)
    expect(TREAD).toBeGreaterThanOrEqual(0.28)
    expect(cores.map((c) => c.id).sort()).toEqual(['stairs_e', 'stairs_w'])
  })
  it('climbs every storey in both cores and arrives on the next floor landing', () => {
    for (const c of cores) for (let f = 0; f < FLOORS - 1; f++) {
      const r = climb(c, f)
      expect(r.ok, `${c.id} ${f}: ${JSON.stringify(r)}`).toBe(true)
      expect(r.level).toBe(f + 1)
      expect(r.foot).toBeCloseTo((f + 1) * H, 6)
      expect(r.maxStep).toBeLessThanOrEqual(RISE + 1e-9)
    }
  })
  it('keeps the same plan point on different storeys apart', () => {
    const r = rOf(ENTRY + 1), a = laneA(W)
    expect(heightAt(r, a, 0).h).toBeCloseTo(4 * RISE, 6)
    expect(heightAt(r, a, 2 * H).h).toBeCloseTo(2 * H + 4 * RISE, 6)
  })
  it('has no flight below the ground floor or above the top floor', () => {
    expect(heightAt(rOf(ENTRY + 1), laneB(W), 0)).toBeNull() // ground: lane B leads nowhere downwards
    expect(heightAt(rOf(ENTRY + 1), laneA(W), (FLOORS - 1) * H)).toBeNull() // top: no flight up
    expect(stairMove({ r: rOf(1), a: laneB(W) }, { r: rOf(ENTRY + 0.3), a: laneB(W) }, 0)).toEqual({ r: rOf(1), a: laneB(W) })
  })
  it('only lets you in and out through the corridor doorway, and not mid-flight', () => {
    const inCorr = { r: 75, a: laneA(W) }
    expect(stairMove(inCorr, { r: 73.5, a: laneA(W) }, 0)).toEqual({ r: 73.5, a: laneA(W) })
    expect(stairMove({ r: 70, a: W.hi + 1 }, { r: 70, a: W.hi - 0.5 }, 0)).toEqual({ r: 70, a: W.hi + 1 }) // through the side wall
    const onFlight = { r: rOf(ENTRY + 1), a: laneA(W) }
    expect(stairMove(onFlight, { r: rOf(ENTRY + 1), a: laneB(W) }, 4 * RISE)).toBe(onFlight) // over the central wall
    expect(rampHeight(onFlight.r, onFlight.a, 4 * RISE)).toBeGreaterThan(0)
  })
  it('gives a continuous path for the navigation marker', () => {
    let last = stairPathAt('stairs_e', 1, 4, 0)
    expect(last.h).toBeCloseTo(H, 6)
    for (let u = 0.01; u <= 1.0001; u += 0.01) { const p = stairPathAt('stairs_e', 1, 4, u); expect(Math.abs(p.h - last.h)).toBeLessThan(0.5); last = p }
    expect(last.h).toBeCloseTo(4 * H, 6)
    expect(stairPathAt('stairs_w', 3, 0, 1).h).toBeCloseTo(0, 6)
  })
})

describe('lifts', () => {
  const run = (L, secs) => { for (let t = 0; t < secs; t += 1 / 30) L.update(1 / 30) }
  it('knows all eight lifts and who may use them', () => {
    expect(liftSpecs().length).toBe(8)
    expect(liftAllowed('lift_s1', 'student')).toBe(true)
    expect(liftAllowed('lift_staff1', 'student')).toBe(false)
    expect(liftAllowed('lift_svc_w', 'cr')).toBe(false)
    expect(liftAllowed('lift_staff1', 'teacher')).toBe(true)
    expect(liftAllowed('lift_svc_e', 'hod')).toBe(true)
  })
  it('goes through the door cycle and travels with easing', () => {
    const seen = [], S = new LiftSystem({ onChange: (L) => L.id === 'lift_s1' && seen[seen.length - 1] !== L.state && seen.push(L.state) })
    expect(S.request('lift_s1', 0)).toBe(true) // already at ground: opens
    run(S, 6)
    expect(seen.slice(0, 3)).toEqual(['DOORS_OPENING', 'OPEN', 'DOORS_CLOSING'])
    expect(S.get('lift_s1').state).toBe('IDLE')
    S.request('lift_s1', 3)
    run(S, 0.5); const L = S.get('lift_s1')
    expect(L.state).toBe('MOVING'); expect(L.pos).toBeGreaterThan(0); expect(L.pos).toBeLessThan(0.5)
    run(S, 6)
    expect(L.level).toBe(3); expect(L.pos).toBe(3); expect(['DOORS_OPENING', 'OPEN']).toContain(L.state)
  })
  it('queues calls, ignores duplicates and invalid floors, and holds the doors', () => {
    const S = new LiftSystem()
    expect(S.request('lift_s2', 7)).toBe(false); expect(S.request('nope', 1)).toBe(false); expect(S.request('lift_s2', 1.5)).toBe(false)
    S.request('lift_s2', 4); S.request('lift_s2', 2); S.request('lift_s2', 2)
    expect(S.get('lift_s2').queue).toEqual([4, 2])
    run(S, 0.1)
    expect(S.get('lift_s2').to).toBe(2) // nearest in the travel direction first
    run(S, 4); expect(S.get('lift_s2').level).toBe(2)
    S.setHold('lift_s2', true); run(S, 10); expect(S.get('lift_s2').state).toBe('OPEN')
    S.setHold('lift_s2', false); run(S, 15); expect(S.get('lift_s2').level).toBe(4)
  })
  it('can be taken out of service', () => {
    const S = new LiftSystem(); S.setAvailable('lift_s3', false)
    expect(S.request('lift_s3', 2)).toBe(false)
    S.setAvailable('lift_s3', true); expect(S.request('lift_s3', 2)).toBe(true)
  })
})
