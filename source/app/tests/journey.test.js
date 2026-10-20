import { describe, it, expect } from 'vitest'
import { searchStations, routeBetween, planJourney, STATIONS, NETWORK_SOURCE } from '../src/lib/journey.js'
import { NETWORK } from '../src/data/network.js'

const at = (h, m) => new Date(Date.UTC(2026, 9, 15, h - 5, m - 30)) // Thu IST

describe('station search', () => {
  it('finds Dombivli by exact name, misspelling and alias', () => {
    for (const q of ['Dombivli', 'dombili', 'Dombivali', 'dombi', 'DI']) expect(searchStations(q)[0].station.name).toBe('Dombivli')
    expect(searchStations('dombvili')[0]).toMatchObject({ fuzzy: true })
    expect(searchStations('dombvili')[0].station.name).toBe('Dombivli')
  })
  it('finds aliases and codes', () => {
    expect(searchStations('VT')[0].station.name).toBe('CSMT')
    expect(searchStations('belapur')[0].station.name).toBe('Belapur CBD')
    expect(searchStations('wadala')[0].station.name).toBe('Vadala Road')
    expect(searchStations('ghatkoper')[0].station.name).toBe('Ghatkopar')
  })
  it('covers the defined scope', () => {
    const names = STATIONS.map((s) => s.name)
    for (const n of ['Kasara', 'Khopoli', 'Karjat', 'Titwala', 'Badlapur', 'Panvel', 'Goregaon', 'Airoli', 'Uran City', 'Digha Gaon', 'Kurla', 'Chembur']) expect(names).toContain(n)
    expect(STATIONS.length).toBeGreaterThan(90)
    expect(NETWORK_SOURCE.checked).toBe('2026-10-15')
    // every route's stations exist and are unique within the route
    for (const r of NETWORK.routes) expect(new Set(r.stations).size).toBe(r.stations.length)
  })
})

describe('routing', () => {
  it('Dombivli → Kurla is direct on the main line towards CSMT', () => {
    const r = routeBetween('Dombivli', 'Kurla')
    expect(r.transfers).toBe(0)
    expect(r.legs[0]).toMatchObject({ line: 'main', towards: ['CSMT'] })
    expect(r.stops).toBe(13)
  })
  it('Dombivli → Chembur changes at Kurla', () => {
    const r = routeBetween('Dombivli', 'Chembur')
    expect(r.transfers).toBe(1)
    expect(r.legs.map((l) => l.to.name)).toEqual(['Kurla', 'Chembur'])
    expect(r.legs[1].line).toBe('harbour')
  })
  it('Airoli (Trans-Harbour) needs a change, never a fake direct service', () => {
    const r = routeBetween('Airoli', 'Chembur')
    expect(r.transfers).toBe(1)
    expect(r.legs[0].line).toBe('transharbour')
  })
  it('Andheri → Chembur is direct on the Panvel–Goregaon harbour service', () => {
    expect(routeBetween('Andheri', 'Chembur').transfers).toBe(0)
  })
  it('Uran → Chembur changes at Nerul or Belapur', () => {
    const r = routeBetween('Uran', 'Chembur')
    expect(r.transfers).toBe(1)
    expect(['Nerul', 'Belapur CBD']).toContain(r.legs[0].to.name)
  })
  it('Titwala → Ambernath changes at Kalyan (different branches)', () => {
    const r = routeBetween('Titwala', 'Ambernath')
    expect(r.transfers).toBe(1)
    expect(r.legs[0].to.name).toBe('Kalyan')
  })
})

describe('journey plans to campus', () => {
  it('Dombivli: option via Kurla is direct with timetable times and a final leg', () => {
    const p = planJourney({ from: 'dombili', now: at(8, 0) })
    expect(p.from.name).toBe('Dombivli')
    const viaK = p.options.find((o) => o.via === 'Kurla')
    expect(viaK.best).toBe(true)
    expect(viaK.timed).toBe(true)
    expect(viaK.legs[0].trains.length).toBeGreaterThan(0)
    expect(viaK.finalLeg.bus).toMatch(/432/)
    const viaC = p.options.find((o) => o.via === 'Chembur')
    expect(viaC.transfers).toBe(1)
    // the connecting train leaves after the first leg arrives
    if (viaC.timed) expect(viaC.legs[1].first.wait).toBeGreaterThanOrEqual(0)
  })
  it('Panvel: via Chembur is direct', () => {
    const p = planJourney({ from: 'Panvel', now: at(8, 0) })
    expect(p.options[0]).toMatchObject({ via: 'Chembur', transfers: 0 })
  })
  it('Airoli: legs without timetable data are left untimed', () => {
    const p = planJourney({ from: 'Airoli', now: at(8, 0) })
    expect(p.options[0].timed).toBe(false)
    expect(p.options[0].legs[0].trains).toBe(null)
  })
  it('unknown station', () => { expect(planJourney({ from: 'Atlantis' }).error).toBeTruthy() })
})
