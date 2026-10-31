import { useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Empty, Dialog, Field, Segmented, inputCls, relTime, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { FilePicker, ResourceViewer } from './Challenges.jsx'
import { requestNotes, requestsFor, setNoteRequestStatus, REQ_STATUS, addNote, browseNotes, updateNote, removeNote, reportNote, openReports, NOTE_TYPES, NOTE_MAX_MB, REPORT_REASONS, HIDE_AFTER } from '../lib/notes.js'
import { putFile, deleteFile, checkFile, fmtSize, typesLabel } from '../lib/files.js'
import { YEARS, BRANCHES, subjectsFor, yearLabel, branchLabel } from '../data/academics.js'
import { isAdmin, isStudent } from '../lib/posts.js'

/** Shared study library: year → branch → subject → topic/chapter → subtopic → file. */
export default function Notes({ query = {} }) {
  const { db, me } = useApp()
  const [tab, setTab] = useState(query.tab === 'requests' ? 'requests' : 'library')
  const [answering, setAnswering] = useState(null)
  const openReqs = requestsFor(db.shared, me).filter((r) => r.status === REQ_STATUS.OPEN).length
  const [f, setF] = useState({ year: me.year || '', branch: me.branchId || '', subject: '', topic: '', subtopic: '', type: '', q: '', sort: 'new', mine: false })
  const [uploading, setUploading] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [open, setOpen] = useState(null)
  const all = useMemo(() => browseNotes(db.shared, me, { year: f.year, branch: f.branch }), [db.shared, me, f.year, f.branch])
  const subjects = [...new Set(all.map((n) => n.subject))].sort()
  const topics = [...new Set(all.filter((n) => !f.subject || n.subject === f.subject).map((n) => n.topic))].sort()
  const subtopics = [...new Set(all.filter((n) => (!f.subject || n.subject === f.subject) && (!f.topic || n.topic === f.topic)).map((n) => n.subtopic).filter(Boolean))].sort()
  const list = browseNotes(db.shared, me, f)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value, ...(k === 'year' || k === 'branch' ? { subject: '', topic: '', subtopic: '' } : k === 'subject' ? { topic: '', subtopic: '' } : k === 'topic' ? { subtopic: '' } : {}) })
  // Phones: year, branch and search stay visible; the rest of the filters fold behind "More filters" (same filters).
  const more = showMore ? '' : 'max-sm:hidden'
  const extraOn = ['subject', 'topic', 'subtopic', 'type'].filter((k) => f[k]).length + (f.sort !== 'new' ? 1 : 0) + (f.mine ? 1 : 0)
  const sel = (k, label, opts, cls = '') => <label className={cx('flex min-w-[130px] flex-1 flex-col gap-1 text-[12px] font-semibold text-muted', cls)}>{label}<select className={inputCls} value={f[k]} onChange={set(k)}><option value="">All</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
  return (
    <div>
      <PageHeader back title="Notes library" subtitle="Study material shared by students and teachers, organised by year, branch, subject, chapter and subtopic." actions={<Button icon="upload" onClick={() => setUploading(true)}>Share notes</Button>} />
      <div className="mb-4"><Segmented label="Notes section" value={tab} onChange={setTab} options={[{ value: 'library', label: 'Library' }, { value: 'requests', label: `Requests (${openReqs} open)` }]} /></div>
      {tab === 'requests' ? <NoteRequests onAnswer={setAnswering} /> : <>
      <Card className="mb-4 flex flex-col gap-3 !p-4">
        <label className="relative"><span className="sr-only">Search notes</span><Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className={cx(inputCls, 'pl-9')} placeholder="Search titles, chapters, keywords" value={f.q} onChange={set('q')} /></label>
        <div className="flex flex-wrap gap-2">
          {sel('year', 'Year', YEARS.map((y) => [y.id, y.label]))}{sel('branch', 'Branch', BRANCHES.map((b) => [b.id, b.label]))}
          {sel('subject', 'Subject', subjects.map((s) => [s, s]), more)}{sel('topic', 'Topic / chapter', topics.map((s) => [s, s]), more)}{sel('subtopic', 'Subtopic', subtopics.map((s) => [s, s]), more)}
          {sel('type', 'File type', [['pdf', 'PDF'], ['image', 'Image']], more)}
          <label className={cx('flex min-w-[130px] flex-col gap-1 text-[12px] font-semibold text-muted', more)}>Sort<select className={inputCls} value={f.sort} onChange={set('sort')}><option value="new">Newest</option><option value="old">Oldest</option><option value="title">Title A–Z</option></select></label>
        </div>
        <label className={cx('flex items-center gap-2 text-[13.5px]', more)}><input type="checkbox" className="h-4 w-4" checked={f.mine} onChange={set('mine')} />Only my uploads</label>
        <button type="button" onClick={() => setShowMore(!showMore)} aria-expanded={showMore} className="press -mb-1 inline-flex min-h-[40px] items-center gap-1.5 self-start rounded-lg px-1 text-[13.5px] font-semibold text-maroon sm:hidden"><Icon name="layers" size={15} />{showMore ? 'Fewer filters' : `More filters${extraOn ? ` (${extraOn} on)` : ''}`}</button>
      </Card>
      <p className="mb-2 text-[12.5px] text-muted" aria-live="polite">{list.length} note{list.length === 1 ? '' : 's'}</p>
      <div className="stagger grid gap-3 md:grid-cols-2">
        {list.length ? list.map((n) => (
          <Card key={n.id} interactive className="!p-4">
            <button className="flex w-full gap-3 text-left" onClick={() => setOpen(n.id)}>
              <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-brand-50 text-brand"><Icon name="file" size={19} /></span>
              <span className="min-w-0 flex-1"><b className="block text-[15px] font-semibold">{n.title}</b>
                <small className="block text-[12.5px] text-muted">{yearLabel(n.year)} · {branchLabel(n.branch)} · {n.subject}</small>
                <small className="block text-[12.5px] text-[#33443B]">{n.topic}{n.subtopic ? ` › ${n.subtopic}` : ''}</small>
                <small className="mt-1 block text-[11.5px] text-muted">{n.uploaderName} · {relTime(n.at)} · {fmtSize(n.file.size)} {n.scope === 'group' ? '· your year & branch only' : ''}</small></span>
            </button>
          </Card>
        )) : <div className="md:col-span-2"><Empty icon="file" title="No notes found" action={<Button size="sm" icon="upload" onClick={() => setUploading(true)}>Share the first one</Button>}>Try fewer filters, or share your own notes.</Empty></div>}
      </div>
      </>}
      <Dialog open={uploading} onClose={() => setUploading(false)} title="Share notes" wide>{uploading && <NoteForm onDone={() => setUploading(false)} />}</Dialog>
      <Dialog open={!!answering} onClose={() => setAnswering(null)} title="Share notes for this request" wide>{answering && <NoteForm preset={answering} onDone={() => setAnswering(null)} />}</Dialog>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={db.shared.notes.find((n) => n.id === open)?.title || 'Note'} wide>{open && <NoteDetail id={open} onClose={() => setOpen(null)} />}</Dialog>
    </div>
  )
}

