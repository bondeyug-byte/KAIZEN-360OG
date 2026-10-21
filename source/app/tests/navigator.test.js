import { describe, it, expect } from 'vitest'
import { floorPlaces, allPlaces, buildRoute, place, LOGGIA } from '../src/navigator/building.js'

describe('campus structure', () => {
  it('the amphitheatre is inside the curve, within the building line (no projection into the courtyard)', () => {
    const a = place(2, 'amphi')
    expect(a.r1).toBeGreaterThanOrEqual(64) // courtyard face of the curve is r = 64
    expect(a.r2).toBeLessThanOrEqual(74) // stops at the corridor wall
    for (const p of allPlaces()) expect(p.r1).toBeGreaterThanOrEqual(64)
  })
  it('lifts and stairs line up on every floor and sit outside the open terrace stretch', () => {
    const cores = (f) => floorPlaces(f).filter((p) => p.type === 'lift' || p.type === 'stairs').map((p) => `${p.id}@${p.lo.toFixed(2)}`).sort()
    for (let f = 1; f < 6; f++) expect(cores(f)).toEqual(cores(0))
    for (const p of floorPlaces(2)) if ((p.type === 'lift' || p.type === 'stairs') && p.side === 'inner') expect(p.hi <= LOGGIA.lo + 1e-6 || p.lo >= LOGGIA.hi - 1e-6).toBe(true)
  })
  it('floors 2–3 have no rooms where the terrace is open', () => {
    for (const f of [2, 3, 4]) for (const p of floorPlaces(f)) if (p.side === 'inner' && p.id !== 'balcony') expect(p.hi <= LOGGIA.lo + 1e-6 || p.lo >= LOGGIA.hi - 1e-6).toBe(true)
  })
  it('every place is reachable from the main lobby by lift and by stairs', () => {
    for (const p of allPlaces()) for (const mode of ['student', 'stairs']) {
      const R = buildRoute({ f: 0, id: 'lobby' }, { f: p.f, id: p.id }, mode)
      expect(R).toBeTruthy()
      if (!R.same) expect(R.steps.length).toBeGreaterThan(0)
    }
  })
  it('routes to the amphitheatre enter through the central doors (angle 90) from the corridor', () => {
    const R = buildRoute({ f: 0, id: 'lobby' }, { f: 2, id: 'amphi' })
    const last = R.pts.slice(-2)
    expect(last.every((q) => Math.abs(q.a - 90) < 1e-6)).toBe(true)
    expect(last[last.length - 1].r).toBeGreaterThanOrEqual(64)
  })
})

describe('left = laboratories, right = classrooms (fixed orientation)', () => {
  it('every teaching room is classified by its side, on every floor', async () => {
    const { allPlaces, LEFT_OF } = await import('../src/navigator/building.js')
    const teach = allPlaces().filter((p) => p.type === 'lab' || p.type === 'room')
    expect(teach.length).toBeGreaterThan(80)
    for (const p of teach) expect(p.type).toBe(LEFT_OF(p.am) ? 'lab' : 'room')
  })
  it('lifts, stairs and the amphitheatre keep their positions', async () => {
    const { place } = await import('../src/navigator/building.js')
    expect(place(2, 'lift_staff1').lo).toBeCloseTo(108.786, 2)
    expect(place(2, 'lift_staff2').hi).toBeCloseTo(71.214, 2)
    expect(place(2, 'amphi')).toBeTruthy()
    expect(place(3, 'stairs_w')).toBeTruthy()
  })
  it('every timetable, directory and event location still exists and agrees with its type', async () => {
    const { place } = await import('../src/navigator/building.js')
    const { makeSeed, timetableForClass } = await import('../src/data/seed.js')
    const db = makeSeed()
    const refs = [...['FE-A', 'FE-B', 'FE-C', 'SE-A'].flatMap((c) => timetableForClass(c).map((t) => t.place)), ...db.shared.directory.map((d) => d.place), ...db.shared.events.map((e) => e.place)]
    for (const r of refs) expect(place(r.f, r.id), `${r.f}/${r.id}`).toBeTruthy()
    for (const d of db.shared.directory.filter((x) => x.category === 'lab')) expect(place(d.place.f, d.place.id).type).toBe('lab')
  })
})

import { BOARDS, FLOOR_DEPT } from '../src/navigator/building.js'
describe('real floor boards (photos, 21 Oct 2026)', () => {
  it('every room number on every board is on the map exactly once', () => {
    for (const f of [1, 2, 3, 4, 5]) {
      const codes = floorPlaces(f).map((p) => p.code)
      const B = BOARDS[f], want = [...B.left, B.hod, ...B.right].map((x) => x.split(':').length > 1 ? x.split(':')[1] : x)
      for (const c of want) expect(codes.filter((x) => x === c), `floor ${f} room ${c}`).toHaveLength(1)
    }
  })
  it('HOD offices, departments, server room, central arcades and toilets', () => {
    expect(place(3, 'r15')).toMatchObject({ type: 'office', code: '304', dept: 'Computer Engineering' })
    expect(floorPlaces(1).find((p) => p.code === 'B11')).toMatchObject({ type: 'office' })
    expect(floorPlaces(5).filter((p) => p.type === 'office').map((p) => p.code).sort()).toEqual(['504', '508'])
    expect(floorPlaces(3).find((p) => p.code === '306B').name).toMatch(/Server room/)
    expect(place(2, 'amphi').code).toBe('CA-2'); expect(place(4, 'balcony').code).toBe('CA-4')
    expect(place(2, 'wc_1').short).toMatch(/accessible/)
    expect(FLOOR_DEPT[4]).toMatch(/Telecommunication/)
  })
  it('west-block rooms are reachable by route', () => {
    const w = floorPlaces(1).find((p) => p.code === '120')
    const R = buildRoute({ f: 0, id: 'lobby' }, { f: 1, id: w.id }, 'stairs')
    expect(R && R.total).toBeGreaterThan(10)
  })
})
