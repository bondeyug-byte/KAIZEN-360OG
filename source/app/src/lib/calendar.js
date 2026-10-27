// Academic calendar helpers. Dates are plain 'YYYY-MM-DD' strings in campus time (Asia/Kolkata) as the server
// sends them, and all arithmetic is done on UTC midnights, so a date never shifts with the viewer's time zone.
import { CAMPUS_TIMEZONE } from '../data/config.js'

export const ymdToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: CAMPUS_TIMEZONE }).format(now)
const toMs = (ymd) => Date.parse(ymd + 'T00:00:00Z')
const fromMs = (ms) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (ymd, n) => fromMs(toMs(ymd) + n * 86400000)
export const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromMs(toMs(s)) === s
/** Monday of the week containing `ymd`. */
export const weekStart = (ymd) => { const wd = new Date(toMs(ymd)).getUTCDay(); return addDays(ymd, -((wd + 6) % 7)) }
export const monthStart = (ymd) => ymd.slice(0, 8) + '01'
export const addMonths = (ymd, n) => { const d = new Date(toMs(monthStart(ymd))); d.setUTCMonth(d.getUTCMonth() + n); return fromMs(d.getTime()) }
/** 6 weeks × 7 days covering the month of `ymd`, Monday first. */
export function monthGrid(ymd) {
  const first = monthStart(ymd), start = weekStart(first), month = first.slice(0, 7)
  return Array.from({ length: 42 }, (_, i) => { const d = addDays(start, i); return { date: d, inMonth: d.slice(0, 7) === month } })
}
export const weekDays = (ymd) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(ymd), i))
export const fmtDay = (ymd, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', ...o }).format(new Date(toMs(ymd)))
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / 86400000)

/**
 * Event types: a text label and a symbol always go with the colour, so nothing depends on colour alone.
 * Colours are chosen for at least 4.5:1 contrast of the text on its tint.
 */
export const TYPES = {
  assignment: { label: 'Assignment due', short: 'Due', sym: '✎', cls: 'bg-[#FDF3E2] text-[#7A4B00] ring-[#F2DDB5]' },
  deadline: { label: 'Deadline', short: 'Deadline', sym: '⏱', cls: 'bg-[#FDF3E2] text-[#7A4B00] ring-[#F2DDB5]' },
  exam: { label: 'Exam', short: 'Exam', sym: '▲', cls: 'bg-[#FDECEA] text-[#9B1C1C] ring-[#F6C9C3]' },
  ca: { label: 'CA', short: 'CA', sym: '◆', cls: 'bg-[#FDECEA] text-[#9B1C1C] ring-[#F6C9C3]' },
  tutorial: { label: 'Tutorial', short: 'Tutorial', sym: '●', cls: 'bg-[#EAF0FC] text-[#1D47A6] ring-[#CCDAF6]' },
  practical: { label: 'Practical', short: 'Practical', sym: '■', cls: 'bg-[#EAF0FC] text-[#1D47A6] ring-[#CCDAF6]' },
  assessment: { label: 'Assessment', short: 'Assessment', sym: '◆', cls: 'bg-[#FDECEA] text-[#9B1C1C] ring-[#F6C9C3]' },
  date: { label: 'Academic date', short: 'Date', sym: '•', cls: 'bg-sand text-ink ring-line' },
  reminder: { label: 'Reminder', short: 'Reminder', sym: '⏰', cls: 'bg-sand text-ink ring-line' },
  event: { label: 'Event', short: 'Event', sym: '★', cls: 'bg-[#E7F4EC] text-[#1C5E3B] ring-[#C9E6D4]' },
  registration: { label: 'Registration closes', short: 'Reg. closes', sym: '⏳', cls: 'bg-[#F1ECF8] text-[#5B3D80] ring-[#E0D5EF]' },
}
export const typeOf = (t) => TYPES[t] || TYPES.date
export const IMPORTANT = ['assignment', 'deadline', 'exam', 'ca', 'tutorial', 'practical', 'assessment', 'registration']

export function groupByDate(items) {
  const m = new Map()
  for (const i of items) { if (!m.has(i.date)) m.set(i.date, []); m.get(i.date).push(i) }
  for (const list of m.values()) list.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
  return m
}
/** One entry per key (the server already de-duplicates; this protects merged demo + live lists). */
export function dedupe(items) {
  const seen = new Set()
  return items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
}
/** Upcoming important dates from today, nearest first. */
export function upcoming(items, today, { days = 30, types = IMPORTANT } = {}) {
  const end = addDays(today, days)
  return items.filter((i) => types.includes(i.type) && i.date >= today && i.date <= end && !i.cancelled).sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')))
}

/** Calendar items from the browser-only demo data (marked as samples; never shown for a signed-in college account). */
export function demoItems({ tasks = [], events = [] }) {
  const ymdOf = (iso) => ymdToday(new Date(iso))
  const timeOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: CAMPUS_TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
  return dedupe([
    ...tasks.filter((t) => t.due).map((t) => ({ key: `demo:task:${t.id}`, refId: t.id, type: t.kind === 'reminder' ? 'reminder' : 'assignment', label: t.kind === 'reminder' ? 'Reminder' : 'Assignment due', title: t.title, subject: t.subject || '', date: ymdOf(t.due), time: timeOf(t.due), href: t.href, demo: true })),
    ...events.filter((e) => e.start).map((e) => ({ key: `demo:event:${e.id}`, refId: e.id, type: 'event', label: 'Event', title: e.title, venue: e.venue, date: ymdOf(e.start), time: timeOf(e.start), href: e.href, cancelled: !!e.cancelled, demo: e.source === 'sample' })),
  ])
}
