// HOD tools from the portal upgrade: the branch-wide view (all four years, with filters), division set-up for
// years whose divisions aren't seeded, the syllabus link, and club/council provisioning. Server-checked.
import { useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Card, CardTitle, Button, Badge, Empty, Field, inputCls, relTime, fmtDateTime, cx, ConfirmButton } from './ui.jsx'
import { api } from '../lib/portal.js'
import { useLoad, Loading, resetCatalog } from './CloudPortal.jsx'
import { KIND_LABEL } from './Academic.jsx'
import { fmtDay } from '../lib/calendar.js'

const SEV = { warn: 'warn', info: 'info' }
const ROLE = { cr: 'CR', si: 'SI', ci: 'CI' }
const Table = ({ head, rows, empty, min = 560 }) => rows.length ? (
  <div className="overflow-x-auto"><table className="w-full text-left text-[13.5px]" style={{ minWidth: min }}><thead className="text-muted"><tr>{head.map((h) => <th key={h} className="py-1.5 pr-3 font-semibold">{h}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>
) : <p className="text-[13.5px] text-muted">{empty}</p>

export function BranchView() {
  const [q, setQ] = useState({ year: '', division: '', subject: '', from: '', to: '' })
  const [applied, setApplied] = useState(q)
  const s = useLoad(() => api('branch-overview', { query: applied }), [JSON.stringify(applied)])
  const d = s.data
  const set = (k) => (e) => setQ({ ...q, [k]: e.target.value, ...(k === 'year' ? { division: '' } : {}) })
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); setApplied(q) }}>
          <Field label="Year">{(id) => <select id={id} className={inputCls} value={q.year} onChange={set('year')}><option value="">All years</option>{(d?.years || []).map((y) => <option key={y.id} value={y.id}>{y.label} {y.calendar}</option>)}</select>}</Field>
          <Field label="Division">{(id) => <select id={id} className={inputCls} value={q.division} onChange={set('division')}><option value="">All</option>{(d?.divisions || []).filter((x) => !q.year || x.year_id === q.year).map((x) => <option key={x.code} value={x.code}>{x.code}</option>)}</select>}</Field>
          <Field label="Subject">{(id) => <select id={id} className={inputCls} value={q.subject} onChange={set('subject')}><option value="">All</option>{(d?.subjects || []).map((x) => <option key={x} value={x}>{x}</option>)}</select>}</Field>
          <Field label="From">{(id) => <input id={id} type="date" className={inputCls} value={q.from} onChange={set('from')} />}</Field>
          <Field label="To">{(id) => <input id={id} type="date" className={inputCls} value={q.to} onChange={set('to')} />}</Field>
          <div className="flex items-end gap-2"><Button type="submit">Apply</Button><Button type="button" variant="ghost" onClick={() => { const z = { year: '', division: '', subject: '', from: '', to: '' }; setQ(z); setApplied(z) }}>Reset</Button></div>
        </form>
      </Card>
      <Loading s={s}>{d && <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Divisions', d.divisions.length], ['Students', d.divisions.reduce((a, x) => a + x.students, 0)], ['Below attendance threshold', d.defaulters === null ? 'not set' : d.defaulters.length], ['Data-quality issues', d.issues.length]].map(([l, n]) => <Card key={l}><b className="font-display text-[26px]">{n}</b><span className="block text-[13px] text-muted">{l}</span></Card>)}
        </div>
        <Card><CardTitle eyebrow={d.branch}>Data quality</CardTitle>
          {d.issues.length ? <ul className="flex flex-col gap-1.5">{d.issues.map((i, k) => <li key={k} className="flex items-start gap-2 text-[13.5px]"><Badge tone={SEV[i.severity]}>{i.severity === 'warn' ? 'Fix' : 'Note'}</Badge><span>{i.text}</span></li>)}</ul> : <p className="text-[13.5px] text-muted">No issues found.</p>}
        </Card>
        <Card><CardTitle>Years, divisions and students</CardTitle>
          <Table head={['Division', 'Year', 'Students', 'Join requests', 'Teachers', 'Timetable', 'Roles']} empty="No divisions in this view."
            rows={d.divisions.map((x) => <tr key={x.code} className="border-t border-line"><td className="py-1.5 pr-3 font-semibold">{x.code}{!x.confirmed && <Badge className="ml-1">to confirm</Badge>}</td><td className="pr-3">{x.year_id}</td><td className="pr-3">{x.students}</td><td className="pr-3">{x.pending_joins ? <Badge tone="warn">{x.pending_joins}</Badge> : 0}</td><td className="pr-3">{x.teachers || <span className="text-warn">none</span>}</td><td className="pr-3">{x.has_timetable ? 'Published' : <span className="text-muted">none</span>}</td>
              <td>{d.roles.filter((r) => r.division_code === x.code).map((r, i) => <Badge key={i} className="mr-1">{ROLE[r.role]}{r.position ? ` ${r.position[0].toUpperCase()}` : ''}: {r.name || '—'}</Badge>)}</td></tr>)} />
        </Card>
        <Card><CardTitle>Teachers and class assignments</CardTitle>
          <Table head={['Teacher', 'Status', 'Classes and subjects']} empty="No teachers yet."
            rows={d.teachers.map((t) => <tr key={t.email} className="border-t border-line"><td className="py-1.5 pr-3">{t.name || '—'}<small className="block text-muted">{t.email}</small></td><td className="pr-3">{t.active ? <Badge tone="ok">active</Badge> : <Badge>inactive</Badge>}</td><td>{t.teaches.length ? t.teaches.map((x) => `${x.division} ${x.subject}`).join(', ') : <span className="text-muted">none in this view</span>}</td></tr>)} />
        </Card>
        <Card><CardTitle eyebrow={d.threshold === null ? 'Threshold not set' : `Threshold ${d.threshold}%`}>Attendance shortage (defaulters)</CardTitle>
          {d.defaulters === null ? <p className="text-[13.5px] text-muted">Set the branch attendance threshold under Attendance alerts to produce this list.</p>
            : <Table head={['Roll', 'Name', 'Division', 'Present', 'Recorded', '%']} empty="Nobody is below the threshold in this view." min={480}
              rows={d.defaulters.map((r) => <tr key={r.id + r.division_code} className="border-t border-line"><td className="py-1.5 pr-3">{r.roll || '—'}</td><td className="pr-3">{r.name || '—'}</td><td className="pr-3">{r.division_code}</td><td className="pr-3">{r.present}</td><td className="pr-3">{r.total}</td><td><Badge tone="bad">{r.percent}%</Badge></td></tr>)} />}
          <p className="mt-2 text-[12.5px] text-muted">Computed from the attendance teachers recorded{applied.subject ? ` for ${applied.subject}` : ''}{applied.from || applied.to ? ' in the chosen dates' : ''}. Students with no recorded lectures aren’t listed.</p>
        </Card>
        <Card><CardTitle>Marks and performance</CardTitle>
          <Table head={['Date', 'Division', 'Subject', 'Assessment', 'Status', 'Entered', 'Average']} empty="No assessments in this view."
            rows={d.marks.map((m) => <tr key={m.id} className="border-t border-line"><td className="py-1.5 pr-3">{m.held_on ? fmtDay(m.held_on, { day: 'numeric', month: 'short' }) : '—'}</td><td className="pr-3">{m.division_code}</td><td className="pr-3">{m.subject}</td><td className="pr-3">{m.name}</td><td className="pr-3"><Badge tone={m.status === 'published' ? 'ok' : 'neutral'}>{m.status}</Badge></td><td className="pr-3">{m.entered}{m.absent ? ` (+${m.absent} absent)` : ''}</td><td>{m.average === null ? '—' : `${m.average} / ${Number(m.max_marks)}`}</td></tr>)} />
        </Card>
        <Card><CardTitle>Assignments, CAs, tutorials, exams and notices</CardTitle>
          <Table head={['Type', 'Title', 'Divisions', 'Date / deadline', 'Status', 'By']} empty="Nothing published in this view."
            rows={d.items.map((p) => <tr key={p.id} className="border-t border-line"><td className="py-1.5 pr-3">{KIND_LABEL[p.kind] || p.kind}</td><td className="pr-3">{p.title}{p.subject && <small className="block text-muted">{p.subject}</small>}</td><td className="pr-3">{(p.divisions || []).join(', ')}</td><td className="pr-3">{p.event_date ? fmtDay(p.event_date, { day: 'numeric', month: 'short' }) : p.due_at ? fmtDateTime(p.due_at) : '—'}</td><td className="pr-3"><Badge tone={p.status === 'published' ? 'ok' : p.status === 'cancelled' ? 'bad' : 'neutral'}>{p.status}</Badge></td><td>{p.author_name}</td></tr>)} />
        </Card>
        <Card><CardTitle>Branch events</CardTitle>
          {d.events.length ? <ul className="flex flex-col gap-1 text-[13.5px]">{d.events.map((e) => <li key={e.id}>{fmtDateTime(e.starts_at)} · <b>{e.title}</b> · {e.venue} <Badge>{e.status}</Badge></li>)}</ul> : <p className="text-[13.5px] text-muted">No branch events in this view.</p>}
        </Card>
      </>}</Loading>
    </div>
  )
}

