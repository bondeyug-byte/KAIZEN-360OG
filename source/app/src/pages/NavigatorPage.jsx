import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Button, Badge, Segmented, cx, inputCls } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { getScene } from '../navigator/scene.js'
import { planStatic, planDynamic, BOUNDS, polyD } from '../navigator/plan.js'
import { allPlaces, place, floorPlaces, floorName, floorShort, buildRoute, routeSummary, posAt, P2, TYPE_FILL } from '../navigator/building.js'
import { prefs } from '../lib/storage.js'

const md = (s) => s.split('**').map((x, i) => (i % 2 ? <b key={i}>{x}</b> : x))
const STEP_ICON = { left: 'back', right: 'chev', up: 'route', lift: 'layers', stairs: 'layers', flag: 'pin' }

export default function NavigatorPage({ query }) {
  const { db, me } = useApp()
  const isStaff = ['teacher', 'hod', 'admin'].includes(me?.role)
  const scene = useMemo(() => getScene(), [])
  const host = useRef(null)
  const [vp, setVp] = useState(scene.ok ? '3d' : 'plan')
  const [floor, setFloor] = useState(scene.ok ? scene.floor : 0)
  const [mode, setMode] = useState(scene.ok ? scene.mode : 'campus')
  const [loc, setLocState] = useState(() => { const l = prefs.get('navLoc', { f: 0, id: 'lobby' }); return place(l.f, l.id) ? l : { f: 0, id: 'lobby' } })
  const [dest, setDest] = useState(null)
  const [travel, setTravel] = useState('student')
  const [lift, setLift] = useState(null) // lift next to (or around) the walker in walk mode
  const [notice, setNotice] = useState(null)
  useEffect(() => { if (scene.ok) scene.setAccess(me?.role) }, [me?.role, scene])
  useEffect(() => { if (!isStaff && travel === 'staff') setTravel('student') }, [isStaff, travel])
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(t) }, [notice])
  const [q, setQ] = useState('')
  const [nav, setNav] = useState(null) // { d, arrived, playing, speed }
  const [navRoute, setNavRoute] = useState(null) // the route being followed (kept after arrival moves "You are at")
  const [caption, setCaption] = useState(null)
  const [fps, setFps] = useState(null)
  const [layer, setLayer] = useState('all')
  const [heat, setHeat] = useState(false)
  const [night, setNight] = useState(false)
  const [tier, setTier] = useState(() => (scene.ok ? scene.tier() : 'lite'))
  const [quality, setQualityState] = useState(() => { const q = prefs.get('navQuality', 'auto'); return q === 'saver' ? 'lite' : ['auto', 'performance', 'high', 'lite'].includes(q) ? q : 'auto' })
  const setQuality = (q) => { setQualityState(q); prefs.set('navQuality', q) }
  useEffect(() => { if (scene.ok && quality !== 'auto') scene.setQuality(quality) }, []) // eslint-disable-line
  const [panelOpen, setPanelOpen] = useState(true)
  // Mobile bottom sheet: three snap heights; drag the handle or tap it to cycle.
  const [sheet, setSheet] = useState('half')
  const [dragH, setDragH] = useState(null)
  const SHEET = { peek: 150, half: 0.46, full: 0.86 }
  const sheetPx = (k) => (SHEET[k] < 1 ? Math.round(SHEET[k] * (window.innerHeight - 117)) : SHEET[k])
  const sheetH = dragH != null ? `${dragH}px` : `${sheetPx(sheet)}px`
  const drag = useRef(null), lastDrag = useRef(0)
  const dragStart = (e) => { drag.current = { y: e.clientY, h: sheetPx(sheet), moved: false }; e.currentTarget.setPointerCapture?.(e.pointerId) }
  const dragMove = (e) => { if (!drag.current) return; const dy = drag.current.y - e.clientY; if (Math.abs(dy) > 4) drag.current.moved = true; if (drag.current.moved) setDragH(Math.max(110, Math.min(sheetPx('full'), drag.current.h + dy))) }
  const dragEnd = (e) => {
    const d = drag.current; drag.current = null
    if (!d || !d.moved) { setDragH(null); return }
    e.preventDefault()
    const h = dragH ?? d.h
    const best = ['peek', 'half', 'full'].reduce((a, k) => (Math.abs(sheetPx(k) - h) < Math.abs(sheetPx(a) - h) ? k : a), 'peek')
    setSheet(best); setDragH(null); lastDrag.current = Date.now()
  }
  const route = useMemo(() => (dest ? buildRoute(loc, dest, travel) : null), [loc, dest, travel])
  const setLoc = (l) => { setLocState(l); prefs.set('navLoc', l) }

  // Mount the shared 3D scene into this page
  useEffect(() => {
    if (!scene.ok) return
    scene.mount(host.current)
    scene.on('pick', (p) => { setDest({ f: p.f, id: p.id }); setPanelOpen(true) })
    scene.on('mode', (m) => setMode(m))
    scene.on('floor', (f) => setFloor(f))
    scene.on('caption', (c) => setCaption(c))
    scene.on('fps', (f) => setFps(f))
    scene.on('tier', (t) => setTier(t))
    scene.on('nav', (n) => setNav((x) => (x ? { ...x, d: n.d, arrived: n.arrived } : x)))
    scene.on('lift', (l) => setLift(l))
    scene.on('notice', (t) => setNotice(t))
    return () => { scene.stopNav(); scene.unmount(); ['pick', 'mode', 'floor', 'caption', 'fps', 'nav', 'tier', 'lift', 'notice'].forEach((k) => scene.on(k, null)) }
  }, [scene])
  useEffect(() => { if (scene.ok) scene.setVisible(vp === '3d') }, [vp, scene])
  useEffect(() => { if (scene.ok) scene.setYou(loc) }, [loc, scene])
  useEffect(() => { if (scene.ok) { scene.setRoute(route); if (route && !route.same) { setFloor(route.B.f); if (route.B.type === 'amphi') scene.viewTerrace(); else scene.viewFloor(route.B.f) } } }, [route, scene])

  // Deep links: #/navigator?f=3&id=l25  ·  ?find=wc  ·  ?floor=2
  const autoGo = useRef(false)
  useEffect(() => {
    autoGo.current = !!query.go
    if (query.f !== undefined && query.id && place(+query.f, query.id)) setDest({ f: +query.f, id: query.id })
    else if (query.find) { const n = nearest(query.find, loc, travel); if (n) setDest({ f: n.f, id: n.id }) }
    else if (query.floor !== undefined) goFloor(+query.floor)
  }, [query.f, query.id, query.find, query.floor, query.go, query.t]) // eslint-disable-line
  // ?go=1 (from the voice assistant): show the destination, then start turn-by-turn navigation.
  useEffect(() => {
    if (!autoGo.current || !route || route.same) return
    autoGo.current = false
    const t = setTimeout(() => startNav(), 1400)
    return () => clearTimeout(t)
  }, [route]) // eslint-disable-line

  // A new destination while a route is being followed ends that navigation (the old steps no longer apply).
  // (Arriving moves "You are at" to the destination; that must not end the arrived view, so this watches dest/travel only.)
  useEffect(() => { if (nav) { scene.ok && scene.stopNav(); setNav(null); setNavRoute(null) } }, [dest?.f, dest?.id, travel]) // eslint-disable-line
  const goFloor = (f) => { setFloor(f); if (scene.ok) scene.setFloor(f) }
  const results = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return []
    const toks = t.split(/\s+/)
    return allPlaces().filter((p) => toks.every((k) => p.search.includes(k))).sort((a, b) => Math.abs(a.f - loc.f) - Math.abs(b.f - loc.f) || a.f - b.f).slice(0, 10)
  }, [q, loc.f])

  useEffect(() => { if (mode === 'walk') setSheet('peek') }, [mode])
  useEffect(() => { if (dest) setSheet((x) => (x === 'peek' ? 'half' : x)) }, [dest])
  const startNav = () => { setSheet('peek'); if (!route || route.same) return; scene.ok && scene.startNav(1); setNavRoute(route); setNav({ d: 0, arrived: false, playing: true, speed: 1 }); setFloor(route.A.f); scene.ok && scene.viewFloor(route.A.f) }
  const endNav = (arrivedHere) => { scene.ok && scene.stopNav(); if (arrivedHere && navRoute) setLoc({ f: navRoute.B.f, id: navRoute.B.id }); setNav(null); setNavRoute(null); setDest(null) }
  useEffect(() => { if (nav?.arrived && navRoute) setLoc({ f: navRoute.B.f, id: navRoute.B.id }) }, [nav?.arrived]) // eslint-disable-line

  const sm = route && !route.same ? routeSummary(route) : null
  const curStep = nav && navRoute ? navRoute.steps.reduce((acc, s, i) => (s.at <= nav.d + 0.01 ? i : acc), 0) : -1

  return (
    <div className="relative flex h-[calc(100dvh-57px)] flex-col lg:h-full lg:flex-row">
      {/* Viewport */}
      <section aria-label="Campus map" className="absolute inset-0 overflow-hidden bg-[#E9DFD5] lg:relative lg:order-2 lg:flex-1">
        <div ref={host} className={cx('absolute inset-0', vp !== '3d' && 'invisible')} />
        {vp === 'plan' && <Plan floor={floor} route={route} you={loc} heat={heat} layer={layer} scene={scene} onPick={(p) => setDest({ f: p.f, id: p.id })} selected={dest && dest.f === floor ? dest.id : null} />}
        {!scene.ok && vp === '3d' && <div className="absolute inset-0 grid place-items-center p-6 text-center"><p><b>3D isn't available in this browser.</b><br />The floor plan still works.</p></div>}

        <div className="absolute left-3 top-3 z-10 flex flex-col gap-2">
          <div className="rounded-xl border border-line bg-surface p-1 shadow-lift"><Segmented label="View" value={vp} onChange={setVp} options={[{ value: '3d', label: '3D model' }, { value: 'plan', label: 'Floor plan' }]} /></div>
          {vp === '3d' && scene.ok && (
            <div className="flex w-fit flex-row gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-lift sm:flex-col" role="group" aria-label="3D controls">
              {[
                ['campus', 'cube', 'Reset view', mode === 'campus', () => scene.viewCampus()],
                ['top', 'map', 'Top-down', false, () => scene.viewTop()],
                ['terrace', 'layers', 'Amphitheatre', false, () => { setFloor(2); scene.viewTerrace() }],
                ['walk', 'user', mode === 'walk' ? 'Leave walk mode' : 'Walk mode', mode === 'walk', () => (mode === 'walk' ? scene.exitWalk() : (scene.mode === 'campus' && scene.viewFloor(floor, { fly: false }), scene.enterWalk()))],
                ['tour', 'spark', caption ? 'Stop tour' : 'Drone tour', !!caption, () => (caption ? scene.stopTour() : scene.startTour())],
                ['night', 'star', night ? 'Day' : 'Night', night, () => { scene.setNight(!night); setNight(!night) }],
              ].map(([k, icn, label, on, fn]) => (
                <button key={k} onClick={fn} aria-pressed={on} className={cx('press flex min-h-[36px] items-center gap-2 rounded-lg px-2.5 text-left text-[13px] font-semibold', on ? 'bg-maroon text-white' : 'text-[#3B4048] hover:bg-ground')}><Icon name={icn} size={17} /><span className="hidden sm:inline">{label}</span></button>
              ))}
            </div>
          )}
        </div>

        <div className="absolute right-3 top-3 z-10 flex flex-col gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-lift" role="group" aria-label="Choose floor">
          <span className="pb-0.5 text-center text-[10px] font-semibold tracking-[.08em] text-muted">FLOOR</span>
          {[5, 4, 3, 2, 1, 0].map((f) => (
            <button key={f} onClick={() => goFloor(f)} aria-label={floorName(f)} aria-pressed={floor === f && mode !== 'campus'} className={cx('press h-9 w-9 rounded-lg font-mono text-[14px] font-semibold', floor === f && mode !== 'campus' ? 'bg-maroon text-white shadow-[0_1px_2px_rgba(18,53,40,.4)]' : 'text-[#3B4048] hover:bg-ground')}>{floorShort(f)}</button>
          ))}
        </div>

        {vp === '3d' && scene.ok && <MiniMap scene={scene} floor={floor} route={route} you={loc} />}
        {fps && vp === '3d' && <span className="absolute bottom-3 right-20 z-10 hidden rounded-md border lg:inline border-line bg-surface/95 px-2 py-1 font-mono text-[11px] font-semibold text-muted" title="Frames per second while moving">{fps}/{scene.targetFps()} fps · {scene.dpr}x</span>}
        {caption && (
          <div role="status" className="fade-in absolute bottom-4 left-1/2 z-20 flex w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-center gap-3 rounded-xl bg-ink px-4 py-3 text-white shadow-pop">
            <div className="flex-1"><b className="block font-display text-[16px] font-semibold">{caption.title}</b><span className="text-[13px] text-white/75">{caption.text}</span></div>
            <button onClick={() => scene.stopTour()} className="press min-h-[36px] rounded-lg border border-white/25 px-3 text-[13px] font-semibold hover:bg-white/10">Stop</button>
          </div>
        )}
        {mode === 'walk' && vp === '3d' && (
          <>
            <p className="absolute left-1/2 top-3 z-10 hidden -translate-x-1/2 rounded-xl bg-surface/95 px-3 py-2 text-xs shadow md:block">Walk mode · <b>W A S D</b> or arrows to move · drag to look · <b>E</b> lift · <b>Esc</b> to leave</p>
            {lift && <LiftPanel lift={lift} scene={scene} />}
            {notice && <p role="status" className="fade-in absolute left-1/2 top-14 z-20 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-[13px] font-semibold text-white shadow-pop">{notice}</p>}
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2"><span className="absolute left-0 top-1.5 h-0.5 w-3.5 bg-white shadow" /><span className="absolute left-1.5 top-0 h-3.5 w-0.5 bg-white shadow" /></div>
            <div className="absolute bottom-[236px] right-3 z-10 grid grid-cols-3 gap-1 lg:bottom-14">
              {[['w', 'route', 'Forward', 'col-start-2'], ['arrowleft', 'back', 'Turn left', 'col-start-1 row-start-2'], ['s', 'x', 'Back', 'col-start-2 row-start-2'], ['arrowright', 'chev', 'Turn right', 'col-start-3 row-start-2']].map(([k, icn, label, pos]) => (
                <button key={k} aria-label={label} className={cx('grid h-12 w-12 touch-none place-items-center rounded-xl border border-line bg-surface/95', pos)}
                  onPointerDown={(e) => { e.preventDefault(); scene.press(k, true) }} onPointerUp={() => scene.press(k, false)} onPointerLeave={() => scene.press(k, false)} onPointerCancel={() => scene.press(k, false)}>
                  <Icon name={k === 'w' ? 'chev' : k === 's' ? 'chev' : icn} className={k === 'w' ? '-rotate-90' : k === 's' ? 'rotate-90' : ''} />
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Side panel */}
      {/* Panel: a draggable bottom sheet on phones (peek / half / full), a collapsible side panel on desktop */}
      <aside aria-label="Navigator panel" style={{ '--sheet-h': sheetH }}
        className={cx('sheet absolute inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom))] z-20 flex h-[var(--sheet-h)] flex-col gap-3.5 overflow-auto overscroll-contain rounded-t-2xl border-t border-line bg-surface p-4 pt-0 shadow-pop',
          'lg:static lg:order-1 lg:h-auto lg:w-[372px] lg:flex-none lg:rounded-none lg:border-r lg:border-t-0 lg:p-5 lg:pb-6 lg:shadow-none lg:transition-[width] lg:duration-300', !panelOpen && 'lg:w-[64px] lg:px-3')}>
        <div className="sticky top-0 z-10 -mx-4 flex flex-col items-center bg-surface px-4 pb-1 pt-2 lg:hidden">
          <button type="button" aria-label={`Panel size: ${sheet}. Tap to change`} onClick={() => { if (Date.now() - lastDrag.current < 300) return; setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek') }}
            onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}
            className="flex h-6 w-24 touch-none items-center justify-center"><span className="h-1.5 w-10 rounded-full bg-line2" /></button>
        </div>
        <div className="flex items-center justify-between">
          <div className={cx(!panelOpen && 'lg:hidden')}><h1 className="font-display text-[22px] font-semibold leading-tight">Campus navigator</h1><p className="text-[13px] text-muted">VESIT main building · G + 5 floors</p></div>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('c360:assistant'))} className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-maroon px-3 text-[13px] font-semibold text-white lg:hidden"><Icon name="mic" size={15} />Ask</button>
          <button className="press hidden h-9 w-9 place-items-center rounded-lg border border-line text-muted hover:bg-ground hover:text-ink lg:grid" onClick={() => setPanelOpen(!panelOpen)} aria-label={panelOpen ? 'Collapse panel' : 'Expand panel'}><Icon name={panelOpen ? 'back' : 'chev'} /></button>
        </div>
        {panelOpen && (nav && navRoute ? (
          <NavPanel route={navRoute} nav={nav} curStep={curStep} scene={scene} setNav={setNav} onEnd={endNav} />
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="nav-q" className="text-[13px] font-medium text-[#3B4048]">Where to?</label>
              <div className="flex h-11 items-center gap-2 rounded-lg border border-line2 bg-surface px-3 transition focus-within:border-maroon focus-within:ring-[3px] focus-within:ring-maroon/12"><Icon name="search" size={17} className="text-muted" /><input id="nav-q" type="search" className="h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none" placeholder="Room 305, Chemistry lab, HOD, W3…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { setDest({ f: results[0].f, id: results[0].id }); setQ('') } }} /></div>
            </div>
            {results.length > 0 && (
              <ul className="slide-down flex flex-col gap-1 rounded-lg border border-line p-1">
                {results.map((p) => (
                  <li key={p.f + p.id}><button onClick={() => { setDest({ f: p.f, id: p.id }); setQ('') }} className="press flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-ground">
                    <span className="h-7 w-7 flex-none rounded-md ring-1 ring-black/5" style={{ background: p.type === 'stairs' ? '#8C7479' : TYPE_FILL[p.type] }} />
                    <span className="min-w-0 flex-1"><b className="block truncate text-[14px] font-semibold">{p.name}</b><small className="text-[12px] text-muted">{floorName(p.f)} · {p.wing}</small></span>
                  </button></li>
                ))}
              </ul>
            )}
            <div className="grid grid-cols-4 gap-1.5">
              {[['wc', 'Washroom', 'pin'], ['lift', 'Lift', 'layers'], ['stairs', 'Stairs', 'route'], ['canteen', 'Canteen', 'cup']].map(([k, l, ic]) => (
                <button key={k} onClick={() => { const n = nearest(k, loc, travel); if (n) setDest({ f: n.f, id: n.id }) }} aria-label={`Nearest ${l.toLowerCase()}`} className="lift flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg border border-line bg-surface px-1 text-[12px] font-semibold text-[#3B4048]"><Icon name={ic} size={17} className="text-maroon" />{l}</button>
              ))}
            </div>
            <LocPicker loc={loc} setLoc={setLoc} />
            {route && !route.same && sm && (
              <section key={route.B.f + route.B.id} className="slide-in-left flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-lift" aria-label="Route">
                <div className="flex items-start justify-between gap-2"><div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted">Route to</p><h2 className="font-display text-[18px] font-semibold leading-tight">{route.B.name}</h2><p className="text-sm text-muted">{floorName(route.B.f)}{route.B.where ? ` · ${route.B.where}` : ''}</p></div><button aria-label="Clear route" onClick={() => setDest(null)} className="press grid h-8 w-8 flex-none place-items-center rounded-lg text-muted hover:bg-sand hover:text-ink"><Icon name="x" size={17} /></button></div>
                <Segmented label="Change floors by" value={travel} onChange={setTravel} options={[{ value: 'student', label: 'Student lift' }, ...(isStaff ? [{ value: 'staff', label: 'Staff lift' }] : []), { value: 'stairs', label: 'Stairs' }]} />
                <p className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-ground px-3 py-2"><b className="font-display text-[20px] font-semibold">{sm.t}</b> <span className="text-[13px] text-muted">{sm.meta}</span><span className="w-full text-[11.5px] text-muted">Estimated from plan distances at a typical walking pace.</span></p>
                <ol className="stagger flex flex-col gap-2">{route.steps.map((s, i) => <li key={i} className="flex gap-2.5 text-[14px] leading-snug"><span className={cx('grid h-6 w-6 flex-none place-items-center rounded-md font-mono text-[11px] font-bold', i === route.steps.length - 1 ? 'bg-terra text-white' : 'bg-maroon-50 text-maroon ring-1 ring-maroon/15')}>{i + 1}</span><span>{md(s.text)}</span></li>)}</ol>
                <Button onClick={startNav} icon="route">Start navigation</Button>
              </section>
            )}
            {route?.same && <p className="rounded-xl bg-sand px-3 py-2 text-sm">You're already at {route.B.short}.</p>}
            <details className="group rounded-lg border border-line bg-surface p-3.5">
              <summary className="flex cursor-pointer list-none items-center justify-between text-[14px] font-semibold"><span className="flex items-center gap-2"><Icon name="layers" size={17} className="text-muted" />Legend, layers & quality</span><Icon name="chev" size={16} className="text-muted transition-transform group-open:rotate-90" /></summary>
              <div className="mt-3 flex flex-col gap-3">
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px]" aria-label="Map legend">
                  {[['room', 'Classroom'], ['lab', 'Lab'], ['office', 'Office / HOD'], ['library', 'Library'], ['wc', 'Washroom'], ['lift', 'Lift'], ['stairs', 'Stairs'], ['amphi', 'Amphitheatre terrace'], ['canteen', 'Canteen'], ['lobby', 'Lobby']].map(([k, l]) => <li key={k} className="flex items-center gap-2"><span className="h-3.5 w-3.5 flex-none rounded-[4px] ring-1 ring-black/10" style={{ background: TYPE_FILL[k] }} />{l}</li>)}
                  <li className="flex items-center gap-2"><span className="h-1 w-3.5 flex-none rounded-full bg-route" />Your route</li>
                  <li className="flex items-center gap-2"><span className="h-3 w-3 flex-none rounded-full bg-route ring-[3px] ring-[#EAF0FC]" />You are here (set manually)</li>
                </ul>
                <div className="flex flex-wrap gap-1.5">{[['all', 'Everything'], ['room', 'Classrooms'], ['lab', 'Labs'], ['wc', 'Washrooms'], ['vertical', 'Lifts & stairs']].map(([k, l]) => <button key={k} aria-pressed={layer === k} onClick={() => { setLayer(k); scene.ok && scene.setLayer(k) }} className={cx('press min-h-[34px] rounded-lg border px-2.5 text-[13px] font-semibold', layer === k ? 'border-maroon/40 bg-maroon-50 text-maroon' : 'border-line2 hover:bg-ground')}>{l}</button>)}</div>
                <label className="flex min-h-[40px] items-center justify-between gap-2 text-sm"><span><b>Crowd heatmap</b><br /><span className="text-muted">Estimated from the timetable at class changeover</span></span><input type="checkbox" className="h-5 w-5 accent-maroon" checked={heat} onChange={(e) => { setHeat(e.target.checked); scene.ok && scene.setHeat(e.target.checked) }} /></label>
                <div><p className="mb-1 text-sm font-semibold">3D quality</p><Segmented label="3D quality" value={quality} onChange={(v) => { setQuality(v); scene.ok && scene.setQuality(v) }} options={[{ value: 'auto', label: 'Auto' }, { value: 'performance', label: `${scene.ok ? Math.min(scene.hz, 120) : 120} fps` }, { value: 'high', label: 'High' }, { value: 'lite', label: 'Lite' }]} /><p className="mt-1 text-[12px] text-muted">{quality === 'performance' ? `Smoothest: aims for ${scene.ok ? Math.min(scene.hz, 120) : 120} fps (your screen refreshes at ${scene.ok ? scene.hz : '?'} Hz${scene.ok && scene.hz < 120 ? ', so that is its maximum' : ''}). Effects are simplified and resolution adapts.` : quality === 'auto' ? 'Best look when still, smooth while moving. Steps down automatically on slower devices.' : quality === 'high' ? 'Full effects at full resolution. Needs a strong GPU.' : 'For older phones and laptops: simple lighting, no shadows or effects, lighter trees. Uses the least battery.'}{scene.ok && tier === 'lite' && quality !== 'lite' ? ' Running in Lite mode to stay smooth on this device.' : ''}</p></div>
              </div>
            </details>
          </>
        ))}
      </aside>
    </div>
  )
}

/** In-walk lift controls: call button outside, floor buttons inside, live status for both. */
function LiftPanel({ lift: l, scene }) {
  const status = l.moving ? `Moving · passing ${floorShort(Math.round(l.level))}` : l.here ? (l.state === 'OPEN' || l.state === 'DOORS_OPENING' ? 'Doors open' : 'Here') : `At ${floorName(l.level)}`
  return (
    <div className="absolute bottom-[236px] left-3 z-20 w-[min(260px,calc(100%-96px))] rounded-xl border border-line bg-surface/95 p-3 shadow-lift lg:bottom-14" role="group" aria-label={l.name}>
      <p className="text-[13px] font-semibold">{l.name}</p>
      <p className="text-[12px] text-muted" aria-live="polite">{status}{l.queue.length ? ` · next ${l.queue.map(floorShort).join(', ')}` : ''}</p>
      {!l.allowed ? <p className="mt-2 text-[12px] font-semibold text-terra">Staff only. Use a student lift or the stairs.</p>
        : l.inside ? (
          <div className="mt-2 grid grid-cols-6 gap-1">
            {[0, 1, 2, 3, 4, 5].map((f) => <button key={f} onClick={() => scene.liftGo(f)} aria-label={`Go to ${floorName(f)}`} aria-pressed={l.queue.includes(f)} className={cx('press h-9 rounded-lg font-mono text-[13px] font-semibold', f === l.floor && !l.moving ? 'bg-ground text-muted' : l.queue.includes(f) ? 'bg-maroon text-white' : 'border border-line bg-surface hover:bg-ground')}>{floorShort(f)}</button>)}
          </div>
        ) : <button onClick={() => scene.useLift()} className="press mt-2 min-h-[36px] w-full rounded-lg bg-maroon px-3 text-[13px] font-semibold text-white">{l.here ? 'Open doors' : 'Call lift'} <span className="opacity-70">(E)</span></button>}
    </div>
  )
}

function nearest(kind, loc, travel) {
  let c = []
  if (kind === 'wc') c = floorPlaces(loc.f).filter((p) => p.type === 'wc')
  if (kind === 'lift') c = floorPlaces(loc.f).filter((p) => p.type === 'lift' && p.sub === 'student')
  if (kind === 'stairs') c = floorPlaces(loc.f).filter((p) => p.type === 'stairs')
  if (kind === 'canteen') c = [place(0, 'canteen')]
  let best = null, bd = Infinity
  for (const p of c) { const R = buildRoute(loc, { f: p.f, id: p.id }, kind === 'stairs' ? 'stairs' : travel); const d = R.same ? 0 : R.total; if (d < bd) { bd = d; best = p } }
  return best
}

function LocPicker({ loc, setLoc }) {
  const p = place(loc.f, loc.id)
  return (
    <div className="rounded-lg border border-line bg-ground/50 p-3">
      <p className="mb-2 flex items-center gap-2 text-[13px]"><span className="h-2.5 w-2.5 rounded-full bg-route ring-[3px] ring-[#EAF0FC]" /><b className="font-semibold">You are at:</b> {p?.short}, {floorName(loc.f)}</p>
      <div className="grid grid-cols-[72px_1fr] gap-2">
        <label><span className="sr-only">Your floor</span><select className={inputCls} value={loc.f} onChange={(e) => { const f = +e.target.value; setLoc({ f, id: place(f, loc.id) ? loc.id : place(f, 'lobby') ? 'lobby' : floorPlaces(f).find((x) => x.type === 'lift').id }) }}>{[0, 1, 2, 3, 4, 5].map((f) => <option key={f} value={f}>{floorShort(f)}</option>)}</select></label>
        <label><span className="sr-only">Your location</span><select className={inputCls} value={loc.id} onChange={(e) => setLoc({ f: loc.f, id: e.target.value })}>{floorPlaces(loc.f).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
    </div>
  )
}

function NavPanel({ route, nav, curStep, scene, setNav, onEnd }) {
  const next = route.steps[curStep + 1]
  const left = Math.max(0, route.total - nav.d)
  const step = nav.arrived ? { kind: 'flag', text: `You've arrived at **${route.B.short}**` } : next || route.steps[curStep]
  return (
    <div className="flex flex-col gap-3">
      <section aria-live="polite" className="pop flex flex-col gap-3 rounded-xl bg-maroon p-4 text-white shadow-lift">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 flex-none place-items-center rounded-lg bg-white text-maroon"><Icon name={STEP_ICON[step.kind] || 'route'} size={28} /></span>
          <div><p className="font-mono text-[12px] tracking-wider text-white/70">{nav.arrived ? 'ARRIVED' : next ? `IN ${Math.max(1, Math.round(next.at - nav.d))} M` : 'NOW'}</p><p className="font-display text-[18px] font-semibold leading-snug">{md(step.text)}</p></div>
        </div>
        <div><div className="mb-1.5 flex justify-between text-[12.5px] text-white/75"><span>{nav.arrived ? 'Done' : `${Math.round(left)} m left`}</span><span>{nav.arrived ? '' : `≈ ${Math.max(5, Math.round(left / 1.3 / 5) * 5)} s (est.)`}</span></div><div className="h-2 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white transition-[width] duration-300" style={{ width: `${(100 * nav.d) / route.total}%` }} /></div></div>
      </section>
      <div className="flex flex-wrap items-center gap-2">
        {!nav.arrived && <Button size="sm" variant="secondary" onClick={() => { scene.ok && scene.pauseNav(nav.playing); setNav({ ...nav, playing: !nav.playing }) }}>{nav.playing ? 'Pause' : 'Resume'}</Button>}
        <label className="flex items-center gap-2 text-sm text-muted">Simulated speed<select className={cx(inputCls, 'w-auto')} value={nav.speed} onChange={(e) => { const s = +e.target.value; scene.ok && scene.setNavSpeed(s); setNav({ ...nav, speed: s }) }}>{[1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}</select></label>
      </div>
      <ol className="flex flex-col gap-1.5">
        {route.steps.map((s, i) => {
          const st = nav.arrived || i < curStep ? 'done' : i === curStep ? 'cur' : 'todo'
          return <li key={i} aria-current={st === 'cur' ? 'step' : undefined} className={cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] transition-colors', st === 'cur' ? 'bg-[#EAF0FC] font-semibold ring-1 ring-route/30' : st === 'done' ? 'text-muted' : '')}>{st === 'done' ? <Icon name="check" className="text-ok" /> : <span className={cx('h-5 w-5 flex-none rounded-full', st === 'cur' ? 'bg-route' : 'border-2 border-terra')} />}<span>{md(s.text)}</span></li>
        })}
      </ol>
      <p className="rounded-lg bg-ground px-3 py-2 text-xs text-muted">Indoors there's no GPS, so the marker walks the route at a typical pace. Change "You are at" if you're somewhere else.</p>
      <Button variant={nav.arrived ? 'primary' : 'secondary'} onClick={() => onEnd(nav.arrived)}>{nav.arrived ? 'Done' : 'End route'}</Button>
    </div>
  )
}

/* ---------- 2D plan with pan / zoom / click ---------- */
function Plan({ floor, route, you, heat, layer, scene, onPick, selected }) {
  const svg = useRef(null)
  const view = useRef({ cx: BOUNDS.x + BOUNDS.w / 2, cy: BOUNDS.y + BOUNDS.h / 2, zoom: 1, vb: null })
  const apply = () => {
    const el = svg.current; if (!el) return
    const w = el.clientWidth || 800, h = el.clientHeight || 500, v = view.current
    const upp = Math.max(BOUNDS.w / w, BOUNDS.h / h) / v.zoom
    v.vb = { x: v.cx - (w * upp) / 2, y: v.cy - (h * upp) / 2, ppu: 1 / upp }
    el.setAttribute('viewBox', `${v.vb.x.toFixed(2)} ${v.vb.y.toFixed(2)} ${(w * upp).toFixed(2)} ${(h * upp).toFixed(2)}`)
    el.classList.toggle('nolabels', v.vb.ppu * 2 < 9.5)
  }
  const fit = () => {
    const v = view.current; v.cx = BOUNDS.x + BOUNDS.w / 2; v.cy = BOUNDS.y + BOUNDS.h / 2; v.zoom = 1
    if (route && !route.same) {
      const pts = route.pts.filter((p) => p.f === floor).map((p) => P2(p.r, p.a))
      if (pts.length) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), el = svg.current
        const x0 = Math.min(...xs) - 14, x1 = Math.max(...xs) + 14, y0 = Math.min(...ys) - 14, y1 = Math.max(...ys) + 12
        const w = el.clientWidth || 800, h = el.clientHeight || 500
        v.zoom = Math.max(1, Math.min(2.4, Math.max(BOUNDS.w / w, BOUNDS.h / h) / Math.max((x1 - x0) / w, (y1 - y0) / h))); v.cx = (x0 + x1) / 2; v.cy = (y0 + y1) / 2
      }
    }
    apply()
  }
  useEffect(() => { fit() }, [floor, route]) // eslint-disable-line
  useEffect(() => { apply() })
  useEffect(() => { const ro = new ResizeObserver(apply); ro.observe(svg.current); return () => ro.disconnect() }, [])
  // Live marker during navigation (reads the scene's progress each frame without re-rendering React)
  useEffect(() => {
    let raf
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const mk = svg.current?.querySelector('#mkm'), cone = svg.current?.querySelector('#conem'), done = svg.current?.querySelector('#donem')
      if (!mk) return
      if (!scene.ok || !scene.nav || !route || route.same) { mk.setAttribute('r', 0); cone.setAttribute('d', ''); done?.setAttribute('d', ''); return }
      const d = scene.nav.d, pos = posAt(route, d), pts = []
      for (let i = 0; i < route.pts.length; i++) { if (route.cum[i] > d) break; if (route.pts[i].f === floor) pts.push(P2(route.pts[i].r, route.pts[i].a)); else pts.length = 0 }
      if (pos.f === floor) pts.push([pos.x, pos.y])
      done?.setAttribute('d', pts.length > 1 ? polyD(pts) : '')
      if (pos.f === floor) {
        mk.setAttribute('cx', pos.x.toFixed(2)); mk.setAttribute('cy', pos.y.toFixed(2)); mk.setAttribute('r', 1.4)
        const h = Math.atan2(pos.dy, pos.dx), t = (s) => [pos.x + 7 * Math.cos(h + s), pos.y + 7 * Math.sin(h + s)].map((v) => v.toFixed(2)).join(' ')
        if (pos.dx || pos.dy) cone.setAttribute('d', `M${pos.x.toFixed(2)} ${pos.y.toFixed(2)}L${t(-0.45)}L${t(0.45)}Z`)
      } else { mk.setAttribute('r', 0); cone.setAttribute('d', '') }
    }
    tick(); return () => cancelAnimationFrame(raf)
  }, [route, floor, scene])
  const drag = useRef(null), lastDrag = useRef(0)
  const html = planStatic(floor, { uid: 'm', layer, selected }) + planDynamic(floor, { uid: 'm', route, heat, you })
  return (
    <div className="absolute inset-0 bg-surface">
      <svg ref={svg} role="img" aria-label={`${floorName(floor)} plan. Click a room to route there.`} className="h-full w-full touch-none select-none" style={{ cursor: 'grab' }}
        dangerouslySetInnerHTML={{ __html: html }}
        onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, cx: view.current.cx, cy: view.current.cy, moved: false }; svg.current.setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.hypot(dx, dy) > 5) d.moved = true; if (d.moved) { view.current.cx = d.cx - dx / view.current.vb.ppu; view.current.cy = d.cy - dy / view.current.vb.ppu; apply() } }}
        onPointerUp={(e) => { const d = drag.current; drag.current = null; if (d && !d.moved) { const t = document.elementsFromPoint(e.clientX, e.clientY).find((n) => n.classList?.contains('sp')); if (t) onPick(place(floor, t.dataset.id)) } }}
        onWheel={(e) => { const v = view.current, r = svg.current.getBoundingClientRect(); const wx = v.vb.x + (e.clientX - r.left) / v.vb.ppu, wy = v.vb.y + (e.clientY - r.top) / v.vb.ppu; const z = Math.max(1, Math.min(7, v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); const k = v.zoom / z; v.cx = wx + (v.cx - wx) * k; v.cy = wy + (v.cy - wy) * k; v.zoom = z; apply() }} />
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 rounded-xl bg-surface/95 p-1 shadow-lg">
        {[['plus', 'Zoom in', () => { view.current.zoom = Math.min(7, view.current.zoom * 1.4); apply() }], ['x', 'Zoom out', () => { view.current.zoom = Math.max(1, view.current.zoom / 1.4); apply() }], ['map', 'Fit', fit]].map(([icn, l, fn]) => (
          <button key={l} onClick={fn} aria-label={l} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-ground">{l === 'Zoom out' ? <span className="text-xl font-bold leading-none">−</span> : <Icon name={icn} />}</button>
        ))}
      </div>
      <div className="absolute bottom-3 left-3 hidden max-w-[70%] flex-wrap gap-x-3 gap-y-1 rounded-xl bg-surface/95 px-3 py-2 text-xs text-muted shadow md:flex">
        {[['Classroom', TYPE_FILL.room], ['Lab', TYPE_FILL.lab], ['Washroom', TYPE_FILL.wc], ['Office / HOD', TYPE_FILL.office], ['Library', TYPE_FILL.library], ['Lift', TYPE_FILL.lift], ['Stairs', '#8C7479'], ['Terrace', TYPE_FILL.amphi]].map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
      </div>
    </div>
  )
}

/* ---------- Minimap radar in 3D mode ---------- */
function MiniMap({ scene, floor, route, you }) {
  const ref = useRef(null)
  useEffect(() => {
    let raf, last = 0
    const tick = (t) => {
      raf = requestAnimationFrame(tick)
      if (t - last < 66) return; last = t
      const s = ref.current; if (!s) return
      const p = scene.pose(), dot = s.querySelector('#camDot'), cone = s.querySelector('#camCone')
      const x = Math.max(-90, Math.min(90, p.x)), y = Math.max(-92, Math.min(-4, p.z)), h = Math.atan2(p.hz, p.hx)
      dot.setAttribute('cx', x.toFixed(1)); dot.setAttribute('cy', y.toFixed(1))
      const tp = (k) => [x + 16 * Math.cos(h + k), y + 16 * Math.sin(h + k)].map((v) => v.toFixed(1)).join(' ')
      cone.setAttribute('d', `M${x.toFixed(1)} ${y.toFixed(1)}L${tp(-0.5)}L${tp(0.5)}Z`)
      const mk = s.querySelector('#mkn')
      if (mk && scene.nav && route && !route.same) { const q = posAt(route, scene.nav.d); if (q.f === floor) { mk.setAttribute('cx', q.x.toFixed(1)); mk.setAttribute('cy', q.y.toFixed(1)); mk.setAttribute('r', 2.4) } else mk.setAttribute('r', 0) } else if (mk) mk.setAttribute('r', 0)
    }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [scene, floor, route])
  return (
    <div className="absolute bottom-3 left-3 z-10 hidden w-[230px] rounded-xl border border-line bg-surface/95 p-1.5 shadow-lift lg:block" aria-hidden="true">
      <div className="flex justify-between px-1 pb-1 text-[11px] font-semibold text-muted"><span>{floorName(floor)}</span><span>Camera</span></div>
      <svg ref={ref} viewBox="-94 -96 188 96" className="block w-full" dangerouslySetInnerHTML={{ __html: planStatic(floor, { uid: 'n', labels: false, mini: true }) + planDynamic(floor, { uid: 'n', mini: true, route, you }) + '<path id="camCone" fill="#B4532F" opacity="0.35"/><circle id="camDot" r="3" fill="#B4532F" stroke="#fff" stroke-width="0.9"/>' }} />
    </div>
  )
}
