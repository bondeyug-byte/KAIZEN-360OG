import { useEffect, useState } from 'react'
import EventChat from '../components/EventChat.jsx'
import { isStudent } from '../lib/posts.js'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, Button, Badge, Empty, Segmented, DemoTag, Dialog, Field, inputCls, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { eventStatus, EVENT_STATUS, canRequest, requestRegistration, withdrawRequest, suggestEvents, myRequest, regStatus, regCounts, validateRegistrationForm, formatEventTime, REG } from '../lib/events.js'
import { CAMPUS_TIMEZONE, STARTING_SOON_MINUTES, CLASSES, CLASS_LABEL } from '../data/config.js'
import { place, floorName } from '../navigator/building.js'

const TONE = { [EVENT_STATUS.OPEN]: 'ok', [EVENT_STATUS.SOON]: 'warn', [EVENT_STATUS.LIVE]: 'maroon', [EVENT_STATUS.ENDED]: 'neutral' }
export const REG_TONE = { [REG.PENDING]: 'warn', [REG.APPROVED]: 'ok', [REG.REJECTED]: 'bad', [REG.WITHDRAWN]: 'neutral', [REG.WAITLISTED]: 'info' }
const settings = { timeZone: CAMPUS_TIMEZONE, soonWindowMinutes: STARTING_SOON_MINUTES }
const timeRange = (ev) => `${formatEventTime(ev.start, CAMPUS_TIMEZONE)} – ${new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, hour: 'numeric', minute: '2-digit' }).format(new Date(ev.end))}`
export const venueHref = (p) => `#/navigator?f=${p.f}&id=${p.id}`

