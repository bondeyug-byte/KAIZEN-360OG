import heroImg from '../assets/campus-hero.jpg'
import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Brand } from '../components/Layout.jsx'
import { Badge, Spinner, cx } from '../components/ui.jsx'
import * as auth from '../lib/auth.js'
import { CLASS_LABEL } from '../data/config.js'
import { demoIdsFor, TRUSTED_DEMO, ROLE_LABEL } from '../lib/roles.js'

const PORTALS = [['student', 'Student'], ['teacher', 'Teacher'], ['hod', 'HOD'], ['parent', 'Parent']]
const roleFromHash = () => { const r = new URLSearchParams((window.location.hash.split('?')[1]) || '').get('role'); return ['student', 'teacher', 'hod', 'parent', 'organiser', 'admin'].includes(r) ? r : 'student' }
// Only in-app paths after sign-in (no "//host" or "https:" tricks)
const safeNext = (n) => (typeof n === 'string' && /^\/[a-z0-9/_-]*$/i.test(n) && !n.startsWith('//') ? n : '/')
const HINT = {
  student: 'Use your college Google account (…@ves.ac.in).',
  teacher: 'Use your college Google account (…@ves.ac.in). Your HOD must have added you as a teacher.',
  hod: 'Use the college Google account registered for your branch.',
  parent: 'Use the Google account your child added in Campus360 and their class teacher confirmed. Any Google account (Gmail or other) works once it is confirmed.',
}

const GoogleMark = () => (
  <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" /><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" /><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" /><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" /></svg>
)

