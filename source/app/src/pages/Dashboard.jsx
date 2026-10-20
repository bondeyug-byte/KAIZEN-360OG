import bannerImg from '../assets/campus-banner.jpg'
import { useEffect, useMemo, useState } from 'react'
import { useApp, profileCompletion } from '../store/AppContext.jsx'
import { Card, CardTitle, Badge, Button, Empty, relTime, cx, AnimatedNumber, Dialog, Field, inputCls } from '../components/ui.jsx'
import { uid } from '../lib/ids.js'
import { nextTrains } from '../lib/transit.js'
import Icon from '../components/Icon.jsx'
import { timetableForClass } from '../data/seed.js'
import { place, floorName } from '../navigator/building.js'
import { prefs } from '../lib/storage.js'
import { checkTarget, marksTable, RESULT } from '../lib/academic.js'
import { leaderboard, eligible, hasCompleted } from '../lib/challenges.js'
import { creditsOf, findMatches } from '../lib/peer.js'
import { eventStatus, suggestEvents, EVENT_STATUS } from '../lib/events.js'
import { notificationsFor, unreadCount } from '../lib/notifications.js'
import { studentSummary } from '../lib/attendance.js'
import { lowAttendance, weakestSubject, tutorsFor, ATTENDANCE_REFERENCE } from '../lib/insights.js'
import { visiblePosts, KIND as POST_KIND } from '../lib/posts.js'
import { seatsInfo, seatStatusFor, departed } from '../lib/rides.js'
import { CLASS_LABEL, CAMPUS_TIMEZONE, STARTING_SOON_MINUTES } from '../data/config.js'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
export const navHref = (p) => `#/navigator?f=${p.f}&id=${p.id}`

const WEEK = [1, 2, 3, 4, 5, 6, 0] // Monday first
export function campusNow(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: CAMPUS_TIMEZONE, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  return { wd: DAYS.indexOf(parts.find((p) => p.type === 'weekday').value), mins: (Number(parts.find((p) => p.type === 'hour').value) % 24) * 60 + Number(parts.find((p) => p.type === 'minute').value) }
}
/** One weekday's classes only (day: 0 = Sunday … 6 = Saturday), in time order. Live status only when that day is today. */
export function classesForDay(classId, day, now) {
  const { wd, mins } = campusNow(now)
  return timetableForClass(classId).filter((t) => t.day === day).sort((a, b) => toMin(a.start) - toMin(b.start))
    .map((t) => ({ ...t, status: day !== wd ? 'later' : toMin(t.end) <= mins ? 'done' : toMin(t.start) <= mins ? 'now' : 'later' }))
}

export function todaysClasses(classId, now) {
  const tt = timetableForClass(classId)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: CAMPUS_TIMEZONE, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const wd = DAYS.indexOf(parts.find((p) => p.type === 'weekday').value)
  const mins = Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value)
  let day = wd, label = 'Today'
  let list = tt.filter((t) => t.day === wd)
  if (!list.length) { for (let k = 1; k <= 7; k++) { const d = (wd + k) % 7; const l = tt.filter((t) => t.day === d); if (l.length) { list = l; day = d; label = DAYS[d]; break } } }
  return { label, isToday: day === wd, items: list.sort((a, b) => toMin(a.start) - toMin(b.start)).map((t) => ({ ...t, status: day !== wd ? 'later' : toMin(t.end) <= mins ? 'done' : toMin(t.start) <= mins ? 'now' : 'later' })) }
}

/** The next lecture after now (today's remaining first, then following days), with a readable room label. */
export function nextClass(classId, now) {
  if (!classId) return null
  const { wd, mins } = campusNow(now)
  for (let k = 0; k <= 7; k++) {
    const d = (wd + k) % 7
    const list = timetableForClass(classId).filter((t) => t.day === d && (k > 0 || toMin(t.start) > mins)).sort((a, b) => toMin(a.start) - toMin(b.start))
    if (list.length) {
      const t = list[0]; const p = place(t.place.f, t.place.id)
      return { ...t, dayLabel: k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : DAYS[d].slice(0, 3), dayIndex: d, room: p ? `${p.short || p.name}, ${floorName(t.place.f)}` : floorName(t.place.f) }
    }
  }
  return null
}