export default function Events({ query = {} }) {
  const { db, me, now, runShared, signedIn } = useApp()
  const sh = db.shared
  const [view, setView] = useState(signedIn ? 'foryou' : 'all')
  const [openId, setOpenId] = useState(query.id || null)
  const [formFor, setFormFor] = useState(query.id && query.form ? query.id : null)
  useEffect(() => { if (query.id) { setOpenId(query.id); if (query.form) setFormFor(query.id) } }, [query.id, query.form])
  const sugg = signedIn ? suggestEvents(sh.events, me, now, settings) : []
  const order = { [EVENT_STATUS.LIVE]: 0, [EVENT_STATUS.SOON]: 1, [EVENT_STATUS.OPEN]: 2, [EVENT_STATUS.ENDED]: 3 }
  let list = view === 'foryou' ? sugg.map((s) => ({ ev: s.event, matched: s.matched })) : sh.events.map((ev) => ({ ev, matched: [] }))
  if (view === 'open') list = list.filter(({ ev }) => eventStatus(ev, now, settings) === EVENT_STATUS.OPEN)
  if (view === 'mine') list = sh.events.filter((ev) => signedIn && myRequest(sh, ev.id, me.id)).map((ev) => ({ ev, matched: [] }))
  list = list.sort((a, b) => order[eventStatus(a.ev, now, settings)] - order[eventStatus(b.ev, now, settings)] || Date.parse(a.ev.start) - Date.parse(b.ev.start))
  const openEv = sh.events.find((e) => e.id === openId)
  const formEv = sh.events.find((e) => e.id === formFor)
  const myCount = signedIn ? sh.events.filter((ev) => myRequest(sh, ev.id, me.id)).length : 0
  const close = () => { setOpenId(null); if (query.id) window.history.replaceState(null, '', '#/events') }
  return (
    <div>
      <PageHeader back title="Campus events" subtitle={`Open an event to see the details and send a registration request. The organiser approves or rejects it, and you're notified either way.`} />
      <div className="mb-4"><Segmented label="Event filter" value={view} onChange={setView} options={[...(signedIn ? [{ value: 'foryou', label: `For you (${sugg.length})` }] : []), { value: 'all', label: 'All events' }, { value: 'open', label: 'Registration open' }, ...(signedIn && me.role !== 'organiser' ? [{ value: 'mine', label: `My requests (${myCount})` }] : [])]} /></div>
      {view === 'foryou' && !(me?.interests || []).length && <p className="mb-3 rounded-xl bg-sand px-3 py-2 text-sm">Add interests in your <a href="#/profile" className="font-semibold text-maroon">profile</a> to get suggestions.</p>}
      <div className="stagger grid gap-3 md:grid-cols-2">
        {list.length ? list.map(({ ev, matched }) => {
          const st = eventStatus(ev, now, settings)
          const mine = signedIn ? myRequest(sh, ev.id, me.id) : null
          const c = regCounts(sh, ev.id)
          return (
            <Card key={ev.id} interactive className={cx('flex flex-col !p-0 overflow-hidden', st === EVENT_STATUS.ENDED && 'opacity-70')}>
              <button onClick={() => setOpenId(ev.id)} className="flex gap-3.5 p-4 pb-3 text-left" aria-label={`Open details for ${ev.title}`}>
                <DateChip iso={ev.start} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5"><Badge tone={TONE[st]}>{st === EVENT_STATUS.LIVE && <span className="mr-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}{st}</Badge>{matched.length > 0 && <Badge tone="info" icon="star">Matches {matched.join(', ')}</Badge>}<DemoTag show={ev.demo} /></div>
                  <h3 className="mt-1.5 text-[16px] font-semibold leading-snug">{ev.title}</h3>
                  <p className="line-clamp-2 text-[13.5px] text-muted">{ev.description}</p>
                </div>
              </button>
              <dl className="flex flex-col gap-1 px-4 text-[13px] text-[#3B4048]">
                <div className="flex items-center gap-2"><Icon name="clock" size={15} className="text-muted" />{timeRange(ev)}</div>
                <div className="flex items-center gap-2"><Icon name="pin" size={15} className="text-muted" />{ev.place.label} <a className="font-semibold text-maroon hover:underline" href={venueHref(ev.place)}>Route</a></div>
                {ev.capacity && <div className="flex items-center gap-2"><Icon name="user" size={15} className="text-muted" />{c.approved}/{ev.capacity} approved{c.pending ? ` · ${c.pending} pending` : ''}<span className="ml-1 h-1.5 w-20 overflow-hidden rounded-full bg-sand"><span className="bar-in block h-full rounded-full bg-maroon/70" style={{ width: `${Math.min(100, (c.approved / ev.capacity) * 100)}%` }} /></span></div>}
              </dl>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line bg-ground/50 px-4 py-2.5 [margin-top:12px]">
                {mine ? <Badge tone={REG_TONE[regStatus(mine)]} icon={regStatus(mine) === REG.APPROVED ? 'check' : undefined}>{regStatus(mine) === REG.APPROVED ? "You're registered" : regStatus(mine)}</Badge> : <span className="text-[12.5px] text-muted">{st === EVENT_STATUS.OPEN ? 'Requests open' : 'Requests closed'}</span>}
                <Button size="sm" variant="secondary" onClick={() => setOpenId(ev.id)}>View details</Button>
              </div>
            </Card>
          )
        }) : <div className="md:col-span-2"><Empty icon="calendar" title={view === 'foryou' ? 'No events match your interests yet' : view === 'mine' ? 'No requests yet' : 'No events here'}>Check “All events”.</Empty></div>}
      </div>
      <Dialog open={!!openEv} onClose={close} title={openEv?.title || 'Event'} wide>
        {openEv && <EventDetails ev={openEv} chat={query.chat && query.id === openEv.id} onRequest={() => setFormFor(openEv.id)} onWithdraw={(r) => runShared((s) => withdrawRequest(s, r.id, me, new Date()), 'Request withdrawn.')} />}
      </Dialog>
      <Dialog open={!!formEv} onClose={() => setFormFor(null)} title={formEv ? `Request to register · ${formEv.title}` : ''}>
        {formEv && <RegistrationForm ev={formEv} onDone={() => setFormFor(null)} />}
      </Dialog>
    </div>
  )
}

const DateChip = ({ iso }) => (
  <span className="flex h-14 w-12 flex-none flex-col items-center justify-center rounded-lg border border-line bg-ground/60 leading-none"><b className="text-[10.5px] font-semibold uppercase tracking-wider text-maroon">{new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, month: 'short' }).format(new Date(iso))}</b><b className="mt-1 font-display text-[20px] font-semibold">{new Intl.DateTimeFormat('en-IN', { timeZone: CAMPUS_TIMEZONE, day: 'numeric' }).format(new Date(iso))}</b></span>
)

