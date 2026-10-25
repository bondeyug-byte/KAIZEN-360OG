// Attendance, marks, attendance alerts, events and parent links — the screens around one source of truth on the
// server (api/_records.js). Teachers and the HOD enter and publish; parents and students only read what is published.
import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Card, CardTitle, Button, Badge, Empty, Segmented, Field, inputCls, relTime, cx, ConfirmButton } from './ui.jsx'
import { useMyRecord } from '../lib/record.js'
import { api } from '../lib/portal.js'
import { useLoad, Loading, useCatalog } from './CloudPortal.jsx'

const today = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10) // India date
const fmtDay = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const fmtWhen = (iso) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const monthName = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
const pctTone = (p, th) => (p === null || p === undefined ? 'neutral' : th && p < th ? 'bad' : 'ok')

/* ======================= read-only record (parent + student) ======================= */
/** Bar with a label: used for attendance by month / subject. Threshold line only when the college set one. */
function Bars({ rows, threshold }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-[13px]">
          <span className="truncate text-muted" title={r.label || r.key}>{r.label || r.key}</span>
          <span className="relative h-3 overflow-hidden rounded-full bg-sand" role="img" aria-label={`${r.label || r.key}: ${r.percent}% (${r.present} of ${r.total})`}>
            <span className={cx('absolute inset-y-0 left-0 rounded-full', threshold && r.percent < threshold ? 'bg-bad' : 'bg-maroon')} style={{ width: `${r.percent}%` }} />
            {threshold ? <span className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: `${threshold}%` }} /> : null}
          </span>
          <span className="w-[86px] text-right font-mono text-[12px]">{r.percent}% · {r.present}/{r.total}</span>
        </li>))}
    </ul>
  )
}

