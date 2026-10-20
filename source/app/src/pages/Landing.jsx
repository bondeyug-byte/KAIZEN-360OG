import heroImg from '../assets/campus-hero.jpg'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Brand } from '../components/Layout.jsx'
import { startTour } from '../components/Tour.jsx'
import { Badge, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { getScene } from '../navigator/scene.js'
import { allPlaces } from '../navigator/building.js'
import { STATIONS } from '../lib/journey.js'
import { nextTrains, TRAIN_SOURCE } from '../lib/transit.js'
import { eventStatus, EVENT_STATUS, formatEventTime } from '../lib/events.js'
import { CAMPUS_TIMEZONE, STARTING_SOON_MINUTES } from '../data/config.js'
import { CANTEENS } from '../data/menus.js'

const EV = { timeZone: CAMPUS_TIMEZONE, soonWindowMinutes: STARTING_SOON_MINUTES }
const FEATURES = [
  { icon: 'cube', title: '3D campus navigator', text: 'Every floor of the main block. Labs on the left, classrooms on the right, turn-by-turn routes with lifts and stairs.', href: '#/navigator' },
  { icon: 'calendar', title: 'Weekly timetable', text: 'Monday to Sunday, each lecture and lab with its room and a route to it.', href: '#/' },
  { icon: 'book', title: 'Academic planner', text: 'Marks you still need for each grade, SGPA targets and what-if scores.', href: '#/planner' },
  { icon: 'car', title: 'Rides with a live map', text: 'Offer or request seats from Chembur, Kurla or anywhere, with pickup pins and directions.', href: '#/rides' },
  { icon: 'train', title: 'Trains & buses', text: 'Timetable trains through Kurla and Chembur, a journey planner from any station, BEST buses.', href: '#/commute' },
  { icon: 'trophy', title: 'Class challenges', text: 'Briefs as PDFs or images, solution uploads, reviewer feedback and a class leaderboard.', href: '#/challenges' },
  { icon: 'swap', title: 'Peer learning', text: 'Teach a skill, earn an hour of credit, spend it learning from a senior.', href: '#/peer' },
  { icon: 'bell', title: 'Events & notifications', text: 'Request a place, get notified when the organiser approves, and never miss a deadline.', href: '#/events' },
]

/** Public landing page. Shows only public data: the campus model, timetabled trains and published events. */
export default function Landing() {
  const { db, now, signedIn, demoLogin } = useApp()
  const upcoming = useMemo(() => db.shared.events.filter((e) => eventStatus(e, now, EV) !== EVENT_STATUS.ENDED).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), [db.shared.events, now])
  const events = upcoming.slice(0, 3)
  const trains = useMemo(() => ['Chembur', 'Kurla'].map((s) => ({ s, list: nextTrains({ from: s, now, limit: 3 }).trains || [] })), [now])
  const stats = [[STATIONS.length, 'railway stations in the planner'], [TRAIN_SOURCE.count.toLocaleString('en-IN'), 'timetabled trains via Kurla & Chembur'], [allPlaces().length, 'mapped rooms across 6 floors'], [upcoming.length, 'upcoming or live events']]
  return (
    <div className="min-h-screen bg-ground">
      <section className="relative flex min-h-[100svh] flex-col overflow-hidden bg-brand-deep text-white" style={{ backgroundImage: `linear-gradient(90deg, rgba(8,24,18,.66) 0%, rgba(8,24,18,.34) 50%, rgba(8,24,18,.08) 100%), linear-gradient(rgba(8,24,18,.12), rgba(8,24,18,.12)), linear-gradient(0deg, rgba(8,24,18,.45) 0%, rgba(8,24,18,0) 30%), url(${heroImg})`, backgroundSize: 'cover', backgroundPosition: '60% center' }}>
        <header className="glass-dark relative z-10 mx-3 mt-3 flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 sm:mx-6 sm:mt-5 sm:px-5">
          <Brand light />
          <nav aria-label="Account" className="flex items-center gap-2">
            <a href={signedIn ? '#/' : '#/login'} className="press glass-btn inline-flex min-h-[42px] items-center gap-2 rounded-xl px-3.5 text-[14px] font-semibold"><Icon name="logout" size={17} className="rotate-180" /><span className="hidden sm:inline">{signedIn ? 'Open dashboard' : 'Sign in'}</span><span className="sm:hidden">{signedIn ? 'Dashboard' : 'Login'}</span></a>
            <a href={signedIn ? '#/profile' : '#/login'} className="press glass-btn hidden min-h-[42px] items-center gap-2 rounded-xl px-3.5 text-[14px] font-semibold sm:inline-flex"><Icon name="user" size={17} />Profile</a>
          </nav>
        </header>
        <div className="relative z-10 mx-auto flex w-full max-w-[1240px] flex-1 flex-col justify-center px-5 py-16 sm:px-10">
          <h1 className="page-in max-w-[760px] font-display text-[44px] font-bold leading-[1.02] tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,.35)] sm:text-[68px] lg:text-[78px]">Your First Year.<br />Your Fresh Start.</h1>
          <p className="mt-4 max-w-[560px] text-[16px] text-white/90 drop-shadow sm:text-[19px]">Find your way around campus. Make every moment count.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#/navigator" className="press glass-btn inline-flex min-h-[52px] items-center gap-2.5 rounded-2xl px-6 text-[16px] font-semibold">Explore Campus <Icon name="chev" size={18} /></a>
            {!signedIn && <a href="#/login?role=student" className="press inline-flex min-h-[52px] items-center gap-2 rounded-2xl bg-lime px-6 text-[16px] font-bold text-lime-ink hover:brightness-95">Student Login</a>}
            <button type="button" onClick={() => { demoLogin('u_aarav'); startTour(); window.location.hash = '/' }} className="press glass-btn inline-flex min-h-[52px] items-center gap-2.5 rounded-2xl px-6 text-[16px] font-semibold"><Icon name="spark" size={18} />Guided demo</button>
          </div>
          {!signedIn && <div className="mt-8 grid max-w-[980px] gap-3 sm:grid-cols-2 lg:grid-cols-4" role="list" aria-label="Choose your portal">
            {[['student', 'Student', 'Your class, timetable, attendance, marks, notes, rides and peer tutors.', 'user'], ['teacher', 'Teacher', 'Record attendance, enter and publish marks, post to your classes.', 'book'], ['hod', 'HOD', 'Teachers, class reps, alerts, events and the audit log for your branch.', 'shield'], ['parent', 'Parent', "Your child's attendance, published marks, alerts, notices and events.", 'calendar']].map(([r, t, d, ic]) => (
              <a key={r} role="listitem" href={`#/login?role=${r}`} className="press glass-btn group flex flex-col gap-1 rounded-2xl p-4 text-left">
                <span className="flex items-center gap-2 text-[16px] font-bold"><Icon name={ic} size={18} />{t} portal<Icon name="chev" size={16} className="ml-auto transition-transform group-hover:translate-x-0.5" /></span>
                <span className="text-[13px] text-white/80">{d}</span>
              </a>))}
          </div>}
          {!signedIn && <p className="mt-3 text-[12.5px] text-white/80"><a href="#/login?role=organiser" className="font-semibold underline underline-offset-2">Council / Club event desk (demo) →</a></p>}
          {!signedIn && <p className="mt-3 text-[12px] text-white/70">Demo sign-in is simulated: roles are enforced inside the app only. A production deployment must check them on a server.</p>}
        </div>
        <p className="relative z-10 pb-6 text-center font-mono text-[12px] tracking-[.32em] text-white/85">ACADEMICS · PEOPLE · CAMPUS LIFE</p>
      </section>

      <section aria-label="Campus360 in numbers" className="border-y border-line bg-surface">
        <dl className="mx-auto grid max-w-[1180px] grid-cols-2 gap-px px-4 sm:px-6 md:grid-cols-4">
          {stats.map(([v, l]) => <div key={l} className="py-5 pr-3"><dt className="sr-only">{l}</dt><dd><b className="block font-display text-[28px] font-semibold tabular-nums leading-none">{v}</b><span className="mt-1 block text-[13px] text-muted">{l}</span></dd></div>)}
        </dl>
      </section>

      <section className="mx-auto grid max-w-[1180px] items-center gap-8 px-4 pt-12 sm:px-6 lg:grid-cols-[.9fr_1.1fr]">
        <div>
          <span className="rounded-full bg-lime-soft px-3 py-1 text-[11px] font-bold uppercase tracking-[.12em] text-lime-ink">Live 3D model</span>
          <h2 className="mt-3 font-display text-[30px] font-bold leading-tight tracking-tight">Every room, lift and staircase of the main block.</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">Labs on the left, classrooms on the right, the amphitheatre in the curve. Search a room and follow turn-by-turn directions across floors.</p>
          <a href="#/navigator" className="press mt-5 inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-brand px-5 text-[15px] font-semibold text-white hover:bg-brand-dark"><Icon name="cube" size={18} />Open the 3D campus</a>
        </div>
        <CampusPreview />
      </section>

      <section id="features" className="mx-auto max-w-[1180px] scroll-mt-20 px-4 py-12 sm:px-6">
        <h2 className="font-display text-[28px] font-semibold tracking-tight">Everything a first-year asks about</h2>
        <p className="mt-1 text-[15px] text-muted">Each card opens the real feature. Some need a student sign-in.</p>
        <div className="stagger mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <a key={f.title} href={f.href} className="lift group flex flex-col rounded-xl border border-line bg-surface p-4 shadow-card">
              <span className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-maroon-50 text-maroon ring-1 ring-maroon/10 transition-colors group-hover:bg-maroon group-hover:text-white"><Icon name={f.icon} size={19} /></span>
              <b className="text-[15.5px] font-semibold">{f.title}</b>
              <span className="mt-1 text-[13.5px] leading-relaxed text-muted">{f.text}</span>
              <span className="mt-auto pt-3 text-[13px] font-semibold text-maroon">Open <Icon name="chev" size={13} className="inline" /></span>
            </a>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-[1180px] gap-5 px-4 pb-14 sm:px-6 lg:grid-cols-2">
        <div id="trains" className="scroll-mt-20 rounded-xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-end justify-between gap-2"><h2 className="font-display text-[20px] font-semibold">Next trains to campus stations</h2><a href="#/commute" className="text-[13px] font-semibold text-maroon hover:underline">Plan a journey</a></div>
          <p className="mt-0.5 text-[12.5px] text-muted">From the Central Railway timetable ({TRAIN_SOURCE.effective}). Scheduled times, not live running.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {trains.map(({ s, list }) => (
              <div key={s}><b className="text-[13px] font-semibold uppercase tracking-wider text-muted">From {s}</b>
                <ul className="mt-1.5 flex flex-col gap-1.5">{list.length ? list.map((t, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-2 text-[13.5px]"><b className="w-[70px] flex-none font-mono">{t.depText}</b><span className="min-w-0 flex-1 truncate">{t.typeLabel} to {t.dest}</span><Badge tone={t.wait <= 5 ? 'bad' : 'info'}>{t.wait < 60 ? `${t.wait} min` : `${Math.floor(t.wait / 60)} h`}</Badge></li>
                )) : <li className="text-[13px] text-muted">No more trains tonight.</li>}</ul>
              </div>
            ))}
          </div>
        </div>
        <div id="events" className="scroll-mt-20 rounded-xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-end justify-between gap-2"><h2 className="font-display text-[20px] font-semibold">Upcoming on campus</h2><a href="#/events" className="text-[13px] font-semibold text-maroon hover:underline">All events</a></div>
          <ul className="mt-3 flex flex-col gap-2">{events.length ? events.map((e) => (
            <li key={e.id}><a href={`#/events?id=${e.id}`} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-ground">
              <span className="flex h-12 w-11 flex-none flex-col items-center justify-center rounded-lg bg-maroon-50 leading-none text-maroon"><b className="text-[10px] uppercase">{new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, month: 'short' }).format(new Date(e.start))}</b><b className="mt-0.5 font-display text-[18px]">{new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, day: 'numeric' }).format(new Date(e.start))}</b></span>
              <span className="min-w-0 flex-1"><b className="block truncate text-[14px] font-semibold">{e.title}</b><small className="text-[12.5px] text-muted">{formatEventTime(e.start, CAMPUS_TIMEZONE)} · {e.place.label}</small></span>
              {e.demo && <Badge tone="demo">Sample</Badge>}
            </a></li>
          )) : <li className="text-[13.5px] text-muted">No upcoming events have been published.</li>}</ul>
        </div>
      </section>

      <section id="canteens" className="mx-auto max-w-[1180px] scroll-mt-20 px-4 pb-14 sm:px-6">
        <h2 className="font-display text-[26px] font-semibold tracking-tight">Canteens on campus</h2>
        <p className="mt-1 text-[14.5px] text-muted">Menus and prices from each canteen's own boards. Students rate and review dishes.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">{['VESIT', 'VESIM'].map((c) => <CanteenPreview key={c} id={c} />)}</div>
      </section>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[13px] text-muted sm:px-6">
          <span>Campus360 · a student project for VES Institute of Technology, Chembur. Records marked “Sample” are demo data.</span>
          <a href="#/about" className="font-semibold text-maroon">Where the data comes from</a>
        </div>
      </footer>
    </div>
  )
}

