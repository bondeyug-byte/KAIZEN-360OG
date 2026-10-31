// Shared college-portal screens (server data, server-checked). Used by the student College portal (incl. CR Tools),
// the Teacher portal and the HOD portal. The server decides permissions; these screens only show what it allows.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Card, CardTitle, Button, Badge, Empty, Segmented, Field, inputCls, relTime, cx, ConfirmButton, Spinner } from './ui.jsx'
import Icon from './Icon.jsx'
import { api, downloadFile, fileToBase64, MAX_UPLOAD, UPLOAD_TYPES, DAY_NAMES, hhmm, fmtBytes } from '../lib/portal.js'
import { readSheets } from '../lib/sheets.js'
import { useMyTimetable, refreshTimetable } from '../lib/timetable.js'

/* ---------------- data helpers ---------------- */
export function useLoad(fn, deps) {
  const [st, set] = useState({ loading: true, data: null, error: '' })
  const run = useCallback(() => { set((s) => ({ ...s, loading: true, error: '' })); return fn().then((data) => set({ loading: false, data, error: '' })).catch((e) => set({ loading: false, data: null, error: e.message })) }, deps) // eslint-disable-line
  useEffect(() => { run() }, [run])
  return { ...st, reload: run }
}
export const Loading = ({ s, children }) => (s.loading && !s.data ? <Spinner label="Loading" /> : s.error ? <p role="alert" className="text-[13.5px] text-bad">{s.error}</p> : children)
let catalogCache = null
/** Branches → years → divisions from the database, with what this user may do in each division. */
export function useCatalog() { return useLoad(() => (catalogCache = catalogCache || api('catalog').catch((e) => { catalogCache = null; throw e })), []) }
export const resetCatalog = () => { catalogCache = null }
const STATUS_TONE = { approved: 'ok', pending: 'warn', rejected: 'bad', cancelled: 'neutral' }
const ROLE_NAME = { cr: 'Class representative', si: 'Sports incharge', ci: 'Cultural incharge' }
const busyWrap = (setBusy, fn) => async (...a) => { setBusy(true); try { await fn(...a) } finally { setBusy(false) } }

/* ---------------- Branch → Year → Division picker (F5) ---------------- */
/**
 * mode 'multi': choose many divisions (only those `perm` allows are clickable; the server re-checks).
 * mode 'single': choose one division (joining a class).
 */
export function DivisionPicker({ catalog, value, onChange, perm, mode = 'multi', idPrefix = 'dp' }) {
  const { branches = [], years = [], divisions = [] } = catalog || {}
  const allowed = (d) => !perm || d.can?.[perm]
  const firstAllowed = divisions.find(allowed)
  const [branch, setBranch] = useState(firstAllowed?.branch_code || branches[0]?.code || '')
  const yearsFor = years.filter((y) => divisions.some((d) => d.branch_code === branch && d.year_id === y.id))
  const [year, setYear] = useState(firstAllowed?.year_id || yearsFor[0]?.id || '')
  useEffect(() => { if (!yearsFor.some((y) => y.id === year)) setYear(yearsFor[0]?.id || '') }, [branch]) // eslint-disable-line
  const list = divisions.filter((d) => d.branch_code === branch && d.year_id === year)
  const sel = mode === 'single' ? (value ? [value] : []) : value || []
  const toggle = (code) => (mode === 'single' ? onChange(code) : onChange(sel.includes(code) ? sel.filter((x) => x !== code) : [...sel, code]))
  const mine = list.filter(allowed).map((d) => d.code)
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Branch">{(id) => <select id={`${idPrefix}-${id}`} aria-label="Branch" className={inputCls} value={branch} onChange={(e) => setBranch(e.target.value)}>{branches.map((b) => <option key={b.code} value={b.code}>{b.name} ({b.code})</option>)}</select>}</Field>
        <Field label="Year">{(id) => <select id={`${idPrefix}-${id}`} aria-label="Year" className={inputCls} value={year} onChange={(e) => setYear(e.target.value)} disabled={!yearsFor.length}>{!yearsFor.length && <option>No years set up yet</option>}{yearsFor.map((y) => <option key={y.id} value={y.id}>{y.label} {y.calendar}</option>)}</select>}</Field>
      </div>
      <div role="group" aria-label="Divisions" className="flex flex-wrap gap-2">
        {!list.length ? <p className="text-[13px] text-muted">No divisions are set up for this branch and year yet.</p> : list.map((d) => {
          const on = sel.includes(d.code), ok = allowed(d)
          return <button type="button" key={d.code} aria-pressed={on} disabled={!ok} title={ok ? d.code : 'Not assigned to you'} onClick={() => toggle(d.code)}
            className={cx('press min-h-[36px] rounded-lg px-3 text-[13px] font-semibold ring-1', on ? 'bg-brand text-white ring-brand' : ok ? 'bg-surface ring-line' : 'cursor-not-allowed bg-ground text-muted ring-line opacity-60')}>{d.code}{!ok && <Icon name="lock" size={12} className="ml-1 inline" />}</button>
        })}
        {mode === 'multi' && mine.length > 1 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...new Set([...sel, ...mine])])}>All my divisions here</Button>}
      </div>
      {mode === 'multi' && sel.length > 0 && <p className="text-[12.5px] text-muted">Selected: {sel.map((c) => <Badge key={c} tone="info" className="mr-1">{c}</Badge>)}</p>}
    </div>
  )
}