export function RecordView({ rec, audience = 'parent' }) {
  const [tab, setTab] = useState('overview')
  const a = rec.attendance, th = rec.attendanceThreshold, s = rec.student
  const upcoming = rec.events.filter((e) => new Date(e.ends_at || e.starts_at) >= new Date())
  const past = rec.events.filter((e) => new Date(e.ends_at || e.starts_at) < new Date())
  const low = th && a.percent !== null && a.percent < th
  const lowSubjects = th ? a.bySubject.filter((x) => x.percent < th) : []
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[12px] font-semibold uppercase tracking-[.08em] text-muted">{audience === 'parent' ? 'Your child' : 'My record'}</p>
            <h2 className="font-display text-[22px] font-semibold">{s.name || 'Name not set yet'}</h2>
            <p className="text-[13.5px] text-muted">{[s.division && `Division ${s.division}`, s.branchName || s.branch, s.year, s.roll && `Roll ${s.roll}`].filter(Boolean).join(' · ') || 'Not in a class yet'}</p></div>
          <div className="flex gap-2">
            <div className="rounded-xl bg-ground px-3 py-2 text-center"><b className="block font-display text-[22px]">{a.percent === null ? '—' : `${a.percent}%`}</b><span className="text-[11.5px] text-muted">Attendance</span></div>
            <div className="rounded-xl bg-ground px-3 py-2 text-center"><b className="block font-display text-[22px]">{rec.marks.items.length}</b><span className="text-[11.5px] text-muted">Published results</span></div>
            <div className="rounded-xl bg-ground px-3 py-2 text-center"><b className={cx('block font-display text-[22px]', rec.alerts.length && 'text-bad')}>{rec.alerts.length}</b><span className="text-[11.5px] text-muted">Alerts</span></div>
          </div>
        </div>
        {a.period && <p className="mt-2 text-[12.5px] text-muted">Attendance recorded from {fmtDay(a.period.from)} to {fmtDay(a.period.to)} ({a.total} lectures). Lectures without a record are not counted.</p>}
      </Card>
      <div className="overflow-x-auto"><Segmented label="Sections" value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'attendance', label: 'Attendance' }, { value: 'marks', label: 'Marks' }, { value: 'alerts', label: `Alerts${rec.alerts.length ? ` (${rec.alerts.length})` : ''}` }, { value: 'news', label: 'Notices & events' }]} /></div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardTitle eyebrow="Attendance">{a.percent === null ? 'No attendance recorded yet' : `${a.present} present · ${a.absent} absent`}</CardTitle>
            {low && <p role="alert" className="mt-2 rounded-lg bg-[#FBEDEA] px-3 py-2 text-[13px] text-bad">Below the college's {th}% requirement{lowSubjects.length ? ` in ${lowSubjects.map((x) => x.key).join(', ')}` : ''}.</p>}
            {!th && a.total > 0 && <p className="mt-1 text-[12px] text-muted">The college hasn't published an attendance requirement here, so no warning level is shown.</p>}
            {a.byMonth.length ? <div className="mt-3"><Bars rows={a.byMonth.slice(-6).map((m) => ({ ...m, label: monthName(m.key) }))} threshold={th} /></div> : null}
          </Card>
          <Card><CardTitle eyebrow="Latest results">{rec.marks.items.length ? `${rec.marks.items[0].subject} · ${rec.marks.items[0].name}` : 'No published results yet'}</CardTitle>
            <ul className="mt-2 flex flex-col divide-y divide-line">{rec.marks.items.slice(0, 4).map((m) => <li key={m.id} className="flex items-center justify-between gap-2 py-2 text-[13.5px]"><span><b>{m.subject}</b> · {m.name}</span><span className="font-mono">{m.absent ? 'Absent' : m.obtained === null ? '—' : `${m.obtained}/${m.max}`}</span></li>)}</ul>
          </Card>
          <Card><CardTitle eyebrow="Alerts">{rec.alerts.length ? rec.alerts[0].title : 'No alerts'}</CardTitle>{rec.alerts[0] && <p className="mt-1 text-[13px] text-muted">Published {relTime(rec.alerts[0].published_at)}</p>}</Card>
          <Card><CardTitle eyebrow="Coming up">{upcoming.length ? upcoming[0].title : 'No upcoming events'}</CardTitle>{upcoming[0] && <p className="mt-1 text-[13px] text-muted">{fmtWhen(upcoming[0].starts_at)}{upcoming[0].venue ? ` · ${upcoming[0].venue}` : ''}{upcoming[0].status === 'cancelled' ? ' · Cancelled' : ''}</p>}</Card>
        </div>)}

      {tab === 'attendance' && (a.total === 0 ? <Empty icon="calendar" title="No attendance recorded yet">Teachers record attendance lecture by lecture. It appears here as soon as it is saved.</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardTitle eyebrow="By subject">{a.bySubject.length} subject{a.bySubject.length === 1 ? '' : 's'}</CardTitle><div className="mt-3"><Bars rows={a.bySubject} threshold={th} /></div></Card>
          <Card><CardTitle eyebrow="By month">{a.byMonth.length} month{a.byMonth.length === 1 ? '' : 's'}</CardTitle><div className="mt-3"><Bars rows={a.byMonth.map((m) => ({ ...m, label: monthName(m.key) }))} threshold={th} /></div></Card>
          <Card className="lg:col-span-2"><CardTitle eyebrow="Day by day">Latest {a.history.length} lectures</CardTitle>
            <div className="mt-2 max-h-[360px] overflow-auto"><table className="w-full text-[13px]"><thead className="sticky top-0 bg-surface text-left text-muted"><tr><th className="py-1.5">Date</th><th>Subject</th><th>Time</th><th className="text-right">Status</th></tr></thead>
              <tbody>{a.history.map((h, i) => <tr key={i} className="border-t border-line"><td className="py-1.5">{fmtDay(h.date)}</td><td>{h.subject}</td><td className="text-muted">{h.start || '—'}</td><td className="text-right">{h.present ? <Badge tone="ok">Present</Badge> : <Badge tone="bad">Absent</Badge>}</td></tr>)}</tbody></table></div>
          </Card>
        </div>))}

      {tab === 'marks' && (rec.marks.items.length === 0 ? <Empty icon="book" title="No published results yet">Marks appear once the teacher publishes them. Drafts are never shown.</Empty> : (
        <div className="flex flex-col gap-4">
          {rec.marks.byTerm.length > 0 && <Card><CardTitle eyebrow="Term-wise">Totals from published marks</CardTitle>
            <ul className="mt-2 grid gap-2 sm:grid-cols-3">{rec.marks.byTerm.map((t) => <li key={t.term} className="rounded-lg bg-ground px-3 py-2 text-[13px]"><b className="block">{t.term}</b>{t.obtained}/{t.max} · {t.percent}% <span className="text-muted">({t.count} assessments)</span></li>)}</ul></Card>}
          <Card><CardTitle eyebrow="Subject-wise">All published assessments</CardTitle>
            <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[520px] text-[13px]"><thead className="text-left text-muted"><tr><th className="py-1.5">Subject</th><th>Assessment</th><th>Date</th><th className="text-right">Marks</th><th className="text-right">%</th><th>Grade</th></tr></thead>
              <tbody>{rec.marks.items.map((m) => <tr key={m.id} className="border-t border-line align-top"><td className="py-1.5 font-semibold">{m.subject}</td><td>{m.name}{m.term ? <span className="text-muted"> · {m.term}</span> : ''}{m.remark && <span className="block text-[12px] text-muted">Teacher: “{m.remark}”</span>}</td><td>{fmtDay(m.date)}</td><td className="text-right font-mono">{m.absent ? 'Absent' : m.obtained === null ? '—' : `${m.obtained}/${m.max}`}</td><td className="text-right font-mono">{m.percent === null ? '—' : m.percent}</td><td>{m.grade || '—'}</td></tr>)}</tbody></table></div>
            <p className="mt-2 text-[12px] text-muted">Percentages are obtained ÷ maximum for each assessment. Grades appear only when the teacher entered one; none are calculated here.</p>
          </Card>
        </div>))}

      {tab === 'alerts' && (rec.alerts.length === 0 ? <Empty icon="check" title="No alerts">Attendance alerts appear here only after the HOD publishes them.</Empty> : (
        <div className="flex flex-col gap-3">{rec.alerts.map((x) => (
          <Card key={x.id} className="border-l-4 border-l-bad"><CardTitle eyebrow={x.subject || 'Attendance'}>{x.title}</CardTitle>
            {x.details && <p className="mt-1 text-[13.5px]">{x.details}</p>}
            {x.next_steps && <p className="mt-2 text-[13.5px]"><b>Next steps:</b> {x.next_steps}</p>}
            {x.contact && <p className="mt-1 text-[13.5px]"><b>Contact:</b> {x.contact}</p>}
            <p className="mt-2 text-[12px] text-muted">Issued {fmtDay(x.published_at)}{x.updated_at && new Date(x.updated_at) - new Date(x.published_at) > 60000 ? ` · updated ${relTime(x.updated_at)}` : ''}</p>
          </Card>))}</div>))}

      {tab === 'news' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><CardTitle eyebrow="Events">{upcoming.length} upcoming</CardTitle>
            {rec.events.length === 0 ? <p className="mt-2 text-[13.5px] text-muted">No published events for this branch.</p> : (
              <ul className="mt-2 flex flex-col gap-2">{[...upcoming, ...past.reverse()].map((e) => <li key={e.id} className={cx('rounded-lg border border-line px-3 py-2', new Date(e.starts_at) < new Date() && 'opacity-70')}>
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">{e.title}{e.status === 'cancelled' && <Badge tone="bad">Cancelled</Badge>}{new Date(e.ends_at || e.starts_at) < new Date() && <Badge>Past</Badge>}</p>
                <p className="text-[12.5px] text-muted">{fmtWhen(e.starts_at)}{e.venue ? ` · ${e.venue}` : ''}</p>
                {e.description && <p className="mt-1 text-[13px]">{e.description}</p>}{e.registration && <p className="mt-1 text-[12.5px]"><b>Registration:</b> {e.registration}</p>}</li>)}</ul>)}
          </Card>
          <Card><CardTitle eyebrow="Class notices">{rec.notices.length ? `Latest ${rec.notices.length}` : 'None yet'}</CardTitle>
            <ul className="mt-2 flex flex-col divide-y divide-line">{rec.notices.map((n) => <li key={n.id} className="py-2"><p className="text-[14px] font-semibold">{n.title}</p><p className="text-[12.5px] text-muted">{n.author_name || 'Teacher'} · {relTime(n.created_at)}{n.has_file ? ' · attachment in the student app' : ''}</p>{n.body && <p className="mt-0.5 line-clamp-3 text-[13px]">{n.body}</p>}</li>)}</ul>
            {rec.reminders.length > 0 && <><h3 className="mt-3 text-[13px] font-semibold">Reminders</h3><ul className="mt-1 text-[13px]">{rec.reminders.map((r) => <li key={r.id}>{fmtWhen(r.remind_at)} · {r.title}</li>)}</ul></>}
          </Card>
        </div>)}
    </div>
  )
}