/** The real 3D model, interactive. Clicking a room opens it in the navigator. */
function CampusPreview() {
  const host = useRef(null)
  const scene = useMemo(() => getScene(), [])
  const [hint, setHint] = useState(null)
  useEffect(() => {
    if (!scene.ok) return
    scene.mount(host.current)
    scene.viewCampus()
    return () => scene.unmount()
  }, [scene])
  // A click (not a drag) opens the full navigator; dragging orbits the model here.
  const down = useRef(null)
  const onDown = (e) => { down.current = { x: e.clientX, y: e.clientY } }
  const onUp = (e) => { const d = down.current; down.current = null; if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) { setHint(true); setTimeout(() => { window.location.hash = '/navigator' }, 400) } }
  return (
    <div className="relative">
      <div ref={host} onPointerDown={onDown} onPointerUp={onUp} role="img" aria-label="Interactive 3D model of the VESIT main building" className={cx('h-[340px] overflow-hidden rounded-2xl border border-line bg-[#C7DCEC] shadow-pop sm:h-[440px]', !scene.ok && 'grid place-items-center')}>
        {!scene.ok && <p className="p-6 text-center text-sm text-muted">3D needs WebGL, which this browser has turned off. <a href="#/navigator" className="font-semibold text-maroon">Open the floor plan instead</a>.</p>}
      </div>
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-surface/90 px-2.5 py-1 text-[12px] font-semibold shadow-card">Live 3D model</span>
        <span className="rounded-full bg-surface/90 px-2.5 py-1 text-[12px] font-medium text-muted shadow-card">Drag to orbit · click to open the navigator</span>
      </div>
      {hint && <div role="status" className="fade-in absolute bottom-3 left-3 rounded-lg bg-maroon px-3 py-2 text-[13px] font-semibold text-white shadow-pop">Opening the 3D navigator…</div>}
      <div className="pointer-events-none absolute bottom-3 right-3 flex gap-1.5 text-[11.5px] font-semibold">
        <span className="rounded-md bg-[#FBF0DC] px-2 py-0.5 text-[#8A5A0E] shadow-card">Labs · west</span><span className="rounded-md bg-[#E7F0FB] px-2 py-0.5 text-[#1F4F8A] shadow-card">Classrooms · east</span>
      </div>
    </div>
  )
}

