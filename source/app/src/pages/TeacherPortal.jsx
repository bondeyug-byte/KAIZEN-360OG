import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Empty, Segmented, Dialog, Field, inputCls, relTime, fmtDateTime, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import AudiencePicker from '../components/AudiencePicker.jsx'
import { FilePicker, ResourceViewer, ReviewList, TeacherChallenges } from './Challenges.jsx'
import AttendanceDesk from './AttendanceDesk.jsx'
import { TimetableSchedule } from './Portal.jsx'
import { KIND, STATUS, SUBST, createPost, updatePost, setPostStatus, sentBy, subsFor, reviewAssignment, allowedDivisions, recipients, isAdmin } from '../lib/posts.js'
import { postChallenge, setChallengeStatus, submissionsFor, SUB } from '../lib/challenges.js'
import { putFile, deleteFile, fmtSize } from '../lib/files.js'
import { allPlaces, floorName } from '../navigator/building.js'
import { DIVISION_TIMETABLE, divisionInfo } from '../data/academics.js'
import { timetableForClass } from '../data/seed.js'

const RES = { types: ['pdf', 'jpg', 'png'], maxMB: 10 }
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const STATUS_TONE = { [STATUS.OPEN]: 'ok', [STATUS.CLOSED]: 'warn', [STATUS.ARCHIVED]: 'neutral', open: 'ok', closed: 'warn', archived: 'neutral' }

/**
 * Teacher portal. Access: role "teacher" (from the admin's allowlist + OTP) or admin. Every action goes through
 * src/lib/posts.js / challenges.js / attendance.js, which re-check the teacher's assigned divisions.
 * Browser-only storage in this build — see README "Multi-user delivery".
 */
export default function TeacherPortal({ query = {} }) {
  const { me } = useApp()
  const [tab, setTab] = useState(query.tab || 'overview')
  useEffect(() => { if (query.tab) setTab(query.tab) }, [query.tab, query.kind])
  if (me?.role !== 'teacher' && !isAdmin(me)) return <div className="py-10"><Empty icon="lock" title="Teacher access only">This portal is for teachers approved by the college admin. Students see their classwork under <a href="#/classwork" className="font-semibold text-maroon">Classwork</a>.</Empty></div>
  return (
    <div>
      <PageHeader title="Teacher portal" subtitle="Send assignments, challenges, notices and documents to exact divisions, review submissions and record attendance." />
      <div className="mb-4 overflow-x-auto"><Segmented label="Teacher section" value={tab} onChange={setTab} options={[{ value: 'overview', label: 'My classes' }, { value: 'compose', label: 'Create & send' }, { value: 'sent', label: 'Sent items' }, { value: 'challenges', label: 'Challenges' }, { value: 'subs', label: 'Submissions' }, { value: 'attendance', label: 'Attendance' }, { value: 'timetable', label: 'Timetable Schedule' }]} /></div>
      {tab === 'overview' && <Overview go={setTab} />}
      {tab === 'compose' && <Compose key={query.kind || 'any'} existing={query.kind ? { kind: query.kind } : undefined} onDone={() => setTab(query.kind === 'challenge' ? 'challenges' : 'sent')} />}
      {tab === 'challenges' && <TeacherChallenges query={query} embedded />}
      {tab === 'sent' && <Sent />}
      {tab === 'subs' && <Submissions initial={query.id} />}
      {tab === 'attendance' && <AttendanceDesk />}
      {tab === 'timetable' && <TimetableTab />}
    </div>
  )
}

