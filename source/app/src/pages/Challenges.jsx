import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Field, inputCls, Dialog, Empty, Segmented, DemoTag, relTime, cx, AnimatedNumber } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { isClassRep, authorRole, postChallenge, canManageChallenges, updateChallenge, deleteChallenge, setChallengeStatus, completeChallenge, leaderboard, eligible, canView, audienceText, hasCompleted, validateChallenge, needsSubmission, mySubmissions, submissionsFor, canSubmit, canReview, submitSolution, reviewSubmission, addResources, DEFAULT_SUBMISSION, SUB } from '../lib/challenges.js'
import { putFile, getFile, deleteFile, checkFile, kindOf, fmtSize, typesLabel, filesPersistent, FILE_KINDS } from '../lib/files.js'
import { CLASSES, CLASS_LABEL } from '../data/config.js'

const SUB_TONE = { [SUB.SUBMITTED]: 'warn', [SUB.ACCEPTED]: 'ok', [SUB.CHANGES]: 'info', [SUB.REJECTED]: 'bad', [SUB.SUPERSEDED]: 'neutral' }
const RES_LIMIT = { types: ['pdf', 'jpg', 'png'], maxMB: 10 }

export default function Challenges({ query = {} }) {
  const { me } = useApp()
  return canManageChallenges(me) ? <TeacherChallenges query={query} /> : <StudentChallenges query={query} />
}

