import { useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Card, CardTitle, Button, Badge, Empty, Dialog, Field, inputCls, cx, fmtDateTime } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { roster, createSession, editSession, classSessions, unrecorded, makeSecret, verifyEditPassword, strongEnough, PASSWORD_RULE, MARK } from '../lib/attendance.js'
import { DIVISION_TIMETABLE, divisionInfo, allDivisions, subjectsFor } from '../data/academics.js'
import { timetableForClass } from '../data/seed.js'
import { isAdmin } from '../lib/posts.js'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

/** Teacher attendance: pick an assigned class, record a lecture, correct saved lectures with the edit password. */
export default function AttendanceDesk() {
  const { db, me, setDb, pushToast } = useApp()
  const classes = isAdmin(me) ? allDivisions().flatMap((d) => subjectsFor(divisionInfo(d)?.year).map((s) => ({ division: d, subject: s }))) : me.teaches || []
  const [ci, setCi] = useState(0)
  const cls = classes[ci]
  const secret = db.shared.attSecrets?.[me.id]
  const saveSecret = (s) => setDb((d) => ({ ...d, shared: { ...d.shared, attSecrets: { ...d.shared.attSecrets, [me.id]: s } } }))
  const [recording, setRecording] = useState(null)
  const [editing, setEditing] = useState(null)
  if (!classes.length) return <Empty icon="lock" title="No classes assigned">The admin assigns your divisions and subjects.</Empty>
  const sessions = classSessions(db.shared, cls.division, cls.subject)
  const tt = DIVISION_TIMETABLE[cls.division] ? timetableForClass(DIVISION_TIMETABLE[cls.division]) : []
  const missing = unrecorded(db.shared, { division: cls.division, subject: cls.subject, timetable: tt })
  const students = roster(db.profiles, cls.division)
  const exportCsv = () => {
    const rec = sessions.filter((s) => s.status === 'recorded').sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    const head = ['Roll', 'Name', ...rec.map((s) => `${s.date} ${s.start}`), 'Present', 'Recorded', '%']
    const rows = students.map((p) => { const marks = rec.map((s) => s.records[p.id] || ''); const pr = marks.filter((m) => m === 'P').length, n = marks.filter(Boolean).length; return [p.roll, p.name, ...marks, pr, n, n ? ((pr / n) * 100).toFixed(1) : ''] })
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `attendance_${cls.division}_${cls.subject.replace(/\W+/g, '_')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Class">{(id) => <select id={id} className={cx(inputCls, 'min-w-[280px]')} value={ci} onChange={(e) => setCi(+e.target.value)}>{classes.map((c, i) => <option key={i} value={i}>{c.division} · {c.subject}</option>)}</select>}</Field>
          <Button icon="plus" onClick={() => setRecording({ date: today(), start: '09:00', end: '10:00' })}>Record a lecture</Button>
          <Button variant="secondary" icon="download" onClick={exportCsv} disabled={!sessions.length}>Export CSV</Button>
          <span className="flex-1" />
          <PasswordBox secret={secret} onSave={(s) => { saveSecret(s); pushToast('Attendance edit password saved.') }} />
        </div>
        <p className="mt-2 text-[12.5px] text-muted">{divisionInfo(cls.division)?.label} · {students.length} students on the roster. Unrecorded lectures are never counted as absences.</p>
      </Card>
      {missing.length > 0 && (
        <Card>
          <CardTitle eyebrow="Scheduled in the timetable, no attendance saved">Unrecorded lectures</CardTitle>
          <ul className="flex flex-wrap gap-2">{missing.map((m) => <li key={m.date + m.start}><button onClick={() => setRecording(m)} className="press rounded-lg border border-[#EBD3A6] bg-[#FDF6E7] px-3 py-1.5 text-[13px] font-semibold text-warn">{m.date} · {m.start}</button></li>)}</ul>
        </Card>
      )}
      <Card>
        <CardTitle eyebrow={`${sessions.length} lecture${sessions.length === 1 ? '' : 's'}`}>Attendance history</CardTitle>
        {sessions.length ? <ul className="flex flex-col divide-y divide-line">{sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="w-[150px] flex-none font-mono text-[13px]">{s.date} {s.start}</span>
            <span className="min-w-0 flex-1 text-[13.5px]">{s.status === 'cancelled' ? <Badge>Cancelled</Badge> : <><b>{s.present}</b>/{s.total} present</>}{s.demo && <Badge tone="demo" className="ml-1.5">Sample</Badge>}<small className="ml-2 text-muted">v{s.version || 1} · updated {fmtDateTime(s.updatedAt)}</small></span>
            <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(s)}>Open</Button>
          </li>))}</ul> : <Empty icon="check" title="No lectures recorded">Record the first lecture for this class.</Empty>}
      </Card>
      <ClassSummary students={students} sessions={sessions} />
      <Dialog open={!!recording} onClose={() => setRecording(null)} title={`Record lecture · ${cls.division} · ${cls.subject}`} wide>
        {recording && <RecordForm cls={cls} init={recording} students={students} onDone={() => setRecording(null)} />}
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={`Edit lecture · ${editing?.date || ''} ${editing?.start || ''}`} wide>
        {editing && <EditForm s={db.shared.attSessions.find((x) => x.id === editing.id)} students={students} secret={secret} saveSecret={saveSecret} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  )
}

function ClassSummary({ students, sessions }) {
  const rec = sessions.filter((s) => s.status === 'recorded')
  if (!rec.length || !students.length) return null
  return (
    <Card>
      <CardTitle eyebrow="Present ÷ recorded lectures">Student summary</CardTitle>
      <ul className="grid gap-1.5 sm:grid-cols-2">{students.map((p) => { const marks = rec.map((s) => s.records[p.id]).filter(Boolean); const pr = marks.filter((m) => m === 'P').length; const pc = marks.length ? Math.round((pr / marks.length) * 1000) / 10 : null; return (
        <li key={p.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13.5px]"><span className="w-[92px] flex-none font-mono text-[12px]">{p.roll}</span><span className="min-w-0 flex-1 truncate">{p.name}</span><b className={cx(pc != null && pc < 75 ? 'text-bad' : 'text-ok')}>{pc == null ? '—' : pc + '%'}</b><small className="text-muted">{pr}/{marks.length}</small></li>) })}</ul>
    </Card>
  )
}

function Marks({ students, marks, setMarks, disabled }) {
  return (
    <div>
      {!disabled && <div className="mb-2 flex gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => setMarks(Object.fromEntries(students.map((p) => [p.id, 'P'])))}>Mark all present</Button><Button type="button" size="sm" variant="secondary" onClick={() => setMarks({})}>Clear</Button></div>}
      <ul className="flex max-h-[46vh] flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line">{students.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-3 py-2">
          <span className="w-[92px] flex-none font-mono text-[12.5px]">{p.roll}</span><span className="min-w-0 flex-1 truncate text-[14px]">{p.name}</span>
          <span className="flex gap-1" role="radiogroup" aria-label={`Attendance for ${p.name}`}>{['P', 'A'].map((m) => <button type="button" role="radio" aria-checked={marks[p.id] === m} key={m} disabled={disabled} onClick={() => setMarks({ ...marks, [p.id]: m })} className={cx('press min-h-[34px] min-w-[74px] rounded-lg border text-[13px] font-semibold', marks[p.id] === m ? (m === 'P' ? 'border-ok bg-[#E7F4EC] text-ok' : 'border-bad bg-[#FBEDEA] text-bad') : 'border-line2 bg-surface text-muted')}>{MARK[m]}</button>)}</span>
        </li>))}</ul>
    </div>
  )
}

function RecordForm({ cls, init, students, onDone }) {
  const { db, me, runShared } = useApp()
  const [f, setF] = useState({ date: init.date, start: init.start, end: init.end, status: 'recorded', note: '' })
  const [marks, setMarks] = useState({})
  const [err, setErr] = useState('')
  const left = students.filter((p) => !marks[p.id]).length
  const submit = (e) => { e.preventDefault(); const r = runShared((s) => createSession(s, { ...cls, ...f, records: marks }, me, db.profiles, new Date()), 'Attendance saved.'); if (r.ok) onDone(); else setErr(r.error) }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Date">{(id) => <input id={id} type="date" max={today()} className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
        <Field label="Starts">{(id) => <input id={id} type="time" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}</Field>
        <Field label="Ends">{(id) => <input id={id} type="time" className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />}</Field>
        <Field label="Lecture">{(id) => <select id={id} className={inputCls} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="recorded">Held</option><option value="cancelled">Cancelled</option></select>}</Field>
      </div>
      {f.status === 'recorded' ? <Marks students={students} marks={marks} setMarks={setMarks} /> : <p className="rounded-lg bg-ground px-3 py-2 text-[13.5px]">A cancelled lecture is kept in the record and not counted in anyone's percentage.</p>}
      {err && <p role="alert" className="rounded-lg bg-[#FBEDEA] px-3 py-2 text-[13.5px] text-bad">{err}</p>}
      <div className="flex items-center justify-end gap-2">{f.status === 'recorded' && left > 0 && <span className="mr-auto text-[13px] text-muted">{left} student{left === 1 ? '' : 's'} not marked yet</span>}<Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit" icon="check">Save attendance</Button></div>
    </form>
  )
}

function EditForm({ s, students, secret, saveSecret, onDone }) {
  const { db, me, runShared } = useApp()
  const [marks, setMarks] = useState({ ...s.records })
  const [status, setStatus] = useState(s.status)
  const [pw, setPw] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const audit = (db.shared.attAudit || []).filter((a) => a.sessionId === s.id).sort((a, b) => b.at.localeCompare(a.at))
  const name = (id) => db.profiles[id]?.name || id
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    const v = await verifyEditPassword(secret, pw)
    saveSecret(v.secret)
    if (!v.ok) { setErr(v.error); setBusy(false); return }
    const changed = Object.fromEntries(Object.entries(marks).filter(([k, m]) => s.records[k] !== m))
    // students added to the roster after a lecture was saved are marked only if the teacher sets them
    const r = runShared((st) => editSession(st, s.id, { records: changed, status }, me, { verified: true, reason, version: s.version, profiles: db.profiles }, new Date()), 'Attendance corrected. Students were notified.')
    setBusy(false)
    if (r.ok) onDone(); else setErr(r.error)
  }
  const list = status === 'recorded' ? students.filter((p) => p.id in s.records || s.status === 'cancelled') : []
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Field label="Lecture">{(id) => <select id={id} className={cx(inputCls, 'max-w-[200px]')} value={status} onChange={(e) => setStatus(e.target.value)}><option value="recorded">Held</option><option value="cancelled">Cancelled</option></select>}</Field>
      {status === 'recorded' && <Marks students={list} marks={marks} setMarks={setMarks} />}
      {!secret ? <p className="rounded-lg bg-[#FDF0D8] px-3 py-2 text-[13.5px] text-warn">Set your attendance edit password (top of this page) before correcting saved attendance.</p> : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reason for the correction">{(id) => <input id={id} className={inputCls} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Field label="Attendance edit password">{(id) => <input id={id} type="password" autoComplete="current-password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        </div>)}
      {err && <p role="alert" className="rounded-lg bg-[#FBEDEA] px-3 py-2 text-[13.5px] text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onDone}>Close</Button><Button type="submit" disabled={!secret || busy}>{busy ? 'Checking…' : 'Save correction'}</Button></div>
      <details className="text-[13px]"><summary className="cursor-pointer font-semibold text-brand">Change history ({audit.length})</summary>
        <ul className="mt-1 flex flex-col gap-1">{audit.map((a) => <li key={a.id} className="rounded-lg bg-ground px-2.5 py-1.5"><b>{fmtDateTime(a.at)}</b> · {a.byName} · {a.action}{a.reason ? ` · “${a.reason}”` : ''}{a.changes.length > 0 && <span className="block text-muted">{a.changes.map((c) => `${name(c.studentId)}: ${c.from ? MARK[c.from] : '—'} → ${MARK[c.to]}`).join('; ')}</span>}</li>)}</ul>
      </details>
    </form>
  )
}

function PasswordBox({ secret, onSave }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    if (secret) { const v = await verifyEditPassword(secret, f.current); if (!v.ok) { onSave(v.secret); setErr(v.error); return } }
    if (!strongEnough(f.next)) return setErr(PASSWORD_RULE)
    if (f.next !== f.confirm) return setErr('The two passwords don’t match.')
    setBusy(true); onSave(await makeSecret(f.next)); setBusy(false); setOpen(false); setF({ current: '', next: '', confirm: '' })
  }
  return (
    <>
      <Button variant="secondary" icon="lock" onClick={() => setOpen(true)}>{secret ? 'Change edit password' : 'Set edit password'}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={secret ? 'Change attendance edit password' : 'Set attendance edit password'}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <p className="text-[13.5px] text-muted">Needed, together with your sign-in, to correct attendance that's already saved. Only a salted hash is kept. {PASSWORD_RULE}</p>
          {secret && <Field label="Current password">{(id) => <input id={id} type="password" autoComplete="current-password" className={inputCls} value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />}</Field>}
          <Field label="New password">{(id) => <input id={id} type="password" autoComplete="new-password" className={inputCls} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />}</Field>
          <Field label="Confirm new password">{(id) => <input id={id} type="password" autoComplete="new-password" className={inputCls} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />}</Field>
          {err && <p role="alert" className="text-[13.5px] font-medium text-bad">{err}</p>}
          <p className="text-[12px] text-muted">Forgot it? An admin can reset it from the Admin page; you then set a new one.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Button></div>
        </form>
      </Dialog>
    </>
  )
}
