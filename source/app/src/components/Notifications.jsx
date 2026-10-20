import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../store/AppContext.jsx'
import Icon from './Icon.jsx'
import { cx, relTime, Segmented, PageHeader, Card } from './ui.jsx'
import { notificationsFor, unreadCount, CATEGORY } from '../lib/notifications.js'

const CAT_ICON = { event: 'calendar', deadline: 'clock', challenge: 'trophy', classwork: 'book', attendance: 'check', ride: 'car', peer: 'swap', notes: 'file' }

/** Bell with unread count; opens the notification centre. Same records drive the count, the list and the links. */
export function NotificationBell({ className = '' }) {
  const { db, session, signedIn } = useApp()
  const [open, setOpen] = useState(false)
  const btn = useRef(null)
  if (!signedIn) return null
  const n = unreadCount(db.shared, session.userId)
  return (
    <>
      <button ref={btn} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-label={n ? `Notifications, ${n} unread` : 'Notifications'}
        className={cx('press relative grid h-9 w-9 flex-none place-items-center rounded-lg text-[#3B4048] hover:bg-sand hover:text-ink', className)}>
        <Icon name="bell" size={19} />
        {n > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-maroon px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-surface">{n > 99 ? '99+' : n}</span>}
      </button>
      {open && createPortal(<NotificationPanel onClose={() => { setOpen(false); btn.current?.focus() }} />, document.body)}
    </>
  )
}

function NotificationPanel({ onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    const t = setTimeout(() => ref.current?.querySelector('button')?.focus(), 30)
    return () => { window.removeEventListener('keydown', k); clearTimeout(t) }
  }, [onClose])
  return (
    <div className="fade-in fixed inset-0 z-[60] bg-[#1F2329]/25 lg:bg-transparent" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section ref={ref} role="dialog" aria-modal="true" aria-label="Notifications"
        className="sheet-in absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border border-line bg-surface shadow-pop lg:inset-x-auto lg:bottom-auto lg:right-5 lg:top-14 lg:max-h-[75vh] lg:w-[400px] lg:rounded-2xl">
        <NotificationBody onClose={onClose} />
        <p className="border-t border-line px-4 py-2 text-[11.5px] text-muted">Stored in this browser. Other devices won't see these until a shared backend is connected.</p>
      </section>
    </div>
  )
}

function NotificationBody({ onClose, page }) {
  const { db, session, now, markNotificationsRead, markAllNotificationsRead } = useApp()
  const [view, setView] = useState('all')
  const all = notificationsFor(db.shared, session.userId)
  const unread = all.filter((x) => !x.read).length
  const list = view === 'unread' ? all.filter((x) => !x.read) : all
  const open = (x) => { markNotificationsRead([x.id]); onClose?.(); if (x.href) window.location.hash = x.href.replace(/^#/, '') }
  return (
    <>
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          {page ? <span /> : <h2 className="font-display text-[17px] font-semibold">Notifications</h2>}
          <div className="flex items-center gap-1">
            <button onClick={markAllNotificationsRead} disabled={!unread} className="press min-h-[34px] rounded-lg px-2.5 text-[12.5px] font-semibold text-maroon hover:bg-maroon-50 disabled:text-muted disabled:hover:bg-transparent">Mark all as read</button>
            {!page && <button onClick={onClose} aria-label="Close notifications" className="press grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sand hover:text-ink"><Icon name="x" size={18} /></button>}
          </div>
        </header>
        <div className="px-4 pt-3"><Segmented label="Show" value={view} onChange={setView} options={[{ value: 'all', label: `All (${all.length})` }, { value: 'unread', label: `Unread (${unread})` }]} /></div>
        <ul className="flex-1 overflow-y-auto px-2 py-2" aria-live="polite">
          {list.length ? list.map((x) => (
            <li key={x.id} className={cx('group relative flex gap-3 rounded-xl px-2.5 py-2.5', !x.read && 'bg-maroon-50/60')}>
              <span className={cx('mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-lg ring-1', x.read ? 'bg-ground text-muted ring-line' : 'bg-surface text-maroon ring-maroon/15')}><Icon name={CAT_ICON[x.category] || 'bell'} size={17} /></span>
              <button onClick={() => open(x)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{CATEGORY[x.category] || 'Update'} · {relTime(x.at, now)}{!x.read && <span className="h-1.5 w-1.5 rounded-full bg-maroon" aria-label="unread" />}</span>
                <b className={cx('mt-0.5 block text-[14px] leading-snug', x.read ? 'font-medium' : 'font-semibold')}>{x.title}</b>
                {x.body && <span className="mt-0.5 block break-words text-[13px] leading-snug text-muted">{x.body}</span>}
                {x.href && <span className="mt-1 inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-maroon">Open<Icon name="chev" size={13} /></span>}
              </button>
              {!x.read && <button onClick={() => markNotificationsRead([x.id])} aria-label={`Mark "${x.title}" as read`} title="Mark as read" className="press grid h-8 w-8 flex-none place-items-center self-start rounded-lg text-muted hover:bg-surface hover:text-ok"><Icon name="check" size={16} /></button>}
            </li>
          )) : (
            <li className="flex flex-col items-center px-6 py-12 text-center">
              <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-ground text-muted"><Icon name="bell" size={22} /></span>
              <b className="text-[15px]">{view === 'unread' ? 'No unread notifications' : 'No notifications yet'}</b>
              <p className="mt-1 text-[13px] text-muted">Event decisions, new events, deadline reminders and challenge reviews show up here.</p>
            </li>
          )}
        </ul>
    </>
  )
}

/** Announcements page: the same notification records as the bell, full width. */
export function NotificationsPage() {
  return (
    <div>
      <PageHeader back title="Announcements" subtitle="Event decisions, new events, deadline reminders and challenge reviews. Stored in this browser until the shared database is connected." />
      <Card className="!p-0"><NotificationBody page /></Card>
    </div>
  )
}
