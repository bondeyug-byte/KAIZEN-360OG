// Browser speech: recognition (Web Speech API, best in Chrome/Edge) and text-to-speech.
export const LANGS = [
  { id: 'en', label: 'English', rec: 'en-IN', tts: ['en-IN', 'en-GB', 'en'] },
  { id: 'hl', label: 'Hinglish', rec: 'en-IN', tts: ['en-IN', 'hi-IN', 'en'] },
  { id: 'hi', label: 'हिंदी', rec: 'hi-IN', tts: ['hi-IN'] },
  { id: 'mr', label: 'मराठी', rec: 'mr-IN', tts: ['mr-IN', 'hi-IN'] },
]
export const langInfo = (id) => LANGS.find((l) => l.id === id) || LANGS[0]

const Rec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
export const canListen = !!Rec
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

/** Start one listening session. Returns a stop function. */
export function listen(lang, { onInterim, onFinal, onError, onEnd }) {
  if (!Rec) { onError?.('unsupported'); return () => {} }
  const r = new Rec()
  r.lang = langInfo(lang).rec
  r.interimResults = true
  r.continuous = false
  r.maxAlternatives = 1
  let final = ''
  r.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) final += t
      else interim += t
    }
    onInterim?.(final + interim)
  }
  r.onerror = (e) => onError?.(e.error)
  r.onend = () => { if (final.trim()) onFinal?.(final.trim()); onEnd?.() }
  try { r.start() } catch { onError?.('busy') }
  return () => { try { r.stop() } catch { /* already stopped */ } }
}

let voices = []
if (canSpeak) {
  const load = () => { voices = window.speechSynthesis.getVoices() }
  load()
  window.speechSynthesis.onvoiceschanged = load
}
export function speak(text, lang, onEnd) {
  if (!canSpeak || !text) { onEnd?.(); return }
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''))
  const prefs = langInfo(lang).tts
  let v = null
  for (const p of prefs) { v = voices.find((x) => x.lang?.toLowerCase().replace('_', '-').startsWith(p.toLowerCase())); if (v) break }
  if (v) { u.voice = v; u.lang = v.lang } else u.lang = prefs[0]
  u.rate = 1.03
  u.onend = () => onEnd?.()
  u.onerror = () => onEnd?.()
  window.speechSynthesis.speak(u)
}
export const stopSpeaking = () => canSpeak && window.speechSynthesis.cancel()
