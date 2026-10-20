import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import Icon from '../components/Icon.jsx'
import { Badge, cx } from '../components/ui.jsx'
import { ALL_TOOLS, PERSONAL_TOOLS, runTool, performAction } from './clientTools.js'
import { PUBLIC_TOOLS } from './publicTools.js'
import { parse, compose, confirmPrompt, cancelledText, helpText, isYes, isNo, detectLang } from './offline.js'
import { LANGS, canListen, canSpeak, listen, speak, stopSpeaking } from './speech.js'
import { prefs } from '../lib/storage.js'

const CARD_TOOLS = new Set(['plan_journey', 'campus_info', 'next_trains', 'buses_near_campus', 'my_schedule', 'my_deadlines', 'find_place', 'campus_route', 'my_events', 'my_rides'])
const GUEST_TOOLS = [...PUBLIC_TOOLS, ...PERSONAL_TOOLS.filter((t) => ['open_page', 'navigate_to'].includes(t.name))]
const CHIPS = {
  en: ["What's my next lecture?", 'Any pending assignments?', 'Next fast train from Kurla to Thane', 'Bus to Kurla', 'Take me to the library', 'Register me for the photography walk'],
  hl: ['Mera next lecture kab hai?', 'Kaunse assignments baaki hain?', 'Chembur se Vashi next train', 'Kurla ke liye bus', 'Library le chalo', 'Ride mein seat book karo'],
  hi: ['मेरा अगला लेक्चर कब है?', 'कौन से असाइनमेंट बाकी हैं?', 'चेंबूर से वाशी अगली ट्रेन', 'कुर्ला के लिए बस', 'लाइब्रेरी का रास्ता', 'कौन से इवेंट हैं?'],
  mr: ['माझं पुढचं लेक्चर कधी आहे?', 'कोणते असाइनमेंट बाकी आहेत?', 'कुर्ला ते ठाणे फास्ट ट्रेन', 'कुर्ल्यासाठी बस', 'ग्रंथालयाचा मार्ग', 'कोणते इव्हेंट आहेत?'],
}
const PAGE_NAME = { '/': 'dashboard', '/planner': 'academic planner', '/rides': 'rides', '/commute': 'trains & buses', '/navigator': '3D campus navigator', '/events': 'events', '/directory': 'directory', '/challenges': 'challenges', '/peer': 'peer learning', '/profile': 'profile', '/login': 'sign-in' }
// Suggestions that fit the page the student is on (English; the language chips below switch the generic set).
const PAGE_CHIPS = {
  '/planner': ['Can I still reach my target SGPA?', 'What marks do I need in each subject?', 'What is my SGPA target status?'],
  '/rides': ['How do I get to college from Dombivli?', 'Any rides with free seats?', 'Book me a seat to campus'],
  '/commute': ['Dombivli se college kaise jaun?', 'Next fast train from Kurla to Thane', 'Chembur to Vashi next train', 'Bus to Kurla from campus'],
  '/navigator': ['Take me to the library', 'Where is the nearest washroom?', "What's on Floor 2?"],
  '/events': ['What events are open?', 'Register me for the photography walk', 'Which events are live right now?'],
  '/directory': ['Where is the exam cell?', 'Who can help with maths doubts?', 'Where is the principal\'s office?'],
  '/challenges': ['How many points do I have?', 'Which challenges are open for my class?'],
  '/peer': ['How many credits do I have?', 'Who can teach me Python?'],
}
const nowText = () => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())

// Keep the conversation small, cutting only at a user turn so tool calls stay paired with results.
function trim(convo, max = 24) {
  if (convo.length <= max) return convo
  let i = convo.length - max
  while (i < convo.length && convo[i].role !== 'user') i++
  return convo.slice(i)
}

