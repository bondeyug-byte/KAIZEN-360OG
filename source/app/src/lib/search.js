// Global search over real app data: pages, rooms in the 3D model, events, challenges, directory entries and
// railway stations. Canteen dishes join the index when the canteen module ships. Pure function → easy to test.
import { canAccess } from './roles.js'
import { allPlaces, floorName, TYPE_LABEL } from '../navigator/building.js'
import { STATIONS } from './journey.js'
import { eligible, canView } from './challenges.js'
import { visiblePosts } from './posts.js'

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s&/.-]/g, ' ')
let placeCache = null

export function searchAll(q, { db, me, pages = [] } = {}, limit = 8) {
  const query = norm(q).trim()
  if (query.length < 2) return []
  const words = query.split(/\s+/)
  const score = (text, title) => {
    const t = norm(text), ti = norm(title)
    if (!words.every((w) => t.includes(w))) return 0
    return (ti.startsWith(query) ? 4 : ti.includes(query) ? 3 : 1) + (words.length > 1 ? 1 : 0)
  }
  const out = []
  const push = (kind, title, sub, href, text) => { const s = score(text, title); if (s) out.push({ kind, title, sub, href, s }) }
  for (const p of pages) push('Page', p.label, 'Open page', '#' + p.path, p.label + ' ' + (p.keywords || ''))
  placeCache = placeCache || allPlaces().filter((p) => p.type !== 'lift' || true)
  for (const p of placeCache) push('Room', p.labName ? `${p.labName} — ${p.short}` : p.name, `${TYPE_LABEL[p.type] || p.type} · ${floorName(p.f)}`, `#/navigator?f=${p.f}&id=${p.id}`, p.search)
  const sh = db?.shared
  if (sh) {
    for (const e of sh.events) push('Event', e.title, e.place?.label || '', `#/events?id=${e.id}`, `${e.title} ${e.description} ${(e.tags || []).join(' ')}`)
    for (const c of sh.challenges) if (canView(c, me) && (!me || eligible(c, me) || c.createdBy === me.id)) push('Challenge', c.title, `+${c.points} points · ${c.classId}`, `#/challenges?id=${c.id}`, `${c.title} ${c.description}`)
    for (const d of sh.dishes || []) push('Dish', `${d.name} · ₹${d.price}`, `${d.canteen} canteen · ${d.category}`, `#/canteen?c=${d.canteen}`, `${d.name} ${d.category} ${d.canteen} canteen food`)
    if (me) for (const p of visiblePosts(sh, me)) push('Classwork', p.title, p.kind, `#/classwork?id=${p.id}`, `${p.title} ${p.body}`)
    for (const d of sh.directory) push('Contact', d.name, d.purpose, `#/directory`, `${d.name} ${d.purpose} ${d.category}`)
  }
  for (const s of STATIONS) push('Station', `${s.name} station`, 'Plan a journey to campus', `#/commute?from=${encodeURIComponent(s.name)}`, `${s.name} station railway train`)
  const ORDER = { Page: 0, Room: 1, Classwork: 2, Event: 3, Challenge: 4, Dish: 5, Contact: 6, Station: 7 }
  const allowed = (r) => !me || canAccess(me, r.href.slice(1).split('?')[0])
  return out.filter(allowed).sort((a, b) => b.s - a.s || ORDER[a.kind] - ORDER[b.kind] || a.title.length - b.title.length || a.title.localeCompare(b.title)).slice(0, limit)
}