/** Student: their own attendance and published marks (same view the parent sees). */
export function MyRecord() {
  const r = useMyRecord() // the same cached record the Attendance page and Overview use
  const s = { loading: r.status === 'loading', data: r.data, error: r.status === 'error' && !r.data ? r.message : '' }
  return <Loading s={s}>{s.data && (s.data.enrolled ? <RecordView rec={s.data} audience="student" /> : <Empty icon="user" title="Join your class first">Your attendance and marks appear after a teacher approves your class.</Empty>)}</Loading>
}

/* ======================= parent links ======================= */
/** Student: add / remove parents and guardians (the class teacher or HOD confirms). */
export function MyParents() {
  const { pushToast } = useApp()
  const s = useLoad(() => api('parent-links'), [])
  const [email, setEmail] = useState(''), [relation, setRelation] = useState('Mother'), [busy, setBusy] = useState(false)
  const add = async (e) => { e.preventDefault(); setBusy(true); try { await api('parent-links', { method: 'POST', body: { email: email.trim(), relation } }); setEmail(''); pushToast('Added. Your class teacher will confirm it.'); s.reload() } catch (x) { pushToast(x.message, 'bad') } finally { setBusy(false) } }
  const remove = async (id) => { try { await api('parent-links', { method: 'DELETE', query: { id } }); pushToast('Removed. That account can no longer see your record.'); s.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const TONE = { approved: 'ok', pending: 'warn', rejected: 'bad' }
  return (
    <Card className="max-w-xl">
      <CardTitle eyebrow="Parents & guardians">Who can see your record</CardTitle>
      <p className="mt-1 text-[13px] text-muted">A parent signs in on the Parent tab with their own Google account (Gmail or any other). They only see your attendance, published marks, published alerts, class notices and events. Your class teacher or HOD confirms each account first. If a parent changes their Google account, remove the old one and add the new one.</p>
      <Loading s={s}>{s.data && (s.data.links.length ? <ul className="mt-3 flex flex-col gap-2">{s.data.links.map((l) => <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13.5px]"><b>{l.relation}</b><span className="font-mono">{l.contact}</span><Badge tone={TONE[l.status]}>{l.status === 'approved' ? 'Confirmed' : l.status === 'pending' ? 'Waiting for teacher' : 'Not confirmed'}</Badge>{l.status !== 'rejected' && <ConfirmButton size="sm" variant="ghost" className="ml-auto" confirmText="Remove access" onConfirm={() => remove(l.id)}>Remove</ConfirmButton>}</li>)}</ul> : <p className="mt-3 text-[13.5px] text-muted">No parents added yet.</p>)}</Loading>
      <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-[1fr_130px_auto]">
        <Field label="Parent's Google account email">{(id) => <input id={id} className={inputCls} type="email" inputMode="email" autoComplete="off" placeholder="name@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Relation">{(id) => <select id={id} className={inputCls} value={relation} onChange={(e) => setRelation(e.target.value)}>{['Mother', 'Father', 'Guardian', 'Parent'].map((r) => <option key={r}>{r}</option>)}</select>}</Field>
        <div className="flex items-end"><Button type="submit" disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}>{busy ? 'Adding…' : 'Add'}</Button></div>
      </form>
    </Card>
  )
}
/** Teacher / HOD: confirm parent accounts for students in their divisions (emails are shown masked). */
export function ParentLinkRequests() {
  const { pushToast } = useApp()
  const s = useLoad(() => api('parent-links'), [])
  const decide = async (id, decision) => { try { const r = await api('parent-link-decision', { method: 'POST', body: { ids: [id], decision } }); const x = r.results[0]; pushToast(x.ok ? (decision === 'approve' ? 'Confirmed. The parent can now sign in.' : 'Not confirmed.') : x.error, x.ok ? undefined : 'bad'); s.reload() } catch (e) { pushToast(e.message, 'bad') } }
  return (
    <Card>
      <CardTitle eyebrow="Parent portal">Confirm parents and guardians</CardTitle>
      <p className="mt-1 text-[13px] text-muted">Students add a parent's Google account email (shown masked). Confirm only when you are satisfied it belongs to that student's parent or guardian, for example by checking with the parent or the college records. Confirmed parents can read, never change, that student's record.</p>
      <Loading s={s}>{s.data && (s.data.links.length === 0 ? <p className="mt-3 text-[13.5px] text-muted">Nothing to confirm.</p> : (
        <ul className="mt-3 flex flex-col gap-2">{s.data.links.map((l) => <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13.5px]">
          <b>{l.student_name || 'Student'}</b><span className="text-muted">{l.division_code}{l.roll ? ` · Roll ${l.roll}` : ''}</span><span>→ {l.relation} <span className="font-mono">{l.contact}</span></span>
          {l.status === 'pending' ? <span className="ml-auto flex gap-1.5"><Button size="sm" onClick={() => decide(l.id, 'approve')}>Confirm</Button><Button size="sm" variant="secondary" onClick={() => decide(l.id, 'reject')}>Reject</Button></span> : <Badge className="ml-auto" tone={l.status === 'approved' ? 'ok' : 'bad'}>{l.status}</Badge>}
        </li>)}</ul>))}</Loading>
    </Card>
  )
}

/* ======================= teacher tools ======================= */
function useDivisionChoice(perm) {
  const cat = useCatalog()
  const allowed = (cat.data?.divisions || []).filter((d) => d.can?.[perm])
  const [division, setDivision] = useState('')
  useEffect(() => { if (!division && allowed[0]) setDivision(allowed[0].code) }, [allowed.length]) // eslint-disable-line
  const picker = <Loading s={cat}>{allowed.length === 0 ? <p className="text-[13.5px] text-muted">You have no divisions assigned yet. Your HOD assigns them.</p> : <Field label="Division">{(id) => <select id={id} className={inputCls} value={division} onChange={(e) => setDivision(e.target.value)}>{allowed.map((d) => <option key={d.code} value={d.code}>{d.code}{d.name ? ` · ${d.name}` : ''}</option>)}</select>}</Field>}</Loading>
  return { division, picker }
}

/** Teacher: take or correct attendance for one lecture. */
export function AttendanceTaker() {
  const { pushToast, session } = useApp()
  const { division, picker } = useDivisionChoice('record')
  const subjects = useMemo(() => [...new Set((session.teacher?.teaches || []).filter((t) => t.division === division).map((t) => t.subject).filter(Boolean))], [session.teacher, division])
  const [subject, setSubject] = useState(''), [date, setDate] = useState(today()), [start, setStart] = useState('')
  useEffect(() => { if (subjects.length && !subjects.includes(subject)) setSubject(subjects[0]) }, [subjects.join()]) // eslint-disable-line
  const s = useLoad(() => (division ? api('attendance', { query: { division, subject: subject || undefined, date, start } }) : Promise.resolve(null)), [division, subject, date, start])
  const [marks, setMarks] = useState({})
  useEffect(() => { if (s.data) setMarks(Object.fromEntries(s.data.roster.map((r) => [r.id, s.data.marks[r.id] ?? true]))) }, [s.data])
  const [busy, setBusy] = useState(false)
  const roster = s.data?.roster || [], absent = roster.filter((r) => marks[r.id] === false).length
  const save = async () => { setBusy(true); try { const r = await api('attendance', { method: 'POST', body: { division, subject, date, start, marks: roster.map((x) => ({ studentId: x.id, present: marks[x.id] !== false })) } }); pushToast(`${r.session.created ? 'Saved' : 'Updated'}: ${r.session.present}/${r.session.total} present.`); s.reload() } catch (e) { pushToast(e.message, 'bad') } finally { setBusy(false) } }
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle eyebrow="Attendance">Mark a lecture</CardTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {picker}
          <Field label="Subject">{(id) => subjects.length ? <select id={id} className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)}>{subjects.map((x) => <option key={x}>{x}</option>)}</select> : <input id={id} className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. M1" />}</Field>
          <Field label="Date">{(id) => <input id={id} type="date" className={inputCls} value={date} max={today()} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Time (optional)">{(id) => <input id={id} type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        </div>
        {s.data?.session && <p className="mt-2 text-[12.5px] text-muted">Already recorded by {s.data.session.taken_by_name || 'a teacher'} · {relTime(s.data.session.updated_at)}. Saving again corrects it.</p>}
      </Card>
      <Loading s={s}>{s.data && (roster.length === 0 ? <Empty icon="user" title="No students in this class yet">Students appear after their join request is approved.</Empty> : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[14px]"><b>{roster.length - absent}</b> present · <b className="text-bad">{absent}</b> absent</p>
            <span className="flex gap-1.5"><Button size="sm" variant="secondary" onClick={() => setMarks(Object.fromEntries(roster.map((r) => [r.id, true])))}>All present</Button><Button size="sm" disabled={busy || !subject} onClick={save}>{busy ? 'Saving…' : 'Save attendance'}</Button></span></div>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">{roster.map((r) => (
            <li key={r.id}><button type="button" aria-pressed={marks[r.id] !== false} onClick={() => setMarks((m) => ({ ...m, [r.id]: m[r.id] === false }))} className={cx('press flex min-h-[44px] w-full items-center gap-2 rounded-lg border px-3 text-left text-[14px]', marks[r.id] === false ? 'border-bad/40 bg-[#FBEDEA]' : 'border-line bg-surface')}>
              <span className="w-10 font-mono text-[12px] text-muted">{r.roll || '—'}</span><span className="flex-1 truncate">{r.name || 'Unnamed student'}</span>{marks[r.id] === false ? <Badge tone="bad">Absent</Badge> : <Badge tone="ok">Present</Badge>}</button></li>))}</ul>
        </Card>))}</Loading>
      {s.data?.recent?.length > 0 && <Card><CardTitle eyebrow="Recent lectures">{division}</CardTitle><ul className="mt-2 text-[13px]">{s.data.recent.slice(0, 12).map((x) => <li key={x.id} className="flex justify-between border-t border-line py-1.5"><span>{fmtDay(typeof x.on_date === 'string' ? x.on_date.slice(0, 10) : x.on_date)} · {x.subject}{x.start_time ? ` · ${x.start_time}` : ''}</span><span className="font-mono">{x.present}/{x.total}</span></li>)}</ul></Card>}
    </div>
  )
}

