import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Empty, Segmented, Field, inputCls, relTime, cx, ConfirmButton, Spinner } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { api, downloadFile, fileToBase64, MAX_UPLOAD, UPLOAD_TYPES, DAY_NAMES, hhmm, fmtBytes } from '../lib/portal.js'
import { readSheets, SheetError } from '../lib/sheets.js'

/**
 * College portal: everything here is stored on the server (Neon) and checked there.
 *  Student  — join a class, class timetable, posts and files from teachers; class reps review join requests.
 *  Teacher  — post announcements/materials to their own divisions, Timetable Schedule (Excel import).
 *  HOD      — teacher whitelist, join requests (override) and class reps, timetables, audit log.
 */
export default function Portal({ query = {} }) {
  const { session, sync } = useApp()
  const [who, setWho] = useState(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => api('me').then(setWho).catch((e) => setErr(e.message)), [])
  useEffect(() => { if (session.cloud) load() }, [session.cloud, load])
  const role = who?.admin ? 'hod' : who?.teacher ? 'teacher' : 'student'
  const tabs = useMemo(() => {
    if (!who) return []
    if (role === 'hod') return [['requests', 'Join requests & CRs'], ['teachers', 'Teacher list'], ['post', 'Post to classes'], ['sent', 'My posts'], ['tt-upload', 'Timetable Schedule'], ['tt', 'View timetables'], ['audit', 'Audit log']]
    if (role === 'teacher') return [['post', 'Post to classes'], ['sent', 'My posts'], ...(who.teacher.canPublishTimetable ? [['tt-upload', 'Timetable Schedule']] : []), ['tt', 'View timetables']]
    return [['class', 'My class'], ['feed', 'From teachers'], ['tt', 'Timetable'], ...(who.cr?.length ? [['requests', 'Class requests']] : [])]
  }, [who, role])
  const [tab, setTab] = useState(query.tab || null)
  const active = tabs.find((t) => t[0] === tab) ? tab : tabs[0]?.[0]

  if (session.mode !== 'minimoth') return <div className="py-10"><Empty icon="lock" title="Sign in with your phone">The college portal keeps your class, posts and timetable on the college server so they appear on every device. Demo accounts can’t use it: sign out and sign in with your phone number.</Empty></div>
  if (!session.cloud) return <div className="py-10"><Empty icon="refresh" title={sync?.status === 'loading' ? 'Connecting…' : 'College server not reachable'}>{sync?.status === 'loading' ? 'Loading your account.' : (sync?.message || 'Cloud sync is not available right now. Try again in a moment.')}</Empty></div>
  if (err) return <div className="py-10"><Empty icon="alert" title="Couldn’t load the portal" action={<Button onClick={() => { setErr(''); load() }}>Try again</Button>}>{err}</Empty></div>
  if (!who) return <div className="py-10"><Spinner label="Loading your portal" /></div>
  return (
    <div>
      <PageHeader title="College portal" subtitle={role === 'hod' ? 'Manage teachers, classes, class representatives and timetables. Every change is recorded in the audit log.' : role === 'teacher' ? 'Post to your classes and publish timetables. Students see them on any device.' : 'Your class, timetable and posts from your teachers, the same on every device.'}
        actions={<Badge tone="ok" icon="check">{role === 'hod' ? 'HOD' : role === 'teacher' ? `Teacher${who.teacher.code ? ' · ' + who.teacher.code : ''}` : who.enrollment?.status === 'approved' ? who.enrollment.division_code : 'Student'}{who.cr?.length ? ' · Class rep' : ''}</Badge>} />
      <div className="mb-4 overflow-x-auto"><Segmented label="Portal section" value={active} onChange={setTab} options={tabs.map(([value, label]) => ({ value, label }))} /></div>
      {active === 'class' && <MyClass who={who} reload={load} />}
      {active === 'feed' && <Feed />}
      {active === 'tt' && <TimetableView who={who} />}
      {active === 'requests' && <Requests who={who} />}
      {active === 'post' && <Composer who={who} onPosted={() => setTab('sent')} />}
      {active === 'sent' && <MyPosts />}
      {active === 'tt-upload' && <TimetableSchedule />}
      {active === 'teachers' && <TeacherList />}
      {active === 'audit' && <AuditLog />}
    </div>
  )
}

