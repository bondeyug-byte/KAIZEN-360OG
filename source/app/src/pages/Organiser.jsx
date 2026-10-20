import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Empty, Segmented, Dialog, Field, inputCls, DemoTag, relTime, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { regCounts, regStatus, decideRequest, publishEvent, updateEvent, formatEventTime, eventStatus, EVENT_STATUS, REG } from '../lib/events.js'
import { REG_TONE, venueHref } from './Events.jsx'
import EventChat from '../components/EventChat.jsx'
import { threadsFor } from '../lib/events.js'
import { allPlaces, floorName, FLOORS } from '../navigator/building.js'
import { CAMPUS_TIMEZONE, STARTING_SOON_MINUTES, CLASS_LABEL, INTEREST_OPTIONS } from '../data/config.js'

const settings = { timeZone: CAMPUS_TIMEZONE, soonWindowMinutes: STARTING_SOON_MINUTES }
const VENUE_TYPES = ['amphi', 'lobby', 'library', 'canteen', 'lab', 'room']
const toInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }

/**
 * Organiser desk: decide registration requests, publish and edit events, review challenge solutions.
 * Access: only profiles with role "organiser". In this browser-only build the check runs in the app's own
 * state transitions (src/lib/events.js, challenges.js) as well as here — a production deployment must enforce
 * the same rule on the server.
 */
export default function Organiser({ query = {} }) {
  const { db, me } = useApp()
  const [tab, setTab] = useState(query.tab || (query.ev ? 'requests' : 'desk'))
  useEffect(() => { if (query.tab) setTab(query.tab); else if (query.ev) setTab('requests') }, [query.tab, query.ev, query.s])
  if (me?.role !== 'organiser') return <div className="py-10"><Empty icon="lock" title="Council / Club access only">This desk is for council and club organisers. Students can see their own request status on the <a href="#/events" className="font-semibold text-maroon">Events</a> page.</Empty></div>
  const mine = db.shared.events.filter((e) => e.organiserId === me.id)
  const pending = mine.reduce((n, e) => n + regCounts(db.shared, e.id).pending, 0)
  const chats = mine.reduce((n, e) => n + threadsFor(db.shared, e.id).length, 0)
  return (
    <div>
      <PageHeader title="Event desk" subtitle="Council / Club portal: your desk profile, upcoming and ongoing events, registration requests and messages from students." />
      <div className="mb-4 overflow-x-auto"><Segmented label="Event desk section" value={tab} onChange={setTab} options={[{ value: 'desk', label: 'Desk' }, { value: 'requests', label: `Requests (${pending})` }, { value: 'events', label: `My events (${mine.length})` }, { value: 'publish', label: 'Publish event' }, { value: 'chat', label: `Chat (${chats})` }]} /></div>
      {tab === 'desk' && <Desk mine={mine} go={setTab} />}
      {tab === 'requests' && <Requests events={mine} initial={query.ev} />}
      {tab === 'events' && <MyEvents events={mine} />}
      {tab === 'publish' && <EventForm onDone={() => setTab('events')} />}
      {tab === 'chat' && <Chat events={mine} initialEv={query.ev} initialStudent={query.s} />}
    </div>
  )
}

