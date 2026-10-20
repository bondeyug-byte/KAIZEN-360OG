import { it, expect } from 'vitest'
import { makeSeed } from '/home/claude/campus360/src/data/seed.js'
import { eventStatus, EVENT_STATUS } from '/home/claude/campus360/src/lib/events.js'
it('every hour of the day: four event states, campus-hour times', () => {
  for (let h = 0; h < 48; h++) {
    const now = new Date(Date.UTC(2026, 9, 16, 0, 0) + h * 30 * 60000 - 330 * 60000 + 7 * 60000) // IST 00:07, 00:37 …
    const d = makeSeed(now)
    const st = d.shared.events.map((e) => eventStatus(e, now))
    for (const s of Object.values(EVENT_STATUS)) expect(st, `${now.toISOString()} ${st}`).toContain(s)
    const ist = (iso) => { const x = new Date(Date.parse(iso) + 330 * 60000); return x.getUTCHours() * 60 + x.getUTCMinutes() }
    for (const r of d.shared.rides) { expect(Date.parse(r.departAt)).toBeGreaterThan(now.getTime()); expect(ist(r.departAt)).toBeGreaterThanOrEqual(8 * 60); expect(ist(r.departAt)).toBeLessThanOrEqual(20 * 60) }
    for (const e of d.shared.events.filter((e) => e.id !== 'ev_1')) { expect(ist(e.start)).toBeGreaterThanOrEqual(8 * 60); expect(ist(e.end)).toBeLessThanOrEqual(20 * 60) }
  }
})
