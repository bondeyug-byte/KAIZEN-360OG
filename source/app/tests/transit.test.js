import { describe, it, expect } from 'vitest'
import { nextTrains, findStation, busesNear, busNext, busEvery, trainCounts, istMinutes } from '../src/lib/transit.js'

// 2026-10-15 08:00 IST == 02:30 UTC
const at = (h, m) => new Date(Date.UTC(2026, 9, 15, h - 5, m - 30))

describe('stations', () => {
  it('finds stations by name and alias', () => {
    expect(findStation('chembur')).toBe('Chembur')
    expect(findStation('Kurla station')).toBe('Kurla')
    expect(findStation('cst')).toBe('CSMT')
    expect(findStation('vashi')).toBe('Vashi')
    expect(findStation('nowhere-ville')).toBe(null)
  })
  it('reads India time', () => { expect(istMinutes(at(8, 0))).toBe(480) })
})

describe('trains', () => {
  it('lists upcoming trains in time order', () => {
    const r = nextTrains({ from: 'Chembur', now: at(8, 0), limit: 8 })
    expect(r.trains.length).toBe(8)
    for (let i = 1; i < r.trains.length; i++) expect(r.trains[i].wait).toBeGreaterThanOrEqual(r.trains[i - 1].wait)
    expect(r.trains[0].wait).toBeLessThan(15)
    expect(r.trains.every((t) => t.line === 'H')).toBe(true)
  })
  it('filters by destination and gives arrival time after departure', () => {
    const r = nextTrains({ from: 'Chembur', to: 'Vashi', now: at(9, 0) })
    expect(r.trains.length).toBeGreaterThan(0)
    for (const t of r.trains) { expect(t.dir).toBe('DN'); expect(t.mins).toBeGreaterThan(0); expect(t.mins).toBeLessThan(40) }
  })
  it('Kurla has both Main and Harbour lines in both directions', () => {
    const c = trainCounts('Kurla')
    for (const k of ['MUP', 'MDN', 'HUP', 'HDN']) expect(c[k]).toBeGreaterThan(100)
  })
  it('fast filter returns only fast trains', () => {
    const r = nextTrains({ from: 'Kurla', to: 'Thane', types: ['F', 'AF'], now: at(18, 0) })
    expect(r.trains.length).toBeGreaterThan(0)
    expect(r.trains.every((t) => t.type === 'F' || t.type === 'AF')).toBe(true)
  })
  it('wraps past midnight', () => {
    const r = nextTrains({ from: 'Kurla', now: at(23, 55), limit: 20 })
    expect(r.trains.length).toBe(20)
    expect(r.trains[0].wait).toBeLessThan(60)
  })
  it('reports unknown stations', () => {
    expect(nextTrains({ from: 'Atlantis' }).error).toMatch(/station/)
  })
})

describe('buses', () => {
  it('derives frequency from sample departures', () => {
    expect(busEvery({ sample: { times: ['04:29', '04:44', '04:59'] } })).toBe(15)
    expect(busEvery({})).toBe(null)
  })
  it('shows a printed departure inside the sampled window', () => {
    const n = busNext({ sample: { toward: 'Airoli', times: ['05:14', '05:29'] }, first: '04:27', last: '02:32' }, at(5, 20))
    expect(n.kind).toBe('sample'); expect(n.text).toMatch(/5:29 AM/)
  })
  it('labels anything else as an estimate or unknown, never an exact time', () => {
    const r = { sample: { toward: 'Airoli', times: ['05:14', '05:29', '05:44'] }, first: '04:27', last: '02:32' }
    expect(busNext(r, at(14, 0)).kind).toBe('estimate')
    expect(busNext(r, at(3, 30)).kind).toBe('closed')
    expect(busNext({ no: 'X' }, at(14, 0)).kind).toBe('unknown')
  })
  it('filters routes by destination', () => {
    const s = busesNear({ toward: 'kurla', now: at(14, 0) })
    expect(s.length).toBeGreaterThan(0)
    expect(s.flatMap((x) => x.routes).every((r) => /kurla/i.test(r.ends.join(' ')))).toBe(true)
  })
})
