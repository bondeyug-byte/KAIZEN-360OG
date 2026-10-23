import heroImg from '../assets/campus-hero.jpg'
import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Brand } from '../components/Layout.jsx'
import { Button, Field, inputCls, Badge, Spinner, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import * as auth from '../lib/auth.js'
import { CLASS_LABEL } from '../data/config.js'
import { demoIdsFor, TRUSTED_DEMO, ROLE_LABEL } from '../lib/roles.js'

const PORTALS = [['student', 'Student'], ['teacher', 'Teacher'], ['hod', 'HOD'], ['parent', 'Parent']]
const roleFromHash = () => { const r = new URLSearchParams((window.location.hash.split('?')[1]) || '').get('role'); return ['student', 'teacher', 'hod', 'parent', 'organiser', 'admin'].includes(r) ? r : 'student' }

export default function Login({ next = '/' }) {
  const { server, completeOtpLogin, demoLogin, session, db, pushToast } = useApp()
  const [portal, setPortal] = useState(roleFromHash)
  useEffect(() => { const on = () => setPortal(roleFromHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on) }, [])
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const [delivery, setDelivery] = useState(null) // { channel, status }
  const [tick, setTick] = useState(Date.now())
  const realAvailable = server.available && server.configured
  useEffect(() => { if (step !== 'code') return; const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t) }, [step])
  // Ask MiniMoth how the code was delivered (WhatsApp first, SMS fallback) a couple of times after sending.
  useEffect(() => {
    if (!sentTo?.otpId) return
    let stop = false
    const check = async () => { try { const r = await auth.otpStatus(sentTo.otpId); if (!stop) setDelivery(r); return r.status === 'delivered' || r.status === 'failed' } catch { return true } }
    const t1 = setTimeout(async () => { if (!(await check())) t2 = setTimeout(check, 5000) }, 2500)
    let t2
    return () => { stop = true; clearTimeout(t1); clearTimeout(t2) }
  }, [sentTo?.otpId])
  const secsLeft = sentTo?.expiresAt ? Math.max(0, Math.round((Date.parse(sentTo.expiresAt) - tick) / 1000)) : null
  const resendIn = sentTo?.sentAt ? Math.min(30, Math.max(0, 30 - Math.round((tick - sentTo.sentAt) / 1000))) : 0
  const mmss = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`

  const send = async (e) => {
    e?.preventDefault()
    setError('')
    const p = auth.normalizePhone(phone)
    if (!p) { setError('Enter a 10-digit Indian mobile number starting with 6–9.'); return }
    setBusy(true)
    try {
      const r = await auth.sendOtp(p, portal === 'teacher' || portal === 'hod' || portal === 'parent' ? portal : undefined)
      const t = Date.now(); setTick(t)
      setSentTo({ phone: r.phone || p, expiresAt: r.expires_at, otpId: r.otp_id, sentAt: t }); setDelivery(null)
      setStep('code'); setCode('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const verify = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code)) { setError('The code is 6 digits.'); return }
    if (secsLeft === 0) { setError('This code has expired. Send a new one.'); return }
    setBusy(true)
    try {
      const r = await auth.verifyOtp(sentTo.phone, code)
      completeOtpLogin(r)
      // The server decides the role; each role lands on its own portal.
      window.location.hash = r.role === 'hod' ? '/hod' : r.role === 'parent' ? '/parent' : r.role === 'teacher' ? '/' : next
    } catch (err) {
      setError(err.message)
      if (['OTP_NOT_FOUND', 'VERIFY_RATE_LIMITED'].includes(err.code)) setStep('phone')
    } finally { setBusy(false) }
  }

  return (
    <div className="app-bg grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between" style={{ backgroundImage: `linear-gradient(180deg, rgba(8,24,18,.55), rgba(8,24,18,.25) 45%, rgba(8,24,18,.7)), url(${heroImg})`, backgroundSize: 'cover', backgroundPosition: '62% center' }}>
        <Brand light />
        <div className="relative z-10 max-w-md">
          <h1 className="font-display text-[46px] font-bold leading-[1.04] drop-shadow">Your First Year.<br /><span className="text-lime">Your Fresh Start.</span></h1>
          <p className="mt-4 text-lg text-white/85">Lectures by weekday, the marks you need, a ride to campus, the right person to ask, and a 3D map of every floor.</p>
        </div>
        <p className="relative z-10 font-mono text-[12px] tracking-[.3em] text-white/80">ACADEMICS · PEOPLE · CAMPUS LIFE</p>
      </section>

      <section className="page-in mx-auto flex w-full max-w-[560px] flex-col justify-center gap-5 px-5 py-10 sm:px-10">
        <div className="lg:hidden"><Brand /></div>
        <div>
          <h2 className="font-display text-[30px] font-semibold">Sign in · {ROLE_LABEL[portal]} portal</h2>
          <p className="mt-1 text-muted">{portal === 'organiser' ? 'Council and club desks use a demo account in this build.' : 'Verify your phone number with a one-time code, or use a demo account.'}</p>
        </div>
        <div role="tablist" aria-label="Choose your portal" className="grid grid-cols-2 gap-1 rounded-xl bg-sand p-1 sm:grid-cols-4">
          {PORTALS.map(([r, l]) => <button key={r} role="tab" aria-selected={portal === r} onClick={() => { setPortal(r); history.replaceState(null, '', `#/login?role=${r}`) }} className={cx('press min-h-[42px] rounded-lg px-2 text-[13.5px] font-semibold', portal === r ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}>{l}</button>)}
        </div>
        <p className="-mt-2 text-right text-[12.5px]">{portal === 'organiser' ? <button className="font-semibold text-maroon" onClick={() => { setPortal('student'); history.replaceState(null, '', '#/login?role=student') }}>← Back to the four portals</button> : <button className="font-semibold text-maroon" onClick={() => { setPortal('organiser'); history.replaceState(null, '', '#/login?role=organiser') }}>Council / Club event desk (demo) →</button>}</p>
        {session.message && <p role="alert" className="rounded-xl bg-[#FBEDEA] px-3 py-2 text-sm text-bad">{session.message}</p>}

        {portal !== 'organiser' && <div className={cx('rounded-xl border border-line bg-surface p-5', !realAvailable && 'opacity-95')}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <b className="text-[15px]">Phone OTP (MiniMoth)</b>
            {!server.checked ? <Spinner label="Checking" /> : realAvailable ? <Badge tone={server.mode === 'test' ? 'info' : 'ok'}>{server.mode === 'test' ? 'Test mode' : 'Available'}</Badge> : <Badge tone="warn">Unavailable here</Badge>}
          </div>
          {server.checked && !realAvailable && (
            <p className="mb-3 rounded-xl bg-sand px-3 py-2 text-sm">
              {server.available ? 'The sign-in server is running but MINIMOTH_API_KEY is not set.' : 'Real OTP needs the deployed app (its secure server function keeps the MiniMoth key secret). This copy has no server, so use demo sign-in below.'}
            </p>
          )}
          {realAvailable && server.mode === 'test' && <p className="mb-3 rounded-lg border border-[#CCDAF6] bg-[#F2F6FD] px-3 py-2 text-[13px] text-[#1D47A6]">The server uses a MiniMoth <b>test key</b>: no WhatsApp or SMS is sent. MiniMoth's docs give <b>000000</b> as the sandbox code.</p>}
          {step === 'phone' ? (
            <form onSubmit={send} className="flex flex-col gap-3" noValidate>
              <Field label="Mobile number" error={error} hint="Indian mobile, e.g. 98765 43210">
                {(id) => <input id={id} className={inputCls} inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!realAvailable || busy} />}
              </Field>
              <Button type="submit" disabled={!realAvailable || busy}>{busy ? 'Sending…' : 'Send code'}</Button>
              <p className="text-[12px] text-muted">By signing in you agree to the <a href="#/terms" className="font-semibold text-maroon underline">terms</a>. See how your data is used in the <a href="#/privacy" className="font-semibold text-maroon underline">privacy notice</a> (drafts pending college review).</p>
            </form>
          ) : (
            <form onSubmit={verify} className="flex flex-col gap-3" noValidate>
              <div className="slide-down rounded-lg bg-[#E7F4EC] px-3 py-2 text-[13.5px] text-ok">
                <p><Icon name="check" size={15} className="mr-1 inline" />Code sent to <b>{auth.maskPhone(sentTo.phone)}</b>{delivery?.channel ? ` by ${delivery.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}` : ' (WhatsApp first, SMS if that fails)'}.</p>
                <p className="mt-0.5 text-[12.5px]">{delivery?.status === 'failed' ? <span className="text-bad">Delivery failed. Send a new code.</span> : delivery?.status === 'delivered' ? 'Delivered. ' : ''}{secsLeft != null && (secsLeft > 0 ? `Expires in ${mmss(secsLeft)}.` : <span className="text-bad">This code has expired. Send a new one.</span>)}</p>
              </div>
              <Field label="6-digit code" error={error}>
                {(id) => <input id={id} className={cx(inputCls, 'font-mono text-xl tracking-[0.4em]')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} disabled={busy} />}
              </Field>
              <Button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Verify and sign in'}</Button>
              <div className="flex justify-between text-sm">
                <button type="button" className="min-h-[40px] font-semibold text-maroon" onClick={() => { setStep('phone'); setError('') }}>Change number</button>
                <button type="button" className="min-h-[40px] font-semibold text-maroon disabled:text-muted" onClick={send} disabled={busy || resendIn > 0}>{resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}</button>
              </div>
            </form>
          )}
          <p className="mt-3 text-xs text-muted">{portal === 'teacher' ? 'Only numbers your HOD has added can open the Teacher portal. ' : portal === 'hod' ? 'Only the number registered for your branch can open the HOD portal. ' : portal === 'parent' ? 'Only numbers your child added and their class teacher confirmed can open the Parent portal. ' : ''}OTP confirms you control this phone number. It does not confirm college enrolment.</p>
        </div>}

        {portal === 'parent' && <p className="rounded-xl border border-line bg-surface p-4 text-[13.5px] text-muted"><b className="text-ink">No demo parent account.</b> The Parent portal shows a real student's attendance, marks and alerts, so it only opens for a phone number the college has confirmed. Your child adds your number under College portal → My class, and their class teacher confirms it.</p>}
        {portal !== 'hod' && portal !== 'parent' && (
        <div className="rounded-xl border border-dashed border-[#C9B6DA] bg-[#F7F2FB] p-5">
          <div className="mb-1 flex items-center gap-2"><b className="text-[15px]">Demo sign-in · {ROLE_LABEL[portal]}</b><Badge tone="demo">Simulated · no OTP</Badge></div>
          <p className="mb-3 text-sm text-muted">Fictional sample accounts for presentations. Each account’s role is fixed by the app, not by anything you can edit; permissions are checked inside the app only and need a server in production.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {demoIdsFor(portal).map((id) => {
              const p = db.profiles[id]
              if (!p) return null
              return (
                <button key={id} onClick={() => { demoLogin(id); window.location.hash = next }} className="lift press flex min-h-[56px] items-center gap-3 rounded-lg border border-line bg-surface px-3 text-left">
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-maroon-100 text-[13px] font-semibold text-maroon">{p.name.split(' ').map((x) => x[0]).join('')}</span>
                  <span className="leading-tight"><b className="block text-[15px]">{p.name}</b><small className="text-xs text-muted">{TRUSTED_DEMO[id].role === 'organiser' ? 'Council / Club · event desk' : TRUSTED_DEMO[id].role === 'teacher' ? `Teacher · ${TRUSTED_DEMO[id].teaches.map((t) => t.division).join(', ')}` : TRUSTED_DEMO[id].role === 'admin' ? 'Admin (demo)' : `${p.division || CLASS_LABEL[p.classId]}`}</small></span>
                </button>
              )
            })}
          </div>
        </div>
        )}
        <p className="text-[12.5px] text-muted">College admin? <a href="#/login?role=admin" className="font-semibold text-maroon">Admin demo account</a></p>
        <p className="text-sm text-muted">Just looking? <a href="#/navigator" className="font-semibold text-maroon">Open the 3D campus</a>, <a href="#/directory" className="font-semibold text-maroon">the directory</a> or <a href="#/events" className="font-semibold text-maroon">events</a> without signing in.</p>
      </section>
    </div>
  )
}