function EventDetails({ ev, onRequest, onWithdraw, chat }) {
  const { db, me, now, signedIn } = useApp()
  const [chatOpen, setChatOpen] = useState(!!chat)
  const sh = db.shared
  const st = eventStatus(ev, now, settings)
  const c = regCounts(sh, ev.id)
  const mine = signedIn ? myRequest(sh, ev.id, me.id) : null
  const can = canRequest(sh, ev, signedIn ? me : null, now, settings)
  const p = place(ev.place.f, ev.place.id)
  const rows = [
    ['clock', 'When', timeRange(ev)],
    ['pin', 'Venue', <>{ev.place.label}{p && !/floor/i.test(ev.place.label) ? ` · ${floorName(ev.place.f)}` : ''} <a className="font-semibold text-maroon hover:underline" href={venueHref(ev.place)}>Open in 3D campus</a></>],
    ['calendar', 'Requests close', ev.regCloses ? formatEventTime(ev.regCloses, CAMPUS_TIMEZONE) : 'When the event starts'],
    ['user', 'Capacity', ev.capacity ? `${c.approved} of ${ev.capacity} places approved · ${c.pending} pending${c.waitlisted ? ` · ${c.waitlisted} waitlisted` : ''}` : `No limit · ${c.approved} approved`],
    ['shield', 'Organiser', ev.organiserName || 'Not listed'],
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5"><Badge tone={TONE[st]}>{st}</Badge><DemoTag show={ev.demo} /></div>
      <p className="text-[14.5px] leading-relaxed text-[#3B4048]">{ev.description}</p>
      {ev.note && <p className="rounded-lg bg-[#FDF8EC] px-3 py-2 text-[13.5px]"><b>Update:</b> {ev.note}</p>}
      <dl className="grid gap-2 rounded-xl border border-line p-3 text-[13.5px]">
        {rows.map(([ic, k, v]) => <div key={k} className="flex gap-2.5"><Icon name={ic} size={16} className="mt-0.5 flex-none text-muted" /><dt className="w-[118px] flex-none text-muted">{k}</dt><dd className="min-w-0 flex-1">{v}</dd></div>)}
      </dl>
      {mine && (
        <div className="rounded-xl border border-line bg-ground/60 p-3 text-[13.5px]">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2">Your request: <Badge tone={REG_TONE[regStatus(mine)]}>{regStatus(mine)}</Badge></span>
            {[REG.PENDING, REG.APPROVED, REG.WAITLISTED].includes(regStatus(mine)) && <Button size="sm" variant="secondary" onClick={() => onWithdraw(mine)}>Withdraw request</Button>}</div>
          <p className="mt-1.5 text-muted">{regStatus(mine) === REG.PENDING ? 'Waiting for the organiser to review it.' : regStatus(mine) === REG.APPROVED ? "Approved — you're registered." : regStatus(mine) === REG.WAITLISTED ? "You're on the waitlist. You'll be notified if a place opens." : regStatus(mine) === REG.REJECTED ? `Not approved.${mine.reason ? ' Reason: ' + mine.reason : ''}` : 'You withdrew this request.'}</p>
        </div>
      )}
      <div className="flex justify-end">
        {!signedIn ? <a href="#/login" className="font-semibold text-maroon">Sign in to request a place</a>
          : can.ok ? <Button icon="send" onClick={onRequest}>{can.full ? 'Join the waitlist' : 'Request to register'}</Button>
          : !mine && <span className="text-sm text-muted">{can.reason}</span>}
      </div>
      {signedIn && isStudent(me) && (chatOpen ? <EventChat ev={ev} studentId={me.id} studentName={me.name} />
        : <Button variant="secondary" icon="send" onClick={() => setChatOpen(true)}>Message the organiser</Button>)}
    </div>
  )
}