export function Divisions() {
  const { pushToast, session } = useApp()
  const s = useLoad(() => api('branch-overview'), [])
  const [f, setF] = useState({ yearId: 'SE-2026-27', code: '', name: '' })
  const [err, setErr] = useState('')
  const [syl, setSyl] = useState(null)
  const add = async (e) => {
    e.preventDefault(); setErr('')
    if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(f.code.trim().toUpperCase())) return setErr('Use the division code from the college list (letters, digits and -, up to 12).')
    try { await api('divisions', { method: 'POST', body: { yearId: f.yearId, code: f.code.trim().toUpperCase(), name: f.name.trim() } }); pushToast(`Division ${f.code.toUpperCase()} added. Students can now ask to join it.`); setF({ ...f, code: '', name: '' }); resetCatalog(); s.reload() } catch (x) { setErr(x.message) }
  }
  const confirm = async (code) => { try { await api('division-confirm', { method: 'POST', body: { code } }); pushToast(`${code} confirmed.`); resetCatalog(); s.reload() } catch (x) { pushToast(x.message, 'bad') } }
  const sy = syl || { url: s.data?.syllabus?.url || '', image: s.data?.syllabus?.image || '', label: s.data?.syllabus?.label || '' }
  const saveSyl = async (e) => { e.preventDefault(); try { await api('syllabus', { method: 'POST', body: sy }); pushToast(sy.url ? 'Syllabus link saved. Students see it on their Overview.' : 'Syllabus link removed.'); setSyl(null); s.reload() } catch (x) { pushToast(x.message, 'bad') } }
  return (
    <Loading s={s}>{s.data && <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardTitle eyebrow={session.hod?.branches?.join(', ')}>Add a division</CardTitle>
        <p className="mb-3 text-[13.5px] text-muted">Only first-year divisions came from a verified timetable. Add SE, TE and BE divisions from the college’s official list; nothing is created automatically.</p>
        <form noValidate onSubmit={add} className="grid gap-3 sm:grid-cols-3">
          <Field label="Year">{(id) => <select id={id} className={inputCls} value={f.yearId} onChange={(e) => setF({ ...f, yearId: e.target.value })}>{s.data.years.map((y) => <option key={y.id} value={y.id}>{y.label} {y.calendar}</option>)}</select>}</Field>
          <Field label="Code">{(id) => <input id={id} className={inputCls} maxLength={12} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="e.g. as on the timetable" />}</Field>
          <Field label="Name (optional)">{(id) => <input id={id} className={inputCls} maxLength={40} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          {err && <p role="alert" className="text-[13px] text-bad sm:col-span-3">{err}</p>}
          <div className="sm:col-span-3"><Button type="submit">Add division</Button></div>
        </form>
      </Card>
      <Card><CardTitle>Divisions in your branch</CardTitle>
        <ul className="flex flex-col divide-y divide-line">{s.data.divisions.map((d) => <li key={d.code} className="flex flex-wrap items-center gap-2 py-2"><b className="text-[14px]">{d.code}</b><span className="text-[13px] text-muted">{d.year_id} · {d.students} students{d.source === 'hod' ? ' · added by HOD' : ''}</span>{d.confirmed ? <Badge tone="ok">confirmed</Badge> : <><Badge tone="warn">name to confirm</Badge><ConfirmButton size="sm" variant="secondary" confirmText={`Confirm ${d.code}`} onConfirm={() => confirm(d.code)}>Confirm</ConfirmButton></>}</li>)}</ul>
      </Card>
      <Card className="xl:col-span-2"><CardTitle>Syllabus link for the student Overview</CardTitle>
        <form noValidate onSubmit={saveSyl} className="grid gap-3 sm:grid-cols-3">
          <Field label="Syllabus link (https://)" hint="The official syllabus page or PDF. Leave empty to remove.">{(id) => <input id={id} className={inputCls} value={sy.url} onChange={(e) => setSyl({ ...sy, url: e.target.value })} />}</Field>
          <Field label="Label (optional)">{(id) => <input id={id} className={inputCls} maxLength={80} value={sy.label} onChange={(e) => setSyl({ ...sy, label: e.target.value })} placeholder="e.g. Rev-2024 syllabus" />}</Field>
          <Field label="Photo link (optional)" hint="Empty = the college photo.">{(id) => <input id={id} className={inputCls} value={sy.image} onChange={(e) => setSyl({ ...sy, image: e.target.value })} />}</Field>
          <div className="sm:col-span-3"><Button type="submit">Save</Button></div>
        </form>
      </Card>
    </div>}</Loading>
  )
}

