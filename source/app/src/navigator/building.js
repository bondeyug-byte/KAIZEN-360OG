// Building model + routing for the main C-shaped block (pure data, no DOM).
// Angles are degrees around the courtyard centre: west end = 132°, east end = 48°.
// Plan (x, y) = (r cos a, −r sin a). 3D (x, y, z) = (planX, height, planY).
export const D = Math.PI / 180
export const H = 4.5            // floor-to-floor height (m)
export const FLOORS = 6          // Ground + 5
export const CR = 76             // corridor centre radius
export const AY = 2 * H          // Floor 2 terrace level
export const P2 = (r, a) => [r * Math.cos(a * D), -r * Math.sin(a * D)]
export const floorName = (f) => (f === 0 ? 'Ground floor' : 'Floor ' + f)
export const floorShort = (f) => (f === 0 ? 'G' : String(f))

// Fixed orientation: the default camera looks at the courtyard face from the south, so the WEST half of the curve
// (angle > 90°) is the left-hand side and the EAST half (angle < 90°) is the right-hand side. Rule from the team:
// every teaching room on the left is a laboratory, every teaching room on the right is a classroom.
export const LEFT_OF = (a) => a > 90
// Lab names already used by the app, placed once each where the app's own records (directory, timetable, events)
// put them. Every other laboratory keeps a neutral "Lab <code>" label — its real use isn't known.
const LAB_NAME = { 1: { l21: 'Programming Lab', l22: 'Web Tech Lab', l23: 'Computer Networks Lab' }, 2: { l23: 'VLSI & Hardware Lab', l26: 'Python / ML Lab' }, 3: { l24: 'Physics Lab', l25: 'Chemistry Lab' } }
// Window-side partition between the two fixed staff-lift shafts (positions unchanged from the original model).
const SL1 = [108.7857143, 111.2857143], SL2 = [68.7142857, 71.2142857]
const OUTER_RUNS = [['lab', 132, SL1[1], 4], ['lift', SL1[1], SL1[0], 1], ['lab', SL1[0], 90, 4], ['room', 90, SL2[1], 6], ['lift', SL2[1], SL2[0], 1], ['room', SL2[0], 48, 7]]
// VESIT gives each upper floor to one department but doesn't publish which — fill these in.
export const FLOOR_DEPT = { 1: null, 2: null, 3: null, 4: null, 5: null }
export const CONNECTORS = { student: ['lift_s1', 'lift_s2', 'lift_s3', 'lift_s4'], staff: ['lift_staff1', 'lift_staff2', 'lift_svc_w', 'lift_svc_e'], stairs: ['stairs_w', 'stairs_e'] }
export const TYPE_FILL = { room: '#EBD2CF', lab: '#DCC6A3', wc: '#C4DACD', lift: '#2B1519', lobby: '#F7EFE6', canteen: '#E6CFA8', amphi: '#C9774F', office: '#D5D3E6', library: '#BFD1E0', stairs: '#8C7479' }
export const TYPE_LABEL = { room: 'Classroom', lab: 'Lab', wc: 'Washroom', lift: 'Lift', stairs: 'Stairs', lobby: 'Lobby', canteen: 'Canteen', amphi: 'Amphitheatre', office: 'Office', library: 'Library' }

// The amphitheatre: an open, three-storey terrace RECESSED INTO the curved block on the courtyard side
// (inside the curve). Floor 2 is the open deck, Floors 3 and 4 open balcony galleries over it; giant columns stand on the
// building's own courtyard face. Nothing projects out of the building line. Arc and depth are inferred from photos.
export const LOGGIA = { lo: 73, hi: 107, deck: [64.3, 73.8], balcony: [70, 74], floors: [2, 3, 4] }
const inLoggia = (o) => o.lo >= LOGGIA.lo - 1e-6 && o.hi <= LOGGIA.hi + 1e-6