export default function Dashboard({ query = {} }) {
  const { db, me, myData, now, session, updateMyData, pushToast } = useApp()
  const [editDl, setEditDl] = useState(null)
  useEffect(() => { if (!query.dl) return; const t = setTimeout(() => { const el = document.getElementById('dl-' + query.dl); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash') } }, 150); return () => clearTimeout(t) }, [query.dl])
  const sh = db.shared
  const evSettings = { timeZone: CAMPUS_TIMEZONE, soonWindowMinutes: STARTING_SOON_MINUTES }
  const deadlines = (myData?.deadlines || []).filter((d) => !d.done).sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
  const lb = leaderboard(sh)
  const myPoints = lb.students.find((s) => s.userId === me.id)?.points || 0
  const classRank = lb.classes.findIndex((c) => c.classId === me.classId)
  const credits = creditsOf(sh, me.id)
  const target = myData?.target
  const tgt = target != null && myData?.subjects?.length ? checkTarget(myData.subjects, myData.gradeScale, target, myData.academic) : null
  const myRequests = sh.rideRequests.filter((r) => r.userId === me.id)
  const comp = profileCompletion(me)

  // Recommendations drawn from several modules
  const recs = []
  // Attendance → planner: subjects under the reference line come first.
  for (const a of lowAttendance(sh, me.id, now).slice(0, 2)) recs.push({ icon: 'alert', href: `#/planner?subject=${encodeURIComponent(a.subject)}`, title: `${a.subject}: attendance ${a.pct}%`, sub: `${a.present}/${a.total} recorded lectures · below the ${ATTENDANCE_REFERENCE}% line — plan it in the planner` })
  // Planner → peer learning: an unreachable target suggests a tutor for the weakest subject.
  if (tgt?.result === RESULT.NOT_ACHIEVABLE) { const w = weakestSubject(myData.subjects); const t = w && tutorsFor(sh, w, me.id)[0]; if (w) recs.push({ icon: 'swap', href: `#/peer?q=${encodeURIComponent(w.name)}`, title: t ? `Target ${target} is out of reach — ${t.offer.userName} tutors ${w.code || w.name}` : `Target ${target} is out of reach — find a tutor for ${w.code || w.name}`, sub: `Weakest subject: ${w.name} (${w.internalScored}/${w.internalMax} internal)` }) }
  const evs = suggestEvents(sh.events, me, now, evSettings).slice(0, 2)
  evs.forEach((s) => recs.push({ icon: 'calendar', href: '#/events', title: s.event.title, sub: `${eventStatus(s.event, now, evSettings)} · matches your interest in ${s.matched.join(', ')}` }))
  const openCh = sh.challenges.filter((c) => eligible(c, me) && !hasCompleted(sh, c.id, me.id) && (!c.deadline || Date.parse(c.deadline) > now)).sort((a, b) => b.points - a.points)[0]
  if (openCh) recs.push({ icon: 'trophy', href: '#/challenges', title: openCh.title, sub: `+${openCh.points} points for ${openCh.classId}` })
  const match = findMatches(sh, db.profiles, me.id).find((m) => m.teachers.length)
  if (match) recs.push({ icon: 'swap', href: '#/peer', title: `Learn ${match.request.skill} from ${match.teachers[0].offer.userName}`, sub: `${credits.available} credit${credits.available === 1 ? '' : 's'} available` })
  const sub = (myData?.subjects || []).map((s) => ({ s, t: marksTable(s, myData.gradeScale) })).find((x) => x.t.valid && !x.t.missing && x.t.rows.some((r) => r.status === 'achievable'))
  if (sub) { const r = sub.t.rows.find((r) => r.status === 'achievable'); recs.push({ icon: 'book', href: '#/planner', title: `${sub.s.code || sub.s.name}: ${r.grade} is still within reach`, sub: `Score ${r.toScore} of ${sub.s.externalMax} in the remaining assessment` }) }

  const nextRide = sh.rides.filter((r) => r.creatorId !== me.id && !departed(r, now) && !seatsInfo(r, sh.rideRequests).full && seatStatusFor(r, sh.rideRequests, me.id) === 'Available').sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt))[0]

  const hour = +new Intl.DateTimeFormat('en-GB', { timeZone: CAMPUS_TIMEZONE, hour: '2-digit', hour12: false }).format(now) % 24
  const greet = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const train = nextTrains({ from: 'Chembur', now, limit: 2 }).trains || []
  const stats = [
    { href: '#/planner', label: 'Target SGPA', icon: 'book', value: tgt ? target : null, empty: 'Set a target', foot: tgt ? <Badge tone={tgt.result === RESULT.ACHIEVABLE ? 'ok' : tgt.result === RESULT.NOT_ACHIEVABLE ? 'bad' : 'warn'}>{tgt.result}</Badge> : <span>in the planner</span>, decimals: 2 },
    { href: '#/challenges', label: 'Challenge points', icon: 'trophy', value: myPoints, foot: classRank >= 0 ? `${me.classId} ranks #${classRank + 1} of ${lb.classes.length}` : 'No class points yet' },
    { href: '#/peer', label: 'Learning credits', icon: 'swap', value: credits.available, foot: `${credits.balance} balance · ${credits.reserved} reserved` },
    { href: '#/rides', label: 'Seat requests', icon: 'car', value: myRequests.length, foot: `${myRequests.filter((r) => r.status === 'Confirmed').length} confirmed · ${myRequests.filter((r) => r.status === 'Requested').length} waiting` },
  ]

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-[22px] bg-brand-deep text-white shadow-glass" style={{ backgroundImage: `linear-gradient(90deg, rgba(10,30,22,.78) 0%, rgba(10,30,22,.45) 55%, rgba(10,30,22,.15) 100%), url(${bannerImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
        <div className="flex min-h-[220px] flex-col justify-center gap-3 p-5 sm:min-h-[250px] sm:p-8">
          <span className="glass-dark inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[.12em]"><i className="h-2 w-2 rounded-full bg-lime" />{greet}, {me.name?.split(' ')[0] || 'there'}</span>
          <h1 className="font-display text-[30px] font-bold leading-[1.05] tracking-tight sm:text-[40px]">Your Campus,<br /><span className="text-lime">All in One Place.</span></h1>
          <p className="max-w-[520px] text-[14.5px] text-white/85">{new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(now)} · {CLASS_LABEL[me.classId] || 'Set your class in your profile'}{me.demo ? ' · sample student' : ''}</p>
          <div className="flex flex-wrap gap-2">
            <a href="#/navigator" className="press inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-lime px-4 text-[14px] font-bold text-lime-ink hover:brightness-95">Explore 3D Campus <Icon name="arrowUR" size={15} /></a>
            <a href="#/directory" className="press glass-btn inline-flex min-h-[42px] items-center gap-2 rounded-xl px-4 text-[14px] font-semibold"><Icon name="help" size={16} />Who do I contact?</a>
          </div>
        </div>
        <span className="glass-dark absolute bottom-4 right-4 hidden rounded-xl px-4 py-2 text-[10.5px] font-bold uppercase tracking-[.16em] md:block">Academics · People · Campus life</span>
      </section>

      {comp.pct < 100 && (
        <a href="#/profile" className="lift flex items-center gap-3 rounded-xl border border-[#EBDDB9] bg-[#FDF8EC] px-4 py-3">
          <span className="relative grid h-9 w-9 flex-none place-items-center rounded-full bg-surface text-[11px] font-bold text-warn ring-1 ring-[#EBDDB9]">{comp.pct}%</span>
          <span className="min-w-0 flex-1 text-[14px]"><b>Finish your profile.</b> <span className="text-muted">Add your {comp.missing.join(', ')} for better suggestions.</span></span><Icon name="chev" size={18} className="text-muted" />
        </a>
      )}

      <OverviewCards me={me} myData={myData} now={now} />
      <StudyStrip me={me} now={now} />

      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <WeekTimetable classId={me.classId} now={now} />
        <Bulletin />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardTitle eyebrow="Your most-used campus spaces" action={<a href="#/commute" className="text-[13px] font-semibold text-maroon hover:underline">Trains & buses</a>}>Quick access</CardTitle>
          {train[0] && (
            <a href="#/commute" className="mb-3 flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-ground">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-[#EAF0FC] text-route"><Icon name="train" size={17} /></span>
              <span className="min-w-0 flex-1 text-[13.5px]"><b className="font-semibold">Next from Chembur: {train[0].depText}</b><small className="block truncate text-[12.5px] text-muted">{train[0].typeLabel} to {train[0].dest}{train[1] ? ` · then ${train[1].depText}` : ''}</small></span>
              <Badge tone={train[0].wait <= 5 ? 'bad' : 'info'}>{train[0].wait < 60 ? `${train[0].wait} min` : `${Math.floor(train[0].wait / 60)} h`}</Badge>
            </a>
          )}
          <div className="grid grid-cols-3 gap-2">
            {[['Washroom', 'pin', '#/navigator?find=wc'], ['Library', 'library', '#/navigator?f=1&id=library'], ['Canteen', 'cup', '#/navigator?f=0&id=canteen'], ['Exam cell', 'office', '#/navigator?f=0&id=r17'], ['Faculty', 'contact', '#/directory?c=faculty'], ['Seniors', 'user', '#/directory?c=senior']].map(([l, ic, h]) => (
              <a key={l} href={h} className="lift flex flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-surface py-3 text-[12.5px] font-semibold"><Icon name={ic} size={18} className="text-maroon" />{l}</a>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[['Planner', '#/planner'], ['Rides', '#/rides'], ['Challenges', '#/challenges'], ['Events', '#/events'], ['Peer help', '#/peer']].map(([l, h]) => (
              <a key={l} href={h} className="press rounded-md bg-sand px-2.5 py-1.5 text-[12.5px] font-semibold text-[#3B4048] hover:bg-maroon-50 hover:text-maroon">{l}</a>
            ))}
          </div>
        </Card>
        <ComingUp now={now} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardTitle eyebrow="For you">Recommendations</CardTitle>
          {recs.length ? (
            <ul className="stagger flex flex-col gap-1.5">
              {recs.map((r, i) => (
                <li key={i}><a href={r.href} className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-ground">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-maroon-50 text-maroon ring-1 ring-maroon/10"><Icon name={r.icon} size={17} /></span>
                  <span className="min-w-0 flex-1"><b className="block truncate text-[14px] font-semibold">{r.title}</b><small className="text-[12.5px] text-muted">{r.sub}</small></span><Icon name="chev" size={16} className="text-muted transition-transform group-hover:translate-x-0.5" />
                </a></li>
              ))}
            </ul>
          ) : <Empty icon="spark" title="No suggestions yet">Add interests in your profile and subjects in the planner.</Empty>}
          {nextRide && <a href="#/rides" className="mt-3 flex items-center gap-3 rounded-lg bg-ground px-3 py-2.5 text-[13.5px] hover:bg-sand"><Icon name="car" size={17} className="text-maroon" /><span className="flex-1">Ride with seats: <b>{nextRide.from.name.replace(' (demo pin)', '')} → {nextRide.to.name.replace(' (demo pin)', '')}</b>, {relTime(nextRide.departAt, now)}</span><Icon name="chev" size={16} /></a>}
        </Card>
        <Card className="fade-in">
          <CardTitle eyebrow="Coming up" action={<button onClick={() => setEditDl({})} className="inline-flex items-center gap-1 text-[13px] font-semibold text-maroon hover:underline"><Icon name="plus" size={14} />Add</button>}>Deadlines</CardTitle>
          {deadlines.length ? (
            <ul className="stagger flex flex-col gap-2">
              {deadlines.slice(0, 5).map((d) => {
                const hrs = (Date.parse(d.due) - now) / 3600000
                const tone = hrs < 0 ? 'bad' : hrs < 36 ? 'warn' : null
                return (
                  <li key={d.id} id={'dl-' + d.id} className={cx('flex items-center gap-3 rounded-lg border border-line border-l-[3px] px-3 py-2.5 transition-colors hover:bg-ground', tone === 'bad' ? 'border-l-bad' : tone === 'warn' ? 'border-l-[#D99A2B]' : 'border-l-line2')}>
                    <input type="checkbox" aria-label={`Mark "${d.title}" done`} className="h-[18px] w-[18px] flex-none cursor-pointer" onChange={() => updateMyData((u) => ({ ...u, deadlines: u.deadlines.map((x) => (x.id === d.id ? { ...x, done: true } : x)) }))} />
                    <span className="min-w-0 flex-1"><b className="block text-[14px] font-semibold leading-snug">{d.title}</b><small className="text-[12.5px] text-muted">{d.subject} · due {relTime(d.due, now)}</small></span>
                    {tone === 'bad' ? <Badge tone="bad">Overdue</Badge> : tone === 'warn' ? <Badge tone="warn">Due soon</Badge> : null}
                    <button onClick={() => setEditDl(d)} aria-label={`Edit "${d.title}"`} className="press grid h-8 w-8 flex-none place-items-center rounded-md text-muted hover:bg-sand hover:text-ink"><Icon name="edit" size={15} /></button>
                  </li>
                )
              })}
            </ul>
          ) : <Empty icon="check" title="Nothing due">You're all caught up.</Empty>}
        </Card>
      </div>

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((st) => (
          <a key={st.label} href={st.href} className="lift group flex flex-col rounded-2xl border border-white/70 bg-white/85 p-4 shadow-card">
            <span className="flex items-center justify-between text-[12px] font-semibold text-muted">{st.label}<span className="grid h-7 w-7 place-items-center rounded-md bg-maroon-50 text-maroon transition-colors group-hover:bg-maroon group-hover:text-white"><Icon name={st.icon} size={15} /></span></span>
            <span className="mt-1.5 font-display text-[28px] font-semibold leading-none tabular-nums">{st.value == null ? <span className="text-[15px] font-medium text-muted">{st.empty}</span> : <AnimatedNumber value={st.value} decimals={st.decimals && !Number.isInteger(st.value) ? st.decimals : 0} />}</span>
            <span className="mt-2 text-[12.5px] text-muted">{st.foot}</span>
          </a>
        ))}
      </div>

      <Dialog open={!!editDl} onClose={() => setEditDl(null)} title={editDl?.id ? 'Edit deadline' : 'Add a deadline'}>
        {editDl && <DeadlineForm d={editDl} onCancel={() => setEditDl(null)} onSave={(x) => { updateMyData((u) => ({ ...u, deadlines: x.id ? u.deadlines.map((y) => (y.id === x.id ? { ...y, ...x } : y)) : [...(u.deadlines || []), { ...x, id: uid('dl'), done: false }] })); pushToast(x.id ? 'Deadline updated.' : 'Deadline added.'); setEditDl(null) }} />}
      </Dialog>
      {session.mode === 'demo' && <p className="text-center text-xs text-muted">Records marked “Sample” are fictional demo data.</p>}
    </div>
  )
}

const KIND = { lab: ['Laboratory', 'bg-[#FBF0DC] text-[#8A5A0E] ring-[#EBD3A6]'], room: ['Classroom', 'bg-[#E7F0FB] text-[#1F4F8A] ring-[#C7DAF2]'] }
function WeekTimetable({ classId, now }) {
  const { wd } = campusNow(now)
  // Opens on today, or on the next day with classes when today is free. A day picked today is remembered for today.
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: CAMPUS_TIMEZONE }).format(now)
  const [day, setDayState] = useState(() => {
    const saved = prefs.get('ttDay2', null)
    if (saved && saved.date === todayKey && WEEK.includes(saved.d)) return saved.d
    if (!classId) return wd
    for (let k = 0; k < 7; k++) { const d = (wd + k) % 7; if (timetableForClass(classId).some((t) => t.day === d)) return d }
    return wd
  })
  const setDay = (d) => { setDayState(d); prefs.set('ttDay2', { d, date: todayKey }) }
  const items = useMemo(() => (classId ? classesForDay(classId, day, now) : []), [classId, day, now])
  const onKey = (e) => {
    const i = WEEK.indexOf(day), n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (n === null) return
    e.preventDefault(); const d = WEEK[(n + 7) % 7]; setDay(d); e.currentTarget.querySelector(`[data-day="${d}"]`)?.focus()
  }
  return (
    <Card className="fade-in">
      <CardTitle eyebrow={classId ? `${CLASS_LABEL[classId] || classId} · weekly timetable` : 'Weekly timetable'} action={<a href="#/navigator" className="text-[13px] font-semibold text-maroon hover:underline">Open 3D map</a>}>Lectures & labs</CardTitle>
      <div role="tablist" aria-label="Day of the week" onKeyDown={onKey} className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {WEEK.map((d) => (
          <button key={d} data-day={d} role="tab" aria-selected={day === d} tabIndex={day === d ? 0 : -1} onClick={() => setDay(d)}
            className={cx('press relative flex min-h-[42px] min-w-[38px] flex-1 flex-col items-center justify-center rounded-xl px-1 text-[13px] font-semibold transition-colors', day === d ? 'bg-brand-deep text-white shadow-glass' : 'bg-ground text-[#33443B] hover:bg-brand-50')}>
            <span className="sm:hidden">{DAYS[d].slice(0, 3)}</span><span className="hidden sm:inline">{DAYS[d]}</span>
            {d === wd && <span className={cx('text-[9.5px] font-bold uppercase tracking-wider', day === d ? 'text-lime' : 'text-brand')}>Today</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={`${DAYS[day]} timetable`}>
        {!classId ? <Empty icon="calendar" title="No timetable yet">Set your class in your <a href="#/profile" className="font-semibold text-maroon">profile</a> to see your lectures.</Empty>
          : items.length ? (
            <ol key={day} className="stagger relative flex flex-col divide-y divide-line">
              {items.map((t, i) => {
                const p = place(t.place.f, t.place.id), kind = KIND[p?.type]
                const now_ = t.status === 'now', done = t.status === 'done'
                return (
                  <li key={t.id} className={cx('relative flex items-center gap-3 rounded-lg py-2.5 pl-2 pr-2', now_ && 'bg-maroon-50 ring-1 ring-maroon/15', done && 'opacity-55')}>
                    <span className="w-[50px] flex-none font-mono text-[12.5px] font-medium leading-tight text-[#3B4048] sm:w-[92px]">{t.start}<span className="block text-muted sm:inline">–{t.end}</span></span>
                    <span aria-hidden="true" className={cx('w-[4px] flex-none self-stretch rounded-full', p?.type === 'lab' ? 'bg-[#E0A63A]' : p?.type === 'room' ? 'bg-[#6FAE62]' : 'bg-[#8AA7C8]', now_ && 'ring-2 ring-lime')} />
                    <span className="min-w-0 flex-1">
                      <b className="block text-[14.5px] font-semibold leading-snug">{t.title}</b>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                        <Badge>{t.type}</Badge>
                        {kind && <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1', kind[1])}>{kind[0]}</span>}
                        <span className="rounded-md bg-ground px-1.5 py-0.5 text-[11.5px] font-semibold text-[#33443B]">{p ? p.short : 'Room not mapped'} · {floorName(t.place.f)}</span>
                      </span>
                    </span>
                    {now_ && <Badge tone="maroon">Now</Badge>}
                    {p && <a href={navHref(t.place)} aria-label={`Route to ${p.short}, ${floorName(t.place.f)}`} className="press inline-flex min-h-[34px] flex-none items-center gap-1 rounded-lg border border-line2 bg-surface px-2.5 text-[13px] font-semibold hover:border-maroon hover:text-maroon"><Icon name="route" size={15} /><span className="hidden sm:inline">Route</span></a>}
                  </li>
                )
              })}
            </ol>
          ) : <Empty icon="calendar" title={`No classes scheduled for ${DAYS[day]}`}>Nothing is in your class timetable for this day.</Empty>}
      </div>
    </Card>
  )
}

const toInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
function DeadlineForm({ d, onSave, onCancel }) {
  const [f, setF] = useState({ title: d.title || '', subject: d.subject || '', due: toInput(d.due) })
  const [err, setErr] = useState({})
  const submit = (e) => {
    e.preventDefault()
    const er = {}
    if (!f.title.trim()) er.title = 'Give it a title.'
    if (!f.due || !Number.isFinite(Date.parse(f.due))) er.due = 'Choose a due date and time.'
    setErr(er)
    if (!Object.keys(er).length) onSave({ ...(d.id ? { id: d.id } : {}), title: f.title.trim(), subject: f.subject.trim(), due: new Date(f.due).toISOString() })
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Field label="Title" error={err.title}>{(id) => <input id={id} className={inputCls} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Subject (optional)">{(id) => <input id={id} className={inputCls} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
        <Field label="Due" error={err.due}>{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />}</Field>
      </div>
      <p className="text-[12.5px] text-muted">You'll get a notification when a deadline is added or changed, and a reminder within 24 hours of it.</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit">{d.id ? 'Save' : 'Add deadline'}</Button></div>
    </form>
  )
}

/* ---------- reference-style overview pieces (all from real data) ---------- */
function OverviewCards({ me, myData, now }) {
  const { db, session } = useApp()
  const { wd, mins } = campusNow(now)
  const today = me.classId ? classesForDay(me.classId, wd, now) : []
  const upcoming = nextClass(me.classId, now)
  const open = (myData?.deadlines || []).filter((d) => !d.done)
  const soon = open.filter((d) => Date.parse(d.due) - now < 36 * 3600000).length
  const evs = db.shared.events.filter((e) => eventStatus(e, now) !== EVENT_STATUS.ENDED)
  const week = evs.filter((e) => Date.parse(e.start) - now < 7 * 86400000).length
  const unread = unreadCount(db.shared, session.userId)
  const cards = [
    { n: today.length, label: 'Classes today', tag: today.length ? 'Today' : 'Free day', foot: upcoming ? `Next class: ${upcoming.dayLabel} ${upcoming.start} · ${upcoming.title} · ${upcoming.room}` : 'Nothing in your timetable', href: upcoming ? navHref(upcoming.place) : '#/', icon: 'calendar' },
    { n: open.length, label: 'Tasks to review', tag: soon ? `${soon} due soon` : 'On track', foot: 'Deadlines and assignments', href: '#/?dl=', icon: 'check', warn: soon > 0 },
    { n: evs.length, label: 'Upcoming activities', tag: `${week} this week`, foot: 'Events open on campus', href: '#/events', icon: 'spark' },
    { n: unread, label: 'Campus updates', tag: unread ? 'New' : 'All read', foot: 'Unread announcements', href: '#/notifications', icon: 'megaphone' },
  ]
  return (
    <div data-tour="overview" className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <a key={c.label} href={c.href} className="lift flex flex-col rounded-2xl border border-white/70 bg-white/85 p-4 shadow-card">
          <span className="flex items-start justify-between gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand ring-1 ring-brand/10"><Icon name={c.icon} size={17} /></span><span className={cx('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', c.warn ? 'bg-[#FDF0D8] text-warn' : 'bg-lime-soft text-lime-ink')}>{c.tag}</span></span>
          <span className="mt-3 flex items-baseline gap-2"><b className="font-display text-[30px] font-bold leading-none tabular-nums">{String(c.n).padStart(2, '0')}</b><span className="text-[13.5px] font-semibold">{c.label}</span></span>
          <span className="mt-1.5 text-[12px] text-muted">{c.foot}</span>
        </a>
      ))}
    </div>
  )
}

function Bulletin() {
  const { db, session, now, markNotificationsRead } = useApp()
  const list = notificationsFor(db.shared, session.userId).slice(0, 4)
  return (
    <Card className="fade-in">
      <CardTitle eyebrow="Updates for your first-year journey" action={<a href="#/notifications" className="text-[13px] font-semibold text-maroon hover:underline">See all</a>}>Campus bulletin</CardTitle>
      {list.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((n) => (
            <li key={n.id}><a href={n.href || '#/notifications'} onClick={() => markNotificationsRead([n.id])} className="flex gap-3 py-2.5">
              <span className={cx('mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-xl', n.category === 'deadline' ? 'bg-[#FDF0D8] text-warn' : n.category === 'challenge' ? 'bg-[#E7F0FB] text-route' : 'bg-brand-50 text-brand')}><Icon name={n.category === 'deadline' ? 'clock' : n.category === 'challenge' ? 'trophy' : 'calendar'} size={16} /></span>
              <span className="min-w-0 flex-1"><b className={cx('block text-[14px] leading-snug', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</b><small className="line-clamp-2 text-[12.5px] text-muted">{n.body}</small></span>
              <small className="flex-none text-[11px] font-semibold uppercase text-muted">{relTime(n.at, now)}</small>
            </a></li>
          ))}
        </ul>
      ) : <Empty icon="megaphone" title="No announcements yet">Event decisions, new events and deadline reminders appear here.</Empty>}
    </Card>
  )
}

function ComingUp({ now }) {
  const { db } = useApp()
  const evs = db.shared.events.filter((e) => eventStatus(e, now) !== EVENT_STATUS.ENDED).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 3)
  return (
    <Card className="fade-in">
      <CardTitle eyebrow="Put a little something in your calendar" action={<a href="#/events" className="text-[13px] font-semibold text-maroon hover:underline">All events</a>}>Coming up</CardTitle>
      {evs.length ? <ul className="flex flex-col gap-2">{evs.map((e) => (
        <li key={e.id} className="flex items-center gap-3">
          <span className="flex h-12 w-12 flex-none flex-col items-center justify-center rounded-xl bg-lime-soft leading-none text-lime-ink"><b className="font-display text-[19px]">{new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, day: 'numeric' }).format(new Date(e.start))}</b><b className="mt-0.5 text-[9.5px] uppercase tracking-wider">{new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, month: 'short' }).format(new Date(e.start))}</b></span>
          <span className="min-w-0 flex-1"><b className="block truncate text-[14px] font-semibold">{e.title}</b><small className="block truncate text-[12px] text-muted">{e.place.label}</small></span>
          <a href={`#/events?id=${e.id}`} className="press flex-none rounded-lg border border-line2 bg-surface px-3 py-1.5 text-[12.5px] font-semibold hover:border-brand hover:text-brand">View details</a>
        </li>))}</ul> : <Empty icon="calendar" title="Nothing scheduled">New events show up here.</Empty>}
    </Card>
  )
}

