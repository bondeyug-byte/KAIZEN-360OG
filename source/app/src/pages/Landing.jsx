import heroImg from '../assets/campus-hero.jpg'
import bannerImg from '../assets/campus-banner.jpg'
import blurImg from '../assets/campus-blur.jpg'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { startTour } from '../components/Tour.jsx'
import { FLOORS, FLOOR_DEPT, floorName, floorPlaces, TYPE_LABEL } from '../navigator/building.js'

// Public landing page (Oct 2026 design "landing v2"): a grey campus photo that turns to colour under the cursor and as
// you scroll, a marquee, a pinned horizontal "walk", the real main block floor by floor, the four portals and one
// sign-in. Only public data: photos and the building model that ship with the app. Styles are scoped to `.lv2`.
const FONTS = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;600;800&display=swap'
const MARQUEE = ['3D campus', 'Attendance', 'Classwork', 'Trains & buses', 'Canteens', 'Rides', 'Clubs', 'Events']
const WALK = [
  { img: bannerImg, title: 'Find any room', text: 'Open the 3D explorer and see the way to labs and halls.', href: '#/navigator' },
  { img: heroImg, title: 'Never miss a class', text: 'Timetables, attendance and assignments side by side.', href: '#/login?role=student' },
  { img: blurImg, title: 'Get home easier', text: 'Trains, buses and shared rides from the gate.', href: '#/commute' },
]
const ROLES = [['student', 'Student', 'Classes, results, events and the campus map.'], ['teacher', 'Teacher', 'Attendance, assessments and posts for your divisions.'], ['hod', 'HOD', 'Manage teachers, divisions and timetables.'], ['parent', 'Parent', "Follow your child's attendance and progress."]]
const HEADLINE = 'Your campus, connected.'

/** What is on each floor of the main block, from the navigator's building model (room counts by type). */
function floorInfo(f) {
  const places = floorPlaces(f)
  const count = (t) => places.filter((p) => p.type === t).length
  const parts = [[count('room'), 'classrooms'], [count('lab'), 'labs'], [count('office'), 'offices']].filter(([n]) => n).map(([n, l]) => `${n} ${l}`)
  const special = [...new Set(places.filter((p) => ['canteen', 'amphi', 'library'].includes(p.type)).map((p) => TYPE_LABEL[p.type].toLowerCase()))]
  return { name: floorName(f), dept: FLOOR_DEPT[f] || (f === 0 ? 'Entrance level' : ''), text: [parts.join(', '), special.length ? `the ${special.join(' and ')}` : ''].filter(Boolean).join(', plus ') + '.' }
}

