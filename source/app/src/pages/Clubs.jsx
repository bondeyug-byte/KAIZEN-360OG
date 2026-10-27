// Clubs, councils and committees (college server). An HOD appoints each head; the head invites teammates by
// college email and gives each one only the permissions they need. Invitees accept with their own account.
// Organisers manage their events and registrations here and never see academic records.
import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Empty, Segmented, Field, inputCls, relTime, fmtDateTime, cx, ConfirmButton, Dialog } from '../components/ui.jsx'
import { api, fileToBase64 } from '../lib/portal.js'
import { useLoad, Loading, useCatalog } from '../components/CloudPortal.jsx'
import { EventBody, istToIso, isoToIst } from '../components/Academic.jsx'

export const PERM_LABEL = { draft: 'Drafts (create and edit events)', poster: 'Posters', publish: 'Publish', registration: 'Registration details', view_registrations: 'View registrations', announce: 'Announcements', manage_team: 'Manage team', archive: 'Archive / cancel' }
const STATUS_TONE = { published: 'ok', draft: 'neutral', cancelled: 'bad', archived: 'neutral' }

export default function Clubs() {
  const { session } = useApp()
  if (session.mode !== 'google') return <div className="py-10"><Empty icon="lock" title="Sign in with your college Google account">Clubs and councils work on the college server. Demo accounts use the sample Event desk.</Empty></div>
  if (!session.cloud) return <div className="py-10"><Empty icon="refresh" title="Connecting to the college server">Try again in a moment.</Empty></div>
  return <MyClubs />
}

function MyClubs() {
  const { pushToast, refreshAccount } = useApp()
  const s = useLoad(() => api('clubs'), [])
  const [open, setOpen] = useState(null)
  const respond = async (clubId, accept) => { try { await api('club-invite-response', { method: 'POST', body: { clubId, accept } }); pushToast(accept ? 'You joined the team.' : 'Invitation declined.'); s.reload(); refreshAccount() } catch (x) { pushToast(x.message, 'bad') } }
  const clubs = s.data?.clubs || []
  const invites = clubs.filter((c) => c.status === 'invited'), active = clubs.filter((c) => c.status === 'active')
  const current = open || (active.length === 1 ? active[0].id : null)
  return (
    <div>
      <PageHeader title="Clubs & councils" subtitle="Your teams, their events and registrations. Club heads are appointed by an HOD; teammates join by invitation." />
      <Loading s={s}>{s.data && <div className="flex flex-col gap-4">
        {invites.length > 0 && <Card><CardTitle>Invitations</CardTitle><ul className="flex flex-col divide-y divide-line">{invites.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5"><span className="min-w-0 flex-1"><b>{c.name}</b> <Badge>{c.kind}</Badge><small className="block text-[12.5px] text-muted">Permissions: {(c.permissions || []).map((p) => PERM_LABEL[p]).join(', ') || 'none yet'} · invited {relTime(c.invited_at)}</small></span>
            <Button size="sm" onClick={() => respond(c.id, true)}>Accept</Button><Button size="sm" variant="secondary" onClick={() => respond(c.id, false)}>Decline</Button></li>))}</ul></Card>}
        {!active.length && !invites.length && <Empty icon="star" title="You aren’t in a club team">When a club head invites your college account, the invitation appears here.</Empty>}
        {active.length > 1 && <div className="overflow-x-auto"><Segmented label="Club" value={current || ''} onChange={setOpen} options={active.map((c) => ({ value: c.id, label: c.name }))} /></div>}
        {current && <ClubDesk key={current} id={current} />}
      </div>}</Loading>
    </div>
  )
}

function ClubDesk({ id }) {
  const s = useLoad(() => api('club', { query: { id } }), [id])
  const [tab, setTab] = useState('events')
  const d = s.data
  const can = (p) => !!d && (d.me.isHead || d.me.permissions.includes(p))
  const tabs = [['events', 'Events'], ...(can('announce') ? [['announce', 'Announcements']] : []), ...(can('manage_team') ? [['team', 'Team']] : [])]
  return (
    <Loading s={s}>{d && <div className="flex flex-col gap-3">
      <p className="text-[13.5px] text-muted"><b className="text-ink">{d.club.name}</b> · {d.me.isHead ? 'You are the head' : `Your permissions: ${d.me.permissions.map((p) => PERM_LABEL[p]).join(', ') || 'none'}`}</p>
      <div className="overflow-x-auto"><Segmented label="Club section" value={tab} onChange={setTab} options={tabs.map(([value, label]) => ({ value, label }))} /></div>
      {tab === 'events' && <ClubEvents d={d} can={can} reload={s.reload} />}
      {tab === 'announce' && <Announce d={d} reload={s.reload} />}
      {tab === 'team' && <Team d={d} reload={s.reload} />}
    </div>}</Loading>
  )
}

