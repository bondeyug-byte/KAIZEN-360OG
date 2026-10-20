// LocalStorage persistence with safe fallbacks. One JSON document holds the demo "database".
// NOTE: LocalStorage is per-browser. It does not sync between students or devices.
export const KEY = 'campus360.db.v4' // v4: academic identity, teacher posts, attendance, canteens, notes
const OLD_KEYS = ['campus360.db.v3', 'campus360.db.v2']
const SHARED_KEYS = ['rides', 'rideRequests', 'challenges', 'completions', 'events', 'registrations', 'directory', 'offers', 'learnRequests', 'sessions', 'ledger', 'notifications', 'submissions', 'posts', 'postSubs', 'attSessions', 'attAudit', 'staffAllowlist', 'dishes', 'reviews', 'notes', 'noteReports', 'noteRequests', 'tutorReviews', 'eventChats']

/** Bring a v2 database forward without losing anyone's data: add the new collections and the demo organiser. */
export function upgradeDb(db, makeSeed) {
  if (!db || db.version !== 1 || typeof db.profiles !== 'object' || !db.shared) return null
  const fresh = makeSeed()
  const shared = { ...db.shared }
  for (const k of SHARED_KEYS) if (!Array.isArray(shared[k])) shared[k] = fresh.shared[k] || []
  shared.events = shared.events.map((e) => (e.demo && !e.organiserId ? { ...e, organiserId: 'u_org', organiserName: fresh.profiles.u_org.name, form: fresh.shared.events.find((x) => x.id === e.id)?.form || {} } : e))
  shared.challenges = shared.challenges.map((c) => (c.id === 'ch_4' && c.demo && !c.submission ? { ...c, submission: fresh.shared.challenges.find((x) => x.id === 'ch_4').submission } : c))
  shared.offers = shared.offers.map((o) => { const f = o.demo && fresh.shared.offers.find((x) => x.id === o.id); return f ? { ...f, ...o, course: o.course || f.course, studyYear: o.studyYear || f.studyYear, qualifications: o.qualifications || f.qualifications, topics: o.topics || f.topics } : o })
  if (!shared.attSecrets || typeof shared.attSecrets !== 'object' || Array.isArray(shared.attSecrets)) shared.attSecrets = {}
  // add new demo accounts and give existing demo students their (sample) academic identity
  const profiles = { ...db.profiles }, userData = { ...db.userData }
  for (const [id, p] of Object.entries(fresh.profiles)) {
    if (!profiles[id]) { profiles[id] = p; if (fresh.userData[id]) userData[id] = userData[id] || fresh.userData[id] }
    else if (p.demo && !profiles[id].division && p.division) profiles[id] = { ...profiles[id], year: p.year, branchId: p.branchId, division: p.division, roll: p.roll }
  }
  return { ...db, profiles, userData, shared }
}

export function isValidDb(db) {
  return !!db && db.version === 1 && typeof db.profiles === 'object' && typeof db.userData === 'object' && db.shared &&
    SHARED_KEYS.every((k) => Array.isArray(db.shared[k])) && typeof db.shared.attSecrets === 'object'
}

const isStr = (v) => typeof v === 'string' && v.trim() !== ''
const isTime = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const isPlace = (v) => !!v && typeof v === 'object' && isStr(v.name) && Number.isFinite(v.lat) && Number.isFinite(v.lng)
const audOk = (a) => a == null || (typeof a === 'object' && Array.isArray(a.divisions))
// Records that the pages can't render are dropped; everything else is kept untouched.
const RECORD_RULES = {
  rides: (r) => isStr(r?.id) && isPlace(r.from) && isPlace(r.to) && isTime(r.departAt),
  rideRequests: (r) => isStr(r?.id) && isStr(r.rideId) && isStr(r.userId),
  challenges: (c) => isStr(c?.id) && isStr(c.title) && audOk(c.audience),
  posts: (p) => isStr(p?.id) && isStr(p.title) && isStr(p.kind) && audOk(p.audience) && p.audience != null && isTime(p.createdAt) && (p.deadline == null || p.deadline === '' || isTime(p.deadline)),
  events: (e) => isStr(e?.id) && isStr(e.title) && isTime(e.start),
  notes: (n) => isStr(n?.id) && isStr(n.title) && !!n.file && typeof n.file === 'object',
  attSessions: (s) => isStr(s?.id) && isStr(s.division) && isStr(s.subject) && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') && (s.status === 'cancelled' || (!!s.records && typeof s.records === 'object')),
  notifications: (n) => isStr(n?.id) && isStr(n.userId),
  dishes: (d) => isStr(d?.id) && isStr(d.name) && Number.isFinite(d.price),
  reviews: (r) => isStr(r?.id) && isStr(r.dishId) && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5,
  noteRequests: (r) => isStr(r?.id) && isStr(r.userId) && isStr(r.subject) && isStr(r.topic) && isStr(r.status) && isTime(r.at),
  tutorReviews: (r) => isStr(r?.id) && isStr(r.tutorId) && isStr(r.userId) && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5 && isTime(r.at),
  eventChats: (m) => isStr(m?.id) && isStr(m.eventId) && isStr(m.studentId) && typeof m.text === 'string' && isTime(m.at),
}