export default function Landing() {
  const { signedIn, demoLogin, demoEnabled } = useApp()
  const root = useRef(null), hero = useRef(null), walk = useRef(null), track = useRef(null), col = useRef(null), cur = useRef(null), bar = useRef(null), hint = useRef(null), mag = useRef(null)
  const [floor, setFloor] = useState(null)
  const floors = useMemo(() => Array.from({ length: FLOORS }, (_, f) => ({ f, ...floorInfo(f) })), [])
  const info = floor === null ? null : floors[floor]
  const signIn = signedIn ? '#/' : '#/login'

  // fonts for this page only (the CSP already allows Google Fonts)
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONTS; document.head.appendChild(l)
  }, [])

  // cursor spotlight, scroll progress, hero reveal, horizontal walk, reveal-on-scroll, magnetic button
  useEffect(() => {
    const RM = matchMedia('(prefers-reduced-motion: reduce)').matches
    const fine = matchMedia('(pointer: fine)').matches
    const onMove = (e) => {
      if (cur.current) { cur.current.style.left = e.clientX + 'px'; cur.current.style.top = e.clientY + 'px' }
      col.current?.style.setProperty('--x', e.clientX + 'px'); col.current?.style.setProperty('--y', e.clientY + 'px')
      if (hint.current) hint.current.style.opacity = 0
      const m = mag.current
      if (m && !RM) { const b = m.getBoundingClientRect(), dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2); m.style.transform = Math.hypot(dx, dy) < 160 ? `translate(${dx * 0.25}px,${dy * 0.25}px)` : '' }
    }
    const tick = () => {
      const h = document.documentElement, y = window.scrollY
      if (bar.current) bar.current.style.width = (y / Math.max(1, h.scrollHeight - innerHeight)) * 100 + '%'
      if (y > 40 && hint.current) hint.current.style.opacity = 0
      if (hero.current && col.current) { const hp = Math.min(1, y / Math.max(1, hero.current.offsetHeight - innerHeight)); col.current.style.setProperty('--r', 150 + hp * Math.hypot(innerWidth, innerHeight) + 'px') }
      if (walk.current && track.current) {
        const r = walk.current.getBoundingClientRect(), wp = Math.min(1, Math.max(0, -r.top / Math.max(1, walk.current.offsetHeight - innerHeight)))
        track.current.style.transform = `translateX(${-wp * Math.max(0, track.current.scrollWidth - innerWidth)}px)`
      }
    }
    const big = (on) => () => cur.current?.classList.toggle('big', on)
    const hovers = [...(root.current?.querySelectorAll('a, button, .bld, .card') || [])]
    if (fine) hovers.forEach((el) => { el.addEventListener('pointerenter', big(true)); el.addEventListener('pointerleave', big(false)) })
    addEventListener('pointermove', onMove); addEventListener('scroll', tick, { passive: true }); addEventListener('resize', tick); tick()
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { threshold: 0.2 })
    root.current?.querySelectorAll('.rv').forEach((el) => io.observe(el))
    return () => { removeEventListener('pointermove', onMove); removeEventListener('scroll', tick); removeEventListener('resize', tick); io.disconnect() }
  }, [])

  let d = 0
  return (
    <div ref={root} className="lv2">
      <style>{CSS}</style>
      <div ref={cur} id="lv2-cur" aria-hidden="true" /><div ref={bar} className="bar" aria-hidden="true" />
      <nav aria-label="Account">
        <a className="logo" href="#/welcome">Campus360</a>
        <span className="navr">
          {demoEnabled && !signedIn && <button type="button" className="lnk" onClick={() => { demoLogin('u_aarav'); startTour(); window.location.hash = '/' }}>Guided demo</button>}
          <a className="lnk" href={signIn}>{signedIn ? 'Open dashboard' : 'Sign in'}</a>
        </span>
      </nav>

      <header className="hero" ref={hero}>
        <div className="sticky">
          <div className="ph mono" style={{ backgroundImage: `url(${heroImg})` }} />
          <div className="ph col" ref={col} style={{ backgroundImage: `url(${heroImg})` }} />
          <div className="hint" ref={hint} aria-hidden="true"><span className="fine">Move your cursor. </span>Scroll to open the campus.</div>
          <h1 aria-label={HEADLINE}>{HEADLINE.split(' ').map((w) => (
            <span key={w} aria-hidden="true" className="w">{[...w].map((c, i) => <span key={i} className="ch" style={{ animationDelay: `${0.3 + d++ * 0.05}s` }}>{c}</span>)}</span>))}</h1>
          <p className="s">Classes, attendance, trains, canteens and a 3D map of VESIT, in one place.</p>
        </div>
      </header>

      <div className="mq" aria-hidden="true"><div>{[...MARQUEE, ...MARQUEE].map((x, i) => <span key={i}><span>{x}</span><i>✦</i></span>)}</div></div>

      <section className="walk" ref={walk} aria-label="What you can do">
        <div className="sticky"><div className="track" ref={track}>
          <div className="intro"><h2>Take the <em>walk</em></h2><p>Keep scrolling. Each stop is a place you&apos;ll use every week.</p></div>
          {WALK.map((c) => (
            <a key={c.title} className="card" href={c.href}><div className="im" style={{ backgroundImage: `url(${c.img})` }} /><div className="t"><b>{c.title}</b><small>{c.text}</small></div></a>))}
        </div></div>
      </section>

      <section className="map" aria-label="The main block, floor by floor">
        <svg viewBox="0 0 600 420" role="img" aria-label="The VESIT main block, ground floor to floor 5">
          <path className="road" d="M30 405 C 140 370, 220 400, 300 395 S 470 380, 570 405" />
          {floors.slice().reverse().map(({ f, name }, i) => {
            const y = 40 + i * 58
            return (
              <g key={f}>
                <rect className={`bld${floor === f ? ' on' : ''}`} tabIndex={0} role="button" aria-label={`${name}: ${floors[f].dept}`} x={70} y={y} width={460} height={48} rx={4}
                  onPointerEnter={() => setFloor(f)} onFocus={() => setFloor(f)} onClick={() => setFloor(f)} />
                <text x={88} y={y + 30} className="lbl">{f === 0 ? 'G' : f}</text>
                <text x={120} y={y + 30} className="lbl2">{floors[f].dept}</text>
              </g>)
          })}
          <circle r="6" fill="#d6f26b"><animateMotion dur="9s" repeatCount="indefinite" path="M30 405 C 140 370, 220 400, 300 395 S 470 380, 570 405" /></circle>
        </svg>
        <div className="info rv">
          <small>The real main block. Hover or tap a floor.</small>
          <h3>{info ? info.name : 'Pick a floor'}</h3>
          <p>{info ? <>{info.dept ? <b>{info.dept}. </b> : null}{info.text}</> : 'Six floors, every room mapped from the floor directory boards. See what lives where.'}</p>
          <a className="btn sm" href={info ? `#/navigator?f=${info.f}` : '#/navigator'}>Open the 3D campus</a>
        </div>
      </section>

      <section className="roles" aria-label="Portals">
        <h2 className="rv" style={{ marginBottom: 48 }}>One sign-in. <em>Four views.</em></h2>
        {ROLES.map(([r, t, s]) => <a key={r} className="role rv" href={`#/login?role=${r}`}><strong>{t}</strong><span>{s}</span></a>)}
      </section>

      <section className="end">
        <h2 className="rv">Your campus is <em>waiting.</em></h2>
        <a className="btn" ref={mag} href={signedIn ? '#/' : '#/login?role=student'}>{signedIn ? 'Open your dashboard' : 'Continue with your college Google account'}</a>
      </section>
      <footer>
        <span>© Campus360 2026 · a student project for VES Institute of Technology, Chembur</span>
        <span className="links"><span>Use your @ves.ac.in account</span><a href="#/privacy">Privacy</a><a href="#/terms">Terms</a><a href="#/about">About the data</a></span>
      </footer>
    </div>
  )
}