function ClubEvents({ d, can, reload }) {
  const { pushToast } = useApp()
  const [edit, setEdit] = useState(null)
  const [regs, setRegs] = useState(null)
  const status = async (id, to) => { try { await api('club-event-status', { method: 'POST', body: { id, status: to } }); pushToast({ published: 'Published. It now appears in feeds and calendars for its audience.', draft: 'Moved back to drafts.', cancelled: 'Marked as cancelled.', archived: 'Archived.' }[to]); reload() } catch (x) { pushToast(x.message, 'bad') } }
  if (edit) return <EventEditor club={d.club} can={can} existing={edit.id ? edit : null} onDone={() => { setEdit(null); reload() }} />
  return (
    <div className="flex flex-col gap-3">
      {can('draft') && <div><Button icon="plus" onClick={() => setEdit({})}>New event</Button></div>}
      {d.events.length ? <ul className="flex flex-col gap-2">{d.events.map((e) => (
        <li key={e.id}><Card className="!p-3.5"><div className="flex flex-wrap items-start gap-2">
          <span className="min-w-0 flex-1"><span className="flex flex-wrap gap-1.5"><Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge><Badge>{e.layout}</Badge>{e.reg_mode === 'builtin' && <Badge tone="info">{e.reg_count}{e.capacity ? `/${e.capacity}` : ''} registered</Badge>}</span>
            <b className="mt-1 block text-[14.5px]">{e.title}</b><small className="text-[12.5px] text-muted">{fmtDateTime(e.starts_at)} · {e.venue}</small></span>
          <div className="flex flex-wrap gap-1.5">
            {e.status !== 'archived' && can('draft') && (e.status !== 'published' || can('publish')) && <Button size="sm" variant="secondary" onClick={() => setEdit(e)}>Edit</Button>}
            {can('view_registrations') && e.reg_mode === 'builtin' && <Button size="sm" variant="secondary" onClick={() => setRegs(e)}>Registrations</Button>}
            {can('publish') && (e.status === 'draft' || e.status === 'cancelled') && <Button size="sm" onClick={() => status(e.id, 'published')}>Publish</Button>}
            {can('publish') && e.status === 'published' && <Button size="sm" variant="ghost" onClick={() => status(e.id, 'draft')}>Unpublish</Button>}
            {can('archive') && e.status === 'published' && <ConfirmButton size="sm" variant="danger" confirmText="Mark cancelled" onConfirm={() => status(e.id, 'cancelled')}>Cancel</ConfirmButton>}
            {can('archive') && e.status !== 'archived' && <ConfirmButton size="sm" variant="ghost" confirmText="Archive" onConfirm={() => status(e.id, 'archived')}>Archive</ConfirmButton>}
          </div></div></Card></li>))}</ul> : <Empty icon="calendar" title="No events yet">{can('draft') ? 'Create the first one with “New event”.' : 'Events your team creates appear here.'}</Empty>}
      {regs && <Registrations event={regs} onClose={() => setRegs(null)} />}
    </div>
  )
}

function Registrations({ event, onClose }) {
  const s = useLoad(() => api('club-registrations', { query: { eventId: event.id } }), [event.id])
  return (
    <Dialog open onClose={onClose} title={`Registrations: ${event.title}`} wide>
      <Loading s={s}>{s.data && <>
        <p className="mb-2 text-[13.5px]">{s.data.event.registered} registered{s.data.event.capacity ? ` of ${s.data.event.capacity}` : ''}. Organisers see names and masked emails only.</p>
        {s.data.registrations.length ? <table className="w-full text-left text-[13.5px]"><thead className="text-muted"><tr><th className="py-1.5 pr-3">Name</th><th className="pr-3">Email</th><th className="pr-3">Status</th><th>When</th></tr></thead>
          <tbody>{s.data.registrations.map((r, i) => <tr key={i} className="border-t border-line"><td className="py-1.5 pr-3">{r.name || '—'}</td><td className="pr-3">{r.contact}</td><td className="pr-3">{r.status}</td><td>{fmtDateTime(r.registered_at)}</td></tr>)}</tbody></table> : <p className="text-[13.5px] text-muted">No registrations yet.</p>}
      </>}</Loading>
    </Dialog>
  )
}