/* ---------- small helpers ---------- */
function useLoad(fn, deps) {
  const [state, set] = useState({ loading: true, data: null, error: '' })
  const run = useCallback(() => { set((s) => ({ ...s, loading: true, error: '' })); return fn().then((data) => set({ loading: false, data, error: '' })).catch((e) => set({ loading: false, data: null, error: e.message })) }, deps) // eslint-disable-line
  useEffect(() => { run() }, [run])
  return { ...state, reload: run }
}
const Loading = ({ s, children }) => (s.loading && !s.data ? <Spinner label="Loading" /> : s.error ? <p role="alert" className="text-[13.5px] text-bad">{s.error}</p> : children)
const useDivisions = () => useLoad(() => api('divisions').then((r) => r.divisions), [])
const STATUS_TONE = { approved: 'ok', pending: 'warn', rejected: 'bad' }

/* ---------- Student: join a class ---------- */
function MyClass({ who, reload }) {
  const { pushToast } = useApp()
  const divs = useDivisions()
  const [division, setDivision] = useState('')
  const [busy, setBusy] = useState(false)
  const e = who.enrollment
  const send = async (ev) => {
    ev.preventDefault(); if (!division) return
    setBusy(true)
    try { await api('join', { method: 'POST', body: { division } }); pushToast(`Request sent to join ${division}. Your class representative or the HOD will review it.`); reload() }
    catch (x) { pushToast(x.message, 'bad') } finally { setBusy(false) }
  }
  return (
    <Card className="max-w-xl">
      <CardTitle eyebrow="Class membership">My class</CardTitle>
      {e && <p className="mt-2 flex flex-wrap items-center gap-2 text-[14px]"><Badge tone={STATUS_TONE[e.status]}>{e.status === 'approved' ? 'Approved' : e.status === 'pending' ? 'Waiting for approval' : 'Not approved'}</Badge><span className="font-semibold">{e.division_code}</span>{e.decided_at && <span className="text-muted">· decided {relTime(e.decided_at)}</span>}</p>}
      {e?.status === 'approved' ? <p className="mt-3 text-[13.5px] text-muted">You see this class’s timetable and teacher posts. To move to another class, ask the HOD.</p> : (
        <form onSubmit={send} className="mt-4 flex flex-wrap items-end gap-3">
          <Field label={e ? 'Request a different class' : 'Choose your division'}>{(id) => (
            <select id={id} className={inputCls} value={division} onChange={(x) => setDivision(x.target.value)} disabled={divs.loading}>
              <option value="">Choose…</option>
              {(divs.data || []).map((d) => <option key={d.code} value={d.code}>{d.code} · {d.branch_code} · Year {d.year}{d.confirmed ? '' : ' (name to be confirmed)'}</option>)}
            </select>)}</Field>
          <Button type="submit" disabled={!division || busy}>{busy ? 'Sending…' : 'Send request'}</Button>
        </form>)}
      <p className="mt-4 text-[12.5px] text-muted">Your class representative approves requests for their class; the HOD can approve or change any decision. Phone sign-in proves you own the number, not that you are enrolled, which is why a person checks.</p>
    </Card>
  )
}

/* ---------- Student: feed ---------- */
function Feed() {
  const { pushToast, now } = useApp()
  const [posts, setPosts] = useState([])
  const s = useLoad(() => api('feed').then((r) => { setPosts(r.posts); return r }), [])
  const more = async () => {
    try { const r = await api('feed', { query: { before: posts[posts.length - 1].created_at } }); setPosts((p) => [...p, ...r.posts]) } catch (e) { pushToast(e.message, 'bad') }
  }
  return (
    <Loading s={s}>
      {s.data && !s.data.division ? <Empty icon="user" title="Join your class first">{s.data.message}</Empty> : !posts.length ? <Empty icon="megaphone" title="Nothing yet">Announcements and materials your teachers send to {s.data?.division} appear here.</Empty> : (
        <div className="flex flex-col gap-3">
          {posts.map((p) => <PostCard key={p.id} p={p} now={now} />)}
          {s.data?.more && posts.length % 50 === 0 && <Button variant="secondary" onClick={more}>Load older posts</Button>}
        </div>)}
    </Loading>
  )
}
function PostCard({ p, now, onDelete }) {
  const { pushToast } = useApp()
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2"><Badge tone={p.kind === 'material' ? 'info' : 'neutral'}>{p.kind === 'material' ? 'Material' : 'Announcement'}</Badge><span className="text-[12.5px] text-muted">{p.author_name} · {relTime(p.created_at, now)} · {(p.divisions || []).join(', ')}</span></div>
      <h3 className="mt-1.5 font-display text-[17px] font-semibold">{p.title}</h3>
      {p.body && <p className="mt-1 whitespace-pre-wrap text-[14px] text-[#33443B]">{p.body}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {p.file_id && <Button size="sm" variant="secondary" icon="download" onClick={() => downloadFile(p.file_id, p.file_name).catch((e) => pushToast(e.message, 'bad'))}>{p.file_name} · {fmtBytes(p.file_size)}</Button>}
        {onDelete && <ConfirmButton size="sm" variant="ghost" confirmText="Delete for everyone" onConfirm={onDelete}>Delete</ConfirmButton>}
      </div>
    </Card>
  )
}