/* ---------------- Student: join a class + CR request (F1, F2) ---------------- */
export function MyClass() {
  const { session, pushToast, refreshAccount } = useApp()
  const cat = useCatalog()
  const [division, setDivision] = useState('')
  const [busy, setBusy] = useState(false)
  const e = session.enrollment, jr = session.joinRequest, crq = session.crRequest, isCr = (session.cr || []).length > 0
  const act = (fn, okText) => busyWrap(setBusy, async () => { try { await fn(); pushToast(okText); await refreshAccount(); refreshTimetable() } catch (x) { pushToast(x.message, 'bad') } })
  const send = act(() => api('join-requests', { method: 'POST', body: { division } }), `Request sent to join ${division}. Your teacher, class rep or HOD will review it.`)
  const cancel = act(() => api('join-requests', { method: 'DELETE', query: { id: jr.id } }), 'Request cancelled.')
  const askRole = (role) => act(() => api('role-requests', { method: 'POST', body: { role } }), `${ROLE_NAME[role]} request sent to your class teacher.`)()
  const cancelCr = act(() => api('cr-requests', { method: 'DELETE', query: { id: crq.id } }), 'Request cancelled.')
  const roles = session.classRoles || { cr: [], si: [], ci: [] }
  const held = [isCr && `Class representative${roles.crPosition ? ` (${roles.crPosition} CR)` : ''}`, (roles.si || []).length && 'Sports incharge (SI)', (roles.ci || []).length && 'Cultural incharge (CI)'].filter(Boolean)
  if (e) return (
    <Card className="max-w-xl">
      <CardTitle eyebrow="Your class">{e.division_code}</CardTitle>
      <p className="mt-1 text-[13.5px] text-muted">Approved {relTime(e.approved_at)}. You see this class’s timetable, notices, reminders and attendance.</p>
      <ChangeDivision e={e} jr={jr} cat={cat} busy={busy} setBusy={setBusy} />
      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-[14px] font-semibold">Class roles</h3>
        {held.length > 0 && <p className="mt-1 flex flex-wrap gap-1.5 text-[13.5px]">{held.map((h) => <Badge key={h} tone="ok">{h}</Badge>)}</p>}
        {crq?.status === 'pending' ? <p className="mt-1 flex flex-wrap items-center gap-2 text-[13.5px]"><Badge tone="warn">{ROLE_NAME[crq.role || 'cr']} request waiting</Badge>Your class teacher or HOD will decide. <Button size="sm" variant="ghost" disabled={busy} onClick={cancelCr}>Cancel request</Button></p>
          : <div className="mt-1 flex flex-wrap items-center gap-2 text-[13.5px]">{crq?.status === 'rejected' && <Badge tone="bad">Last request not approved{crq.note ? `: ${crq.note}` : ''}</Badge>}
            {!isCr && <Button size="sm" variant="secondary" disabled={busy} onClick={() => askRole('cr')}>Request CR</Button>}
            {!(roles.si || []).length && <Button size="sm" variant="secondary" disabled={busy} onClick={() => askRole('si')}>Request sports incharge (SI)</Button>}
            {!(roles.ci || []).length && <Button size="sm" variant="secondary" disabled={busy} onClick={() => askRole('ci')}>Request cultural incharge (CI)</Button>}</div>}
        <p className="mt-2 text-[12.5px] text-muted">Your class teacher approves each role. A class has a male CR and a female CR (the teacher chooses), one SI and one CI.</p>
      </div>
    </Card>)
  return (
    <Card className="max-w-2xl">
      <CardTitle eyebrow="Step 1">Join your class</CardTitle>
      {jr?.status === 'pending' ? (
        <div className="mt-2 text-[14px]"><p className="flex flex-wrap items-center gap-2"><Badge tone="warn">Request pending</Badge>to join <b>{jr.division_code}</b> · sent {relTime(jr.created_at)}</p>
          <p className="mt-1 text-[13px] text-muted">Your class content appears after a teacher, class rep or the HOD approves. Refresh this page later.</p>
          <Button className="mt-3" size="sm" variant="secondary" disabled={busy} onClick={cancel}>Cancel request</Button></div>
      ) : (
        <form onSubmit={(ev) => { ev.preventDefault(); if (division) send() }} className="mt-2 flex flex-col gap-3">
          {jr?.status === 'rejected' && <p className="text-[13.5px]"><Badge tone="bad">Not approved</Badge> for {jr.division_code}{jr.note ? `: “${jr.note}”` : ''}. Check your division and request again.</p>}
          <Loading s={cat}>{cat.data && <DivisionPicker catalog={ownBranch(cat.data, session.setup)} mode="single" value={division} onChange={setDivision} idPrefix="join" />}</Loading>
          {session.setup && <p className="text-[12.5px] text-muted">Showing {session.setup.branch} divisions for your year, from your profile. Wrong branch or year? <a className="font-semibold text-maroon underline" href="#/setup?edit=1">Correct your profile</a> first.</p>}
          <div><Button type="submit" disabled={!division || busy}>{busy ? 'Sending…' : division ? `Request to join ${division}` : 'Choose your division'}</Button></div>
        </form>)}
      <p className="mt-4 text-[12.5px] text-muted">Google sign-in proves you own your college account, not that you are in that class, so a teacher, your class rep or the HOD approves each request.</p>
    </Card>
  )
}

/** A first join offers only the branch and year from "Set up your profile" (the server enforces the same). */
function ownBranch(cat, setup) {
  if (!setup?.branch) return cat
  const years = (cat.years || []).filter((y) => y.level === Number(setup.yearLevel))
  return { ...cat, branches: (cat.branches || []).filter((b) => b.code === setup.branch), years, divisions: (cat.divisions || []).filter((d) => d.branch_code === setup.branch && years.some((y) => y.id === d.year_id)) }
}