function RegistrationForm({ ev, onDone }) {
  const { me, runShared } = useApp()
  const cfg = ev.form || {}
  const [f, setF] = useState({ name: me.name || '', classId: me.classId || '', email: me.email || '', phone: me.phone ? me.phone.replace(/^\+91/, '') : '', roll: me.roll || '', teamSize: cfg.teamMax ? '1' : '', answer: '' })
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState('edit')
  const [result, setResult] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const review = (e) => { e.preventDefault(); const errs = validateRegistrationForm(ev, f); setErrors(errs); if (!Object.keys(errs).length) setStep('review') }
  const submit = () => {
    const r = runShared((s) => requestRegistration(s, ev.id, me, f, new Date(), settings))
    if (r.ok) { setResult(r.item); setStep('done') } else { setErrors(r.errors || {}); setStep('edit') }
  }
  if (step === 'done') return (
    <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[#E7F4EC] text-ok"><Icon name="check" size={24} stroke={2.4} /></span>
      <b className="text-[16px]">{result.status === REG.WAITLISTED ? 'Added to the waitlist' : 'Request submitted'}</b>
      <p className="text-[14px] text-muted">{result.status === REG.WAITLISTED ? 'This event is full. Your request is on the waitlist; you’ll be notified if the organiser approves it.' : 'Your registration request has been submitted. You’ll be notified when the event organiser reviews it.'}</p>
      <Button onClick={onDone}>Done</Button>
    </div>
  )
  if (step === 'review') {
    const rows = [['Full name', f.name], ['Class', CLASS_LABEL[f.classId] || f.classId], ['Email', f.email || '—'], ['Phone', f.phone || '—'], ...(cfg.roll || f.roll ? [['Roll number', f.roll || '—']] : []), ...(cfg.teamMax ? [['Team size', f.teamSize]] : []), ...(cfg.question ? [[cfg.question, f.answer || '—']] : [])]
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[14px] text-muted">Check your details. Nothing is sent until you press <b>Submit request</b>.</p>
        <dl className="divide-y divide-line rounded-xl border border-line text-[14px]">{rows.map(([k, v]) => <div key={k} className="flex gap-3 px-3 py-2"><dt className="w-[130px] flex-none text-muted">{k}</dt><dd className="min-w-0 flex-1 break-words font-medium">{v}</dd></div>)}</dl>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setStep('edit')}>Edit</Button><Button icon="send" onClick={submit}>Submit request</Button></div>
      </div>
    )
  }
  return (
    <form onSubmit={review} noValidate className="flex flex-col gap-3">
      <p className="text-[13.5px] text-muted">Filled in from your profile where possible. Give an email or a phone number (or both).</p>
      <Field label="Full name" error={errors.name}>{(id) => <input id={id} className={inputCls} value={f.name} onChange={set('name')} autoComplete="name" />}</Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Class / division" error={errors.classId}>{(id) => <select id={id} className={inputCls} value={f.classId} onChange={set('classId')}><option value="">Choose…</option>{[...CLASSES, 'SE-A'].map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</select>}</Field>
        <Field label={cfg.roll ? 'Roll number' : 'Roll number (optional)'} error={errors.roll}>{(id) => <input id={id} className={inputCls} value={f.roll} onChange={set('roll')} />}</Field>
        <Field label="College email" error={errors.email}>{(id) => <input id={id} type="email" className={inputCls} value={f.email} onChange={set('email')} autoComplete="email" />}</Field>
        <Field label="Phone" error={errors.phone} hint="10-digit mobile">{(id) => <input id={id} inputMode="tel" className={inputCls} value={f.phone} onChange={set('phone')} autoComplete="tel" />}</Field>
      </div>
      {cfg.teamMax && <Field label={`Team size (1–${cfg.teamMax})`} error={errors.teamSize}>{(id) => <input id={id} inputMode="numeric" className={inputCls} value={f.teamSize} onChange={set('teamSize')} />}</Field>}
      {cfg.question && <Field label={cfg.question + (cfg.questionRequired ? '' : ' (optional)')} error={errors.answer}>{(id) => <textarea id={id} rows={2} className={cx(inputCls, 'py-2')} value={f.answer} onChange={set('answer')} />}</Field>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit">Review request</Button></div>
    </form>
  )
}
