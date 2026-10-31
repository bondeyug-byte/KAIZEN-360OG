// Student Overview (ADHD-friendly: one column of clearly titled blocks, the same order every day):
// 1 syllabus banner · 2 today's timetable with 3 assignments beside it · 4 academic calendar · 5 important dates ·
// 6 attendance · 7 events · 8 notices and quick actions (then the personal study planner).
// Every number comes from a saved record (lib/overview.js, lib/record.js, the server calendar); nothing is invented.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp, profileCompletion } from '../store/AppContext.jsx'
import { Card, CardTitle, Badge, Button, Empty, Spinner, relTime, cx, Dialog, Field, inputCls } from '../components/ui.jsx'
import { uid } from '../lib/ids.js'
import { nextTrains } from '../lib/transit.js'
import Icon from '../components/Icon.jsx'
import { useMyTimetable } from '../lib/timetable.js'
import { useStudentAttendance } from '../lib/record.js'
import { collegeTasks, personalTasks, upcomingEvents, importantNotices } from '../lib/overview.js'
import { notificationsFor } from '../lib/notifications.js'
import { checkTarget, RESULT } from '../lib/academic.js'
import { place, floorName } from '../navigator/building.js'
import { prefs } from '../lib/storage.js'
import { CLASS_LABEL, CAMPUS_TIMEZONE } from '../data/config.js'
import { api } from '../lib/portal.js'
import { useLoad } from '../components/CloudPortal.jsx'
import { SyllabusBanner, AssignmentsCard, AcademicCalendar, ImportantDates, EventDialog, useCalendar } from '../components/Academic.jsx'
import { ymdToday, monthGrid, demoItems, addDays } from '../lib/calendar.js'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
export const navHref = (p) => `#/navigator?f=${p.f}&id=${p.id}`

const WEEK = [1, 2, 3, 4, 5, 6, 0] // Monday first
export function campusNow(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: CAMPUS_TIMEZONE, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  return { wd: DAYS.indexOf(parts.find((p) => p.type === 'weekday').value), mins: (Number(parts.find((p) => p.type === 'hour').value) % 24) * 60 + Number(parts.find((p) => p.type === 'minute').value) }
}
/** One weekday's classes only (day: 0 = Sunday … 6 = Saturday), in time order. Live status only when that day is today.
 *  `tt` is the list from useMyTimetable(), the same data as College portal → Timetable. */
export function classesForDay(tt, day, now) {
  const { wd, mins } = campusNow(now)
  return (tt || []).filter((t) => t.day === day).sort((a, b) => toMin(a.start) - toMin(b.start))
    .map((t) => ({ ...t, status: day !== wd ? 'later' : toMin(t.end) <= mins ? 'done' : toMin(t.start) <= mins ? 'now' : 'later' }))
}
const roomLabel = (t) => { const p = t.place ? place(t.place.f, t.place.id) : null; return p ? `${p.short || p.name}, ${floorName(t.place.f)}` : t.place ? floorName(t.place.f) : t.room ? `Room ${t.room}` : 'Room not given' }
/** The next lecture after now (today's remaining first, then following days), with a readable room label. */
export function nextClass(tt, now) {
  if (!tt || !tt.length) return null
  const { wd, mins } = campusNow(now)
  for (let k = 0; k <= 7; k++) {
    const d = (wd + k) % 7
    const list = tt.filter((t) => t.day === d && (k > 0 || toMin(t.start) > mins)).sort((a, b) => toMin(a.start) - toMin(b.start))
    if (list.length) { const t = list[0]; return { ...t, dayLabel: k === 0 ? 'Today' : k === 1 ? 'Tomorrow' : DAYS[d].slice(0, 3), dayIndex: d, room: roomLabel(t) } }
  }
  return null
}