/* ---------------- Student: change division (request → target class teacher or HOD approves) ---------------- */
function ChangeDivision({ e, jr, cat, busy, setBusy }) {
  const { pushToast, refreshAccount } = useApp()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const pending = jr?.status === 'pending' && jr.kind === 'transfer' ? jr : null
  const last = !pending && jr?.kind === 'transfer' && jr.status === 'rejected' ? jr : null
  const cur = (cat.data?.divisions || []).find((d) => d.code === e.division_code)
  // any other division; another branch or year is decided by that class's teacher or that branch's HOD (server-checked)
  const yearLabel = (id) => (cat.data?.years || []).find((y) => y.id === id)?.label || id
  const options = (cat.data?.divisions || []).filter((d) => cur && d.code !== e.division_code)
    .sort((a, b) => (a.branch_code === cur?.branch_code ? 0 : 1) - (b.branch_code === cur?.branch_code ? 0 : 1) || a.branch_code.localeCompare(b.branch_code) || a.code.localeCompare(b.code))
  const picked = options.find((d) => d.code === to)
  const crossing = picked && cur && (picked.branch_code !== cur.branch_code || picked.year_id !== cur.year_id)
  const after = async () => { await refreshAccount(); refreshTimetable() }
  const submit = busyWrap(setBusy, async () => {
    setErr('')
    if (!to) return setErr('Choose the division you should be in.')
    if (reason.trim().length < 5) return setErr('Say briefly why you need to change division.')
    try { await api('join-requests', { method: 'POST', body: { division: to, reason: reason.trim() } }); pushToast(`Request sent to move to ${to}. You stay in ${e.division_code} until a teacher of ${to} or the HOD approves.`); setOpen(false); setTo(''); setReason(''); await after() }
    catch (x) { setErr(x.message) }
  })
  const cancel = busyWrap(setBusy, async () => { try { await api('join-requests', { method: 'DELETE', query: { id: pending.id } }); pushToast('Change request cancelled.'); await after() } catch (x) { pushToast(x.message, 'bad') } })
  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="text-[14px] font-semibold">Change division</h3>
      {pending ? (
        <div className="mt-1 text-[13.5px]">
          <p className="flex flex-wrap items-center gap-2"><Badge tone="warn">Waiting for approval</Badge>Move from <b>{pending.from_division}</b> to <b>{pending.division_code}</b> · sent {relTime(pending.created_at)}</p>
          <p className="mt-1 text-[13px] text-muted">You stay in {e.division_code} until a teacher of {pending.division_code} or the HOD approves. Your attendance history moves with you.</p>
          <Button className="mt-2" size="sm" variant="ghost" disabled={busy} onClick={cancel}>Cancel request</Button>
        </div>
      ) : !open ? (
        <div className="mt-1 text-[13.5px]">
          {last && <p className="mb-2"><Badge tone="bad">Not approved</Badge> move to {last.division_code}{last.note ? `: “${last.note}”` : ''}</p>}
          <p className="text-[13px] text-muted">Chose the wrong division, branch or year? Ask to move. The teacher of the new class (or that branch’s HOD) approves.</p>
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => setOpen(true)}>Request a change</Button>
        </div>
      ) : (
        <form className="mt-2 flex flex-col gap-3" onSubmit={(ev) => { ev.preventDefault(); submit() }} noValidate>
          <Loading s={cat}>{!options.length ? <p className="text-[13px] text-muted">There is no other division set up yet.</p> : (
            <Field label="Move to" hint={crossing ? `This changes your branch/year to ${picked.branch_code} ${yearLabel(picked.year_id)}. Your profile is updated when it’s approved.` : undefined}>{(id) => <select id={id} className={inputCls} value={to} onChange={(ev) => setTo(ev.target.value)}><option value="">Choose a division</option>{options.map((d) => <option key={d.code} value={d.code}>{d.code} · {d.branch_code} {yearLabel(d.year_id)}{d.branch_code !== cur?.branch_code ? ' (other branch)' : ''}</option>)}</select>}</Field>)}</Loading>
          <Field label="Reason" hint="Your teacher sees this. Class reps don’t.">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[72px] py-2')} maxLength={300} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="For example: I selected D2A by mistake; my roll number is in D2B." />}</Field>
          {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
          <div className="flex gap-2"><Button type="submit" size="sm" disabled={busy || !options.length}>{busy ? 'Sending…' : 'Send request'}</Button><Button type="button" size="sm" variant="ghost" onClick={() => { setOpen(false); setErr('') }}>Cancel</Button></div>
        </form>)}
    </div>
  )
}