function CanteenPreview({ id }) {
  const { db } = useApp()
  const info = CANTEENS[id]
  const dishes = (db.shared.dishes || []).filter((d) => d.canteen === id)
  const cats = [...new Set(dishes.map((d) => d.category))]
  const min = Math.min(...dishes.map((d) => d.price))
  const picks = [...dishes].sort((a, b) => a.price - b.price).slice(0, 4)
  return (
    <a href={`#/canteen?c=${id}`} className="lift flex flex-col rounded-2xl border border-white/70 bg-white/85 p-5 shadow-card">
      <span className="flex items-center justify-between"><b className="font-display text-[19px] font-semibold">{info.name}</b>{info.partial && <Badge tone="warn">Partial menu</Badge>}</span>
      <small className="text-[12.5px] text-muted">{dishes.length} dishes · {cats.length} categories · from ₹{min}</small>
      <ul className="mt-3 flex flex-col gap-1 text-[13.5px]">{picks.map((d) => <li key={d.id} className="flex justify-between gap-2"><span className="truncate">{d.name}</span><b className="text-brand">₹{d.price}</b></li>)}</ul>
      <span className="mt-3 text-[13px] font-semibold text-brand">See the full menu & reviews <Icon name="chev" size={13} className="inline" /></span>
    </a>
  )
}