/** Desk profile (editable) and a clear list of ongoing and upcoming events. */
function Desk({ mine, go }) {
  const { db, me, now, updateProfile, pushToast } = useApp()
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ name: me.name || '', branch: me.branch || '', email: me.email || '', about: me.about || '' })
  const [err, setErr] = useState('')
  const save = (e) => {
    e.preventDefault()
    if (!f.name.trim() || f.name.trim().length > 80) return setErr('Give the desk a name (under 80 characters).')
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErr('That email doesn’t look right.')
    if (f.about.length > 300) return setErr('Keep the description under 300 characters.')
    updateProfile({ name: f.name.trim(), branch: f.branch.trim().slice(0, 80), email: f.email.trim(), about: f.about.trim() }); setErr(''); setEdit(false); pushToast('Desk profile saved.')
  }
  const all = [...db.shared.events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const live = all.filter((e) => eventStatus(e, now, settings) === EVENT_STATUS.LIVE)
  const upcoming = all.filter((e) => [EVENT_STATUS.OPEN, EVENT_STATUS.SOON].includes(eventStatus(e, now, settings)))
  const Row = ({ e }) => { const own = e.organiserId === me.id; const k = regCounts(db.shared, e.id); return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2.5">
      <span className="min-w-0 flex-1"><b className="block text-[14.5px]">{e.title}</b><small className="text-[12.5px] text-muted">{formatEventTime(e.start, CAMPUS_TIMEZONE)} · {e.place?.label}{own ? ` · ${k.approved} approved, ${k.pending} pending` : ` · by ${e.organiserName || 'another organiser'}`}</small></span>
      <Badge tone={eventStatus(e, now, settings) === EVENT_STATUS.LIVE ? 'ok' : 'info'}>{eventStatus(e, now, settings)}</Badge>{own && <Badge tone="maroon">Yours</Badge>}
    </li>) }
  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <Card className="h-fit">
        <CardTitle eyebrow="Desk profile" action={!edit && <Button size="sm" variant="secondary" icon="edit" onClick={() => setEdit(true)}>Edit</Button>}>{me.name}</CardTitle>
        {edit ? <form onSubmit={save} noValidate className="flex flex-col gap-3">
          <Field label="Desk name">{(id) => <input id={id} maxLength={80} className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Council / club">{(id) => <input id={id} maxLength={80} className={inputCls} placeholder="e.g. Students' Council" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} />}</Field>
          <Field label="Contact email (optional)">{(id) => <input id={id} type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="About (optional)">{(id) => <textarea id={id} rows={3} maxLength={300} className={cx(inputCls, 'py-2')} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} />}</Field>
          {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => { setEdit(false); setErr('') }}>Cancel</Button><Button type="submit">Save</Button></div>
        </form> : <dl className="grid gap-1.5 text-[13.5px]">
          <div className="flex gap-2"><dt className="w-[92px] flex-none text-muted">Council / club</dt><dd>{me.branch || 'Not set'}</dd></div>
          <div className="flex gap-2"><dt className="w-[92px] flex-none text-muted">Contact</dt><dd className="break-all">{me.email || 'Not set'}</dd></div>
          <div className="flex gap-2"><dt className="w-[92px] flex-none text-muted">Events</dt><dd>{mine.length} managed by this desk</dd></div>
          {me.about && <p className="mt-1 text-[#33443B]">{me.about}</p>}
        </dl>}
        <div className="mt-4 grid grid-cols-2 gap-2"><Button size="sm" variant="secondary" onClick={() => go('requests')}>Requests</Button><Button size="sm" variant="secondary" onClick={() => go('chat')}>Messages</Button></div>
      </Card>
      <div className="flex flex-col gap-5">
        <Card><CardTitle eyebrow="Happening now">Ongoing events ({live.length})</CardTitle>
          {live.length ? <ul className="flex flex-col gap-2">{live.map((e) => <Row key={e.id} e={e} />)}</ul> : <p className="text-[13.5px] text-muted">Nothing is running right now.</p>}</Card>
        <Card><CardTitle eyebrow="Next on campus" action={<Button size="sm" icon="plus" onClick={() => go('publish')}>Publish event</Button>}>Upcoming events ({upcoming.length})</CardTitle>
          {upcoming.length ? <ul className="flex flex-col gap-2">{upcoming.map((e) => <Row key={e.id} e={e} />)}</ul> : <Empty icon="calendar" title="No upcoming events">Publish one to open registration requests.</Empty>}</Card>
      </div>
    </div>
  )
}

/** Organiser side of the event chat: pick an event, pick a student's conversation, reply. */
function Chat({ events, initialEv, initialStudent }) {
  const { db } = useApp()
  const [evId, setEvId] = useState(events.some((e) => e.id === initialEv) ? initialEv : events[0]?.id)
  const ev = events.find((e) => e.id === evId)
  const threads = ev ? threadsFor(db.shared, ev.id) : []
  const [sid, setSid] = useState(initialStudent || null)
  const active = threads.find((t) => t.studentId === sid) || threads[0]
  if (!events.length) return <Empty icon="calendar" title="No events yet">Publish an event; students can then message you about it.</Empty>
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="flex flex-col gap-3">
        <Field label="Event">{(id) => <select id={id} className={inputCls} value={evId} onChange={(e) => { setEvId(e.target.value); setSid(null) }}>{events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>}</Field>
        <Card className="!p-2"><p className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wider text-muted">Conversations</p>
          {threads.length ? <ul className="flex flex-col gap-1">{threads.map((t) => (
            <li key={t.studentId}><button onClick={() => setSid(t.studentId)} aria-current={active?.studentId === t.studentId} className={cx('press flex w-full flex-col rounded-lg px-3 py-2 text-left', active?.studentId === t.studentId ? 'bg-maroon-50 ring-1 ring-maroon/20' : 'hover:bg-ground')}>
              <b className="text-[13.5px]">{t.studentName || db.profiles[t.studentId]?.name || 'Student'}</b><small className="truncate text-[12px] text-muted">{t.last.fromRole === 'organiser' ? 'You: ' : ''}{t.last.text}</small></button></li>))}</ul>
            : <p className="px-2 py-2 text-[13px] text-muted">No messages about this event yet. Students start a conversation from the event page.</p>}
        </Card>
      </div>
      {active ? <EventChat key={ev.id + active.studentId} ev={ev} studentId={active.studentId} studentName={active.studentName} /> : <div className="grid min-h-[320px] place-items-center rounded-xl border border-dashed border-line2 p-6 text-center text-[13.5px] text-muted">Select a conversation to read and reply.</div>}
    </div>
  )
}

