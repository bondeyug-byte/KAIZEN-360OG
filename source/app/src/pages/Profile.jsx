import { useEffect, useState } from 'react'
import { useApp, profileCompletion } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Field, inputCls, cx, ConfirmButton, AnimatedNumber, Spinner } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { CLASSES, CLASS_LABEL, INTEREST_OPTIONS } from '../data/config.js'
import { YEARS, BRANCHES, divisionsFor, validateAcademic, divisionInfo, hasAcademicIdentity } from '../data/academics.js'
import { isStudent } from '../lib/posts.js'
import { AttendanceSummary } from './Attendance.jsx'
import { useStudentAttendance } from '../lib/record.js'
import { leaderboard } from '../lib/challenges.js'
import { verificationOf } from '../lib/rides.js'

export default function Profile({ query }) {
  const { me, db, session, updateProfile, resetDemo, signOut, pushToast, sync } = useApp()
  const locked = hasAcademicIdentity(me) && (me.academicLocked !== false)
  const real = session.mode === 'google' // real accounts choose from the college's real divisions
  const [acErr, setAcErr] = useState({})
  const initForm = (me) => ({ name: me.name || '', classId: me.classId || '', branch: me.branch || '', email: me.email || '', collegeId: me.collegeId || '', roll: me.roll || '', year: me.year || '', branchId: me.branchId || '', division: me.division || '', interests: me.interests || [], subjects: me.subjects || [] })
  const [f, setF] = useState(() => initForm(me))
  // The cloud account can arrive just after this page opens: refill the form when the signed-in account changes.
  useEffect(() => { setF(initForm(me)) }, [me.id]) // eslint-disable-line
  const [subj, setSubj] = useState('')
  const [err, setErr] = useState('')
  const comp = profileCompletion({ ...me, ...f })
  const toggle = (i) => setF({ ...f, interests: f.interests.includes(i) ? f.interests.filter((x) => x !== i) : [...f.interests, i] })
  const save = (e) => {
    e.preventDefault()
    if (!f.name.trim()) { setErr('Enter your name.'); return }
    if (f.name.trim().length > 60) { setErr('Keep your name under 60 characters.'); return }
    setErr('')
    let ac = {}
    if (isStudent(me) && real) {
      // Phone accounts: the class comes from an approved join request (College portal), not from this form.
      setAcErr({}); ac = { roll: me.roll || '' } // roll is edited in "Set up your profile" (server-validated)
    } else if (isStudent(me) && !locked) {
      const e2 = validateAcademic(f, db.profiles, me.id); setAcErr(e2)
      if (Object.keys(e2).length) return
      ac = { year: f.year, branchId: f.branchId, division: f.division, roll: f.roll.trim(), academicLocked: true }
    }
    const { year, branchId, division, roll, ...rest } = f
    updateProfile({ ...rest, ...ac, name: f.name.trim(), branch: f.branch.trim() || (BRANCHES.find((b) => b.id === f.branchId)?.label || ''), email: me.authMethod === 'google' ? me.email : f.email.trim(), collegeId: (f.collegeId || '').trim().slice(0, 30) })
    pushToast('Profile saved. Suggestions are updated.')
    // New Google-verified students go straight on to "Join your class".
    if (query?.onboard) window.location.hash = real && !session.enrollment ? '/setup' : '/'
  }
  return (
    <div>
      <PageHeader back={!query?.onboard} title={query?.onboard ? 'Welcome to Campus360' : 'Your profile'} subtitle={query?.onboard ? 'Tell us a little about you so the dashboard can show your timetable and suggestions.' : 'Your interests and subjects shape event suggestions and peer-learning matches.'} />
      {session.mode === 'google' && <SyncLine sync={sync} />}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Card>
          <form onSubmit={save} className="flex flex-col gap-5" noValidate>
            <div><h2 className="font-display text-[17px] font-semibold">Personal details</h2><p className="text-[13px] text-muted">Used for your timetable and class leaderboard.</p></div>
            <Field label="Name" error={err}>{(id) => <input id={id} className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" />}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {isStudent(me) && real && <>
                <div className="sm:col-span-2 rounded-lg bg-ground px-3 py-2 text-[13.5px]">{session.enrollment ? <>Your class: <b>{session.enrollment.division_code}</b> (approved).{' '}{session.joinRequest?.status === 'pending' && session.joinRequest.kind === 'transfer' ? <>Your request to move to <b>{session.joinRequest.division_code}</b> is waiting for approval.</> : <>Wrong division? <a className="font-semibold text-maroon underline" href="#/portal?tab=class">Request a change</a> (a teacher or the HOD approves it).</>}</> : session.joinRequest?.status === 'pending' ? <>Request to join <b>{session.joinRequest.division_code}</b> is pending.</> : <>You haven’t joined a class yet. <a className="font-semibold text-maroon underline" href="#/portal?tab=class">Join your class</a>.</>}</div>
                <div className="sm:col-span-2 rounded-lg bg-ground px-3 py-2 text-[13.5px]">Roll number {me.roll ? <b>{me.roll}</b> : 'not set'}, mobile, year and branch are kept in your verified profile. <a className="font-semibold text-maroon underline" href="#/setup?edit=1">Edit profile details</a></div>
              </>}
              {isStudent(me) && !real && <>
                <Field label="Academic year" error={acErr.year}>{(id) => <select id={id} disabled={locked} className={inputCls} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value, division: '' })}><option value="">Choose…</option>{YEARS.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select>}</Field>
                <Field label="Branch" error={acErr.branchId}>{(id) => <select id={id} disabled={locked} className={inputCls} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value, division: '' })}><option value="">Choose…</option>{BRANCHES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>}</Field>
                <Field label="Division" error={acErr.division}>{(id) => <select id={id} disabled={locked || !f.year || !f.branchId} className={inputCls} value={f.division} onChange={(e) => setF({ ...f, division: e.target.value })}><option value="">{f.year && f.branchId ? 'Choose…' : 'Pick year and branch first'}</option>{divisionsFor(f.year, f.branchId).map((d) => <option key={d}>{d}</option>)}</select>}</Field>
                <Field label="Roll number" error={acErr.roll}>{(id) => <input id={id} disabled={locked} className={inputCls} value={f.roll} onChange={(e) => setF({ ...f, roll: e.target.value })} />}</Field>
                {locked && <p className="text-[12.5px] text-muted sm:col-span-2">{divisionInfo(me.division)?.label} · roll {me.roll}. Your division and roll number decide which classwork and attendance you see, so only an admin can change them (Admin → Students in this demo).</p>}
                <Field label="Timetable group">{(id) => <select id={id} className={inputCls} value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}><option value="">Choose…</option>{[...CLASSES, 'SE-A'].map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</select>}</Field>
              </>}
              <Field label="College ID number (optional)" hint="Optional. Your verified college Google account already identifies you">{(id) => <input id={id} className={inputCls} maxLength={30} value={f.collegeId || ''} onChange={(e) => setF({ ...f, collegeId: e.target.value })} />}</Field>
              <Field label={me.authMethod === 'google' ? 'Email (from your Google sign-in)' : 'College email (optional)'} hint="Pre-fills event registration forms">{(id) => <input id={id} type="email" className={inputCls} value={me.authMethod === 'google' ? me.email || '' : f.email} readOnly={me.authMethod === 'google'} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            </div>
            <fieldset className="border-t border-line pt-5">
              <legend className="contents"><span className="block font-display text-[17px] font-semibold">Interests</span></legend>
              <p className="mb-3 text-[13px] text-muted">Shapes event suggestions and peer-learning matches. {f.interests.length} selected.</p>
              <div className="flex flex-wrap gap-1.5">
                {INTEREST_OPTIONS.map((i) => (
                  <button type="button" key={i} aria-pressed={f.interests.includes(i)} onClick={() => toggle(i)} className={cx('press inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-[13.5px] font-medium capitalize', f.interests.includes(i) ? 'border-maroon/40 bg-maroon-50 text-maroon' : 'border-line2 bg-surface text-[#3B4048] hover:bg-ground')}>{f.interests.includes(i) && <Icon name="check" size={14} stroke={2.4} />}{i === 'ai' ? 'AI' : i}</button>
                ))}
              </div>
            </fieldset>
            <div className="border-t border-line pt-5">
              <h2 className="font-display text-[17px] font-semibold">Enrolled subjects</h2>
              <p className="mb-3 text-[13px] text-muted">Used to match you with peers who study the same things.</p>
              <ul className="mb-2 flex flex-wrap gap-1.5">
                {f.subjects.map((s) => <li key={s} className="fade-in flex items-center gap-1 rounded-lg border border-line bg-ground py-1 pl-3 pr-1 text-[13.5px]">{s}<button type="button" aria-label={`Remove ${s}`} onClick={() => setF({ ...f, subjects: f.subjects.filter((x) => x !== s) })} className="press grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface hover:text-bad"><Icon name="x" size={14} /></button></li>)}
              </ul>
              <div className="flex gap-2">
                <label className="flex-1"><span className="sr-only">Add a subject</span><input className={inputCls} placeholder="Add a subject" value={subj} onChange={(e) => setSubj(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (subj.trim() && !f.subjects.includes(subj.trim())) setF({ ...f, subjects: [...f.subjects, subj.trim()] }); setSubj('') } }} /></label>
                <Button type="button" variant="secondary" icon="plus" onClick={() => { if (subj.trim() && !f.subjects.includes(subj.trim())) setF({ ...f, subjects: [...f.subjects, subj.trim()] }); setSubj('') }}>Add</Button>
              </div>
            </div>
            <div className="flex justify-end border-t border-line pt-4"><Button type="submit" icon="check">{query?.onboard ? 'Save and continue' : 'Save profile'}</Button></div>
          </form>
        </Card>
        <div className="flex flex-col gap-5">
          {isStudent(me) && (real || hasAcademicIdentity(me)) && <ProfileAttendance />}
          {isStudent(me) && <ChallengeNote />}
          <Card>
            <CardTitle eyebrow="Account">Identity</CardTitle>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted">App user ID</dt><dd className="truncate font-mono text-xs">{me.id}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Sign-in</dt><dd>{session.mode === 'demo' ? <Badge tone="demo">Demo · not signed in with Google</Badge> : <Badge tone="ok" icon="shield">Google account</Badge>}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Email</dt><dd>{session.mode === 'google' ? `${session.email || me.email} · verified by Google` : 'Not verified (demo)'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">College enrolment</dt><dd>Not verified</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted">Google sign-in proves you own the account. Your class is confirmed separately by a teacher or the HOD.</p>
          </Card>
          <Card>
            <div className="flex items-center gap-4">
              <svg viewBox="0 0 44 44" className="h-16 w-16 flex-none -rotate-90" aria-hidden="true"><circle cx="22" cy="22" r="18" fill="none" stroke="#F2EDE8" strokeWidth="5" /><circle cx="22" cy="22" r="18" fill="none" stroke={comp.pct === 100 ? '#1E7A4C' : '#1E5240'} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(comp.pct / 100) * 113.1} 113.1`} style={{ transition: 'stroke-dasharray .7s cubic-bezier(.2,.8,.2,1)' }} /></svg>
              <div><p className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted">Profile completion</p><p className="font-display text-[26px] font-semibold leading-tight tabular-nums"><AnimatedNumber value={comp.pct} />%</p>
                <p className="text-[13px] text-muted">{comp.missing.length ? `Missing: ${comp.missing.join(', ')}` : 'All set. Suggestions are personalised.'}</p></div>
            </div>
          </Card>
          <Card>
            <CardTitle eyebrow="Presentation tools">Demo data</CardTitle>
            <p className="mb-3 text-sm text-muted">Restores every sample record (rides, challenges, sessions, marks) to its starting state in this browser.</p>
            <ConfirmButton variant="danger" icon="refresh" confirmText="Yes, reset everything" onConfirm={resetDemo}>Reset demo data</ConfirmButton>
          </Card>
          <Button variant="secondary" icon="logout" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  )
}

/** Challenges ↔ profile: points show on the class leaderboard; they never mint peer-learning credits. */
function ChallengeNote() {
  const { db, me } = useApp()
  const lb = leaderboard(db.shared)
  const mine = lb.students.find((x) => x.userId === me.id)
  const rank = lb.students.findIndex((x) => x.userId === me.id)
  const recent = db.shared.completions.filter((c) => c.userId === me.id).sort((a, b) => b.completedAt.localeCompare(a.completedAt)).slice(0, 3)
  const title = (id) => db.shared.challenges.find((c) => c.id === id)?.title || 'Challenge'
  const v = verificationOf(me)
  return (
    <Card>
      <CardTitle eyebrow="Challenges · leaderboard" action={<a href="#/challenges" className="text-[13px] font-semibold text-maroon hover:underline">Open</a>}>{mine ? `${mine.points} points` : 'No points yet'}</CardTitle>
      {mine ? <p className="text-[13.5px]">#{rank + 1} of {lb.students.length} students · {mine.done} completed{me.classRep ? ` · class rep for ${me.division}` : ''}</p> : <p className="text-[13.5px] text-muted">Complete a class challenge to appear on the leaderboard.</p>}
      {recent.length > 0 && <ul className="mt-2 flex flex-col gap-1 text-[13px]">{recent.map((c) => <li key={c.id} className="flex justify-between gap-2"><span className="truncate">{title(c.challengeId)}</span><b className="text-ok">+{c.points}</b></li>)}</ul>}
      <p className="mt-2 text-[12px] text-muted">Challenge points count for your class on the leaderboard. Peer-learning credits are earned only by teaching, so credits are never created from challenges.</p>
      <p className="mt-2 text-[12.5px]">Rides: {v === 'verified' ? <Badge tone="ok" icon="check">Verified student</Badge> : v === 'demo' ? <Badge tone="demo">Demo · unverified</Badge> : <Badge tone="warn">Add a college email or ID to verify</Badge>}</p>
    </Card>
  )
}

const SYNC_TEXT = {
  loading: ['info', 'Connecting to your cloud account…'],
  saving: ['info', 'Saving to your cloud account…'],
  synced: ['ok', 'Synced: the same profile and planner data on every device you sign in to.'],
  offline: ['warn', 'Offline: changes are kept on this device and sync when you reconnect.'],
  unavailable: ['warn', 'Cloud sync is not available right now, so this profile is saved on this device only.'],
  error: ['bad', 'Couldn’t save to your cloud account. Your changes are kept on this device; try again shortly.'],
}
function SyncLine({ sync }) {
  const [tone, text] = SYNC_TEXT[sync?.status] || []
  if (!text) return null
  return <p role="status" className="mb-4 flex items-center gap-2 text-[13px] text-muted"><Badge tone={tone}>{tone === 'ok' ? 'Cloud' : 'Sync'}</Badge>{text}</p>
}

function ProfileAttendance() {
  const att = useStudentAttendance()
  const sum = att.sum
  return (
    <Card><CardTitle eyebrow="From recorded lectures" action={<a href="#/attendance" className="text-[13px] font-semibold text-maroon hover:underline">Details</a>}>My attendance</CardTitle>
      {att.status === 'loading' ? <Spinner label="Loading" /> : !sum ? <p className="text-[13.5px] text-muted">{att.message || 'Not available right now.'}</p> : sum.overall.total ? <AttendanceSummary sum={sum} threshold={att.threshold} compact /> : <p className="text-[13.5px] text-muted">No lectures recorded for you yet.</p>}</Card>)
}
