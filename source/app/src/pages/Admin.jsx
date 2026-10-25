import { useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Empty, Segmented, Dialog, Field, inputCls, cx } from '../components/ui.jsx'
import { changeStudentAcademic } from '../lib/admin.js'
import { resolveReports, openReports } from '../lib/notes.js'
import { isAdmin, isStudent } from '../lib/posts.js'
import { allDivisions, divisionInfo, subjectsFor, YEARS, BRANCHES, divisionsFor } from '../data/academics.js'

/**
 * Admin (demo only): student division changes, attendance
 * password resets and notes moderation. Canteen menus are edited on the Canteens page. Admin itself is decided on
 * the demo admin account (there is no admin role on the college server).
 */
export default function Admin() {
  const { me } = useApp()
  const [tab, setTab] = useState('teachers')
  if (!isAdmin(me)) return <div className="py-10"><Empty icon="lock" title="Admin access only">This page is part of the offline demo only.</Empty></div>
  return (
    <div>
      <PageHeader title="Admin" subtitle="Move demo students between divisions, reset attendance passwords and moderate shared notes. Canteen menus are edited on the Canteens page." />
      <p className="mb-4 rounded-lg bg-[#EAF0FC] px-3 py-2 text-[13.5px] text-route">Real accounts (Google sign-in) are managed on the college server: the HOD of each branch manages them in the HOD portal (sign in on the HOD tab). The tools on this page work on this browser’s demo data.</p>
      <div className="mb-4"><Segmented label="Admin section" value={tab} onChange={setTab} options={[{ value: 'teachers', label: 'Teachers' }, { value: 'students', label: 'Students' }, { value: 'notes', label: 'Notes reports' }]} /></div>
      {tab === 'teachers' && <Teachers />}{tab === 'students' && <Students />}{tab === 'notes' && <Reports />}
    </div>
  )
}

function Teachers() {
  const { db, setDb, pushToast } = useApp()
  const demoTeachers = Object.values(db.profiles).filter((p) => p.role === 'teacher')
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardTitle eyebrow="College server">Teachers</CardTitle>
        <p className="text-[13.5px] text-muted">Real teachers are added by their HOD in the HOD portal, with their college Google account (…@ves.ac.in). This demo admin page can’t grant anyone a teacher role.</p>
      </Card>
      <Card>
        <CardTitle eyebrow="Demo accounts (sample data)">Attendance edit passwords</CardTitle>
        <ul className="flex flex-col gap-2">{[...demoTeachers].map((t) => (
          <li key={t.id} className="flex items-center gap-2 text-[14px]"><span className="flex-1">{t.name}</span>{db.shared.attSecrets?.[t.id] ? <Badge tone="ok">Password set</Badge> : <Badge>Not set</Badge>}
            {db.shared.attSecrets?.[t.id] && <Button size="sm" variant="secondary" onClick={() => { setDb((d) => { const s = { ...d.shared.attSecrets }; delete s[t.id]; return { ...d, shared: { ...d.shared, attSecrets: s } } }); pushToast(`Password reset. ${t.name} must set a new one before editing attendance.`) }}>Reset</Button>}</li>))}</ul>
      </Card>
    </div>
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
