import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, Button, Badge, Empty, Segmented, Dialog, Field, inputCls, relTime, fmtDateTime, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { FilePicker, ResourceViewer } from './Challenges.jsx'
import { KIND, STATUS, SUBST, visiblePosts, getPost, mySubs, canSubmitAssignment, submitAssignment } from '../lib/posts.js'
import { putFile, deleteFile, checkFile } from '../lib/files.js'
import { hasAcademicIdentity, divisionInfo } from '../data/academics.js'
import { Feed } from '../components/CloudPortal.jsx'

const TONE = { assignment: 'warn', notice: 'info', lecture: 'maroon', document: 'neutral' }

/** Student view of everything teachers sent to the student's own division. Access checks: src/lib/posts.js. */
export default function Classwork({ query = {} }) {
  const { db, me, now, session } = useApp()
  const [kind, setKind] = useState('all')
  const [openId, setOpenId] = useState(query.id || null)
  useEffect(() => { if (query.id) setOpenId(query.id) }, [query.id])
  // Phone accounts: classwork is what teachers post on the college server for the confirmed division.
  // (The browser sample assignments below are demo data and are never shown to a real account.)
  if (session.mode === 'minimoth') return (
    <div>
      <PageHeader back title="Classwork" subtitle={session.enrollment ? `Announcements and materials your teachers posted for ${session.enrollment.division_code}.` : 'Join your class to see what your teachers post.'} />
      {session.enrollment ? <Feed key={session.enrollment.division_code} /> : <Empty icon="user" title="Not in a class yet" action={<a href="#/portal?tab=class" className="font-semibold text-maroon">Join your class</a>}>Your teachers post to a division, so classwork appears once your class is approved.</Empty>}
      <p className="mt-4 text-[12.5px] text-muted">Online assignment hand-in is not on the college server yet. Your teacher will tell you how to submit.</p>
    </div>
  )
  if (!hasAcademicIdentity(me)) return <div className="py-8"><Empty icon="user" title="Complete your academic profile" action={<a href="#/profile" className="font-semibold text-maroon">Open profile</a>}>Classwork is sent to your year, branch and division. Add them to your profile first.</Empty></div>
  const list = visiblePosts(db.shared, me, now).filter((p) => kind === 'all' || p.kind === kind)
  const open = openId ? getPost(db.shared, openId, me, now) : null
  return (
    <div>
      <PageHeader back title="Classwork" subtitle={`Assignments, notices, lecture announcements and documents for ${divisionInfo(me.division)?.label || me.division}.`} />
      <div className="mb-4 overflow-x-auto"><Segmented label="Type" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'assignment', label: 'Assignments' }, { value: 'notice', label: 'Notices' }, { value: 'lecture', label: 'Lectures' }, { value: 'document', label: 'Documents' }]} /></div>
      <div className="stagger flex flex-col gap-3">
        {list.length ? list.map((p) => {
          const last = mySubs(db.shared, p.id, me.id)[0]
          const overdue = p.kind === 'assignment' && Date.parse(p.deadline) < now && !last
          return (
            <Card key={p.id} interactive className="!p-4">
              <button className="flex w-full gap-3 text-left" onClick={() => setOpenId(p.id)}>
                <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-brand-50 text-brand"><Icon name={p.kind === 'assignment' ? 'book' : p.kind === 'lecture' ? 'calendar' : p.kind === 'document' ? 'file' : 'megaphone'} size={19} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5"><Badge tone={TONE[p.kind]}>{KIND[p.kind]}</Badge>{p.status === STATUS.CLOSED && <Badge>Closed</Badge>}{last && <Badge tone={last.status === SUBST.REVIEWED ? 'ok' : 'info'}>{last.status}</Badge>}{overdue && <Badge tone="bad">Missed</Badge>}</span>
                  <b className="mt-1 block text-[15.5px] font-semibold">{p.title}</b>
                  <small className="text-[12.5px] text-muted">{p.createdByName} · {relTime(p.createdAt, now)}{p.deadline ? ` · due ${fmtDateTime(p.deadline)}` : ''}{p.lectureAt ? ` · ${p.subject}, ${fmtDateTime(p.lectureAt)}` : ''}{p.attachments.length ? ` · ${p.attachments.length} attachment${p.attachments.length > 1 ? 's' : ''}` : ''}</small>
                </span>
                <Icon name="chev" size={18} className="self-center text-muted" />
              </button>
            </Card>
          )
        }) : <Empty icon="book" title="Nothing here yet">When your teachers send something to {me.division}, it appears here and in your notifications.</Empty>}
      </div>
      <Dialog open={!!openId} onClose={() => { setOpenId(null); if (query.id) window.history.replaceState(null, '', '#/classwork') }} title={open?.title || 'Not available'} wide>
        {openId && (open ? <PostDetail p={open} /> : <Empty icon="lock" title="You don't have access to this item">It was sent to a different division, or it has been archived.</Empty>)}
      </Dialog>
    </div>
  )
}

