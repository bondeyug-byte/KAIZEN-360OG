// Stage B detail textures: one shared 1024 × 1024 decal atlas (signs, notice boards, art, menu boards, book spines,
// floor numbers) and one shared 1024 × 1024 nameplate sheet. Both are drawn procedurally on a canvas once and
// reused by every floor, so adding detail never adds textures per floor.
import * as THREE from 'three'

const S = 1024
/** Atlas regions in canvas pixels (x, y from the top-left). */
export const REG = {
  notice: [0, 0, 256, 192], reception: [0, 192, 256, 64],
  art1: [256, 0, 192, 128], art2: [448, 0, 192, 128], art3: [640, 0, 192, 128],
  menu: [256, 128, 256, 128], books1: [512, 128, 256, 64], books2: [512, 192, 256, 64], screen: [768, 192, 64, 64],
  exit: [832, 0, 128, 64], wc: [960, 0, 64, 64],
  d0: [832, 64, 64, 64], d1: [896, 64, 64, 64], d2: [960, 64, 64, 64], d3: [832, 128, 64, 64], d4: [896, 128, 64, 64], d5: [960, 128, 64, 64],
  tiles: [832, 192, 64, 64], clock: [0, 320, 64, 64], poster1: [64, 320, 96, 128], poster2: [160, 320, 96, 128], principal: [256, 256, 256, 48], admin: [512, 256, 256, 48], exam: [768, 256, 256, 48],
}

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }

function drawAtlas(x) {
  const R = rng(7)
  x.fillStyle = '#EDE6DA'; x.fillRect(0, 0, S, S)
  const box = ([px, py, w, h], fill) => { x.fillStyle = fill; x.fillRect(px, py, w, h) }
  const text = (t, px, py, size, color, weight = 700, align = 'center') => { x.fillStyle = color; x.font = `${weight} ${size}px system-ui, sans-serif`; x.textAlign = align; x.textBaseline = 'middle'; x.fillText(t, px, py) }
  // notice board: cork, frame, pinned sheets
  { const [px, py, w, h] = REG.notice; box(REG.notice, '#6B4A2F'); box([px + 8, py + 8, w - 16, h - 16], '#B88A5A')
    for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(80,50,25,${0.15 + R() * 0.2})`; x.fillRect(px + 8 + R() * (w - 16), py + 8 + R() * (h - 16), 2, 2) }
    const sheets = [[18, 18, 70, 92, '#FBF8F0'], [98, 22, 64, 54, '#FFF3B0'], [172, 16, 66, 80, '#FBF8F0'], [100, 88, 70, 80, '#DCEBFA'], [24, 120, 66, 52, '#FBF8F0'], [180, 108, 56, 64, '#FCE1E1']]
    for (const [sx, sy, sw, sh, c] of sheets) { x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(px + sx + 3, py + sy + 3, sw, sh); x.fillStyle = c; x.fillRect(px + sx, py + sy, sw, sh)
      x.fillStyle = '#5A5F66'; for (let l = 0; l < 6; l++) x.fillRect(px + sx + 6, py + sy + 10 + l * Math.max(7, sh / 8), sw * (0.5 + R() * 0.4), 2)
      x.fillStyle = '#C0392B'; x.beginPath(); x.arc(px + sx + sw / 2, py + sy + 4, 3.5, 0, 7); x.fill() }
    text('NOTICES', px + w / 2, py + h - 12, 14, '#3B2A1A') }
  // reception and office signs
  const sign = (reg, t) => { const [px, py, w, h] = reg; box(reg, '#2B1519'); box([px + 3, py + 3, w - 6, h - 6], '#3B2227'); text(t, px + w / 2, py + h / 2 + 1, Math.round(h * 0.42), '#F3E3C8') }
  sign(REG.reception, 'RECEPTION'); sign(REG.principal, "PRINCIPAL'S OFFICE"); sign(REG.admin, 'ADMINISTRATION'); sign(REG.exam, 'EXAMINATION CELL')
  // three abstract framed artworks (original, no real works)
  const art = (reg, hues) => { const [px, py, w, h] = reg; box(reg, '#2A2422'); box([px + 8, py + 8, w - 16, h - 16], '#F4EEE3')
    for (let i = 0; i < 7; i++) { x.fillStyle = `hsl(${hues[i % hues.length]},${45 + R() * 25}%,${45 + R() * 20}%)`; x.globalAlpha = 0.85; x.beginPath(); x.arc(px + 20 + R() * (w - 40), py + 20 + R() * (h - 40), 8 + R() * 26, 0, 7); x.fill() }
    x.globalAlpha = 1 }
  art(REG.art1, [12, 28, 200]); art(REG.art2, [150, 170, 45]); art(REG.art3, [350, 20, 260])
  // canteen menu board (generic items only, no prices)
  { const [px, py, w, h] = REG.menu; box(REG.menu, '#1F2A24'); text('MENU', px + w / 2, py + 18, 20, '#F2D37A')
    const items = ['Tea · Coffee', 'Vada pav', 'Sandwich', 'Thali', 'Juice', 'Snacks']
    items.forEach((t, i) => text(t, px + (i % 2 ? w * 0.72 : w * 0.28), py + 46 + Math.floor(i / 2) * 26, 15, '#EDE6DA', 600)) }
  // book spines (two strips so neighbouring shelves differ)
  for (const reg of [REG.books1, REG.books2]) { const [px, py, w, h] = reg; box(reg, '#5A4232'); let bx = px + 2
    while (bx < px + w - 4) { const bw = 5 + Math.floor(R() * 9), bh = h * (0.7 + R() * 0.28); x.fillStyle = `hsl(${Math.floor(R() * 360)},${30 + R() * 35}%,${25 + R() * 30}%)`; x.fillRect(bx, py + h - bh, bw, bh); x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(bx + 1, py + h - bh + 6, bw - 2, 2); bx += bw + 1 } }
  // catalogue screen
  { const [px, py, w, h] = REG.screen; box(REG.screen, '#0E1E2C'); box([px + 6, py + 8, w - 12, 8], '#3D8BD9'); for (let l = 0; l < 4; l++) box([px + 6, py + 22 + l * 9, w - 20 - R() * 14, 4], '#A9C7E6') }
  // exit sign (green, running figure as simple shapes) and washroom sign
  { const [px, py, w, h] = REG.exit; box(REG.exit, '#118A4C'); text('EXIT', px + w * 0.62, py + h / 2 + 1, 30, '#FFFFFF', 800)
    x.fillStyle = '#FFFFFF'; x.beginPath(); x.arc(px + 22, py + 18, 6, 0, 7); x.fill(); x.fillRect(px + 18, py + 26, 8, 20) }
  { const [px, py, w, h] = REG.wc; box(REG.wc, '#2E6DB4'); text('WC', px + w / 2, py + h / 2 + 1, 26, '#FFFFFF', 800) }
  // floor-number plates for lift lobbies
  ;['G', '1', '2', '3', '4', '5'].forEach((t, i) => { const reg = REG['d' + i], [px, py, w, h] = reg; box(reg, '#2B1519'); box([px + 3, py + 3, w - 6, h - 6], '#F3E3C8'); text(t, px + w / 2, py + h / 2 + 2, 40, '#2B1519', 800) })
  // wall clock (hands at a fixed time) and two generic lab posters
  { const [px, py, w] = REG.clock, c = px + w / 2, cy = py + w / 2; x.fillStyle = '#2B2B2B'; x.beginPath(); x.arc(c, cy, 31, 0, 7); x.fill(); x.fillStyle = '#FAFAF5'; x.beginPath(); x.arc(c, cy, 27, 0, 7); x.fill()
    x.fillStyle = '#2B2B2B'; for (let k = 0; k < 12; k++) { const t = k * Math.PI / 6; x.fillRect(c + 22 * Math.cos(t) - 1.5, cy + 22 * Math.sin(t) - 1.5, 3, 3) }
    x.strokeStyle = '#2B2B2B'; x.lineWidth = 3; x.beginPath(); x.moveTo(c, cy); x.lineTo(c + 10, cy - 8); x.moveTo(c, cy); x.lineTo(c - 4, cy - 20); x.stroke() }
  const poster = (reg, title, lines, accent) => { const [px, py, w, h] = reg; box(reg, '#FBF8F0'); box([px, py, w, 26], accent); text(title, px + w / 2, py + 13, 13, '#FFFFFF', 800)
    lines.forEach((t, i) => text(t, px + w / 2, py + 44 + i * 18, 11, '#2B2B2B', 600)); box([px + 18, py + h - 28, w - 36, 12], accent) }
  poster(REG.poster1, 'LAB SAFETY', ['No food or drink', 'Report damage', 'Switch off', 'when done'], '#C0392B')
  poster(REG.poster2, 'WORK TIDY', ['Log in, log out', 'Save your work', 'Cables off', 'walkways'], '#2E6DB4')
  // washroom wall tile (used as a decal strip)
  { const [px, py, w, h] = REG.tiles; box(REG.tiles, '#B9C9C8'); x.fillStyle = '#DCE7E6'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) x.fillRect(px + i * 16 + 1, py + j * 16 + 1, 14, 14) }
}

let atlasTex = null, platesTex = null, tileTex = null
const plateSlots = new Map()
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }

export function atlas() {
  if (atlasTex) return atlasTex
  const c = canvas(S, S); drawAtlas(c.getContext('2d'))
  atlasTex = new THREE.CanvasTexture(c); atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.anisotropy = 4
  return atlasTex
}
/** Nameplates for every named place (128 × 32 px slots, 8 per row, up to 256). */
export function plates(list) {
  if (platesTex) return platesTex
  const c = canvas(S, S), x = c.getContext('2d')
  x.fillStyle = '#EDE6DA'; x.fillRect(0, 0, S, S)
  list.slice(0, 256).forEach(({ key, text, kind }, i) => {
    const px = (i % 8) * 128, py = Math.floor(i / 8) * 32
    x.fillStyle = kind === 'lab' ? '#7A4E0E' : kind === 'wc' ? '#1F4F86' : '#2B1519'; x.fillRect(px + 2, py + 2, 124, 28)
    x.fillStyle = '#F6EEDF'; x.font = '700 15px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'
    let t = text; while (x.measureText(t).width > 116 && t.length > 3) t = t.slice(0, -2) + '…'
    x.fillText(t, px + 64, py + 17)
    plateSlots.set(key, [px + 2, py + 2, 124, 28])
  })
  platesTex = new THREE.CanvasTexture(c); platesTex.colorSpace = THREE.SRGBColorSpace; platesTex.anisotropy = 4
  return platesTex
}
export const plateSlot = (key) => plateSlots.get(key) || null

/** Corridor floor tile (60 cm tiles with grout lines); UVs are in metres, so repeat = 1 / tile size. */
export function tile() {
  if (tileTex) return tileTex
  const c = canvas(128, 128), x = c.getContext('2d'), R = rng(3)
  x.fillStyle = '#9D958A'; x.fillRect(0, 0, 128, 128)
  for (const [ox, oy] of [[0, 0], [64, 0], [0, 64], [64, 64]]) { const l = 228 + Math.floor(R() * 14); x.fillStyle = `rgb(${l},${l - 3},${l - 9})`; x.fillRect(ox + 2, oy + 2, 60, 60) }
  tileTex = new THREE.CanvasTexture(c); tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping; tileTex.repeat.set(1 / 1.2, 1 / 1.2); tileTex.colorSpace = THREE.SRGBColorSpace; tileTex.anisotropy = 4
  return tileTex
}

/** A textured quad (w × h metres) centred at (x, y, z), turned by ry about Y, showing atlas region `reg`. */
export function quadG(w, h, x, y, z, ry, reg) {
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed()
  const [px, py, rw, rh] = reg, u0 = px / S, u1 = (px + rw) / S, v1 = 1 - py / S, v0 = 1 - (py + rh) / S
  const uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0)
  g.rotateY(ry); g.translate(x, y, z)
  return g
}