/* ---------- Timetable view ---------- */
function TimetableView({ who }) {
  const staff = who.admin || who.teacher
  const divs = useDivisions()
  const [division, setDivision] = useState(staff ? (who.teacher?.teaches?.[0]?.division || 'D2A') : '')
  const s = useLoad(() => api('timetable', { query: staff ? { division } : {} }), [division])
  const byDay = useMemo(() => { const m = {}; for (const e of s.data?.entries || []) (m[e.day] = m[e.day] || []).push(e); return m }, [s.data])
  return (
    <div>
      {staff && <div className="mb-3 max-w-xs"><Field label="Division">{(id) => <select id={id} className={inputCls} value={division} onChange={(e) => setDivision(e.target.value)}>{(divs.data || []).map((d) => <option key={d.code}>{d.code}</option>)}</select>}</Field></div>}
      <Loading s={s}>
        {!s.data?.entries?.length ? <Empty icon="calendar" title={s.data?.division ? `No timetable for ${s.data.division}` : 'Join your class first'}>{s.data?.message}</Empty> : (
          <>
            <p className="mb-3 text-[13px] text-muted">{s.data.division} · {s.data.term} · published {relTime(s.data.publishedAt)}. Ask your teacher if something looks wrong.</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Object.keys(byDay).map((d) => (
                <Card key={d}><CardTitle>{DAY_NAMES[d]}</CardTitle>
                  <ul className="mt-2 flex flex-col divide-y divide-line">
                    {byDay[d].map((e, i) => (
                      <li key={i} className="flex gap-3 py-2 text-[13.5px]">
                        <span className="w-[92px] shrink-0 font-semibold tabular-nums">{hhmm(e.start_min)}–{hhmm(e.end_min)}</span>
                        <span className="min-w-0"><span className="font-semibold">{e.subject_name || e.subject}</span>{e.type !== 'Lecture' && <Badge className="ml-1.5">{e.type}</Badge>}{e.batch && <Badge tone="info" className="ml-1.5">Batch {e.batch}</Badge>}
                          <span className="block text-muted">{[e.teacher_name || e.teacher_code, e.room && `Room ${e.room}`].filter(Boolean).join(' · ') || ' '}</span></span>
                      </li>))}
                  </ul>
                </Card>))}
            </div>
          </>)}
      </Loading>
    </div>
  )
}