export default function Assistant({ route, inApp = false }) {
  const app = useApp()
  const { me, signedIn, runShared, updateMyData } = app
  const [open, setOpen] = useState(false)
  // The in-app mobile header has its own mic button (so nothing floats over cards); it opens this panel.
  useEffect(() => { const on = () => setOpen(true); window.addEventListener('campus360:assistant', on); return () => window.removeEventListener('campus360:assistant', on) }, [])
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [lang, setLangState] = useState(() => prefs.get('asstLang', 'en'))
  const [voiceOn, setVoiceOn] = useState(() => prefs.get('asstVoice', true))
  const [offlineOnly, setOfflineOnly] = useState(() => prefs.get('asstOffline', false))
  const [health, setHealth] = useState({ checked: false, available: false, providers: [] })
  const [pending, setPending] = useState(null)
  const [speaking, setSpeaking] = useState(false)
  const convo = useRef([])
  const prefer = useRef(null)
  const stopRef = useRef(null)
  const listRef = useRef(null)
  const setLang = (l) => { setLangState(l); prefs.set('asstLang', l) }

  useEffect(() => {
    if (!open || health.checked) return
    fetch('/api/assistant/health', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setHealth({ checked: true, available: !!j.available, providers: j.providers || [] }))
      .catch(() => setHealth({ checked: true, available: false, providers: [], unreachable: true }))
  }, [open, health.checked])
  useEffect(() => { listRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }) }, [msgs, busy])
  useEffect(() => () => { stopRef.current?.(); stopSpeaking() }, [])
  const opener = useRef(null)
  useEffect(() => { if (!open) return; const k = (e) => { if (e.key === 'Escape') { setOpen(false); stopSpeaking(); opener.current?.focus?.() } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [open])
  useEffect(() => { const on = () => { opener.current = document.activeElement; setOpen(true) }; window.addEventListener('c360:assistant', on); return () => window.removeEventListener('c360:assistant', on) }, [])

  const aiMode = health.available && !offlineOnly
  const ctx = useCallback(() => ({ db: app.db, me: app.me, myData: app.myData, now: new Date() }), [app.db, app.me, app.myData])
  const add = (m) => setMsgs((x) => [...x, { id: Math.random().toString(36).slice(2), ...m }])
  const say = (text, l = lang) => { if (voiceOn && text) { setSpeaking(true); speak(text, /[\u0900-\u097F]/.test(text) && (l === 'en' || l === 'hl') ? 'hi' : l, () => setSpeaking(false)) } }
  const go = (path) => { if (path) window.location.hash = path }

  async function runAI(text, lang) {
    const c = [...convo.current, { role: 'user', text }]
    const cards = []
    let pend = null, openPath = null, finalText = '', label = null
    const context = { now: new Date().toISOString(), nowText: nowText(), page: PAGE_NAME[route] || route, student: me ? `${me.name}, ${me.classId}, ${me.branch}${me.demo ? ' (demo profile)' : ''}` : null }
    for (let round = 0; round < 5; round++) {
      const r = await fetch('/api/assistant', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: c, tools: signedIn ? ALL_TOOLS : GUEST_TOOLS, lang, context, prefer: prefer.current }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.code || String(r.status))
      prefer.current = j.provider
      label = j.label
      c.push({ role: 'assistant', text: j.text || '', calls: j.calls || [], provider: j.provider, raw: j.raw })
      if (!j.calls?.length) { finalText = j.text || ''; break }
      for (const call of j.calls) {
        const out = runTool(call.name, call.args || {}, ctx())
        c.push({ role: 'tool', id: call.id, name: call.name, result: out.result })
        if (CARD_TOOLS.has(call.name) && out.result && out.result.ok !== false) cards.push({ tool: call.name, result: out.result })
        if (out.pending) pend = out.pending
        if (out.open) openPath = out.open
      }
    }
    if (!finalText) finalText = pend ? confirmPrompt(lang, pend.summary) : cards.map((x) => compose(lang, x.tool, x.result)).join(' ') || '…'
    convo.current = trim(c)
    return { text: finalText, cards, pend, openPath, label }
  }

  function runOffline(text, lang) {
    const { calls } = parse(text, ctx())
    if (!calls.length) return { text: helpText(lang), cards: [], pend: null, openPath: null }
    const cards = [], parts = []
    let pend = null, openPath = null
    for (const call of calls) {
      const out = runTool(call.name, call.args, ctx())
      if (out.pending) { pend = out.pending; parts.push(confirmPrompt(lang, out.pending.summary)) }
      else parts.push(compose(lang, call.name, out.result))
      if (CARD_TOOLS.has(call.name) && out.result && out.result.ok !== false) cards.push({ tool: call.name, result: out.result })
      if (out.open) openPath = out.open
    }
    const answer = parts.filter(Boolean).join(' ')
    convo.current = trim([...convo.current, { role: 'user', text }, { role: 'assistant', text: answer }])
    return { text: answer, cards, pend, openPath }
  }

  function doConfirm(p = pending) {
    if (!p) return
    const r = performAction(p, { runShared, updateMyData, me })
    setPending(null)
    add({ who: 'bot', text: r.text, tone: r.ok ? 'ok' : 'bad', provider: 'Action' })
    convo.current = trim([...convo.current, { role: 'assistant', text: `(${r.ok ? 'Done' : 'Failed'}: ${p.summary}. ${r.text})` }])
    say(r.text)
  }
  function doCancel() {
    setPending(null)
    const t = cancelledText(lang)
    add({ who: 'bot', text: t, provider: 'Action' })
    convo.current = trim([...convo.current, { role: 'assistant', text: '(Cancelled the pending action.)' }])
    say(t)
  }

  async function handle(raw) {
    const text = raw.trim()
    if (!text || busy) return
    setInput('')
    stopSpeaking()
    add({ who: 'user', text })
    if (pending) {
      if (isYes(text)) return doConfirm()
      if (isNo(text)) return doCancel()
      setPending(null)
    }
    setBusy(true)
    const l = detectLang(text, lang)
    let res, provider, note = null
    try {
      if (aiMode) { res = await runAI(text, l); provider = res.label || 'AI' }
      else { res = runOffline(text, l); provider = 'Offline mode' }
    } catch {
      res = runOffline(text, l)
      provider = 'Offline mode'
      note = "Couldn't reach the AI, so offline mode answered."
    }
    setBusy(false)
    add({ who: 'bot', text: res.text, cards: res.cards, provider, note, pending: res.pend })
    setPending(res.pend)
    say(res.text, l)
    if (res.openPath) { go(res.openPath); if (res.openPath.startsWith('/navigator')) setTimeout(() => setOpen(false), 1200) }
  }

  function mic() {
    if (listening) { stopRef.current?.(); return }
    stopSpeaking(); setSpeaking(false)
    if (!canListen) { add({ who: 'bot', text: 'Voice input needs Chrome or Edge. You can type your question instead.', provider: 'System' }); return }
    setListening(true)
    stopRef.current = listen(lang, {
      onInterim: (t) => setInput(t),
      onFinal: (t) => handle(t),
      onError: (e) => {
        setListening(false)
        const m = e === 'not-allowed' || e === 'service-not-allowed' ? 'Microphone access is blocked. Allow it in the browser, or type instead.' : e === 'no-speech' ? "I didn't hear anything. Tap the mic and speak." : e === 'network' ? 'Voice recognition needs internet. Type instead.' : null
        if (m) add({ who: 'bot', text: m, provider: 'System' })
      },
      onEnd: () => setListening(false),
    })
  }

  const onNav = route === '/navigator'
  return (
    <>
      {!open && (
        <button onClick={(e) => { opener.current = e.currentTarget; setOpen(true) }} aria-label="Open voice assistant" className={cx('orb press fixed z-[45] h-14 w-14 place-items-center rounded-full bg-maroon text-white transition-transform hover:scale-105', inApp ? 'hidden bottom-6 right-6 lg:grid' : 'grid bottom-5 right-4 lg:bottom-6 lg:right-6')}>
          <Icon name="mic" size={24} stroke={2} />
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="Campus voice assistant" className="sheet-in sm:dialog-in fixed inset-x-0 bottom-0 z-[55] flex max-h-[86dvh] flex-col rounded-t-2xl border border-line bg-surface shadow-pop sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-h-[min(720px,calc(100dvh-32px))] sm:w-[400px] sm:rounded-2xl">
          <header className="flex items-start gap-3 border-b border-line px-4 pb-3 pt-4">
            <span className={cx('grid h-10 w-10 flex-none place-items-center rounded-xl bg-maroon text-white', (listening || speaking || busy) && 'orb')}>{listening || speaking ? <span className="wave flex h-4 items-center" aria-hidden="true"><i /><i /><i /><i /><i /></span> : <Icon name="bot" />}</span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[17px] font-semibold leading-tight">Campus Assistant</h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
                {!health.checked ? 'Checking AI…' : aiMode ? <><Badge tone="ok">AI on</Badge>{health.providers.join(' → ')}</> : <><Badge tone="demo">Offline mode</Badge>{health.available ? 'AI paused' : 'No AI key on this site'}</>}
              </p>
            </div>
            {canSpeak && <button onClick={() => { const v = !voiceOn; setVoiceOn(v); prefs.set('asstVoice', v); if (!v) { stopSpeaking(); setSpeaking(false) } }} aria-pressed={voiceOn} aria-label={voiceOn ? 'Mute spoken answers' : 'Speak answers aloud'} className="press grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sand hover:text-ink"><Icon name={voiceOn ? 'speaker' : 'mute'} /></button>}
            <button onClick={() => { setOpen(false); stopRef.current?.(); stopSpeaking() }} aria-label="Close assistant" className="press grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sand hover:text-ink"><Icon name="x" size={18} /></button>
          </header>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
            {LANGS.map((l) => <button key={l.id} onClick={() => setLang(l.id)} aria-pressed={lang === l.id} className={cx('press min-h-[30px] rounded-md px-2.5 text-[12.5px] font-semibold', lang === l.id ? 'bg-maroon text-white' : 'bg-sand text-[#3B4048] hover:bg-maroon-50')}>{l.label}</button>)}
            {health.available && <label className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-muted"><input type="checkbox" className="accent-maroon" checked={offlineOnly} onChange={(e) => { setOfflineOnly(e.target.checked); prefs.set('asstOffline', e.target.checked) }} />Offline</label>}
          </div>

          <div ref={listRef} aria-live="polite" className="flex min-h-[220px] flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
            {!msgs.length && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted">Tap the mic and ask anything about your day, trains, buses or campus. {signedIn ? '' : 'Sign in to ask about your own lectures and deadlines.'}</p>
                <div className="flex flex-wrap gap-1.5">{(lang === 'en' && PAGE_CHIPS[route] ? [...PAGE_CHIPS[route], ...CHIPS.en.slice(0, 2)] : CHIPS[lang] || CHIPS.en).map((c) => <button key={c} onClick={() => handle(c)} className="press rounded-lg border border-line2 px-3 py-1.5 text-left text-[13px] font-medium hover:border-maroon/40 hover:bg-maroon-50">{c}</button>)}</div>
              </div>
            )}
            {msgs.map((m) => m.who === 'user' ? (
              <p key={m.id} className="fade-in ml-8 self-end rounded-2xl rounded-br-md bg-maroon px-3 py-2 text-[14.5px] text-white">{m.text}</p>
            ) : (
              <div key={m.id} className="fade-in mr-4 flex flex-col gap-2">
                <div className={cx('rounded-2xl rounded-bl-md px-3 py-2 text-[14.5px]', m.tone === 'ok' ? 'bg-[#E7F4EC]' : m.tone === 'bad' ? 'bg-[#FDECEA]' : 'bg-ground')}>
                  {m.text}
                  {m.provider && <span className="mt-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">{m.provider}</span>}
                  {m.note && <span className="block text-[11px] text-warn">{m.note}</span>}
                </div>
                {m.cards?.map((c, i) => <ResultCard key={i} {...c} />)}
                {m.pending && pending === m.pending && (
                  <div className="pop flex flex-col gap-2 rounded-xl border border-maroon/30 bg-maroon-50/60 p-3">
                    <p className="text-sm font-semibold">{m.pending.summary}?</p>
                    <div className="flex gap-2">
                      <button onClick={() => { add({ who: 'user', text: 'Yes' }); doConfirm(m.pending) }} className="press min-h-[38px] flex-1 rounded-lg bg-maroon text-sm font-semibold text-white hover:bg-maroon-dark">Confirm</button>
                      <button onClick={() => { add({ who: 'user', text: 'No' }); doCancel() }} className="press min-h-[38px] flex-1 rounded-lg border border-line2 bg-surface text-sm font-semibold hover:bg-ground">Cancel</button>
                    </div>
                    <p className="text-xs text-muted">Or say "yes" / "haan" / "ho".</p>
                  </div>
                )}
              </div>
            ))}
            {busy && <p className="flex items-center gap-2 text-sm text-muted"><span className="h-4 w-4 animate-spin rounded-full border-2 border-line2 border-t-maroon" />{aiMode ? 'Thinking…' : 'Working…'}</p>}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handle(input) }} className="flex items-center gap-2 border-t border-line p-3">
            <button type="button" onClick={mic} aria-label={listening ? 'Stop listening' : 'Speak'} className={cx('press relative grid h-11 w-11 flex-none place-items-center rounded-full', listening ? 'bg-bad text-white' : 'bg-maroon text-white hover:bg-maroon-dark')}>
              {listening && <span className="absolute inset-0 animate-ping rounded-full bg-bad/40" />}
              <Icon name="mic" size={22} stroke={2} />
            </button>
            <label className="min-w-0 flex-1"><span className="sr-only">Ask the assistant</span>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? 'Listening…' : 'Ask or tap the mic'} className="min-h-[46px] w-full rounded-xl border border-line2 bg-surface px-4 text-[14.5px] outline-none transition focus:border-maroon focus:ring-[3px] focus:ring-maroon/12" />
            </label>
            <button type="submit" disabled={!input.trim() || busy} aria-label="Send" className="press grid h-11 w-11 flex-none place-items-center rounded-xl bg-ink text-white disabled:opacity-35"><Icon name="send" /></button>
          </form>
        </section>
      )}
    </>
  )
}

