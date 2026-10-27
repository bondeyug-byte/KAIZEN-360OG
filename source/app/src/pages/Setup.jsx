// "Set Up Your Profile": first sign-in for students, teachers and HODs (college server). The server validates
// every field and keeps the verified copy apart from the free-form profile; nothing here can grant a role.
// Students then pick their division from the college's verified list (a join request a teacher approves).
import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Empty, Field, inputCls, Spinner, relTime, cx } from '../components/ui.jsx'
import { api } from '../lib/portal.js'
import { useLoad, Loading, useCatalog, MyClass } from '../components/CloudPortal.jsx'
import { refreshTimetable } from '../lib/timetable.js'
import { prefs } from '../lib/storage.js'

const YEARS = [[1, 'First Year (FE)'], [2, 'Second Year (SE)'], [3, 'Third Year (TE)'], [4, 'Fourth Year (BE)']]
const GENDERS = [['female', 'Female'], ['male', 'Male'], ['other', 'Other'], ['prefer_not_to_say', 'Prefer not to say']]
export const skipKey = (uid) => `setupNoDivision:${uid}`

export default function Setup({ query = {} }) {
  const { session, me } = useApp()
  if (session.mode !== 'google') return <div className="py-10"><Empty icon="lock" title="Sign in with your college Google account">Profile set-up is part of the college portal. Demo accounts use the sample profile under <a className="font-semibold text-maroon underline" href="#/profile">My Profile</a>.</Empty></div>
  if (!session.cloud) return <div className="py-10"><Spinner label="Connecting to the college server" /></div>
  if (me?.role === 'parent') return <div className="py-10"><Empty icon="user" title="Nothing to set up">Parents see their child’s record in the <a className="font-semibold text-maroon underline" href="#/parent">Parent portal</a>.</Empty></div>
  return <SetupForm edit={query.edit === '1'} />
}

