import { useEffect, useState, useSyncExternalStore } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Button, Badge, cx } from './ui.jsx'
import Icon from './Icon.jsx'
import { requestSeat, confirmRequest } from '../lib/rides.js'
import { completeChallenge, hasCompleted, leaderboard } from '../lib/challenges.js'
import { bookSession, completeSession, creditsOf } from '../lib/peer.js'
import { timetableForClass } from '../data/seed.js'
import { campusNow, navHref } from '../pages/Dashboard.jsx'
import { place, floorName } from '../navigator/building.js'
import { at } from '../data/seed.js'

/* ---- tiny store: which tour step is active (survives a reload in the same tab) ---- */
const KEY = 'campus360.tour'
let step = (() => { try { const v = Number(sessionStorage.getItem(KEY)); return Number.isInteger(v) && v > 0 ? v : 0 } catch { return 0 } })()
const subs = new Set()
const setStep = (n) => { step = n; try { n ? sessionStorage.setItem(KEY, String(n)) : sessionStorage.removeItem(KEY) } catch { /* ignore */ } subs.forEach((f) => f()) }
export const startTour = () => setStep(1)
const useStep = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => step)

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** First lecture of the next day that has classes (tomorrow, or the next working day). */
function nextDayFirstLecture(classId, now) {
  const { wd } = campusNow(now)
  for (let k = 1; k <= 7; k++) {
    const d = (wd + k) % 7
    const t = timetableForClass(classId).filter((x) => x.day === d).sort((a, b) => a.start.localeCompare(b.start))[0]
    if (t) { const p = place(t.place.f, t.place.id); return { ...t, when: k === 1 ? 'Tomorrow' : DAYS[d], room: p ? `${p.short || p.name}, ${floorName(t.place.f)}` : floorName(t.place.f) } }
  }
  return null
}