function NoteForm({ onDone, existing, preset }) {
  const { me, runShared } = useApp()
  const [f, setF] = useState(existing || { title: '', description: '', year: preset?.year || me.year || '1', branch: preset?.branch || me.branchId || 'CS', subject: preset?.subject || '', topic: preset?.topic || '', subtopic: '', scope: 'all', fulfils: preset?.id })
  const [files, setFiles] = useState([])
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    if (existing) { const r = runShared((s) => updateNote(s, existing.id, f, me, new Date()), 'Note updated.'); if (r.ok) onDone(); else setErrors(r.errors || { form: r.error }); return }
    const m = await checkFile(files[0], { types: NOTE_TYPES, maxMB: NOTE_MAX_MB })
    if (m) return setErrors({ file: m })
    setBusy(true)
    let meta
    try { meta = await putFile(files[0]) } catch { setBusy(false); return setErrors({ file: 'The file couldn’t be saved. Nothing was shared.' }) }
    const r = runShared((s) => addNote(s, f, meta, me, new Date()), 'Notes shared. Thank you!')
    setBusy(false)
    if (!r.ok) { await deleteFile(meta.fileId); setErrors(r.errors || { form: r.error }) } else onDone()
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      {preset && <p className="rounded-lg bg-brand-50 px-3 py-2 text-[13px]">Answering <b>{preset.userName}</b>’s request: {preset.subject} · {preset.topic}. They’ll be notified when you share.</p>}
      <Field label="Title" error={errors.title}>{(id) => <input id={id} className={inputCls} maxLength={120} value={f.title} onChange={set('title')} />}</Field>
      <Field label="Description (optional)">{(id) => <textarea id={id} rows={2} maxLength={600} className={cx(inputCls, 'py-2')} value={f.description} onChange={set('description')} />}</Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Year" error={errors.year}>{(id) => <select id={id} className={inputCls} value={f.year} onChange={set('year')}>{YEARS.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select>}</Field>
        <Field label="Branch" error={errors.branch}>{(id) => <select id={id} className={inputCls} value={f.branch} onChange={set('branch')}>{BRANCHES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>}</Field>
        <Field label="Subject" error={errors.subject}>{(id) => <><input id={id} list="note-subjects" className={inputCls} value={f.subject} onChange={set('subject')} /><datalist id="note-subjects">{subjectsFor(f.year).map((s) => <option key={s} value={s} />)}</datalist></>}</Field>
        <Field label="Topic / chapter" error={errors.topic}>{(id) => <input id={id} className={inputCls} placeholder="e.g. Chapter 3: Laplace" value={f.topic} onChange={set('topic')} />}</Field>
        <Field label="Subtopic (optional)">{(id) => <input id={id} className={inputCls} value={f.subtopic} onChange={set('subtopic')} />}</Field>
        <Field label="Who can see it">{(id) => <select id={id} className={inputCls} value={f.scope} onChange={set('scope')}><option value="all">Everyone at the institute</option><option value="group">Only this year & branch</option></select>}</Field>
      </div>
      {!existing && <FilePicker label={`File (${typesLabel(NOTE_TYPES)}, up to ${NOTE_MAX_MB} MB)`} files={files} setFiles={setFiles} limits={{ types: NOTE_TYPES, maxMB: NOTE_MAX_MB }} max={1} />}
      {(errors.file || errors.form) && <p role="alert" className="text-[13.5px] text-bad">{errors.file || errors.form}</p>}
      <p className="text-[12px] text-muted">Only share material you're allowed to share. Your name is shown as the uploader.</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit" disabled={busy || (!existing && !files.length)}>{busy ? 'Saving…' : existing ? 'Save' : 'Share'}</Button></div>
    </form>
  )
}