const YEAR_LABEL = ['FE', 'SE', 'TE', 'BE']
function EventEditor({ club, can, existing, onDone }) {
  const { pushToast } = useApp()
  const cat = useCatalog()
  const e = existing || {}
  const [f, setF] = useState({ title: e.title || '', description: e.description || '', starts: isoToIst(e.starts_at), ends: isoToIst(e.ends_at), venue: e.venue || '', organizer: e.organizer || club.name, contact: e.contact || '', branches: e.audience?.branches || [], years: e.audience?.years || [], regMode: e.reg_mode || 'none', regLink: e.reg_link || '', capacity: e.capacity ?? '', regDeadline: isoToIst(e.reg_deadline), instructions: e.instructions || '', terms: e.terms || '', layout: e.layout || 'card' })
  const [poster, setPoster] = useState(null)
  const [preview, setPreview] = useState(false)
  const [posterUrl, setPosterUrl] = useState(e.poster_file_id ? `/api/app/file?id=${e.poster_file_id}&inline=1` : null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!poster) return; const u = URL.createObjectURL(poster); setPosterUrl(u); return () => URL.revokeObjectURL(u) }, [poster])
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value })
  const toggle = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] })
  const regLocked = !can('registration')
  const save = async (ev) => {
    ev.preventDefault(); setErr('')
    if (f.title.trim().length < 3) return setErr('Give the event a name.')
    if (!f.starts) return setErr('Choose the date and start time.')
    if (!f.venue.trim()) return setErr('Enter the venue.')
    if (f.regMode === 'link' && !/^https:\/\//.test(f.regLink.trim())) return setErr('Give the registration link (https://…).')
    if (poster && (poster.size > 3 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(poster.type))) return setErr('Posters: PNG or JPG, up to 3 MB.')
    setBusy(true)
    try {
      await api('club-events', { method: 'POST', body: { id: existing?.id, clubId: club.id, title: f.title.trim(), description: f.description.trim(), startsAt: istToIso(f.starts), endsAt: istToIso(f.ends), venue: f.venue.trim(), organizer: f.organizer.trim(), contact: f.contact.trim(), audience: { branches: f.branches, years: f.years }, regMode: f.regMode, regLink: f.regLink.trim(), capacity: f.capacity === '' ? null : Number(f.capacity), regDeadline: istToIso(f.regDeadline), instructions: f.instructions.trim(), terms: f.terms.trim(), layout: f.layout, poster: poster ? { name: poster.name, mime: poster.type, dataBase64: await fileToBase64(poster) } : undefined } })
      pushToast(existing ? 'Event saved.' : 'Saved as a draft. Publish it when it’s ready.'); onDone()
    } catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  const draft = { ...e, title: f.title || 'Event name', description: f.description, starts_at: istToIso(f.starts) || new Date().toISOString(), ends_at: istToIso(f.ends), venue: f.venue, organizer: f.organizer, contact: f.contact, audience: { branches: f.branches, years: f.years }, reg_mode: f.regMode, reg_link: f.regLink, capacity: f.capacity === '' ? null : Number(f.capacity), reg_deadline: istToIso(f.regDeadline), instructions: f.instructions, terms: f.terms, layout: f.layout, poster: posterUrl, status: e.status || 'draft', club_name: club.name }
  return (
    <Card className="max-w-3xl">
      <CardTitle action={<Button size="sm" variant="secondary" onClick={() => setPreview(true)}>Preview</Button>}>{existing ? 'Edit event' : 'New event'}</CardTitle>
      <form noValidate onSubmit={save} className="flex flex-col gap-3">
        <Field label="Event name">{(id) => <input id={id} className={inputCls} maxLength={120} value={f.title} onChange={set('title')} />}</Field>
        <Field label="Description">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[90px] py-2')} maxLength={3000} value={f.description} onChange={set('description')} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts (campus time)">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.starts} onChange={set('starts')} />}</Field>
          <Field label="Ends (optional)">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.ends} onChange={set('ends')} />}</Field>
          <Field label="Venue">{(id) => <input id={id} className={inputCls} maxLength={120} value={f.venue} onChange={set('venue')} />}</Field>
          <Field label="Organiser">{(id) => <input id={id} className={inputCls} maxLength={120} value={f.organizer} onChange={set('organizer')} />}</Field>
          <Field label="Contact (optional)" hint="Shown to everyone who can see the event.">{(id) => <input id={id} className={inputCls} maxLength={160} value={f.contact} onChange={set('contact')} />}</Field>
          <Field label="Layout">{(id) => <select id={id} className={inputCls} value={f.layout} onChange={set('layout')}><option value="card">Card</option><option value="banner">Banner</option><option value="announcement">Announcement</option></select>}</Field>
        </div>
        <fieldset className="rounded-lg border border-line p-3"><legend className="px-1 text-[13px] font-medium">Audience / eligibility (none selected = all students)</legend>
          <div className="flex flex-wrap gap-1.5">{(cat.data?.branches || []).map((b) => <button type="button" key={b.code} aria-pressed={f.branches.includes(b.code)} onClick={() => toggle('branches', b.code)} className={cx('press min-h-[34px] rounded-lg px-2.5 text-[13px] font-semibold ring-1', f.branches.includes(b.code) ? 'bg-brand text-white ring-brand' : 'bg-surface ring-line')}>{b.code}</button>)}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">{[1, 2, 3, 4].map((y) => <button type="button" key={y} aria-pressed={f.years.includes(y)} onClick={() => toggle('years', y)} className={cx('press min-h-[34px] rounded-lg px-2.5 text-[13px] font-semibold ring-1', f.years.includes(y) ? 'bg-brand text-white ring-brand' : 'bg-surface ring-line')}>{YEAR_LABEL[y - 1]}</button>)}</div>
        </fieldset>
        <fieldset className="rounded-lg border border-line p-3" disabled={regLocked}><legend className="px-1 text-[13px] font-medium">Registration{regLocked ? ' (needs the “registration details” permission)' : ''}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="How people register">{(id) => <select id={id} className={inputCls} value={f.regMode} onChange={set('regMode')}><option value="none">No registration</option><option value="link">External link</option><option value="builtin">In Campus360</option></select>}</Field>
            {f.regMode === 'link' && <Field label="Registration link">{(id) => <input id={id} className={inputCls} placeholder="https://" value={f.regLink} onChange={set('regLink')} />}</Field>}
            {f.regMode === 'builtin' && <Field label="Capacity (empty = no limit)">{(id) => <input id={id} type="number" min="1" className={inputCls} value={f.capacity} onChange={set('capacity')} />}</Field>}
            {f.regMode !== 'none' && <Field label="Registration closes (optional)">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.regDeadline} onChange={set('regDeadline')} />}</Field>}
          </div>
        </fieldset>
        <Field label="Poster (PNG or JPG, up to 3 MB)" hint={can('poster') ? undefined : 'Needs the “posters” permission.'}>{(id) => <input id={id} type="file" disabled={!can('poster')} accept="image/png,image/jpeg" className="text-[13.5px]" onChange={(ev) => setPoster(ev.target.files?.[0] || null)} />}</Field>
        <Field label="Instructions (optional)">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[60px] py-2')} maxLength={2000} value={f.instructions} onChange={set('instructions')} />}</Field>
        <Field label="Terms (optional)">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[60px] py-2')} maxLength={2000} value={f.terms} onChange={set('terms')} />}</Field>
        {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save' : 'Save draft'}</Button><Button type="button" variant="secondary" onClick={() => setPreview(true)}>Preview</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
      </form>
      <Dialog open={preview} onClose={() => setPreview(false)} title={draft.title} wide><EventBody e={draft} preview /></Dialog>
    </Card>
  )
}