/* ---------------- Join requests (teacher / CR / HOD) ---------------- */
export function JoinRequests({ hod = false, title = 'Join requests' }) {
  const { pushToast, now, refreshAccount } = useApp()
  const cat = useCatalog()
  const [tab, setTab] = useState('pending')
  const [division, setDivision] = useState('')
  const [pageNo, setPage] = useState(0)
  const [picked, setPicked] = useState([])
  const [rejecting, setRejecting] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const s = useLoad(() => api('join-requests', { query: { status: tab === 'pending' ? 'pending' : 'decided', division, page: pageNo } }), [tab, division, pageNo])
  const reviewable = (cat.data?.divisions || []).filter((d) => d.can.review)
  const decide = (ids, decision, why = '') => busyWrap(setBusy, async () => {
    try {
      const r = await api('join-decision', { method: 'POST', body: { ids, decision, note: why } })
      const failed = r.results.filter((x) => !x.ok)
      pushToast(failed.length ? `${r.approved || ids.length - failed.length} done; ${failed.length} not: ${failed[0].error}` : decision === 'approve' ? `Approved ${ids.length}.` : 'Rejected.', failed.length ? 'warn' : 'ok')
      setPicked([]); setRejecting(null); setNote(''); s.reload(); refreshAccount()
    } catch (e) { pushToast(e.message, 'bad') }
  })()
  const revoke = (r) => busyWrap(setBusy, async () => { try { await api('enrollment-revoke', { method: 'POST', body: { studentId: r.student_id, division: r.division_code } }); pushToast('Removed from the class.'); s.reload() } catch (e) { pushToast(e.message, 'bad') } })()
  const rows = s.data?.requests || []
  const pendingIds = rows.filter((r) => r.status === 'pending' && !r.self).map((r) => r.id)
  return (
    <Card>
      <CardTitle eyebrow={hod ? 'Your branch' : undefined} action={s.data?.pendingTotal ? <Badge tone="warn">{s.data.pendingTotal} waiting</Badge> : null}>{title}</CardTitle>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <Segmented label="Show" value={tab} onChange={(v) => { setTab(v); setPage(0); setPicked([]) }} options={[{ value: 'pending', label: 'Waiting' }, { value: 'history', label: 'History' }]} />
        {reviewable.length > 1 && <Field label="Division">{(id) => <select id={id} className={inputCls} value={division} onChange={(e) => { setDivision(e.target.value); setPage(0) }}><option value="">All my divisions</option>{reviewable.map((d) => <option key={d.code}>{d.code}</option>)}</select>}</Field>}
        {tab === 'pending' && picked.length > 0 && <Button size="sm" disabled={busy} onClick={() => decide(picked, 'approve')}>Accept selected ({picked.length})</Button>}
      </div>
      <Loading s={s}>{!rows.length ? <p className="mt-3 text-[13.5px] text-muted">{tab === 'pending' ? 'No one is waiting.' : 'No decisions yet.'}</p> : (
        <ul className="mt-3 text-[13.5px]">
          {tab === 'pending' && pendingIds.length > 1 && <li className="pb-2"><label className="flex items-center gap-2 text-[12.5px] text-muted"><input type="checkbox" checked={picked.length === pendingIds.length} onChange={(e) => setPicked(e.target.checked ? pendingIds.slice(0, 50) : [])} />Select all on this page</label></li>}
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2">
              {tab === 'pending' && !r.self && <input type="checkbox" aria-label={`Select ${r.name || 'student'}`} checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id].slice(0, 50) : picked.filter((x) => x !== r.id))} />}
              <span className="font-semibold">{r.name || 'No name yet'}</span>
              {r.kind === 'transfer' && <Badge tone="info">Change from {r.from_division}</Badge>}
              <span className="text-muted">{r.roll ? `Roll ${r.roll} · ` : ''}{r.division_code}{r.contact ? ` · ${r.contact}` : ''} · {relTime(tab === 'pending' ? r.created_at : r.decided_at, now)}</span>
              {r.kind === 'transfer' && r.reason && <span className="basis-full text-[12.5px] text-muted">Reason: “{r.reason}”</span>}
              {tab !== 'pending' && <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>}
              {r.decided_by_name && <span className="text-[12px] text-muted">by {r.decided_by_name} ({r.decided_as}){r.note ? ` · “${r.note}”` : ''}</span>}
              <span className="ml-auto flex flex-wrap gap-2">
                {r.self ? <span className="text-[12px] text-muted">Your own request</span> : r.status === 'pending' ? (rejecting === r.id ? (
                  <><input aria-label="Reason (optional)" className={cx(inputCls, 'h-9 w-48')} placeholder="Reason (optional)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /><Button size="sm" variant="danger" disabled={busy} onClick={() => decide([r.id], 'reject', note)}>Reject</Button><Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button></>
                ) : (<><Button size="sm" disabled={busy} onClick={() => decide([r.id], 'approve')}>Accept</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => { setRejecting(r.id); setNote('') }}>Reject</Button></>))
                  : hod && r.status === 'rejected' && r.kind !== 'transfer' ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide([r.id], 'approve')}>Override: accept</Button>
                    : hod && r.status === 'approved' ? <ConfirmButton size="sm" variant="ghost" confirmText="Remove from class" onConfirm={() => revoke(r)}>Remove from class</ConfirmButton> : null}
              </span>
            </li>))}
        </ul>)}
        <div className="mt-2 flex gap-2">{pageNo > 0 && <Button size="sm" variant="ghost" onClick={() => setPage(pageNo - 1)}>Previous</Button>}{s.data?.more && <Button size="sm" variant="ghost" onClick={() => setPage(pageNo + 1)}>Next page</Button>}</div>
      </Loading>
    </Card>
  )
}

/* ---------------- CR requests (teacher / HOD) ---------------- */
export function CrRequests() {
  const { pushToast, now, refreshAccount } = useApp()
  const [tab, setTab] = useState('pending')
  const [busy, setBusy] = useState(false)
  const s = useLoad(() => api('cr-requests', { query: { status: tab === 'pending' ? 'pending' : 'decided' } }), [tab])
  const decide = (id, decision) => busyWrap(setBusy, async () => { try { await api('cr-decision', { method: 'POST', body: { id, decision } }); pushToast(decision === 'approve' ? 'Class rep approved.' : 'Request rejected.'); s.reload(); refreshAccount() } catch (e) { pushToast(e.message, 'bad') } })()
  return (
    <Card>
      <CardTitle>Class-representative requests</CardTitle>
      <div className="mt-2"><Segmented label="Show" value={tab} onChange={setTab} options={[{ value: 'pending', label: 'Waiting' }, { value: 'history', label: 'History' }]} /></div>
      <Loading s={s}>{!s.data?.requests?.length ? <p className="mt-3 text-[13.5px] text-muted">Nothing here.</p> : (
        <ul className="mt-3 text-[13.5px]">{s.data.requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2"><span className="font-semibold">{r.name || 'No name yet'}</span><span className="text-muted">{r.roll ? `Roll ${r.roll} · ` : ''}{r.division_code} · {relTime(r.created_at, now)}</span>
            {r.status !== 'pending' && <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>}{r.decided_by_name && <span className="text-[12px] text-muted">by {r.decided_by_name}</span>}
            {r.status === 'pending' && <span className="ml-auto flex gap-2"><Button size="sm" disabled={busy} onClick={() => decide(r.id, 'approve')}>Approve</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(r.id, 'reject')}>Reject</Button></span>}
          </li>))}</ul>)}</Loading>
    </Card>
  )
}