function ResultCard({ tool, result: r }) {
  const box = 'fade-in rounded-xl border border-line bg-surface p-3 text-[13.5px] shadow-card'
  const link = r.link && <a href={r.link.startsWith('#') ? r.link : '#' + r.link} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-maroon">Open<Icon name="chev" size={14} /></a>
  if (tool === 'next_trains') return (
    <div className={box}>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted"><Icon name="train" size={14} />{r.from}{r.to ? ` → ${r.to}` : ''}</p>
      <ul className="flex flex-col gap-1">{r.trains.map((t, i) => <li key={i} className="flex items-baseline gap-2"><b className="w-[66px] flex-none">{t.departs}</b><span className="min-w-0 flex-1 truncate">{t.towards} <span className="text-muted">· {t.type}</span></span>{t.arrives && <span className="text-xs text-muted">{t.arrives}</span>}</li>)}</ul>
      {link}
    </div>
  )
  if (tool === 'plan_journey') { const o = r.options?.[0]; return o ? (
    <div className={box}>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted"><Icon name="train" size={14} />{r.from} → {r.to}</p>
      <ol className="flex flex-col gap-1">{o.legs.map((l, i) => <li key={i}><b className="font-semibold">{l.ride}</b> <span className="text-muted">· {l.line}</span>{Array.isArray(l.nextTrains) && <span className="block text-xs text-muted">Next: {l.nextTrains.slice(0, 2).join(' · ')}</span>}</li>)}</ol>
      {o.lastLeg && <p className="mt-1 text-xs text-muted">{o.lastLeg}</p>}{link}
    </div>) : null }
  if (tool === 'campus_info') { const a = r.results?.[0]; return a ? <div className={box}><b className="font-semibold">{a.title}</b><p className="mt-0.5 text-[11.5px] text-muted">Source: {a.source}</p></div> : null }
  if (tool === 'buses_near_campus') return (
    <div className={box}>
      {r.stops.slice(0, 2).map((s) => <div key={s.stop} className="mb-1.5"><p className="text-xs font-semibold uppercase tracking-wider text-muted">{s.stop}</p>{s.routes.slice(0, 4).map((x) => <p key={x.route} className="flex gap-2"><b className="w-[64px] flex-none text-[#B4232A]">{x.route}</b><span className="min-w-0 truncate">{x.between}</span></p>)}</div>)}
      <p className="text-[11px] text-muted">Estimates — check Chalo for live buses.</p>{link}
    </div>
  )
  if (tool === 'my_schedule') return (
    <div className={box}>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{r.day}</p>
      {r.lectures.length ? <ul className="flex flex-col gap-1">{r.lectures.map((l, i) => <li key={i} className={cx('flex gap-2', l.status === 'over' && 'opacity-50')}><b className="w-[70px] flex-none">{l.time.split('–')[0]}</b><span className="min-w-0 flex-1"><span className="block truncate">{l.title}</span><a href={l.link} className="text-xs text-maroon">{l.room} · {l.floor}</a></span></li>)}</ul> : <p>No lectures.</p>}
    </div>
  )
  if (tool === 'my_deadlines') return (
    <div className={box}>
      {r.pending.length ? <ul className="flex flex-col gap-1.5">{r.pending.slice(0, 4).map((d) => <li key={d.id}><b className="block leading-snug">{d.title}</b><span className={cx('text-xs', /overdue/.test(d.status) ? 'text-bad' : 'text-muted')}>{d.subject} · {d.status}</span></li>)}</ul> : <p>All done.</p>}
      <a href="#/" className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-maroon">Dashboard<Icon name="chev" size={14} /></a>
    </div>
  )
  if (tool === 'find_place') { const a = r.matches?.[0]; return a ? <div className={box}><b>{a.name}</b><p className="text-muted">{a.floor} · {a.wing}{a.walk ? ` · ${a.walk}` : ''}</p><a href={a.link} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-maroon">Show in 3D<Icon name="chev" size={14} /></a></div> : null }
  if (tool === 'campus_route') return <div className={box}><b>{r.time}</b> · <span className="text-muted">{r.summary}</span><ol className="mt-1 list-decimal pl-5">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>{link}</div>
  if (tool === 'my_events') return <div className={box}>{r.events.slice(0, 4).map((e) => <p key={e.id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{e.title}</span><span className="flex-none text-xs text-muted">{e.registered ? 'Registered' : e.status}</span></p>)}{link}</div>
  if (tool === 'my_rides') return <div className={box}>{r.ridesWithSeats.slice(0, 3).map((x) => <p key={x.id} className="truncate">{x.driver}: {x.from} → {x.to} <span className="text-muted">· {x.leaves} · {x.seatsLeft} left</span></p>)}{!r.ridesWithSeats.length && <p>No rides with free seats.</p>}{link}</div>
  return null
}