/** Teacher: create assessments, enter marks, publish (drafts stay private). */
export function MarksManager() {
  const { pushToast, session } = useApp()
  const { division, picker } = useDivisionChoice('record')
  const list = useLoad(() => (division ? api('assessments', { query: { division } }) : Promise.resolve(null)), [division])
  const [open, setOpen] = useState(null)
  const [form, setForm] = useState({ subject: '', name: '', term: '', date: today(), maxMarks: 25 })
  const subjects = [...new Set((session.teacher?.teaches || []).filter((t) => t.division === division).map((t) => t.subject).filter(Boolean))]
  const create = async (e) => { e.preventDefault(); try { const r = await api('assessments', { method: 'POST', body: { ...form, subject: form.subject || subjects[0], division } }); pushToast('Draft created. Enter marks, then publish.'); list.reload(); setOpen(r.assessment.id) } catch (x) { pushToast(x.message, 'bad') } }
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle eyebrow="Marks">New assessment</CardTitle>
        <form onSubmit={create} className="mt-3 grid gap-3 sm:grid-cols-3">
          {picker}
          <Field label="Subject">{(id) => subjects.length ? <select id={id} className={inputCls} value={form.subject || subjects[0]} onChange={(e) => setForm({ ...form, subject: e.target.value })}>{subjects.map((x) => <option key={x}>{x}</option>)}</select> : <input id={id} className={inputCls} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}</Field>
          <Field label="Name">{(id) => <input id={id} className={inputCls} value={form.name} placeholder="Unit test 1" onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Field>
          <Field label="Term / semester">{(id) => <input id={id} className={inputCls} value={form.term} placeholder="Sem 1" onChange={(e) => setForm({ ...form, term: e.target.value })} />}</Field>
          <Field label="Date">{(id) => <input id={id} type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
          <Field label="Maximum marks">{(id) => <input id={id} type="number" min="1" max="1000" className={inputCls} value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: e.target.value })} />}</Field>
          <div className="sm:col-span-3"><Button type="submit" disabled={!division || form.name.trim().length < 2}>Create draft</Button></div>
        </form>
      </Card>
      <Loading s={list}>{list.data && (list.data.assessments.length === 0 ? <Empty icon="book" title="No assessments yet" /> : (
        <Card><CardTitle eyebrow={division}>Assessments</CardTitle>
          <ul className="mt-2 flex flex-col divide-y divide-line">{list.data.assessments.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-[13.5px]"><b>{a.subject}</b> · {a.name}{a.term ? <span className="text-muted"> · {a.term}</span> : ''}<Badge tone={a.status === 'published' ? 'ok' : 'warn'}>{a.status === 'published' ? 'Published' : 'Draft (private)'}</Badge><span className="text-muted">{a.entered} entered</span><Button className="ml-auto" size="sm" variant="secondary" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Close' : 'Enter marks'}</Button>
            {open === a.id && <div className="w-full"><MarksSheet id={a.id} onChange={list.reload} /></div>}</li>)}</ul></Card>))}</Loading>
    </div>
  )
}
function MarksSheet({ id, onChange }) {
  const { pushToast } = useApp()
  const s = useLoad(() => api('assessment', { query: { id } }), [id])
  const [rows, setRows] = useState({})
  useEffect(() => { if (s.data) setRows(Object.fromEntries(s.data.students.map((r) => [r.id, { obtained: r.obtained ?? '', absent: !!r.absent, grade: r.grade || '', remark: r.remark || '' }]))) }, [s.data])
  const [busy, setBusy] = useState(false)
  const a = s.data?.assessment
  const save = async (status) => {
    setBusy(true)
    try {
      await api('assessment-marks', { method: 'POST', body: { id, marks: s.data.students.map((r) => ({ studentId: r.id, ...rows[r.id], obtained: rows[r.id].obtained === '' ? null : Number(rows[r.id].obtained) })) } })
      if (status) await api('assessment-status', { method: 'POST', body: { id, status } })
      pushToast(status === 'published' ? 'Published. Students and confirmed parents can now see these marks.' : status === 'draft' ? 'Unpublished. Marks are private again.' : 'Saved.'); s.reload(); onChange()
    } catch (e) { pushToast(e.message, 'bad') } finally { setBusy(false) }
  }
  return (
    <Loading s={s}>{a && (
      <div className="mt-2 rounded-lg bg-ground p-3">
        <p className="text-[12.5px] text-muted">Out of {Number(a.max_marks)}. Leave blank if not yet marked; tick “Absent” for absentees. Grade only if the college's rules define one.</p>
        <div className="mt-2 max-h-[420px] overflow-auto"><table className="w-full min-w-[560px] text-[13px]"><thead className="text-left text-muted"><tr><th>Roll</th><th>Student</th><th>Marks</th><th>Absent</th><th>Grade</th><th>Remark</th></tr></thead>
          <tbody>{s.data.students.map((r) => { const v = rows[r.id] || {}; const set = (k, val) => setRows((x) => ({ ...x, [r.id]: { ...x[r.id], [k]: val } })); return (
            <tr key={r.id} className="border-t border-line"><td className="font-mono text-muted">{r.roll || '—'}</td><td className="py-1">{r.name || 'Unnamed'}</td>
              <td><input aria-label={`Marks for ${r.name}`} type="number" min="0" max={Number(a.max_marks)} step="0.5" disabled={v.absent} className={cx(inputCls, 'h-9 min-h-0 w-20')} value={v.obtained} onChange={(e) => set('obtained', e.target.value)} /></td>
              <td><input aria-label={`${r.name} absent`} type="checkbox" checked={!!v.absent} onChange={(e) => set('absent', e.target.checked)} /></td>
              <td><input aria-label={`Grade for ${r.name}`} className={cx(inputCls, 'h-9 min-h-0 w-16')} maxLength={8} value={v.grade} onChange={(e) => set('grade', e.target.value)} /></td>
              <td><input aria-label={`Remark for ${r.name}`} className={cx(inputCls, 'h-9 min-h-0')} maxLength={200} value={v.remark} onChange={(e) => set('remark', e.target.value)} /></td></tr>) })}</tbody></table></div>
        <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" disabled={busy} onClick={() => save()}>Save</Button>
          {a.status === 'published' ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => save('draft')}>Unpublish</Button> : <Button size="sm" disabled={busy} onClick={() => save('published')}>Save & publish</Button>}</div>
      </div>)}</Loading>
  )
}