function NoteDetail({ id, onClose }) {
  const { db, me, runShared } = useApp()
  const n = db.shared.notes.find((x) => x.id === id)
  const [edit, setEdit] = useState(false)
  const [rep, setRep] = useState({ reason: REPORT_REASONS[0], details: '', open: false })
  if (!n) return <Empty title="Removed">This note is no longer available.</Empty>
  const mine = n.uploaderId === me.id || isAdmin(me)
  const reports = openReports(db.shared, id)
  if (edit) return <NoteForm existing={n} onDone={() => setEdit(false)} />
  return (
    <div className="flex flex-col gap-3 text-[14px]">
      <p className="text-[13px] text-muted">{yearLabel(n.year)} › {branchLabel(n.branch)} › {n.subject} › {n.topic}{n.subtopic ? ` › ${n.subtopic}` : ''} · shared by {n.uploaderName} · {relTime(n.at)}</p>
      {n.description && <p>{n.description}</p>}
      <ResourceViewer files={[n.file]} />
      {isAdmin(me) && reports.length > 0 && <p className="rounded-lg bg-[#FDF0D8] px-3 py-2 text-[13px] text-warn">{reports.length} open report{reports.length > 1 ? 's' : ''}: {reports.map((r) => r.reason).join(', ')}{reports.length >= HIDE_AFTER ? ' · hidden from students pending review' : ''}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {mine && <><Button size="sm" variant="secondary" icon="edit" onClick={() => setEdit(true)}>Edit details</Button><Button size="sm" variant="secondary" className="!text-bad" onClick={() => { if (confirm('Remove this note for everyone?')) { runShared((s) => removeNote(s, id, me), 'Note removed.'); deleteFile(n.file.fileId); onClose() } }}>Remove</Button></>}
        {!mine && <Button size="sm" variant="secondary" icon="alert" onClick={() => setRep({ ...rep, open: !rep.open })}>Report</Button>}
      </div>
      {rep.open && <form className="flex flex-col gap-2 rounded-xl border border-line p-3" onSubmit={(e) => { e.preventDefault(); const r = runShared((s) => reportNote(s, id, me, rep.reason, rep.details, new Date()), 'Reported. An admin will review it.'); if (r.ok) setRep({ ...rep, open: false }) }}>
        <Field label="Reason">{(fid) => <select id={fid} className={inputCls} value={rep.reason} onChange={(e) => setRep({ ...rep, reason: e.target.value })}>{REPORT_REASONS.map((x) => <option key={x}>{x}</option>)}</select>}</Field>
        <Field label="Details (optional)">{(fid) => <input id={fid} className={inputCls} maxLength={300} value={rep.details} onChange={(e) => setRep({ ...rep, details: e.target.value })} />}</Field>
        <div className="flex justify-end"><Button size="sm" type="submit">Send report</Button></div>
      </form>}
    </div>
  )
}

/** Notes requests: students ask for a course/topic; classmates or teachers answer by sharing a note. */
function NoteRequests({ onAnswer }) {
  const { db, me, runShared } = useApp()
  const [f, setF] = useState({ subject: '', topic: '', details: '' })
  const [errors, setErrors] = useState({})
  const [show, setShow] = useState('open')
  const all = requestsFor(db.shared, me)
  const mine = all.filter((r) => r.userId === me.id)
  const others = all.filter((r) => r.userId !== me.id && (show === 'all' || r.status === REQ_STATUS.OPEN))
  const student = isStudent(me)
  const submit = (e) => {
    e.preventDefault()
    const r = runShared((s) => requestNotes(s, f, me, new Date()), 'Request posted. Classmates and teachers can answer it.')
    if (r.ok) { setF({ subject: '', topic: '', details: '' }); setErrors({}) } else setErrors(r.errors || { form: r.error })
  }
  const TONE = { [REQ_STATUS.OPEN]: 'warn', [REQ_STATUS.FULFILLED]: 'ok', [REQ_STATUS.CLOSED]: 'neutral' }
  const noteTitle = (id) => db.shared.notes.find((n) => n.id === id)?.title
  const Row = ({ r, own }) => (
    <li className="flex flex-wrap items-start gap-2 rounded-xl border border-line p-3">
      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5"><Badge tone={TONE[r.status]}>{r.status}</Badge>{r.demo && <Badge tone="demo">Sample</Badge>}</span>
        <b className="mt-1 block text-[14.5px]">{r.subject} · {r.topic}</b>
        {r.details && <small className="block text-[13px] text-[#33443B]">{r.details}</small>}
        <small className="mt-0.5 block text-[12px] text-muted">{own ? 'You asked' : r.userName} · {relTime(r.at)}{r.status === REQ_STATUS.FULFILLED ? ` · answered by ${r.fulfilledBy}${noteTitle(r.noteId) ? `: “${noteTitle(r.noteId)}”` : ''}` : ''}</small></span>
      <span className="flex flex-wrap gap-1.5">
        {own && r.status === REQ_STATUS.OPEN && <Button size="sm" variant="secondary" onClick={() => runShared((s) => setNoteRequestStatus(s, r.id, REQ_STATUS.CLOSED, me), 'Request closed.')}>Close</Button>}
        {own && r.status === REQ_STATUS.CLOSED && <Button size="sm" variant="secondary" onClick={() => runShared((s) => setNoteRequestStatus(s, r.id, REQ_STATUS.OPEN, me), 'Request reopened.')}>Reopen</Button>}
        {!own && r.status === REQ_STATUS.OPEN && <Button size="sm" icon="upload" onClick={() => onAnswer(r)}>Share notes for this</Button>}
      </span>
    </li>
  )
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      {student ? <Card className="h-fit">
        <CardTitle eyebrow="Can’t find something?">Request notes</CardTitle>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <Field label="Course / subject" error={errors.subject}>{(id) => <><input id={id} list="req-subjects" maxLength={80} className={inputCls} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /><datalist id="req-subjects">{subjectsFor(me.year || '1').map((s) => <option key={s} value={s} />)}</datalist></>}</Field>
          <Field label="Topic / chapter" error={errors.topic}>{(id) => <input id={id} maxLength={120} className={inputCls} placeholder="e.g. Laplace transform" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} />}</Field>
          <Field label="Details (optional)" error={errors.details}>{(id) => <textarea id={id} rows={2} maxLength={300} className={cx(inputCls, 'py-2')} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />}</Field>
          {errors.form && <p role="alert" className="text-[13.5px] text-bad">{errors.form}</p>}
          <Button type="submit" icon="send">Post request</Button>
          <p className="text-[12px] text-muted">Visible to students of your year and branch, and to teachers.</p>
        </form>
        <h3 className="mt-5 text-[13px] font-bold uppercase tracking-wider text-muted">My requests</h3>
        {mine.length ? <ul className="mt-2 flex flex-col gap-2">{mine.map((r) => <Row key={r.id} r={r} own />)}</ul> : <p className="mt-2 text-[13px] text-muted">You haven’t asked for anything yet.</p>}
      </Card> : <Card className="h-fit"><CardTitle eyebrow="Teachers">Answer requests</CardTitle><p className="text-[13.5px] text-muted">Students ask for notes on a course and topic. Share a file to answer; the student is notified and the request is marked fulfilled.</p></Card>}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-[18px] font-semibold">{student ? 'Requests from your year & branch' : 'Students’ requests'}</h2><Segmented label="Requests shown" value={show} onChange={setShow} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} /></div>
        {others.length ? <ul className="flex flex-col gap-2">{others.map((r) => <Row key={r.id} r={r} />)}</ul> : <Empty icon="file" title="No open requests">{student ? 'When classmates ask for notes, you can answer here.' : 'Nothing is waiting for an answer.'}</Empty>}
      </div>
    </div>
  )
}