function Overview({ go }) {
  const { db, me } = useApp()
  const classes = isAdmin(me) ? [] : me.teaches || []
  const sent = sentBy(db.shared, me)
  const mine = db.shared.challenges.filter((c) => c.createdBy === me.id)
  const pending = sent.reduce((n, p) => n + subsFor(db.shared, p.id).filter((s) => s.status === SUBST.SUBMITTED).length, 0) + mine.reduce((n, c) => n + submissionsFor(db.shared, c.id).filter((s) => s.status === SUB.SUBMITTED).length, 0)
  return (
    <div className="flex flex-col gap-5">
      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Classes', classes.length, 'users'], ['Items sent', sent.length + mine.length, 'send'], ['To review', pending, 'eye'], ['Students reached', recipients(db.profiles, { divisions: allowedDivisions(me) }).length, 'user']].map(([l, v, ic]) => (
          <Card key={l} className="!p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand"><Icon name={ic === 'users' ? 'contact' : ic} size={17} /></span><b className="mt-3 block font-display text-[28px] font-bold leading-none">{String(v).padStart(2, '0')}</b><small className="text-[13px] font-semibold">{l}</small></Card>
        ))}
      </div>
      <Card>
        <CardTitle eyebrow="Assigned by the admin" action={<Button size="sm" icon="plus" onClick={() => go('compose')}>Create & send</Button>}>My classes</CardTitle>
        {classes.length ? <ul className="grid gap-2 md:grid-cols-2">{classes.map((t) => {
          const n = recipients(db.profiles, { divisions: [t.division] }).length
          return <li key={t.division + t.subject} className="flex items-center gap-3 rounded-xl border border-line p-3"><span className="grid h-11 w-14 flex-none place-items-center rounded-lg bg-lime-soft font-mono text-[12px] font-bold text-lime-ink">{t.division}</span><span className="min-w-0 flex-1"><b className="block text-[14px] font-semibold">{t.subject}</b><small className="text-[12.5px] text-muted">{divisionInfo(t.division)?.label} · {n} student{n === 1 ? '' : 's'}</small></span><Button size="sm" variant="secondary" onClick={() => go('attendance')}>Attendance</Button></li>
        })}</ul> : <Empty icon="contact" title={isAdmin(me) ? 'Admins can send to any division' : 'No classes assigned'}>{isAdmin(me) ? 'Use Create & send to reach any configured division.' : 'Ask the admin to assign your divisions and subjects.'}</Empty>}
      </Card>
      {classes.length > 0 && <TeachingSchedule classes={classes} />}
    </div>
  )
}

/** The teacher's lectures by weekday, from each division's configured timetable (placeholder mapping). */
function TeachingSchedule({ classes }) {
  const rows = []
  for (const t of classes) {
    const tt = DIVISION_TIMETABLE[t.division] ? timetableForClass(DIVISION_TIMETABLE[t.division]) : []
    for (const x of tt) if (x.title === t.subject || x.title.startsWith(t.subject + ' ')) rows.push({ ...x, division: t.division })
  }
  const byDay = [1, 2, 3, 4, 5, 6].map((d) => ({ d, list: rows.filter((r) => r.day === d).sort((a, b) => a.start.localeCompare(b.start)) }))
  return (
    <Card>
      <CardTitle eyebrow="From each division's weekly timetable">Teaching schedule</CardTitle>
      {rows.length ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{byDay.filter((x) => x.list.length).map(({ d, list }) => (
        <div key={d} className="rounded-xl border border-line p-3"><b className="text-[12px] font-bold uppercase tracking-wider text-brand">{DAYS[d]}</b>
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px]">{list.map((r) => <li key={r.id + r.division} className="flex gap-2"><span className="w-[90px] flex-none font-mono text-[12px]">{r.start}–{r.end}</span><span className="min-w-0 flex-1 truncate">{r.title} · <b>{r.division}</b></span></li>)}</ul></div>
      ))}</div> : <Empty icon="calendar" title="No timetable configured">These divisions have no timetable entries for your subjects yet.</Empty>}
    </Card>
  )
}