function Announce({ d, reload }) {
  const { pushToast } = useApp()
  const live = d.events.filter((e) => e.status === 'published' || e.status === 'cancelled')
  const [f, setF] = useState({ eventId: live[0]?.id || '', title: '', body: '' })
  const [err, setErr] = useState('')
  const send = async (ev) => {
    ev.preventDefault(); setErr('')
    if (!f.eventId) return setErr('Choose a published event.')
    if (f.title.trim().length < 3) return setErr('Give the announcement a title.')
    try { await api('club-announcements', { method: 'POST', body: { clubId: d.club.id, eventId: f.eventId, title: f.title.trim(), body: f.body.trim() } }); pushToast('Announcement sent to the event’s audience.'); setF({ ...f, title: '', body: '' }); reload() } catch (x) { setErr(x.message) }
  }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card><CardTitle>New announcement</CardTitle>
        {!live.length ? <p className="text-[13.5px] text-muted">Publish an event first; announcements go to that event’s audience.</p> : <form noValidate onSubmit={send} className="flex flex-col gap-3">
          <Field label="Event">{(id) => <select id={id} className={inputCls} value={f.eventId} onChange={(e) => setF({ ...f, eventId: e.target.value })}>{live.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>}</Field>
          <Field label="Title">{(id) => <input id={id} className={inputCls} maxLength={140} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
          <Field label="Message">{(id) => <textarea id={id} className={cx(inputCls, 'min-h-[80px] py-2')} maxLength={2000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
          {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
          <div><Button type="submit">Send</Button></div>
        </form>}</Card>
      <Card><CardTitle>Sent</CardTitle>{d.announcements.length ? <ul className="flex flex-col gap-2">{d.announcements.map((a) => <li key={a.id} className="rounded-lg bg-ground px-3 py-2"><b className="text-[13.5px]">{a.title}</b><small className="block text-[12px] text-muted">{a.created_by_name} · {relTime(a.created_at)}</small></li>)}</ul> : <p className="text-[13.5px] text-muted">None yet.</p>}</Card>
    </div>
  )
}

function Team({ d, reload }) {
  const { pushToast } = useApp()
  const [f, setF] = useState({ email: '', permissions: ['draft'] })
  const [err, setErr] = useState('')
  const grantable = d.permissions.filter((p) => p !== 'manage_team' || d.me.isHead)
  const invite = async (ev) => {
    ev.preventDefault(); setErr('')
    if (!/^[^@\s]+@ves\.ac\.in$/i.test(f.email.trim())) return setErr('Use their college account (…@ves.ac.in).')
    try { await api('club-invite', { method: 'POST', body: { clubId: d.club.id, email: f.email.trim(), permissions: f.permissions } }); pushToast('Invitation sent. They accept it after signing in with that account.'); setF({ email: '', permissions: ['draft'] }); reload() } catch (x) { setErr(x.message) }
  }
  const update = async (email, permissions) => { try { await api('club-member', { method: 'POST', body: { clubId: d.club.id, email, permissions } }); pushToast('Permissions updated.'); reload() } catch (x) { pushToast(x.message, 'bad') } }
  const revoke = async (email) => { try { await api('club-member', { method: 'POST', body: { clubId: d.club.id, email, revoke: true } }); pushToast('Access removed. It ends immediately.'); reload() } catch (x) { pushToast(x.message, 'bad') } }
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
      <Card><CardTitle>Invite a teammate</CardTitle>
        <form noValidate onSubmit={invite} className="flex flex-col gap-3">
          <Field label="College email">{(id) => <input id={id} type="email" className={inputCls} placeholder="name@ves.ac.in" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <fieldset><legend className="mb-1 text-[13px] font-medium">Permissions</legend>{grantable.map((p) => <label key={p} className="flex min-h-[34px] items-center gap-2 text-[14px]"><input type="checkbox" checked={f.permissions.includes(p)} onChange={(e) => setF({ ...f, permissions: e.target.checked ? [...f.permissions, p] : f.permissions.filter((x) => x !== p) })} />{PERM_LABEL[p]}</label>)}</fieldset>
          {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
          <div><Button type="submit">Send invitation</Button></div>
        </form></Card>
      <Card><CardTitle>Team</CardTitle>
        <ul className="flex flex-col divide-y divide-line">{d.members.map((m) => (
          <li key={m.email} className="py-2.5">
            <div className="flex flex-wrap items-center gap-2"><b className="text-[14px]">{m.name || m.contact}</b>{m.is_head && <Badge tone="maroon">Head</Badge>}<Badge tone={m.status === 'active' ? 'ok' : m.status === 'invited' ? 'warn' : 'neutral'}>{m.status}</Badge>
              {!m.is_head && m.status !== 'revoked' && (d.me.isHead || !(m.permissions || []).includes('manage_team')) && <ConfirmButton size="sm" variant="ghost" confirmText="Remove access" onConfirm={() => revoke(m.email)}>Remove</ConfirmButton>}</div>
            {!m.is_head && m.status !== 'revoked' && m.status !== 'declined' && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{grantable.map((p) => <label key={p} className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={(m.permissions || []).includes(p)} disabled={!d.me.isHead && (m.permissions || []).includes('manage_team')} onChange={(e) => update(m.email, e.target.checked ? [...(m.permissions || []), p] : (m.permissions || []).filter((x) => x !== p))} />{PERM_LABEL[p]}</label>)}</div>}
          </li>))}</ul></Card>
    </div>
  )
}