const CSS = `
.lv2{--ink:#0a1a14;--moss:#14382b;--lime:#d6f26b;--paper:#eef3ea;--mute:#a9bdb1;--serif:'Instrument Serif',Georgia,serif;--sans:'Manrope',system-ui,sans-serif;background:var(--ink);color:var(--paper);font:400 17px/1.6 var(--sans);overflow-x:clip;min-height:100vh}
.lv2 *{box-sizing:border-box}
.lv2 :focus-visible{outline:2px solid var(--lime);outline-offset:3px}
.lv2 a{color:inherit}
@media (pointer:fine){.lv2,.lv2 a,.lv2 button,.lv2 .bld{cursor:none}}
#lv2-cur{position:fixed;z-index:99;width:14px;height:14px;border-radius:50%;background:var(--lime);pointer-events:none;transform:translate(-50%,-50%);mix-blend-mode:difference;transition:width .25s,height .25s;left:-40px;top:-40px}
#lv2-cur.big{width:64px;height:64px}
@media (pointer:coarse){#lv2-cur{display:none}}
.lv2 nav{position:fixed;top:0;left:0;right:0;z-index:20;display:flex;justify-content:space-between;align-items:center;padding:20px clamp(20px,4vw,56px);mix-blend-mode:difference}
.lv2 .logo{font:400 26px var(--serif);text-decoration:none}
.lv2 .navr{display:flex;gap:22px;align-items:center}
.lv2 .lnk{font:800 16px var(--sans);text-decoration:none;background:none;border:0;color:inherit;padding:8px 0}
.lv2 .bar{position:fixed;top:0;left:0;height:3px;background:var(--lime);width:0;z-index:30}
.lv2 .btn{display:inline-block;background:var(--lime);color:var(--ink);padding:14px 28px;border-radius:99px;font-weight:800;text-decoration:none;will-change:transform}
.lv2 .btn.sm{padding:11px 22px;font-size:15px;margin-top:18px}
.lv2 h1,.lv2 h2{font:400 clamp(52px,11vw,180px)/.9 var(--serif);letter-spacing:-.03em;margin:0}
.lv2 h2{font-size:clamp(40px,7vw,110px)}
.lv2 em{font-style:italic;color:var(--lime)}
.lv2 .hero{height:260vh;position:relative}
.lv2 .sticky{position:sticky;top:0;height:100vh;overflow:hidden}
.lv2 .ph{position:absolute;inset:-4%;background:var(--moss) center/cover;animation:lv2kb 24s ease-in-out infinite alternate}
.lv2 .ph.mono{filter:grayscale(1) brightness(.45) contrast(1.2)}
.lv2 .ph.col{-webkit-mask-image:radial-gradient(circle var(--r,150px) at var(--x,50%) var(--y,50%),#000 60%,transparent 100%);mask-image:radial-gradient(circle var(--r,150px) at var(--x,50%) var(--y,50%),#000 60%,transparent 100%)}
@keyframes lv2kb{from{transform:scale(1.03)}to{transform:scale(1.15) translate(-1.5%,-1%)}}
.lv2 .hero h1{position:absolute;left:clamp(20px,5vw,80px);bottom:12vh;z-index:3;mix-blend-mode:difference;color:#fff;pointer-events:none}
.lv2 .hero h1 .w{display:inline-block;overflow:hidden;margin-right:.22em}
.lv2 .hero h1 .ch{display:inline-block;opacity:0;transform:translateY(70%) rotate(5deg);animation:lv2up 1.1s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes lv2up{to{opacity:1;transform:none}}
.lv2 .hero p.s{position:absolute;right:clamp(20px,5vw,80px);bottom:12vh;z-index:3;max-width:28ch;color:var(--paper);font-size:15px;margin:0}
.lv2 .hint .fine{display:none}@media (pointer:fine){.lv2 .hint .fine{display:inline}}
.lv2 .hint{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3;font-size:14px;color:var(--paper);opacity:.8;pointer-events:none;transition:opacity .4s;text-align:center}
.lv2 .mq{overflow:hidden;white-space:nowrap;border-block:1px solid rgba(238,243,234,.16);padding:22px 0;background:var(--ink);position:relative;z-index:2}
.lv2 .mq>div{display:inline-block;animation:lv2mq 30s linear infinite;font:400 clamp(30px,4vw,58px) var(--serif)}
.lv2 .mq span span{margin:0 28px}.lv2 .mq i{color:var(--lime);font-style:normal}
@keyframes lv2mq{to{transform:translateX(-50%)}}
.lv2 .walk{height:400vh;position:relative;background:var(--ink)}
.lv2 .walk .sticky{display:flex;align-items:center}
.lv2 .track{display:flex;gap:4vw;padding:0 8vw;will-change:transform}
.lv2 .card{flex:0 0 min(70vw,900px);height:68vh;border-radius:6px;position:relative;overflow:hidden;background:var(--moss);display:block;text-decoration:none}
.lv2 .card .im{position:absolute;inset:-6%;background:var(--moss) center/cover;transition:transform .8s}
.lv2 .card:hover .im{transform:scale(1.06)}
.lv2 .card::after{content:"";position:absolute;inset:0;background:linear-gradient(transparent 40%,rgba(10,26,20,.9))}
.lv2 .card div.t{position:absolute;left:28px;bottom:26px;right:28px;z-index:2}
.lv2 .card b{font:400 clamp(30px,4vw,60px)/1 var(--serif);display:block}
.lv2 .card small{color:var(--mute);font-size:15px}
.lv2 .intro{flex:0 0 min(36vw,440px)}
.lv2 .intro p{color:var(--mute);margin-top:20px}
.lv2 .map{padding:14vh clamp(20px,6vw,96px);display:grid;grid-template-columns:1.4fr 1fr;gap:4vw;align-items:center;min-height:100vh;background:linear-gradient(var(--ink),#0e2a20)}
.lv2 .map svg{width:100%;background:rgba(238,243,234,.04);border:1px solid rgba(238,243,234,.14);border-radius:6px}
.lv2 .bld{fill:rgba(238,243,234,.1);stroke:rgba(238,243,234,.35);transition:.3s;outline:none}
.lv2 .bld:hover,.lv2 .bld.on,.lv2 .bld:focus-visible{fill:var(--lime);stroke:var(--lime)}
.lv2 .lbl{font:400 26px var(--serif);fill:var(--paper);pointer-events:none}
.lv2 .lbl2{font:600 14px var(--sans);fill:var(--mute);pointer-events:none}
.lv2 g:has(.bld.on) .lbl,.lv2 g:has(.bld.on) .lbl2,.lv2 g:has(.bld:hover) .lbl,.lv2 g:has(.bld:hover) .lbl2{fill:var(--ink)}
.lv2 .road{stroke:var(--lime);stroke-width:2;fill:none;stroke-dasharray:7 9;animation:lv2dash 12s linear infinite}
@keyframes lv2dash{to{stroke-dashoffset:-320}}
.lv2 .info h3{font:400 clamp(34px,4vw,60px)/1 var(--serif);margin:10px 0 14px}
.lv2 .info p{color:var(--mute);min-height:5em;margin:0}
.lv2 .info p b{color:var(--paper);font-weight:600}
.lv2 .info small{color:var(--lime)}
.lv2 .roles{padding:14vh clamp(20px,6vw,96px);background:#0e2a20}
.lv2 .role{display:flex;justify-content:space-between;align-items:baseline;gap:20px;padding:26px 0;border-top:1px solid rgba(238,243,234,.2);transition:.4s;text-decoration:none}
.lv2 .role:last-of-type{border-bottom:1px solid rgba(238,243,234,.2)}
.lv2 .role:hover,.lv2 .role:focus-visible{padding-left:24px;background:linear-gradient(90deg,rgba(214,242,107,.14),transparent)}
.lv2 .role strong{font:400 clamp(36px,6vw,92px)/1 var(--serif)}
.lv2 .role span{color:var(--mute);max-width:32ch;text-align:right;font-size:15px}
.lv2 .end{min-height:90vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;gap:36px;padding:10vh 6vw;background:var(--lime);color:var(--ink)}
.lv2 .end h2 em{color:var(--moss)}
.lv2 .end .btn{background:var(--ink);color:var(--lime)}
.lv2 footer{padding:26px clamp(20px,6vw,96px);display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:14px;background:var(--ink);color:var(--mute)}
.lv2 footer .links{display:flex;gap:16px;flex-wrap:wrap}
.lv2 footer a{color:var(--paper)}
.lv2 .rv{opacity:0;transform:translateY(40px);transition:1s cubic-bezier(.2,.8,.2,1)}.lv2 .rv.in{opacity:1;transform:none}
@media (max-width:800px){.lv2 .map{grid-template-columns:1fr}.lv2 .role{flex-direction:column;gap:6px}.lv2 .role span{text-align:left}.lv2 .card{flex-basis:84vw}.lv2 .hero p.s{left:clamp(20px,5vw,80px);right:auto;bottom:5vh}.lv2 .hero h1{bottom:18vh}.lv2 .lbl2{display:none}.lv2 .lbl{font-size:30px}}
@media (prefers-reduced-motion:reduce){.lv2 *{animation:none!important;transition:none!important}.lv2 .rv,.lv2 .hero h1 .ch{opacity:1;transform:none}}
`