/* ---------------- Class list (CR: names + rolls only; teacher/HOD see masked emails; HOD manages CRs) ---------------- */
export function Roster({ division: fixed, hod = false }) {
  const { pushToast } = useApp()
  const cat = useCatalog()
  const options = (cat.data?.divisions || []).filter((d) => d.can.review)
  const [division, setDivision] = useState(fixed || '')
  useEffect(() => { if (!division && options[0]) setDivision(options[0].code) }, [options.length]) // eslint-disable-line
  const s = useLoad(() => (division ? api('roster', { query: { division } }) : Promise.resolve(null)), [division])
  const act = async (st, body, ok) => { try { await api(body.route, { method: 'POST', body: body.payload }); pushToast(ok); s.reload() } catch (e) { pushToast(e.message, 'bad') } }
  return (
    <Card>
      <CardTitle eyebrow={division}>Class list</CardTitle>
      {!fixed && options.length > 1 && <div className="mt-2 max-w-xs"><Field label="Division">{(id) => <select id={id} className={inputCls} value={division} onChange={(e) => setDivision(e.target.value)}>{options.map((d) => <option key={d.code}>{d.code}</option>)}</select>}</Field></div>}
      <Loading s={s}>{!s.data?.students?.length ? <p className="mt-2 text-[13.5px] text-muted">No approved students yet.</p> : (
        <ul className="mt-2 text-[13.5px]">{s.data.students.map((st) => (
          <li key={st.id} className="flex flex-wrap items-center gap-2 border-t border-line py-1.5"><span className="w-16 text-muted">{st.roll || '—'}</span><span className="font-semibold">{st.name || 'No name yet'}</span>{st.contact && <span className="text-muted">{st.contact}</span>}{st.is_cr && <Badge tone="info">Class rep</Badge>}
            {hod && <span className="ml-auto flex gap-2">{st.is_cr
              ? <ConfirmButton size="sm" variant="ghost" confirmText="Remove as class rep" onConfirm={() => act(st, { route: 'cr-assign', payload: { studentId: st.id, division, action: 'remove' } }, 'Class rep removed.')}>Remove CR</ConfirmButton>
              : <Button size="sm" variant="secondary" onClick={() => act(st, { route: 'cr-assign', payload: { studentId: st.id, division } }, 'Class rep assigned.')}>Make class rep</Button>}
              <ConfirmButton size="sm" variant="ghost" confirmText="Remove from class" onConfirm={() => act(st, { route: 'enrollment-revoke', payload: { studentId: st.id, division } }, 'Removed from the class.')}>Remove</ConfirmButton></span>}
          </li>))}</ul>)}</Loading>
    </Card>
  )
}

/* ---------------- Posting: announcements/materials (staff) and notices (CR) ---------------- */
export function Composer({ crDivision }) {
  const { pushToast } = useApp()
  const cat = useCatalog()
  const isCr = !!crDivision
  const [f, setF] = useState({ kind: 'announcement', title: '', body: '', divisions: isCr ? [crDivision] : [] })
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
    if (f.title.trim().length < 3) return setErr('Give it a title (at least 3 characters).')
    if (!f.divisions.length) return setErr('Choose at least one division.')
    if (f.kind === 'material' && !file) return setErr('Attach the material file.')
    setStep('review')
  }
  const publish = async () => {
    setStep('sending'); setResult(null)
    try {
      const fileBody = file ? { name: file.name, mime: file.type, dataBase64: await fileToBase64(file) } : undefined
      const r = await api('posts', { method: 'POST', body: { ...f, file: fileBody } })
      setResult({ ok: true, text: `Sent to ${r.post.divisions.join(', ')}. Students there see it when they open the portal.` })
      pushToast('Sent.'); setF({ kind: 'announcement', title: '', body: '', divisions: isCr ? [crDivision] : [] }); setFile(null); setStep('edit')
    } catch (e) { setResult({ ok: false, text: `Not sent: ${e.message}` }); setStep('review') }
  }
  if (step !== 'edit') return (
    <Card className="max-w-2xl">
      <CardTitle eyebrow="Check before sending">Review</CardTitle>
      <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5 text-[14px]">
        <dt className="text-muted">Type</dt><dd>{isCr ? 'Notice' : f.kind === 'material' ? 'Material' : 'Announcement'}</dd>
        <dt className="text-muted">Title</dt><dd className="font-semibold">{f.title}</dd>
        <dt className="text-muted">Goes to</dt><dd>{f.divisions.map((d) => <Badge key={d} tone="info" className="mr-1">{d}</Badge>)}<span className="block text-[12.5px] text-muted">Only approved students of these divisions can see it.</span></dd>
        {file && <><dt className="text-muted">File</dt><dd>{file.name} · {fmtBytes(file.size)}</dd></>}
      </dl>
      {result && !result.ok && <p role="alert" className="mt-3 text-[13.5px] text-bad">{result.text}</p>}
      <div className="mt-4 flex gap-2"><Button onClick={publish} disabled={step === 'sending'}>{step === 'sending' ? 'Sending…' : 'Send'}</Button><Button variant="ghost" onClick={() => setStep('edit')} disabled={step === 'sending'}>Back to edit</Button></div>
    </Card>)
  return (
    <Card className="max-w-2xl">
      <form onSubmit={review} className="flex flex-col gap-4" noValidate>
        {result?.ok && <p role="status" className="rounded-lg bg-[#E7F4EC] px-3 py-2 text-[13.5px] text-ok">{result.text}</p>}
        {isCr ? <p className="text-[13.5px] text-muted">Notice to your class <Badge tone="info">{crDivision}</Badge></p>
          : <Segmented label="Post type" value={f.kind} onChange={(kind) => setF({ ...f, kind })} options={[{ value: 'announcement', label: 'Notice / announcement' }, { value: 'material', label: 'Assignment / material (file)' }]} />}
        <Field label="Title">{(id) => <input id={id} className={inputCls} maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Message (optional)">{(id) => <textarea id={id} rows={4} className={inputCls} maxLength={4000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        {!isCr && <Field label={f.kind === 'material' ? 'File' : 'File (optional)'} hint="PDF, Word, PowerPoint, Excel, PNG, JPG or text · up to 3 MB">{(id) => <input id={id} type="file" accept={Object.keys(UPLOAD_TYPES).join(',')} onChange={pick} className="text-[13.5px]" />}</Field>}
        {!isCr && <fieldset><legend className="mb-1.5 text-[13.5px] font-semibold">Send to</legend>
          <Loading s={cat}>{cat.data && (cat.data.divisions.some((d) => d.can.post) ? <DivisionPicker catalog={cat.data} value={f.divisions} onChange={(divisions) => setF({ ...f, divisions })} perm="post" idPrefix="compose" />
            : <p className="text-[13px] text-muted">You have no divisions assigned yet. Ask your HOD to assign them.</p>)}</Loading></fieldset>}
        {err && <p role="alert" className="text-[13.5px] text-bad">{err}</p>}
        <div><Button type="submit">Review</Button></div>
      </form>
    </Card>
  )
}
export function MyPosts() {
  const { pushToast, now } = useApp()
  const s = useLoad(() => api('posts').then((r) => r.posts), [])
  const del = async (id) => { try { await api('posts', { method: 'DELETE', query: { id } }); pushToast('Deleted.'); s.reload() } catch (e) { pushToast(e.message, 'bad') } }
  return <Loading s={s}>{!s.data?.length ? <Empty icon="send" title="Nothing sent yet">What you send appears here.</Empty> : <div className="flex flex-col gap-3">{s.data.map((p) => <PostCard key={p.id} p={p} now={now} onDelete={() => del(p.id)} />)}</div>}</Loading>
}
export function PostCard({ p, now, onDelete }) {
  const { pushToast } = useApp()
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2"><Badge tone={p.kind === 'material' ? 'info' : 'neutral'}>{p.kind === 'material' ? 'Material' : p.author_role === 'cr' ? 'Class-rep notice' : 'Notice'}</Badge><span className="text-[12.5px] text-muted">{p.author_name} · {relTime(p.created_at, now)} · {(p.divisions || []).join(', ')}</span></div>
      <h3 className="mt-1.5 font-display text-[17px] font-semibold">{p.title}</h3>
      {p.body && <p className="mt-1 whitespace-pre-wrap text-[14px] text-[#33443B]">{p.body}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {p.file_id && <Button size="sm" variant="secondary" icon="download" onClick={() => downloadFile(p.file_id, p.file_name).catch((e) => pushToast(e.message, 'bad'))}>{p.file_name} · {fmtBytes(p.file_size)}</Button>}
        {onDelete && <ConfirmButton size="sm" variant="ghost" confirmText="Delete for everyone" onConfirm={onDelete}>Delete</ConfirmButton>}
      </div>
    </Card>
  )
}

