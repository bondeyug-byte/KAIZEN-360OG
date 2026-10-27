import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Empty, Segmented, Field, inputCls, relTime, ConfirmButton } from '../components/ui.jsx'
import { useLoad, Loading, useCatalog, DivisionPicker, JoinRequests, Roster } from '../components/CloudPortal.jsx'
import { api } from '../lib/portal.js'
import { AlertsManager, EventsManager, ParentLinkRequests, AttendanceThreshold } from '../components/Records.jsx'
import { Publisher, PublishedList, ClassRoles } from '../components/Academic.jsx'
import { BranchView, Divisions, ClubsAdmin } from '../components/HodBranch.jsx'

/**
 * HOD portal (separate route /hod). Only numbers in the server's HOD list reach it; every action is checked again
 * by the server against the HOD's own branch. No classroom screens: no own timetable, classes or attendance.
 */
const TABS = [['dashboard', 'Dashboard'], ['branch', 'Branch view'], ['teachers', 'Teachers'], ['divisions', 'Divisions & syllabus'], ['instructions', 'Instructions'], ['send', 'Publish'], ['published', 'Published in branch'], ['roles', 'Class roles'], ['overrides', 'Join requests'], ['alerts', 'Attendance alerts'], ['events', 'Events'], ['clubs', 'Clubs & councils'], ['parents', 'Parents'], ['audit', 'Audit log']]
export default function Hod({ query = {} }) {
  const { me, session } = useApp()
  const [tab, setTab] = useState(TABS.some((t) => t[0] === query.tab) ? query.tab : 'dashboard')
  useEffect(() => { if (TABS.some((t) => t[0] === query.tab)) setTab(query.tab) }, [query.tab]) // links like #/hod?tab=audit
  if (me?.role !== 'hod' || !session.cloud) return <div className="py-10"><Empty icon="lock" title="HOD access only">Sign in on the HOD tab with the number registered for your branch.</Empty></div>
  return (
    <div>
      <PageHeader title="HOD portal" subtitle={`Branch: ${(session.hod?.branches || []).join(', ')}. Every change here is recorded in the audit log.`} />
      <div className="mb-4 overflow-x-auto"><Segmented label="HOD section" value={tab} onChange={setTab} options={TABS.map(([value, label]) => ({ value, label }))} /></div>
      {tab === 'dashboard' && <Dashboard go={setTab} />}
      {tab === 'teachers' && <Teachers />}
      {tab === 'instructions' && <Instructions />}
      {tab === 'branch' && <BranchView />}
      {tab === 'divisions' && <Divisions />}
      {tab === 'send' && <div className="flex flex-col gap-4"><Publisher /><div><h2 className="mb-2 font-display text-[17px] font-semibold">Published by you</h2><PublishedList /></div></div>}
      {tab === 'published' && <PublishedList branch />}
      {tab === 'roles' && <ClassRoles />}
      {tab === 'clubs' && <ClubsAdmin />}
      {tab === 'overrides' && <div className="flex flex-col gap-4"><JoinRequests hod title="Join requests (all divisions of your branch)" /><Roster hod /></div>}
      {tab === 'audit' && <Audit />}
      {tab === 'alerts' && <div className="flex flex-col gap-4"><AttendanceThreshold /><AlertsManager hod /></div>}
      {tab === 'events' && <EventsManager />}
      {tab === 'parents' && <ParentLinkRequests />}
    </div>
  )
}