/* ---------- Teacher / HOD: post to classes ---------- */
function Composer({ who, onPosted }) {
  const { pushToast } = useApp()
  const divs = useDivisions()
  const allowed = who.admin ? (divs.data || []).map((d) => d.code) : [...new Set(who.teacher.teaches.map((t) => t.division))]
  const [f, setF] = useState({ kind: 'announcement', title: '', body: '', divisions: [] })
  const [file, setFile] = useState(null)
  const [step, setStep] = useState('edit')
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const pick = (e) => {
    const x = e.target.files?.[0]; setErr('')
    if (!x) return setFile(null)
    if (!UPLOAD_TYPES[x.type]) { setErr('Allowed files: PDF, Word, PowerPoint, Excel, PNG, JPG or text.'); e.target.value = ''; return }
    if (x.size > MAX_UPLOAD) { setErr('Files can be up to 3 MB.'); e.target.value = ''; return }
    setFile(x)
  }
  const review = (e) => {
    e.preventDefault(); setErr('')
    if (f.title.trim().length < 3) return setErr('Give the post a title (at least 3 characters).')
    if (!f.divisions.length) return setErr('Choose at least one division.')
    if (f.kind === 'material' && !file) return setErr('Attach the material file.')
    setStep('review')
  }
  const publish = async () => {
    setStep('sending'); setResult(null)
    try {
      const fileBody = file ? { name: file.name, mime: file.type, dataBase64: await fileToBase64(file) } : undefined
      const r = await api('posts', { method: 'POST', body: { ...f, file: fileBody } })
      setResult({ ok: true, text: `Published to ${r.post.divisions.join(', ')}. Students in those classes see it on every device.` })
      pushToast('Published.'); setF({ kind: 'announcement', title: '', body: '', divisions: [] }); setFile(null); setStep('edit')
    } catch (e) { setResult({ ok: false, text: `Not published: ${e.message}` }); setStep('review') }
  }
  if (step !== 'edit') return (
    <Card className="max-w-2xl">
      <CardTitle eyebrow="Check before publishing">Review</CardTitle>
      <dl className="mt-3 grid grid-cols-[120px_1fr] gap-y-1.5 text-[14px]">
        <dt className="text-muted">Type</dt><dd>{f.kind === 'material' ? 'Material' : 'Announcement'}</dd>
        <dt className="text-muted">Title</dt><dd className="font-semibold">{f.title}</dd>
        <dt className="text-muted">Goes to</dt><dd>{f.divisions.map((d) => <Badge key={d} tone="info" className="mr-1">{d}</Badge>)}<span className="block text-[12.5px] text-muted">Only approved students of these divisions can see it.</span></dd>
        {file && <><dt className="text-muted">File</dt><dd>{file.name} · {fmtBytes(file.size)}</dd></>}
      </dl>
      {result && !result.ok && <p role="alert" className="mt-3 text-[13.5px] text-bad">{result.text}</p>}
      <div className="mt-4 flex gap-2"><Button onClick={publish} disabled={step === 'sending'}>{step === 'sending' ? 'Publishing…' : 'Publish'}</Button><Button variant="ghost" onClick={() => setStep('edit')} disabled={step === 'sending'}>Back to edit</Button></div>
    </Card>)
  return (
    <Card className="max-w-2xl">
      <form onSubmit={review} className="flex flex-col gap-4" noValidate>
        {result?.ok && <p role="status" className="rounded-lg bg-[#E7F4EC] px-3 py-2 text-[13.5px] text-ok">{result.text} <button type="button" className="underline" onClick={onPosted}>See my posts</button></p>}
        <Segmented label="Post type" value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'announcement', label: 'Announcement' }, { value: 'material', label: 'Material (file)' }]} />
        <Field label="Title">{(id) => <input id={id} className={inputCls} maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Message (optional)">{(id) => <textarea id={id} rows={4} className={inputCls} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <Field label={f.kind === 'material' ? 'File' : 'File (optional)'} hint="PDF, Word, PowerPoint, Excel, PNG, JPG or text · up to 3 MB">{(id) => <input id={id} type="file" accept={Object.keys(UPLOAD_TYPES).join(',')} onChange={pick} className="text-[13.5px]" />}</Field>
        <fieldset><legend className="mb-1.5 text-[13.5px] font-semibold">Send to divisions</legend>
          {!allowed.length ? <p className="text-[13px] text-muted">You have no divisions assigned yet. Ask the HOD to add them to your teacher record.</p> : (
            <div className="flex flex-wrap gap-2">{allowed.map((d) => {
              const on = f.divisions.includes(d)
              return <button type="button" key={d} aria-pressed={on} onClick={() => setF({ ...f, divisions: on ? f.divisions.filter((x) => x !== d) : [...f.divisions, d] })} className={cx('press min-h-[36px] rounded-lg px-3 text-[13px] font-semibold ring-1', on ? 'bg-brand text-white ring-brand' : 'bg-surface ring-line')}>{d}</button>
            })}</div>)}
        </fieldset>
        {err && <p role="alert" className="text-[13.5px] text-bad">{err}</p>}
        <div><Button type="submit">Review</Button></div>
      </form>
    </Card>
  )
}
function MyPosts() {
  const { pushToast, now } = useApp()
  const s = useLoad(() => api('posts').then((r) => r.posts), [])
  const del = async (id) => { try { await api('posts', { method: 'DELETE', query: { id } }); pushToast('Deleted.'); s.reload() } catch (e) { pushToast(e.message, 'bad') } }
  return <Loading s={s}>{!s.data?.length ? <Empty icon="send" title="No posts yet">Posts you publish appear here.</Empty> : <div className="flex flex-col gap-3">{s.data.map((p) => <PostCard key={p.id} p={p} now={now} onDelete={() => del(p.id)} />)}</div>}</Loading>
}