export default function Login({ next = '/' }) {
  const { server, completeGoogleLogin, demoLogin, demoEnabled, googleReady, session, db } = useApp()
  const fromHash = () => { const r = roleFromHash(); return !demoEnabled && (r === 'organiser' || r === 'admin') ? 'student' : r } // demo-only desks
  const [portal, setPortal] = useState(fromHash)
  useEffect(() => { const on = () => setPortal(fromHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, []) // eslint-disable-line
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = server.available && server.configured
  const pick = (r) => { setPortal(r); setError(''); history.replaceState(null, '', `#/login?role=${r}`) }

  const signIn = async () => {
    if (busy) return
    setError(''); setBusy(true)
    try {
      const r = await auth.signInWithGoogle(portal)
      if (r.redirected) return // the page is going to Google and back
      completeGoogleLogin(r)
      // The server decides the role; each role lands on its own portal.
      window.location.hash = r.role === 'hod' ? '/hod' : r.role === 'parent' ? '/parent' : r.role === 'teacher' ? '/' : safeNext(next)
    } catch (err) {
      if (err.code !== 'CANCELLED') setError(err.message)
    } finally { setBusy(false) }
  }

  const staffPortal = portal !== 'parent' && portal !== 'organiser' && portal !== 'admin'
  return (
    <div className="app-bg grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between" style={{ backgroundImage: `linear-gradient(180deg, rgba(8,24,18,.55), rgba(8,24,18,.25) 45%, rgba(8,24,18,.7)), url(${heroImg})`, backgroundSize: 'cover', backgroundPosition: '62% center' }}>
        <Brand light />
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-[40px] font-semibold leading-[1.08] drop-shadow">Your timetable, attendance and the way to your next room.</h1>
          <p className="mt-4 text-lg text-white/85">Lectures by weekday, the marks you need, a ride to campus, the right person to ask, and a 3D map of every floor.</p>
        </div>
        <span />
      </section>

      <section className="mx-auto flex w-full max-w-[560px] flex-col justify-center gap-5 px-5 py-10 sm:px-10">
        <div className="lg:hidden"><Brand /></div>
        <div>
          <h2 className="font-display text-[30px] font-semibold">Sign in · {ROLE_LABEL[portal]} portal</h2>
          <p className="mt-1 text-muted">{portal === 'organiser' ? 'Council and club desks use a demo account in this build.' : HINT[portal] || HINT.student}</p>
        </div>
        <div role="tablist" aria-label="Choose your portal" className="grid grid-cols-2 gap-1 rounded-xl bg-sand p-1 sm:grid-cols-4">
          {PORTALS.map(([r, l]) => <button key={r} role="tab" aria-selected={portal === r} onClick={() => pick(r)} className={cx('press min-h-[42px] rounded-lg px-2 text-[13.5px] font-semibold', portal === r ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}>{l}</button>)}
        </div>
        {demoEnabled && <p className="-mt-2 text-right text-[12.5px]">{portal === 'organiser' ? <button className="font-semibold text-maroon" onClick={() => pick('student')}>Back to the four portals</button> : <button className="font-semibold text-maroon" onClick={() => pick('organiser')}>Council or club event desk (demo)</button>}</p>}
        {session.message && !error && <p role="alert" className="rounded-xl bg-[#FBEDEA] px-3 py-2 text-sm text-bad">{session.message}</p>}

        {portal !== 'organiser' && portal !== 'admin' && (
          <div className="rounded-xl border border-line bg-surface p-5">
            {!server.checked ? <Spinner label="Checking sign-in" /> : !ready ? (
              <div role="status" className="rounded-lg bg-sand px-3 py-2 text-[13.5px]">
                <p>{!server.available ? 'Google sign-in needs the deployed app and its server functions. This copy has no server.' : 'Google sign-in with your college account is being set up.'}{demoEnabled && portal !== 'parent' && portal !== 'hod' ? ' Until then, use a demo account below (sample data only, kept in this browser).' : ''}</p>
                {server.available && server.missing?.length > 0 && <p className="mt-1 text-[12px] text-muted">For the site admin: missing server settings {server.missing.join(', ')}. See docs/GOOGLE-SIGN-IN.md.</p>}
              </div>
            ) : (
              <>
                <button type="button" onClick={signIn} disabled={busy} aria-busy={busy}
                  className="press flex min-h-[48px] w-full items-center justify-center gap-3 rounded-lg border border-line2 bg-surface px-4 text-[15px] font-semibold text-ink hover:border-[#9DB5A4] disabled:cursor-wait disabled:opacity-70">
                  <GoogleMark />{busy ? 'Waiting for Google…' : 'Continue with Google'}
                </button>
                {error && <p role="alert" className="mt-3 rounded-lg bg-[#FBEDEA] px-3 py-2 text-[13.5px] text-bad">{error}</p>}
                <p className="mt-3 text-[12px] text-muted">{staffPortal ? 'Only …@ves.ac.in accounts can open this portal, and the college assigns roles: signing in never makes you a teacher or HOD by itself.' : 'Signing in proves you own this Google account. You only see the student(s) the college confirmed for it.'}{' '}Campus360 asks Google only for your name and email address.</p>
              </>
            )}
            <p className="mt-3 text-[12px] text-muted">By signing in you agree to the <a href="#/terms" className="font-semibold text-maroon underline">terms</a>. See how your data is used in the <a href="#/privacy" className="font-semibold text-maroon underline">privacy notice</a> (drafts pending college review).</p>
          </div>
        )}

        {portal === 'parent' && <p className="rounded-xl border border-line bg-surface p-4 text-[13.5px] text-muted"><b className="text-ink">How a parent gets access.</b> Your child adds your Google account email under College portal → My class, and their class teacher confirms it. If you change your Google account, your child removes the old one and adds the new one, and the teacher confirms it again.</p>}
        {demoEnabled && portal !== 'hod' && portal !== 'parent' && (
          <div className="rounded-xl border border-dashed border-[#C9B6DA] bg-[#F7F2FB] p-5">
            <div className="mb-1 flex items-center gap-2"><b className="text-[15px]">Demo sign-in · {ROLE_LABEL[portal]}</b><Badge tone="demo">Sample data</Badge></div>
            <p className="mb-3 text-sm text-muted">Fictional sample accounts with data stored only in this browser. They never see real college records{googleReady ? '' : ', and they go away once Google sign-in is switched on'}.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {demoIdsFor(portal).map((id) => {
                const p = db.profiles[id]
                if (!p) return null
                return (
                  <button key={id} onClick={() => { demoLogin(id); window.location.hash = safeNext(next) }} className="press flex min-h-[56px] items-center gap-3 rounded-lg border border-line bg-surface px-3 text-left hover:border-[#9DB5A4]">
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-maroon-100 text-[13px] font-semibold text-maroon">{p.name.split(' ').map((x) => x[0]).join('')}</span>
                    <span className="leading-tight"><b className="block text-[15px]">{p.name}</b><small className="text-xs text-muted">{TRUSTED_DEMO[id].role === 'organiser' ? 'Council / Club · event desk' : TRUSTED_DEMO[id].role === 'teacher' ? `Teacher · ${TRUSTED_DEMO[id].teaches.map((t) => t.division).join(', ')}` : TRUSTED_DEMO[id].role === 'admin' ? 'Admin (demo)' : `${p.division || CLASS_LABEL[p.classId]}`}</small></span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {demoEnabled && <p className="text-[12.5px] text-muted">College admin? <a href="#/login?role=admin" className="font-semibold text-maroon">Admin demo account</a></p>}
        <p className="text-sm text-muted">Just looking? <a href="#/navigator" className="font-semibold text-maroon">Open the 3D campus</a>, <a href="#/directory" className="font-semibold text-maroon">the directory</a> or <a href="#/events" className="font-semibold text-maroon">events</a> without signing in.</p>
      </section>
    </div>
  )
}