/** Guided demo for judges: signs in as Aarav and shows how the modules connect, one step per module. */
export default function Tour({ route }) {
  const n = useStep()
  const { db, me, now, runShared, session } = useApp()
  const [ring, setRing] = useState(null)
  const sh = db.shared
  const active = n > 0 && session.mode === 'demo' && me?.id === 'u_aarav'
  useEffect(() => { if (n > 0 && session.status === 'signedOut') setStep(0) }, [n, session.status])

  const lec = me?.classId ? nextDayFirstLecture(me.classId, now) : null
  const myReq = sh.rideRequests.find((r) => r.rideId === 'ride_2' && r.userId === 'u_aarav')
  const lb = leaderboard(sh)
  const myPts = lb.students.find((s) => s.userId === 'u_aarav')?.points || 0
  const classRank = lb.classes.findIndex((c) => c.classId === 'FE-A') + 1
  const sess = sh.sessions.find((s) => s.id === 'sess_m1')
  const cr = creditsOf(sh, 'u_aarav')
  const asDiya = db.profiles.u_diya

  const STEPS = [
    { path: '/', target: '[data-tour="overview"]', title: 'Overview: your day in one place',
      body: 'Today’s lectures come first, then work due, attendance and marks, events, your own study list and notices. Every line comes from a saved record and opens the full page.' },
    { path: '/planner', target: '[aria-label="Planner section"]', title: 'Planner: locked grades and what-if',
      body: 'Each subject shows the marks needed for every grade; grades marked Locked can no longer be reached with the internal marks already scored. What-if tries other marks without changing saved data, and an unreachable target suggests a peer tutor for the weakest subject.',
      actions: [{ label: 'Open what-if', run: () => { window.location.hash = '/planner?tab=whatif' } }, { label: 'Back to locked grades', run: () => { window.location.hash = '/planner?tab=marks' } }] },
    { path: '/rides', target: '#ride-ride_2', title: 'Rides: request → confirmed',
      body: 'Ask for a seat on Diya’s ride from Kurla. The driver is notified and confirms; your request status updates on the Rides page.',
      status: myReq ? <Badge tone={myReq.status === 'Confirmed' ? 'ok' : 'warn'}>Your seat: {myReq.status}</Badge> : <Badge>No request yet</Badge>,
      actions: !myReq ? [{ label: 'Request a seat', run: () => runShared((s) => requestSeat(s, 'ride_2', me, new Date()), 'Seat requested. Diya was notified.') }]
        : myReq.status === 'Requested' ? [{ label: 'Simulate: Diya confirms', run: () => runShared((s) => confirmRequest(s, myReq.id, asDiya, new Date()), 'Diya confirmed your seat (simulated).') }] : [] },
    { path: '/challenges', target: '#ch-ch_1', title: 'Challenges: complete → leaderboard moves',
      body: 'Complete the teacher’s “Library treasure hunt”. Points are recorded once, your class moves on the leaderboard, and your profile shows your rank. Points never create learning credits.',
      status: <Badge tone="info">You: {myPts} points · FE-A rank #{classRank || '–'}</Badge>,
      actions: hasCompleted(sh, 'ch_1', 'u_aarav') ? [] : [{ label: 'Complete it (+30)', run: () => runShared((s) => completeChallenge(s, 'ch_1', me, new Date()), '+30 points for FE-A!') }] },
    { path: '/peer', target: '#sess-sess_m1', title: 'Peer learning: matched → booked → completed',
      body: 'Kabir teaches you Python. Booking reserves your credit; completing moves exactly one credit from you to Kabir, so credits earned always equal credits spent plus credits held.',
      status: <Badge tone="info">Session: {sess?.status || '—'} · your balance {cr.balance}{cr.reserved ? ` (${cr.reserved} reserved)` : ''}</Badge>,
      actions: sess?.status === 'Matched' ? [{ label: 'Book for tomorrow 16:00', run: () => runShared((s) => bookSession(s, 'sess_m1', me, at(new Date(), 1, '16:00')), 'Booked. 1 credit reserved.') }]
        : sess?.status === 'Booked' ? [{ label: 'Mark completed', run: () => runShared((s) => completeSession(s, 'sess_m1', me, new Date()), 'Completed. 1 credit moved to Kabir.') }] : [] },
    { path: '/navigator', title: 'Campus navigator: route to your next lecture',
      body: lec ? `${lec.when}’s first lecture is ${lec.title} at ${lec.start} in ${lec.room}. The timetable, the dashboard and this route all use the same room data.` : 'Your timetable has no upcoming lectures.',
      actions: lec ? [{ label: 'Show the route', run: () => { window.location.hash = navHref(lec.place).slice(1) + '&go=1' } }] : [] },
  ]
  const s = STEPS[n - 1]

  // Go to the step's page when the step changes.
  useEffect(() => { if (active && s && route !== s.path && !(s.path === '/' && route === '/')) window.location.hash = s.path }, [n, active]) // eslint-disable-line
  // Highlight the step's target element.
  useEffect(() => {
    if (!active || !s?.target) { setRing(null); return }
    const find = () => { const el = document.querySelector(s.target); if (!el) return setRing(null); const r = el.getBoundingClientRect(); setRing(r.width ? { top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 } : null) }
    const first = setTimeout(() => { document.querySelector(s.target)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); find() }, 500)
    const t = setInterval(find, 400)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [n, active, route]) // eslint-disable-line
  if (!active || !s) return null
  return (
    <>
      {ring && <div aria-hidden="true" className="pointer-events-none fixed z-[60] rounded-2xl ring-4 ring-lime ring-offset-2 transition-all duration-300" style={ring} />}
      <section role="dialog" aria-label={`Guided demo, step ${n} of ${STEPS.length}`} className="slide-down fixed inset-x-3 bottom-[76px] z-[61] mx-auto max-w-[460px] rounded-2xl border border-brand/20 bg-surface p-4 shadow-pop lg:inset-x-auto lg:bottom-6 lg:left-[290px]">
        <div className="flex items-center gap-2"><Badge tone="demo">Guided demo</Badge><span className="text-[12px] font-semibold text-muted">Step {n} of {STEPS.length}</span>
          <button type="button" onClick={() => setStep(0)} aria-label="End the guided demo" className="press ml-auto grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-ground"><Icon name="x" size={16} /></button></div>
        <ol className="mt-2 flex gap-1" aria-hidden="true">{STEPS.map((_, i) => <li key={i} className={cx('h-1 flex-1 rounded-full', i < n ? 'bg-brand' : 'bg-sand')} />)}</ol>
        <h2 className="mt-2 font-display text-[17px] font-semibold leading-snug">{s.title}</h2>
        <p className="mt-1 text-[13.5px] text-[#33443B]">{s.body}</p>
        {s.status && <div className="mt-2">{s.status}</div>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(s.actions || []).map((a) => <Button key={a.label} size="sm" variant="secondary" onClick={a.run}>{a.label}</Button>)}
          <span className="flex-1" />
          {n > 1 && <Button size="sm" variant="ghost" onClick={() => setStep(n - 1)}>Back</Button>}
          {n < STEPS.length ? <Button size="sm" onClick={() => setStep(n + 1)}>Next</Button> : <Button size="sm" onClick={() => setStep(0)}>Finish</Button>}
        </div>
      </section>
    </>
  )
}