const VENUES = () => allPlaces().filter((p) => ['room', 'lab', 'amphi', 'library'].includes(p.type))
function Compose({ onDone, existing }) {
  const { db, me, runShared } = useApp()
  const [kind, setKind] = useState(existing?.kind || 'assignment')
  const [f, setF] = useState({ title: '', body: '', deadline: '', points: '20', uploads: true, subject: me.teaches?.[0]?.subject || '', lectureAt: '', room: '', expiresAt: '' })
  const [aud, setAud] = useState({ divisions: [] })
  const [files, setFiles] = useState([])
  const [errors, setErrors] = useState({})
  const [step, setStep] = useState('edit')
  const [busy, setBusy] = useState(false)
  const venues = useMemo(VENUES, [])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const allowed = allowedDivisions(me)
  const rec = recipients(db.profiles, aud)
  const check = () => {
    const e = {}
    if (!f.title.trim()) e.title = 'Add a title.'
    if (kind !== 'document' && !f.body.trim()) e.body = 'Write the message or instructions.'
    if (kind === 'document' && !files.length) e.files = 'Attach the document.'
    if (kind === 'assignment' && !f.deadline) e.deadline = 'Set a deadline.'
    if (kind === 'assignment' && f.deadline && Date.parse(f.deadline) <= Date.now()) e.deadline = 'The deadline must be in the future.'
    if (kind === 'challenge' && !(Number.isInteger(Number(f.points)) && Number(f.points) >= 1 && Number(f.points) <= 500)) e.points = 'Points must be 1 to 500.'
    if (kind === 'lecture' && !f.subject.trim()) e.subject = 'Which subject?'
    if (kind === 'lecture' && !f.lectureAt) e.lectureAt = 'Set the lecture date and time.'
    if (!aud.divisions.length) e.audience = 'Choose at least one division.'
    setErrors(e)
    return !Object.keys(e).length
  }
  const publish = async () => {
    setBusy(true)
    const stored = []
    try { for (const file of files) stored.push(await putFile(file)) } catch { for (const x of stored) await deleteFile(x.fileId); setBusy(false); setErrors({ files: 'Couldn’t store the attachments. Nothing was sent.' }); setStep('edit'); return }
    const vp = venues.find((p) => `${p.f}:${p.id}` === f.room)
    const r = kind === 'challenge'
      ? runShared((s) => postChallenge(s, { title: f.title, description: f.body, points: Number(f.points), deadline: f.deadline ? new Date(f.deadline).toISOString() : null, audience: aud, attachments: stored, submission: f.uploads ? { required: true } : null }, me, new Date(), db.profiles), `Challenge sent to ${rec.length} students.`)
      : runShared((s) => createPost(s, { kind, title: f.title, body: f.body, deadline: f.deadline || null, subject: f.subject, lectureAt: f.lectureAt || null, room: vp ? { f: vp.f, id: vp.id, label: `${vp.short}, ${floorName(vp.f)}` } : null, expiresAt: f.expiresAt || null, attachments: stored, acceptsUploads: f.uploads, audience: aud }, me, db.profiles, new Date()), `${KIND[kind]} sent to ${rec.length} students.`)
    if (!r.ok) { for (const x of stored) await deleteFile(x.fileId); setErrors(r.errors || { form: r.error }); setStep('edit') } else onDone()
    setBusy(false)
  }
  if (step === 'review') return (
    <Card className="flex flex-col gap-3">
      <CardTitle eyebrow="Check before sending">Review</CardTitle>
      <dl className="divide-y divide-line rounded-xl border border-line text-[14px]">
        {[['Type', kind === 'challenge' ? 'Challenge' : KIND[kind]], ['Title', f.title], ...(f.body ? [['Message', f.body]] : []), ...(kind === 'assignment' || (kind === 'challenge' && f.deadline) ? [['Deadline', f.deadline ? fmtDateTime(new Date(f.deadline).toISOString()) : '—']] : []), ...(kind === 'challenge' ? [['Points', f.points]] : []), ...(kind === 'lecture' ? [['Lecture', `${f.subject} · ${f.lectureAt ? fmtDateTime(new Date(f.lectureAt).toISOString()) : ''}${f.room ? ' · ' + venues.find((p) => `${p.f}:${p.id}` === f.room)?.short : ''}`]] : []), ['Attachments', files.length ? files.map((x) => x.name).join(', ') : 'None'], ['Audience', aud.divisions.map((d) => divisionInfo(d)?.label || d).join(' + ')], ['Recipients', `${rec.length} student${rec.length === 1 ? '' : 's'}`]].map(([k, v]) => <div key={k} className="flex gap-3 px-3 py-2"><dt className="w-[110px] flex-none text-muted">{k}</dt><dd className="min-w-0 flex-1 whitespace-pre-wrap break-words">{v}</dd></div>)}
      </dl>
      {!rec.length && <p className="rounded-lg bg-[#FDF0D8] px-3 py-2 text-[13px] text-warn">No students in this audience have completed profiles yet. It will appear for them once they do.</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setStep('edit')}>Edit</Button><Button icon="send" onClick={publish} disabled={busy}>{busy ? 'Sending…' : `Send to ${aud.divisions.join(', ')}`}</Button></div>
    </Card>
  )
  return (
    <Card as="form" noValidate onSubmit={(e) => { e.preventDefault(); if (check()) setStep('review') }} className="flex flex-col gap-3">
      <Segmented label="What are you sending?" value={kind} onChange={setKind} options={[{ value: 'assignment', label: 'Assignment' }, { value: 'challenge', label: 'Challenge' }, { value: 'notice', label: 'Notice' }, { value: 'lecture', label: 'Lecture notice' }, { value: 'document', label: 'Document' }]} />
      <Field label="Title" error={errors.title}>{(id) => <input id={id} className={inputCls} maxLength={120} value={f.title} onChange={set('title')} />}</Field>
      <Field label={kind === 'challenge' ? 'Question / instructions' : kind === 'document' ? 'Description (optional)' : 'Message / instructions'} error={errors.body}>{(id) => <textarea id={id} rows={4} className={cx(inputCls, 'py-2')} value={f.body} onChange={set('body')} />}</Field>
      <div className="grid gap-3 sm:grid-cols-3">
        {(kind === 'assignment' || kind === 'challenge') && <Field label={kind === 'challenge' ? 'Closes (optional)' : 'Deadline'} error={errors.deadline}>{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.deadline} onChange={set('deadline')} />}</Field>}
        {kind === 'challenge' && <Field label="Points" error={errors.points}>{(id) => <input id={id} inputMode="numeric" className={inputCls} value={f.points} onChange={set('points')} />}</Field>}
        {(kind === 'assignment' || kind === 'challenge') && <label className="flex min-h-[40px] items-center gap-2 self-end text-[14px]"><input type="checkbox" className="h-4 w-4" checked={f.uploads} onChange={set('uploads')} />Students upload a file</label>}
        {kind === 'lecture' && <>
          <Field label="Subject" error={errors.subject}>{(id) => <input id={id} list="t-subjects" className={inputCls} value={f.subject} onChange={set('subject')} />}</Field>
          <datalist id="t-subjects">{[...new Set((me.teaches || []).map((t) => t.subject))].map((s) => <option key={s} value={s} />)}</datalist>
          <Field label="Date & time" error={errors.lectureAt}>{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.lectureAt} onChange={set('lectureAt')} />}</Field>
          <Field label="Room (optional)">{(id) => <select id={id} className={inputCls} value={f.room} onChange={set('room')}><option value="">—</option>{venues.map((p) => <option key={p.f + p.id} value={`${p.f}:${p.id}`}>{p.short} · {floorName(p.f)}</option>)}</select>}</Field>
        </>}
        {(kind === 'notice' || kind === 'lecture' || kind === 'document') && <Field label="Hide after (optional)">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.expiresAt} onChange={set('expiresAt')} />}</Field>}
      </div>
      <FilePicker label={kind === 'document' ? 'Document (PDF, JPG or PNG, up to 10 MB)' : 'Attachments (optional) — PDF, JPG or PNG, up to 10 MB each'} files={files} setFiles={setFiles} limits={RES} max={5} multiple />
      {errors.files && <p role="alert" className="text-[13px] font-medium text-bad">{errors.files}</p>}
      <AudiencePicker value={aud} onChange={(a) => { setAud(a); if (a.divisions.length) setErrors(({ audience, ...rest }) => rest) }} allowed={allowed} profiles={db.profiles} error={errors.audience} />
      {errors.form && <p role="alert" className="rounded-lg bg-[#FBEDEA] px-3 py-2 text-[13.5px] text-bad">{errors.form}</p>}
      <div className="flex justify-end"><Button type="submit">Review before sending</Button></div>
    </Card>
  )
}