function SetupForm({ edit }) {
  const { session, pushToast, refreshAccount, updateProfile } = useApp()
  const s = useLoad(() => api('setup'), [])
  const cat = useCatalog()
  const role = session.role || 'student'
  const [f, setF] = useState(null)
  const [err, setErr] = useState({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (!s.data || f) return
    const x = s.data.setup || {}, en = s.data.fixed.enrollment
    setF({ name: x.name || session.teacher?.name || '', gender: x.gender || '', mobile: x.mobile ? x.mobile.replace(/^\+91/, '') : '', yearLevel: String(x.yearLevel || (en && en.level) || ''), branch: x.branch || (en && en.branch) || '', roll: x.roll || '', confirm: false })
  }, [s.data]) // eslint-disable-line
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    const er = {}
    if (f.name.trim().length < 2) er.name = 'Enter your full name.'
    if (!/^(\+?91)?[6-9]\d{9}$/.test(f.mobile.replace(/[\s-]/g, ''))) er.mobile = 'Enter a 10-digit Indian mobile number.'
    if (role === 'student') {
      if (!f.gender) er.gender = 'Choose one (or “Prefer not to say”).'
      if (!f.yearLevel) er.yearLevel = 'Choose your academic year.'
      if (!f.branch) er.branch = 'Choose your branch.'
      if (!/^[A-Za-z0-9/-]{1,20}$/.test(f.roll.trim())) er.roll = 'Enter your roll number (letters, digits, - or /).'
    } else if (!f.confirm) er.confirm = 'Confirm that these details are correct.'
    setErr(er)
    if (Object.keys(er).length) return
    setBusy(true)
    try {
      const body = role === 'student' ? { name: f.name.trim(), gender: f.gender, mobile: f.mobile, yearLevel: Number(f.yearLevel), branch: f.branch, roll: f.roll.trim() } : { name: f.name.trim(), mobile: f.mobile, confirm: true }
      const r = await api('setup', { method: 'PUT', body })
      updateProfile({ name: r.setup.name, ...(r.setup.roll ? { roll: r.setup.roll } : {}) })
      await refreshAccount(); s.reload(); setSaved(true)
      pushToast('Profile saved.')
    } catch (x) { setErr({ form: x.message }) } finally { setBusy(false) }
  }
  if (s.loading && !s.data) return <Spinner label="Loading your profile" />
  if (s.error) return <p role="alert" className="py-6 text-bad">{s.error}</p>
  if (!f) return null
  const fx = s.data.fixed
  const done = s.data.done || saved
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader title={done && !edit ? 'Your profile' : 'Set up your profile'} subtitle={role === 'student' ? 'Two short steps: your details, then your class. Your teacher confirms the class.' : 'Confirm your details. Your role, branch and classes come from the college records and can’t be changed here.'} />
      <Card>
        <CardTitle eyebrow={role === 'student' ? 'Step 1 of 2' : undefined} action={s.data.setup ? <Badge tone="ok">Saved {relTime(s.data.setupAt)}</Badge> : <Badge tone="warn">Required</Badge>}>Your details</CardTitle>
        <form noValidate onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" error={err.name}>{(id) => <input id={id} autoComplete="name" className={inputCls} maxLength={80} value={f.name} onChange={set('name')} />}</Field>
            <Field label="College email" hint="From your Google sign-in; can’t be edited.">{(id) => <input id={id} className={cx(inputCls, 'bg-ground')} value={fx.email} readOnly aria-readonly="true" />}</Field>
            <Field label="Mobile number" error={err.mobile} hint="10 digits. Not shown to class reps or club organisers.">{(id) => <input id={id} inputMode="tel" autoComplete="tel-national" className={inputCls} maxLength={14} value={f.mobile} onChange={set('mobile')} />}</Field>
            {role === 'student' && <Field label="Gender" error={err.gender}>{(id) => <select id={id} className={inputCls} value={f.gender} onChange={set('gender')}><option value="">Choose</option>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>}
            {role === 'student' && <Field label="Academic year" error={err.yearLevel}>{(id) => <select id={id} className={inputCls} value={f.yearLevel} onChange={set('yearLevel')} disabled={!!fx.enrollment}><option value="">Choose</option>{YEARS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</Field>}
            {role === 'student' && <Field label="Branch" error={err.branch} hint={fx.enrollment ? 'Set by your confirmed class.' : undefined}>{(id) => <Loading s={cat}><select id={id} className={inputCls} value={f.branch} onChange={set('branch')} disabled={!!fx.enrollment}><option value="">Choose</option>{(cat.data?.branches || []).map((b) => <option key={b.code} value={b.code}>{b.name} ({b.code})</option>)}</select></Loading>}</Field>}
            {role === 'student' && <Field label="Roll number" error={err.roll}>{(id) => <input id={id} className={inputCls} maxLength={20} value={f.roll} onChange={set('roll')} />}</Field>}
          </div>
          {role === 'teacher' && <div className="rounded-lg bg-ground px-3 py-2.5 text-[13.5px]"><b>Assigned by your HOD</b> (read-only): {fx.branch ? `${fx.branch} · ` : ''}{(fx.teaches || []).length ? fx.teaches.map((t) => `${t.division} ${t.subject}`).join(', ') : 'no classes yet'}</div>}
          {role === 'hod' && <div className="rounded-lg bg-ground px-3 py-2.5 text-[13.5px]"><b>Appointment</b> (from college records, read-only): HOD of {(fx.branches || []).join(', ')}</div>}
          {role !== 'student' && <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" className="mt-1 h-[18px] w-[18px]" checked={f.confirm} onChange={set('confirm')} />I confirm these details are correct.</label>}
          {err.confirm && <p role="alert" className="text-[13px] text-bad">{err.confirm}</p>}
          {err.form && <p role="alert" className="text-[13.5px] text-bad">{err.form}</p>}
          <div><Button type="submit" disabled={busy}>{busy ? 'Saving…' : s.data.setup ? 'Save changes' : 'Save and continue'}</Button></div>
          <p className="text-[12.5px] text-muted">Editing your profile never changes your role or class. To move to another division, use “Request a change” below.</p>
        </form>
      </Card>
      {role === 'student' && done && <DivisionStep yearLevel={Number(f.yearLevel)} branch={f.branch} />}
      {role !== 'student' && done && <div><a href="#/" className="press inline-flex min-h-[40px] items-center rounded-lg bg-maroon px-4 font-semibold text-white">Go to your portal</a></div>}
    </div>
  )
}

/** Step 2: the class, from verified divisions only (same branch and year). */
function DivisionStep({ yearLevel, branch }) {
  const { session, pushToast, refreshAccount } = useApp()
  const cat = useCatalog()
  const [busy, setBusy] = useState(false)
  const jr = session.joinRequest, e = session.enrollment
  const years = cat.data?.years || []
  const year = years.find((y) => y.level === yearLevel)
  const list = (cat.data?.divisions || []).filter((d) => d.branch_code === branch && year && d.year_id === year.id)
  const join = async (code) => { setBusy(true); try { await api('join-requests', { method: 'POST', body: { division: code } }); pushToast(`Request sent to join ${code}. Your class teacher will confirm it.`); await refreshAccount(); refreshTimetable() } catch (x) { pushToast(x.message, 'bad') } finally { setBusy(false) } }
  const cancel = async () => { setBusy(true); try { await api('join-requests', { method: 'DELETE', query: { id: jr.id } }); await refreshAccount() } catch (x) { pushToast(x.message, 'bad') } finally { setBusy(false) } }
  if (e) return (<><MyClass /><div><a href="#/" className="press inline-flex min-h-[40px] items-center rounded-lg bg-maroon px-4 font-semibold text-white">Go to Overview</a></div></>)
  return (
    <Card>
      <CardTitle eyebrow="Step 2 of 2">Your division</CardTitle>
      <Loading s={cat}>{jr?.status === 'pending' ? (
        <div className="text-[14px]"><p className="flex flex-wrap items-center gap-2"><Badge tone="warn">Waiting for approval</Badge>to join <b>{jr.division_code}</b> · sent {relTime(jr.created_at)}</p>
          <p className="mt-1 text-[13px] text-muted">You can use the Overview meanwhile; class work appears once your teacher approves.</p>
          <div className="mt-3 flex flex-wrap gap-2"><a href="#/" className="press inline-flex min-h-[40px] items-center rounded-lg bg-maroon px-4 font-semibold text-white">Go to Overview</a><Button variant="secondary" disabled={busy} onClick={cancel}>Cancel request</Button></div></div>
      ) : !list.length ? (
        <div className="text-[14px]">
          <p>No {year ? `${year.label} ${year.calendar}` : ''} divisions for {branch} are set up yet. The division list comes from the college: your HOD adds it, and it can’t be typed in here.</p>
          <p className="mt-2 text-[13px] text-muted">You can use the Overview meanwhile. Come back here when your HOD has added the divisions.</p>
          <Button className="mt-3" onClick={() => { prefs.set(skipKey(session.userId), true); window.location.hash = '/' }}>Continue to Overview</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {jr?.status === 'rejected' && <p className="text-[13.5px]"><Badge tone="bad">Not approved</Badge> for {jr.division_code}{jr.note ? `: “${jr.note}”` : ''}. Check your division and ask again.</p>}
          <p className="text-[13.5px] text-muted">{year.label} {year.calendar} · {branch}. Choose the division on your college ID or timetable.</p>
          <div className="flex flex-wrap gap-2">{list.map((d) => <Button key={d.code} variant="secondary" disabled={busy} onClick={() => join(d.code)}>{d.code}{d.name && d.name !== d.code ? ` · ${d.name}` : ''}{!d.confirmed ? ' (name to be confirmed)' : ''}</Button>)}</div>
          <p className="text-[12.5px] text-muted">Your class teacher, class rep or HOD approves the request. Wrong year or branch? Correct it in step 1 first.</p>
        </div>)}</Loading>
    </Card>
  )
}
