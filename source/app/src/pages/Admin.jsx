import { useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Empty, Segmented, Dialog, Field, inputCls, cx } from '../components/ui.jsx'
import { saveStaff, removeStaff, changeStudentAcademic } from '../lib/admin.js'
import { resolveReports, openReports } from '../lib/notes.js'
import { isAdmin, isStudent } from '../lib/posts.js'
import { allDivisions, divisionInfo, subjectsFor, YEARS, BRANCHES, divisionsFor } from '../data/academics.js'

/**
 * Admin: teacher allowlist (phone used for OTP sign-in → teacher role), student division changes, attendance
 * password resets and notes moderation. Canteen menus are edited on the Canteens page. Admin itself is decided on
 * the server from ADMIN_PHONES (or the demo admin account).
 */
export default function Admin() {
  const { me } = useApp()
  const [tab, setTab] = useState('teachers')
  if (!isAdmin(me)) return <div className="py-10"><Empty icon="lock" title="Admin access only">Admins are configured on the server (ADMIN_PHONES).</Empty></div>
  return (
    <div>
      <PageHeader title="Admin" subtitle="Approve teachers, move students between divisions, reset attendance passwords and moderate shared notes. Canteen menus are edited on the Canteens page." />
      <div className="mb-4"><Segmented label="Admin section" value={tab} onChange={setTab} options={[{ value: 'teachers', label: 'Teachers' }, { value: 'students', label: 'Students' }, { value: 'notes', label: 'Notes reports' }]} /></div>
      {tab === 'teachers' && <Teachers />}{tab === 'students' && <Students />}{tab === 'notes' && <Reports />}
    </div>
  )
}

function Teachers() {
  const { db, me, runShared, setDb, pushToast } = useApp()
  const [edit, setEdit] = useState(null)
  const list = db.shared.staffAllowlist || []
  const demoTeachers = Object.values(db.profiles).filter((p) => p.role === 'teacher')
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardTitle eyebrow="Teachers sign in with OTP on this phone number" action={<Button size="sm" icon="plus" onClick={() => setEdit({ name: '', phone: '', email: '', teaches: [{ division: allDivisions()[0], subject: '' }] })}>Add teacher</Button>}>Approved teachers</CardTitle>
        {list.length ? <ul className="flex flex-col divide-y divide-line">{list.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5"><span className="min-w-0 flex-1"><b>{t.name}</b> <span className="text-[13px] text-muted">· ******{t.phone.slice(-4)}{t.email ? ` · ${t.email}` : ''}</span><small className="block text-[12.5px] text-muted">{t.teaches.map((x) => `${x.division} ${x.subject}`).join(' · ')}</small></span>
            <Button size="sm" variant="secondary" onClick={() => setEdit(t)}>Edit</Button><Button size="sm" variant="secondary" className="!text-bad" onClick={() => runShared((s) => removeStaff(s, t.id, me), 'Removed from the allowlist.')}>Remove</Button></li>))}</ul>
          : <Empty icon="contact" title="No teachers approved yet">Add a teacher's phone number and classes. When they sign in with OTP on that number they get the teacher portal.</Empty>}
      </Card>
      <Card>
        <CardTitle eyebrow="Demo accounts (sample data)">Attendance edit passwords</CardTitle>
        <ul className="flex flex-col gap-2">{[...demoTeachers].map((t) => (
          <li key={t.id} className="flex items-center gap-2 text-[14px]"><span className="flex-1">{t.name}</span>{db.shared.attSecrets?.[t.id] ? <Badge tone="ok">Password set</Badge> : <Badge>Not set</Badge>}
            {db.shared.attSecrets?.[t.id] && <Button size="sm" variant="secondary" onClick={() => { setDb((d) => { const s = { ...d.shared.attSecrets }; delete s[t.id]; return { ...d, shared: { ...d.shared, attSecrets: s } } }); pushToast(`Password reset. ${t.name} must set a new one before editing attendance.`) }}>Reset</Button>}</li>))}</ul>
      </Card>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit teacher' : 'Add teacher'} wide>{edit && <StaffForm t={edit} onDone={() => setEdit(null)} />}</Dialog>
    </div>
  )
}