function PostDetail({ p }) {
  const { db, me, now } = useApp()
  const [submitting, setSubmitting] = useState(false)
  const subs = mySubs(db.shared, p.id, me.id)
  const can = canSubmitAssignment(db.shared, p, me, now)
  return (
    <div className="flex flex-col gap-3 text-[14.5px]">
      <p className="text-[13px] text-muted">{KIND[p.kind]} from {p.createdByName} · sent {fmtDateTime(p.createdAt)}{p.updatedAt !== p.createdAt ? ` · edited ${relTime(p.updatedAt, now)}` : ''}</p>
      {p.kind === 'lecture' && <div className="rounded-xl bg-brand-50 px-3 py-2"><b>{p.subject}</b> · {fmtDateTime(p.lectureAt)}{p.room && <> · {p.room.label} <a href={`#/navigator?f=${p.room.f}&id=${p.room.id}`} className="font-semibold text-brand hover:underline">Route</a></>}</div>}
      {p.deadline && <p><b>Deadline:</b> {fmtDateTime(p.deadline)} ({relTime(p.deadline, now)})</p>}
      {p.body && <p className="whitespace-pre-wrap leading-relaxed">{p.body}</p>}
      {p.attachments.length > 0 && <ResourceViewer files={p.attachments} />}
      {p.kind === 'assignment' && p.acceptsUploads && (
        <div className="rounded-xl border border-line p-3">
          <b className="text-[14px]">Your submission</b>
          {subs.length ? <ul className="mt-1.5 flex flex-col gap-1 text-[13px]">{subs.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-2"><span>Attempt {s.attempt} · {s.file.name} · {relTime(s.at, now)}</span><Badge tone={s.status === SUBST.REVIEWED ? 'ok' : s.status === SUBST.CHANGES ? 'info' : s.status === SUBST.SUPERSEDED ? 'neutral' : 'warn'}>{s.status}</Badge>{s.feedback && <span className="w-full text-[#33443B]">Feedback: {s.feedback}</span>}</li>)}</ul> : <p className="mt-1 text-[13px] text-muted">Not submitted yet.</p>}
          <div className="mt-2 flex justify-end">{can.ok ? <Button size="sm" icon="upload" onClick={() => setSubmitting(true)}>{can.resubmit ? 'Resubmit' : 'Submit'}</Button> : <span className="text-[13px] text-muted">{can.reason}</span>}</div>
        </div>
      )}
      <Dialog open={submitting} onClose={() => setSubmitting(false)} title={`Submit · ${p.title}`}>{submitting && <SubmitForm p={p} onDone={() => setSubmitting(false)} />}</Dialog>
    </div>
  )
}

function SubmitForm({ p, onDone }) {
  const { me, runShared } = useApp()
  const limits = { types: ['pdf', 'jpg', 'png'], maxMB: 10 }
  const [files, setFiles] = useState([])
  const [notes, setNotes] = useState('')
  const [phase, setPhase] = useState('idle')
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    const m = await checkFile(files[0], limits); if (m) return setErr(m)
    setPhase('saving'); setErr('')
    let meta
    try { meta = await putFile(files[0]) } catch { setPhase('idle'); return setErr('The file couldn’t be saved. Nothing was submitted.') }
    const r = runShared((s) => submitAssignment(s, p.id, me, meta, notes, new Date()), 'Submitted. Your teacher has been notified.')
    if (!r.ok) { await deleteFile(meta.fileId); setPhase('idle'); return setErr(r.error) }
    onDone()
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">{me.name} · {me.roll} · {me.division}. PDF, JPG or PNG, up to 10 MB.</p>
      <FilePicker label="Your file" files={files} setFiles={setFiles} limits={limits} max={1} />
      <Field label="Note for your teacher (optional)">{(id) => <textarea id={id} rows={2} maxLength={1000} className={cx(inputCls, 'py-2')} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      {err && <p role="alert" className="text-[13.5px] text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit" icon="upload" disabled={!files.length || phase === 'saving'}>{phase === 'saving' ? 'Saving…' : 'Submit'}</Button></div>
    </form>
  )
}
