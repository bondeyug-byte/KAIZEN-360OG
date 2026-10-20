// Campus 3D scene — built once, reused across page visits.
// Performance plan for a steady 60 fps:
//  • geometry is merged per floor with vertex colours (≈60 draw calls for the whole campus)
//  • trees, pots, windows, desks are InstancedMeshes
//  • the shadow map is rendered only when something static changes, not every frame
//  • frames are rendered on demand (camera moved / animation running) and pixel ratio adapts to hold 60 fps
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { D, H, FLOORS, CR, AY, P2, floorPlaces, placeAt, posAt, doorAngle, floorName , LOGGIA } from './building.js'
import { REG, atlas, plates, plateSlot, tile, quadG } from './props.js'
import { RISE, R1, R2, TREAD, TREAD2, ENTRY, MID, stairCores, coreAt, rampHeight, landingLevel, stairMove, stairPathAt, LiftSystem, liftAllowed, liftSpecs } from './vertical.js'

const ARM_LEVELS = 8, ARM_LEN = 36, ARM_W = 24
// Amphitheatre = open two-storey terrace recessed INTO the curve (see LOGGIA in building.js). Nothing projects
// beyond the courtyard face. Glass bay at the back-centre, glass drum on the deck, columns on the building line.
const TERRACE = [LOGGIA.lo, LOGGIA.hi]
const BAY = [87.6, 92.4]
const DRUM = { a: 101.5, r: 68.6, R: 2.8 }
const v3 = (r, a, y) => new THREE.Vector3(r * Math.cos(a * D), y, -r * Math.sin(a * D))

/* ---------------- geometry helpers (all non-indexed + vertex colours so they merge) ---------------- */
const tmpColor = new THREE.Color()
function colorize(g, hex) {
  tmpColor.set(hex)
  const n = g.attributes.position.count, a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = tmpColor.r; a[i * 3 + 1] = tmpColor.g; a[i * 3 + 2] = tmpColor.b }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}
function sectorG(r1, r2, a1, a2, h, y, hex) {
  const s = new THREE.Shape()
  s.absarc(0, 0, r2, a1 * D, a2 * D, false)
  s.lineTo(r1 * Math.cos(a2 * D), r1 * Math.sin(a2 * D))
  s.absarc(0, 0, r1, a2 * D, a1 * D, true)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: Math.max(1, Math.ceil((a2 - a1) / 1.5)) })
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0)
  return colorize(g, hex)
}
function boxG(w, h, d, x, y, z, rotY, hex) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed()
  if (rotY) g.rotateY(rotY)
  g.translate(x, y, z)
  return colorize(g, hex)
}
function cylG(rt, rb, h, x, y, z, hex, seg = 10) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg).toNonIndexed()
  g.translate(x, y, z)
  return colorize(g, hex)
}
function merged(list, mat, { cast = true, receive = true } = {}) {
  const g = mergeGeometries(list.filter(Boolean), false)
  list.forEach((x) => x && x.dispose())
  const m = new THREE.Mesh(g, mat)
  m.castShadow = cast; m.receiveShadow = receive
  m.matrixAutoUpdate = false; m.updateMatrix()
  return m
}
/** A floor plate (sector) with vertical openings cut out: stairwells and lift shafts. */
function plateG(r1, r2, a1, a2, h, y, hex, holes) {
  const hs = holes.filter((o) => o.r2 > r1 && o.r1 < r2 && o.hi > a1 && o.lo < a2)
  if (!hs.length) return [sectorG(r1, r2, a1, a2, h, y, hex)]
  // One shape with the openings as holes, arcs sampled at ~1.5° so small openings cost only a few triangles.
  const ring = (ra, rb, lo, hi) => {
    const n = Math.max(1, Math.ceil((hi - lo) / 1.5)), pts = []
    for (let i = 0; i <= n; i++) { const t = (lo + ((hi - lo) * i) / n) * D; pts.push(new THREE.Vector2(rb * Math.cos(t), rb * Math.sin(t))) }
    for (let i = n; i >= 0; i--) { const t = (lo + ((hi - lo) * i) / n) * D; pts.push(new THREE.Vector2(ra * Math.cos(t), ra * Math.sin(t))) }
    return pts
  }
  const s = new THREE.Shape(ring(r1, r2, a1, a2))
  for (const o of hs) s.holes.push(new THREE.Path(ring(Math.max(o.r1, r1 + 0.05), Math.min(o.r2, r2 - 0.05), Math.max(o.lo, a1 + 0.05), Math.min(o.hi, a2 - 0.05)).reverse()))
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false })
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0)
  return [colorize(g, hex)]
}
const CORES = stairCores(), LIFTS = liftSpecs()
const liftR = (L) => [Math.min(L.door, L.back), Math.max(L.door, L.back)]
/** Openings in the plate at the TOP of storey k (= floor k+1's slab / floor k's ceiling band). */
function openings(k, { lifts = true } = {}) {
  if (k < 0 || k >= FLOORS - 1) return []
  const o = CORES.map((c) => ({ r1: 64, r2: 74 - ENTRY, lo: c.lo + 0.05, hi: c.hi - 0.05 }))
  if (lifts) for (const L of LIFTS) { const [a, b] = liftR(L); o.push({ r1: a - 0.05, r2: b + 0.05, lo: L.lo, hi: L.hi }) }
  return o
}
/** Unit lift cab (1 × 1 × 1, floor at y = 0, open towards +z), scaled per lift by its instance matrix. */
function cabGeometry() {
  const parts = [
    [1, 0.04, 1, 0, 0.02, 0, '#8E857B'], [1, 0.03, 1, 0, 0.985, 0, '#F4EFE6'], [1, 1, 0.035, 0, 0.5, -0.4825, '#C9C1B6'],
    [0.035, 1, 1, -0.4825, 0.5, 0, '#BDB4A8'], [0.035, 1, 1, 0.4825, 0.5, 0, '#BDB4A8'], [0.16, 1, 0.035, -0.42, 0.5, 0.4825, '#A79D90'], [0.16, 1, 0.035, 0.42, 0.5, 0.4825, '#A79D90'],
    [0.6, 0.03, 0.02, 0, 0.36, -0.46, '#6E655B'], [0.05, 0.12, 0.02, 0.33, 0.45, 0.46, '#2B2420'],
  ]
  return mergeGeometries(parts.map(([w, h, d, x, y, z, c]) => boxG(w, h, d, x, y, z, 0, c)), false)
}
function canvasTex(w, h, draw, repeat, renderer) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]) }
  if (renderer) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  return t
}
/* ---------------- surface detail (procedural, world-space, no extra textures to load) ---------------- */
const NOISE_GLSL = `
varying vec3 vWPos;
float h31(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.13) + 0.15 * vnoise(p * 4.37); }
`
/**
 * Adds world-space detail to a material: plaster mottling and weathering on buildings, mowing stripes and
 * blade noise on grass (detected from the vertex colour), contact darkening near the ground, and a large-scale
 * variation that breaks visible texture tiling. Pure shader work — no geometry or draw-call cost.
 */
function addDetail(mat, { mode = 'surface', macro = 0.0 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 wpD = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wpD = instanceMatrix * wpD;
      #endif
      vWPos = (modelMatrix * wpD).xyz;`)
    sh.fragmentShader = NOISE_GLSL + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 c = diffuseColor.rgb;
        ${mode === 'surface' ? `
        float green = smoothstep(0.015, 0.07, c.g - max(c.r, c.b));
        float mott = (fbm(vWPos * vec3(0.22, 0.6, 0.22)) - 0.5) * 0.22 + (h31(floor(vWPos * 9.0)) - 0.5) * 0.045;
        float streak = (vnoise(vec3(vWPos.x * 1.3 + vWPos.z * 1.3, vWPos.y * 0.08, 0.0)) - 0.5) * 0.1 - 0.06 * smoothstep(0.55, 0.0, fract(vWPos.y / 3.6)) * step(0.5, vWPos.y);
        float g2 = 1.0;
        if (green > 0.0) g2 = (0.9 + 0.13 * step(0.5, fract((vWPos.x * 0.8 + vWPos.z * 0.6) / 3.2))) * (0.82 + 0.3 * fbm(vWPos * 2.7));
        c *= mix(1.0 + mott + streak, g2, green);
        c *= 1.0 - 0.2 * exp(-max(vWPos.y + 0.3, 0.0) * 1.6);` : ''}
        ${macro ? `c *= ${(1 - macro).toFixed(3)} + ${(2 * macro).toFixed(3)} * fbm(vWPos * 0.035);` : ''}
        diffuseColor.rgb = c;
      }`)
  }
  mat.customProgramCacheKey = () => 'detail-' + mode + macro
  return mat
}