/* ---------- Timetable Schedule (Excel import) ---------- */
function TimetableSchedule() {
  const { pushToast } = useApp()
  const [term, setTerm] = useState('FE 2026-27 Sem I')
  const [phase, setPhase] = useState('idle') // idle | reading | checked | publishing
  const [res, setRes] = useState(null)
  const [readErr, setReadErr] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [div, setDiv] = useState('')
  const versions = useLoad(() => api('timetable-versions').then((r) => r.versions), [])
  const upload = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setReadErr(''); setRes(null); setConfirmed(false); setPhase('reading')
    try {
      const sheets = await readSheets(file)
      const r = await api('timetable-preview', { method: 'POST', body: { term, fileName: file.name, fileSize: file.size, sheets } }).catch((x) => (x.data && x.data.errors ? x.data : Promise.reject(x)))
      setRes({ ...r, fileName: file.name }); setDiv(r.divisions?.[0] || ''); setPhase('checked'); versions.reload()
    } catch (x) { setReadErr(x instanceof SheetError ? x.message : x.message); setPhase('idle') }
  }
  const publish = async () => {
    setPhase('publishing')
    try { const r = await api('timetable-publish', { method: 'POST', body: { versionId: res.versionId } }); pushToast(`Timetable published for ${r.divisions.length} division${r.divisions.length > 1 ? 's' : ''}.`); setRes(null); setPhase('idle'); versions.reload() }
    catch (x) { pushToast(x.message, 'bad'); setPhase('checked') }
  }
  const restore = async (id) => { try { await api('timetable-rollback', { method: 'POST', body: { versionId: id } }); pushToast('That version is now the published timetable.'); versions.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const rows = (res?.preview || []).filter((r) => r.division === div)
  return (
    <div className="flex flex-col gap-4">
      <Card className="max-w-3xl">
        <CardTitle eyebrow="Teacher portal">Timetable Schedule</CardTitle>
        <p className="mt-1 text-[13.5px] text-muted">Upload the timetable as an Excel file (.xlsx; .csv also works). Every row is checked first: unknown divisions, subjects or teachers, bad times, overlapping lectures and teachers booked in two places. Nothing reaches students until you confirm the preview.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Term name">{(id) => <input id={id} className={inputCls} value={term} maxLength={40} onChange={(e) => setTerm(e.target.value)} />}</Field>
          <label className={cx('press inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white', phase === 'reading' && 'pointer-events-none opacity-60')}>
            <Icon name="upload" size={16} />{phase === 'reading' ? 'Checking…' : 'Upload Excel file'}
            <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={upload} disabled={phase === 'reading'} />
          </label>
          <a className="text-[13.5px] font-semibold text-brand underline" href="/timetable-template.xlsx" download>Download the template</a>
        </div>
        {readErr && <p role="alert" className="mt-3 text-[13.5px] text-bad">{readErr}</p>}
      </Card>

      {res && !res.ok && (
        <Card className="max-w-3xl ring-1 ring-[#F6C9C3]">
          <CardTitle eyebrow={res.fileName}>{res.errors.length} problem{res.errors.length > 1 ? 's' : ''} to fix — nothing was published</CardTitle>
          <p className="mt-1 text-[13px] text-muted">The current timetable is unchanged. Fix these in the file and upload it again.</p>
          <ul className="mt-3 max-h-[420px] overflow-auto text-[13.5px]">{res.errors.map((e, i) => <li key={i} className="border-t border-line py-1.5"><span className="font-semibold">{e.sheet ? `Sheet "${e.sheet}"` : 'File'}{e.cell ? `, cell ${e.cell}` : e.row ? `, row ${e.row}` : ''}:</span> {e.message}</li>)}</ul>
        </Card>)}

      {res?.ok && (
        <Card>
          <CardTitle eyebrow={`${res.fileName} · ${res.term}`}>Preview: {res.rowCount} sessions for {res.divisions.length} division{res.divisions.length > 1 ? 's' : ''}</CardTitle>
          {res.warnings.length > 0 && <details className="mt-2 text-[13.5px]"><summary className="cursor-pointer font-semibold text-warn">{res.warnings.length} warning{res.warnings.length > 1 ? 's' : ''} to look at (these don’t block publishing)</summary><ul className="mt-2 max-h-[260px] overflow-auto">{res.warnings.map((w, i) => <li key={i} className="border-t border-line py-1">Sheet "{w.sheet}", row {w.row}: {w.message}</li>)}</ul></details>}
          <div className="mt-3 max-w-xs"><Field label="Preview division">{(id) => <select id={id} className={inputCls} value={div} onChange={(e) => setDiv(e.target.value)}>{res.divisions.map((d) => <option key={d}>{d}</option>)}</select>}</Field></div>
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[13px]"><thead className="text-muted"><tr>{['Day', 'Time', 'Subject', 'Teacher', 'Room', 'Batch', 'Type', 'Row'].map((h) => <th key={h} className="py-1.5 pr-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line"><td className="py-1.5 pr-3">{DAY_NAMES[r.day]}</td><td className="pr-3 tabular-nums">{hhmm(r.start)}–{hhmm(r.end)}</td><td className="pr-3 font-semibold">{r.subject}</td><td className="pr-3">{r.teacher || '—'}</td><td className="pr-3">{r.room}</td><td className="pr-3">{r.batch}</td><td className="pr-3">{r.type}</td><td className="text-muted">{r.row}</td></tr>)}</tbody></table></div>
          <label className="mt-4 flex items-start gap-2 text-[13.5px]"><input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I checked the preview. Publish it to {res.divisions.join(', ')}; it replaces their current timetable (the old one stays in the history and can be restored).</label>
          <div className="mt-3 flex gap-2"><Button onClick={publish} disabled={!confirmed || phase === 'publishing'}>{phase === 'publishing' ? 'Publishing…' : 'Publish timetable'}</Button><Button variant="ghost" onClick={() => { setRes(null); setPhase('idle') }}>Discard</Button></div>
        </Card>)}

      <Card>
        <CardTitle eyebrow="History">Published versions</CardTitle>
        <Loading s={versions}>{!versions.data?.filter((v) => v.status === 'published').length ? <p className="mt-2 text-[13.5px] text-muted">Nothing published yet.</p> : (
          <ul className="mt-2 text-[13.5px]">{versions.data.filter((v) => v.status === 'published').map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2">
              {v.current ? <Badge tone="ok">Current</Badge> : <Badge>Older</Badge>}<span className="font-semibold">{v.term}</span><span className="text-muted">{v.file_name} · {v.row_count} sessions · {v.divisions.length} divisions · by {v.uploader || '—'} · {relTime(v.published_at)}</span>
              {!v.current && <ConfirmButton size="sm" variant="secondary" className="ml-auto" confirmText="Restore this version" onConfirm={() => restore(v.id)}>Restore</ConfirmButton>}
            </li>))}</ul>)}</Loading>
      </Card>
    </div>
  )
}

