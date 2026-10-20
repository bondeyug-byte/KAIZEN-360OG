// 2D floor plan as SVG markup (shares coordinates with the 3D scene: plan y == 3D z).
import { P2, D, CR, floorPlaces, floorName, place, doorAngle, TYPE_FILL } from './building.js'

const n2 = (v) => v.toFixed(2)
export function sectorPath(r1, r2, a1, a2) {
  const [x1, y1] = P2(r2, a1), [x2, y2] = P2(r2, a2), [x3, y3] = P2(r1, a2), [x4, y4] = P2(r1, a1)
  return `M${n2(x1)} ${n2(y1)}A${r2} ${r2} 0 0 0 ${n2(x2)} ${n2(y2)}L${n2(x3)} ${n2(y3)}A${r1} ${r1} 0 0 1 ${n2(x4)} ${n2(y4)}Z`
}
export const BOUNDS = { x: -92, y: -94, w: 184, h: 92 }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function armPolys() {
  const out = []
  for (const [a0, sgn] of [[132, 1], [48, -1]]) {
    const [ex, ey] = P2(CR, a0)
    const tx = -Math.sin(a0 * D) * sgn, ty = -Math.cos(a0 * D) * sgn
    const nx = ty, ny = -tx, L = 36, W = 12
    const pts = [[ex + nx * W, ey + ny * W], [ex - nx * W, ey - ny * W], [ex - nx * W + tx * L, ey - ny * W + ty * L], [ex + nx * W + tx * L, ey + ny * W + ty * L]]
    out.push(pts.map((p) => p.map(n2).join(',')).join(' '))
  }
  return out
}

const showType = (p, layer) => layer === 'all' || ['lobby', 'canteen', 'office', 'library', 'amphi'].includes(p.type) || (layer === 'vertical' ? p.type === 'lift' || p.type === 'stairs' : p.type === layer)
const labelOf = (p) => (['room', 'lab', 'wc', 'lift', 'office'].includes(p.type) ? p.code : p.type === 'lobby' ? p.short : p.type === 'library' ? 'Library' : p.type === 'canteen' ? 'Canteen' : p.type === 'amphi' ? 'Amphitheatre' : '')

export function planStatic(f, { uid = 'm', labels = true, mini = false, layer = 'all', selected = null } = {}) {
  const hatch = 'hatch' + uid, o = []
  o.push(`<defs><pattern id="${hatch}" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="1.2" height="1.2" fill="#8C7479"/><rect width="0.5" height="1.2" fill="#5E474C"/></pattern></defs>`)
  o.push(`<path d="${sectorPath(18, 50, 50, 130)}" fill="#DDE4CD"/><path d="${sectorPath(40, 43, 50, 130)}" fill="#EADCCB"/>`)
  const [sx, sy] = P2(32, 90)
  o.push(`<circle cx="${n2(sx)}" cy="${n2(sy)}" r="8" fill="#E5D6C2"/><circle cx="${n2(sx)}" cy="${n2(sy)}" r="2.2" fill="#7A2E3B"/><circle cx="${n2(sx)}" cy="${n2(sy)}" r="0.9" fill="#E9C27A"/>`)
  if (labels && !mini) o.push(`<text class="lbl" x="${n2(sx)}" y="${n2(sy + 11)}" font-size="2.4" text-anchor="middle" fill="#6E5459" font-weight="600">Statue plaza</text>`)
  for (const pts of armPolys()) o.push(`<polygon points="${pts}" fill="#EFE3D8" stroke="#C9B4AC" stroke-width="0.4"/>`)
  if (f <= 1) o.push(`<path d="${sectorPath(52, 64, 66, 114)}" fill="#EFE3D8" stroke="#C9B4AC" stroke-width="0.3"/>`)
  o.push(`<path d="${sectorPath(64, 88, 48, 132)}" fill="#FFFBF6" stroke="#7A2E3B" stroke-width="0.5"/>`)
  for (const p of floorPlaces(f)) {
    const fill = p.id === selected ? '#B4532F' : p.type === 'stairs' ? `url(#${hatch})` : p.type === 'lift' && p.id.startsWith('lift_svc') ? '#5E474C' : TYPE_FILL[p.type]
    const dim = showType(p, layer) ? '' : ' opacity="0.22"'
    o.push(`<path class="sp" data-id="${p.id}" d="${sectorPath(p.r1, p.r2, p.lo, p.hi)}" fill="${fill}" stroke="#FFFBF6" stroke-width="0.3"${dim}><title>${esc(p.name)}</title></path>`)
  }
  o.push(`<path d="${sectorPath(74, 78, 48, f === 0 ? 138 : 132)}" fill="#F7EFE6" pointer-events="none"/>`)
  if (labels) {
    for (const p of floorPlaces(f)) {
      const t = labelOf(p); if (!t) continue
      const am = p.type === 'amphi' ? 90 : p.type === 'canteen' ? 137 : p.am, rm = p.type === 'amphi' ? 69 : p.type === 'canteen' ? 82 : p.rm
      const [x, y] = P2(rm, am)
      const fs = p.type === 'lift' ? 1.35 : p.type === 'wc' ? 1.7 : ['lobby', 'canteen', 'library'].includes(p.type) ? 2.1 : p.type === 'amphi' ? 2.6 : 2.0
      const col = p.id === selected || p.type === 'amphi' ? '#FFFBF6' : p.type === 'lift' ? '#FBEFEA' : '#2B1519'
      o.push(`<text class="lbl" x="${n2(x)}" y="${n2(y)}" transform="rotate(${n2(90 - am)} ${n2(x)} ${n2(y)})" font-size="${fs}" fill="${col}" text-anchor="middle" dominant-baseline="central" font-family="JetBrains Mono, ui-monospace, monospace" font-weight="600" pointer-events="none"${showType(p, layer) ? '' : ' opacity="0.3"'}>${esc(t)}</text>`)
    }
    if (!mini) {
      const [wx, wy] = P2(56, 121), [ex, ey] = P2(56, 59)
      o.push(`<text class="lbl" x="${n2(wx)}" y="${n2(wy)}" font-size="2.6" text-anchor="middle" fill="#6E5459" font-weight="700">WEST</text><text class="lbl" x="${n2(ex)}" y="${n2(ey)}" font-size="2.6" text-anchor="middle" fill="#6E5459" font-weight="700">EAST</text>`)
    }
  }
  return o.join('')
}