const cache = []
export function floorPlaces(f) {
  if (cache[f]) return cache[f]
  const pre = f === 0 ? 'G' : String(f)
  const code = (n) => pre + String(n).padStart(2, '0')
  const list = []
  const add = (o) => { o.f = f; o.am = (o.lo + o.hi) / 2; o.rm = (o.r1 + o.r2) / 2; list.push(o) }
  let a, rn = 1, ln = 21, sn = 1
  for (const [t, from, to, n] of OUTER_RUNS) {
    const w = (from - to) / n
    for (let k = 0; k < n; k++) {
      const hi = from - k * w, lo = hi - w
      if (t === 'room') { const c = code(rn); add({ id: 'r' + String(rn).padStart(2, '0'), type: 'room', code: c, short: 'Room ' + c, name: 'Classroom ' + c, r1: 78, r2: 88, lo, hi, side: 'outer' }); rn++ }
      else if (t === 'lab') { const c = code(ln), id = 'l' + ln, nm = LAB_NAME[f]?.[id]; add({ id, type: 'lab', code: c, short: 'Lab ' + c, name: 'Lab ' + c + (nm ? ' · ' + nm : ''), labName: nm || null, r1: 78, r2: 88, lo, hi, side: 'outer' }); ln++ }
      else { add({ id: 'lift_staff' + sn, type: 'lift', sub: 'staff', code: 'SL' + sn, short: 'Staff Lift ' + sn, name: 'Staff Lift ' + sn, r1: 78, r2: 83, lo, hi, side: 'outer' }); sn++ }
    }
  }
  // Courtyard side, west → east. Lifts, stairs and washrooms sit outside the central stretch so that the
  // recessed terrace (LOGGIA) can open the middle of floors 2–3 to the courtyard. Positions are provisional.
  const inner = [['wc_1', 'wc', 4], ['lift_svc_w', 'lift', 3], ['lift_s1', 'lift', 2.5], ['stairs_w', 'stairs', 3.5], ['lift_s2', 'lift', 2.5], ['wc_2', 'wc', 3.5], ['r15', 'room', 6], ['r16', 'room', 6], ['r17', 'room', 5], ['lobby', 'lobby', 12], ['r18', 'room', 5], ['r19', 'room', 6], ['wc_3', 'wc', 3.5], ['lift_s3', 'lift', 2.5], ['stairs_e', 'stairs', 3.5], ['lift_s4', 'lift', 2.5], ['r20', 'room', 6], ['lift_svc_e', 'lift', 3], ['wc_4', 'wc', 4]]
  a = 132
  for (const [id, type, w] of inner) {
    const hi = a, lo = a - w; a = lo
    const o = { id, type, r1: 64, r2: 74, lo, hi, side: 'inner', code: '' }
    if (type === 'room') {
      o.code = code(+id.slice(1))
      // left-hand (west) courtyard-side teaching rooms are laboratories; right-hand ones are classrooms
      if (LEFT_OF(a + w / 2)) { o.type = 'lab'; o.short = o.name = 'Lab ' + o.code } else { o.short = 'Room ' + o.code; o.name = 'Classroom ' + o.code }
    }
    else if (type === 'wc') { const n = id.slice(3); o.code = 'W' + n; o.short = o.name = 'Washroom W' + n }
    else if (type === 'stairs') { o.code = id === 'stairs_w' ? 'SW' : 'SE'; o.short = o.name = id === 'stairs_w' ? 'Stairs West' : 'Stairs East' }
    else if (type === 'lobby') { o.short = f === 0 ? 'Main lobby' : 'Central lobby'; o.name = f === 0 ? 'Main entrance lobby' : 'Central lobby' }
    else if (id.startsWith('lift_svc')) { o.sub = 'staff'; o.code = 'Sv'; o.short = o.name = id.endsWith('w') ? 'Service Lift West' : 'Service Lift East' }
    else { o.sub = 'student'; o.code = 'L' + id.slice(-1); o.short = o.name = 'Student Lift ' + id.slice(-1) }
    if (LOGGIA.floors.includes(f) && inLoggia(o)) continue // open terrace / gallery instead of rooms here
    add(o)
  }
  if (f === 0) add({ id: 'canteen', type: 'canteen', code: '', short: 'Canteen', name: 'Canteen (west wing)', r1: 64, r2: 88, lo: 132, hi: 142, side: 'annex' })
  if (f === 2) add({ id: 'amphi', type: 'amphi', code: '', short: 'Amphitheatre', name: 'Amphitheatre (open terrace)', r1: LOGGIA.deck[0], r2: LOGGIA.deck[1], lo: LOGGIA.lo, hi: LOGGIA.hi, side: 'amphi' })
  if (f === 3 || f === 4) add({ id: 'balcony', type: 'lobby', code: '', short: f === 3 ? 'Terrace balcony' : 'Upper terrace balcony', name: f === 3 ? 'Terrace balcony (overlooks the amphitheatre)' : 'Upper terrace balcony, Floor 4 (overlooks the amphitheatre)', r1: LOGGIA.balcony[0], r2: LOGGIA.balcony[1], lo: LOGGIA.lo, hi: LOGGIA.hi, side: 'inner' })
  // Ground floor offices — per VESIT's public description (admin, principal, exam dept, canteen on the ground floor)
  if (f === 0) {
    for (const [id, c, short, name] of [['r15', 'PRN', "Principal's office", "Principal's office"], ['r16', 'ADM', 'Admin office', 'Administrative office'], ['r17', 'EXM', 'Exam cell', 'Examination department']]) {
      Object.assign(list.find((x) => x.id === id), { type: 'office', code: c, short, name })
    }
  }
  // Floor 1: library (per the same public description) in the centre-left stretch of the window side
  if (f === 1) {
    const ids = ['l25', 'l26', 'l27', 'l28'], parts = list.filter((x) => ids.includes(x.id))
    const lo = Math.min(...parts.map((x) => x.lo)), hi = Math.max(...parts.map((x) => x.hi))
    for (const id of ids) list.splice(list.findIndex((x) => x.id === id), 1)
    add({ id: 'library', type: 'library', code: 'LIB', short: 'Library', name: 'Central library', r1: 78, r2: 88, lo, hi, side: 'outer' })
  }
  if (f >= 1) {
    const dept = FLOOR_DEPT[f]
    Object.assign(list.find((x) => x.id === 'r15'), { type: 'office', code: 'HOD', short: dept ? `${dept} office` : 'Department office', name: dept ? `${dept} department office · HOD cabin` : 'Department office · HOD cabin' })
  }
  const KW = { wc: 'washroom toilet restroom wc bathroom', lift: 'lift elevator', stairs: 'stairs staircase steps fire exit', canteen: 'canteen food cafeteria lunch', amphi: 'amphitheatre amphi terrace open section', lab: 'lab laboratory', room: 'room classroom', lobby: 'lobby entrance reception', office: 'office hod head department principal admin administration exam examination cell', library: 'library books reading study' }
  list.forEach((p) => {
    p.wing = p.am > 100 ? 'west wing' : p.am < 80 ? 'east wing' : 'centre'
    p.where = p.side === 'outer' ? 'window side' : p.side === 'inner' ? 'courtyard side' : ''
    p.search = [p.name, p.short, p.code, KW[p.type] || '', floorName(f)].join(' ').toLowerCase()
  })
  return (cache[f] = list)
}
export const place = (f, id) => floorPlaces(f).find((p) => p.id === id)
export const allPlaces = () => { const o = []; for (let f = 0; f < FLOORS; f++) o.push(...floorPlaces(f)); return o }
export const wingSpan = (f) => 10 - f * 1.6