function Dashboard({ go }) {
  const s = useLoad(() => api('hod-summary'), [])
  return (
    <Loading s={s}>{s.data && (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Divisions', s.data.divisions.length], ['Students in classes', s.data.divisions.reduce((a, d) => a + d.students, 0)], ['Join requests waiting', s.data.divisions.reduce((a, d) => a + d.pending, 0)], ['CR requests waiting', s.data.pendingCr]].map(([label, n]) => (
            <Card key={label}><b className="font-display text-[28px]">{n}</b><span className="block text-[13px] text-muted">{label}</span></Card>))}
        </div>
        <Card>
          <CardTitle action={<Button size="sm" variant="secondary" onClick={() => go('overrides')}>Review requests</Button>}>Divisions</CardTitle>
          <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[13.5px]"><thead className="text-muted"><tr>{['Division', `Students (max ${s.data.capacity})`, 'Waiting', `Class reps (max ${s.data.maxCrs})`, 'Teachers'].map((h) => <th key={h} className="py-1.5 pr-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{s.data.divisions.map((d) => <tr key={d.code} className="border-t border-line"><td className="py-1.5 pr-3 font-semibold">{d.code}{!d.confirmed && <Badge className="ml-1.5">name to confirm</Badge>}</td><td className="pr-3">{d.students}</td><td className="pr-3">{d.pending ? <Badge tone="warn">{d.pending}</Badge> : 0}</td><td className="pr-3">{d.crs}</td><td>{d.teachers || <span className="text-warn">none assigned</span>}</td></tr>)}</tbody></table></div>
          <p className="mt-2 text-[12.5px] text-muted">A division with no teacher or class rep still sends its join requests to you.</p>
        </Card>
      </div>)}</Loading>
  )
}