export function routePolys(R, f) {
  const polys = []; let cur = null
  R.pts.forEach((p) => { if (p.f === f) { if (!cur) { cur = []; polys.push(cur) } cur.push(P2(p.r, p.a)) } else cur = null })
  return polys.filter((p) => p.length > 1)
}
export const polyD = (pts) => (pts.length ? 'M' + pts.map(([x, y]) => n2(x) + ' ' + n2(y)).join('L') : '')

export function planDynamic(f, { uid = 'm', mini = false, route = null, heat = false, you = null } = {}) {
  const o = []
  if (heat && !mini) {
    const HEAT = [[108.75, 3], [71.25, 3], [90, f === 0 ? 3 : 2], [118, 2], [62, 2], [126, 1], [54, 1]], HC = ['', '#E8D3A8', '#D27A3A', '#7A2E3B']
    for (const [a, l] of HEAT) { const [x, y] = P2(CR, a); o.push(`<circle cx="${n2(x)}" cy="${n2(y)}" r="${(2.6 + l * 1.3).toFixed(1)}" fill="${HC[l]}" opacity="0.6" pointer-events="none"/>`) }
  }
  const R = route && !route.same ? route : null
  if (R) {
    for (const poly of routePolys(R, f)) {
      const d = polyD(poly)
      o.push(`<path d="${d}" fill="none" stroke="#1D5BA8" stroke-width="${mini ? 2.4 : 1.8}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`)
      if (!mini) o.push(`<path d="${d}" fill="none" stroke="#fff" stroke-width="0.45" stroke-dasharray="0.5 2.2" stroke-linecap="round" pointer-events="none"/>`)
    }
    o.push(`<path id="done${uid}" d="" fill="none" stroke="#9FB3CE" stroke-width="${mini ? 2.4 : 1.7}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`)
    if (R.A.f === f) { const [x, y] = P2(R.pts[0].r, R.pts[0].a); o.push(`<circle cx="${n2(x)}" cy="${n2(y)}" r="1.1" fill="#fff" stroke="#1D5BA8" stroke-width="0.8"/>`) }
    if (R.conn && !mini) {
      const c = place(f, R.conn)
      if (c && (R.A.f === f || R.B.f === f)) {
        const [x, y] = P2(c.r1 - 3.2, c.am)
        const txt = R.A.f === f ? `to ${floorName(R.B.f)}` : `from ${floorName(R.A.f)}`
        o.push(`<g class="lbl" pointer-events="none"><rect x="${n2(x - 7)}" y="${n2(y - 1.6)}" width="14" height="3.2" rx="1.6" fill="#1D5BA8"/><text x="${n2(x)}" y="${n2(y)}" font-size="1.7" fill="#fff" text-anchor="middle" dominant-baseline="central" font-weight="700">${txt}</text></g>`)
      }
    }
    if (R.B.f === f) {
      const end = R.pts[R.pts.length - 1]; const [x, y] = P2(end.r, end.a)
      o.push(`<circle class="pulse" cx="${n2(x)}" cy="${n2(y)}" r="1.4" fill="#B4532F" pointer-events="none"/><circle cx="${n2(x)}" cy="${n2(y)}" r="1.4" fill="#B4532F" stroke="#fff" stroke-width="0.7" pointer-events="none"/>`)
    }
  }
  if (you && you.f === f) {
    const p = place(you.f, you.id)
    if (p) {
      const [x, y] = P2(p.type === 'amphi' ? 69 : ['lobby', 'canteen'].includes(p.type) ? CR : p.rm, doorAngle(p))
      o.push(`<g id="you${uid}"><circle cx="${n2(x)}" cy="${n2(y)}" r="${mini ? 5 : 4.2}" fill="#1D5BA8" opacity="0.18"/><circle cx="${n2(x)}" cy="${n2(y)}" r="${mini ? 2.6 : 1.6}" fill="#1D5BA8" stroke="#fff" stroke-width="0.7"/></g>`)
    }
  }
  o.push(`<path id="cone${uid}" d="" fill="#1D5BA8" opacity="0.22" pointer-events="none"/><circle id="mk${uid}" r="0" fill="#1D5BA8" stroke="#fff" stroke-width="0.7" pointer-events="none"/>`)
  return o.join('')
}