function StaffForm({ t, onDone }) {
  const { me, runShared } = useApp()
  const [f, setF] = useState({ ...t, teaches: t.teaches.map((x) => ({ ...x })) })
  const [err, setErr] = useState('')
  const setRow = (i, k, v) => setF({ ...f, teaches: f.teaches.map((x, j) => (j === i ? { ...x, [k]: v } : x)) })
  return (
    <form noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); const r = runShared((s) => saveStaff(s, f, me, new Date()), 'Teacher saved.'); if (r.ok) onDone(); else setErr(r.error) }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name">{(id) => <input id={id} className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Mobile (for OTP)">{(id) => <input id={id} inputMode="tel" className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
        <Field label="Email (linked, optional)">{(id) => <input id={id} type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
      </div>
      <fieldset className="flex flex-col gap-2 rounded-xl border border-line p-3"><legend className="px-1 text-[13px] font-medium">Classes (division + subject)</legend>
        {f.teaches.map((x, i) => <div key={i} className="flex flex-wrap gap-2">
          <select aria-label="Division" className={cx(inputCls, '!w-[140px]')} value={x.division} onChange={(e) => setRow(i, 'division', e.target.value)}>{allDivisions().map((d) => <option key={d}>{d}</option>)}</select>
          <input aria-label="Subject" list="adm-subjects" className={cx(inputCls, 'min-w-[200px] flex-1')} value={x.subject} onChange={(e) => setRow(i, 'subject', e.target.value)} placeholder="Subject" />
          <Button type="button" size="sm" variant="secondary" onClick={() => setF({ ...f, teaches: f.teaches.filter((_, j) => j !== i) })}>Remove</Button></div>)}
        <datalist id="adm-subjects">{subjectsFor('1').map((s) => <option key={s} value={s} />)}</datalist>
        <Button type="button" size="sm" variant="secondary" icon="plus" onClick={() => setF({ ...f, teaches: [...f.teaches, { division: allDivisions()[0], subject: '' }] })}>Add class</Button>
      </fieldset>
      {err && <p role="alert" className="text-sm text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit">Save</Button></div>
    </form>
  )
}

function Students() {
  const { db, me, setDb, pushToast } = useApp()
  const [edit, setEdit] = useState(null)
  const students = Object.values(db.profiles).filter((p) => isStudent(p) && p.division).sort((a, b) => (a.division + a.roll).localeCompare(b.division + b.roll))
  return (
    <Card>
      <CardTitle eyebrow="Students can't change their own division or roll number once saved">Students</CardTitle>
      <ul className="flex flex-col divide-y divide-line">{students.map((p) => <li key={p.id} className="flex items-center gap-2 py-2 text-[14px]"><span className="w-[110px] flex-none font-mono text-[12.5px]">{p.roll}</span><span className="min-w-0 flex-1 truncate">{p.name} · {divisionInfo(p.division)?.label}{p.demo ? ' · sample' : ''}</span><Button size="sm" variant="secondary" onClick={() => setEdit({ id: p.id, year: p.year, branchId: p.branchId, division: p.division, roll: p.roll })}>Change</Button></li>)}</ul>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title="Change division / year">
        {edit && <form noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); const r = changeStudentAcademic(db.profiles, edit.id, { year: edit.year, branchId: edit.branchId, division: edit.division, roll: edit.roll }, me, new Date()); if (!r.ok) return pushToast(r.error, 'bad'); setDb((d) => ({ ...d, profiles: { ...d.profiles, [edit.id]: r.profile } })); pushToast(`Moved to ${r.label}. History kept.`); setEdit(null) }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Year">{(id) => <select id={id} className={inputCls} value={edit.year} onChange={(e) => setEdit({ ...edit, year: e.target.value, division: divisionsFor(e.target.value, edit.branchId)[0] })}>{YEARS.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select>}</Field>
            <Field label="Branch">{(id) => <select id={id} className={inputCls} value={edit.branchId} onChange={(e) => setEdit({ ...edit, branchId: e.target.value, division: divisionsFor(edit.year, e.target.value)[0] })}>{BRANCHES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>}</Field>
            <Field label="Division">{(id) => <select id={id} className={inputCls} value={edit.division} onChange={(e) => setEdit({ ...edit, division: e.target.value })}>{divisionsFor(edit.year, edit.branchId).map((d) => <option key={d}>{d}</option>)}</select>}</Field>
            <Field label="Roll number">{(id) => <input id={id} className={inputCls} value={edit.roll} onChange={(e) => setEdit({ ...edit, roll: e.target.value })} />}</Field>
          </div>
          <p className="text-[12.5px] text-muted">Past attendance and submissions stay with the old division's records; the change is logged in the student's history.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button type="submit">Save change</Button></div>
        </form>}
      </Dialog>
    </Card>
  )
}

function Reports() {
  const { db, me, runShared } = useApp()
  const flagged = (db.shared.notes || []).filter((n) => openReports(db.shared, n.id).length)
  return (
    <Card>
      <CardTitle eyebrow="Reported by students">Notes reports</CardTitle>
      {flagged.length ? <ul className="flex flex-col divide-y divide-line">{flagged.map((n) => { const r = openReports(db.shared, n.id); return (
        <li key={n.id} className="flex flex-wrap items-center gap-2 py-2.5"><span className="min-w-0 flex-1"><b>{n.title}</b><small className="block text-[12.5px] text-muted">{r.length} report{r.length > 1 ? 's' : ''}: {r.map((x) => x.reason + (x.details ? ` (“${x.details}”)` : '')).join('; ')}</small></span>
          <Button size="sm" variant="secondary" onClick={() => runShared((s) => resolveReports(s, n.id, me, 'dismiss'), 'Reports dismissed.')}>Keep note</Button><Button size="sm" variant="secondary" className="!text-bad" onClick={() => runShared((s) => resolveReports(s, n.id, me, 'remove'), 'Note removed.')}>Remove note</Button></li>) })}</ul>
        : <Empty icon="check" title="Nothing reported">Reported notes appear here.</Empty>}
    </Card>
  )
}