const SECTIONS = [['calendar', 'Academic calendar'], ['dates', 'Important academic dates'], ['progress', 'Attendance and marks'], ['events', 'College events'], ['notices', 'Notices'], ['actions', 'Quick actions'], ['study', 'Study planner (personal)']]
const fmtDate = (iso, o) => new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, ...o }).format(new Date(iso))
const DUE_BADGE = { overdue: ['Overdue', 'bad'], soon: ['Due soon', 'warn'] }
const Link = ({ href, children }) => <a href={href} className="text-[13px] font-semibold text-maroon underline-offset-2 hover:underline max-lg:inline-flex max-lg:min-h-[36px] max-lg:items-center">{children}</a>

export default function Dashboard({ query = {} }) {
  const { db, me, myData, now, session, updateMyData, pushToast } = useApp()
  const live = session.mode === 'google' // college account: sample records are never presented as real
  const cloud = live && !!session.cloud
  const my = useMyTimetable()
  const att = useStudentAttendance()
  const [hidden, setHiddenState] = useState(() => prefs.get('overviewHidden', []))
  const [customize, setCustomize] = useState(false)
  const [editDl, setEditDl] = useState(null)
  const [eventId, setEventId] = useState(null)
  const closeEvent = useCallback(() => setEventId(null), [])
  const setHidden = (h) => { setHiddenState(h); prefs.set('overviewHidden', h) }
  useEffect(() => { if (!query.dl) return; const t = setTimeout(() => { const el = document.getElementById('dl-' + query.dl); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash') } }, 150); return () => clearTimeout(t) }, [query.dl])

  const sh = db.shared
  const record = att.record
  const today = ymdToday(now)
  const ov = useLoad(() => (cloud ? api('overview') : Promise.resolve(null)), [cloud, session.enrollment?.division_code])
  const [range, setRange] = useState(() => { const g = monthGrid(today); return [g[0].date, g[41].date] })
  const cal = useCalendar(cloud, range[0], range[1])
  const soon = useCalendar(cloud, today, addDays(today, 45))
  const tasks = useMemo(() => collegeTasks({ shared: sh, me, now, live, reminders: record?.reminders || [] }), [sh, me, now, live, record])
  const mine = useMemo(() => personalTasks(myData?.deadlines, now), [myData?.deadlines, now])
  const events = useMemo(() => upcomingEvents({ shared: sh, me, now, live, college: record?.events || [] }), [sh, me, now, live, record])
  const notices = useMemo(() => {
    const club = (ov.data?.announcements || []).map((a) => ({ id: `ca_${a.id}`, kind: a.club_name || 'Club', tone: 'info', title: a.title, body: a.body, at: a.created_at, eventId: a.event_id }))
    return [...club, ...importantNotices({ shared: sh, me, now, live, record, notifications: notificationsFor(sh, session.userId) })].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }, [sh, me, now, live, record, session.userId, ov.data])
  const demoCal = useMemo(() => (cloud ? [] : demoItems({ tasks, events })), [cloud, tasks, events])
  const comp = profileCompletion(me)
  const show = (k) => !hidden.includes(k)
  const division = session.enrollment?.division_code || me.division
  const saveDl = (x) => { updateMyData((u) => ({ ...u, deadlines: x.id ? u.deadlines.map((y) => (y.id === x.id ? { ...y, ...x } : y)) : [...(u.deadlines || []), { ...x, id: uid('dl'), done: false }] })); pushToast(x.id ? 'Task updated.' : 'Task added.'); setEditDl(null) }
  const branch = ov.data?.branch || null

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] font-semibold leading-tight max-sm:text-[23px]">Overview</h1>
          <p className="text-[13.5px] text-muted">{fmtDate(now, { weekday: 'long', day: 'numeric', month: 'long' })}{division ? ` · ${division}` : ''}{me.name ? ` · ${me.name}` : ''}{me.demo ? ' · sample student' : ''}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCustomize(true)}>Customise</Button>
      </header>

      {!live && comp.pct < 100 && <p className="rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px]">Your profile is {comp.pct}% complete. <a href="#/profile" className="font-semibold text-maroon underline">Add your {comp.missing.join(', ')}</a>.</p>}
      {live && session.enrollment == null && <p className="rounded-lg border border-[#EBDDB9] bg-[#FDF8EC] px-3 py-2 text-[13.5px]">{session.joinRequest?.status === 'pending' ? `Your request to join ${session.joinRequest.division_code} is waiting for your teacher. Class timetable, attendance and work appear once it’s approved.` : 'You haven’t joined a class yet, so there is no timetable, attendance or class work to show.'} <a href="#/setup" className="font-semibold text-maroon underline">{session.joinRequest?.status === 'pending' ? 'View request' : 'Choose your division'}</a></p>}

      <SyllabusBanner syllabus={ov.data?.syllabus} branch={branch} live={live} loading={cloud && ov.loading} />

      <div data-tour="overview" className="grid gap-4 lg:grid-cols-2">
        <TodaySection my={my} now={now} />
        <AssignmentsCard live={cloud} items={ov.data?.assignments} loading={ov.loading} error={ov.error} demoTasks={tasks} now={now} onChanged={ov.reload} />
        {show('calendar') && <AcademicCalendar items={cloud ? cal.items : demoCal} status={cloud ? cal.status : 'ready'} message={cal.message} empty={cal.empty} today={today} demo={!cloud} onRange={(a, b) => setRange([a, b])} onOpenEvent={cloud ? setEventId : undefined} />}
        {show('dates') && <ImportantDates items={cloud ? soon.items : demoCal} status={cloud ? soon.status : 'ready'} today={today} demo={!cloud} onOpenEvent={cloud ? setEventId : undefined} />}
        {show('progress') && <ProgressSection att={att} myData={myData} live={live} />}
        {show('events') && <EventsSection events={events} now={now} onOpen={cloud ? setEventId : undefined} />}
        {show('notices') && <NoticesSection notices={notices} now={now} onOpenEvent={cloud ? setEventId : undefined} />}
        {show('actions') && <QuickActions live={live} now={now} syllabus={ov.data?.syllabus?.url} />}
        {show('study') && <StudySection items={mine} myData={myData} now={now} onAdd={() => setEditDl({})} onEdit={setEditDl} onDone={(d) => updateMyData((u) => ({ ...u, deadlines: u.deadlines.map((x) => (x.id === d.id ? { ...x, done: true } : x)) }))} />}
      </div>

      <Dialog open={customize} onClose={() => setCustomize(false)} title="Customise your overview">
        <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-[13px] text-muted">The syllabus banner, today’s timetable and assignments always stay at the top. Choose what else to show (saved in this browser).</legend>
          {SECTIONS.map(([k, l]) => <label key={k} className="flex min-h-[40px] items-center gap-3 text-[14px]"><input type="checkbox" className="h-[18px] w-[18px]" checked={show(k)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((x) => x !== k) : [...hidden, k])} />{l}</label>)}
        </fieldset>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setHidden([])}>Show all</Button><Button onClick={() => setCustomize(false)}>Done</Button></div>
      </Dialog>
      <Dialog open={!!editDl} onClose={() => setEditDl(null)} title={editDl?.id ? 'Edit task' : 'Add a study task'}>
        {editDl && <DeadlineForm d={editDl} onCancel={() => setEditDl(null)} onSave={saveDl} />}
      </Dialog>
      {eventId && <EventDialog id={eventId} onClose={closeEvent} />}
      {session.mode === 'demo' && <p className="text-center text-xs text-muted">Demo account: records marked “Sample” are fictional.</p>}
    </div>
  )
}