/** Attendance % and newest classwork for the signed-in student (real records only). */
function StudyStrip({ me, now }) {
  const { db } = useApp()
  if (!me.division) return null
  const sum = studentSummary(db.shared, me.id, now)
  const posts = visiblePosts(db.shared, me, now).slice(0, 3)
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.45fr]">
      <a href="#/attendance" className="lift flex items-center gap-4 rounded-2xl border border-white/70 bg-white/85 p-4 shadow-card">
        <span className="grid h-16 w-16 flex-none place-items-center rounded-2xl bg-lime-soft font-display text-[20px] font-bold text-lime-ink">{sum.overall.pct == null ? '—' : `${Math.round(sum.overall.pct)}%`}</span>
        <span className="min-w-0 flex-1"><b className="block text-[15px] font-semibold">Attendance</b><small className="text-[12.5px] text-muted">{sum.overall.total ? `${sum.overall.present} present · ${sum.overall.absent} absent of ${sum.overall.total} recorded lectures` : 'No lectures recorded yet'}</small></span>
        <Icon name="chev" size={18} className="text-muted" />
      </a>
      <Card className="!p-4">
        <div className="mb-2 flex items-center justify-between"><b className="text-[15px] font-semibold">Classwork for {me.division}</b><a href="#/classwork" className="text-[13px] font-semibold text-maroon hover:underline">All</a></div>
        {posts.length ? <ul className="flex flex-col gap-1.5">{posts.map((p) => <li key={p.id}><a href={`#/classwork?id=${p.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-ground"><Badge tone="info">{POST_KIND[p.kind]}</Badge><span className="min-w-0 flex-1 truncate font-medium">{p.title}</span><small className="text-muted">{p.deadline ? `due ${relTime(p.deadline, now)}` : relTime(p.createdAt, now)}</small></a></li>)}</ul> : <p className="text-[13px] text-muted">Nothing from your teachers yet.</p>}
      </Card>
    </div>
  )
}