/* -------------------- routing -------------------- */
export const doorAngle = (p) => (p.type === 'amphi' ? 90 : p.type === 'canteen' ? 137.5 : p.am)
function access(p) {
  if (p.type === 'amphi') return [[69, 90], [CR, 90]] // from the corridor through the central doors onto the terrace
  if (p.type === 'canteen') return [[CR, 137.5]]
  return [[p.rm, p.am], [CR, p.am]]
}
function arcPts(a1, a2) { const n = Math.max(1, Math.ceil(Math.abs(a2 - a1) / 1.2)), o = []; for (let k = 0; k <= n; k++) o.push([CR, a1 + (a2 - a1) * k / n]); return o }
const corridorDist = (A, B) => Math.abs(doorAngle(A) - doorAngle(B)) * D * CR
export const WALK = 1.3, LIFT_WAIT = 25, LIFT_PER_FLOOR = 4, STAIRS_PER_FLOOR = 15

export function buildRoute(from, to, mode = 'student') {
  const A = place(from.f, from.id), B = place(to.f, to.id)
  if (!A || !B) return null
  if (A.f === B.f && A.id === B.id) return { same: true, A, B }
  const R = { A, B, mode, pts: [], steps: [], conn: null }
  const push = (f, list) => { for (const [r, a] of list) { const l = R.pts[R.pts.length - 1]; if (l && l.f === f && Math.abs(l.r - r) < 1e-6 && Math.abs(l.a - a) < 1e-6) continue; R.pts.push({ f, r, a }) } return R.pts.length - 1 }
  let conn = null
  if (A.f !== B.f) {
    let best = Infinity
    for (const id of CONNECTORS[mode]) { const d = corridorDist(A, place(A.f, id)) + corridorDist(place(B.f, id), B); if (d < best) { best = d; conn = id } }
    R.conn = conn
  }
  const legs = conn ? [[A, place(A.f, conn)], [place(B.f, conn), B]] : [[A, B]]
  legs.forEach(([X, Y], li) => {
    const f = X.f, last = li === legs.length - 1
    const acc = access(X)
    const i0 = push(f, acc)
    const startIdx = Math.max(0, i0 - (acc.length - 1))
    const arcEnd = push(f, arcPts(doorAngle(X), doorAngle(Y)))
    push(f, access(Y).reverse())
    if (X.id !== Y.id) legSteps(R, X, Y, li, startIdx, i0, arcEnd)
    if (!last) {
      const up = B.f > A.f, c = place(A.f, conn)
      R.steps.push({ idx: R.pts.length - 1, kind: mode === 'stairs' ? 'stairs' : 'lift', text: `${mode === 'stairs' ? 'Take' : 'Ride'} **${c.short}** ${up ? 'up' : 'down'} to **${floorName(B.f)}**` })
    }
  })
  R.cum = [0]
  for (let i = 1; i < R.pts.length; i++) {
    const p = R.pts[i - 1], q = R.pts[i], [x1, y1] = P2(p.r, p.a), [x2, y2] = P2(q.r, q.a)
    R.cum.push(R.cum[i - 1] + Math.hypot(x2 - x1, y2 - y1) + Math.abs(q.f - p.f) * H)
  }
  R.total = R.cum[R.cum.length - 1]
  R.steps.forEach((s) => (s.at = R.cum[Math.min(s.idx, R.cum.length - 1)]))
  R.steps.sort((a, b) => a.at - b.at)
  const floors = Math.abs(B.f - A.f)
  R.walk = Math.round(R.total - floors * H)
  R.secs = R.walk / WALK + (floors ? (mode === 'stairs' ? STAIRS_PER_FLOOR * floors : LIFT_WAIT + LIFT_PER_FLOOR * floors) : 0)
  return R
}
function legSteps(R, X, Y, li, startIdx, arcStart, arcEnd) {
  const dA = doorAngle(X), dB = doorAngle(Y), west = dB > dA, dist = Math.round(Math.abs(dB - dA) * D * CR)
  const facingOut = X.side !== 'outer'
  const turn = west ? (facingOut ? 'left' : 'right') : (facingOut ? 'right' : 'left')
  const fl = floorName(X.f)
  let t1
  if (X.type === 'canteen') t1 = { kind: 'right', text: 'Leave the canteen and head east along the corridor' }
  else if (X.type === 'amphi') t1 = { kind: turn, text: `Walk back through the central doors into the corridor and turn **${turn}**` }
  else if (li === 1) t1 = { kind: turn, text: dist < 3 ? `Step out of **${X.short}** on ${fl}` : `Step out of **${X.short}** on ${fl} and turn **${turn}**` }
  else if (X.type === 'lift' || X.type === 'stairs') t1 = { kind: turn, text: dist < 3 ? `Start at **${X.short}**` : `Start at **${X.short}** and turn **${turn}** into the corridor` }
  else t1 = { kind: turn, text: dist < 3 ? `Leave **${X.short}**` : `Leave **${X.short}** and turn **${turn}** into the corridor` }
  R.steps.push({ idx: startIdx, ...t1 })
  if (dist >= 3) {
    const past = Math.min(dA, dB) < 84 && Math.max(dA, dB) > 96 && ![X.type, Y.type].some((t) => t === 'lobby' || t === 'amphi')
    R.steps.push({ idx: arcStart, kind: 'up', text: `Walk **${dist} m ${west ? 'west' : 'east'}**${past ? ', past the central lobby' : ''}` })
  }
  const side = Y.side === 'outer' ? (west ? 'right' : 'left') : (west ? 'left' : 'right')
  let t3
  if (Y.type === 'amphi') t3 = { kind: 'up', text: 'Go through the central doors on the courtyard side onto the **amphitheatre terrace**' }
  else if (Y.type === 'canteen') t3 = { kind: 'up', text: 'Carry on to the end of the corridor into the **canteen**' }
  else if (dist < 3) t3 = { kind: 'flag', text: `**${Y.short}** is right there, ${Y.side === X.side ? 'next door' : 'across the corridor'}` }
  else t3 = { kind: side, text: `**${Y.short}** is on your **${side}**${Y.where ? ', ' + Y.where : ''}` }
  R.steps.push({ idx: arcEnd, ...t3 })
}
export function routeSummary(R) {
  const n = Math.abs(R.B.f - R.A.f)
  const t = R.secs < 50 ? 'Under a minute' : `About ${Math.max(1, Math.round(R.secs / 60))} min`
  const parts = [`${R.walk} m walk`]
  if (n) { parts.push(R.mode === 'stairs' ? 'stairs' : '1 lift ride'); parts.push(`${n} floor${n > 1 ? 's' : ''} ${R.B.f > R.A.f ? 'up' : 'down'}`) } else parts.push('same floor')
  return { t, meta: parts.join(' · ') }
}
export function posAt(R, d) {
  d = Math.max(0, Math.min(R.total, d))
  let i = 1; while (i < R.cum.length - 1 && R.cum[i] < d) i++
  const p = R.pts[i - 1], q = R.pts[i], seg = R.cum[i] - R.cum[i - 1], u = seg > 0 ? (d - R.cum[i - 1]) / seg : 1
  const [x1, y1] = P2(p.r, p.a), [x2, y2] = P2(q.r, q.a)
  return { x: x1 + (x2 - x1) * u, y: y1 + (y2 - y1) * u, h: (p.f + (q.f - p.f) * u) * H, f: u < 0.5 ? p.f : q.f, dx: x2 - x1, dy: y2 - y1 }
}
/** Which place (if any) contains a plan point on floor f — used for picking in 3D without per-room meshes. */
export function placeAt(f, x, y) {
  const r = Math.hypot(x, y), a = Math.atan2(-y, x) / D
  return floorPlaces(f).find((p) => r >= p.r1 && r <= p.r2 && a >= p.lo && a <= p.hi) || null
}
export const placeLabelText = (p) => (p ? `${p.name} · ${floorName(p.f)}` : '')
