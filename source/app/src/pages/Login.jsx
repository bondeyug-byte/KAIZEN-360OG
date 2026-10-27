import heroImg from '../assets/campus-hero.jpg'
import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Brand } from '../components/Layout.jsx'
import { Button, Field, inputCls, cx } from '../components/ui.jsx'
import * as auth from '../lib/auth.js'

const PORTALS = [['student', 'Student'], ['teacher', 'Teacher'], ['hod', 'HOD']]
const roleFromHash = () => {
  const r = new URLSearchParams((window.location.hash.split('?')[1]) || '').get('role')
  return ['student', 'teacher', 'hod'].includes(r) ? r : 'student'
}
const INTRO = {
  student: 'Sign in with your college Google account ending in @ves.ac.in. We then email you a one-time code.',
  teacher: 'Teachers sign in with their @ves.ac.in Google account, then enter an emailed code. Your HOD must have added your email first.',
  hod: 'HODs sign in with their @ves.ac.in Google account, then enter an emailed code. The college registers HOD emails on the server.',
}
const NOT_REGISTERED = {
  teacher: "This email isn't registered for the Teacher portal. Ask your HOD to add it, or sign in on the Student tab.",
  hod: "This email isn't registered as an HOD.",
}
const LABEL = { student: 'Student', teacher: 'Teacher', hod: 'HOD' }

export default function Login({ next = '/' }) {
  const { completeOtpLogin, session } = useApp()
  const [portal, setPortal] = useState(roleFromHash)
  const [step, setStep] = useState('google') // 'google' first, then 'code'
  const [maskedEmail, setMaskedEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const on = () => { setPortal(roleFromHash()); setError(''); setStep('google'); setCode('') }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  const googleLogin = async () => {
    setError('')
    setBusy(true)
    try {
      const r = await auth.googleSignIn()
      if (r.otpRequired) { setMaskedEmail(r.email || ''); setCode(''); setStep('code') }
    } catch (err) {
      setError(err.message)
    } finally { setBusy(false) }
  }

  const verifyCode = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code)) { setError('The code is 6 digits.'); return }
    setBusy(true)
    try {
      const r = await auth.verifyEmailCode(code)
      // The server decides the role from the email. A wrong-tab sign-in is signed out again.
      const okForTab = portal === 'student' || (portal === 'teacher' && (r.role === 'teacher' || r.role === 'hod')) || (portal === 'hod' && r.role === 'hod')
      if (!okForTab) {
        try { await auth.logout() } catch { /* the cookie is also checked on the server */ }
        setStep('google'); setCode('')
        setError(NOT_REGISTERED[portal])
        return
      }
      completeOtpLogin(r)
      window.location.hash = r.role === 'hod' ? '/hod' : r.role === 'teacher' ? '/' : next
    } catch (err) {
      setError(err.message)
      if (['OTP_NOT_FOUND', 'VERIFY_RATE_LIMITED'].includes(err.code)) { setStep('google'); setCode('') }
    } finally { setBusy(false) }
  }

  return (
    <div className="app-bg grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between" style={{ backgroundImage: `linear-gradient(180deg, rgba(8,24,18,.55), rgba(8,24,18,.25) 45%, rgba(8,24,18,.7)), url(${heroImg})`, backgroundSize: 'cover', backgroundPosition: '62% center' }}>
        <Brand light />
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-[46px] font-bold leading-[1.04] drop-shadow">Your First Year.<br /><span className="text-lime">Your Fresh Start.</span></h1>
          <p className="mt-4 text-lg text-white/85">Lectures by weekday, the marks you need, a ride to campus, the right person to ask, and a 3D map of every floor — in one place.</p>
        </div>
        <p className="relative z-10 font-mono text-[12px] tracking-[.3em] text-white/80">ACADEMICS · PEOPLE · CAMPUS LIFE</p>
      </section>

      <section className="page-in mx-auto flex w-full max-w-[560px] flex-col justify-center gap-5 px-5 py-10 sm:px-10">
        <div className="lg:hidden"><Brand /></div>
        <div>
          <h2 className="font-display text-[30px] font-semibold">Sign in · {LABEL[portal]} portal</h2>
          <p className="mt-1 text-muted">{INTRO[portal]}</p>
        </div>

        <div role="tablist" aria-label="Choose your portal" className="grid grid-cols-3 gap-1 rounded-xl bg-sand p-1">
          {PORTALS.map(([r, l]) => (
            <button key={r} role="tab" aria-selected={portal === r}
              onClick={() => { setPortal(r); setError(''); setStep('google'); setCode(''); history.replaceState(null, '', `#/login?role=${r}`) }}
              className={cx('press min-h-[42px] rounded-lg px-2 text-[13.5px] font-semibold', portal === r ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}>{l}</button>
          ))}
        </div>

        {session.message && <p role="alert" className="rounded-xl bg-[#FBEDEA] px-3 py-2 text-sm text-bad">{session.message}</p>}

        <div className="rounded-xl border border-line bg-surface p-5">
          {step === 'google' ? (
            <>
              <b className="text-[15px]">Step 1 · Google sign-in</b>
              <p className="mb-3 mt-1 text-sm text-muted">Only accounts ending in <b>@ves.ac.in</b> are accepted.</p>
              <Button type="button" onClick={googleLogin} disabled={busy}>{busy ? 'Please wait…' : 'Continue with Google'}</Button>
              {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
              <p className="mt-3 text-xs text-muted">{portal === 'teacher' ? 'Only emails your HOD has added can open the Teacher portal. ' : portal === 'hod' ? 'Only emails registered for a branch can open the HOD portal. ' : ''}Your role is set by the college from your email address, not by anything you can edit.</p>
            </>
          ) : (
            <form onSubmit={verifyCode} className="flex flex-col gap-3" noValidate>
              <b className="text-[15px]">Step 2 · Enter your code</b>
              <div className="rounded-lg bg-[#E7F4EC] px-3 py-2 text-[13.5px] text-ok">
                We emailed a 6-digit code to <b>{maskedEmail}</b>. It expires in 10 minutes. Check your spam folder if it does not arrive.
              </div>
              <Field label="6-digit code" error={error}>
                {(id) => <input id={id} className={cx(inputCls, 'font-mono text-xl tracking-[0.4em]')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} disabled={busy} autoFocus />}
              </Field>
              <Button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify and sign in'}</Button>
              <button type="button" className="min-h-[40px] self-start text-sm font-semibold text-maroon" onClick={() => { setStep('google'); setError(''); setCode('') }}>Start over with a different account</button>
            </form>
          )}
        </div>

        <p className="text-sm text-muted">Just looking? <a href="#/navigator" className="font-semibold text-maroon">Open the 3D campus</a>, <a href="#/directory" className="font-semibold text-maroon">the directory</a> or <a href="#/events" className="font-semibold text-maroon">events</a> without signing in.</p>
      </section>
    </div>
  )
}