/** Teacher drafts / HOD publishes attendance alerts (defaulter notices). */
export function AlertsManager({ hod = false }) {
  const { pushToast } = useApp()
  const { division, picker } = useDivisionChoice('record')
  const list = useLoad(() => api('alerts', { query: division ? { division } : {} }), [division])
  const roster = useLoad(() => (division ? api('roster', { query: { division } }) : Promise.resolve(null)), [division])
  const [f, setF] = useState({ studentId: '', subject: '', title: '', details: '', nextSteps: '', contact: '' })
  const create = async (e) => { e.preventDefault(); try { await api('alerts', { method: 'POST', body: { ...f, division } }); pushToast(hod ? 'Draft saved. Publish it when ready.' : 'Draft saved. The HOD reviews and publishes it.'); setF({ ...f, title: '', details: '' }); list.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const status = async (id, s) => { try { await api('alert-status', { method: 'POST', body: { id, status: s } }); pushToast(s === 'published' ? 'Published to the student and confirmed parents.' : s === 'withdrawn' ? 'Withdrawn.' : 'Back to draft.'); list.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const TONE = { draft: 'warn', published: 'bad', withdrawn: 'neutral' }
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle eyebrow="Attendance alerts">Draft an alert</CardTitle>
        <p className="mt-1 text-[13px] text-muted">Use the college's own rule for shortage/defaulter status. Drafts are private; only the branch HOD publishes, and only published alerts reach the student and their confirmed parents.</p>
        <form onSubmit={create} className="mt-3 grid gap-3 sm:grid-cols-2">
          {picker}
          <Field label="Student">{(id) => <Loading s={roster}><select id={id} className={inputCls} value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}><option value="">Choose…</option>{(roster.data?.students || []).map((r) => <option key={r.id} value={r.id}>{r.roll ? `${r.roll} · ` : ''}{r.name || 'Unnamed'}</option>)}</select></Loading>}</Field>
          <Field label="Subject (optional)">{(id) => <input id={id} className={inputCls} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
          <Field label="Title">{(id) => <input id={id} className={inputCls} value={f.title} placeholder="Attendance shortage in …" onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Details">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[70px] py-2')} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />}</Field>
          <Field label="Next steps">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[70px] py-2')} value={f.nextSteps} onChange={(e) => setF({ ...f, nextSteps: e.target.value })} />}</Field>
          <Field label="Contact (role, not a personal number)">{(id) => <input id={id} className={inputCls} value={f.contact} placeholder="Class teacher, D2A" onChange={(e) => setF({ ...f, contact: e.target.value })} />}</Field>
          <div className="flex items-end"><Button type="submit" disabled={!f.studentId || f.title.trim().length < 4}>Save draft</Button></div>
        </form>
      </Card>
      <Loading s={list}>{list.data && (list.data.alerts.length === 0 ? <Empty icon="check" title="No alerts" /> : (
        <Card><CardTitle eyebrow="Alerts">{list.data.alerts.length}</CardTitle>
          <ul className="mt-2 flex flex-col divide-y divide-line">{list.data.alerts.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-[13.5px]"><b>{a.student_name || 'Student'}</b><span className="text-muted">{a.division_code}</span>· {a.title}<Badge tone={TONE[a.status]}>{a.status}</Badge>
            {a.canPublish && <span className="ml-auto flex gap-1.5">{a.status !== 'published' && <Button size="sm" onClick={() => status(a.id, 'published')}>Publish</Button>}{a.status === 'published' && <Button size="sm" variant="secondary" onClick={() => status(a.id, 'withdrawn')}>Withdraw</Button>}</span>}</li>)}</ul></Card>))}</Loading>
    </div>
  )
}

/* ======================= HOD: events and settings ======================= */
export function EventsManager() {
  const { pushToast, session } = useApp()
  const list = useLoad(() => api('events'), [])
  const blank = { id: '', title: '', description: '', venue: '', startsAt: '', endsAt: '', registration: '', branch: session.hod?.branches?.[0] || '' }
  const [f, setF] = useState(blank)
  const save = async (e) => { e.preventDefault(); try { await api('events', { method: 'POST', body: { ...f, id: f.id || undefined, startsAt: new Date(f.startsAt).toISOString(), endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null } }); pushToast(f.id ? 'Event updated. Parents and students see the change.' : 'Draft saved. Publish it when ready.'); setF(blank); list.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const status = async (id, s) => { try { await api('event-status', { method: 'POST', body: { id, status: s } }); pushToast(s === 'published' ? 'Published to students and parents of this branch.' : s === 'cancelled' ? 'Marked cancelled.' : 'Back to draft.'); list.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const local = (iso) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600000).toISOString().slice(0, 16) : '')
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle eyebrow="College events">{f.id ? 'Edit event' : 'New event'}</CardTitle>
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-2">
          {(session.hod?.branches || []).length > 1 && <Field label="Branch">{(id) => <select id={id} className={inputCls} value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}>{session.hod.branches.map((b) => <option key={b}>{b}</option>)}</select>}</Field>}
          <Field label="Title">{(id) => <input id={id} className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Venue">{(id) => <input id={id} className={inputCls} value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} />}</Field>
          <Field label="Starts">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />}</Field>
          <Field label="Ends (optional)">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />}</Field>
          <Field label="Description">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[70px] py-2')} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
          <Field label="Registration / participation">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[70px] py-2')} value={f.registration} onChange={(e) => setF({ ...f, registration: e.target.value })} />}</Field>
          <div className="flex gap-2"><Button type="submit" disabled={f.title.trim().length < 3 || !f.startsAt}>{f.id ? 'Save changes' : 'Save draft'}</Button>{f.id && <Button type="button" variant="secondary" onClick={() => setF(blank)}>Cancel edit</Button>}</div>
        </form>
      </Card>
      <Loading s={list}>{list.data && (list.data.events.length === 0 ? <Empty icon="calendar" title="No events yet" /> : (
        <Card><CardTitle eyebrow="Your branch">Events</CardTitle>
          <ul className="mt-2 flex flex-col divide-y divide-line">{list.data.events.map((e) => <li key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-[13.5px]"><b>{e.title}</b><span className="text-muted">{fmtWhen(e.starts_at)}</span><Badge tone={e.status === 'published' ? 'ok' : e.status === 'cancelled' ? 'bad' : 'warn'}>{e.status}</Badge>
            <span className="ml-auto flex gap-1.5"><Button size="sm" variant="ghost" onClick={() => setF({ id: e.id, title: e.title, description: e.description, venue: e.venue, startsAt: local(e.starts_at), endsAt: local(e.ends_at), registration: e.registration, branch: e.branch_code })}>Edit</Button>
              {e.status !== 'published' && <Button size="sm" onClick={() => status(e.id, 'published')}>Publish</Button>}{e.status === 'published' && <Button size="sm" variant="secondary" onClick={() => status(e.id, 'cancelled')}>Cancel event</Button>}</span></li>)}</ul></Card>))}</Loading>
    </div>
  )
}
export function AttendanceThreshold() {
  const { pushToast, session } = useApp()
  const branch = session.hod?.branches?.[0]
  const s = useLoad(() => (branch ? api('settings', { query: { branch } }) : Promise.resolve(null)), [branch])
  const [v, setV] = useState('')
  useEffect(() => { if (s.data) setV(s.data.attendanceThreshold ?? '') }, [s.data])
  const save = async () => { try { await api('attendance-threshold', { method: 'POST', body: { branch, value: v === '' ? null : Number(v) } }); pushToast(v === '' ? 'No attendance requirement shown to parents.' : `Attendance requirement set to ${v}%.`); s.reload() } catch (e) { pushToast(e.message, 'bad') } }
  if (!branch) return null
  return (
    <Card className="max-w-xl">
      <CardTitle eyebrow={`Attendance requirement · ${branch}`}>Warning level shown to students and parents</CardTitle>
      <p className="mt-1 text-[13px] text-muted">Enter the percentage your college rules require. Leave empty if there is no published rule; then no warning level is shown anywhere.</p>
      <Loading s={s}><div className="mt-3 flex items-end gap-2"><Field label="Required attendance (%)">{(id) => <input id={id} type="number" min="1" max="100" className={cx(inputCls, 'w-32')} value={v} onChange={(e) => setV(e.target.value)} />}</Field><Button onClick={save}>Save</Button></div></Loading>
    </Card>
  )
}