/** Repair or drop malformed records so one bad entry can't break a page. Returns { db, fixed }. */
export function sanitizeDb(db, emptyUserData) {
  let fixed = 0
  const shared = { ...db.shared }
  for (const [k, ok] of Object.entries(RECORD_RULES)) {
    const before = shared[k].length
    shared[k] = shared[k].filter((x) => { try { return ok(x) } catch { return false } })
    fixed += before - shared[k].length
  }
  const profiles = {}
  for (const [id, p] of Object.entries(db.profiles || {})) {
    if (!p || typeof p !== 'object') { fixed++; continue }
    const q = { ...p }
    if (typeof q.name !== 'string') { q.name = 'Unnamed student'; fixed++ } // '' is valid: a new phone account before onboarding
    for (const k of ['interests', 'subjects']) if (q[k] != null && !Array.isArray(q[k])) { q[k] = []; fixed++ }
    profiles[id] = q
  }
  const userData = { ...db.userData }
  for (const [id, u] of Object.entries(userData)) {
    if (!u || typeof u !== 'object' || !Array.isArray(u.subjects) || !Array.isArray(u.deadlines)) { userData[id] = { ...emptyUserData(), ...(u && typeof u === 'object' ? u : {}), subjects: Array.isArray(u?.subjects) ? u.subjects : [], deadlines: Array.isArray(u?.deadlines) ? u.deadlines : [] }; fixed++ }
  }
  return { db: fixed ? { ...db, shared, profiles, userData } : db, fixed }
}

let memoryFallback = null

export function loadDb(makeSeed, emptyUserData) {
  const res = loadRaw(makeSeed)
  if (!emptyUserData || !res.db) return res
  const { db, fixed } = sanitizeDb(res.db, emptyUserData)
  if (!fixed) return res
  try { localStorage.setItem(KEY + '.backup', JSON.stringify(res.db)) } catch { /* best effort */ }
  return { db, fresh: true, notice: `${fixed} damaged saved item${fixed > 1 ? 's were' : ' was'} repaired or set aside. A copy of the original data was kept in this browser.` }
}

function loadRaw(makeSeed) {
  let raw = null
  try { raw = localStorage.getItem(KEY) } catch { return { db: memoryFallback || (memoryFallback = makeSeed()), notice: 'Browser storage is blocked, so changes will be lost when you close this tab.' } }
  if (!raw) {
    for (const k of OLD_KEYS) {
      try { const up = upgradeDb(JSON.parse(localStorage.getItem(k)), makeSeed); if (up && isValidDb(up)) return { db: up, notice: null, fresh: true } } catch { /* ignore */ }
    }
    return { db: makeSeed(), notice: null, fresh: true }
  }
  try {
    const db = JSON.parse(raw)
    if (isValidDb(db)) return { db, notice: null }
    // Saved by an older build: add the new collections without losing anything.
    const up = upgradeDb(db, makeSeed)
    if (up && isValidDb(up)) return { db: up, notice: null, fresh: true }
  } catch { /* fall through */ }
  return { db: makeSeed(), notice: 'Saved data was unreadable, so the demo data was restored.' }
}

export function saveDb(db) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true }
  catch { memoryFallback = db; return false }
}

export function clearDb() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  memoryFallback = null
}

// Small UI preferences (not data)
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('campus360.pref.' + k); return v === null ? d : JSON.parse(v) } catch { return d } },
  set(k, v) { try { localStorage.setItem('campus360.pref.' + k, JSON.stringify(v)) } catch { /* ignore */ } },
}