/* ---------------- Reminders ---------------- */
const fmtWhen = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
export function ReminderForm({ divisions, onDone }) {
  const { pushToast } = useApp()
  const [f, setF] = useState({ division: divisions[0] || '', title: '', body: '', at: '' })
  const [busy, setBusy] = useState(false)
  const save = busyWrap(setBusy, async () => {
    try { await api('reminders', { method: 'POST', body: { division: f.division, title: f.title, body: f.body, remindAt: new Date(f.at).toISOString() } }); pushToast('Reminder set. Your class sees it on their Overview.'); setF({ ...f, title: '', body: '', at: '' }); onDone?.() }
    catch (e) { pushToast(e.message, 'bad') }
  })
  return (
    <Card className="max-w-2xl">
      <CardTitle eyebrow="Shown on the class’s Overview, sorted by time">Set a reminder</CardTitle>
      <form className="mt-2 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (f.title.trim().length >= 3 && f.at) save() }}>
        {divisions.length > 1 && <Field label="Division">{(id) => <select id={id} className={inputCls} value={f.division} onChange={(e) => setF({ ...f, division: e.target.value })}>{divisions.map((d) => <option key={d}>{d}</option>)}</select>}</Field>}
        <Field label="Reminder title">{(id) => <input id={id} className={inputCls} maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Details (optional)">{(id) => <input id={id} className={inputCls} maxLength={1000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
        <Field label="Date and time (IST)">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} />}</Field>
        <p className="text-[12.5px] text-muted">No SMS or push message is sent; students see it in the app.</p>
        <div><Button type="submit" disabled={busy || f.title.trim().length < 3 || !f.at}>{busy ? 'Saving…' : 'Set reminder'}</Button></div>
      </form>
    </Card>
  )
}
export function Reminders({ division, compact = false }) {
  const { pushToast } = useApp()
  const s = useLoad(() => api('reminders', { query: division ? { division } : {} }), [division])
  const del = async (id) => { try { await api('reminders', { method: 'DELETE', query: { id } }); s.reload() } catch (e) { pushToast(e.message, 'bad') } }
  const list = s.data?.reminders || []
  if (compact && !list.length) return null
  return (
    <Card>
      <CardTitle eyebrow={s.data?.division || undefined}>Upcoming reminders</CardTitle>
      <Loading s={s}>{!list.length ? <p className="mt-2 text-[13.5px] text-muted">No reminders.</p> : (
        <ul className="mt-2 text-[13.5px]">{list.slice(0, compact ? 5 : 50).map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-2 border-t border-line py-2"><span className="w-[150px] shrink-0 font-semibold tabular-nums">{fmtWhen(r.remind_at)}</span><span className="min-w-0 flex-1"><b>{r.title}</b>{r.body && <span className="block text-muted">{r.body}</span>}<span className="block text-[12px] text-muted">{r.author_name}{r.author_role === 'cr' ? ' (class rep)' : ''}</span></span>{r.mine && !compact && <Button size="sm" variant="ghost" onClick={() => del(r.id)}>Delete</Button>}</li>))}</ul>)}</Loading>
    </Card>
  )
}

/* ---------------- Student feed ---------------- */
export function Feed() {
  const { pushToast, now } = useApp()
  const [posts, setPosts] = useState([])
  const s = useLoad(() => api('feed').then((r) => { setPosts(r.posts); return r }), [])
  const more = async () => { try { const r = await api('feed', { query: { before: posts[posts.length - 1].created_at } }); setPosts((p) => [...p, ...r.posts]) } catch (e) { pushToast(e.message, 'bad') } }
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <Loading s={s}>
        {s.data && !s.data.division ? <Empty icon="user" title="Join a class first">{s.data.message}</Empty> : !posts.length ? <Empty icon="megaphone" title="Nothing yet">Notices and materials for {s.data?.division} appear here.</Empty> : (
          <div className="flex flex-col gap-3">{posts.map((p) => <PostCard key={p.id} p={p} now={now} />)}{s.data?.more && <Button variant="secondary" onClick={more}>Load older</Button>}</div>)}
      </Loading>
      {s.data?.division && <div><Reminders /></div>}
    </div>
  )
}

/* ---------------- Timetable view (students: the shared source; staff: pick a division) ---------------- */
function TimetableGrid({ entries, header }) {
  const byDay = useMemo(() => { const m = {}; for (const e of entries) (m[e.day] = m[e.day] || []).push(e); return m }, [entries])
  return (
    <>
      {header && <p className="mb-3 text-[13px] text-muted">{header}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Object.keys(byDay).map((d) => (
          <Card key={d}><CardTitle>{DAY_NAMES[d]}</CardTitle>
            <ul className="mt-2 flex flex-col divide-y divide-line">{byDay[d].map((e) => (
              <li key={e.id} className="flex gap-3 py-2 text-[13.5px]"><span className="w-[92px] shrink-0 font-semibold tabular-nums">{e.start}–{e.end}</span>
                <span className="min-w-0"><span className="font-semibold">{e.title}</span>{e.type !== 'Lecture' && <Badge className="ml-1.5">{e.type}</Badge>}{e.batch && <Badge tone="info" className="ml-1.5">Batch {e.batch}</Badge>}
                  <span className="block text-muted">{[e.teacher, e.room && `Room ${e.room}`].filter(Boolean).join(' · ') || ' '}</span></span></li>))}</ul>
          </Card>))}
      </div>
    </>
  )
}
export function MyTimetable() {
  const my = useMyTimetable() // the same data the Overview widget shows
  if (my.status === 'loading' || my.status === 'none') return <Spinner label="Loading your timetable" />
  if (!my.entries.length) return <Empty icon="calendar" title={my.division ? `No timetable for ${my.division} yet` : 'Join a class to see your timetable'}>{my.message}</Empty>
  return <TimetableGrid entries={my.entries} header={`${my.division} · ${my.term || ''}`} />
}
export function StaffTimetable() {
  const cat = useCatalog()
  const options = (cat.data?.divisions || []).filter((d) => d.can.review || d.can.post)
  const [division, setDivision] = useState('')
  useEffect(() => { if (!division && options[0]) setDivision(options[0].code) }, [options.length]) // eslint-disable-line
  const s = useLoad(() => (division ? api('timetable', { query: { division } }) : Promise.resolve(null)), [division])
  const hm = (m) => hhmm(m)
  const entries = (s.data?.entries || []).map((e, i) => ({ id: i, day: e.day, start: hm(e.start_min), end: hm(e.end_min), title: e.subject_name || e.subject, type: e.type, batch: e.batch, teacher: e.teacher_name || e.teacher_code, room: e.room }))
  if (cat.data && !options.length) return <Empty icon="calendar" title="No divisions assigned">Ask your HOD to assign your divisions.</Empty>
  return (
    <div>
      <div className="mb-3 max-w-xs"><Field label="Division">{(id) => <select id={id} className={inputCls} value={division} onChange={(e) => setDivision(e.target.value)}>{options.map((d) => <option key={d.code}>{d.code}</option>)}</select>}</Field></div>
      <Loading s={s}>{!entries.length ? <Empty icon="calendar" title="Nothing published">{s.data?.message}</Empty> : <TimetableGrid entries={entries} header={`${s.data.division} · ${s.data.term} · published ${relTime(s.data.publishedAt)}`} />}</Loading>
    </div>
  )
}

/* ---------------- Timetable Schedule (Excel import) ---------------- */
export function TimetableSchedule() {
  const { pushToast } = useApp()
  const [term, setTerm] = useState('FE 2026-27 Sem I')
  const [phase, setPhase] = useState('idle')
  const [res, setRes] = useState(null)
  const [readErr, setReadErr] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [div, setDiv] = useState('')
  const [upload, setUpload] = useState(null) // the parsed file, kept so "only my divisions" can re-check it
  const versions = useLoad(() => api('timetable-versions').then((r) => r.versions), [])
  const check = async (u, onlyMine) => {
    setReadErr(''); setRes(null); setConfirmed(false); setPhase('reading')
    try {
      const r = await api('timetable-preview', { method: 'POST', body: { term, fileName: u.name, fileSize: u.size, sheets: u.sheets, onlyMine } }).catch((x) => (x.data && x.data.errors ? x.data : Promise.reject(x)))
      setRes({ ...r, fileName: u.name }); setDiv(r.divisions?.[0] || ''); setPhase('checked'); versions.reload()
    } catch (x) { setReadErr(x.message); setPhase('idle') }
  }
  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { const u = { name: file.name, size: file.size, sheets: await readSheets(file) }; setUpload(u); await check(u, false) } catch (x) { setReadErr(x.message); setPhase('idle') }
  }
  const publish = async () => {
    setPhase('publishing')
    try { const r = await api('timetable-publish', { method: 'POST', body: { versionId: res.versionId } }); pushToast(`Timetable published for ${r.divisions.join(', ')}.`); setRes(null); setPhase('idle'); versions.reload(); refreshTimetable() }
    catch (x) { pushToast(x.message, 'bad'); setPhase('checked') }
  }
  const restore = async (id) => { try { await api('timetable-rollback', { method: 'POST', body: { versionId: id } }); pushToast('That version is now the published timetable.'); versions.reload(); refreshTimetable() } catch (x) { pushToast(x.message, 'bad') } }
  const rows = (res?.preview || []).filter((r) => r.division === div)
  return (
    <div className="flex flex-col gap-4">
      <Card className="max-w-3xl">
        <CardTitle eyebrow="Teacher portal">Timetable Schedule</CardTitle>
        <p className="mt-1 text-[13.5px] text-muted">Upload the timetable Excel exactly as the college sends it (days, time slots and a column per division, like the FE timetable). Two-hour labs, batch splits (“BATCH I / BATCH II”) and tutorials are read from the cells. Every cell is checked first and nothing reaches students until you confirm the preview.</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Term name">{(id) => <input id={id} className={inputCls} value={term} maxLength={40} onChange={(e) => setTerm(e.target.value)} />}</Field>
          <label className={cx('press inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg bg-brand px-4 text-[14px] font-semibold text-white', phase === 'reading' && 'pointer-events-none opacity-60')}>
            <Icon name="upload" size={16} />{phase === 'reading' ? 'Checking…' : 'Upload Excel file'}
            <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={onFile} disabled={phase === 'reading'} />
          </label>
          <a className="text-[13.5px] font-semibold text-brand underline" href="/timetable-template.xlsx" download>Download the template (college layout)</a>
        </div>
        {readErr && <p role="alert" className="mt-3 text-[13.5px] text-bad">{readErr}</p>}
      </Card>
      {res && !res.ok && (
        <Card className="max-w-3xl ring-1 ring-[#F6C9C3]">
          <CardTitle eyebrow={res.fileName}>{res.errors.length} problem{res.errors.length > 1 ? 's' : ''}: nothing was published</CardTitle>
          <p className="mt-1 text-[13px] text-muted">The current timetable is unchanged.</p>
          <ul className="mt-3 max-h-[420px] overflow-auto text-[13.5px]">{res.errors.map((e, i) => <li key={i} className="border-t border-line py-1.5"><span className="font-semibold">{e.sheet ? `Sheet "${e.sheet}"` : 'File'}{e.cell ? `, cell ${e.cell}` : e.row ? `, row ${e.row}` : ''}:</span> {e.message}</li>)}</ul>
          {res.canFilter && upload && <Button className="mt-3" variant="secondary" onClick={() => check(upload, true)}>Check only my divisions</Button>}
        </Card>)}
      {res?.ok && (
        <Card>
          <CardTitle eyebrow={`${res.fileName} · ${res.term}`}>Preview: {res.rowCount} sessions for {res.divisions.length} division{res.divisions.length > 1 ? 's' : ''}</CardTitle>
          {res.warnings.length > 0 && <details className="mt-2 text-[13.5px]" open={res.warnings.some((w) => !w.sheet)}><summary className="cursor-pointer font-semibold text-warn">{res.warnings.length} warning{res.warnings.length > 1 ? 's' : ''} to look at (these don’t block publishing)</summary><ul className="mt-2 max-h-[260px] overflow-auto">{res.warnings.map((w, i) => <li key={i} className="border-t border-line py-1">{w.sheet ? `Sheet "${w.sheet}", row ${w.row}: ` : ''}{w.message}</li>)}</ul></details>}
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
            <li key={v.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2">{v.current ? <Badge tone="ok">Current</Badge> : <Badge>Older</Badge>}<span className="font-semibold">{v.term}</span><span className="text-muted">{v.file_name} · {v.row_count} sessions · {v.divisions.join(', ')} · by {v.uploader || '—'} · {relTime(v.published_at)}</span>
              {!v.current && <ConfirmButton size="sm" variant="secondary" className="ml-auto" confirmText="Restore this version" onConfirm={() => restore(v.id)}>Restore</ConfirmButton>}</li>))}</ul>)}</Loading>
      </Card>
    </div>
  )
}