function Requests({ events, initial }) {
  const { db, me, now, runShared } = useApp()
  const sh = db.shared
  const [evId, setEvId] = useState(initial && events.some((e) => e.id === initial) ? initial : events[0]?.id)
  const [show, setShow] = useState('open')
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const [openReq, setOpenReq] = useState(null)
  const ev = events.find((e) => e.id === evId)
  if (!events.length) return <Empty icon="calendar" title="You don't manage any events yet">Publish one from “Publish event”.</Empty>
  const c = regCounts(sh, ev.id)
  const reqs = sh.registrations.filter((r) => r.eventId === ev.id && (show === 'all' || [REG.PENDING, REG.WAITLISTED].includes(regStatus(r)))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const started = now.getTime() >= Date.parse(ev.start)
  const decide = (r, d, why = '') => runShared((s) => decideRequest(s, r.id, me, d, why, new Date()), d === 'approve' ? `Approved ${r.userName}.` : d === 'reject' ? `Rejected ${r.userName}.` : `${r.userName} waitlisted.`)
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <Card className="h-fit !p-2">
        <ul className="flex flex-col gap-1">
          {events.map((e) => { const k = regCounts(sh, e.id); return (
            <li key={e.id}><button onClick={() => setEvId(e.id)} aria-current={e.id === evId} className={cx('press flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left', e.id === evId ? 'bg-maroon-50 ring-1 ring-maroon/20' : 'hover:bg-ground')}>
              <span className="min-w-0 flex-1"><b className="block truncate text-[14px] font-semibold">{e.title}</b><small className="text-[12px] text-muted">{formatEventTime(e.start, CAMPUS_TIMEZONE)}</small></span>
              {k.pending > 0 && <Badge tone="warn">{k.pending}</Badge>}
            </button></li>) })}
        </ul>
      </Card>
      <Card>
        <CardTitle eyebrow={eventStatus(ev, now, settings)} action={<a href={venueHref(ev.place)} className="text-[13px] font-semibold text-maroon hover:underline">Venue in 3D</a>}>{ev.title}</CardTitle>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[['Approved', ev.capacity ? `${c.approved}/${ev.capacity}` : c.approved, 'ok'], ['Pending', c.pending, 'warn'], ['Waitlisted', c.waitlisted, 'info'], ['Places left', ev.capacity ? Math.max(0, ev.capacity - c.approved) : '∞', null]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-line px-3 py-2"><small className="text-[12px] text-muted">{k}</small><b className="block font-display text-[20px] font-semibold tabular-nums">{v}</b></div>))}
        </div>
        {started && <p className="mb-3 rounded-lg bg-sand px-3 py-2 text-[13px]">This event has started, so requests can no longer be decided.</p>}
        <div className="mb-2"><Segmented label="Requests shown" value={show} onChange={setShow} options={[{ value: 'open', label: 'Awaiting decision' }, { value: 'all', label: 'All requests' }]} /></div>
        {reqs.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {reqs.map((r) => { const st = regStatus(r), open = [REG.PENDING, REG.WAITLISTED].includes(st); return (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1"><b className="text-[14.5px]">{r.userName}</b> <span className="text-[13px] text-muted">· {CLASS_LABEL[r.form?.classId] || r.form?.classId || '—'} · requested {relTime(r.at, now)}</span> <DemoTag show={r.demo} /></span>
                  <Badge tone={REG_TONE[st]}>{st}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon="eye" onClick={() => setOpenReq(r)}>Details</Button>
                  {open && !started && <>
                    <Button size="sm" icon="check" onClick={() => decide(r, 'approve')}>Approve</Button>
                    {st !== REG.WAITLISTED && <Button size="sm" variant="secondary" onClick={() => decide(r, 'waitlist')}>Waitlist</Button>}
                    <Button size="sm" variant="secondary" className="!text-bad" onClick={() => { setRejecting(r); setReason('') }}>Reject</Button>
                  </>}
                </div>
              </li>) })}
          </ul>
        ) : <Empty icon="check" title={show === 'open' ? 'Nothing waiting' : 'No requests yet'}>New requests appear here and in your notifications.</Empty>}
      </Card>
      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.userName || ''}'s request`}>
        <form onSubmit={(e) => { e.preventDefault(); const r = decide(rejecting, 'reject', reason); if (r.ok) setRejecting(null) }} className="flex flex-col gap-3">
          <Field label="Reason (optional, shown to the student)">{(id) => <textarea id={id} rows={3} maxLength={300} className={cx(inputCls, 'py-2')} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button><Button type="submit" className="!bg-bad">Reject request</Button></div>
        </form>
      </Dialog>
      <Dialog open={!!openReq} onClose={() => setOpenReq(null)} title="Registration details">
        {openReq && <dl className="divide-y divide-line rounded-xl border border-line text-[14px]">
          {[['Name', openReq.form?.name || openReq.userName], ['Class', CLASS_LABEL[openReq.form?.classId] || openReq.form?.classId || '—'], ['Email', openReq.form?.email || '—'], ['Phone', openReq.form?.phone || '—'], ['Roll number', openReq.form?.roll || '—'], ...(openReq.form?.teamSize ? [['Team size', openReq.form.teamSize]] : []), ...(ev.form?.question ? [[ev.form.question, openReq.form?.answer || '—']] : []), ['Status', regStatus(openReq)], ['Submitted', new Date(openReq.at).toLocaleString('en-IN', { timeZone: CAMPUS_TIMEZONE })], ...(openReq.reason ? [['Reason given', openReq.reason]] : [])].map(([k, v]) => <div key={k} className="flex gap-3 px-3 py-2"><dt className="w-[120px] flex-none text-muted">{k}</dt><dd className="min-w-0 flex-1 break-words">{v}</dd></div>)}
        </dl>}
      </Dialog>
    </div>
  )
}