/** Students: view challenges for their division, open briefs, complete or submit solutions. No create/edit/delete. */
function StudentChallenges({ query = {} }) {
  const { db, me, now, runShared } = useApp()
  const sh = db.shared
  const [filter, setFilter] = useState(query.id ? 'all' : 'mine')
  const [flash, setFlash] = useState(null)
  const [posting, setPosting] = useState(false)
  const [viewing, setViewing] = useState(null)   // challenge whose resources are open
  const [submitting, setSubmitting] = useState(null)
  useEffect(() => { if (!query.id) return; const t = setTimeout(() => { const el = document.getElementById('ch-' + query.id); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash') } }, 120); return () => clearTimeout(t) }, [query.id])
  const lb = leaderboard(sh)
  const list = sh.challenges
    .filter((c) => canView(c, me) && c.status !== 'archived' && (filter === 'mine' ? eligible(c, me) || c.createdBy === me.id : true))
    .sort((a, b) => Number(hasCompleted(sh, a.id, me.id)) - Number(hasCompleted(sh, b.id, me.id)) || b.points - a.points)

  const complete = (c) => {
    const r = runShared((s) => completeChallenge(s, c.id, me, new Date()), `+${c.points} points for ${me.classId}!`)
    if (r.ok) setFlash(me.classId)
  }
  return (
    <div>
      <PageHeader back title="Class challenges" subtitle="Challenges from your teachers and your class rep. Complete them or upload a solution, and climb the live leaderboard." actions={isClassRep(me) && <Button icon="plus" onClick={() => setPosting(true)}>Post for {me.division}</Button>} />
      {isClassRep(me) && <p className="-mt-2 mb-4 text-[13px] text-muted">You’re the class rep for {me.division}, so you can post challenges for your class.</p>}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div>
          <div className="mb-3"><Segmented label="Challenge filter" value={filter} onChange={setFilter} options={[{ value: 'mine', label: `For ${me.classId || 'my class'}` }, { value: 'all', label: 'All classes' }]} /></div>
          <div className="stagger flex flex-col gap-3">
            {list.length ? list.map((c) => {
              const done = hasCompleted(sh, c.id, me.id)
              const can = eligible(c, me)
              const closed = c.deadline && Date.parse(c.deadline) < now.getTime()
              const count = sh.completions.filter((x) => x.challengeId === c.id).length
              return (
                <Card key={c.id} id={'ch-' + c.id} interactive className={cx('!p-4', done && 'border-[#C9E6D4] bg-[#F7FBF8]')}>
                  <div className="flex items-start gap-3.5">
                    <span className={cx('grid h-12 w-12 flex-none place-items-center rounded-lg font-display text-[17px] font-semibold', done ? 'bg-ok text-white' : 'bg-maroon-50 text-maroon ring-1 ring-maroon/15')}>{done ? <Icon name="check" size={22} stroke={2.4} /> : `+${c.points}`}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[15.5px] font-semibold leading-snug">{c.title}</h3>
                      <p className="mt-0.5 text-[13.5px] text-muted">{c.description}</p>
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">{authorRole(c) === 'teacher' ? <Badge tone="ok" icon="book">Teacher challenge</Badge> : authorRole(c) === 'classRep' ? <Badge tone="warn" icon="user">Class rep challenge</Badge> : <Badge>Student challenge</Badge>}<Badge tone="info">{c.audience ? audienceText(c) : CLASS_LABEL[c.classId] || c.classId}</Badge>{c.status === 'closed' && <Badge>Closed</Badge>}{c.deadline && <span className="inline-flex items-center gap-1"><Icon name="clock" size={12} />{closed ? 'Closed' : `Closes ${relTime(c.deadline, now)}`}</span>}<span>· {count} completed</span><span>· by {c.createdByName}</span><DemoTag show={c.demo} /></p>
                      {needsSubmission(c) && <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-ground px-2 py-1 text-[12px] text-[#3B4048]"><Icon name="upload" size={13} />Solution upload required · {typesLabel(c.submission.types)} up to {c.submission.maxMB} MB · points on acceptance</p>}
                      <MySubmissionLine c={c} />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
                    {(c.attachments || []).length > 0 && <Button size="sm" variant="secondary" icon="file" onClick={() => setViewing(c)}>View challenge brief ({c.attachments.length})</Button>}
                    {c.createdBy === me.id && isClassRep(me) && (c.status === 'closed' ? <Button size="sm" variant="secondary" onClick={() => runShared((s) => setChallengeStatus(s, c.id, 'open', me, new Date()), 'Challenge reopened.')}>Reopen</Button> : <Button size="sm" variant="secondary" onClick={() => runShared((s) => setChallengeStatus(s, c.id, 'closed', me, new Date()), 'Challenge closed.')}>Close</Button>)}
                    <span className="flex-1" />
                    {c.createdBy === me.id ? <span className="text-sm text-muted">Posted by you</span>
                      : done ? <Badge tone="ok" icon="check">Completed · {c.points} points recorded</Badge>
                      : !can ? <span className="text-sm text-muted">Only for {audienceText(c)}</span>
                      : needsSubmission(c) ? <SubmitAction c={c} onClick={() => setSubmitting(c)} />
                      : closed ? <Badge>Closed</Badge>
                      : <Button size="sm" icon="check" onClick={() => complete(c)}>Mark completed</Button>}
                  </div>
                </Card>
              )
            }) : <Empty icon="trophy" title="No challenges for your class yet">When a teacher posts a challenge for your division it appears here and in your notifications.</Empty>}
          </div>
        </div>
        <Leaderboard lb={lb} me={me} flash={flash} />
      </div>
      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `Challenge brief · ${viewing.title}` : ''} wide>
        {viewing && <ResourceViewer files={viewing.attachments || []} />}
      </Dialog>
      <Dialog open={posting} onClose={() => setPosting(false)} title={`Post a challenge for ${me.division}`}>
        {posting && <RepForm onDone={() => setPosting(false)} />}
      </Dialog>
      <Dialog open={!!submitting} onClose={() => setSubmitting(null)} title="Submit solution">
        {submitting && <SubmitForm c={submitting} onDone={() => setSubmitting(null)} />}
      </Dialog>
    </div>
  )
}

const TONE_STATUS = { open: 'ok', closed: 'neutral', archived: 'neutral' }
/** Teachers (and admins): create, edit, close, archive and delete their challenges; review submitted solutions. */
export function TeacherChallenges({ query = {}, embedded }) {
  const { db, me, now, runShared } = useApp()
  const sh = db.shared
  const [show, setShow] = useState('active')
  const [viewing, setViewing] = useState(null)
  const [reviewing, setReviewing] = useState(query.id && query.review ? query.id : null)
  const [adding, setAdding] = useState(null)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const mine = sh.challenges.filter((c) => c.createdBy === me.id || (me.role === 'admin' && c.audience))
  const list = mine.filter((c) => (show === 'active' ? c.status !== 'archived' : c.status === 'archived')).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const status = (c, st) => runShared((s) => setChallengeStatus(s, c.id, st, me, new Date()), st === 'open' ? 'Challenge reopened.' : `Challenge ${st}.`)
  const remove = async (c) => {
    const r = runShared((s) => deleteChallenge(s, c.id, me), 'Challenge deleted.')
    if (r.ok) { for (const id of r.fileIds || []) await deleteFile(id).catch(() => {}); setDeleting(null) }
  }
  const Header = embedded ? null : <PageHeader title="Challenges" subtitle="Create challenges for your divisions, edit or remove them, and review the solution images students submit." actions={<a href="#/teacher?tab=compose&kind=challenge" className="press inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-maroon px-4 text-[14px] font-semibold text-white hover:bg-maroon-dark"><Icon name="plus" size={17} />New challenge</a>} />
  return (
    <div>
      {Header}
      <div className="mb-3 flex flex-wrap items-center gap-2"><Segmented label="Challenge list" value={show} onChange={setShow} options={[{ value: 'active', label: `Active (${mine.filter((c) => c.status !== 'archived').length})` }, { value: 'archived', label: `Archived (${mine.filter((c) => c.status === 'archived').length})` }]} />
        {embedded && <a href="#/teacher?tab=compose&kind=challenge" className="press ml-auto inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-maroon px-3 text-[13.5px] font-semibold text-white"><Icon name="plus" size={15} />New challenge</a>}</div>
      <div className="stagger flex flex-col gap-3">
        {list.length ? list.map((c) => {
          const subs = submissionsFor(sh, c.id)
          const waiting = subs.filter((s) => s.status === SUB.SUBMITTED).length
          const done = sh.completions.filter((x) => x.challengeId === c.id).length
          const st = c.status || 'open'
          return (
            <Card key={c.id} id={'ch-' + c.id} className="!p-4">
              <div className="flex flex-wrap items-start gap-2">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5"><Badge tone={TONE_STATUS[st]}>{st[0].toUpperCase() + st.slice(1)}</Badge><Badge tone="info">{audienceText(c)}</Badge><Badge>+{c.points} points</Badge>{needsSubmission(c) && <Badge tone="warn" icon="upload">Solution upload</Badge>}</span>
                  <b className="mt-1 block text-[15.5px] font-semibold">{c.title}</b>
                  <p className="text-[13.5px] text-muted">{c.description}</p>
                  <small className="mt-1 block text-[12.5px] text-muted">Posted {relTime(c.createdAt, now)}{c.deadline ? ` · closes ${relTime(c.deadline, now)}` : ''} · {subs.length} submission{subs.length === 1 ? '' : 's'}{waiting ? ` (${waiting} waiting)` : ''} · {done} completed{c.updatedAt ? ' · edited' : ''}</small>
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
                {needsSubmission(c) && <Button size="sm" icon="eye" onClick={() => setReviewing(c.id)}>Review solutions{waiting ? ` (${waiting})` : ''}</Button>}
                {(c.attachments || []).length > 0 && <Button size="sm" variant="secondary" icon="file" onClick={() => setViewing(c)}>Brief ({c.attachments.length})</Button>}
                {st !== 'archived' && <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(c)}>Edit</Button>}
                {st !== 'archived' && <Button size="sm" variant="secondary" icon="plus" onClick={() => setAdding(c)}>Add resources</Button>}
                {st === 'open' && <Button size="sm" variant="secondary" onClick={() => status(c, 'closed')}>Close</Button>}
                {st !== 'open' && <Button size="sm" variant="secondary" onClick={() => status(c, 'open')}>Reopen</Button>}
                {st !== 'archived' && <Button size="sm" variant="secondary" onClick={() => status(c, 'archived')}>Archive</Button>}
                <Button size="sm" variant="secondary" className="!text-bad" icon="x" onClick={() => setDeleting(c)}>Delete</Button>
              </div>
            </Card>
          )
        }) : <Empty icon="trophy" title={show === 'active' ? 'No challenges yet' : 'Nothing archived'}>{show === 'active' ? 'Create a challenge for one of your divisions. Students there are notified and can upload solution images for you to review.' : 'Archived challenges are hidden from students and listed here.'}</Empty>}
      </div>
      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `Challenge brief · ${viewing.title}` : ''} wide>{viewing && <ResourceViewer files={viewing.attachments || []} />}</Dialog>
      <Dialog open={!!reviewing} onClose={() => setReviewing(null)} title="Review submitted solutions" wide>{reviewing && <ReviewList challenges={sh.challenges.filter((c) => c.id === reviewing)} />}</Dialog>
      <Dialog open={!!adding} onClose={() => setAdding(null)} title={adding ? `Add resources · ${adding.title}` : ''}>{adding && <AddResources c={adding} onDone={() => setAdding(null)} />}</Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit challenge">{editing && <EditChallenge c={editing} onDone={() => setEditing(null)} />}</Dialog>
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title="Delete this challenge?">{deleting && (
        <div className="flex flex-col gap-3 text-[14px]">
          <p><b>{deleting.title}</b> and its {submissionsFor(sh, deleting.id).length} submission(s) will be removed for everyone. This can’t be undone. If points were already awarded, archive it instead.</p>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDeleting(null)}>Keep it</Button><Button className="!bg-bad" onClick={() => remove(deleting)}>Delete challenge</Button></div>
        </div>)}</Dialog>
    </div>
  )
}

function EditChallenge({ c, onDone }) {
  const { me, runShared } = useApp()
  const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
  const [f, setF] = useState({ title: c.title, description: c.description, points: String(c.points), deadline: toLocal(c.deadline) })
  const [err, setErr] = useState('')
  const save = (e) => {
    e.preventDefault()
    const pts = Number(f.points)
    const r = runShared((s) => updateChallenge(s, c.id, { title: f.title, description: f.description, points: Number.isInteger(pts) ? pts : NaN, deadline: f.deadline ? new Date(f.deadline).toISOString() : null }, me, new Date()), 'Challenge updated.')
    if (r.ok) onDone(); else setErr(r.error)
  }
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3">
      <Field label="Title">{(id) => <input id={id} className={inputCls} maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
      <Field label="What to do">{(id) => <textarea id={id} rows={3} className={cx(inputCls, 'py-2')} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Points">{(id) => <input id={id} inputMode="numeric" className={inputCls} value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} />}</Field>
        <Field label="Closes (optional)">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />}</Field>
      </div>
      <p className="text-[12.5px] text-muted">Audience ({audienceText(c)}) can’t change after sending, because those students were already notified.</p>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit">Save changes</Button></div>
    </form>
  )
}

function Leaderboard({ lb, me, flash }) {
  const [view, setView] = useState('classes')
  const ref = useRef(null)
  useEffect(() => { if (flash && ref.current) { ref.current.classList.remove('flash'); void ref.current.offsetWidth; ref.current.classList.add('flash') } }, [flash, lb])
  const max = Math.max(1, ...(view === 'classes' ? lb.classes : lb.students).map((x) => x.points))
  return (
    <Card className="h-fit lg:sticky lg:top-6">
      <CardTitle eyebrow="Live · from recorded completions">Leaderboard</CardTitle>
      <Segmented label="Leaderboard view" value={view} onChange={setView} options={[{ value: 'classes', label: 'Classes' }, { value: 'students', label: 'Students' }]} />
      <ol ref={ref} key={view} className="stagger mt-3 flex flex-col gap-1.5 rounded-lg" aria-live="polite">
        {(view === 'classes' ? lb.classes : lb.students).map((x, i) => {
          const isMe = view === 'classes' ? x.classId === me.classId : x.userId === me.id
          const name = view === 'classes' ? (CLASS_LABEL[x.classId] || x.classId) : `${x.name} · ${x.classId}`
          return (
            <li key={x.classId || x.userId} className={cx('rounded-lg px-3 py-2.5 transition-colors', isMe ? 'bg-maroon-50 ring-1 ring-maroon/25' : 'hover:bg-ground')}>
              <div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-2.5"><b className={cx('grid h-6 w-6 flex-none place-items-center rounded-md font-mono text-[12px]', i === 0 ? 'bg-[#F6E7C1] text-[#7A5410]' : i === 1 ? 'bg-[#E9EAEC] text-[#4A4F57]' : i === 2 ? 'bg-[#F1DDCD] text-[#7A4520]' : 'bg-sand text-muted')}>{i + 1}</b><span className="truncate text-[14px] font-semibold">{name}</span>{isMe && <Badge tone="maroon">You</Badge>}</span><b className="font-display text-[17px] font-semibold tabular-nums"><AnimatedNumber value={x.points} /></b></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand"><div className={cx('bar-grow bar-in h-full rounded-full', isMe ? 'bg-maroon' : 'bg-rose')} style={{ width: `${(x.points / max) * 100}%` }} /></div>
            </li>
          )
        })}
        {!(view === 'classes' ? lb.classes : lb.students).length && <p className="text-sm text-muted">No points recorded yet.</p>}
      </ol>
    </Card>
  )
}

/* ---------------- files: picker, viewer ---------------- */
export function FilePicker({ label, files, setFiles, limits, max = 1, multiple }) {
  const [err, setErr] = useState([])
  const input = useRef(null)
  const pick = async (e) => {
    const chosen = [...e.target.files]; e.target.value = ''
    const errs = [], ok = []
    for (const f of chosen) { const m = await checkFile(f, limits); if (m) errs.push(m); else ok.push(f) }
    const next = multiple ? [...files, ...ok] : ok.slice(0, 1)
    if (next.length > max) errs.push(`At most ${max} file${max > 1 ? 's' : ''}.`)
    setFiles(next.slice(0, max)); setErr(errs)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-[#3B4048]">{label}</span>
      <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" multiple={multiple} accept={limits.types.flatMap((t) => [...FILE_KINDS[t].mime, ...FILE_KINDS[t].ext.map((x) => '.' + x)]).join(',')} onChange={pick} />
      <button type="button" onClick={() => input.current.click()} className="press flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-dashed border-line2 bg-ground/50 px-3 text-[14px] font-semibold text-[#3B4048] hover:border-maroon hover:text-maroon"><Icon name="upload" size={17} />{files.length && !multiple ? 'Choose a different file' : 'Choose file' + (multiple ? 's' : '')}</button>
      {files.length > 0 && <ul className="flex flex-col gap-1">{files.map((f, i) => <li key={i} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[13px]"><Icon name="file" size={15} className="flex-none text-muted" /><span className="min-w-0 flex-1 break-all">{f.name}</span><span className="flex-none text-muted">{FILE_KINDS[kindOf(f.name, f.type)]?.label} · {fmtSize(f.size)}</span><button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="press grid h-7 w-7 flex-none place-items-center rounded-md text-muted hover:bg-sand hover:text-bad"><Icon name="x" size={14} /></button></li>)}</ul>}
      {err.length > 0 && <ul role="alert" className="flex flex-col gap-0.5 text-[13px] font-medium text-bad">{err.map((x) => <li key={x}>{x}</li>)}</ul>}
      {!filesPersistent() && <span className="text-[12px] text-warn">This browser blocks file storage here, so files last only until you close the tab.</span>}
    </div>
  )
}

/** Opens files from IndexedDB: images inline, PDFs in an embedded viewer, with open-in-tab and download. */
export function ResourceViewer({ files }) {
  const [idx, setIdx] = useState(0)
  const [state, setState] = useState({ url: null, missing: false, loading: true })
  const f = files[idx]
  useEffect(() => {
    let url = null, live = true
    setState({ url: null, missing: false, loading: true })
    getFile(f?.fileId).then((rec) => { if (!live) return; if (!rec) return setState({ url: null, missing: true, loading: false }); url = URL.createObjectURL(rec.blob); setState({ url, missing: false, loading: false }) }).catch(() => live && setState({ url: null, missing: true, loading: false }))
    return () => { live = false; if (url) URL.revokeObjectURL(url) }
  }, [f?.fileId])
  if (!files.length) return <Empty icon="file" title="No resources">Nothing attached yet.</Empty>
  const kind = kindOf(f.name, f.type)
  return (
    <div className="flex flex-col gap-3">
      {files.length > 1 && <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Files">{files.map((x, i) => <button key={x.fileId} role="tab" aria-selected={i === idx} onClick={() => setIdx(i)} className={cx('press max-w-[220px] truncate rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold', i === idx ? 'border-maroon bg-maroon-50 text-maroon' : 'border-line2')}>{x.name}</button>)}</div>}
      <div className="flex flex-wrap items-center gap-2 text-[13px]"><Icon name="file" size={15} className="text-muted" /><b className="min-w-0 flex-1 break-all">{f.name}</b><span className="text-muted">{FILE_KINDS[kind]?.label || f.type} · {fmtSize(f.size)}</span></div>
      <div className="grid min-h-[260px] place-items-center overflow-hidden rounded-xl border border-line bg-ground">
        {state.loading ? <span className="text-sm text-muted">Opening…</span>
          : state.missing ? <p className="p-6 text-center text-sm text-muted">This file isn't stored in this browser (it was added on another device, or browser data was cleared).</p>
          : kind === 'pdf' ? <iframe title={f.name} src={state.url} className="h-[60vh] w-full bg-white" />
          : <img src={state.url} alt={f.name} className="max-h-[60vh] w-auto max-w-full object-contain" />}
      </div>
      {state.url && <div className="flex flex-wrap justify-end gap-2"><a href={state.url} target="_blank" rel="noopener" className="press inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-line2 px-3 text-[13.5px] font-semibold hover:border-maroon hover:text-maroon"><Icon name="eye" size={16} />Open in new tab</a><a href={state.url} download={f.name} className="press inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-maroon px-3 text-[13.5px] font-semibold text-white hover:bg-maroon-dark"><Icon name="download" size={16} />Download</a></div>}
    </div>
  )
}

function AddResources({ c, onDone }) {
  const { me, runShared } = useApp()
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    if (!files.length) return setErr('Choose at least one file.')
    setBusy(true); setErr('')
    const stored = []
    try { for (const f of files) stored.push(await putFile(f)) } catch { for (const x of stored) await deleteFile(x.fileId); setBusy(false); return setErr('Couldn\u2019t store the files. Nothing was added.') }
    const r = runShared((s) => addResources(s, c.id, stored, me), `${stored.length} file${stored.length > 1 ? 's' : ''} added.`)
    if (!r.ok) for (const x of stored) await deleteFile(x.fileId)
    setBusy(false); if (r.ok) onDone()
  }
  return (
    <div className="flex flex-col gap-3">
      <FilePicker label="PDF, JPG or PNG, up to 10 MB each" files={files} setFiles={setFiles} limits={RES_LIMIT} max={5 - (c.attachments || []).length || 1} multiple />
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onDone}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Add files'}</Button></div>
    </div>
  )
}

/* ---------------- solutions ---------------- */
function MySubmissionLine({ c }) {
  const { db, me } = useApp()
  if (!needsSubmission(c)) return null
  const last = mySubmissions(db.shared, c.id, me.id)[0]
  if (!last) return null
  return (
    <div className="mt-2 rounded-lg border border-line bg-ground/60 px-2.5 py-2 text-[12.5px]">
      <span className="flex flex-wrap items-center gap-1.5">Your attempt {last.attempt}: <Badge tone={SUB_TONE[last.status]}>{last.status}</Badge><span className="break-all text-muted">{last.file.name}</span></span>
      {last.feedback && <p className="mt-1 text-[#3B4048]"><b>Feedback:</b> {last.feedback}</p>}
    </div>
  )
}
function SubmitAction({ c, onClick }) {
  const { db, me, now } = useApp()
  const can = canSubmit(db.shared, c, me, now)
  if (!can.ok) return <span className="text-sm text-muted">{can.reason}</span>
  return <Button size="sm" icon="upload" onClick={onClick}>{can.resubmit ? 'Resubmit solution' : 'Submit solution'}</Button>
}
function SubmitForm({ c, onDone }) {
  const { db, me, runShared } = useApp()
  const limits = { types: c.submission.types, maxMB: c.submission.maxMB }
  const [files, setFiles] = useState([])
  const [notes, setNotes] = useState('')
  const [phase, setPhase] = useState('idle') // idle | file | record | done | error
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(null)
  const prev = mySubmissions(db.shared, c.id, me.id)
  useEffect(() => { const f = files[0]; if (!f || kindOf(f.name, f.type) === 'pdf') { setPreview(null); return } const u = URL.createObjectURL(f); setPreview(u); return () => URL.revokeObjectURL(u) }, [files])
  const submit = async (e) => {
    e.preventDefault()
    const f = files[0]
    const m = await checkFile(f, limits)
    if (m) { setErr(m); return }
    setErr(''); setPhase('file')
    let meta
    try { meta = await putFile(f) } catch { setPhase('error'); setErr('The file couldn\u2019t be saved (browser storage full or blocked). Nothing was submitted.'); return }
    setPhase('record')
    const r = runShared((s) => submitSolution(s, c.id, me, meta, notes, new Date()))
    if (!r.ok) { await deleteFile(meta.fileId); setPhase('error'); setErr(r.error); return }
    setPhase('done')
  }
  if (phase === 'done') return (
    <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-[#E7F4EC] text-ok"><Icon name="check" size={24} stroke={2.4} /></span>
      <b className="text-[16px]">Solution submitted</b>
      <p className="text-[14px] text-muted">Your file is saved and waiting for review. Points are added only when the reviewer accepts it; you'll be notified.</p>
      <Button onClick={onDone}>Done</Button>
    </div>
  )
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <dl className="grid gap-1 rounded-xl border border-line p-3 text-[13.5px]">
        <div className="flex gap-2"><dt className="w-[92px] flex-none text-muted">Challenge</dt><dd className="min-w-0 flex-1 font-semibold">{c.title} <span className="font-mono text-[11.5px] font-normal text-muted">({c.id})</span></dd></div>
        <div className="flex gap-2"><dt className="w-[92px] flex-none text-muted">Student</dt><dd>{me.name} · {me.classId}</dd></div>
        <div className="flex gap-2"><dt className="w-[92px] flex-none text-muted">Accepts</dt><dd>{typesLabel(limits.types)}, up to {limits.maxMB} MB</dd></div>
        {prev.length > 0 && <div className="flex gap-2"><dt className="w-[92px] flex-none text-muted">Attempts</dt><dd>{prev.length} so far. A new upload replaces any attempt still waiting for review; earlier attempts are kept.</dd></div>}
      </dl>
      <FilePicker label="Solution file" files={files} setFiles={setFiles} limits={limits} max={1} />
      {preview && <img src={preview} alt="Preview of your solution" className="max-h-56 w-auto self-start rounded-lg border border-line object-contain" />}
      <Field label="Notes for the reviewer (optional)">{(id) => <textarea id={id} rows={3} maxLength={1000} className={cx(inputCls, 'py-2')} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      {err && <p role="alert" className="flex items-center gap-1.5 rounded-lg bg-[#FBEDEA] px-3 py-2 text-[13.5px] text-bad"><Icon name="alert" size={15} />{err}</p>}
      <div className="flex items-center justify-end gap-2">
        {(phase === 'file' || phase === 'record') && <span className="mr-auto text-[13px] text-muted" role="status">{phase === 'file' ? 'Saving file…' : 'Saving submission…'}</span>}
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
        <Button type="submit" icon="upload" disabled={!files.length || phase === 'file' || phase === 'record'}>Submit solution</Button>
      </div>
    </form>
  )
}

/** Reviewer view: every submission for the given challenges the current user may review. */
export function ReviewList({ challenges }) {
  const { db, me, now, runShared } = useApp()
  const [show, setShow] = useState('new')
  const [open, setOpen] = useState(null)
  const [fb, setFb] = useState({})
  const mine = challenges.filter((c) => canReview(c, me))
  const rows = mine.flatMap((c) => submissionsFor(db.shared, c.id).map((s) => ({ c, s }))).filter(({ s }) => (show === 'new' ? s.status === SUB.SUBMITTED : true)).sort((a, b) => Date.parse(b.s.at) - Date.parse(a.s.at))
  const decide = (s, d) => {
    const r = runShared((st) => reviewSubmission(st, s.id, me, d, fb[s.id] || '', new Date()), d === 'accept' ? 'Accepted. Points recorded and the student notified.' : 'Review saved; the student was notified.')
    if (r.ok) setFb({ ...fb, [s.id]: '' })
  }
  if (!mine.length) return <Empty icon="lock" title="Nothing to review">You can review solutions for challenges you posted.</Empty>
  return (
    <div className="flex flex-col gap-3">
      <Segmented label="Submissions shown" value={show} onChange={setShow} options={[{ value: 'new', label: 'Waiting for review' }, { value: 'all', label: 'All attempts' }]} />
      {rows.length ? <ul className="flex flex-col gap-2">{rows.map(({ c, s }) => (
        <li key={s.id} className="rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center gap-2"><b className="min-w-0 flex-1 text-[14.5px]">{s.userName} <span className="font-normal text-muted">· {s.classId} · attempt {s.attempt} · {relTime(s.at, now)}</span></b><Badge tone={SUB_TONE[s.status]}>{s.status}</Badge></div>
          {mine.length > 1 && <p className="text-[12.5px] text-muted">{c.title} · +{c.points} points</p>}
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px]"><Icon name="file" size={14} className="text-muted" /><span className="break-all">{s.file.name}</span><span className="text-muted">{fmtSize(s.file.size)}</span><button onClick={() => setOpen(open === s.id ? null : s.id)} className="font-semibold text-maroon hover:underline">{open === s.id ? 'Hide file' : 'Open file'}</button></p>
          {s.notes && <p className="mt-1 text-[13px]"><b>Student's note:</b> {s.notes}</p>}
          {s.feedback && <p className="mt-1 text-[13px]"><b>Feedback:</b> {s.feedback}</p>}
          {open === s.id && <div className="mt-2"><ResourceViewer files={[s.file]} /></div>}
          {s.status === SUB.SUBMITTED && (
            <div className="mt-2 flex flex-col gap-2">
              <label className="sr-only" htmlFor={'fb-' + s.id}>Feedback</label>
              <textarea id={'fb-' + s.id} rows={2} placeholder="Feedback (required for changes or rejection)" className={cx(inputCls, 'py-2')} value={fb[s.id] || ''} onChange={(e) => setFb({ ...fb, [s.id]: e.target.value })} />
              <div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="secondary" className="!text-bad" onClick={() => decide(s, 'reject')}>Reject</Button><Button size="sm" variant="secondary" onClick={() => decide(s, 'changes')}>Request changes</Button><Button size="sm" icon="check" onClick={() => decide(s, 'accept')}>Accept · +{c.points}</Button></div>
            </div>
          )}
        </li>))}</ul> : <Empty icon="check" title={show === 'new' ? 'Nothing waiting' : 'No submissions yet'}>New solutions appear here and in your notifications.</Empty>}
    </div>
  )
}

/** Class rep: a simple challenge for their own division (no uploads; classmates mark it completed). */
function RepForm({ onDone }) {
  const { db, me, runShared } = useApp()
  const [f, setF] = useState({ title: '', description: '', points: '10', deadline: '' })
  const [err, setErr] = useState('')
  const save = (e) => {
    e.preventDefault()
    const pts = Number(f.points)
    const r = runShared((s) => postChallenge(s, { title: f.title, description: f.description, points: Number.isInteger(pts) ? pts : NaN, deadline: f.deadline ? new Date(f.deadline).toISOString() : null, audience: { divisions: [me.division] } }, me, new Date(), db.profiles), `Posted for ${me.division}. Classmates were notified.`)
    if (r.ok) onDone(); else setErr(r.error)
  }
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3">
      <Field label="Title">{(id) => <input id={id} maxLength={80} className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
      <Field label="What to do">{(id) => <textarea id={id} rows={3} className={cx(inputCls, 'py-2')} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Points (1–100)">{(id) => <input id={id} inputMode="numeric" className={inputCls} value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} />}</Field>
        <Field label="Closes (optional)">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} />}</Field>
      </div>
      <p className="text-[12.5px] text-muted">Shown as a class rep challenge. Only {me.division} sees it; points go to your class on the leaderboard.</p>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit">Post challenge</Button></div>
    </form>
  )
}