/** Sky dome: deep zenith → hazy horizon, warm glow around the sun. Controlled colours (no blown-out white). */
function skyDome(sunDir) {
  return new THREE.Mesh(new THREE.SphereGeometry(1300, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#2F6FB3') }, mid: { value: new THREE.Color('#7FB0DA') }, hor: { value: new THREE.Color('#DCE6EA') }, sun: { value: sunDir.clone() }, glow: { value: new THREE.Color('#FFE2B0') } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, mid, hor, glow, sun; varying vec3 vDir;
      void main(){ float h = max(vDir.y, 0.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
        float s = max(dot(normalize(vDir), normalize(sun)), 0.0);
        c += glow * (pow(s, 64.0) * 0.9 + pow(s, 6.0) * 0.18);
        c = mix(c, hor * 0.92, smoothstep(0.0, -0.08, vDir.y));
        gl_FragColor = vec4(c, 1.0); }`,
  }))
}

/** Final grade (display space): a touch of contrast and saturation, and a soft vignette. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main(){ vec4 t = texture2D(tDiffuse, vUv); vec3 c = t.rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.0 + 0.14 * amount);
      c = (c - 0.5) * (1.0 + 0.08 * amount) + 0.5;
      vec2 d = vUv - 0.5; c *= 1.0 - 0.32 * amount * dot(d, d);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), t.a); }`,
}

/** Organic tree crown: a subdivided sphere pushed in and out by noise, darker underneath (vertex colours). */
function crownGeometry(seed) {
  let g = new THREE.IcosahedronGeometry(2.6, 2); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g)
  const p = g.attributes.position, v = new THREE.Vector3(), col = new Float32Array(p.count * 3)
  const n3 = (x, y, z) => Math.sin(x * 1.7 + seed) * Math.cos(y * 2.1 - seed) * Math.sin(z * 1.9 + seed * 0.5)
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const d = 1 + 0.16 * n3(v.x, v.y, v.z) + 0.08 * n3(v.x * 2.3, v.y * 2.3, v.z * 2.3)
    v.multiplyScalar(d); v.y *= 0.86
    p.setXYZ(i, v.x, v.y, v.z)
    const shade = 0.58 + 0.5 * Math.min(1, Math.max(0, (v.y + 2.2) / 4.4)) // AO: dark underside, lit crown
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shade
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

function instanced(geom, mat, transforms, { cast = true, colors } = {}) {
  const im = new THREE.InstancedMesh(geom, mat, transforms.length)
  const o = new THREE.Object3D(), c = new THREE.Color()
  transforms.forEach((t, i) => {
    o.position.set(t.x, t.y, t.z); o.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0); o.scale.set(t.sx ?? t.s ?? 1, t.sy ?? t.s ?? 1, t.sz ?? t.s ?? 1)
    o.updateMatrix(); im.setMatrixAt(i, o.matrix)
    if (colors) im.setColorAt(i, c.set(colors[i]))
  })
  im.castShadow = cast; im.receiveShadow = true
  return im
}

const PAL = {
  pink: '#D9B3B4', pinkDark: '#C9989A', maroon: '#7A2E3B', cream: '#EFE7D8', stone: '#BDB09C', slab: '#D8CCBE',
  room: '#E9D1CD', lab: '#DAC4A2', wc: '#C2D8CB', office: '#D5D3E6', library: '#BFD1E0', lobby: '#EFE4D6', canteen: '#E2C9A1',
  lift: '#3A2328', liftSvc: '#5E474C', stairs: '#9C878B', step: '#CFC3B4', wall: '#F2EDE5', dado: '#23413A', desk: '#8A6A4C',
}

/**
 * Interior fit-out for a teaching room, merged into the floor mesh (no extra draw calls, nothing pickable —
 * room picking is done mathematically by placeAt, so furniture can never block a click).
 * d = metres in from the corridor wall, s = metres across the room (0 = centre). Everything keeps the first
 * 1.5 m inside the door clear, and stays ≥ 0.15 m off the walls.
 *  • Classroom (right-hand side): dais, board and teacher's desk on the far wall; two columns of desks + benches
 *    in rows facing the board with a centre aisle.
 *  • Laboratory (left-hand side): wall benches with monitors on both sides, a central two-sided island bench,
 *    storage cabinets on the far wall.
 */
function furnish(p, y, out) {
  const inner = p.side === 'inner', rDoor = inner ? p.r2 : p.r1, dir = inner ? -1 : 1
  const depth = Math.abs(p.r2 - p.r1), W = (p.hi - p.lo) * D * ((p.r1 + p.r2) / 2) - 0.3
  const rot = (p.am + 90) * D
  const box = (w, h, dd, d, s, yy, hex) => { const r = rDoor + dir * d; const q = v3(r, p.am + s / r / D, 0); out.push(boxG(w, h, dd, q.x, y + yy, q.z, rot, hex)) }
  // door sign on the corridor face: amber = laboratory, blue = classroom
  box(0.55, 0.24, 0.04, -0.2, Math.min(1.1, W / 2 - 0.4), 2.15, p.type === 'lab' ? '#C98A1F' : '#2E6DB4')
  if (p.type === 'room') {
    box(W - 0.4, 0.16, 1.7, depth - 1.0, 0, 0.08, '#CDBFA9')                       // teaching dais
    box(Math.min(W - 1.2, 3.4), 1.15, 0.06, depth - 0.2, 0, 1.55, '#2F4A3E')         // board
    box(Math.min(W - 1.0, 3.6), 0.07, 0.1, depth - 0.24, 0, 0.95, '#8A7A66')         // board ledge
    box(1.3, 0.75, 0.6, depth - 1.35, W / 2 - 1.05, 0.53, '#7A5A3E')                // teacher's desk
    const cols = W >= 3.6 ? [-W / 4, W / 4] : [0], dw = Math.min(1.25, W / cols.length - 0.9)
    for (let d = 2.1; d <= depth - 2.9; d += 1.2) for (const s of cols) {
      box(dw, 0.72, 0.45, d, s, 0.38, PAL.desk)                                      // desk
      box(dw, 0.44, 0.32, d - 0.5, s, 0.22, '#5C6F86')                               // bench (students face the board)
    }
  } else {
    const run = depth - 3.3, side = W / 2 - 0.5
    for (const s of [-side, side]) {
      box(0.7, 0.9, run, 1.8 + run / 2, s, 0.45, '#B9B2A6')                          // wall bench
      for (let d = 2.3; d < 1.8 + run - 0.3; d += 1.35) box(0.05, 0.38, 0.55, d, s + (s > 0 ? 0.15 : -0.15), 1.12, '#1E2228') // monitor
    }
    const isl = depth - 4.8
    if (W > 5) {
      box(1.2, 0.9, isl, 2.7 + isl / 2, 0, 0.45, '#A9A196')                          // island bench
      for (let d = 3.1; d < 2.7 + isl - 0.3; d += 1.35) for (const s of [-0.18, 0.18]) box(0.05, 0.38, 0.55, d, s, 1.12, '#1E2228')
    }
    box(W - 1.8, 1.9, 0.5, depth - 0.35, 0, 0.95, '#9AA3AA')                         // storage cabinets
  }
}

export class CampusScene {
  constructor() {
    this.ok = true
    // Probe the GPU once, before the real context: very weak GPUs skip MSAA and start in the Lite tier.
    this.gpu = ''
    try { const c = document.createElement('canvas').getContext('webgl'); const e = c && c.getExtension('WEBGL_debug_renderer_info'); this.gpu = e ? String(c.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; c?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* unknown GPU */ }
    this.weakGpu = /Mali-[2-4]\d\d|Mali-G(31|51|52|57|71|72)\b|Adreno \(TM\) [1-5]\d\d|Adreno [1-5]\d\d|PowerVR|SGX|GMA|HD Graphics( [2-6]\d{2,3})?\b|SwiftShader|llvmpipe|Basic Render/i.test(this.gpu)
    try { this.renderer = new THREE.WebGLRenderer({ antialias: !this.weakGpu, powerPreference: 'high-performance' }) } catch { this.ok = false; return }
    const r = this.renderer
    this.big = r.capabilities.maxTextureSize >= 8192 && !/Mobi|Android/i.test(navigator.userAgent || '')
    // Low-end hint: few cores, little memory or a phone → start at 1× resolution.
    this.lowEnd = this.weakGpu || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4 || /Mobi|Android/i.test(navigator.userAgent || '')
    this.hz = 60; this.measureHz()
    this.dprTarget = this.lowEnd ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)
    this.dpr = this.dprTarget
    r.setPixelRatio(this.dpr)
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 0.88
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFSoftShadowMap
    r.shadowMap.autoUpdate = false
    r.domElement.style.display = 'block'
    r.domElement.style.touchAction = 'none'
    r.domElement.setAttribute('aria-label', '3D model of the campus. Drag to orbit, scroll or pinch to zoom, click a room to route there.')

    this.scene = new THREE.Scene()
    this.skyDay = new THREE.Color('#BFD6E8'); this.skyNight = new THREE.Color('#0B1428')
    this.scene.background = null
    this.scene.fog = new THREE.Fog(new THREE.Color('#D3DFE6'), 380, 1250)
    // Physically based sky (Rayleigh + Mie scattering); the same sky lights the scene through its reflections.
    this.sunDir = new THREE.Vector3(-0.55, 0.68, 0.48).normalize()
    this.sky = skyDome(this.sunDir)
    this.scene.add(this.sky)
    const pmrem = new THREE.PMREMGenerator(r)
    const envScene = new THREE.Scene(); const envSky = skyDome(this.sunDir); envSky.scale.setScalar(0.07); envSky.material.uniforms.glow.value.set('#3A3020') // soft sun in reflections, no hotspot
    envScene.add(envSky)
    const groundEnv = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: '#7B6656' })); groundEnv.rotation.x = -Math.PI / 2; groundEnv.position.y = -2; envScene.add(groundEnv)
    this.envDay = pmrem.fromScene(envScene, 0.02).texture
    this.scene.environment = this.envDay
    pmrem.dispose()

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.3, 1600)
    this.camera.position.set(-30, 88, 98)
    this.controls = new OrbitControls(this.camera, r.domElement)
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.49; this.controls.minDistance = 8; this.controls.maxDistance = 480
    this.controls.target.set(0, 6, -52)
    this.controls.addEventListener('change', () => this.invalidate())

    this.hemi = new THREE.HemisphereLight('#DCEBFF', '#7A6250', 0.75); this.scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight('#FFDDB0', 3.6)
    this.sun.position.copy(this.sunDir).multiplyScalar(260).add(new THREE.Vector3(0, 0, -45)); this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    Object.assign(this.sun.shadow.camera, { left: -150, right: 150, top: 135, bottom: -135, near: 40, far: 560 })
    this.sun.shadow.bias = -0.00025; this.sun.shadow.normalBias = 0.035
    this.sun.target.position.set(0, 0, -45)
    this.scene.add(this.sun, this.sun.target)

    this.mats = {
      vc: addDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.45 })),
      vcGloss: new THREE.MeshStandardMaterial({ vertexColors: true, map: tile(), roughness: 0.3, metalness: 0, envMapIntensity: 0.6 }), // corridor tiles (UVs in metres)
      darkGlass: new THREE.MeshPhysicalMaterial({ color: '#1F3442', roughness: 0.05, metalness: 0.1, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.05, emissive: '#FFC774', emissiveIntensity: 0 }),
      foliage: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.82, envMapIntensity: 0.3 }),
      plain: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, envMapIntensity: 0.3 }),
    }
    // Window: sky-reflecting glass with a soft gradient, a bevelled white frame and a sill shadow (256 px).
    const pane = canvasTex(256, 256, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, w * 0.3, h); g.addColorStop(0, '#6F8FA8'); g.addColorStop(0.45, '#2C4558'); g.addColorStop(1, '#1A2A36')
      x.fillStyle = g; x.fillRect(0, 0, w, h)
      x.fillStyle = 'rgba(255,255,255,.14)'; x.beginPath(); x.moveTo(30, 20); x.lineTo(110, 20); x.lineTo(40, 120); x.lineTo(20, 120); x.closePath(); x.fill()
      x.fillStyle = 'rgba(232,224,210,.55)'; x.fillRect(18, 18, 52, 220) // a curtain on one side
      x.fillStyle = '#F6F1E8'; const fr = 16; x.fillRect(0, 0, w, fr); x.fillRect(0, h - fr, w, fr); x.fillRect(0, 0, fr, h); x.fillRect(w - fr, 0, fr, h); x.fillRect(w / 2 - 6, 0, 12, h); x.fillRect(0, h / 2 - 6, w, 12)
      x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(fr, fr, w - 2 * fr, 5); x.fillRect(fr, h / 2 + 6, w - 2 * fr, 5)
      x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, h - 4, w, 4)
    }, null, r)
    pane.generateMipmaps = true; pane.minFilter = THREE.LinearMipmapLinearFilter
    this.mats.window = new THREE.MeshStandardMaterial({ map: pane, roughness: 0.12, metalness: 0.35, envMapIntensity: 1.25, emissive: '#FFC774', emissiveMap: pane, emissiveIntensity: 0 })

    this.floors = []
    this.layer = 'all'
    this.heat = false
    this.mode = 'campus'
    this.floor = 0
    this.night = false
    this.quality = 'auto'
    this.listeners = {}
    this.walk = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, keys: {}, foot: 0, zone: null, lift: null, panel: false, info: '' }
    this.flight = null; this.tour = null
    this.nav = null
    this.route = null
    this.youAt = null
    this.dirty = true; this.shadowDirty = true
    this.frames = []; this.lastAdapt = 0

    this.buildGround()
    this.buildCourtyard()
    this.buildGate()
    for (let f = 0; f < FLOORS; f++) this.buildFloor(f)
    this.buildTerrace()
    this.buildArms()
    this.buildRoof()
    this.buildNightLights()
    this.buildMarkers()
    this.role = 'student'
    this.buildLifts()
    this.setupPicking()
    this.setupWalkInput()
    this.applyVisibility()
    this.setQuality('auto') // weak GPUs start in Lite; low-end devices at 1× resolution
    this.loop = this.loop.bind(this)
  }

  on(evt, fn) { this.listeners[evt] = fn }
  emit(evt, data) { this.listeners[evt]?.(data) }
  invalidate() { this.dirty = true }

  /* ---------------- build ---------------- */
  buildGround() {
    // 1024 px herringbone-free running-bond pavers: grout, per-brick tone, speckle and worn edges.
    let sd = 7; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647
    const paver = canvasTex(1024, 1024, (x, w, h) => {
      x.fillStyle = '#7E4A39'; x.fillRect(0, 0, w, h)
      const BW = 64, BH = 32
      for (let row = 0; row < h / BH; row++) { const off = row % 2 ? BW / 2 : 0
        for (let c = -1; c < w / BW + 1; c++) {
          const l = 52 + rnd() * 14, hue = 14 + rnd() * 8
          x.fillStyle = `hsl(${hue} ${38 + rnd() * 12}% ${l}%)`; x.fillRect(c * BW + off + 2, row * BH + 2, BW - 4, BH - 4)
          x.fillStyle = 'rgba(255,240,225,.10)'; x.fillRect(c * BW + off + 2, row * BH + 2, BW - 4, 3)
          x.fillStyle = 'rgba(40,15,8,.16)'; x.fillRect(c * BW + off + 2, row * BH + BH - 5, BW - 4, 3)
        } }
      for (let i = 0; i < 14000; i++) { x.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.09)' : 'rgba(255,255,255,.07)'; x.fillRect(rnd() * w, rnd() * h, 1.5, 1.5) }
    }, [24, 19], this.renderer)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(380, 300), addDetail(new THREE.MeshStandardMaterial({ map: paver, roughness: 0.9, envMapIntensity: 0.25 }), { mode: 'macro', macro: 0.14 }))
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.3, -30); ground.receiveShadow = true
    this.scene.add(ground)
  }

  buildCourtyard() {
    const g = []
    g.push(sectorG(18, 50, 50, 130, 0.08, -0.3, '#5F8A47'))       // lawn
    g.push(sectorG(40, 43, 50, 130, 0.1, -0.29, '#D9BFA4'))       // ring path
    g.push(sectorG(39.3, 40, 50, 130, 0.7, -0.3, '#3F6A33'), sectorG(43, 43.7, 50, 130, 0.7, -0.3, '#3F6A33'))
    g.push(boxG(4.6, 0.1, 70, 0, -0.2, 3, 0, '#D9BFA4'))           // walkway from the gate
    // statue plaza
    const plaza = new THREE.CylinderGeometry(8, 8, 0.12, 40).toNonIndexed(); plaza.translate(0, -0.2, -32); g.push(colorize(plaza, '#D6C3AA'))
    // statue: rock base, seated figure, canopy on a curved pole (as in the photos)
    const rock = new THREE.DodecahedronGeometry(1.9, 0).toNonIndexed(); rock.scale(1.3, 0.75, 1.15); rock.translate(0, 0.9, -32); g.push(colorize(rock, '#8E8478'))
    g.push(cylG(1.0, 1.05, 0.5, 0, 2.0, -32, '#D98A3D', 16), cylG(0.42, 0.62, 1.25, 0, 2.85, -32, '#D98A3D', 12))
    const head = new THREE.SphereGeometry(0.33, 12, 8).toNonIndexed(); head.translate(0, 3.7, -32); g.push(colorize(head, '#B07A4F'))
    const turban = new THREE.SphereGeometry(0.37, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed(); turban.translate(0, 3.77, -32); g.push(colorize(turban, '#D98A3D'))
    g.push(cylG(0.09, 0.12, 6.4, 0, 3.2, -34.3, '#5B4636', 8))
    const can = new THREE.ConeGeometry(3.4, 0.9, 32, 1, true).toNonIndexed(); can.translate(0, 6.9, -32.3); g.push(colorize(can, '#C07A45'))
    const cap = new THREE.CylinderGeometry(3.4, 3.4, 0.12, 32).toNonIndexed(); cap.translate(0, 6.45, -32.3); g.push(colorize(cap, '#A9653A'))
    // lamp posts around the plaza
    for (let k = 0; k < 8; k++) { const a = k * 45 * D; g.push(cylG(0.07, 0.1, 3.6, 9.5 * Math.cos(a), 1.5, -32 + 9.5 * Math.sin(a), '#3A3F3A', 6)) }
    this.scene.add(merged(g, this.mats.vc))

    // Trees (instanced): dense shade trees between the plaza and the building, plus a few outside
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const trees = []
    for (let i = 0; i < 46; i++) {
      const a = 52 + rnd() * 76, r = 14 + rnd() * 34, p = v3(r, a, 0)
      if (Math.abs(p.x) < 4 && p.z > -40) continue
      if (Math.hypot(p.x, p.z + 32) < 11) continue
      trees.push({ x: p.x, z: p.z, s: 0.9 + rnd() * 0.6 })
    }
    for (let i = 0; i < 22; i++) { const p = v3(100 + rnd() * 14, 50 + i * 3.7, 0); trees.push({ x: p.x, z: p.z, s: 1 + rnd() * 0.5 }) }
    for (let i = 0; i < 10; i++) trees.push({ x: (i % 2 ? 1 : -1) * (14 + rnd() * 30), z: 14 + rnd() * 24, s: 0.9 + rnd() * 0.4 })
    const trunk = new THREE.CylinderGeometry(0.22, 0.35, 3.4, 7)
    this.scene.add(instanced(trunk, new THREE.MeshStandardMaterial({ color: '#6E4E35', roughness: 0.95 }), trees.map((t) => ({ x: t.x, y: 1.4 * t.s, z: t.z, s: t.s }))))
    const crown = crownGeometry(1.3); this.crownFull = crown
    this.crownLite = (() => { let g = new THREE.IcosahedronGeometry(2.5, 1); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const y = g.attributes.position.getY(i); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = 0.6 + 0.45 * Math.min(1, Math.max(0, (y + 2.2) / 4.4)) } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.scale(1, 0.86, 1); g.computeVertexNormals(); return g })()
    const crowns = [], cc = []
    trees.forEach((t) => { for (let k = 0; k < 2; k++) { crowns.push({ x: t.x + (k ? 0.9 : -0.6) * t.s, y: (3.6 + k * 1.1) * t.s, z: t.z + (k ? -0.5 : 0.6) * t.s, s: t.s * (k ? 0.85 : 1.05) }); cc.push(k ? '#3D7334' : '#2F5F2A') } })
    this.crowns = instanced(crown, this.mats.foliage, crowns, { colors: cc }); this.scene.add(this.crowns)

    // Potted palms (instanced pots + leaves) — around the plaza and along the walkway, as in the photos
    const pots = []
    for (let k = 0; k < 12; k++) { const a = k * 30 * D; pots.push({ x: 6.6 * Math.cos(a), z: -32 + 6.6 * Math.sin(a) }) }
    for (let z = 32; z > -20; z -= 5) { pots.push({ x: -3.4, z }, { x: 3.4, z }) }
    for (let a = 54; a <= 126; a += 6) { const p = v3(46.5, a, 0); pots.push({ x: p.x, z: p.z }) }
    this.scene.add(instanced(new THREE.CylinderGeometry(0.42, 0.32, 0.7, 10), new THREE.MeshStandardMaterial({ color: '#B4532F', roughness: 0.8 }), pots.map((p) => ({ x: p.x, y: 0.05, z: p.z }))))
    const leaves = []
    pots.forEach((p) => { for (let k = 0; k < 5; k++) leaves.push({ x: p.x + Math.cos(k * 1.3) * 0.25, y: 1.1, z: p.z + Math.sin(k * 1.3) * 0.25, rx: Math.sin(k * 1.3) * 0.5, rz: -Math.cos(k * 1.3) * 0.5 }) })
    this.scene.add(instanced(new THREE.ConeGeometry(0.22, 1.5, 5), new THREE.MeshStandardMaterial({ color: '#3D7334', roughness: 0.9 }), leaves, { cast: false }))
  }

  buildGate() {
    const g = [boxG(2.6, 10.5, 2.6, -11, 5, 40, 0, PAL.cream), boxG(2.6, 10.5, 2.6, 11, 5, 40, 0, PAL.cream), boxG(25, 3.4, 2.8, 0, 11.6, 40, 0, PAL.cream), boxG(25.4, 0.4, 3, 0, 13.4, 40, 0, PAL.maroon)]
    this.scene.add(merged(g, this.mats.vc))
    const sign = canvasTex(1024, 128, (x, w, h) => { x.fillStyle = '#EFE6D6'; x.fillRect(0, 0, w, h); x.fillStyle = '#7A2E3B'; x.font = '700 60px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('VIVEKANAND EDUCATION SOCIETY', w / 2, h / 2 + 4) })
    const m = new THREE.MeshBasicMaterial({ map: sign }); this.gateSign = m
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(21, 2.6), m); s1.position.set(0, 11.6, 41.45)
    const s2 = s1.clone(); s2.position.z = 38.55; s2.rotation.y = Math.PI
    this.scene.add(s1, s2)
  }

  windowRow(list, r, a0, a1, step, y, skip) { for (let a = a0; a <= a1 + 1e-6; a += step) { if (skip && skip(a)) continue; const p = v3(r, a, y); list.push({ x: p.x, y, z: p.z, ry: (a + 90) * D }) } }

  buildFloor(f) {
    const y = f * H
    const fl = { f, interior: null, outer: new THREE.Group(), inner: new THREE.Group(), top: new THREE.Group(), labels: null, heat: new THREE.Group(), group: new THREE.Group() }
    fl.group.add(fl.outer, fl.inner, fl.top, fl.heat)
    this.scene.add(fl.group)
    this.floors.push(fl)
    this.buildInterior(f)
    // Outer facade (window side)
    const out = [sectorG(87.8, 88.1, 48, 132, H - 0.37, y, PAL.pink)]
    if (f === 0) out.push(sectorG(87.7, 88.5, 48, 132, 0.7, y - 0.1, PAL.stone))
    fl.outer.add(merged(out, this.mats.vc))
    const wo = []; this.windowRow(wo, 88.13, 49.5, 130.5, 1.8, y + 2.0)
    fl.outer.add(instanced(new THREE.BoxGeometry(1.55, 1.6, 0.14), this.mats.window, wo, { cast: false }))
    // Inner (courtyard) facade: one continuous curve on every floor. On floors 2–3 the central stretch is open
    // (the recessed amphitheatre terrace), with the back wall 10 m inside the building line.
    const inn = [], winIn = []
    const [L0, L1] = TERRACE
    if (f === 2 || f === 3 || f === 4) {
      inn.push(sectorG(63.9, 64.2, 48, L0, H - 0.37, y, PAL.pink), sectorG(63.9, 64.2, L1, 132, H - 0.37, y, PAL.pink))
      this.windowRow(winIn, 63.86, 50, L0 - 1.5, 2.4, y + 2.0); this.windowRow(winIn, 63.86, L1 + 1.5, 130, 2.4, y + 2.0)
      // side walls closing the recess
      inn.push(sectorG(64, 74, L0 - 0.15, L0 + 0.15, H - 0.37, y, PAL.pink), sectorG(64, 74, L1 - 0.15, L1 + 0.15, H - 0.37, y, PAL.pink))
      // back wall of the recess (pink with windows; the glass bay fills the centre)
      inn.push(sectorG(73.85, 74.05, L0, BAY[0], H - 0.37, y, PAL.pink), sectorG(73.85, 74.05, BAY[1], L1, H - 0.37, y, PAL.pink))
      this.windowRow(winIn, 73.8, L0 + 1.2, L1 - 1.2, 2.2, y + 2.0, (a) => (a > BAY[0] - 1.0 && a < BAY[1] + 1.0) || (f === 2 && a > 80.5 && a < 84.5))
      if (f === 3 || f === 4) { // Floors 3 and 4: open balcony galleries overlooking the terrace
        const bal = [sectorG(69.8, 70.3, L0, L1, 0.16, y + 1.0, PAL.cream), sectorG(69.7, 70.4, L0, L1, 0.2, y, PAL.cream)]
        for (let a = L0 + 0.5; a < L1; a += 0.9) { const p = v3(70.05, a, 0); bal.push(cylG(0.07, 0.11, 1.0, p.x, y + 0.5, p.z, PAL.cream, 6)) }
        fl.inner.add(merged(bal, this.mats.vc))
      }
    } else if (f === 0) {
      inn.push(sectorG(63.9, 64.2, 48, 84, H - 0.37, y, PAL.pink), sectorG(63.9, 64.2, 96, 132, H - 0.37, y, PAL.pink))
      this.windowRow(winIn, 63.86, 50, 130, 2.4, y + 2.0, (a) => a > 82.5 && a < 97.5)
      fl.inner.add(new THREE.Mesh(sectorG(63.95, 64.1, 84, 96, 3.0, y, '#ffffff'), this.mats.darkGlass)) // main entrance glazing
    } else {
      inn.push(sectorG(63.9, 64.2, 48, 132, H - 0.37, y, PAL.pink))
      this.windowRow(winIn, 63.86, 50, 130, 2.4, y + 2.0)
    }
    fl.inner.add(merged(inn, this.mats.vc))
    if (winIn.length) fl.inner.add(instanced(new THREE.BoxGeometry(1.5, 1.55, 0.14), this.mats.window, winIn, { cast: false }))
    // Maroon floor band (a strong horizontal line on the real facade)
    const bh = openings(f)
    fl.top.add(merged(f === 2 || f === 3
      ? [...plateG(63.7, 88.3, 48, TERRACE[0], 0.37, y + H - 0.62, PAL.maroon, bh), sectorG(69.7, 88.3, TERRACE[0], TERRACE[1], 0.37, y + H - 0.62, PAL.maroon), ...plateG(63.7, 88.3, TERRACE[1], 132, 0.37, y + H - 0.62, PAL.maroon, bh)]
      : plateG(63.7, 88.3, 48, 132, 0.37, y + H - 0.62, PAL.maroon, bh), this.mats.vc))
    // Heatmap discs
    const HEAT = [[108.75, 3], [71.25, 3], [90, f === 0 ? 3 : 2], [118, 2], [62, 2], [126, 1], [54, 1]]
    const HC = ['', '#E8D3A8', '#D27A3A', '#7A2E3B']
    for (const [a, l] of HEAT) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(2.6 + l * 1.3, 28), new THREE.MeshBasicMaterial({ color: HC[l], transparent: true, opacity: 0.6, depthWrite: false }))
      d.rotation.x = -Math.PI / 2; d.position.copy(v3(CR, a, y + 0.12)); d.renderOrder = 2; fl.heat.add(d)
    }
  }

  /** Interior: slab, corridor, room floors, lifts, stairs, walls and desks — rebuilt when the layer filter changes. */
  buildInterior(f) {
    const fl = this.floors[f]
    if (fl.interior) { fl.group.remove(fl.interior); fl.interior.traverse((o) => o.geometry?.dispose()) }
    const y = f * H, g = [], walls = [], gloss = [], slab = []
    const show = (p) => this.layer === 'all' || ['lobby', 'canteen', 'office', 'library', 'amphi'].includes(p.type) || (this.layer === 'vertical' ? p.type === 'lift' || p.type === 'stairs' : p.type === this.layer)
    const holes = openings(f - 1) // stairwells and lift shafts pass through every slab above the ground
    if (f === 2 || f === 3 || f === 4) { const r0 = f === 2 ? 74 : 70; slab.push(...plateG(64, 88, 48, TERRACE[0], 0.25, y - 0.25, PAL.slab, holes), sectorG(r0, 88, TERRACE[0], TERRACE[1], 0.25, y - 0.25, PAL.slab), ...plateG(64, 88, TERRACE[1], 132, 0.25, y - 0.25, PAL.slab, holes)) }
    else slab.push(...plateG(64, 88, 48, 132, 0.25, y - 0.25, PAL.slab, holes))
    gloss.push(sectorG(74, 78, 48, f === 0 ? 138 : 132, 0.03, y, '#F1F1EC'))
    const radial = new Set()
    const addRadial = (r1, r2, a) => { const k = r1 + ':' + a.toFixed(2); if (radial.has(k)) return; radial.add(k); walls.push(sectorG(r1, r2, a - 0.07, a + 0.07, 3.4, y, PAL.wall)) }
    const corridorWall = (rw, a1, a2) => { walls.push(sectorG(rw - 0.09, rw + 0.09, a1, a2, 1.2, y, PAL.dado), sectorG(rw - 0.09, rw + 0.09, a1, a2, 2.2, y + 1.2, PAL.wall)) }
    const desks = []
    for (const p of floorPlaces(f)) {
      if (p.type === 'amphi') continue
      const vis = show(p)
      if (p.type === 'lift') { if (vis) this.liftShaft(LIFTS.find((L) => L.id === p.id), y, g) }
      else if (p.type === 'stairs') { if (vis) this.stairFlights(CORES.find((c) => c.id === p.id), f, y, g) } else if (p.type === 'canteen') {
        g.push(sectorG(64.3, 87.7, 132.2, 141.8, 0.05, y, PAL.canteen))
      } else {
        if (vis) g.push(sectorG(p.r1 + 0.1, p.r2 - 0.1, p.lo + 0.05, p.hi - 0.05, 0.05, y, PAL[p.type] || PAL.room))
        if (vis && (p.type === 'room' || p.type === 'lab')) furnish(p, y, desks)
      }
      if (p.side === 'inner' || p.side === 'outer') {
        if (p.type !== 'lobby') { addRadial(p.r1, p.r2, p.lo); addRadial(p.r1, p.r2, p.hi) }
        const rw = p.side === 'inner' ? 73.9 : 78.1
        if (['room', 'lab', 'wc', 'office', 'library'].includes(p.type)) {
          const gap = Math.min(0.9, (p.hi - p.lo) / 3)
          corridorWall(rw, p.lo, p.am - gap / 2); corridorWall(rw, p.am + gap / 2, p.hi)
        }
      }
    }
    const grp = new THREE.Group()
    grp.add(merged([...g, ...walls, ...desks], this.mats.vc), merged(gloss, this.mats.vcGloss, { cast: false }))
    fl.interior = grp; fl.detail = null // fittings are added lazily (ensureDetail) the first time the floor is shown
    fl.group.add(grp)
    // The slab stays visible on its own (it is the gallery floor in the open terrace); the rest of the
    // interior is drawn only when you can actually see inside that floor.
    if (fl.slab) { fl.group.remove(fl.slab); fl.slab.geometry.dispose() }
    fl.slab = merged(slab, this.mats.vc); fl.group.add(fl.slab)
    if (this.lite) this.applyLite()
  }

  /**
   * Stage B fittings for one floor, built once on first view and merged into 3 meshes (solid props, glowing panels,
   * decals from the shared atlas) + 1 for nameplates. Nothing here is pickable or used for navigation.
   */
  ensureDetail(f) {
    const fl = this.floors[f]
    if (!fl?.interior || fl.detail || this.layer !== 'all') return
    if (!this.mats.decal) {
      const names = []
      for (let k = 0; k < FLOORS; k++) for (const p of floorPlaces(k)) if (['room', 'lab', 'office', 'library', 'wc'].includes(p.type)) names.push({ key: k + ':' + p.id, text: p.short, kind: p.type })
      this.mats.decal = new THREE.MeshBasicMaterial({ map: atlas() })
      this.mats.plate = new THREE.MeshBasicMaterial({ map: plates(names) })
      this.mats.glow = new THREE.MeshBasicMaterial({ vertexColors: true })
    }
    const y = f * H, vc = [], glow = [], dec = [], pl = []
    // Lite tier (weak GPUs, phones that can't hold the frame rate): keep what helps you find your way — signs,
    // nameplates, floor numbers, lights, counters and main furniture — and drop purely decorative extras.
    const full = !this.lite
    const aOf = (r, s) => s / r / D
    const ry = { out: (a) => (a + 90) * D, in: (a) => (a - 90) * D, cw: (a) => a * D, ccw: (a) => a * D + Math.PI }
    const quad = (out, r, a, yc, w, h, face, reg) => { const q = v3(r, a, 0); out.push(quadG(w, h, q.x, y + yc, q.z, ry[face](a), reg)) }
    const bx = (out, r, a, yc, w, h, dd, hex, turn = 0) => { const q = v3(r, a, 0); out.push(boxG(w, h, dd, q.x, y + yc, q.z, (a + 90) * D + turn, hex)) }
    const cyl = (r, a, yc, rad, h, hex, seg = full ? 10 : 6) => { const q = v3(r, a, 0); vc.push(cylG(rad, rad, h, q.x, y + yc, q.z, hex, seg)) }
    /** Place-local frame: d = metres in from the corridor wall, s = metres across (0 = door axis). */
    const frame = (p) => {
      const inner = p.side === 'inner', rD = inner ? p.r2 : p.r1, dir = inner ? -1 : 1
      const at = (d, s) => { const r = rD + dir * d; return [r, p.am + aOf(r, s)] }
      return {
        W: (p.hi - p.lo) * D * p.rm, depth: p.r2 - p.r1, at,
        box: (w, h, dd, d, s, yc, hex, out = vc) => { const [r, a] = at(d, s); bx(out, r, a, yc, w, h, dd, hex) },
        // quad on the far wall, facing back towards the door
        far: (s, yc, w, h, reg) => { const [r, a] = at((p.r2 - p.r1) - 0.25, s); quad(dec, r, a, yc, w, h, inner ? 'out' : 'in', reg) },
      }
    }
    const walled = ['room', 'lab', 'wc', 'office', 'library']
    const places = floorPlaces(f)
    let outerN = 0, innerN = 0
    for (const p of places) {
      if (!(p.side === 'inner' || p.side === 'outer')) continue
      const inner = p.side === 'inner', face = inner ? 'out' : 'in', rFace = inner ? 74.01 : 77.99
      if (walled.includes(p.type)) {
        const W = (p.hi - p.lo) * D * rFace, gap = Math.min(0.9, (p.hi - p.lo) / 3), sOff = Math.min(1.1, W / 2 - 0.4)
        // skirting on both wall pieces beside the door
        const rs = inner ? [73.99, 74.03] : [77.97, 78.01]
        if (full) vc.push(sectorG(rs[0], rs[1], p.lo + 0.05, p.am - gap / 2, 0.11, y, '#3E3A36'), sectorG(rs[0], rs[1], p.am + gap / 2, p.hi - 0.05, 0.11, y, '#3E3A36'))
        // nameplate beside the door (the door sign is on the other side)
        const slot = plateSlot(f + ':' + p.id)
        if (slot) quad(pl, rFace, p.am + (inner ? 1 : -1) * aOf(rFace, sOff), 1.72, 0.66, 0.15, face, slot)
        if (p.type === 'wc') { quad(dec, rFace, p.am - (inner ? 1 : -1) * aOf(rFace, sOff), 2.05, 0.3, 0.3, face, REG.wc)
          // water cooler next to the washroom
          const a = p.lo + aOf(74, 0.5); bx(vc, 74.25, a, 0.5, 0.4, 1.0, 0.36, '#ECEEEF'); if (full) cyl(74.25, a, 1.16, 0.13, 0.32, '#7FB6E0')
          this.washroom(p, frame(p), full)
        }
        if (!inner && (p.type === 'room' || p.type === 'lab') && outerN++ % 3 === 0) quad(dec, rFace, p.lo + aOf(rFace, 1.0), 1.55, 1.2, 0.9, face, REG.notice)
        if (full && inner && (p.type === 'room' || p.type === 'lab')) quad(dec, rFace, p.hi - aOf(rFace, 0.95), 1.7, 0.9, 0.6, face, REG['art' + (1 + (innerN++ % 3))])
        // window light on the floor of window-side rooms (a cheap baked patch, not a real light)
        if (full && !inner && p.type !== 'wc') vc.push(sectorG(85.7, 87.6, p.lo + 0.25, p.hi - 0.25, 0.012, y + 0.05, '#F7E7D9'))
      }
    }
    // corridor ceiling: bulkheads above the corridor walls and a row of light panels
    const aEnd = f === 0 ? 132 : 132
    vc.push(sectorG(73.82, 73.98, 48, aEnd, H - 0.25 - 3.4, y + 3.4, PAL.wall), sectorG(78.02, 78.18, 48, 132, H - 0.25 - 3.4, y + 3.4, PAL.wall))
    for (let a = 49.5; a <= (f === 0 ? 137 : 130.5); a += 2.4) bx(glow, 76, a, H - 0.29, 1.1, 0.04, 0.34, '#FFF4DC')
    // stairs: exit signs and fire extinguishers on the opposite wall (clear of doors)
    for (const c of CORES) {
      quad(dec, 74.02, c.mid, 2.85, 0.62, 0.31, 'out', REG.exit)
      const op = places.find((p) => p.side === 'outer' && c.mid >= p.lo && c.mid <= p.hi)
      let a = c.mid; if (op && walled.includes(op.type) && Math.abs(a - op.am) < 1.2) a = op.am + (a > op.am ? 1.2 : -1.2)
      cyl(77.82, a, 0.32, 0.09, 0.56, '#C62828'); if (full) cyl(77.82, a, 0.66, 0.035, 0.12, '#222222', 6)
    }
    // lift lobbies: floor-number plate on the free jamb
    for (const L of LIFTS) { const jamb = (L.hi - L.lo) * 0.15; quad(dec, L.door + (L.inner ? 0.12 : -0.12), L.lo + jamb / 2, 1.62, 0.26, 0.26, L.inner ? 'out' : 'in', REG['d' + f]) }
    if (f === 0) this.groundFloor(places, frame, { vc, glow, dec, quad, bx, cyl, y, full })
    if (f === 1) { const lib = places.find((p) => p.id === 'library'); if (lib) this.library(lib, frame(lib), { vc, glow, dec, quad, bx, full }) }
    const grp = new THREE.Group()
    if (vc.length) grp.add(merged(vc, this.mats.vc, { cast: false }))
    if (glow.length) grp.add(merged(glow, this.mats.glow, { cast: false, receive: false }))
    if (dec.length) grp.add(merged(dec, this.mats.decal, { cast: false, receive: false }))
    if (pl.length) grp.add(merged(pl, this.mats.plate, { cast: false, receive: false }))
    fl.detail = grp; fl.detailFull = full; fl.interior.add(grp)
    if (this.lite) this.applyLite()
    this.shadowDirty = true
  }
  /** Washroom: tiled dado, three cubicles on the back wall, a basin counter with a mirror on a side wall. */
  washroom(p, F, full = true) {
    const { W, depth, box } = F, back = depth - 0.12
    box(W - 0.3, 1.2, 0.03, back, 0, 0.6, '#C9D8D6')                                   // back-wall dado
    for (const s of [-W / 2 + 0.06, W / 2 - 0.06]) box(0.03, 1.2, depth - 0.3, depth / 2, s, 0.6, '#C9D8D6')
    const cw = (W - 0.3) / 3, front = back - 2.0
    for (let k = 1; k < 3; k++) box(0.04, 1.9, 2.0, back - 1.0, -W / 2 + 0.15 + k * cw, 1.0, '#8FA9B3') // partitions
    for (let k = 0; k < 3; k++) { const s = -W / 2 + 0.15 + (k + 0.5) * cw; box(cw - 0.8, 1.9, 0.04, front, s - 0.38, 1.0, '#8FA9B3'); if (full) box(0.4, 0.42, 0.6, back - 0.4, s, 0.21, '#F4F4F2') }
    box(0.55, 0.86, 2.2, 2.9, W / 2 - 0.36, 0.43, '#D9D4CB')                           // basin counter
    if (full) for (const d of [2.3, 3.5]) box(0.36, 0.08, 0.42, d, W / 2 - 0.36, 0.9, '#FFFFFF')
    box(0.03, 0.85, 2.1, 2.9, W / 2 - 0.08, 1.65, '#9DB4C0')                           // mirror
  }
  /** Ground floor: lobby, canteen, principal's office, administrative office, examination department. */
  groundFloor(places, frame, K) {
    const { vc, glow, dec, quad, bx, cyl, full } = K
    // Lobby (courtyard entrance at r = 64, corridor at r = 74; the straight path at 88.5°–91.5° stays clear)
    vc.push(sectorG(69.6, 70.4, 92.6, 95.2, 1.05, 0, PAL.desk), sectorG(69.5, 70.5, 92.5, 95.3, 0.05, 1.05, '#E8DCCB')) // reception desk
    quad(dec, 70.0, 93.9, 2.35, 1.8, 0.45, 'in', REG.reception)
    bx(vc, 66.3, 86.6, 0.53, 1.6, 1.05, 0.6, '#6E6458')                                // security counter
    bx(vc, 67.6, 95.76, 1.05, 0.06, 2.1, 2.6, '#5C4434'); bx(vc, 67.6, 95.5, 0.15, 0.5, 0.3, 2.6, '#5C4434'); bx(vc, 67.6, 95.5, 2.05, 0.5, 0.1, 2.6, '#5C4434') // trophy cabinet against the side wall
    for (const yy of [0.75, 1.25, 1.75]) bx(vc, 67.6, 95.5, yy, 0.46, 0.03, 2.4, '#D6C7A6')
    if (full) for (let i = 0; i < 6; i++) { const r = 66.7 + (i % 3) * 0.9, a = 95.45; cyl(r, a, yy(i), 0.08, 0.22, '#D4A73A', 8) }
    function yy(i) { return 0.88 + Math.floor(i / 3) * 0.5 }
    for (const r of [71.0, 72.4]) for (let a = 84.8; a <= 87.2; a += 0.8) { bx(vc, r, a, 0.23, 0.55, 0.45, 0.5, '#4F5D6B'); bx(vc, r + 0.24, a, 0.65, 0.55, 0.45, 0.06, '#4F5D6B') } // waiting seats
    // Canteen (west annex, a 132–142): counter on the end wall, menu boards, tables in rows, tray return
    vc.push(sectorG(67, 85, 140.2, 141.0, 1.0, 0, '#9C8466'), sectorG(67, 85, 140.15, 141.05, 0.04, 1.0, '#E7E2D8'), sectorG(67, 85, 140.18, 140.24, 0.45, 1.04, '#CFE3EA'))
    vc.push(sectorG(64.3, 87.7, 141.75, 141.95, 3.4, 0, PAL.wall))                     // kitchen wall behind the counter
    for (const r of [70, 76, 82]) quad(dec, r, 141.72, 2.55, 2.0, 1.0, 'cw', REG.menu)
    for (const r of [67.6, 71.2, 80.6, 84.2]) for (const a of [133.8, 135.9, 138.0]) {
      bx(vc, r, a, 0.38, 1.7, 0.76, 0.8, '#C8B08A')
      if (full) for (const dr of [-0.62, 0.62]) for (const s of [-0.45, 0.45]) bx(vc, r + dr, a + s / r / D, 0.23, 0.4, 0.45, 0.4, '#8E3B2E')
      else for (const dr of [-0.62, 0.62]) bx(vc, r + dr, a, 0.23, 1.3, 0.45, 0.4, '#8E3B2E') // one bench per side
    }
    bx(vc, 86.7, 133.0, 0.7, 1.2, 1.4, 0.5, '#7D7D78')                                 // tray-return stand
    // Offices on the courtyard side
    for (const p of places) {
      if (p.type !== 'office') continue
      const F = frame(p), { W, depth, box } = F
      if (p.id === 'r15') { // principal
        box(W - 1.6, 0.012, 3.6, 7.0, 0, 0.056, '#7A2E3B')                              // rug
        box(2.1, 0.76, 0.95, 7.1, 0, 0.38, '#5A3B26'); box(0.7, 1.1, 0.6, 8.1, 0, 0.55, '#2C2C2C') // desk, chair
        for (const s of [-0.65, 0.65]) box(0.55, 0.85, 0.55, 5.9, s, 0.42, '#6E5A48')  // visitor chairs
        box(0.85, 0.8, 2.1, 3.2, W / 2 - 0.6, 0.4, '#5E4B3E')                           // sofa
        box(W - 2.6, 2.0, 0.4, depth - 0.3, 0, 1.0, '#6B4B33')                          // bookcase
        for (const s of [-W / 2 + 0.7, W / 2 - 0.7]) { const [r, a] = F.at(depth - 0.9, s); cyl(r, a, 1.1, 0.025, 2.2, '#B9A27A', 6)
          for (const [k, c] of [[0, '#E4802B'], [1, '#F5F5F0'], [2, '#2E7D32']]) bx(vc, r, a + 0.35 / r / D, 1.95 - k * 0.18, 0.62, 0.18, 0.02, c) }
        F.far(0, 2.45, 1.7, 0.32, REG.principal)
      } else if (p.id === 'r16') { // administrative office
        box(W - 2.2, 1.05, 0.6, 3.0, -0.6, 0.52, '#8C7A64'); box(W - 2.0, 0.04, 0.75, 3.0, -0.6, 1.07, '#E3D9C8') // service counter
        for (const [d, s] of [[5.2, -1.6], [5.2, 1.6], [7.0, -1.6], [7.0, 1.6]]) { box(1.4, 0.75, 0.7, d, s, 0.37, PAL.desk); box(0.5, 0.36, 0.05, d + 0.2, s, 0.95, '#1E2228') }
        for (let k = 0; k < 6; k++) box(0.5, 1.32, 0.6, depth - 0.35, -W / 2 + 0.6 + k * 0.6, 0.66, '#9AA3AA') // filing cabinets
        F.far(0.9, 2.45, 1.7, 0.32, REG.admin)
      } else if (p.id === 'r17') { // examination department
        box(2.4, 0.95, 0.7, 3.0, -0.9, 0.47, '#8C7A64')                                 // work counter
        for (const d of [5.4, 6.9, 8.4]) { box(W - 2.0, 2.1, 0.42, d, -0.4, 1.05, '#8A949A'); for (const yy of [0.3, 0.8, 1.3, 1.8]) box(W - 2.2, 0.28, 0.46, d, -0.4, yy, yy > 1 ? '#D9C9A3' : '#C7B48A') } // document racks
        for (let d = 2.2; d <= 4.2; d += 1.0) box(0.6, 1.9, 0.9, d, W / 2 - 0.4, 0.95, '#9AA3AA') // storage cabinets
        F.far(0, 2.6, 1.7, 0.32, REG.exam)
      }
    }
  }
  /** Floor 1 library: shelf rows with book spines, reading tables with lamps, issue counter, catalogue PCs, window seats. */
  library(p, F, K) {
    const { glow, dec, full } = K, { W, box, at } = F
    box(2.6, 1.05, 0.7, 2.4, 2.4, 0.52, '#6B4B33'); box(2.7, 0.04, 0.8, 2.4, 2.4, 1.06, '#D8C3A0') // issue / return counter
    box(1.8, 0.74, 0.7, 2.4, -2.4, 0.37, PAL.desk)                                       // catalogue table
    for (const s of [-2.85, -1.95]) { box(0.5, 0.36, 0.05, 2.5, s, 0.95, '#1E2228'); const [r, a] = at(2.47, s); quad(r, a, 0.95, 0.44, 0.3, p) }
    function quad(r, a, yc, w, h) { const q = v3(r, a, 0); dec.push(quadG(w, h, q.x, (p.f * H) + yc, q.z, (a - 90) * D, REG.screen)) }
    const shelfS = []
    for (let s = -W / 2 + 1.3; s <= W / 2 - 1.3; s += 1.9) if (Math.abs(s) > 1.4) shelfS.push(s)
    shelfS.forEach((s, i) => {
      box(0.5, 2.0, 2.8, 5.0, s, 1.0, '#6B4B33')
      const [r, a] = at(5.0, s), q = v3(r, a, 0), yb = p.f * H
      for (const side of [-1, 1]) for (const yc of full ? [0.45, 0.95, 1.45] : [0.95]) {
        const off = side * 0.26 / r / D, qq = v3(r, a + off, 0)
        dec.push(quadG(2.7, full ? 0.42 : 1.4, qq.x, yb + yc, qq.z, side < 0 ? a * D : a * D + Math.PI, (i + yc * 2) % 2 < 1 ? REG.books1 : REG.books2))
      }
      void q
    })
    for (let s = -W / 2 + 1.6; s <= W / 2 - 1.6; s += 3.1) {                           // reading tables + lamps
      box(1.6, 0.75, 0.9, 7.6, s, 0.37, '#A47C55')
      if (full) for (const dd of [-0.65, 0.65]) for (const ss of [-0.4, 0.4]) box(0.42, 0.45, 0.42, 7.6 + dd, s + ss, 0.22, '#55606B')
      box(0.04, 0.3, 0.04, 7.6, s, 0.9, '#3A3A3A'); box(0.26, 0.08, 0.2, 7.6, s, 1.08, '#FFE3A6', glow)
    }
    for (let s = -W / 2 + 1.0; s <= W / 2 - 1.0; s += 2.2) box(1.8, 0.45, 0.5, 9.45, s, 0.22, '#7A5A3E') // window seats
  }
  /** Switchback stair for storey f → f+1: floor landing, flight 1 (lane A, inwards), mid-landing,
   *  flight 2 (lane B, back to the door line), central wall, and guard rails where a lane leads nowhere. */
  stairFlights(c, f, y, g) {
    const R = (u) => 74 - u, top = f === FLOORS - 1
    g.push(sectorG(R(ENTRY), 73.95, c.lo + 0.05, c.hi - 0.05, 0.05, y, PAL.stairs))
    if (f === 0) g.push(sectorG(R(ENTRY) - 0.08, R(ENTRY), c.laneB[0], c.laneB[1], 1.05, y, PAL.dado)) // nothing below the ground floor
    if (top) { g.push(sectorG(R(ENTRY) - 0.08, R(ENTRY), c.laneA[0], c.laneA[1], 1.05, y, PAL.dado)); return } // nothing above the top floor
    for (let i = 1; i < R1; i++) { const u1 = ENTRY + (i - 1) * TREAD; g.push(sectorG(R(u1 + TREAD), R(u1), c.laneA[0], c.laneA[1], 0.2, y + i * RISE - 0.2, PAL.step)) }
    g.push(sectorG(R(MID[1]), R(MID[0]), c.lo + 0.05, c.hi - 0.05, 0.22, y + R1 * RISE - 0.22, PAL.step))
    for (let j = 1; j < R2; j++) { const u2 = MID[0] - (j - 1) * TREAD2; g.push(sectorG(R(u2), R(u2 - TREAD2), c.laneB[0], c.laneB[1], 0.2, y + (R1 + j) * RISE - 0.2, PAL.step)) }
    g.push(sectorG(R(MID[0]), R(ENTRY), c.mid - 0.05, c.mid + 0.05, H - 0.25, y, PAL.wall)) // wall between the flights
    g.push(sectorG(R(MID[1]) - 0.1, R(MID[1]), c.lo + 0.05, c.hi - 0.05, H - 0.25, y, PAL.wall)) // back wall of the landing
  }
  /** Lift shaft on one floor: back wall, side walls, front wall with the door opening, call buttons. */
  liftShaft(L, y, g) {
    const [ra, rb] = liftR(L), fr = L.door, w = L.hi - L.lo, jamb = w * 0.15
    g.push(sectorG(L.inner ? ra - 0.1 : rb, L.inner ? ra : rb + 0.1, L.lo, L.hi, H - 0.25, y, PAL.lift))
    g.push(sectorG(ra, rb, L.lo - 0.1, L.lo, H - 0.25, y, PAL.lift), sectorG(ra, rb, L.hi, L.hi + 0.1, H - 0.25, y, PAL.lift))
    g.push(sectorG(fr - 0.1, fr + 0.1, L.lo, L.lo + jamb, H - 0.25, y, PAL.liftSvc), sectorG(fr - 0.1, fr + 0.1, L.hi - jamb, L.hi, H - 0.25, y, PAL.liftSvc))
    g.push(sectorG(fr - 0.1, fr + 0.1, L.lo + jamb, L.hi - jamb, H - 0.25 - 2.35, y + 2.35, PAL.liftSvc))
    const q = v3(fr + (L.inner ? 0.14 : -0.14), L.hi - jamb / 2, 0) // call buttons on the corridor side
    g.push(boxG(0.12, 0.28, 0.04, q.x, y + 1.1, q.z, (L.hi - jamb / 2 + 90) * D, '#E9E3D6'))
    g.push(boxG(0.06, 0.06, 0.05, q.x, y + 1.17, q.z, (L.hi - jamb / 2 + 90) * D, '#D9A441'), boxG(0.06, 0.06, 0.05, q.x, y + 1.03, q.z, (L.hi - jamb / 2 + 90) * D, '#D9A441'))
  }
  /** Moving parts: one instanced mesh for every cab, one for every landing door panel (2 draw calls in total). */
  buildLifts() {
    this.liftDirty = new Set()
    this.lifts = new LiftSystem({ onChange: (L) => { this.liftDirty.add(L.id); this.invalidate() } })
    this.liftList = [...this.lifts.lifts.values()]
    this.liftGroup = new THREE.Group(); this.scene.add(this.liftGroup)
    this.liftCabs = new THREE.InstancedMesh(cabGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.25, envMapIntensity: 0.6 }), this.liftList.length)
    this.liftDoors = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#B8B3AB', roughness: 0.3, metalness: 0.6, envMapIntensity: 0.9 }), this.liftList.length * FLOORS * 2)
    for (const m of [this.liftCabs, this.liftDoors]) { m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false; this.liftGroup.add(m) }
    this.liftVisMax = -1
    this.liftList.forEach((L) => this.updateLift(L))
  }
  updateLift(L) {
    const i = this.liftList.indexOf(L), o = this._lo || (this._lo = new THREE.Object3D()), [ra, rb] = liftR(L), rc = (ra + rb) / 2
    const zero = (m, k) => { o.position.set(0, -999, 0); o.scale.set(0.0001, 0.0001, 0.0001); o.updateMatrix(); m.setMatrixAt(k, o.matrix) }
    const vis = this.liftVisMax
    if (L.pos > vis + 0.6) zero(this.liftCabs, i)
    else {
      o.position.copy(v3(rc, L.am, L.pos * H)); o.rotation.set(0, (L.am + 90) * D + (L.inner ? 0 : Math.PI), 0)
      o.scale.set((L.hi - L.lo) * D * rc - 0.12, 2.7, rb - ra - 0.12); o.updateMatrix(); this.liftCabs.setMatrixAt(i, o.matrix)
    }
    const open = L.state === 'MOVING' ? 0 : L.doorT, w = (L.hi - L.lo) * 0.7, pw = w / 2, rp = L.door + (L.inner ? -0.17 : 0.17)
    for (let f = 0; f < FLOORS; f++) for (let s = 0; s < 2; s++) {
      const k = (i * FLOORS + f) * 2 + s
      if (f > vis) { zero(this.liftDoors, k); continue }
      const op = f === L.level ? open : 0, side = s ? 1 : -1
      const a = L.am + side * (pw / 2 + op * pw * 0.92) // panels slide behind the jambs
      o.position.copy(v3(rp, a, f * H + 1.16)); o.rotation.set(0, (a + 90) * D, 0)
      o.scale.set(pw * D * rp + 0.02, 2.32, 0.06); o.updateMatrix(); this.liftDoors.setMatrixAt(k, o.matrix)
    }
    this.liftCabs.instanceMatrix.needsUpdate = true; this.liftDoors.instanceMatrix.needsUpdate = true
  }
  setLiftVisibility(max) { if (max === this.liftVisMax) return; this.liftVisMax = max; this.liftList.forEach((L) => this.updateLift(L)) }
  /** Viewer's role decides which lifts they may use (students: student lifts; staff: all). */
  setAccess(role) { this.role = role || 'student'; this.walk.liftKey = null }

  /** The amphitheatre: recessed Floor 2 terrace with giant columns on the courtyard face, glass bay, drum, mural. */
  buildTerrace() {
    const [a0, a1] = TERRACE, [d0, d1] = LOGGIA.deck
    this.terrace = { deck: new THREE.Group(), colonnade: new THREE.Group(), glass: new THREE.Group() }
    // Entrance sign on the Floor 1 face, above the main entrance (blue board seen in the video)
    const sign = canvasTex(1024, 96, (x, w, h) => { x.fillStyle = '#1F4E9A'; x.fillRect(0, 0, w, h); x.fillStyle = '#FFFFFF'; x.font = '700 52px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('V.E.S. INSTITUTE OF TECHNOLOGY', w / 2, h / 2 + 3) })
    const board = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 0.8), new THREE.MeshBasicMaterial({ map: sign }))
    board.position.copy(v3(63.7, 90, H + 0.8)); board.lookAt(0, H + 0.8, 0); this.scene.add(board)
    // Octagonal terracotta tiles with small cream square inserts (as on the real terrace floor)
    const tile = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#E9DCC8'; x.fillRect(0, 0, w, h)
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cx = i * 64 + 32, cy = j * 64 + 32
        x.fillStyle = (i * 7 + j * 3) % 5 === 0 ? '#9C4E36' : '#A9593F'; x.beginPath()
        for (let k = 0; k < 8; k++) { const t = (k * 45 + 22.5) * D; x.lineTo(cx + 33.5 * Math.cos(t), cy + 33.5 * Math.sin(t)) }
        x.closePath(); x.fill()
      }
      x.fillStyle = '#EFE6D6'
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { x.save(); x.translate(i * 64, j * 64); x.rotate(Math.PI / 4); x.fillRect(-6, -6, 12, 12); x.restore() }
    }, null, this.renderer)
    tile.wrapS = tile.wrapT = THREE.RepeatWrapping; tile.repeat.set(0.25, 0.25)
    const deckG = sectorG(64, 74, a0, a1, 0.25, AY - 0.25, '#ffffff'); deckG.deleteAttribute('color')
    const deck = new THREE.Mesh(deckG, new THREE.MeshStandardMaterial({ map: tile, roughness: 0.35, envMapIntensity: 0.7 }))
    deck.receiveShadow = true; this.terrace.deck.add(deck)
    // Balustrade along the courtyard edge, on the building line
    const bal = [sectorG(64.0, 64.6, a0, a1, 0.18, AY + 1.0, PAL.cream), sectorG(64.0, 64.6, a0, a1, 0.22, AY, '#5E3A30')]
    for (let a = a0 + 0.4; a < a1; a += 0.8) { const p = v3(64.3, a, 0); bal.push(cylG(0.08, 0.13, 0.85, p.x, AY + 0.62, p.z, PAL.cream, 6)) }
    this.terrace.deck.add(merged(bal, this.mats.vc))
    // Giant Corinthian columns on the courtyard face, rising three storeys from the deck to the Floor 5 slab
    const col = []
    const n = 11, step = (a1 - a0) / (n - 1)
    for (let k = 0; k < n; k++) {
      const a = a0 + k * step, p = v3(65.2, a, 0), hgt = 3 * H - 0.9
      col.push(cylG(0.5, 0.56, hgt, p.x, AY + hgt / 2, p.z, PAL.cream, 14))
      col.push(cylG(0.78, 0.55, 0.55, p.x, AY + 3 * H - 0.62, p.z, PAL.cream, 10), boxG(1.5, 0.28, 1.5, p.x, AY + 3 * H - 0.2, p.z, (a + 90) * D, PAL.cream))
      col.push(cylG(0.72, 0.72, 0.28, p.x, AY + 0.14, p.z, PAL.stone, 12))
    }
    this.terrace.colonnade.add(merged(col, this.mats.vc))
    // Central dark-glass bay in the back wall, floors 2–3 (doors onto the terrace at deck level)
    const bay = new THREE.Mesh(sectorG(73.9, 74.05, BAY[0], BAY[1], 3 * H - 0.3, AY, '#ffffff'), this.mats.darkGlass)
    this.terrace.glass.add(bay)
    const mull = []
    for (let a = BAY[0] + 0.8; a < BAY[1]; a += 0.8) { const p = v3(73.85, a, 0); mull.push(boxG(0.08, 3 * H - 0.3, 0.08, p.x, AY + 1.5 * H - 0.15, p.z, 0, '#3A3F44')) }
    for (let k = 1; k < 9; k++) mull.push(sectorG(73.8, 73.9, BAY[0], BAY[1], 0.06, AY + k * (3 * H - 0.3) / 9, '#3A3F44'))
    this.terrace.glass.add(merged(mull, this.mats.vc))
    // Curved dark-glass drum standing on the deck, with a red-tiled planter around it
    const dp = v3(DRUM.r, DRUM.a, 0)
    const drumLow = new THREE.Mesh(new THREE.CylinderGeometry(DRUM.R, DRUM.R, H - 0.1, 40), this.mats.darkGlass)
    drumLow.position.set(dp.x, AY + (H - 0.1) / 2, dp.z); this.terrace.deck.add(drumLow)
    const drumHigh = drumLow.clone(); drumHigh.position.y += H; this.terrace.glass.add(drumHigh)
    const drumTop = drumLow.clone(); drumTop.position.y += 2 * H; this.terrace.glass.add(drumTop)
    const planter = [cylG(DRUM.R + 0.55, DRUM.R + 0.55, 0.5, dp.x, AY + 0.25, dp.z, '#9B3B2E', 36), cylG(DRUM.R + 0.45, DRUM.R + 0.45, 0.1, dp.x, AY + 0.55, dp.z, '#4E7A3A', 36)]
    for (const a of [76.5, 81, 96, 105]) { const q = v3(73.2, a, 0); planter.push(boxG(2.6, 0.5, 1.0, q.x, AY + 0.25, q.z, (a + 90) * D, '#9B3B2E'), boxG(2.4, 0.1, 0.8, q.x, AY + 0.55, q.z, (a + 90) * D, '#4E7A3A')) }
    this.terrace.deck.add(merged(planter, this.mats.vc))
    // Relief mural on the back wall
    const mural = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#E6CDBE'; x.fillRect(0, 0, w, h); x.strokeStyle = '#8C6A55'; x.lineWidth = 9; x.lineCap = 'round'
      x.beginPath(); x.arc(128, 120, 70, 0.3, 5.6); x.stroke(); x.beginPath(); x.arc(128, 120, 34, 2.5, 8.2); x.stroke()
      x.beginPath(); x.moveTo(60, 220); x.bezierCurveTo(110, 170, 150, 250, 200, 200); x.stroke()
      x.fillStyle = '#9C7A63'; x.fillRect(118, 20, 20, 26)
    }, null, this.renderer)
    const mp = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshStandardMaterial({ map: mural, roughness: 0.9 }))
    mp.position.copy(v3(73.75, 82.5, AY + 2.3)); mp.lookAt(0, AY + 2.3, 0); this.terrace.deck.add(mp)
    this.scene.add(this.terrace.deck, this.terrace.colonnade, this.terrace.glass)
  }

  /** The two tall straight blocks that close the "C" at each end of the curve. */
  buildArms() {
    this.arms = []
    for (const [a0, sgn] of [[132, 1], [48, -1]]) {
      const E = v3(CR, a0, 0)
      const t = new THREE.Vector3(-Math.sin(a0 * D) * sgn, 0, -Math.cos(a0 * D) * sgn).normalize()
      const n = new THREE.Vector3(t.z, 0, -t.x)
      const C = E.clone().addScaledVector(t, ARM_LEN / 2)
      const rot = Math.atan2(t.x, t.z)
      const levels = []
      for (let k = 0; k < ARM_LEVELS; k++) {
        const y = k * H, gp = new THREE.Group()
        const parts = [
          boxG(ARM_W, H - 0.37, ARM_LEN, C.x, y + (H - 0.37) / 2, C.z, rot, PAL.pink),
          boxG(ARM_W + 1.2, 0.37, ARM_LEN + 1.2, C.x, y + H - 0.43, C.z, rot, PAL.maroon), // projecting sunshade band
        ]
        if (k === 0) parts.push(boxG(ARM_W + 0.4, 0.7, ARM_LEN + 0.4, C.x, 0.25, C.z, rot, PAL.stone))
        gp.add(merged(parts, this.mats.vc))
        const w = []
        for (let s = -ARM_LEN / 2 + 2; s <= ARM_LEN / 2 - 2; s += 2.6) for (const side of [-1, 1]) {
          const p = C.clone().addScaledVector(t, s).addScaledVector(n, side * (ARM_W / 2 + 0.07))
          w.push({ x: p.x, y: y + 2.0, z: p.z, ry: rot + Math.PI / 2 })
        }
        for (let s = -ARM_W / 2 + 2; s <= ARM_W / 2 - 2; s += 2.6) { const p = C.clone().addScaledVector(t, ARM_LEN / 2 + 0.07).addScaledVector(n, s); w.push({ x: p.x, y: y + 2.0, z: p.z, ry: rot }) }
        gp.add(instanced(new THREE.BoxGeometry(1.6, 1.6, 0.14), this.mats.window, w, { cast: false }))
        this.scene.add(gp); levels.push(gp)
      }
      const roof = merged([boxG(ARM_W + 1, 0.6, ARM_LEN + 1, C.x, ARM_LEVELS * H + 0.3, C.z, rot, PAL.maroon), boxG(6, 3, 8, C.x, ARM_LEVELS * H + 2, C.z, rot, PAL.pink)], this.mats.vc)
      this.scene.add(roof)
      this.arms.push({ levels, roof, E, t, n, C, rot })
    }
  }

  buildRoof() {
    this.roof = merged([sectorG(63.5, 88.5, 48, 132, 0.5, FLOORS * H, PAL.maroon), sectorG(64.2, 87.8, 48.5, 131.5, 0.3, FLOORS * H + 0.5, PAL.pink)], this.mats.vc)
    this.scene.add(this.roof)
  }

  buildNightLights() {
    const glow = canvasTex(128, 128, (x) => { const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,245,215,1)'); g.addColorStop(0.3, 'rgba(255,214,140,.35)'); g.addColorStop(1, 'rgba(255,214,140,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128) })
    this.glows = []
    for (let k = 0; k < 8; k++) {
      const a = k * 45 * D
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      s.position.set(9.5 * Math.cos(a), 3.5, -32 + 9.5 * Math.sin(a)); s.scale.set(5, 5, 1); s.visible = false
      this.scene.add(s); this.glows.push(s)
    }
    this.lamp = new THREE.PointLight('#FFCD80', 0, 60, 2); this.lamp.position.set(0, 6, -32); this.scene.add(this.lamp)
    const pos = []
    for (let i = 0; i < 700; i++) { const a = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.1, r = 700; pos.push(r * Math.cos(a) * Math.sqrt(1 - v * v), r * v, r * Math.sin(a) * Math.sqrt(1 - v * v)) }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.4, fog: false })); this.stars.visible = false
    this.scene.add(this.stars)
  }

  buildMarkers() {
    this.routeGroup = new THREE.Group(); this.scene.add(this.routeGroup)
    this.marker = new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 14), new THREE.MeshBasicMaterial({ color: '#1D5BA8', depthTest: false })); this.marker.renderOrder = 12; this.marker.visible = false
    this.destRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.3, 40), new THREE.MeshBasicMaterial({ color: '#B4532F', transparent: true, depthTest: false, side: THREE.DoubleSide }))
    this.destRing.rotation.x = -Math.PI / 2; this.destRing.renderOrder = 11; this.destRing.visible = false
    this.destPin = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.8, 20), new THREE.MeshBasicMaterial({ color: '#B4532F', depthTest: false })); this.destPin.rotation.x = Math.PI; this.destPin.renderOrder = 12; this.destPin.visible = false
    this.you = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.2, 24), new THREE.MeshBasicMaterial({ color: '#1D5BA8', depthTest: false })); this.you.renderOrder = 12; this.you.visible = false
    this.scene.add(this.marker, this.destRing, this.destPin, this.you)
  }

  /* ---------------- labels (built lazily for the floor on screen) ---------------- */
  ensureLabels(f) {
    const fl = this.floors[f]
    if (fl.labels) return
    fl.labels = new THREE.Group()
    for (const p of floorPlaces(f)) {
      if (p.type === 'amphi') continue
      const text = p.type === 'canteen' ? 'Canteen' : p.type === 'library' ? 'Library' : p.type === 'lobby' ? 'Lobby' : p.type === 'stairs' ? (p.id === 'stairs_w' ? 'Stairs W' : 'Stairs E') : p.code
      const dark = p.type === 'lift'
      const tex = canvasTex(256, 64, (x, W, Hh) => {
        x.fillStyle = dark ? '#2B1519' : '#FFFBF6'; x.fillRect(0, 0, W, Hh); x.strokeStyle = dark ? '#2B1519' : '#C9B4AC'; x.lineWidth = 4; x.strokeRect(2, 2, W - 4, Hh - 4)
        x.fillStyle = dark ? '#FBEFEA' : '#2B1519'; x.font = '700 34px ui-monospace, Menlo, monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, W / 2, Hh / 2 + 2)
      })
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
      const w = p.type === 'room' || p.type === 'lab' ? 4.6 : 3.8
      s.scale.set(w, w / 4, 1)
      s.position.copy(v3(p.type === 'canteen' ? 80 : p.rm, p.type === 'canteen' ? 137 : p.am, f * H + (p.type === 'lift' ? H - 0.15 : 3.9)))
      s.userData.place = p
      fl.labels.add(s)
    }
    fl.group.add(fl.labels)
  }

  /* ---------------- visibility per view ---------------- */
  applyVisibility() {
    const m = this.mode, cf = this.floor, campus = m === 'campus' || m === 'tour'
    this.floors.forEach((fl, i) => {
      if (campus) { fl.group.visible = true; fl.outer.visible = fl.inner.visible = fl.top.visible = true }
      else if (m === 'walk') { fl.group.visible = i <= cf + 1; fl.outer.visible = fl.inner.visible = i <= cf; fl.top.visible = i < cf }
      else { fl.group.visible = i <= cf; fl.outer.visible = true; fl.inner.visible = i < cf; fl.top.visible = i < cf }
      if (fl.interior) fl.interior.visible = campus ? false : m === 'walk' ? i === cf || i === cf + 1 || (!!this.walk.zone && i === cf - 1) : i === cf
      // fittings: current floor always; on the Lite tier only the floor you are on (saves draw calls on weak GPUs)
      const wantDetail = !!fl.interior?.visible && (!this.lite || i === cf)
      if (wantDetail) this.ensureDetail(i)
      if (fl.detail) fl.detail.visible = wantDetail
      if (fl.labels) fl.labels.visible = !campus && i === cf
      fl.heat.visible = this.heat && !campus && i === cf
    })
    this.terrace.deck.visible = campus || cf >= 2
    this.terrace.colonnade.visible = campus || m === 'walk' || cf >= 4
    this.terrace.glass.visible = campus || m === 'walk' || cf >= 4
    this.arms.forEach((arm) => { arm.levels.forEach((g, k) => (g.visible = campus || k < cf || (m === 'walk' && k <= cf))); arm.roof.visible = campus })
    this.roof.visible = campus
    this.routeGroup.children.forEach((o) => (o.visible = campus || (m === 'walk' ? o.userData.f === cf : o.userData.f <= cf)))
    if (!campus) this.ensureLabels(cf)
    this.setLiftVisibility(campus ? -1 : m === 'walk' ? cf + 1 : cf)
    this.shadowDirty = true; this.invalidate()
  }

  /* ---------------- camera views ---------------- */
  fly(pos, target, dur = 1.3) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) dur = 0.01
    this.flight = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: target, t: 0, dur }
    this.invalidate()
  }
  viewCampus() { this.exitWalk(true); this.stopTour(true); this.mode = 'campus'; this.applyVisibility(); this.fly(new THREE.Vector3(-30, 88, 98), new THREE.Vector3(0, 6, -52)); this.emit('mode', this.mode) }
  viewFloor(f, { fly = true } = {}) { this.exitWalk(true); this.stopTour(true); this.floor = f; this.mode = 'floor'; this.applyVisibility(); if (fly) this.fly(new THREE.Vector3(0, f * H + 78, 2), new THREE.Vector3(0, f * H, -66)); this.emit('mode', this.mode) }
  viewTerrace() { this.floor = 2; this.exitWalk(true); this.stopTour(true); this.mode = 'floor'; this.applyVisibility(); this.fly(new THREE.Vector3(-12, AY + 18, -30), new THREE.Vector3(0, AY + 2, -68)); this.emit('mode', this.mode); this.emit('floor', 2) }
  /** Straight-down plan view of the current floor (or the whole campus). */
  viewTop() { this.exitWalk(true); this.stopTour(true); const f = this.mode === 'campus' ? 0 : this.floor; if (this.mode === 'campus') this.mode = 'floor', this.floor = 0; this.applyVisibility(); this.fly(new THREE.Vector3(0, f * H + 150, -59.99), new THREE.Vector3(0, f * H, -60)); /* camera a hair south of the target → north up, west (labs) on the left, same as the default view and floor plan */; this.emit('mode', this.mode); this.emit('floor', this.floor) }
  setFloor(f) { if (this.mode === 'walk') { this.floor = f; this.enterWalk() } else this.viewFloor(f) }

  /* ---------------- options ---------------- */
  setLayer(layer) { if (layer === this.layer) return; this.layer = layer; for (let f = 0; f < FLOORS; f++) this.buildInterior(f); this.applyVisibility() }
  setHeat(on) { this.heat = on; this.applyVisibility() }
  setNight(on) {
    this.night = on
    this.sky.visible = !on; this.scene.background = on ? this.skyNight.clone() : null
    this.scene.fog.color.set(on ? this.skyNight : '#D3DFE6'); this.scene.environment = on ? null : this.envDay
    this.applyNightPost()
    this.hemi.intensity = on ? 0.25 : 1.1; this.sun.intensity = on ? 0.25 : 2.6; this.sun.color.set(on ? '#8AB0FF' : '#FFEBD0')
    this.mats.window.emissiveIntensity = on ? 0.9 : 0; this.mats.darkGlass.emissiveIntensity = on ? 0.25 : 0; this.syncLite()
    this.glows.forEach((g) => (g.visible = on)); this.lamp.intensity = on ? 320 : 0; if (this.gateSign) this.gateSign.color.set(on ? '#5A5650' : '#ffffff'); this.stars.visible = on
    this.shadowDirty = true; this.invalidate()
  }
  setQuality(q) {
    this.quality = q
    const shadow = (n) => { if (this.sun.shadow.mapSize.x !== n) { this.sun.shadow.mapSize.set(n, n); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null } }
    if (q === 'high') { this.dprTarget = Math.min(window.devicePixelRatio || 1, 2); this.sun.castShadow = true; this.postOn = true; this.aoOn = true; shadow(this.big ? 4096 : 2048) }
    else if (q === 'saver' || q === 'lite') { this.dprTarget = Math.min(1, window.devicePixelRatio || 1) * (this.lowEnd ? 0.85 : 1); this.sun.castShadow = false; this.postOn = false }
    else if (q === 'performance') { this.dprTarget = this.lowEnd ? 0.85 : 1; this.sun.castShadow = !this.lowEnd; this.postOn = false; shadow(1024) } // high frame rate: no post-processing
    else { this.dprTarget = this.lowEnd ? 1 : Math.min(window.devicePixelRatio || 1, 1.5); this.sun.castShadow = true; this.postOn = true; this.aoOn = true; shadow(2048) }
    this.setLite(q === 'lite' || q === 'saver' || ((q === 'auto' || q === 'performance') && this.weakGpu))
    this.frames.length = 0
    this.setDpr(this.dprTarget)
    this.shadowDirty = true
  }
  /**
   * Lite tier for low-end devices: cheap Lambert lighting instead of physically based materials (and no
   * procedural detail shader), no shadows, lighter trees. Same model, same colours and textures.
   */
  setLite(on) { if (!!this.lite === !!on) return; this.lite = !!on; this.resetDetail(); this.applyLite(); this.sun.castShadow = !on && this.quality !== 'saver' && this.quality !== 'lite'; if (this.crowns) this.crowns.geometry = on ? this.crownLite : this.crownFull; this.shadowDirty = true; this.invalidate(); this.emit('tier', this.tier()) }
  /** Drop built fittings whose detail level no longer matches the tier; visible floors rebuild on the next view. */
  resetDetail() {
    let any = false
    for (const fl of this.floors) if (fl.detail && fl.detailFull !== !this.lite) { fl.interior.remove(fl.detail); fl.detail.traverse((o) => o.geometry?.dispose()); fl.detail = null; any = true }
    if (any && this.liftList) this.applyVisibility()
  }
  applyLite() {
    const map = (this._liteMap = this._liteMap || new Map())
    this.scene.traverse((o) => {
      if (!o.isMesh) return
      const m = o.material
      if (this.lite) {
        if (!m?.isMeshStandardMaterial) return
        let l = map.get(m)
        if (!l) { l = new THREE.MeshLambertMaterial({ color: m.color, map: m.map, vertexColors: m.vertexColors, emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity, transparent: m.transparent, opacity: m.opacity, side: m.side, depthWrite: m.depthWrite }); l.userData.orig = m; map.set(m, l) }
        o.material = l
      } else if (m?.userData?.orig) o.material = m.userData.orig
    })
  }
  syncLite() { if (this._liteMap) for (const [m, l] of this._liteMap) { l.emissiveIntensity = m.emissiveIntensity; l.color.copy(m.color) } }
  /** What is actually running, for the UI: 'full', 'fast' or 'lite'. */
  tier() { return this.lite ? 'lite' : this.postOn === false ? 'fast' : 'full' }
  setDpr(d) { this.dpr = d; this.renderer.setPixelRatio(d); this.composer?.setPixelRatio(d); this.resize(); this.invalidate() }

  /**
   * Post-processing: 4× multisampled render → ground-truth ambient occlusion (contact shadows in corners,
   * under trees and between buildings) → gentle bloom (window glow at night) → ACES tone mapping + sRGB.
   * Built lazily on the first frame; 'Battery saver' renders directly without it.
   */
  setupPost() {
    if (this.composer || this.postFailed) return
    try {
      const size = this.renderer.getSize(new THREE.Vector2())
      const rt = new THREE.WebGLRenderTarget(size.x * this.dpr, size.y * this.dpr, { type: THREE.HalfFloatType, samples: 4 })
      const c = new EffectComposer(this.renderer, rt)
      c.setPixelRatio(this.dpr); c.setSize(size.x, size.y)
      c.addPass(new RenderPass(this.scene, this.camera))
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y)
      ao.updateGtaoMaterial({ radius: 3.2, distanceExponent: 1.6, thickness: 3, scale: 1.35, samples: 12, distanceFallOff: 1, screenSpaceRadius: false })
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 12 })
      ao.blendIntensity = 1
      // Labels, route overlays, markers and the sky must not cast ambient occlusion.
      const sky = this.sky
      ao.overrideVisibility = function () { const cache = this._visibilityCache; this.scene.traverse((o) => { cache.set(o, o.visible); if (o.isPoints || o.isLine || o.isSprite || o === sky || (o.material && (o.material.depthTest === false || o.material.transparent))) o.visible = false }) }
      c.addPass(ao)
      const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.18, 0.5, 0.92)
      c.addPass(bloom)
      c.addPass(new OutputPass())
      this.grade = new ShaderPass(GradeShader); c.addPass(this.grade)
      this.composer = c; this.ao = ao; this.bloom = bloom
      if (this.postOn === undefined) this.postOn = true
      if (this.aoOn === undefined) this.aoOn = true
      this.applyNightPost()
    } catch (e) { this.postFailed = true; console.warn('[navigator] post-processing unavailable, rendering directly:', e?.message) }
  }
  applyNightPost() { if (!this.bloom) return; this.bloom.enabled = this.night; this.bloom.strength = 0.5; this.bloom.threshold = 0.7; this.bloom.radius = 0.45 }
  renderFrame(hq = true) {
    if (this.postOn !== false && !this.postFailed) this.setupPost()
    if (this.composer && this.postOn !== false) {
      this.ao.enabled = hq && this.aoOn !== false
      try { this.composer.render(); return } catch (e) { this.postFailed = true; this.composer = null; console.warn('[navigator] post-processing failed, rendering directly:', e?.message) }
    }
    this.renderer.render(this.scene, this.camera)
  }

  /* ---------------- route + location ---------------- */
  setYou(loc) { this.youAt = loc; this.invalidate() }
  setRoute(R) {
    const g = this.routeGroup
    g.children.slice().forEach((o) => { g.remove(o); o.geometry?.dispose() })
    this.releaseNavLift()
    this.route = R && !R.same ? R : null
    if (this.route) { // the vertical part of the route (between floors), driven through the real lift or stairs
      const P = R.pts, i = P.findIndex((q, k) => k > 0 && q.f !== P[k - 1].f)
      this.route.vseg = i > 0 && R.conn ? { d0: R.cum[i - 1], d1: R.cum[i], fromF: P[i - 1].f, toF: P[i].f, conn: R.conn, kind: R.mode === 'stairs' ? 'stairs' : 'lift' } : null
    }
    this.destRing.visible = this.destPin.visible = false
    if (!this.route) { this.applyVisibility(); return }
    const tube = new THREE.MeshBasicMaterial({ color: '#1D5BA8', depthTest: false, transparent: true, opacity: 0.95 })
    const to3 = (p) => { const [x, z] = P2(p.r, p.a); return new THREE.Vector3(x, p.f * H + 0.35, z) }
    const byFloor = new Map()
    for (let i = 1; i < R.pts.length; i++) {
      const a = to3(R.pts[i - 1]), b = to3(R.pts[i]); if (a.distanceTo(b) < 0.01) continue
      const f = Math.min(R.pts[i - 1].f, R.pts[i].f)
      if (!byFloor.has(f)) byFloor.set(f, [])
      byFloor.get(f).push(new THREE.TubeGeometry(new THREE.LineCurve3(a, b), 1, 0.24, 8, false))
    }
    for (const [f, list] of byFloor) { const m = new THREE.Mesh(mergeGeometries(list), tube); list.forEach((x) => x.dispose()); m.renderOrder = 10; m.userData.f = f; g.add(m) }
    const chev = []
    for (let d = 3; d < R.total - 1; d += 4) { const p = posAt(R, d); if (!(p.dx || p.dy)) continue; chev.push({ p }) }
    if (chev.length) {
      const im = new THREE.InstancedMesh(new THREE.ConeGeometry(0.3, 0.75, 10), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }), chev.length)
      const o = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0)
      chev.forEach(({ p }, i) => { o.position.set(p.x, p.h + 0.6, p.y); o.quaternion.setFromUnitVectors(up, new THREE.Vector3(p.dx, 0, p.dy).normalize()); o.scale.set(1, 1, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix) })
      im.renderOrder = 11; im.userData.f = 0; g.add(im)
    }
    const end = to3(R.pts[R.pts.length - 1])
    this.destRing.position.set(end.x, end.y + 0.05, end.z); this.destPin.position.set(end.x, end.y + 2.2, end.z)
    this.destRing.visible = this.destPin.visible = true
    this.applyVisibility()
  }
  startNav(speed = 1) {
    if (!this.route) return
    this.releaseNavLift()
    this.nav = { d: 0, playing: true, speed, arrived: false, lastEmit: 0 }
    const V = this.route.vseg; if (V && V.kind === 'lift') this.lifts.request(V.conn, V.fromF) // send the cab to meet you
    this.invalidate()
  }
  /** Route navigation through a lift moves the real cab; through stairs the marker follows the flights. */
  navVertical(N, p) {
    const V = this.route.vseg; if (!V || V.d1 <= V.d0) return
    const L = V.kind === 'lift' ? this.lifts.get(V.conn) : null
    if (N.d > V.d0 && N.d < V.d1) {
      const u = (N.d - V.d0) / (V.d1 - V.d0)
      if (V.kind === 'stairs') { const q = stairPathAt(V.conn, V.fromF, V.toF, u), [x, z] = P2(q.r, q.a); p.x = x; p.y = z; p.h = q.h }
      else if (L) { L.lock = true; L.queue = []; L.state = 'MOVING'; L.doorT = 0; L.pos = p.h / H; L.level = Math.round(L.pos); this.liftDirty.add(L.id) }
      p.f = Math.max(0, Math.min(FLOORS - 1, Math.floor((p.h + 0.3) / H)))
      this.navLift = L ? L.id : null
    } else if (this.navLift) this.releaseNavLift(N.d >= V.d1)
  }
  releaseNavLift(arrived) {
    const L = this.navLift && this.lifts.get(this.navLift); this.navLift = null
    if (!L) return
    L.lock = false; L.pos = L.level = Math.round(L.pos); L.state = arrived ? 'ARRIVE' : 'IDLE'; this.liftDirty.add(L.id)
  }
  pauseNav(p) { if (this.nav) { this.nav.playing = !p; this.invalidate() } }
  setNavSpeed(s) { if (this.nav) this.nav.speed = s }
  stopNav() { this.releaseNavLift(); this.nav = null; this.marker.visible = false; this.invalidate() }

  /* ---------------- tour ---------------- */
  startTour() {
    this.exitWalk(true); this.mode = 'tour'; this.applyVisibility()
    this.tour = { i: -1, t: 0 }
    this.TOUR = [
      { p: [0, 7, 70], t: [0, 8, 30], title: 'Main gate', text: 'Vivekanand Education Society. The walk in is paved with terracotta tiles and lined with potted palms.' },
      { p: [14, 8, -12], t: [0, 3, -32], title: 'Statue plaza', text: 'The seated Swami Vivekananda statue on its rock base under the canopy, in a ring of potted palms.' },
      { p: [-10, 14, -30], t: [0, 10, -60], title: 'Courtyard face', text: 'One continuous curved face: ground and first floor below, the recessed two-storey amphitheatre terrace behind giant columns, and the top floors above.' },
      { p: [-10, AY + 5, -48], t: [6, AY + 3, -70], title: 'The amphitheatre', text: 'An open terrace recessed into the curve: octagon-tiled deck, Corinthian columns on the building line, the glass bay and drum.' },
      { p: [-140, 46, -10], t: [-60, 14, -45], title: 'West block', text: 'The tall straight blocks at each end close the "C". The canteen is on the ground floor here.' },
      { p: [-30, 88, 98], t: [0, 6, -52], title: 'Campus', text: 'Tour finished. Pick a floor or search for a room.' },
    ]
    this.nextTour(); this.emit('mode', this.mode)
  }
  nextTour() {
    const T = this.tour; if (!T) return
    T.i++; T.t = 0
    if (T.i >= this.TOUR.length) { this.stopTour(); return }
    const k = this.TOUR[T.i]
    this.fly(new THREE.Vector3(...k.p), new THREE.Vector3(...k.t), 2.4)
    this.emit('caption', { title: k.title, text: k.text })
  }
  stopTour(silent) { if (!this.tour) return; this.tour = null; this.emit('caption', null); if (this.mode === 'tour') { this.mode = 'campus'; this.applyVisibility() } if (!silent) this.emit('mode', this.mode) }

  /* ---------------- walk mode ---------------- */
  enterWalk(fromPlace) {
    this.stopTour(true)
    this.mode = 'walk'; this.controls.enabled = false; this.flight = null
    const p = fromPlace || (this.youAt && this.youAt.f === this.floor ? floorPlaces(this.youAt.f).find((x) => x.id === this.youAt.id) : null)
    const a = p ? Math.min(131, Math.max(49, doorAngle(p))) : 90
    this.walk.pos.copy(v3(CR, a, this.floor * H + 1.65)); this.walk.yaw = a * D + Math.PI; this.walk.pitch = -0.05
    Object.assign(this.walk, { foot: this.floor * H, zone: null, lift: null, panel: false })
    this.applyVisibility(); this.emit('mode', this.mode)
  }
  exitWalk(silent) {
    if (this.mode !== 'walk') return
    this.mode = 'floor'; this.controls.enabled = true; this.walk.keys = {}
    if (this.walk.hold) { this.lifts.setHold(this.walk.hold, false); this.walk.hold = null }
    Object.assign(this.walk, { zone: null, lift: null, panel: false }); this.emitLift(null)
    if (!silent) { this.viewFloor(this.floor) }
  }
  setupWalkInput() {
    const k = this.walk.keys
    this.onKeyDown = (e) => {
      if (this.mode !== 'walk' || e.target?.matches?.('input,select,textarea')) return
      if (e.key === 'Escape') { if (this.walk.panel) { this.walk.panel = false; this.walk.info = ''; return } this.exitWalk(); return }
      const key = e.key.toLowerCase()
      if (key === 'e') { this.useLift(); e.preventDefault(); return }
      if (this.walk.lift && /^[0-5g]$/.test(key)) { this.liftGo(key === 'g' ? 0 : +key); e.preventDefault(); return }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { k[key] = true; e.preventDefault(); this.invalidate() }
    }
    this.onKeyUp = (e) => { k[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', this.onKeyDown); window.addEventListener('keyup', this.onKeyUp)
  }
  press(key, on) { this.walk.keys[key] = on; this.invalidate() }
  /** Lift whose cab footprint contains a plan point. */
  liftAt(r, a) { return this.liftList.find((L) => { const [ra, rb] = liftR(L); return r >= ra && r <= rb && a >= L.lo && a <= L.hi }) || null }
  /** Lift whose landing door is within 1.5 m of the walker (corridor side). */
  liftNear(r, a) {
    let best = null, bd = 1.5
    for (const L of this.liftList) {
      const corr = L.inner ? r >= L.door - 0.05 : r <= L.door + 0.05; if (!corr) continue
      const [x1, z1] = P2(r, a), [x2, z2] = P2(L.door, L.am), d = Math.hypot(x2 - x1, z2 - z1)
      if (d < bd) { bd = d; best = L }
    }
    return best
  }
  ready(L) { return L.state !== 'MOVING' && !L.lock && L.doorT > 0.7 }
  /** E key / "Use lift" button: outside → call the lift to this floor; inside → show or hide the floor buttons. */
  useLift() {
    if (this.mode !== 'walk') return false
    const W = this.walk
    if (W.lift) { W.panel = !W.panel; W.info = ''; this.invalidate(); return true }
    const r = Math.hypot(W.pos.x, W.pos.z), a = Math.atan2(-W.pos.z, W.pos.x) / D, L = this.liftNear(r, a)
    if (!L) return false
    if (!liftAllowed(L.id, this.role)) { this.emit('notice', `${L.name} is for staff only. Use a student lift or the stairs.`); return false }
    const ok = this.lifts.request(L.id, this.floor); if (ok) this.invalidate(); return ok
  }
  /** Floor button inside the cab. */
  liftGo(f) {
    const L = this.walk.lift && this.lifts.get(this.walk.lift); if (!L) return false
    const ok = this.lifts.request(L.id, f); this.walk.panel = false; this.walk.info = ''; this.invalidate(); return ok
  }
  emitLift(info) { const k = info ? JSON.stringify(info) : ''; if (k === this.walk.info) return; this.walk.info = k; this.emit('lift', info) }
  setWalkFloor(f) { if (f === this.floor) return; this.floor = f; this.applyVisibility(); this.emit('floor', f) }
  /** One small walking step (≤ 0.2 m) with the stair, lift and doorway rules. Returns false when blocked. */
  walkStep(dx, dz) {
    const W = this.walk, p = W.pos
    const from = { r: Math.hypot(p.x, p.z), a: Math.atan2(-p.z, p.x) / D }
    const nx = p.x + dx, nz = p.z + dz
    let to = { r: Math.max(64.6, Math.min(87.4, Math.hypot(nx, nz))), a: Math.max(48.6, Math.min(this.floor === 0 && !W.lift ? 141 : 131.4, Math.atan2(-nz, nx) / D)) }
    const Lf = W.lift ? this.lifts.get(W.lift) : null, Lt = this.liftAt(to.r, to.a)
    const corridor = (L, q) => (L.inner ? q.r >= L.door && q.r <= 78 : q.r <= L.door && q.r >= 74)
    if (Lf && Lt !== Lf) { // leaving the cab: only through open doors, into the corridor
      if (!this.ready(Lf) || !corridor(Lf, to)) return false
      W.lift = null; W.panel = false; W.zone = null; W.foot = Lf.level * H; this.setWalkFloor(Lf.level); this.applyVisibility()
    } else if (!Lf && Lt) { // boarding: from the corridor, doors open, lift on this floor, and allowed for this person
      if (!corridor(Lt, from) || Lt.level !== this.floor || !this.ready(Lt)) return false
      if (!liftAllowed(Lt.id, this.role)) { if (W.denied !== Lt.id) { W.denied = Lt.id; this.emit('notice', `${Lt.name} is for staff only. Use a student lift or the stairs.`) } return false }
      W.lift = Lt.id; W.zone = 'lift'; this.applyVisibility()
    } else if (!Lf && W.zone !== 'stairs') {
      // walls you can't pass on the corridor side of a lift shaft (no other wall collision exists yet)
      for (const L of this.liftList) { const [ra, rb] = liftR(L); if (to.a >= L.lo - 0.1 && to.a <= L.hi + 0.1 && to.r >= ra && to.r <= rb) return false }
    }
    if (!W.lift) {
      const q = stairMove(from, to, W.foot)
      if (q === from) return false
      to = q
      if (coreAt(to.r, to.a)) {
        const h = rampHeight(to.r, to.a, W.foot); if (h === null) return false
        W.foot = h
        if (W.zone !== 'stairs') { W.zone = 'stairs'; this.applyVisibility() }
        const lvl = landingLevel(to.r, to.a, W.foot); if (lvl !== null) this.setWalkFloor(lvl)
      } else { if (W.zone) { W.zone = null; this.applyVisibility() } W.foot = this.floor * H }
    }
    p.set(to.r * Math.cos(to.a * D), p.y, -to.r * Math.sin(to.a * D))
    return true
  }

  /* ---------------- picking (math, not per-mesh raycasts) ---------------- */
  setupPicking() {
    const el = this.renderer.domElement, ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3()
    let down = null, look = null
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY }
      if (this.mode === 'walk') { look = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId) }
      else if (this.flight && this.mode !== 'tour') this.flight = null
    })
    el.addEventListener('pointermove', (e) => {
      if (this.mode === 'walk' && look) {
        this.walk.yaw -= (e.clientX - look.x) * 0.004
        this.walk.pitch = Math.max(-1.1, Math.min(1.1, this.walk.pitch - (e.clientY - look.y) * 0.004))
        look = { x: e.clientX, y: e.clientY }; this.invalidate()
      }
    })
    el.addEventListener('pointerup', (e) => {
      look = null
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || this.mode !== 'floor') { down = null; return }
      down = null
      const r = el.getBoundingClientRect()
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, this.camera)
      plane.constant = -(this.floor * H + 0.05)
      if (!ray.ray.intersectPlane(plane, hit)) return
      const p = placeAt(this.floor, hit.x, hit.z) || (this.floor === 2 ? placeAt(2, hit.x, hit.z) : null)
      if (p) this.emit('pick', p)
    })
  }

  /* ---------------- lifecycle ---------------- */
  mount(container) {
    this.container = container
    container.appendChild(this.renderer.domElement)
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container)
    this.resize()
    this.running = true; this.clock = performance.now()
    requestAnimationFrame(this.loop)
  }
  unmount() { this.running = false; this.ro?.disconnect(); this.renderer.domElement.remove(); this.container = null }
  setVisible(v) { this.visible = v; if (v) { this.resize(); this.invalidate() } }
  resize() {
    if (!this.container) return
    const w = this.container.clientWidth, h = this.container.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.composer?.setSize(w, h)
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%'
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.invalidate()
  }

  loop(nowMs) {
    if (!this.running) return
    requestAnimationFrame(this.loop)
    const dt = Math.min((nowMs - this.clock) / 1000, 0.08); this.clock = nowMs
    let animating = false
    // lifts run on real time (up to 0.25 s per frame) so a slow device does not slow the ride itself
    if (this.lifts.update(Math.min((nowMs - (this._liftClock || nowMs)) / 1000, 0.25))) animating = true
    this._liftClock = nowMs
    // live navigation (simulated walking)
    if (this.nav && this.route) {
      const N = this.nav
      if (N.playing && !N.arrived) {
        N.d = Math.min(this.route.total, N.d + dt * 1.3 * N.speed); animating = true
        if (N.d >= this.route.total) { N.arrived = true; N.playing = false }
      }
      const p = posAt(this.route, N.d)
      this.navVertical(N, p)
      this.marker.position.set(p.x, p.h + 0.7, p.y); this.marker.visible = true
      if (p.f !== this.floor && this.mode === 'floor') { this.viewFloor(p.f); this.emit('floor', p.f) }
      if (nowMs - N.lastEmit > 200 || N.arrived) { N.lastEmit = nowMs; this.emit('nav', { d: N.d, arrived: N.arrived, f: p.f }) }
    }
    // you-are-here puck
    if (this.youAt && !this.nav) {
      const pl = floorPlaces(this.youAt.f).find((x) => x.id === this.youAt.id)
      if (pl) { const [x, z] = P2(pl.type === 'amphi' ? 69 : pl.type === 'lobby' || pl.type === 'canteen' ? CR : pl.rm, doorAngle(pl)); this.you.position.set(x, this.youAt.f * H + 0.3, z) }
      this.you.visible = this.mode === 'campus' || this.mode === 'tour' || this.youAt.f <= this.floor
    } else this.you.visible = false
    if (this.mode === 'walk') {
      const k = this.walk.keys, sp = 9 * dt, turn = 1.8 * dt
      const moving = k.w || k.s || k.a || k.d || k.arrowup || k.arrowdown || k.arrowleft || k.arrowright
      if (k.arrowleft) this.walk.yaw += turn
      if (k.arrowright) this.walk.yaw -= turn
      const fw = new THREE.Vector3(-Math.sin(this.walk.yaw), 0, -Math.cos(this.walk.yaw)), rt = new THREE.Vector3(Math.cos(this.walk.yaw), 0, -Math.sin(this.walk.yaw))
      const W = this.walk, mv = new THREE.Vector3(), slow = W.zone ? 3 / 9 : 1 // walking pace on stairs and in lifts
      if (k.w || k.arrowup) mv.addScaledVector(fw, sp * slow)
      if (k.s || k.arrowdown) mv.addScaledVector(fw, -sp * slow)
      if (k.a) mv.addScaledVector(rt, -sp * slow)
      if (k.d) mv.addScaledVector(rt, sp * slow)
      const n = Math.max(1, Math.ceil(mv.length() / 0.2))
      for (let i = 0; i < n; i++) if (!this.walkStep(mv.x / n, mv.z / n)) { // blocked: try sliding along one axis
        if (!this.walkStep(mv.x / n, 0)) this.walkStep(0, mv.z / n)
      }
      const r = Math.hypot(W.pos.x, W.pos.z), a = Math.atan2(-W.pos.z, W.pos.x) / D
      const L = W.lift ? this.lifts.get(W.lift) : null
      if (L) { W.foot = L.pos * H; const lv = Math.round(L.pos); if (lv !== this.floor && Math.abs(L.pos - lv) < 0.3) this.setWalkFloor(lv); if (L.state === 'MOVING' || L.lock) animating = true }
      // keep the doors open while someone stands in the doorway
      const near = L || this.liftNear(r, a), inDoor = near && (L ? Math.abs(r - near.door) < 0.8 : Math.abs(r - near.door) < 0.6 && a >= near.lo && a <= near.hi)
      const hold = inDoor ? near.id : null
      if (hold !== W.hold) { if (W.hold) this.lifts.setHold(W.hold, false); if (hold) this.lifts.setHold(hold, true); W.hold = hold }
      W.pos.y = W.foot + 1.65
      if (near) {
        const ok = liftAllowed(near.id, this.role)
        this.emitLift({ id: near.id, name: near.name, inside: !!L, allowed: ok, state: near.state, level: near.level, here: near.level === this.floor && near.state !== 'MOVING', moving: near.state === 'MOVING', queue: [...near.queue], panel: !!L && W.panel, floor: this.floor })
      } else this.emitLift(null)
      this.camera.position.copy(this.walk.pos)
      this.camera.lookAt(this.walk.pos.clone().add(new THREE.Vector3(-Math.sin(this.walk.yaw) * Math.cos(this.walk.pitch), Math.sin(this.walk.pitch), -Math.cos(this.walk.yaw) * Math.cos(this.walk.pitch))))
      if (moving) animating = true
    } else if (this.flight) {
      const F = this.flight; F.t = Math.min(1, F.t + dt / F.dur); const e = F.t * F.t * (3 - 2 * F.t)
      this.camera.position.lerpVectors(F.p0, F.p1, e); this.controls.target.lerpVectors(F.t0, F.t1, e)
      if (F.t >= 1) this.flight = null
      animating = true
    }
    if (this.tour && !this.flight) { this.tour.t += dt; animating = true; if (this.tour.t > 3.4) this.nextTour() }
    if (this.mode !== 'walk' && this.controls.update()) animating = true
    if (this.destRing.visible) {
      const t = nowMs / 1000, ph = (t * 0.8) % 1
      this.destRing.scale.setScalar(1 + ph * 2.2); this.destRing.material.opacity = 1 - ph
      this.destPin.position.y = this.destRing.position.y + 2.2 + Math.sin(t * 3) * 0.3
      animating = true
    }
    if (this.liftDirty.size) { for (const id of this.liftDirty) this.updateLift(this.lifts.get(id)); this.liftDirty.clear(); animating = true }
    if (this.visible === false) return
    // Progressive quality: while anything moves, draw fast frames (no ambient occlusion); ~200 ms after the
    // scene settles, draw one full-quality frame. Motion stays smooth, a still view looks its best.
    if (!animating && !this.dirty) {
      if (this.hqPending && nowMs - this.lastMotion > 200) { this.hqPending = false; this.renderFrame(true) }
      return
    }
    this.dirty = false
    if (this.shadowDirty) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false }
    this.renderFrame(false)
    this.lastMotion = nowMs; this.hqPending = true
    this.emit('pose', null)
    this.adapt(nowMs)
  }

  /** Adaptive quality: hold ~60 fps by trimming the pixel ratio, and restore it when there is headroom.
   *  Only back-to-back frames count, so idle (on-demand) periods don't look like low frame rates. */
  /** Detect the display refresh rate (60/90/120/144 Hz) from requestAnimationFrame timing. */
  measureHz() {
    const t = []; let last = 0
    const step = (now) => { if (last) t.push(now - last); last = now; if (t.length < 40) requestAnimationFrame(step); else { t.sort((a, b) => a - b); const hz = 1000 / t[20]; this.hz = [60, 75, 90, 120, 144].reduce((b, x) => (Math.abs(x - hz) < Math.abs(b - hz) ? x : b), 60); this.emit('fps', this.fps || null) } }
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(step)
  }
  /** Frame-rate the current mode aims for: Performance → the display's rate up to 120; otherwise 60. */
  targetFps() { return this.quality === 'performance' ? Math.min(this.hz, 120) : Math.min(this.hz, 60) }

  /**
   * Adaptive quality: hold the target frame rate while moving. Steps down in order of visual cost:
   * resolution → post-processing (Auto only) → shadows; steps resolution back up when there is headroom.
   * Only back-to-back frames count, so idle (on-demand) periods don't look like low frame rates.
   */
  adapt(nowMs) {
    const gap = nowMs - (this.lastRender || 0)
    this.lastRender = nowMs
    if (gap > 100) return
    const f = this.frames
    f.push(gap); if (f.length > 60) f.shift()
    if (f.length < 30 || nowMs - this.lastAdapt < 1200) return
    const fps = Math.round(1000 / (f.reduce((a, b) => a + b, 0) / f.length))
    this.fps = fps; this.emit('fps', fps)
    this.lastAdapt = nowMs
    if (this.quality !== 'auto' && this.quality !== 'performance') return
    const T = this.targetFps(), floor = this.quality === 'performance' ? 0.6 : 0.75
    if (fps < T * 0.88) {
      if (this.dpr > floor) this.setDpr(Math.max(floor, +(this.dpr - 0.25).toFixed(2)))
      else if (this.postOn !== false) { this.postOn = false; this.invalidate() }
      else if (this.sun.castShadow) { this.sun.castShadow = false; this.shadowDirty = true; this.invalidate() }
      else if (!this.lite) this.setLite(true)
      this.emit('tier', this.tier())
      f.length = 0
    } else if (fps >= T * 0.97 && this.dpr < this.dprTarget) { this.setDpr(Math.min(this.dprTarget, +(this.dpr + 0.25).toFixed(2))); f.length = 0 }
  }

  pose() {
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir)
    return { x: this.camera.position.x, z: this.camera.position.z, hx: dir.x, hz: dir.z }
  }
  label() { return this.mode === 'campus' ? 'Campus' : floorName(this.floor) }
}

let instance = null
export function getScene() {
  if (!instance) { instance = new CampusScene(); if (typeof window !== "undefined") window.__campusScene = instance }
  return instance
}