function MyEvents({ events }) {
  const { db, now } = useApp()
  const [editing, setEditing] = useState(null)
  if (!events.length) return <Empty icon="calendar" title="No events yet">Publish one from “Publish event”.</Empty>
  return (
    <div className="stagger grid gap-3 md:grid-cols-2">
      {events.map((e) => { const k = regCounts(db.shared, e.id), st = eventStatus(e, now, settings); return (
        <Card key={e.id} className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2"><b className="text-[15.5px]">{e.title}</b><Badge>{st}</Badge></div>
          <p className="text-[13px] text-muted">{formatEventTime(e.start, CAMPUS_TIMEZONE)} · {e.place.label}</p>
          <p className="text-[13px]">{k.approved}{e.capacity ? `/${e.capacity}` : ''} approved · {k.pending} pending · {k.waitlisted} waitlisted · {k.rejected} rejected</p>
          <div className="mt-1 flex gap-2"><Button size="sm" variant="secondary" icon="edit" disabled={st === EVENT_STATUS.ENDED} onClick={() => setEditing(e)}>Edit / post update</Button></div>
        </Card>) })}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={`Edit · ${editing?.title || ''}`} wide>
        {editing && <EventForm existing={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  )
}

function EventForm({ existing, onDone }) {
  const { db, me, runShared } = useApp()
  const venues = useMemo(() => allPlaces().filter((p) => VENUE_TYPES.includes(p.type)), [])
  const [f, setF] = useState(() => existing ? { title: existing.title, description: existing.description, start: toInput(existing.start), end: toInput(existing.end), regCloses: toInput(existing.regCloses), venue: `${existing.place.f}:${existing.place.id}`, capacity: existing.capacity ?? '', tags: existing.tags || [], roll: !!existing.form?.roll, teamMax: existing.form?.teamMax || '', question: existing.form?.question || '', note: existing.note || '' }
    : { title: '', description: '', start: '', end: '', regCloses: '', venue: '2:amphi', capacity: '', tags: [], roll: false, teamMax: '', question: '', note: '' })
  const [errors, setErrors] = useState([])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const submit = (e) => {
    e.preventDefault()
    const [vf, vid] = f.venue.split(':'), vp = venues.find((p) => p.f === +vf && p.id === vid)
    const placeRec = vp ? { f: vp.f, id: vp.id, label: `${vp.short}, ${floorName(vp.f)}` } : null
    const form = { ...(f.roll ? { roll: true } : {}), ...(f.teamMax ? { teamMax: Number(f.teamMax) } : {}), ...(f.question.trim() ? { question: f.question.trim(), questionRequired: true } : {}) }
    const cap = f.capacity === '' ? null : Number(f.capacity)
    const r = existing
      ? runShared((s) => updateEvent(s, existing.id, { title: f.title, description: f.description, start: f.start ? new Date(f.start).toISOString() : existing.start, end: f.end ? new Date(f.end).toISOString() : existing.end, regCloses: f.regCloses ? new Date(f.regCloses).toISOString() : null, place: placeRec || existing.place, capacity: cap, form, tags: f.tags, note: f.note.trim() || undefined }, me, new Date()), 'Event updated. Students with requests were notified of changes.')
      : runShared((s) => publishEvent(s, { title: f.title, description: f.description, start: f.start, end: f.end, regCloses: f.regCloses || null, place: placeRec, capacity: cap, tags: f.tags, form }, me, db.profiles, new Date()), 'Event published. Students have been notified.')
    setErrors(r.ok ? [] : r.errors || [r.error])
    if (r.ok) onDone()
  }
  return (
    <Card as="form" onSubmit={submit} noValidate className={cx('flex flex-col gap-3', existing && '!border-0 !p-0 !shadow-none')}>
      <Field label="Title">{(id) => <input id={id} className={inputCls} maxLength={90} value={f.title} onChange={set('title')} />}</Field>
      <Field label="Description">{(id) => <textarea id={id} rows={3} className={cx(inputCls, 'py-2')} value={f.description} onChange={set('description')} />}</Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Starts">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.start} onChange={set('start')} />}</Field>
        <Field label="Ends">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.end} onChange={set('end')} />}</Field>
        <Field label="Requests close" hint="Blank = at the start">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.regCloses} onChange={set('regCloses')} />}</Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <Field label="Venue (opens in the 3D campus)">{(id) => <select id={id} className={inputCls} value={f.venue} onChange={set('venue')}>
          {Array.from({ length: FLOORS }, (_, fl) => <optgroup key={fl} label={floorName(fl)}>{venues.filter((p) => p.f === fl).map((p) => <option key={p.id} value={`${fl}:${p.id}`}>{p.name}</option>)}</optgroup>)}
        </select>}</Field>
        <Field label="Capacity" hint="Blank = no limit">{(id) => <input id={id} inputMode="numeric" className={inputCls} value={f.capacity} onChange={set('capacity')} />}</Field>
      </div>
      <fieldset><legend className="mb-1.5 text-[13px] font-medium text-[#3B4048]">Interests (used for suggestions)</legend>
        <div className="flex flex-wrap gap-1.5">{INTEREST_OPTIONS.map((t) => <label key={t} className={cx('press cursor-pointer rounded-full border px-2.5 py-1 text-[12.5px] font-medium', f.tags.includes(t) ? 'border-maroon bg-maroon-50 text-maroon' : 'border-line2')}><input type="checkbox" className="sr-only" checked={f.tags.includes(t)} onChange={() => setF({ ...f, tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] })} />{t}</label>)}</div>
      </fieldset>
      <fieldset className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-3"><legend className="px-1 text-[13px] font-medium text-[#3B4048]">Registration form</legend>
        <label className="flex min-h-[40px] items-center gap-2 text-[14px]"><input type="checkbox" checked={f.roll} onChange={set('roll')} className="h-4 w-4" />Require roll number</label>
        <Field label="Max team size" hint="Blank = individuals">{(id) => <input id={id} inputMode="numeric" className={inputCls} value={f.teamMax} onChange={set('teamMax')} />}</Field>
        <Field label="Extra question (optional)">{(id) => <input id={id} className={inputCls} value={f.question} onChange={set('question')} />}</Field>
      </fieldset>
      {existing && <Field label="Update note for registered students (optional)">{(id) => <input id={id} className={inputCls} maxLength={200} value={f.note} onChange={set('note')} placeholder="e.g. Bring your college ID" />}</Field>}
      {errors.length > 0 && <ul role="alert" className="list-disc rounded-xl bg-[#FBEDEA] py-2 pl-8 pr-3 text-sm text-bad">{errors.map((x) => <li key={x}>{x}</li>)}</ul>}
      <div className="flex justify-end gap-2">{existing && <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>}<Button type="submit" icon={existing ? 'check' : 'send'}>{existing ? 'Save changes' : 'Publish event'}</Button></div>
    </Card>
  )
}
