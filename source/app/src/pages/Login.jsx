import heroImg from '../assets/campus-hero.jpg'
import { useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Brand } from '../components/Layout.jsx'
import { Button } from '../components/ui.jsx'
import * as auth from '../lib/auth.js'

export default function Login({ next = '/' }) {
  const { completeOtpLogin, session } = useApp()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const googleLogin = async () => {
    setError('')
    setBusy(true)
    try {
      const r = await auth.googleSignIn()
      completeOtpLogin(r)
      // The server decides the role from the email; HODs land on their own portal.
      window.location.hash = r.role === 'hod' ? '/hod' : r.role === 'teacher' ? '/' : next
    } catch (err) {
      setError(err.message)
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
          <h2 className="font-display text-[30px] font-semibold">Sign in</h2>
          <p className="mt-1 text-muted">Use your college Google account ending in @ves.ac.in. Students, teachers and HODs all sign in here.</p>
        </div>
        {session.message && <p role="alert" className="rounded-xl bg-[#FBEDEA] px-3 py-2 text-sm text-bad">{session.message}</p>}
        <div className="rounded-xl border border-line bg-surface p-5">
          <Button type="button" onClick={googleLogin} disabled={busy}>{busy ? 'Please wait…' : 'Continue with Google'}</Button>
          {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
          <p className="mt-3 text-xs text-muted">Your role (student, teacher or HOD) is set by the college from your email address.</p>
        </div>
        <p className="text-sm text-muted">Just looking? <a href="#/navigator" className="font-semibold text-maroon">Open the 3D campus</a>, <a href="#/directory" className="font-semibold text-maroon">the directory</a> or <a href="#/events" className="font-semibold text-maroon">events</a> without signing in.</p>
      </section>
    </div>
  )
}