function Sent() {
  const { db, me, runShared } = useApp()
  const [view, setView] = useState(null)
  const [edit, setEdit] = useState(null)
  const items = [...sentBy(db.shared, me).map((p) => ({ type: 'post', p })), ...db.shared.challenges.filter((c) => c.createdBy === me.id && c.audience).map((c) => ({ type: 'challenge', p: c }))].sort((a, b) => Date.parse(b.p.createdAt) - Date.parse(a.p.createdAt))
  const status = (it, st) => it.type === 'post' ? runShared((s) => setPostStatus(s, it.p.id, st, me, db.profiles, new Date()), `Marked ${st.toLowerCase()}.`) : runShared((s) => setChallengeStatus(s, it.p.id, st, me, new Date()), `Challenge ${st}.`)
  if (!items.length) return <Empty icon="send" title="Nothing sent yet">Items you send appear here with their audience and status.</Empty>
  return (
    <div className="stagger flex flex-col gap-3">
      {items.map((it) => {
        const p = it.p, st = it.type === 'post' ? p.status : p.status || 'open'
        const n = recipients(db.profiles, p.audience).length
        const subs = it.type === 'post' ? subsFor(db.shared, p.id) : submissionsFor(db.shared, p.id)
        return (
          <Card key={p.id} className="!p-4">
            <div className="flex flex-wrap items-start gap-2">
              <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><Badge tone="info">{it.type === 'post' ? KIND[p.kind] : 'Challenge'}</Badge><Badge tone={STATUS_TONE[st]}>{st[0].toUpperCase() + st.slice(1)}</Badge></span>
                <b className="mt-1 block text-[15.5px] font-semibold">{p.title}</b>
                <small className="text-[12.5px] text-muted">To {p.audience.divisions.join(', ')} · visible to {n} student{n === 1 ? '' : 's'} · sent {relTime(p.createdAt)}{p.deadline ? ` · due ${fmtDateTime(p.deadline)}` : ''}{subs.length ? ` · ${new Set(subs.map((s) => s.userId)).size} submitted` : ''}</small></span>
              <span className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" icon="eye" onClick={() => setView(it)}>View</Button>
                {it.type === 'post' && st !== STATUS.ARCHIVED && <Button size="sm" variant="secondary" icon="edit" onClick={() => setEdit(p)}>Edit</Button>}
                {(st === STATUS.OPEN || st === 'open') && <Button size="sm" variant="secondary" onClick={() => status(it, it.type === 'post' ? STATUS.CLOSED : 'closed')}>Close</Button>}
                {(st === STATUS.CLOSED || st === 'closed') && <Button size="sm" variant="secondary" onClick={() => status(it, it.type === 'post' ? STATUS.OPEN : 'open')}>Reopen</Button>}
                {st !== STATUS.ARCHIVED && st !== 'archived' && <Button size="sm" variant="secondary" onClick={() => status(it, it.type === 'post' ? STATUS.ARCHIVED : 'archived')}>Archive</Button>}
              </span>
            </div>
          </Card>
        )
      })}
      <Dialog open={!!view} onClose={() => setView(null)} title={view?.p.title || ''} wide>
        {view && <div className="flex flex-col gap-3 text-[14px]"><p className="whitespace-pre-wrap">{view.p.body || view.p.description}</p>
          <p className="text-[13px] text-muted">Audience: {view.p.audience.divisions.map((d) => divisionInfo(d)?.label || d).join(' + ')}</p>
          <details className="text-[13px]"><summary className="cursor-pointer font-semibold text-brand">Recipients ({recipients(db.profiles, view.p.audience).length})</summary><ul className="mt-1 text-muted">{recipients(db.profiles, view.p.audience).map((s) => <li key={s.id}>{s.roll} · {s.name} · {s.division}</li>)}</ul></details>
          {view.p.history && <details className="text-[13px]"><summary className="cursor-pointer font-semibold text-brand">History</summary><ul className="mt-1 text-muted">{view.p.history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} · {h.action}</li>)}</ul></details>}
          {(view.p.attachments || []).length > 0 && <ResourceViewer files={view.p.attachments} />}</div>}
      </Dialog>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title="Edit">
        {edit && <EditPost p={edit} onDone={() => setEdit(null)} />}
      </Dialog>
    </div>
  )
}
const toInput = (iso) => { if (!iso) return ''; const d = new Date(iso); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}` }
function EditPost({ p, onDone }) {
  const { db, me, runShared } = useApp()
  const [f, setF] = useState({ title: p.title, body: p.body, deadline: toInput(p.deadline), lectureAt: toInput(p.lectureAt) })
  const [err, setErr] = useState('')
  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={(e) => { e.preventDefault(); const r = runShared((s) => updatePost(s, p.id, { title: f.title, body: f.body, ...(p.kind === 'assignment' && f.deadline ? { deadline: new Date(f.deadline).toISOString() } : {}), ...(p.kind === 'lecture' && f.lectureAt ? { lectureAt: new Date(f.lectureAt).toISOString() } : {}) }, me, db.profiles, new Date()), 'Updated. Recipients were notified.'); if (r.ok) onDone(); else setErr(r.error) }}>
      <Field label="Title">{(id) => <input id={id} className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
      <Field label="Message">{(id) => <textarea id={id} rows={4} className={cx(inputCls, 'py-2')} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
      {p.kind === 'assignment' && <Field label="Deadline">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />}</Field>}
      {p.kind === 'lecture' && <Field label="Lecture date & time">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.lectureAt} onChange={(e) => setF({ ...f, lectureAt: e.target.value })} />}</Field>}
      <p className="text-[12.5px] text-muted">The audience can't be changed after sending (it's kept for the record). Send a new item to reach other divisions.</p>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit">Save</Button></div>
    </form>
  )
}

function Submissions({ initial }) {
  const { db, me, now, runShared } = useApp()
  const posts = sentBy(db.shared, me).filter((p) => p.kind === 'assignment')
  const [fb, setFb] = useState({})
  const [open, setOpen] = useState(null)
  const challenges = db.shared.challenges.filter((c) => c.createdBy === me.id && c.submission?.required)
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardTitle eyebrow="Assignments you set">Assignment submissions</CardTitle>
        {posts.length ? posts.map((p) => {
          const subs = subsFor(db.shared, p.id).filter((s) => s.status !== SUBST.SUPERSEDED).sort((a, b) => (a.roll || '').localeCompare(b.roll || ''))
          const rec = recipients(db.profiles, p.audience)
          const missing = rec.filter((s) => !subs.some((x) => x.userId === s.id))
          return (
            <details key={p.id} open={initial === p.id || undefined} className="mb-2 rounded-xl border border-line p-3">
              <summary className="cursor-pointer text-[14.5px] font-semibold">{p.title} <span className="font-normal text-muted">· {subs.length}/{rec.length} submitted · due {fmtDateTime(p.deadline)}</span></summary>
              <ul className="mt-2 flex flex-col gap-2">{subs.map((s) => (
                <li key={s.id} className="rounded-lg bg-ground/70 p-2.5 text-[13.5px]">
                  <div className="flex flex-wrap items-center gap-2"><b className="flex-1">{s.roll} · {s.userName}</b><span className="text-muted">attempt {s.attempt} · {relTime(s.at, now)}{Date.parse(s.at) > Date.parse(p.deadline) ? ' · late' : ''}</span><Badge tone={s.status === SUBST.REVIEWED ? 'ok' : s.status === SUBST.CHANGES ? 'info' : 'warn'}>{s.status}</Badge></div>
                  <p className="mt-1 flex flex-wrap items-center gap-2"><Icon name="file" size={14} className="text-muted" /><span className="break-all">{s.file.name}</span><span className="text-muted">{fmtSize(s.file.size)}</span><button className="font-semibold text-brand hover:underline" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Hide' : 'Open'}</button></p>
                  {s.notes && <p className="mt-1">“{s.notes}”</p>}
                  {open === s.id && <div className="mt-2"><ResourceViewer files={[s.file]} /></div>}
                  {s.status === SUBST.SUBMITTED && <div className="mt-2 flex flex-col gap-2"><textarea aria-label="Feedback" rows={2} placeholder="Feedback (required for changes)" className={cx(inputCls, 'py-2')} value={fb[s.id] || ''} onChange={(e) => setFb({ ...fb, [s.id]: e.target.value })} />
                    <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={() => runShared((st) => reviewAssignment(st, s.id, me, 'changes', fb[s.id] || '', new Date()), 'Changes requested.')}>Request changes</Button><Button size="sm" icon="check" onClick={() => runShared((st) => reviewAssignment(st, s.id, me, 'reviewed', fb[s.id] || '', new Date()), 'Marked reviewed.')}>Mark reviewed</Button></div></div>}
                </li>))}</ul>
              {missing.length > 0 && <p className="mt-2 text-[12.5px] text-muted">Not submitted yet: {missing.map((s) => s.roll).join(', ')}</p>}
            </details>
          )
        }) : <Empty icon="file" title="No assignments yet">Assignments you send appear here.</Empty>}
      </Card>
      <Card>
        <CardTitle eyebrow="Challenges that take uploads">Challenge solutions</CardTitle>
        <ReviewList challenges={challenges} />
      </Card>
    </div>
  )
}

/** Teacher portal → Timetable Schedule: the Excel importer (stored on the college server, so phone sign-in only). */
function TimetableTab() {
  const { session } = useApp()
  if (session.mode !== 'minimoth' || !session.cloud) return <Empty icon="lock" title="Sign in with your phone to publish timetables">Timetables are stored on the college server and checked there, so this needs a teacher number registered by the HOD. Demo accounts can’t publish.</Empty>
  if (!session.teacher && !session.admin) return <Empty icon="lock" title="Not allowed">Only registered teachers and the HOD can publish timetables.</Empty>
  return <TimetableSchedule />
}
