// Academic calendar helpers: no time-zone shifts, Monday-first grids, de-duplication, upcoming dates.
import { describe, it, expect } from 'vitest'
import { monthGrid, weekDays, weekStart, addDays, addMonths, isYmd, ymdToday, dedupe, upcoming, groupByDate, demoItems, TYPES, daysBetween } from '../src/lib/calendar.js'

describe('calendar dates', () => {
  it('month grid: 42 days, Monday first, covers the whole month', () => {
    const g = monthGrid('2026-10-16')
    expect(g).toHaveLength(42)
    expect(g[0].date).toBe('2026-09-28') // Monday
    expect(new Date(g[0].date + 'T00:00:00Z').getUTCDay()).toBe(1)
    expect(g.filter((d) => d.inMonth)).toHaveLength(31)
    expect(g.find((d) => d.date === '2026-10-01').inMonth).toBe(true)
  })
  it('week view and month stepping cross month and year ends without drifting', () => {
    expect(weekDays('2026-12-31')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
    expect(weekStart('2026-03-01')).toBe('2026-02-23')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(daysBetween('2026-10-16', '2026-11-16')).toBe(31)
    expect(isYmd('2026-02-30')).toBe(false); expect(isYmd('2026-02-28')).toBe(true)
  })
  it('today is the campus (IST) date, not the browser or UTC date', () => {
    expect(ymdToday(new Date('2026-10-16T19:00:00Z'))).toBe('2026-10-17') // 00:30 IST
    expect(ymdToday(new Date('2026-10-16T18:00:00Z'))).toBe('2026-10-16') // 23:30 IST
  })
})
describe('calendar items', () => {
  const items = [
    { key: 'a', type: 'exam', title: 'Mid-sem', date: '2026-10-20' },
    { key: 'b', type: 'assignment', title: 'Sheet', date: '2026-10-18', time: '17:00' },
    { key: 'b', type: 'assignment', title: 'Sheet', date: '2026-10-18', time: '17:00' },
    { key: 'c', type: 'event', title: 'Fest', date: '2026-10-18', time: '10:00' },
    { key: 'd', type: 'ca', title: 'CA 1', date: '2026-12-30' },
    { key: 'e', type: 'tutorial', title: 'Old', date: '2026-10-01' },
    { key: 'f', type: 'exam', title: 'Cancelled', date: '2026-10-21', cancelled: true },
  ]
  it('de-duplicates by key and groups by date in time order', () => {
    const d = dedupe(items); expect(d).toHaveLength(6)
    const g = groupByDate(d); expect(g.get('2026-10-18').map((x) => x.key)).toEqual(['c', 'b'])
  })
  it('important dates: future, within range, academic types only, no cancelled items', () => {
    expect(upcoming(dedupe(items), '2026-10-16', { days: 30 }).map((x) => x.key)).toEqual(['b', 'a'])
  })
  it('every type has a text label and a symbol, not colour alone', () => {
    for (const t of Object.values(TYPES)) { expect(t.label.length).toBeGreaterThan(1); expect(t.sym.length).toBeGreaterThan(0) }
  })
  it('demo items are built from sample data and keep the campus date', () => {
    const d = demoItems({ tasks: [{ id: 't1', kind: 'assignment', title: 'Lab', due: '2026-10-16T19:30:00Z' }], events: [{ id: 'e1', title: 'Talk', start: '2026-10-17T04:30:00Z', source: 'sample' }] })
    expect(d.map((x) => [x.type, x.date, x.time])).toEqual([['assignment', '2026-10-17', '01:00'], ['event', '2026-10-17', '10:00']])
    expect(d[1].demo).toBe(true)
  })
})
