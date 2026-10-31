// Academic workflow screens (college server): syllabus banner, assignments with hand-in, the academic calendar,
// important dates, event details with registration, the unified publisher (teachers, HODs, sports/cultural
// incharges), the published-items list with submissions, and class-role management (CR positions, SI, CI).
// The server checks every action again; these screens only offer what it allows.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Card, CardTitle, Button, Badge, Empty, Segmented, Field, inputCls, relTime, fmtDateTime, cx, Dialog, ConfirmButton, Spinner } from './ui.jsx'
import Icon from './Icon.jsx'
import { api, downloadFile, fileToBase64, MAX_UPLOAD, UPLOAD_TYPES, fmtBytes } from '../lib/portal.js'
import { useLoad, Loading, useCatalog } from './CloudPortal.jsx'
import { addDays, monthGrid, weekDays, weekStart, monthStart, addMonths, fmtDay, typeOf, groupByDate, upcoming, daysBetween } from '../lib/calendar.js'
import bannerImg from '../assets/campus-banner.jpg'

const Link = ({ href, children, ...p }) => <a href={href} {...p} className="text-[13px] font-semibold text-maroon underline-offset-2 hover:underline max-lg:inline-flex max-lg:min-h-[36px] max-lg:items-center">{children}</a>
// Phone month view: one solid dot per item type (the text labels are in the day list and the key below).
const DOT = { assignment: '#B26B00', deadline: '#B26B00', exam: '#B42318', ca: '#B42318', assessment: '#B42318', tutorial: '#2457C5', practical: '#2457C5', event: '#1E7A4C', registration: '#6A4C93', reminder: '#5F6F66', date: '#5F6F66' }
export const KIND_LABEL = { assignment: 'Assignment', notice: 'Academic notice', exam: 'Exam', ca: 'CA', tutorial: 'Tutorial', practical: 'Practical', material: 'Study material', announcement: 'Class announcement', other: 'Other', sports: 'Sports update', cultural: 'Cultural update' }
const STAFF_KINDS = ['assignment', 'notice', 'exam', 'ca', 'tutorial', 'practical', 'material', 'announcement', 'other', 'sports', 'cultural']
const DATED = ['exam', 'ca', 'tutorial', 'practical']
const NEEDS_SUBJECT = ['assignment', 'exam', 'ca', 'tutorial', 'practical', 'material']
const STATUS_TONE = { published: 'ok', draft: 'neutral', archived: 'neutral', cancelled: 'bad' }
/** A date-time typed on campus means campus time (IST), whatever the browser's time zone. */
export const istToIso = (v) => (v ? new Date(Date.parse(`${v}:00+05:30`)).toISOString() : null)
export const isoToIst = (iso) => (iso ? new Date(Date.parse(iso) + 5.5 * 3600000).toISOString().slice(0, 16) : '')
const busy2 = (setBusy, fn) => async (...a) => { setBusy(true); try { return await fn(...a) } finally { setBusy(false) } }