/* ---------- CR / HOD: join requests ---------- */
function Requests({ who }) {
  const { pushToast, now } = useApp()
  const [filter, setFilter] = useState('pending')
  const [bump, setBump] = useState(0) // refreshes the class-rep list after a decision
  const s = useLoad(() => api('requests').then((r) => r.requests), [])
  const decide = async (r, decision) => {
    try { await api('decide', { method: 'POST', body: { accountId: r.account_id, division: r.division_code, decision } }); pushToast(decision === 'approve' ? `Approved for ${r.division_code}.` : 'Request rejected.'); s.reload(); setBump((b) => b + 1) }
    catch (e) { pushToast(e.message, 'bad') }
  }
  const list = (s.data || []).filter((r) => filter === 'all' || r.status === filter)
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardTitle eyebrow={who.admin ? 'All classes' : `Class representative · ${who.cr.join(', ')}`}>Join requests</CardTitle>
        <div className="mt-2"><Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: 'pending', label: 'Waiting' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'all', label: 'All' }]} /></div>
        <Loading s={s}>{!list.length ? <p className="mt-3 text-[13.5px] text-muted">Nothing here.</p> : (
          <ul className="mt-3 text-[13.5px]">{list.map((r) => (
            <li key={r.account_id + r.division_code} className="flex flex-wrap items-center gap-2 border-t border-line py-2">
              <span className="font-semibold">{r.name || 'No name yet'}</span><span className="text-muted">{r.phone}{r.roll ? ` · roll ${r.roll}` : ''} · {r.division_code} · {relTime(r.created_at, now)}</span>
              <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>{r.is_cr && <Badge tone="info">Class rep</Badge>}{r.decided_by_name && <span className="text-[12px] text-muted">by {r.decided_by_name}</span>}
              <span className="ml-auto flex gap-2">
                {(r.status === 'pending' || (who.admin && r.status === 'rejected')) && <Button size="sm" onClick={() => decide(r, 'approve')}>{r.status === 'rejected' ? 'Override: approve' : 'Approve'}</Button>}
                {(r.status === 'pending' || (who.admin && r.status === 'approved')) && <Button size="sm" variant="secondary" onClick={() => decide(r, 'reject')}>{r.status === 'approved' ? 'Override: remove' : 'Reject'}</Button>}
              </span>
            </li>))}</ul>)}</Loading>
        {!who.admin && <p className="mt-3 text-[12.5px] text-muted">You can decide waiting requests for your class only. The HOD can change any decision.</p>}
      </Card>
      {who.admin && <ClassReps bump={bump} />}
    </div>
  )
}
function ClassReps({ bump }) {
  const { pushToast } = useApp()
  const divs = useDivisions()
  const [division, setDivision] = useState('D2A')
  const s = useLoad(() => api('hod-students', { query: { division } }).then((r) => r.students), [division, bump])
  const act = async (st, action) => { try { await api('hod-cr', { method: 'POST', body: { accountId: st.id, division, action } }); pushToast(action === 'remove' ? 'Class rep removed.' : `${st.name || 'Student'} is now class rep of ${division}.`); s.reload() } catch (e) { pushToast(e.message, 'bad') } }
  return (
    <Card>
      <CardTitle eyebrow="HOD">Class representatives</CardTitle>
      <div className="mt-2 max-w-xs"><Field label="Division">{(id) => <select id={id} className={inputCls} value={division} onChange={(e) => setDivision(e.target.value)}>{(divs.data || []).map((d) => <option key={d.code}>{d.code}</option>)}</select>}</Field></div>
      <Loading s={s}>{!s.data?.length ? <p className="mt-2 text-[13.5px] text-muted">No approved students in {division} yet. A class rep must be an approved student of the class.</p> : (
        <ul className="mt-2 text-[13.5px]">{s.data.map((st) => (
          <li key={st.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2"><span className="font-semibold">{st.name || 'No name yet'}</span><span className="text-muted">{st.phone}{st.roll ? ` · roll ${st.roll}` : ''}</span>{st.is_cr && <Badge tone="info">Class rep</Badge>}
            <span className="ml-auto">{st.is_cr ? <Button size="sm" variant="secondary" onClick={() => act(st, 'remove')}>Remove as class rep</Button> : <Button size="sm" variant="secondary" onClick={() => act(st, 'appoint')}>Make class rep</Button>}</span></li>))}</ul>)}</Loading>
    </Card>
  )
}

/* ---------- HOD: teacher whitelist ---------- */
function TeacherList() {
  const { pushToast } = useApp()
  const divs = useDivisions()
  const s = useLoad(() => api('hod-teachers').then((r) => r.teachers), [])
  const blank = { phone: '', name: '', code: '', canPublishTimetable: true, teaches: [{ division: '', subject: '' }] }
  const [f, setF] = useState(blank)
  const [err, setErr] = useState('')
  const setRow = (i, k, v) => setF({ ...f, teaches: f.teaches.map((t, j) => (j === i ? { ...t, [k]: v } : t)) })
  const save = async (e) => {
    e.preventDefault(); setErr('')
    try { await api('hod-teachers', { method: 'POST', body: { ...f, teaches: f.teaches.filter((t) => t.division || t.subject) } }); pushToast('Teacher saved. They can now sign in on the Teacher tab.'); setF(blank); s.reload() }
    catch (x) { setErr(x.message) }
  }
  const remove = async (phone) => { try { await api('hod-teachers', { method: 'DELETE', query: { phone } }); pushToast('Removed from the teacher list.'); s.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const edit = (t) => setF({ phone: t.phone.replace('+91', ''), name: t.name, code: t.code, canPublishTimetable: t.can_publish_timetable, teaches: t.teaches.length ? t.teaches : blank.teaches })
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <Card>
        <CardTitle eyebrow="Only these numbers can open the Teacher portal">Teacher list</CardTitle>
        <Loading s={s}>{!s.data?.length ? <p className="mt-2 text-[13.5px] text-muted">No teachers added here yet{' '}(numbers in the server’s TEACHER_PHONES setting also count).</p> : (
          <ul className="mt-2 text-[13.5px]">{s.data.map((t) => (
            <li key={t.phone} className="flex flex-wrap items-center gap-2 border-t border-line py-2">
              <span className="font-semibold">{t.name || 'No name'}</span>{t.code && <Badge>{t.code}</Badge>}<span className="text-muted">{t.phone}</span>
              <span className="w-full text-[12.5px] text-muted">{t.teaches.map((x) => `${x.division}: ${x.subject}`).join(' · ')}{t.can_publish_timetable ? ' · can publish timetables' : ''}</span>
              <span className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => edit(t)}>Edit</Button><ConfirmButton size="sm" variant="ghost" confirmText="Remove access" onConfirm={() => remove(t.phone)}>Remove</ConfirmButton></span>
            </li>))}</ul>)}</Loading>
      </Card>
      <Card>
        <CardTitle eyebrow="Add or update">Teacher</CardTitle>
        <form onSubmit={save} className="mt-2 flex flex-col gap-3" noValidate>
          <Field label="Mobile number" hint="The number they sign in with">{(id) => <input id={id} className={inputCls} inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="Name">{(id) => <input id={id} className={inputCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Initials" hint="As in the timetable">{(id) => <input id={id} className={inputCls} value={f.code} maxLength={12} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
          </div>
          <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-[13.5px] font-semibold">Classes they teach</legend>
            {f.teaches.map((t, i) => (
              <div key={i} className="grid grid-cols-[110px_1fr_auto] gap-2">
                <select aria-label="Division" className={inputCls} value={t.division} onChange={(e) => setRow(i, 'division', e.target.value)}><option value="">Division</option>{(divs.data || []).map((d) => <option key={d.code}>{d.code}</option>)}</select>
                <input aria-label="Subject" className={inputCls} placeholder="Subject" value={t.subject} onChange={(e) => setRow(i, 'subject', e.target.value)} />
                <Button type="button" size="sm" variant="ghost" aria-label="Remove row" onClick={() => setF({ ...f, teaches: f.teaches.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></Button>
              </div>))}
            <div><Button type="button" size="sm" variant="secondary" onClick={() => setF({ ...f, teaches: [...f.teaches, { division: '', subject: '' }] })}>Add a class</Button></div>
          </fieldset>
          <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={f.canPublishTimetable} onChange={(e) => setF({ ...f, canPublishTimetable: e.target.checked })} />Can upload and publish timetables</label>
          {err && <p role="alert" className="text-[13.5px] text-bad">{err}</p>}
          <div className="flex gap-2"><Button type="submit">Save teacher</Button>{f.phone && <Button type="button" variant="ghost" onClick={() => setF(blank)}>Clear</Button>}</div>
        </form>
      </Card>
    </div>
  )
}

/* ---------- HOD: audit log ---------- */
const ACTION_TEXT = { 'account.create': 'Account created', 'teacher.upsert': 'Teacher added/updated', 'teacher.remove': 'Teacher removed', 'post.create': 'Posted', 'post.delete': 'Post deleted', 'join.request': 'Asked to join', 'join.approve': 'Join approved', 'join.reject': 'Join rejected', 'cr.appoint': 'Class rep appointed', 'cr.remove': 'Class rep removed', 'timetable.preview': 'Timetable checked', 'timetable.publish': 'Timetable published', 'timetable.rollback': 'Timetable restored' }
function AuditLog() {
  const { pushToast, now } = useApp()
  const [rows, setRows] = useState([])
  const s = useLoad(() => api('hod-audit').then((r) => { setRows(r.entries); return r.entries }), [])
  const more = async () => { try { const r = await api('hod-audit', { query: { before: rows[rows.length - 1].id } }); setRows((x) => [...x, ...r.entries]) } catch (e) { pushToast(e.message, 'bad') } }
  return (
    <Card>
      <CardTitle eyebrow="Who did what, and when">Audit log</CardTitle>
      <Loading s={s}><ul className="mt-2 text-[13.5px]">{rows.map((r) => (
        <li key={r.id} className="flex flex-wrap gap-x-2 border-t border-line py-1.5"><span className="w-[110px] shrink-0 text-muted">{relTime(r.at, now)}</span><span className="font-semibold">{ACTION_TEXT[r.action] || r.action}</span><span className="text-muted">{r.actor_name || '—'}{r.detail?.divisions ? ` · ${[].concat(r.detail.divisions).join(', ')}` : ''}{r.detail?.term ? ` · ${r.detail.term}` : ''}{r.detail?.override ? ' · HOD override' : ''}{r.target && r.action.startsWith('join') ? ` · ${r.target.split(':')[0]}` : ''}</span></li>))}</ul>
        {rows.length >= 100 && rows.length % 100 === 0 && <Button className="mt-2" variant="secondary" onClick={more}>Load older</Button>}</Loading>
    </Card>
  )
}

export { TimetableSchedule }