/* 1. Today's timetable */
const KIND = { lab: 'Lab', room: 'Classroom' }
function TodaySection({ my, now }) {
  const tt = my.entries
  const label = my.status === 'demo' ? (CLASS_LABEL[my.division] || my.division) : my.division
  const { wd } = campusNow(now)
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: CAMPUS_TIMEZONE }).format(now)
  const [day, setDayState] = useState(() => { const saved = prefs.get('ttDay2', null); return saved && saved.date === todayKey && WEEK.includes(saved.d) ? saved.d : wd })
  const setDay = (d) => { setDayState(d); prefs.set('ttDay2', { d, date: todayKey }) }
  const items = useMemo(() => classesForDay(tt, day, now), [tt, day, now])
  const current = classesForDay(tt, wd, now).find((t) => t.status === 'now')
  const next = nextClass(tt, now)
  const onKey = (e) => {
    const i = WEEK.indexOf(day), n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null
    if (n === null) return
    e.preventDefault(); const d = WEEK[(n + 7) % 7]; setDay(d); e.currentTarget.querySelector(`[data-day="${d}"]`)?.focus()
  }
  const full = my.status === 'demo' ? null : '#/portal?tab=tt'
  return (
    <Card>
      <CardTitle eyebrow={label ? `${label}${my.term && my.status !== 'demo' ? ` · ${my.term}` : ''}` : undefined} action={full ? <Link href={full}>Full timetable</Link> : <Link href="#/navigator">3D campus</Link>}>Today’s timetable</CardTitle>
      {my.status === 'loading' ? <Spinner label="Loading your timetable" />
        : my.status === 'error' ? <p role="alert" className="text-[13.5px] text-bad">Couldn’t load your timetable: {my.message}</p>
          : !tt.length ? <Empty icon="calendar" title={my.status === 'empty' && my.division ? `No timetable published for ${my.division} yet` : 'No timetable yet'}>{my.message || 'Nothing to show.'}</Empty>
            : <>
              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                <NowNext label="Now" item={current} empty="No lecture right now" sub={current ? `until ${current.end} · ${roomLabel(current)}` : ''} />
                <NowNext label="Next" item={next} empty="No more lectures this week" sub={next ? `${next.dayLabel} ${next.start} · ${next.room}` : ''} />
              </div>
              <div role="tablist" aria-label="Day of the week" onKeyDown={onKey} className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                {WEEK.map((d) => (
                  <button key={d} data-day={d} role="tab" aria-label={d === wd ? `${DAYS[d]}, today` : DAYS[d]} aria-selected={day === d} tabIndex={day === d ? 0 : -1} onClick={() => setDay(d)}
                    className={cx('press min-h-[40px] min-w-[44px] flex-1 rounded-lg px-2 text-[13px] font-semibold', day === d ? 'bg-ink text-white' : 'text-[#3B4048] hover:bg-ground')}>
                    {DAYS[d].slice(0, 3)}{d === wd && <span aria-hidden="true" className={cx('ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle', day === d ? 'bg-white' : 'bg-maroon')} />}
                  </button>))}
              </div>
              <div role="tabpanel" aria-label={`${DAYS[day]} timetable`}>
                {items.length ? (
                  <ol className="flex flex-col divide-y divide-line">
                    {items.map((t) => {
                      const p = t.place ? place(t.place.f, t.place.id) : null
                      return (
                        <li key={t.id} className={cx('flex items-center gap-3 py-2.5', t.status === 'done' && 'text-muted')}>
                          <span className="w-[92px] flex-none font-mono text-[12.5px] tabular-nums">{t.start}–{t.end}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2"><b className="text-[14.5px] font-semibold leading-snug">{t.title}</b>{t.status === 'now' && <Badge tone="maroon">Now</Badge>}</span>
                            <span className="block text-[12.5px] text-muted">{[...new Set([t.type, p && KIND[p.type]].filter(Boolean))].concat([roomLabel(t), t.batch && `Batch ${t.batch}`, t.teacher].filter(Boolean)).join(' · ')}</span>
                          </span>
                          {p && <a href={navHref(t.place)} aria-label={`Route to ${p.short}, ${floorName(t.place.f)}`} className="press inline-flex min-h-[40px] flex-none items-center gap-1 rounded-lg border border-line2 px-2.5 text-[13px] font-semibold hover:border-maroon hover:text-maroon"><Icon name="route" size={15} /><span className="hidden sm:inline">Route</span></a>}
                        </li>)
                    })}
                  </ol>) : <p className="py-4 text-[13.5px] text-muted">No lectures on {DAYS[day]}.</p>}
              </div>
            </>}
    </Card>
  )
}
function NowNext({ label, item, empty, sub }) {
  return (
    <div className="rounded-lg bg-ground px-3 py-2.5">
      <p className="text-[11.5px] font-semibold uppercase tracking-[.06em] text-muted">{label}</p>
      {item ? <><b className="block truncate text-[15px] font-semibold">{item.title}</b><span className="block truncate text-[12.5px] text-muted">{sub}</span></> : <span className="text-[13.5px] text-muted">{empty}</span>}
    </div>
  )
}