export function ClubsAdmin() {
  const { pushToast } = useApp()
  const s = useLoad(() => api('clubs'), [])
  const [f, setF] = useState({ name: '', kind: 'club', description: '', headEmail: '' })
  const [err, setErr] = useState('')
  const [head, setHead] = useState({})
  const create = async (e) => {
    e.preventDefault(); setErr('')
    if (f.name.trim().length < 2) return setErr('Enter the club’s name.')
    if (!/^[^@\s]+@ves\.ac\.in$/i.test(f.headEmail.trim())) return setErr('The head must use a college account (…@ves.ac.in).')
    try { await api('clubs', { method: 'POST', body: { ...f, name: f.name.trim(), headEmail: f.headEmail.trim() } }); pushToast('Club created. The head sees it after signing in.'); setF({ name: '', kind: 'club', description: '', headEmail: '' }); s.reload() } catch (x) { setErr(x.message) }
  }
  const admin = async (body, msg) => { try { await api('club-admin', { method: 'POST', body }); pushToast(msg); s.reload() } catch (x) { pushToast(x.message, 'bad') } }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardTitle>Set up a club, council or committee</CardTitle>
        <form noValidate onSubmit={create} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">{(id) => <input id={id} className={inputCls} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Type">{(id) => <select id={id} className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="club">Club</option><option value="council">Council</option><option value="committee">Committee</option></select>}</Field>
          </div>
          <Field label="Head (college email)" hint="The head invites teammates and gives them permissions.">{(id) => <input id={id} type="email" className={inputCls} value={f.headEmail} onChange={(e) => setF({ ...f, headEmail: e.target.value })} placeholder="name@ves.ac.in" />}</Field>
          <Field label="Description (optional)">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[60px] py-2')} maxLength={600} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
          {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
          <div><Button type="submit">Create</Button></div>
        </form></Card>
      <Card><CardTitle>Clubs</CardTitle>
        <Loading s={s}>{s.data && (s.data.clubs.length ? <ul className="flex flex-col divide-y divide-line">{s.data.clubs.map((c) => (
          <li key={c.id} className="py-2.5">
            <p className="flex flex-wrap items-center gap-2"><b>{c.name}</b><Badge>{c.kind}</Badge>{!c.active && <Badge tone="bad">inactive</Badge>}<span className="text-[12.5px] text-muted">{c.members} active · created {relTime(c.created_at)}</span></p>
            <p className="text-[12.5px] text-muted">Head: {(c.heads || []).map((h) => h.email).join(', ') || 'none'}</p>
            <form className="mt-1 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (head[c.id]) admin({ clubId: c.id, headEmail: head[c.id] }, 'Head changed.') }}>
              <input aria-label={`New head for ${c.name}`} className={cx(inputCls, 'max-w-[240px]')} placeholder="new head @ves.ac.in" value={head[c.id] || ''} onChange={(e) => setHead({ ...head, [c.id]: e.target.value })} />
              <Button size="sm" type="submit" variant="secondary">Change head</Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => admin({ clubId: c.id, active: !c.active }, c.active ? 'Club deactivated; its events leave feeds.' : 'Club reactivated.')}>{c.active ? 'Deactivate' : 'Reactivate'}</Button>
            </form>
          </li>))}</ul> : <Empty icon="star" title="No clubs yet">Create one with its head’s college email.</Empty>)}</Loading></Card>
    </div>
  )
}
