import { useEffect, useRef, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Button, Badge, relTime, cx, inputCls } from './ui.jsx'
import { messagesIn, sendEventMessage, MSG_MAX } from '../lib/events.js'

/**
 * One conversation between a student and an event's organisers. Messages are plain text rendered by React
 * (escaped — never inserted as HTML). Demo: stored in this browser only; a real chat needs a backend.
 */
export default function EventChat({ ev, studentId, studentName }) {
  const { db, me, now, runShared } = useApp()
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const list = messagesIn(db.shared, ev.id, studentId)
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [list.length])
  const send = (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    const r = runShared((s) => sendEventMessage(s, { eventId: ev.id, studentId, text }, me, new Date()))
    setBusy(false)
    if (r.ok) { setText(''); setErr('') } else setErr(r.error)
  }
  const left = MSG_MAX - text.length
  return (
    <section aria-label={`Chat about ${ev.title}`} className="flex min-h-[320px] flex-col rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[14.5px]">{ev.title}</b><small className="text-[12px] text-muted">{me.id === studentId ? `With ${ev.organiserName || 'the organisers'}` : `With ${studentName || 'student'}`}</small></span>
        <Badge tone="demo">Simulated chat · this browser only</Badge>
      </header>
      <ol className="flex max-h-[46vh] min-h-[180px] flex-1 flex-col gap-2 overflow-y-auto px-3 py-3" aria-live="polite">
        {list.length ? list.map((m) => {
          const mine = m.fromId === me.id
          return (
            <li key={m.id} className={cx('max-w-[85%] rounded-2xl px-3 py-2 text-[14px]', mine ? 'self-end rounded-br-md bg-brand text-white' : 'self-start rounded-bl-md bg-ground')}>
              <p className={cx('text-[11.5px] font-semibold', mine ? 'text-white/80' : 'text-muted')}>{mine ? 'You' : m.fromName}{m.fromRole === 'organiser' && !mine ? ' · organiser' : ''}</p>
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              <p className={cx('mt-0.5 text-[11px]', mine ? 'text-white/70' : 'text-muted')}>{relTime(m.at, now)}</p>
            </li>)
        }) : <li className="m-auto max-w-xs text-center text-[13.5px] text-muted">No messages yet. {me.id === studentId ? 'Ask the organisers anything about this event.' : ''}</li>}
        <li ref={end} aria-hidden="true" />
      </ol>
      <form onSubmit={send} noValidate className="flex flex-col gap-1.5 border-t border-line p-2.5">
        <div className="flex items-end gap-2">
          <label htmlFor={`msg-${ev.id}-${studentId}`} className="sr-only">Message</label>
          <textarea id={`msg-${ev.id}-${studentId}`} rows={1} maxLength={MSG_MAX} value={text} onChange={(e) => { setText(e.target.value); if (err) setErr('') }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e) } }}
            placeholder="Write a message…" className={cx(inputCls, 'min-h-[44px] flex-1 resize-none py-2.5')} />
          <Button type="submit" icon="send" disabled={!text.trim() || busy}>Send</Button>
        </div>
        <div className="flex justify-between text-[11.5px] text-muted"><span role={err ? 'alert' : undefined} className={err ? 'font-medium text-bad' : ''}>{err || 'Enter to send · Shift+Enter for a new line'}</span><span>{left < 100 ? `${left} left` : ''}</span></div>
      </form>
    </section>
  )
}