function Teachers() {
  const { pushToast, session } = useApp()
  const cat = useCatalog()
  const s = useLoad(() => api('teachers').then((r) => r.teachers), [])
  const blank = { email: '', name: '', code: '', canPublishTimetable: true }
  const [f, setF] = useState(blank)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [assign, setAssign] = useState({ email: '', divisions: [], subject: '' })
  const save = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try { await api('teachers', { method: 'POST', body: { ...f, branch: session.hod.branches[0] } }); pushToast('Teacher saved. They can now sign in on the Teacher tab.'); setAssign({ ...assign, email: f.email }); setF(blank); s.reload() }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const status = async (t, active) => { try { await api('teacher-status', { method: 'POST', body: { email: t.email, active } }); pushToast(active ? 'Teacher re-activated.' : 'Teacher deactivated. Their access ends on their next action.'); s.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const addDivs = async () => {
    setBusy(true)
    try { for (const division of assign.divisions) await api('teacher-division', { method: 'POST', body: { email: assign.email, division, subject: assign.subject } }); pushToast(`Assigned ${assign.divisions.join(', ')}.`); setAssign({ ...assign, divisions: [] }); s.reload() }
    catch (x) { pushToast(x.message, 'bad') } finally { setBusy(false) }
  }
  const unassign = async (t, division) => { try { await api('teacher-division', { method: 'POST', body: { email: t.email, division, action: 'remove' } }); s.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const branchCat = cat.data && { ...cat.data, divisions: cat.data.divisions.map((d) => ({ ...d, can: { ...d.can, assign: session.hod.branches.includes(d.branch_code) } })) }
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <Card>
        <CardTitle eyebrow="Only active numbers here can open the Teacher portal">Teachers</CardTitle>
        <Loading s={s}>{!s.data?.length ? <p className="mt-2 text-[13.5px] text-muted">No teachers yet. Add one on the right.</p> : (
          <ul className="mt-2 text-[13.5px]">{s.data.map((t) => (
            <li key={t.email} className="border-t border-line py-2">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{t.name}</span>{t.code && <Badge>{t.code}</Badge>}<span className="text-muted">{t.email} · {t.branch_code}</span>{!t.active && <Badge tone="bad">Deactivated</Badge>}{t.can_publish_timetable && <Badge tone="info">Timetables</Badge>}
                <span className="ml-auto flex gap-2"><Button size="sm" variant="ghost" onClick={() => setAssign({ ...assign, email: t.email })}>Assign divisions</Button>{t.active ? <ConfirmButton size="sm" variant="ghost" confirmText="Deactivate now" onConfirm={() => status(t, false)}>Deactivate</ConfirmButton> : <Button size="sm" variant="secondary" onClick={() => status(t, true)}>Re-activate</Button>}</span></div>
              <div className="mt-1 flex flex-wrap gap-1.5">{t.teaches.length ? t.teaches.map((x) => <span key={x.division + x.subject} className="inline-flex items-center gap-1 rounded-md bg-ground px-1.5 py-0.5 text-[12px]">{x.division}: {x.subject}<button type="button" aria-label={`Remove ${x.division}`} className="text-muted hover:text-bad" onClick={() => unassign(t, x.division)}>×</button></span>) : <span className="text-[12.5px] text-warn">No divisions assigned yet</span>}</div>
            </li>))}</ul>)}</Loading>
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle eyebrow="Add or update">Teacher</CardTitle>
          <form onSubmit={save} className="mt-2 flex flex-col gap-3" noValidate>
            <Field label="College Google account" hint="The …@ves.ac.in email they sign in with">{(id) => <input id={id} className={inputCls} type="email" inputMode="email" autoComplete="off" placeholder="name@ves.ac.in" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <Field label="Teacher name">{(id) => <input id={id} className={inputCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
              <Field label="Initials" hint="As in the timetable">{(id) => <input id={id} className={inputCls} value={f.code} maxLength={12} onChange={(e) => setF({ ...f, code: e.target.value })} />}</Field>
            </div>
            <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={f.canPublishTimetable} onChange={(e) => setF({ ...f, canPublishTimetable: e.target.checked })} />Can upload and publish timetables for their divisions</label>
            {err && <p role="alert" className="text-[13.5px] text-bad">{err}</p>}
            <div><Button type="submit" disabled={busy}>Save teacher</Button></div>
          </form>
        </Card>
        <Card>
          <CardTitle eyebrow="Your branch’s divisions only">Assign divisions</CardTitle>
          <div className="mt-2 flex flex-col gap-3">
            <Field label="Teacher">{(id) => <select id={id} className={inputCls} value={assign.email} onChange={(e) => setAssign({ ...assign, email: e.target.value })}><option value="">Choose…</option>{(s.data || []).filter((t) => t.active).map((t) => <option key={t.email} value={t.email}>{t.name} {t.code ? `(${t.code})` : ''}</option>)}</select>}</Field>
            <Loading s={cat}>{branchCat && <DivisionPicker catalog={branchCat} value={assign.divisions} onChange={(divisions) => setAssign({ ...assign, divisions })} perm="assign" idPrefix="assign" />}</Loading>
            <Field label="Subject they teach there">{(id) => <input id={id} className={inputCls} value={assign.subject} maxLength={80} onChange={(e) => setAssign({ ...assign, subject: e.target.value })} />}</Field>
            <div><Button disabled={busy || !assign.email || !assign.divisions.length || !assign.subject.trim()} onClick={addDivs}>Assign</Button></div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Instructions() {
  const { pushToast } = useApp()
  const teachers = useLoad(() => api('teachers').then((r) => r.teachers.filter((t) => t.active)), [])
  const sent = useLoad(() => api('instructions').then((r) => r.sent), [])
  const [f, setF] = useState({ title: '', body: '', dueDate: '', to: 'all', picked: [] })
  const [busy, setBusy] = useState(false)
  const send = async (e) => {
    e.preventDefault(); setBusy(true)
    try { const r = await api('instructions', { method: 'POST', body: { title: f.title, body: f.body, dueDate: f.dueDate || null, teachers: f.to === 'all' ? 'all' : f.picked } }); pushToast(`Sent to ${r.instruction.recipients} teacher${r.instruction.recipients > 1 ? 's' : ''}.`); setF({ title: '', body: '', dueDate: '', to: 'all', picked: [] }); sent.reload() }
    catch (x) { pushToast(x.message, 'bad') } finally { setBusy(false) }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <Card>
        <CardTitle>Send an instruction</CardTitle>
        <form onSubmit={send} className="mt-2 flex flex-col gap-3">
          <Field label="Title">{(id) => <input id={id} className={inputCls} maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Message">{(id) => <textarea id={id} rows={4} className={inputCls} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
          <Field label="Due date (optional)">{(id) => <input id={id} type="date" className={inputCls} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />}</Field>
          <Segmented label="Send to" value={f.to} onChange={(to) => setF({ ...f, to })} options={[{ value: 'all', label: 'All my teachers' }, { value: 'some', label: 'Selected teachers' }]} />
          {f.to === 'some' && <Loading s={teachers}><div className="flex flex-col gap-1">{(teachers.data || []).map((t) => <label key={t.email} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={f.picked.includes(t.email)} onChange={(e) => setF({ ...f, picked: e.target.checked ? [...f.picked, t.email] : f.picked.filter((x) => x !== t.email) })} />{t.name}</label>)}</div></Loading>}
          <div><Button type="submit" disabled={busy || f.title.trim().length < 3 || (f.to === 'some' && !f.picked.length)}>{busy ? 'Sending…' : 'Send'}</Button></div>
        </form>
      </Card>
      <Card>
        <CardTitle>Sent instructions</CardTitle>
        <Loading s={sent}>{!sent.data?.length ? <p className="mt-2 text-[13.5px] text-muted">Nothing sent yet.</p> : (
          <ul className="mt-2 text-[13.5px]">{sent.data.map((i) => (
            <li key={i.id} className="border-t border-line py-2"><div className="flex flex-wrap items-center gap-2"><b>{i.title}</b><span className="text-muted">{relTime(i.created_at)}{i.due_date ? ` · due ${i.due_date}` : ''}</span>
              <Badge tone="ok">{i.recipients.filter((r) => r.status === 'done').length} done</Badge><Badge tone="info">{i.recipients.filter((r) => r.status === 'seen').length} seen</Badge><Badge tone="warn">{i.recipients.filter((r) => r.status === 'sent').length} not opened</Badge></div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[12.5px]">{i.recipients.map((r) => <span key={r.name} className="rounded-md bg-ground px-1.5 py-0.5">{r.name}: {r.status === 'sent' ? 'not opened' : r.status}</span>)}</div></li>))}</ul>)}</Loading>
      </Card>
    </div>
  )
}

const ACTION_TEXT = {
  'account.create': 'Account created', 'teacher.add': 'Teacher added', 'teacher.update': 'Teacher updated', 'teacher.deactivate': 'Teacher deactivated', 'teacher.reactivate': 'Teacher re-activated',
  'teacher.assign': 'Teacher assigned to division', 'teacher.unassign': 'Teacher removed from division', 'post.create': 'Sent to classes', 'post.delete': 'Post deleted',
  'join.request': 'Asked to join', 'join.cancel': 'Join request cancelled', 'join.approve': 'Join approved', 'join.reject': 'Join rejected', 'enrollment.revoke': 'Removed from class',
  'cr.request': 'Asked to be class rep', 'cr.approve': 'Class rep approved', 'cr.reject': 'Class rep rejected', 'cr.assign': 'Class rep assigned', 'cr.remove': 'Class rep removed',
  'instruction.send': 'Instruction sent', 'reminder.create': 'Reminder set', 'timetable.publish': 'Timetable published', 'timetable.rollback': 'Timetable restored',
}
function Audit() {
  const { pushToast, now } = useApp()
  const [rows, setRows] = useState([])
  const s = useLoad(() => api('audit').then((r) => { setRows(r.entries); return r.entries }), [])
  const more = async () => { try { const r = await api('audit', { query: { before: rows[rows.length - 1].id } }); setRows((x) => [...x, ...r.entries]) } catch (e) { pushToast(e.message, 'bad') } }
  return (
    <Card>
      <CardTitle eyebrow="Your branch">Audit log</CardTitle>
      <Loading s={s}><ul className="mt-2 text-[13.5px]">{rows.map((r) => (
        <li key={r.id} className="flex flex-wrap gap-x-2 border-t border-line py-1.5"><span className="w-[110px] shrink-0 text-muted">{relTime(r.at, now)}</span><span className="font-semibold">{ACTION_TEXT[r.action] || r.action}</span>
          <span className="text-muted">{r.actor_name || '—'}{r.detail?.division ? ` · ${r.detail.division}` : ''}{r.detail?.divisions ? ` · ${[].concat(r.detail.divisions).join(', ')}` : ''}{r.detail?.by ? ` · as ${r.detail.by}` : ''}{r.detail?.override ? ' · HOD override' : ''}{r.detail?.term ? ` · ${r.detail.term}` : ''}{r.detail?.title ? ` · ${r.detail.title}` : ''}</span></li>))}</ul>
        {rows.length >= 100 && rows.length % 100 === 0 && <Button className="mt-2" variant="secondary" onClick={more}>Load older</Button>}</Loading>
    </Card>
  )
}