/* ---------------- Instructions ---------------- */
export function InstructionsInbox() {
  const { pushToast, refreshAccount } = useApp()
  const s = useLoad(() => api('instructions').then((r) => r.received), [])
  const mark = async (id, status) => { try { await api('instruction-status', { method: 'POST', body: { id, status } }); s.reload(); refreshAccount() } catch (e) { pushToast(e.message, 'bad') } }
  return (
    <Loading s={s}>{!s.data?.length ? <Empty icon="mail" title="No instructions">Instructions from your HOD appear here.</Empty> : (
      <div className="flex flex-col gap-3">{s.data.map((i) => (
        <Card key={i.id}>
          <div className="flex flex-wrap items-center gap-2"><Badge tone={i.status === 'done' ? 'ok' : i.status === 'seen' ? 'info' : 'warn'}>{i.status === 'sent' ? 'New' : i.status === 'seen' ? 'Seen' : 'Done'}</Badge><span className="text-[12.5px] text-muted">From {i.from_name || 'HOD'} · {relTime(i.created_at)}{i.due_date ? ` · due ${i.due_date}` : ''}</span></div>
          <h3 className="mt-1.5 font-display text-[17px] font-semibold">{i.title}</h3>{i.body && <p className="mt-1 whitespace-pre-wrap text-[14px]">{i.body}</p>}
          <div className="mt-2 flex gap-2">{i.status === 'sent' && <Button size="sm" variant="secondary" onClick={() => mark(i.id, 'seen')}>Mark as seen</Button>}{i.status !== 'done' && <Button size="sm" onClick={() => mark(i.id, 'done')}>Mark as done</Button>}</div>
        </Card>))}</div>)}</Loading>
  )
}