/* ============================== 1. syllabus banner ============================== */
export function SyllabusBanner({ syllabus, branch, live, loading }) {
  const url = syllabus?.url
  return (
    <section aria-label="Syllabus" className="relative overflow-hidden rounded-xl border border-line bg-ink text-white">
      <img src={syllabus?.image || bannerImg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />
      <div className="relative flex flex-wrap items-end justify-between gap-3 bg-gradient-to-r from-black/70 via-black/45 to-transparent px-4 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-white/80">{branch ? `${branch} syllabus` : 'Syllabus'}</p>
          <h2 className="font-display text-[20px] font-semibold leading-tight">{syllabus?.label || 'Your syllabus and course plan'}</h2>
          {!url && <p className="mt-1 max-w-xl text-[13px] text-white/85">{loading ? 'Loading…' : !live ? 'Demo: the college sets the real syllabus link.' : 'Your HOD hasn’t added the syllabus link for your branch yet.'}</p>}
        </div>
        {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-white px-4 text-[14px] font-semibold text-ink hover:bg-[#F3F0EA]">Open syllabus<Icon name="download" size={15} /></a> : null}
      </div>
    </section>
  )
}

/* ============================== 2. assignments (beside the timetable) ============================== */
export function AssignmentsCard({ live, items, loading, error, demoTasks = [], now, onChanged }) {
  const [open, setOpen] = useState(null)
  const close = useCallback(() => setOpen(null), [])
  const changed = useCallback(() => { setOpen(null); onChanged && onChanged() }, [onChanged])
  const list = live ? items || [] : demoTasks.filter((t) => t.kind === 'assignment')
  return (
    <Card>
      <CardTitle action={<Link href={live ? '#/portal?tab=work' : '#/classwork'}>All assignments</Link>}>Assignments</CardTitle>
      {live && loading && !items ? <Spinner label="Loading assignments" /> : live && error ? <p role="alert" className="text-[13.5px] text-bad">{error}</p> : list.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {list.slice(0, 6).map((a) => {
            const due = live ? a.due_at : a.due
            const overdue = due && Date.parse(due) < now
            const status = live ? (a.status === 'cancelled' ? ['Cancelled', 'bad'] : a.submission ? [a.submission.late ? 'Submitted late' : 'Submitted', 'ok'] : overdue ? ['Overdue', 'bad'] : due && Date.parse(due) - now < 36 * 3600000 ? ['Due soon', 'warn'] : ['To do', 'neutral'])
              : [a.submission || 'Not submitted', a.submission === 'Not submitted' ? (overdue ? 'bad' : 'warn') : 'ok']
            return (
              <li key={a.id} className="flex items-center gap-3 py-2.5 max-sm:flex-wrap max-sm:gap-x-2 max-sm:gap-y-1.5">
                <span className="min-w-0 flex-1 max-sm:basis-full">
                  <b className={cx('block truncate text-[14px] font-semibold', a.status === 'cancelled' && 'line-through')}>{a.title}</b>
                  <small className="text-[12.5px] text-muted">{[a.subject, due ? `due ${fmtDateTime(due)}` : 'no deadline'].filter(Boolean).join(' · ')}</small>
                </span>
                <Badge tone={status[1]}>{status[0]}</Badge>{a.demo && <Badge tone="demo">Sample</Badge>}
                <span className="hidden max-sm:block max-sm:flex-1" aria-hidden="true" />
                {live ? <Button size="sm" variant="secondary" onClick={() => setOpen(a)}>{a.submission ? 'Open' : 'Open / submit'}</Button> : <a href={a.href} className="press inline-flex min-h-[34px] items-center rounded-lg border border-line2 px-3 text-[13px] font-semibold hover:border-maroon">Open</a>}
              </li>)
          })}
        </ul>
      ) : <Empty icon="book" title="No assignments">{live ? 'Nothing has been set for your class. Teachers publish assignments here.' : 'No sample assignments.'}</Empty>}
      {open && <AssignmentDialog a={open} onClose={close} onChanged={changed} />}
    </Card>
  )
}
export function AssignmentDialog({ a, onClose, onChanged }) {
  const { pushToast } = useApp()
  const [note, setNote] = useState(a.submission?.note || '')
  const [file, setFile] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const closed = a.status === 'cancelled'
  const pastDue = a.due_at && Date.parse(a.due_at) < Date.now()
  const submit = busy2(setBusy, async () => {
    setErr('')
    if (!note.trim() && !file) return setErr('Add a file or a note to hand in.')
    if (file && file.size > MAX_UPLOAD) return setErr('Files can be up to 3 MB.')
    if (file && !UPLOAD_TYPES[file.type]) return setErr('Allowed files: PDF, Word, PowerPoint, Excel, PNG, JPG or text.')
    try {
      const r = await api('submissions', { method: 'POST', body: { postId: a.id, note: note.trim(), file: file ? { name: file.name, mime: file.type, dataBase64: await fileToBase64(file) } : undefined } })
      pushToast(r.submission.late ? 'Handed in after the deadline. Your teacher sees it as late.' : 'Handed in.'); onChanged()
    } catch (x) { setErr(x.message) }
  })
  const withdraw = busy2(setBusy, async () => { try { await api('submissions', { method: 'DELETE', query: { postId: a.id } }); pushToast('Hand-in withdrawn.'); onChanged() } catch (x) { setErr(x.message) } })
  return (
    <Dialog open onClose={onClose} title={a.title} wide>
      <p className="text-[13px] text-muted">{[a.subject, a.author_name && `From ${a.author_name}`, a.due_at ? `Deadline ${fmtDateTime(a.due_at)}` : 'No deadline'].filter(Boolean).join(' · ')}</p>
      {closed && <p className="mt-2"><Badge tone="bad">Cancelled by your teacher</Badge></p>}
      {a.body && <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed">{a.body}</p>}
      {a.file_id && <Button className="mt-3" size="sm" variant="secondary" icon="download" onClick={() => downloadFile(a.file_id, a.file_name).catch((x) => setErr(x.message))}>{a.file_name} ({fmtBytes(a.file_size)})</Button>}
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-[14px] font-semibold">Your hand-in</h3>
        {a.submission ? <p className="mt-1 text-[13.5px]"><Badge tone="ok">{a.submission.late ? 'Submitted late' : 'Submitted'}</Badge> {fmtDateTime(a.submission.submittedAt)}{a.submission.fileId ? ' · file attached' : ''}</p> : <p className="mt-1 text-[13.5px] text-muted">Not handed in yet.</p>}
        {!closed && <form className="mt-3 flex flex-col gap-3" noValidate onSubmit={(e) => { e.preventDefault(); submit() }}>
          <Field label="Note (optional)">{(id) => <textarea id={id} maxLength={2000} className={cx(inputCls, 'min-h-[72px] py-2')} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <Field label={a.submission ? 'Replace file (optional)' : 'File (optional)'} hint="PDF, Word, PowerPoint, Excel, PNG, JPG or text, up to 3 MB.">{(id) => <input id={id} type="file" className="text-[13.5px]" accept={Object.keys(UPLOAD_TYPES).join(',')} onChange={(e) => setFile(e.target.files?.[0] || null)} />}</Field>
          {pastDue && !a.submission && <p className="text-[13px] text-warn">The deadline has passed; a hand-in now is marked late.</p>}
          {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
          <div><Button type="submit" disabled={busy}>{busy ? 'Sending…' : a.submission ? 'Hand in again' : 'Hand in'}</Button></div>
        </form>}
        {!closed && a.submission && !pastDue && <div className="mt-2"><ConfirmButton variant="ghost" disabled={busy} confirmText="Withdraw hand-in" onConfirm={withdraw}>Withdraw hand-in</ConfirmButton></div>}
      </div>
    </Dialog>
  )
}

/* ============================== 3. academic calendar ============================== */
/** Loads calendar items from the server for [from, to]. Returns { items, status, message, reload }. */
export function useCalendar(enabled, from, to) {
  const [st, set] = useState({ items: [], status: enabled ? 'loading' : 'off', message: '', empty: null })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled) { set({ items: [], status: 'off', message: '', empty: null }); return }
    let on = true
    set((s) => ({ ...s, status: 'loading' }))
    api('calendar', { query: { from, to } }).then((r) => on && set({ items: r.items, status: 'ready', message: '', empty: r.empty })).catch((e) => on && set({ items: [], status: 'error', message: e.message, empty: null }))
    return () => { on = false }
  }, [enabled, from, to, tick])
  return { ...st, reload: () => setTick((t) => t + 1) }
}
function TypeChip({ type, cancelled, compact }) {
  const t = typeOf(type)
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-[1px] text-[11.5px] font-semibold ring-1 ring-inset', t.cls, cancelled && 'line-through opacity-70')}><span aria-hidden="true">{t.sym}</span>{compact ? t.short : t.label}</span>
}
export function Legend() {
  return <ul aria-label="Calendar key" className="mt-3 flex flex-wrap gap-1.5">{['assignment', 'exam', 'ca', 'tutorial', 'practical', 'event', 'registration', 'reminder'].map((k) => <li key={k}><TypeChip type={k} /></li>)}</ul>
}
/**
 * Month and week views. `items` are { key, type, title, date (YYYY-MM-DD), time?, ... }. `onRange(from, to)` is
 * called when the visible range changes so live data can be loaded for it.
 */
export function AcademicCalendar({ items, status, message, empty, today, onRange, onOpenEvent, demo }) {
  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(today)
  const [picked, setPicked] = useState(today)
  const [detail, setDetail] = useState(null)
  const days = view === 'month' ? monthGrid(cursor) : weekDays(cursor).map((d) => ({ date: d, inMonth: true }))
  const from = days[0].date, to = days[days.length - 1].date
  useEffect(() => { onRange && onRange(from, to) }, [from, to]) // eslint-disable-line
  const byDate = useMemo(() => groupByDate(items || []), [items])
  const step = (n) => { const c = view === 'month' ? addMonths(cursor, n) : addDays(cursor, 7 * n); setCursor(c); setPicked(view === 'month' ? (c.slice(0, 7) === today.slice(0, 7) ? today : monthStart(c)) : weekStart(c)) }
  const title = view === 'month' ? fmtDay(monthStart(cursor), { month: 'long', year: 'numeric' }) : `${fmtDay(from, { day: 'numeric', month: 'short' })} – ${fmtDay(to, { day: 'numeric', month: 'short', year: 'numeric' })}`
  const dayItems = byDate.get(picked) || []
  const onKey = (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (d === undefined) return
    e.preventDefault(); const n = addDays(picked, d); setPicked(n)
    if (n < from || n > to) setCursor(n)
    setTimeout(() => document.querySelector(`[data-cal="${n}"]`)?.focus(), 0)
  }
  return (
    <Card className="lg:col-span-2">
      <CardTitle eyebrow={demo ? 'Sample dates' : 'Teacher-published dates, events and reminders'} action={<Segmented label="Calendar view" value={view} onChange={(v) => { setView(v); setCursor(picked) }} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }]} />}>Academic calendar</CardTitle>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button size="sm" variant="secondary" onClick={() => step(-1)} aria-label={view === 'month' ? 'Previous month' : 'Previous week'}><Icon name="back" size={15} /></Button>
        <h3 className="text-center font-display text-[16px] font-semibold" aria-live="polite">{title}</h3>
        <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => { setCursor(today); setPicked(today) }}>Today</Button><Button size="sm" variant="secondary" onClick={() => step(1)} aria-label={view === 'month' ? 'Next month' : 'Next week'}><Icon name="chev" size={15} /></Button></div>
      </div>
      {status === 'error' && <p role="alert" className="mb-2 text-[13.5px] text-bad">Couldn’t load the calendar: {message}</p>}
      <div role="grid" aria-label={`Calendar, ${title}`} onKeyDown={onKey} className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} role="columnheader" className="bg-ground py-1 text-center text-[11.5px] font-semibold uppercase text-muted">{d}</div>)}
        {days.map(({ date, inMonth }) => {
          const list = byDate.get(date) || []
          const sel = date === picked, isToday = date === today
          return (
            <button key={date} type="button" role="gridcell" data-cal={date} aria-selected={sel} tabIndex={sel ? 0 : -1}
              aria-label={`${fmtDay(date, { weekday: 'long', day: 'numeric', month: 'long' })}${isToday ? ', today' : ''}: ${list.length ? `${list.length} item${list.length > 1 ? 's' : ''}` : 'nothing'}`}
              onClick={() => setPicked(date)}
              className={cx('flex flex-col items-stretch gap-0.5 bg-surface p-1 text-left align-top', view === 'month' ? 'min-h-[52px] sm:min-h-[84px]' : 'min-h-[120px] max-sm:min-h-[72px]', !inMonth && 'bg-ground/60 text-muted', sel && 'outline outline-2 -outline-offset-2 outline-maroon')}>
              <span className={cx('self-start rounded px-1 text-[12px] font-semibold tabular-nums', isToday && 'bg-maroon text-white')}>{Number(date.slice(8))}</span>
              {list.slice(0, view === 'month' ? 2 : 5).map((i) => <span key={i.key} className={cx('hidden truncate rounded px-1 text-[10.5px] font-semibold ring-1 ring-inset sm:block', typeOf(i.type).cls, i.cancelled && 'line-through')}><span aria-hidden="true">{typeOf(i.type).sym} </span>{i.title}</span>)}
              {list.length > 0 && <span className="mt-auto flex flex-wrap items-center gap-[3px] px-0.5 pb-0.5 sm:hidden" aria-hidden="true">{[...new Set(list.map((i) => i.type))].slice(0, 3).map((t) => <i key={t} className="block h-[6px] w-[6px] rounded-full" style={{ background: DOT[t] || DOT.date }} />)}{list.length > 3 && <b className="text-[9.5px] font-semibold leading-none text-muted">+{list.length - 3}</b>}</span>}
              {list.length > (view === 'month' ? 2 : 5) && <span className="hidden text-[10.5px] text-muted sm:block" aria-hidden="true">+{list.length - (view === 'month' ? 2 : 5)} more</span>}
            </button>)
        })}
      </div>
      {status === 'loading' && <p className="mt-2 text-[12.5px] text-muted">Loading dates…</p>}
      <div className="mt-3 rounded-lg bg-ground px-3 py-2.5">
        <h3 className="text-[14px] font-semibold">{fmtDay(picked, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
        {dayItems.length ? <ul className="mt-1 flex flex-col divide-y divide-line">{dayItems.map((i) => (
          <li key={i.key}><button type="button" onClick={() => (i.type === 'event' || i.type === 'registration') && onOpenEvent && !i.demo ? onOpenEvent(i.refId) : setDetail(i)} className="flex w-full items-center gap-2 py-2 text-left hover:bg-surface/60">
            <span className="w-[46px] flex-none font-mono text-[12px] tabular-nums text-muted">{i.time || 'All day'}</span>
            <span className="min-w-0 flex-1"><b className={cx('block truncate text-[14px] font-semibold max-sm:line-clamp-2 max-sm:whitespace-normal', i.cancelled && 'line-through')}>{i.title}</b><small className="block truncate text-[12px] text-muted">{[i.label, i.subject, i.venue, (i.divisions || []).join(', ')].filter(Boolean).join(' · ')}</small></span>
            <TypeChip type={i.type} cancelled={i.cancelled} compact />{i.cancelled && <Badge tone="bad">Cancelled</Badge>}{i.demo && <Badge tone="demo">Sample</Badge>}
          </button></li>))}</ul>
          : <p className="mt-1 text-[13px] text-muted">{empty || (status === 'ready' || demo ? 'Nothing on this day.' : '')}</p>}
      </div>
      <Legend />
      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail?.title || ''}>
        {detail && <div className="flex flex-col gap-2 text-[14px]">
          <p><TypeChip type={detail.type} cancelled={detail.cancelled} /> {detail.cancelled && <Badge tone="bad">Cancelled</Badge>}</p>
          <p><b>{fmtDay(detail.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</b>{detail.time ? ` · ${detail.time}` : ''}</p>
          {detail.subject && <p>Subject: {detail.subject}</p>}{detail.venue && <p>Venue: {detail.venue}</p>}
          {(detail.divisions || []).length > 0 && <p>For: {detail.divisions.join(', ')}</p>}
          {detail.body && <p className="whitespace-pre-wrap text-muted">{detail.body}</p>}
          {detail.href && <p><Link href={detail.href}>Open</Link></p>}
        </div>}
      </Dialog>
    </Card>
  )
}

/* ============================== 4. important academic dates ============================== */
export function ImportantDates({ items, status, today, demo, onOpenEvent }) {
  const list = upcoming(items || [], today, { days: 45 })
  return (
    <Card>
      <CardTitle eyebrow="Next 45 days">Important academic dates</CardTitle>
      {status === 'loading' && !items?.length ? <Spinner label="Loading dates" /> : list.length ? (
        <ol className="flex flex-col divide-y divide-line">{list.slice(0, 8).map((i) => {
          const n = daysBetween(today, i.date)
          return (
            <li key={i.key} className="flex items-center gap-3 py-2">
              <span className="w-[52px] flex-none text-center leading-tight"><b className="block font-display text-[18px] tabular-nums">{Number(i.date.slice(8))}</b><small className="text-[11px] font-semibold uppercase text-muted">{fmtDay(i.date, { month: 'short' })}</small></span>
              <span className="min-w-0 flex-1"><b className="block truncate text-[14px] font-semibold max-sm:line-clamp-2 max-sm:whitespace-normal">{i.title}</b><small className="text-[12.5px] text-muted max-sm:leading-snug">{[n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`, i.time, i.subject].filter(Boolean).join(' · ')}</small></span>
              <TypeChip type={i.type} compact />{i.demo && <Badge tone="demo">Sample</Badge>}
              {i.type === 'registration' && onOpenEvent && !i.demo && <Button size="sm" variant="ghost" onClick={() => onOpenEvent(i.refId)}>Details</Button>}
            </li>)
        })}</ol>
      ) : <p className="text-[13.5px] text-muted">{demo ? 'No sample dates.' : 'No assignments, CAs, tutorials, practicals or exams have been published for the next 45 days.'}</p>}
    </Card>
  )
}

/* ============================== 5. event detail + registration ============================== */
export function EventDialog({ id, onClose }) {
  const { pushToast } = useApp()
  const s = useLoad(() => (id ? api('event', { query: { id } }) : Promise.resolve(null)), [id])
  const [busy, setBusy] = useState(false)
  const act = (fn, msg) => busy2(setBusy, async () => { try { await fn(); pushToast(msg); s.reload() } catch (x) { pushToast(x.message, 'bad') } })
  const e = s.data?.event, reg = s.data?.registration
  return (
    <Dialog open={!!id} onClose={onClose} title={e?.title || 'Event'} wide>
      <Loading s={s}>{e && <EventBody e={e} reg={reg} announcements={s.data.announcements} busy={busy}
        onRegister={act(() => api('event-register', { method: 'POST', body: { eventId: e.id } }), 'You are registered.')}
        onCancel={act(() => api('event-register', { method: 'DELETE', query: { eventId: e.id } }), 'Registration cancelled.')} />}</Loading>
    </Dialog>
  )
}
/** Shared by the student view and the organiser preview. */
export function EventBody({ e, reg, announcements = [], busy, onRegister, onCancel, preview }) {
  const layout = e.layout || 'card'
  return (
    <div className="flex flex-col gap-3 text-[14px]">
      {e.poster && layout !== 'announcement' && <img src={e.poster} alt={`Poster for ${e.title}`} className={cx('w-full rounded-lg object-cover', layout === 'banner' ? 'max-h-[180px]' : 'max-h-[320px] object-contain bg-ground')} />}
      {layout === 'announcement' && <p className="rounded-lg bg-[#FDF3E2] px-3 py-2 text-[13.5px] font-semibold text-[#7A4B00]"><Icon name="megaphone" size={14} className="mr-1 inline" />Announcement</p>}
      <p className="flex flex-wrap items-center gap-2">{e.status === 'cancelled' && <Badge tone="bad">Cancelled</Badge>}{e.status === 'draft' && <Badge>Draft preview</Badge>}{e.club_name && <Badge tone="info">{e.club_name}</Badge>}<b>{fmtDateTime(e.starts_at)}</b>{e.ends_at && <span className="text-muted">until {fmtDateTime(e.ends_at)}</span>}</p>
      <p><Icon name="pin" size={14} className="mr-1 inline" />{e.venue || 'Venue not given'}</p>
      {e.description && <p className="whitespace-pre-wrap leading-relaxed">{e.description}</p>}
      {(e.organizer || e.contact) && <p className="text-[13.5px] text-muted">Organised by {e.organizer || e.club_name}{e.contact ? ` · Contact: ${e.contact}` : ''}</p>}
      {((e.audience?.branches || []).length > 0 || (e.audience?.years || []).length > 0) && <p className="text-[13px] text-muted">For: {[(e.audience.branches || []).join(', '), (e.audience.years || []).map((y) => ['FE', 'SE', 'TE', 'BE'][y - 1]).join(', ')].filter(Boolean).join(' · ')}</p>}
      {e.instructions && <div><h3 className="text-[13.5px] font-semibold">Instructions</h3><p className="whitespace-pre-wrap text-[13.5px]">{e.instructions}</p></div>}
      {e.terms && <details><summary className="cursor-pointer text-[13.5px] font-semibold">Terms</summary><p className="mt-1 whitespace-pre-wrap text-[13px] text-muted">{e.terms}</p></details>}
      <div className="border-t border-line pt-3">
        {e.reg_mode === 'link' && e.reg_link ? <a href={e.reg_link} target="_blank" rel="noopener noreferrer" className="press inline-flex min-h-[40px] items-center rounded-lg bg-maroon px-4 font-semibold text-white">Register (opens the organiser’s form)</a>
          : e.reg_mode === 'builtin' ? (preview ? <p className="text-[13.5px]">Registration in Campus360{e.capacity ? ` · ${e.capacity} places` : ''}{e.reg_deadline ? ` · closes ${fmtDateTime(e.reg_deadline)}` : ''}</p>
            : reg?.mine ? <p className="flex flex-wrap items-center gap-2"><Badge tone="ok">You are registered</Badge>{reg.open && <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel registration</Button>}</p>
              : reg?.open && !reg.full ? <p className="flex flex-wrap items-center gap-2"><Button disabled={busy} onClick={onRegister}>Register</Button><span className="text-[13px] text-muted">{e.capacity ? `${Math.max(0, e.capacity - reg.count)} of ${e.capacity} places left` : 'No limit'}{e.reg_deadline ? ` · closes ${fmtDateTime(e.reg_deadline)}` : ''}</span></p>
                : <p><Badge tone="warn">{reg?.full ? 'Full' : 'Registration closed'}</Badge></p>)
            : <p className="text-[13px] text-muted">{e.registration || 'No registration needed.'}</p>}
      </div>
      {announcements.length > 0 && <div className="border-t border-line pt-3"><h3 className="text-[14px] font-semibold">Announcements</h3><ul className="mt-1 flex flex-col gap-2">{announcements.map((a) => <li key={a.id} className="rounded-lg bg-ground px-3 py-2"><b className="block text-[13.5px]">{a.title}</b>{a.body && <p className="whitespace-pre-wrap text-[13px]">{a.body}</p>}<small className="text-[12px] text-muted">{relTime(a.created_at)}</small></li>)}</ul></div>}
    </div>
  )
}

/* ============================== 6. the unified publisher ============================== */
/**
 * Teachers / HODs: every content type to their own classes (Year → Branch → Division, multi-select; only
 * divisions the server lets them post to). SI / CI: sports or cultural updates to their own class only.
 */
export function Publisher({ kinds = STAFF_KINDS, fixedDivision, existing, onDone }) {
  const { pushToast } = useApp()
  const cat = useCatalog()
  const blank = { kind: kinds[0], title: '', body: '', subject: '', divisions: fixedDivision ? [fixedDivision] : [], due: '', eventDate: '', publishAt: '' }
  const [f, setF] = useState(() => existing ? { kind: existing.kind, title: existing.title, body: existing.body || '', subject: existing.subject || '', divisions: existing.divisions || [], due: isoToIst(existing.due_at), eventDate: existing.event_date || '', publishAt: existing.publish_at && Date.parse(existing.publish_at) > Date.now() ? isoToIst(existing.publish_at) : '' } : blank)
  const [file, setFile] = useState(null)
  const [removeFile, setRemoveFile] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = (draft) => busy2(setBusy, async () => {
    setErr('')
    if (f.title.trim().length < 3) return setErr('Give it a title (at least 3 characters).')
    if (NEEDS_SUBJECT.includes(f.kind) && !f.subject.trim()) return setErr('Choose the subject.')
    if (DATED.includes(f.kind) && !f.eventDate) return setErr(`Give the ${KIND_LABEL[f.kind]} date.`)
    if (!f.divisions.length) return setErr('Choose at least one division.')
    if (f.kind === 'material' && !file && !(existing?.file_id && !removeFile)) return setErr('Attach the material file.')
    if (file && file.size > MAX_UPLOAD) return setErr('Files can be up to 3 MB.')
    if (file && !UPLOAD_TYPES[file.type]) return setErr('Allowed files: PDF, Word, PowerPoint, Excel, PNG, JPG or text.')
    try {
      const r = await api('publish', { method: 'POST', body: { id: existing?.id, kind: f.kind, title: f.title.trim(), body: f.body.trim(), subject: f.subject.trim(), divisions: f.divisions, dueAt: istToIso(f.due), eventDate: f.eventDate || null, publishAt: istToIso(f.publishAt), draft: !existing && draft, removeFile, file: file ? { name: file.name, mime: file.type, dataBase64: await fileToBase64(file) } : undefined } })
      pushToast(existing ? 'Changes saved. Students see the update.' : draft ? 'Saved as a draft. Students don’t see it yet.' : f.publishAt ? `Scheduled for ${fmtDateTime(istToIso(f.publishAt))}.` : `Published to ${f.divisions.join(', ')}.`)
      if (!existing) { setF({ ...blank, kind: f.kind, divisions: f.divisions }); setFile(null) }
      onDone && onDone(r.item)
    } catch (x) { setErr(x.message) }
  })
  const student = !!fixedDivision
  return (
    <Card className="max-w-3xl">
      <CardTitle eyebrow={student ? `Your class: ${fixedDivision}` : 'Only your assigned classes'}>{existing ? 'Edit' : 'Publish'}</CardTitle>
      <form className="flex flex-col gap-3" noValidate onSubmit={(e) => { e.preventDefault(); save(false)() }}>
        <fieldset><legend className="mb-1.5 text-[13px] font-medium text-[#3B4048]">What are you publishing?</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup">{kinds.map((k) => <button type="button" role="radio" aria-checked={f.kind === k} key={k} onClick={() => setF({ ...f, kind: k })} className={cx('press min-h-[36px] rounded-lg px-3 text-[13px] font-semibold ring-1', f.kind === k ? 'bg-brand text-white ring-brand' : 'bg-surface ring-line')}>{KIND_LABEL[k]}</button>)}</div></fieldset>
        <Field label="Title">{(id) => <input id={id} className={inputCls} maxLength={140} value={f.title} onChange={set('title')} />}</Field>
        <Field label="Description (optional)">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[90px] py-2')} maxLength={4000} value={f.body} onChange={set('body')} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {!student && <Field label={NEEDS_SUBJECT.includes(f.kind) ? 'Subject' : 'Subject (optional)'}>{(id) => <input id={id} className={inputCls} maxLength={80} value={f.subject} onChange={set('subject')} list="pub-subjects" />}</Field>}
          {DATED.includes(f.kind) || f.kind === 'notice' || f.kind === 'other' || student ? <Field label={DATED.includes(f.kind) ? `${KIND_LABEL[f.kind]} date` : 'Date (optional)'}>{(id) => <input id={id} type="date" className={inputCls} value={f.eventDate} onChange={set('eventDate')} />}</Field> : null}
          {['assignment', 'notice', 'other', 'tutorial', 'practical'].includes(f.kind) && <Field label="Deadline (optional, campus time)">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.due} onChange={set('due')} />}</Field>}
          {!existing || f.publishAt ? <Field label="Publish later (optional)" hint="Leave empty to publish now.">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.publishAt} onChange={set('publishAt')} />}</Field> : null}
        </div>
        {!student && <Field label="Attachment (optional)" hint={existing?.file_id && !removeFile ? `Current: ${existing.file_name}` : 'PDF, Word, PowerPoint, Excel, PNG, JPG or text, up to 3 MB.'}>{(id) => <input id={id} type="file" className="text-[13.5px]" accept={Object.keys(UPLOAD_TYPES).join(',')} onChange={(e) => setFile(e.target.files?.[0] || null)} />}</Field>}
        {existing?.file_id && !file && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={removeFile} onChange={(e) => setRemoveFile(e.target.checked)} />Remove the current attachment</label>}
        {!student && <fieldset className="rounded-lg border border-line p-3"><legend className="px-1 text-[13px] font-medium text-[#3B4048]">Audience</legend>
          <Loading s={cat}>{cat.data && <AudienceSelect catalog={cat.data} value={f.divisions} onChange={(divisions) => setF({ ...f, divisions })} />}</Loading></fieldset>}
        {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save changes' : f.publishAt ? 'Schedule' : 'Publish'}</Button>
          {!existing && !student && <Button type="button" variant="secondary" disabled={busy} onClick={save(true)}>Save as draft</Button>}
          {existing && <Button type="button" variant="ghost" onClick={() => onDone && onDone(null)}>Cancel</Button>}
        </div>
        <p className="text-[12.5px] text-muted">Students of the chosen divisions see it on their Overview, assignments and calendar. Edits and cancellations reach them too. Nothing goes college-wide.</p>
      </form>
    </Card>
  )
}
/** Year → Branch → Division (multi-select). Only divisions this account may post to are offered. */
export function AudienceSelect({ catalog, value, onChange, perm = 'post' }) {
  const { years = [], branches = [], divisions = [] } = catalog
  const mine = divisions.filter((d) => d.can?.[perm])
  const yearsMine = years.filter((y) => mine.some((d) => d.year_id === y.id))
  const [year, setYear] = useState(yearsMine[0]?.id || '')
  const branchesMine = branches.filter((b) => mine.some((d) => d.year_id === year && d.branch_code === b.code))
  const [branch, setBranch] = useState(branchesMine[0]?.code || '')
  useEffect(() => { if (!branchesMine.some((b) => b.code === branch)) setBranch(branchesMine[0]?.code || '') }, [year]) // eslint-disable-line
  if (!mine.length) return <p className="text-[13.5px] text-muted">No divisions are assigned to you yet. Your HOD assigns teachers to divisions.</p>
  const list = mine.filter((d) => d.year_id === year && d.branch_code === branch)
  const toggle = (c) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c])
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Year">{(id) => <select id={id} className={inputCls} value={year} onChange={(e) => setYear(e.target.value)}>{yearsMine.map((y) => <option key={y.id} value={y.id}>{y.label} {y.calendar}</option>)}</select>}</Field>
        <Field label="Branch">{(id) => <select id={id} className={inputCls} value={branch} onChange={(e) => setBranch(e.target.value)}>{branchesMine.map((b) => <option key={b.code} value={b.code}>{b.name} ({b.code})</option>)}</select>}</Field>
      </div>
      <div role="group" aria-label="Divisions" className="flex flex-wrap gap-2">
        {list.map((d) => <button type="button" key={d.code} aria-pressed={value.includes(d.code)} onClick={() => toggle(d.code)} className={cx('press min-h-[36px] rounded-lg px-3 text-[13px] font-semibold ring-1', value.includes(d.code) ? 'bg-brand text-white ring-brand' : 'bg-surface ring-line')}>{d.code}</button>)}
        {list.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...new Set([...value, ...list.map((d) => d.code)])])}>All here</Button>}
        {mine.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(mine.map((d) => d.code))}>All my classes ({mine.length})</Button>}
        {value.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>Clear</Button>}
      </div>
      <p className="text-[12.5px] text-muted">{value.length ? <>Selected: {value.map((c) => <Badge key={c} tone="info" className="mr-1">{c}</Badge>)}</> : 'No division selected.'}</p>
    </div>
  )
}

/* ============================== 7. published items + submissions ============================== */
export function PublishedList({ branch = false }) {
  const { pushToast } = useApp()
  const [status, setStatus] = useState('')
  const s = useLoad(() => api('published', { query: { status, scope: branch ? 'branch' : undefined } }), [status, branch])
  const [edit, setEdit] = useState(null)
  const [subs, setSubs] = useState(null)
  const change = async (id, to) => { try { await api('publish-status', { method: 'POST', body: { id, status: to } }); pushToast({ published: 'Published.', archived: 'Archived. Students no longer see it.', cancelled: 'Marked as cancelled. Students see it as cancelled.' }[to]); s.reload() } catch (x) { pushToast(x.message, 'bad') } }
  if (edit) return <Publisher existing={edit} onDone={() => { setEdit(null); s.reload() }} />
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto"><Segmented label="Filter by status" value={status} onChange={setStatus} options={[{ value: '', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'archived', label: 'Archived' }]} /></div>
      <Loading s={s}>{s.data && (s.data.items.length ? (
        <ul className="flex flex-col gap-2">{s.data.items.map((p) => {
          const scheduled = p.status === 'published' && p.publish_at && Date.parse(p.publish_at) > Date.now()
          return (
            <li key={p.id}><Card className="!p-3.5">
              <div className="flex flex-wrap items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5"><Badge tone="info">{KIND_LABEL[p.kind] || p.kind}</Badge><Badge tone={STATUS_TONE[p.status]}>{scheduled ? `Scheduled ${fmtDateTime(p.publish_at)}` : p.status}</Badge>{(p.divisions || []).map((d) => <Badge key={d}>{d}</Badge>)}</span>
                  <b className="mt-1 block text-[14.5px]">{p.title}</b>
                  <small className="text-[12.5px] text-muted">{[p.subject, p.due_at && `deadline ${fmtDateTime(p.due_at)}`, p.event_date && `date ${fmtDay(p.event_date, { day: 'numeric', month: 'short', year: 'numeric' })}`, branch && p.author_name, `created ${relTime(p.created_at)}`].filter(Boolean).join(' · ')}</small>
                  {p.kind === 'assignment' && p.status !== 'draft' && <small className="block text-[12.5px]">Handed in: <b>{p.submitted}</b> of {p.class_size}</small>}
                </span>
                {p.mine !== false && <div className="flex flex-wrap gap-1.5">
                  {p.kind === 'assignment' && p.status !== 'draft' && <Button size="sm" variant="secondary" onClick={() => setSubs(p)}>Submissions</Button>}
                  {p.status !== 'archived' && <Button size="sm" variant="secondary" onClick={() => setEdit(p)}>Edit</Button>}
                  {(p.status === 'draft' || p.status === 'archived' || p.status === 'cancelled') && <Button size="sm" onClick={() => change(p.id, 'published')}>{p.status === 'draft' ? 'Publish' : 'Restore'}</Button>}
                  {p.status === 'published' && <ConfirmButton size="sm" variant="danger" confirmText="Mark cancelled" onConfirm={() => change(p.id, 'cancelled')}>Cancel</ConfirmButton>}
                  {p.status !== 'archived' && <ConfirmButton size="sm" variant="ghost" confirmText="Archive" onConfirm={() => change(p.id, 'archived')}>Archive</ConfirmButton>}
                </div>}
              </div>
            </Card></li>)
        })}</ul>) : <Empty icon="send" title="Nothing here yet">Items you publish appear here with their status.</Empty>)}</Loading>
      {subs && <SubmissionsDialog post={subs} onClose={() => setSubs(null)} />}
    </div>
  )
}
const SUB_STATE = { on_time: ['Handed in', 'ok'], late: ['Late', 'warn'], missing: ['Missing', 'bad'], not_yet: ['Not yet', 'neutral'] }
function SubmissionsDialog({ post, onClose }) {
  const s = useLoad(() => api('submissions', { query: { postId: post.id } }), [post.id])
  const [err, setErr] = useState('')
  return (
    <Dialog open onClose={onClose} title={`Submissions: ${post.title}`} wide>
      <Loading s={s}>{s.data && <>
        <p className="mb-2 text-[13.5px]">{s.data.counts.submitted} of {s.data.counts.total} handed in{s.data.assignment.dueAt ? ` · deadline ${fmtDateTime(s.data.assignment.dueAt)}` : ''}</p>
        {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-[13.5px]"><thead className="text-muted"><tr>{['Roll', 'Name', 'Division', 'Status', 'Handed in', ''].map((h) => <th key={h} className="py-1.5 pr-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>{s.data.students.map((x) => <tr key={x.student_id} className="border-t border-line"><td className="py-1.5 pr-3">{x.roll || '—'}</td><td className="pr-3">{x.name || '—'}</td><td className="pr-3">{x.division_code}</td><td className="pr-3"><Badge tone={SUB_STATE[x.state][1]}>{SUB_STATE[x.state][0]}</Badge></td><td className="pr-3">{x.submitted_at ? fmtDateTime(x.submitted_at) : ''}{x.note ? <small className="block text-muted">“{x.note.slice(0, 80)}”</small> : null}</td>
            <td>{x.file_id && <Button size="sm" variant="ghost" icon="download" onClick={() => downloadFile(x.file_id, x.file_name).catch((e) => setErr(e.message))}>File</Button>}</td></tr>)}</tbody></table></div>
      </>}</Loading>
    </Dialog>
  )
}

/* ============================== 8. class roles (teacher / HOD) ============================== */
const ROLE = { cr: 'Class representative', si: 'Sports incharge', ci: 'Cultural incharge' }
export function ClassRoles() {
  const { pushToast, refreshAccount } = useApp()
  const cat = useCatalog()
  const mine = (cat.data?.divisions || []).filter((d) => d.can?.post) // class teachers and the branch HOD
  const [division, setDivision] = useState('')
  const div = division || mine[0]?.code || ''
  const s = useLoad(() => (div ? api('class-roles', { query: { division: div } }) : Promise.resolve(null)), [div])
  const roster = useLoad(() => (div ? api('roster', { query: { division: div } }) : Promise.resolve(null)), [div])
  const [busy, setBusy] = useState(false)
  const [assign, setAssign] = useState({ role: 'cr', position: 'male', studentId: '' })
  const run = (fn, msg) => busy2(setBusy, async () => { try { await fn(); pushToast(msg); s.reload(); roster.reload(); refreshAccount() } catch (x) { pushToast(x.message, 'bad') } })
  const [pos, setPos] = useState({})
  if (cat.loading && !cat.data) return <Spinner label="Loading" />
  if (!mine.length) return <Empty icon="user" title="No classes assigned">Class roles are managed by the class teacher or the HOD.</Empty>
  const d = s.data
  const holder = (role, position) => role === 'cr' ? d?.crs.find((c) => c.position === position) : d?.others.find((c) => c.role === role)
  return (
    <div className="flex flex-col gap-4">
      <Field label="Class">{(id) => <select id={id} className={cx(inputCls, 'max-w-xs')} value={div} onChange={(e) => setDivision(e.target.value)}>{mine.map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}</select>}</Field>
      <Loading s={s}>{d && <>
        <Card>
          <CardTitle eyebrow={div}>Current roles</CardTitle>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[['cr', 'male', 'Male CR'], ['cr', 'female', 'Female CR'], ['si', null, ROLE.si], ['ci', null, ROLE.ci]].map(([role, position, label]) => { const h = holder(role, position); return (
              <li key={label} className="flex items-center gap-2 rounded-lg bg-ground px-3 py-2">
                <span className="min-w-0 flex-1"><small className="block text-[12px] font-semibold uppercase text-muted">{label}</small><b className="text-[14px]">{h ? `${h.name || 'Student'}${h.roll ? ` (${h.roll})` : ''}` : 'Vacant'}</b></span>
                {h && <ConfirmButton size="sm" variant="ghost" disabled={busy} confirmText="Remove" onConfirm={run(() => api('role-remove', { method: 'POST', body: { division: div, studentId: h.student_id, role } }), `${label} removed.`)}>Remove</ConfirmButton>}
              </li>) })}
          </ul>
          {d.crs.some((c) => !c.position) && <p className="mt-2 text-[13px] text-warn">Some class representatives were appointed before positions existed: {d.crs.filter((c) => !c.position).map((c) => c.name).join(', ')}. Appoint them to a position below.</p>}
        </Card>
        <Card>
          <CardTitle>Requests waiting</CardTitle>
          {d.requests.length ? <ul className="flex flex-col divide-y divide-line">{d.requests.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1"><b className="text-[14px]">{q.name || 'Student'}</b>{q.roll && <span className="text-muted"> · {q.roll}</span>}<small className="block text-[12.5px] text-muted">{ROLE[q.role]} · asked {relTime(q.created_at)}</small></span>
              {q.role === 'cr' && <select aria-label="CR position" className={cx(inputCls, 'w-auto')} value={pos[q.id] || ''} onChange={(e) => setPos({ ...pos, [q.id]: e.target.value })}><option value="">Choose position</option><option value="male">Male CR{holder('cr', 'male') ? ' (replace)' : ''}</option><option value="female">Female CR{holder('cr', 'female') ? ' (replace)' : ''}</option></select>}
              <Button size="sm" disabled={busy || (q.role === 'cr' && !pos[q.id])} onClick={run(() => api('role-decision', { method: 'POST', body: { id: q.id, decision: 'approve', position: pos[q.id], replace: q.role === 'cr' ? !!holder('cr', pos[q.id]) : !!holder(q.role) } }), 'Approved.')}>Approve</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={run(() => api('role-decision', { method: 'POST', body: { id: q.id, decision: 'reject' } }), 'Rejected.')}>Reject</Button>
            </li>))}</ul> : <p className="text-[13.5px] text-muted">No requests waiting.</p>}
          <p className="mt-2 text-[12.5px] text-muted">The position (male CR / female CR) is your choice; it is never set from a student’s profile. Approving into a filled position replaces the current holder in one step.</p>
        </Card>
        <Card>
          <CardTitle>Appoint or replace</CardTitle>
          <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); if (assign.studentId) run(() => api('role-assign', { method: 'POST', body: { division: div, ...assign, replace: assign.role === 'cr' ? !!holder('cr', assign.position) : !!holder(assign.role) } }), 'Role updated.')() }}>
            <Field label="Role">{(id) => <select id={id} className={inputCls} value={assign.role} onChange={(e) => setAssign({ ...assign, role: e.target.value })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
            {assign.role === 'cr' && <Field label="Position">{(id) => <select id={id} className={inputCls} value={assign.position} onChange={(e) => setAssign({ ...assign, position: e.target.value })}><option value="male">Male CR</option><option value="female">Female CR</option></select>}</Field>}
            <Field label="Student">{(id) => <select id={id} className={inputCls} value={assign.studentId} onChange={(e) => setAssign({ ...assign, studentId: e.target.value })}><option value="">Choose</option>{(roster.data?.students || []).map((x) => <option key={x.id} value={x.id}>{x.roll ? `${x.roll} · ` : ''}{x.name || 'Student'}</option>)}</select>}</Field>
            <div className="flex items-end"><Button type="submit" disabled={busy || !assign.studentId}>{(assign.role === 'cr' ? holder('cr', assign.position) : holder(assign.role)) ? 'Replace' : 'Appoint'}</Button></div>
          </form>
        </Card>
        <Card>
          <CardTitle>History</CardTitle>
          {d.history.length ? <ul className="flex flex-col gap-1 text-[13px]">{d.history.map((h) => <li key={h.id}><span className="text-muted">{relTime(h.at)}</span> · {h.actor_name || 'Someone'} · {h.action.replace('role.', '')} {h.detail?.role ? ROLE[h.detail.role] : ''}{h.detail?.position ? ` (${h.detail.position})` : ''}</li>)}</ul> : <p className="text-[13.5px] text-muted">No changes yet.</p>}
        </Card>
      </>}</Loading>
    </div>
  )
}

/* ============================== 9. student: everything published for the class ============================== */
export function ClassWork() {
  const [kind, setKind] = useState('')
  const s = useLoad(() => api('class-items', { query: { kinds: kind || undefined } }), [kind])
  const [open, setOpen] = useState(null)
  const close = useCallback(() => setOpen(null), [])
  const changed = useCallback(() => { setOpen(null); s.reload() }, [s.reload]) // eslint-disable-line
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto"><Segmented label="Show" value={kind} onChange={setKind} options={[{ value: '', label: 'Everything' }, { value: 'assignment', label: 'Assignments' }, { value: 'exam,ca,tutorial,practical', label: 'CAs, tutorials, exams' }, { value: 'notice,announcement,other', label: 'Notices' }, { value: 'material', label: 'Material' }, { value: 'sports,cultural', label: 'Sports & cultural' }]} /></div>
      <Loading s={s}>{s.data && (!s.data.division ? <Empty icon="user" title="Not in a class yet">{s.data.message}</Empty> : s.data.items.length ? (
        <ul className="flex flex-col gap-2">{s.data.items.map((p) => (
          <li key={p.id}><Card className="!p-3.5"><div className="flex flex-wrap items-start gap-2">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5"><Badge tone="info">{KIND_LABEL[p.kind] || p.kind}</Badge>{p.status === 'cancelled' && <Badge tone="bad">Cancelled</Badge>}{p.submission && <Badge tone="ok">{p.submission.late ? 'Submitted late' : 'Submitted'}</Badge>}</span>
              <b className={cx('mt-1 block text-[14.5px]', p.status === 'cancelled' && 'line-through')}>{p.title}</b>
              <small className="text-[12.5px] text-muted">{[p.subject, p.event_date && fmtDay(p.event_date, { weekday: 'short', day: 'numeric', month: 'short' }), p.due_at && `deadline ${fmtDateTime(p.due_at)}`, p.author_name && `from ${p.author_name}`].filter(Boolean).join(' · ')}</small>
              {p.body && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13.5px]">{p.body}</p>}
            </span>
            {p.kind === 'assignment' ? <Button size="sm" variant="secondary" onClick={() => setOpen(p)}>{p.submission ? 'Open' : 'Open / submit'}</Button>
              : p.file_id ? <Button size="sm" variant="secondary" icon="download" onClick={() => downloadFile(p.file_id, p.file_name)}>{p.file_name}</Button> : null}
          </div></Card></li>))}</ul>
      ) : <Empty icon="book" title="Nothing here">Nothing of this kind has been published for {s.data.division}.</Empty>)}</Loading>
      {open && <AssignmentDialog a={open} onClose={close} onChanged={changed} />}
    </div>
  )
}

/** SI / CI: sports or cultural updates for their own class only. */
export function ClassRoleTools({ division, si, ci }) {
  const kinds = [...(si ? ['sports'] : []), ...(ci ? ['cultural'] : [])]
  const [n, setN] = useState(0)
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Publisher key={n} kinds={kinds} fixedDivision={division} onDone={() => setN((x) => x + 1)} />
      <div><h2 className="mb-2 font-display text-[17px] font-semibold">Your updates</h2><PublishedList key={n} /></div>
    </div>
  )
}