/* 3. Academic progress: attendance from the shared calculation, published marks, alerts */
function ProgressSection({ att, myData, live }) {
  const sum = att.sum, t = att.threshold, rec = att.record
  const low = sum && t != null ? sum.bySubject.filter((s) => s.pct != null && s.pct < t) : []
  const months = sum ? monthly(sum.rows).slice(-3) : []
  const marks = rec?.marks?.items?.filter((m) => m.obtained != null || m.absent).slice(0, 3) || []
  const tgt = !live && myData?.target != null && myData?.subjects?.length ? checkTarget(myData.subjects, myData.gradeScale, myData.target, myData.academic) : null
  return (
    <Card>
      <CardTitle action={<Link href="#/attendance">Attendance</Link>}>Attendance and marks</CardTitle>
      {att.status === 'loading' ? <Spinner label="Loading your record" /> : att.status === 'error' && !sum ? <p role="alert" className="text-[13.5px] text-bad">Couldn’t load your record: {att.message}</p> : <>
        <div className="flex items-baseline gap-3">
          <b className={cx('font-display text-[30px] font-semibold leading-none tabular-nums', t != null && sum?.overall.pct != null && sum.overall.pct < t ? 'text-bad' : 'text-ink')}>{sum?.overall.pct == null ? 'n/a' : `${sum.overall.pct}%`}</b>
          <span className="text-[13px] text-muted">{sum?.overall.total ? `attendance · ${sum.overall.present} of ${sum.overall.total} recorded lectures` : 'No lectures recorded yet'}</span>
        </div>
        {months.length > 1 && <p className="mt-1 text-[12.5px] text-muted">By month: {months.map((m) => `${m.label} ${m.pct}%`).join(' · ')}</p>}
        {low.length > 0 && <p className="mt-2 text-[13px]"><Badge tone="bad">Below {t}%</Badge> {low.map((s) => `${s.subject} (${s.pct}%)`).join(', ')}</p>}
        {att.thresholdIsReference && <p className="mt-1 text-[12px] text-muted">Sample data; {t}% is a reference line only.</p>}
        {rec?.alerts?.length > 0 && <p className="mt-2 text-[13px]"><Badge tone="bad">{rec.alerts.length} attendance alert{rec.alerts.length > 1 ? 's' : ''}</Badge> <Link href="#/portal?tab=record">Read</Link></p>}
        {live && <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1 text-[12.5px] font-semibold text-muted">Published marks</p>
          {marks.length ? <ul className="flex flex-col gap-1 text-[13.5px]">{marks.map((m) => <li key={m.id} className="flex justify-between gap-2"><span className="truncate">{m.subject} · {m.name}</span><b className="tabular-nums">{m.absent ? 'Absent' : `${m.obtained}/${m.max}`}</b></li>)}</ul>
            : <p className="text-[13px] text-muted">No marks published yet.</p>}
          <Link href="#/portal?tab=record">All marks</Link>
        </div>}
        {tgt && <p className="mt-3 border-t border-line pt-3 text-[13px]">Your planner target SGPA {myData.target}: <Badge tone={tgt.result === RESULT.ACHIEVABLE ? 'ok' : tgt.result === RESULT.NOT_ACHIEVABLE ? 'bad' : 'warn'}>{tgt.result}</Badge> <span className="text-muted">(personal estimate)</span></p>}
      </>}
    </Card>
  )
}
function monthly(rows) {
  const m = new Map()
  for (const r of rows) { const k = r.date.slice(0, 7); const x = m.get(k) || { p: 0, n: 0 }; x.n++; if (r.mark === 'P') x.p++; m.set(k, x) }
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => ({ key: k, label: new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' }).format(new Date(k + '-01T00:00:00Z')), pct: Math.round((1000 * x.p) / x.n) / 10 }))
}

/* 4. Upcoming events */
function EventsSection({ events, now, onOpen }) {
  return (
    <Card>
      <CardTitle action={<Link href="#/events">All events</Link>}>College events</CardTitle>
      {events.length ? <ul className="flex flex-col divide-y divide-line">{events.slice(0, 4).map((e) => (
        <li key={e.id}><a href={e.serverId && onOpen ? undefined : e.href} role={e.serverId && onOpen ? 'button' : undefined} tabIndex={0} onKeyDown={(ev) => { if (e.serverId && onOpen && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onOpen(e.serverId) } }} onClick={(ev) => { if (e.serverId && onOpen) { ev.preventDefault(); onOpen(e.serverId) } }} className="flex cursor-pointer items-center gap-3 py-2.5 hover:bg-ground/60">
          <span className="w-[52px] flex-none text-center leading-tight"><b className="block font-display text-[18px] tabular-nums">{fmtDate(e.start, { day: 'numeric' })}</b><small className="text-[11px] font-semibold uppercase text-muted">{fmtDate(e.start, { month: 'short' })}</small></span>
          <span className="min-w-0 flex-1"><b className={cx('block truncate text-[14px] font-semibold', e.cancelled && 'line-through')}>{e.title}</b>
            <small className="block truncate text-[12.5px] text-muted">{[fmtDate(e.start, { hour: 'numeric', minute: '2-digit' }), e.venue, e.regCloses && Date.parse(e.regCloses) > now ? `registration closes ${relTime(e.regCloses, now)}` : null, e.registration].filter(Boolean).join(' · ')}</small></span>
          {e.cancelled ? <Badge tone="bad">Cancelled</Badge> : e.mine ? <Badge tone={e.mine === 'Approved' ? 'ok' : 'warn'}>{e.mine}</Badge> : null}
          {e.source === 'sample' && <Badge tone="demo">Sample</Badge>}{e.source === 'college' && <Badge tone="info">{e.club || 'College'}</Badge>}
        </a></li>))}</ul> : <p className="text-[13.5px] text-muted">No upcoming events.</p>}
    </Card>
  )
}

/* 5. Study planner (personal) */
function StudySection({ items, myData, now, onAdd, onEdit, onDone }) {
  return (
    <Card>
      <CardTitle eyebrow="Personal · only you see this" action={<button onClick={onAdd} className="inline-flex min-h-[32px] items-center gap-1 text-[13px] font-semibold text-maroon hover:underline"><Icon name="plus" size={14} />Add</button>}>Study planner</CardTitle>
      {items.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {items.slice(0, 5).map((d) => { const b = DUE_BADGE[d.state]; return (
            <li key={d.id} id={'dl-' + d.id} className="flex items-center gap-3 py-2">
              <input type="checkbox" aria-label={`Mark "${d.title}" done`} className="h-[18px] w-[18px] flex-none cursor-pointer" onChange={() => onDone(d)} />
              <span className="min-w-0 flex-1"><b className="block text-[14px] font-semibold leading-snug">{d.title}</b><small className="text-[12.5px] text-muted">{[d.subject, `due ${relTime(d.due, now)}`].filter(Boolean).join(' · ')}</small></span>
              {b && <Badge tone={b[1]}>{b[0]}</Badge>}
              <button onClick={() => onEdit(d)} aria-label={`Edit "${d.title}"`} className="press grid h-10 w-10 flex-none place-items-center rounded-md text-muted hover:bg-sand hover:text-ink"><Icon name="edit" size={15} /></button>
            </li>) })}
        </ul>
      ) : <p className="text-[13.5px] text-muted">No study tasks. Add revision, practice or exam prep with a date.</p>}
      <p className="mt-3 text-[12.5px] text-muted">{myData?.subjects?.length ? <>Grade targets: <Link href="#/planner">Planner</Link></> : <>Work out the marks you need per grade in the <Link href="#/planner">Planner</Link>.</>}</p>
    </Card>
  )
}

/* 6. Important notices */
function NoticesSection({ notices, now, onOpenEvent }) {
  const { markNotificationsRead } = useApp()
  return (
    <Card>
      <CardTitle action={<Link href="#/notifications">All updates</Link>}>Notices</CardTitle>
      {notices.length ? <ul className="flex flex-col divide-y divide-line">{notices.slice(0, 5).map((n) => (
        <li key={n.id}><a href={n.eventId && onOpenEvent ? undefined : n.href} tabIndex={0} onClick={(ev) => { if (n.eventId && onOpenEvent) { ev.preventDefault(); onOpenEvent(n.eventId); return } n.notification && markNotificationsRead([n.id]) }} onKeyDown={(ev) => { if (n.eventId && onOpenEvent && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onOpenEvent(n.eventId) } }} className="flex cursor-pointer items-start gap-3 py-2.5 hover:bg-ground/60">
          <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><Badge tone={n.tone}>{n.kind}</Badge>{n.demo && <Badge tone="demo">Sample</Badge>}<small className="text-[12px] text-muted">{relTime(n.at, now)}</small></span>
            <b className={cx('mt-0.5 block text-[14px] leading-snug', n.unread === false ? 'font-medium' : 'font-semibold')}>{n.title}</b>{n.body && <small className="line-clamp-1 text-[12.5px] text-muted">{n.body}</small>}</span>
        </a></li>))}</ul> : <p className="text-[13.5px] text-muted">No notices for your class.</p>}
    </Card>
  )
}

/* 7. Quick actions */
function QuickActions({ live, now, syllabus }) {
  const train = nextTrains({ from: 'Chembur', now, limit: 1 }).trains?.[0]
  const actions = [
    ...(live ? [['Timetable', '#/portal?tab=tt']] : []), ['Attendance', '#/attendance'], ['Assignments', live ? '#/portal?tab=work' : '#/classwork'],
    ['Marks', live ? '#/portal?tab=record' : '#/planner'], ['Reports', live ? '#/portal?tab=record' : '#/attendance'], ['Events', '#/events'],
    ...(syllabus ? [['Syllabus', syllabus, true]] : []), ['3D campus', '#/navigator'], ['Library', '#/navigator?f=1&id=library'], ['Who to contact', '#/directory'],
  ]
  return (
    <Card className="lg:col-span-2">
      <CardTitle>Quick actions</CardTitle>
      <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
        {actions.map(([l, h, ext]) => <a key={l} href={h} {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="press inline-flex min-h-[40px] items-center rounded-lg border border-line2 bg-surface px-3 text-[13.5px] font-semibold hover:border-maroon hover:text-maroon">{l}</a>)}
      </nav>
      {train && <p className="mt-3 text-[13px] text-muted">Next train from Chembur: <b className="text-ink">{train.depText}</b> {train.typeLabel} to {train.dest} · <Link href="#/commute">Trains and buses</Link></p>}
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
      <p className="text-[12.5px] text-muted">Personal task: only you see it. You get a reminder within 24 hours of the due time.</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit">{d.id ? 'Save' : 'Add task'}</Button></div>
    </form>
  )
}
