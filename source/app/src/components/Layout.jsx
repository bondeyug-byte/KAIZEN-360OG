import ErrorBoundary from './ErrorBoundary.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { searchAll } from '../lib/search.js'
import { unreadCount } from '../lib/notifications.js'
import Icon from './Icon.jsx'
import { cx, Badge } from './ui.jsx'
import { useApp } from '../store/AppContext.jsx'
import { NotificationBell } from './Notifications.jsx'
import { canAccess, roleOf, ROLE_LABEL } from '../lib/roles.js'

export const NAV_GROUPS = [
  { label: 'Workspace', items: [
    { path: '/', label: 'Overview', icon: 'grid', keywords: 'dashboard home timetable deadlines' },
    { path: '/navigator', label: '3D Campus Explorer', icon: 'cube', keywords: 'map navigator rooms route' },
    { path: '/classwork', label: 'Classwork', icon: 'book', keywords: 'assignments notices documents lecture', student: true },
    { path: '/attendance', label: 'Attendance', icon: 'check', keywords: 'attendance percentage present absent', student: true },
    { path: '/planner', label: 'Academics', icon: 'layers', keywords: 'planner marks sgpa grades' },
    { path: '/events', label: 'Events & Activities', icon: 'calendar', keywords: 'events register' },
    { path: '/commute', label: 'Trains & buses', icon: 'train', keywords: 'commute local train bus journey' },
    { path: '/canteen', label: 'Canteens', icon: 'cup', keywords: 'canteen food menu price vesit vesim' },
  ] },
  { label: 'Community', items: [
    { path: '/rides', label: 'Rides', icon: 'car', keywords: 'ride share carpool map' },
    { path: '/challenges', label: 'Challenges', icon: 'trophy', keywords: 'leaderboard points' },
    { path: '/peer', label: 'Peer learning', icon: 'swap', keywords: 'tutor credits skills' },
    { path: '/notes', label: 'Notes library', icon: 'file', keywords: 'notes study material pdf' },
    { path: '/directory', label: 'Who do I contact?', icon: 'contact', keywords: 'faculty seniors directory' },
  ] },
  { label: 'Personal', items: [
    { path: '/notifications', label: 'Announcements', icon: 'megaphone', keywords: 'notifications alerts', badge: 'unread' },
    { path: '/profile', label: 'My Profile', icon: 'user', keywords: 'profile account' },
  ] },
]
export const NAV = [...NAV_GROUPS.flatMap((g) => g.items), { path: '/about', label: 'About Campus360', keywords: 'about data sources' }]
const ADMIN_GROUP = { label: 'Admin', items: [{ path: '/admin', label: 'Admin', icon: 'lock', keywords: 'admin teachers allowlist' }, { path: '/teacher', label: 'Send to classes', icon: 'send', keywords: 'notice' }] }
const PERSONAL = { label: 'Personal', items: [
  { path: '/notifications', label: 'Announcements', icon: 'megaphone', keywords: 'notifications alerts', badge: 'unread' },
  { path: '/profile', label: 'My Profile', icon: 'user', keywords: 'profile account' },
] }
/** Each role gets its own navigation; the route guard in App.jsx enforces the same lists. */
const ROLE_NAV = {
  teacher: [
    { label: 'Teaching', items: [
      { path: '/', label: 'Teacher portal', icon: 'shield', keywords: 'teacher send assignment attendance classes' },
      { path: '/challenges', label: 'Challenges', icon: 'trophy', keywords: 'create edit delete review solutions' },
      { path: '/notes', label: 'Notes library', icon: 'file', keywords: 'notes requests study material' },
    ] },
    { label: 'Campus', items: [
      { path: '/navigator', label: '3D Campus Explorer', icon: 'cube', keywords: 'map navigator rooms route' },
      { path: '/commute', label: 'Trains & buses', icon: 'train', keywords: 'commute local train bus journey' },
      { path: '/canteen', label: 'Canteens', icon: 'cup', keywords: 'canteen food menu price' },
    ] },
    PERSONAL,
  ],
  organiser: [
    { label: 'Council / Club', items: [
      { path: '/', label: 'Event desk', icon: 'shield', keywords: 'council club desk requests chat publish' },
      { path: '/events', label: 'Upcoming events', icon: 'calendar', keywords: 'events ongoing upcoming' },
    ] },
    PERSONAL,
  ],
}
const MOBILE_BY_ROLE = {
  student: [{ path: '/', label: 'Home', icon: 'grid' }, { path: '/planner', label: 'Academics', icon: 'book' }, { path: '/navigator', label: '3D map', icon: 'cube' }, { path: '/commute', label: 'Trains', icon: 'train' }],
  teacher: [{ path: '/', label: 'Portal', icon: 'shield' }, { path: '/challenges', label: 'Challenges', icon: 'trophy' }, { path: '/notes', label: 'Notes', icon: 'file' }, { path: '/navigator', label: '3D map', icon: 'cube' }],
  organiser: [{ path: '/', label: 'Desk', icon: 'shield' }, { path: '/events', label: 'Events', icon: 'calendar' }, { path: '/notifications', label: 'Alerts', icon: 'megaphone' }, { path: '/profile', label: 'Profile', icon: 'user' }],
  admin: [{ path: '/', label: 'Admin', icon: 'lock' }, { path: '/teacher', label: 'Send', icon: 'send' }, { path: '/navigator', label: '3D map', icon: 'cube' }, { path: '/canteen', label: 'Canteens', icon: 'cup' }],
}

/** Compass mark + wordmark + tagline (from the team's reference design). */
export function Brand({ light, compact }) {
  return (
    <a href="#/" className="group flex items-center gap-2.5 rounded-lg" aria-label="Campus360 home">
      <span className={cx('grid h-10 w-10 flex-none place-items-center rounded-xl transition-transform group-hover:rotate-[-8deg]', light ? 'bg-white/15 ring-1 ring-white/40' : 'bg-brand-deep shadow-[0_2px_6px_rgba(18,53,40,.35)]')} aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={light ? '#fff' : '#D6F07A'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z" fill={light ? 'rgba(255,255,255,.25)' : 'rgba(214,240,122,.25)'} /><path d="M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21" opacity=".6" /></svg>
      </span>
      {!compact && <span className="leading-none">
        <b className={cx('block font-display text-[19px] font-bold tracking-tight', light ? 'text-white' : 'text-ink')}>Campus360</b>
        <small className={cx('mt-1 block whitespace-nowrap text-[9px] font-bold uppercase tracking-[.11em]', light ? 'text-white/75' : 'text-brand')}>Your campus, connected</small>
      </span>}
    </a>
  )
}

const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?'

export default function Layout({ route, children, full }) {
  const { me, db, session, signOut, signedIn } = useApp()
  const [more, setMore] = useState(false)
  const [menu, setMenu] = useState(false)
  useEffect(() => { if (!more && !menu) return; const k = (e) => e.key === 'Escape' && (setMore(false), setMenu(false)); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [more, menu])
  const r = signedIn ? roleOf(me) : 'student'
  const base = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !(i.student && r === 'admin')) }))
  const raw = ROLE_NAV[r] || (r === 'admin' ? [ADMIN_GROUP, ...base] : base)
  const groups = signedIn ? raw.map((g) => ({ ...g, items: g.items.filter((i) => canAccess(me, i.path)) })).filter((g) => g.items.length) : raw
  const MOBILE = (MOBILE_BY_ROLE[r] || MOBILE_BY_ROLE.student).filter((i) => !signedIn || canAccess(me, i.path))
  const active = (p) => (p === '/' ? route === '/' : route.startsWith(p))
  const unread = signedIn ? unreadCount(db.shared, session.userId) : 0
  const pages = [...groups.flatMap((g) => g.items), ...NAV.slice(-1)]
  const role = r !== 'student' ? ROLE_LABEL[r] : me?.division ? `${me.division} · ${session.mode === 'demo' ? 'Demo' : 'Verified'}` : 'Student profile'
  const navLink = (n) => (
    <a key={n.path} href={'#' + n.path} aria-current={active(n.path) ? 'page' : undefined}
      className={cx('press group relative flex min-h-[40px] items-center gap-3 rounded-xl px-3 text-[14px]', active(n.path) ? 'bg-white font-semibold text-ink shadow-card' : 'font-medium text-[#33443B] hover:bg-white/60')}>
      <span className={cx('nav-ind absolute -left-[13px] top-2 h-[calc(100%-16px)] w-[3px] rounded-r-full bg-[#9CC66B]', active(n.path) ? 'opacity-100' : 'scale-y-0 opacity-0')} />
      <Icon name={n.icon} size={18} className={active(n.path) ? 'text-brand' : 'text-[#5C6E64] group-hover:text-ink'} /><span className="flex-1">{n.label}</span>
      {n.badge === 'unread' && unread > 0 && <span className="rounded-md bg-lime px-1.5 py-0.5 text-[11px] font-bold text-lime-ink">{unread}</span>}
    </a>
  )
  return (
    <div data-app-shell className="app-bg flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[268px] flex-none p-3 lg:block">
        <div className="glass flex h-full flex-col rounded-[22px] px-3 pb-3 pt-4 shadow-glass">
          <div className="flex items-center justify-between gap-2 px-2"><Brand /></div>
          <nav aria-label="Main" className="mt-5 flex flex-1 flex-col gap-4 overflow-y-auto pl-3 pr-0.5">
            {groups.map((g) => (
              <div key={g.label} className="flex flex-none flex-col gap-0.5">
                <p className="px-3 pb-1 text-[10.5px] font-bold uppercase tracking-[.12em] text-[#7B8C82]">{g.label}</p>
                {g.items.map(navLink)}
              </div>
            ))}
            {(!signedIn || canAccess(me, '/navigator')) && <a href="#/navigator" className="relative mt-1 flex-none overflow-hidden rounded-2xl bg-brand-deep p-4 text-white shadow-glass">
              <span aria-hidden="true" className="absolute -right-6 -top-6 h-24 w-24 rounded-full border border-white/25" /><span aria-hidden="true" className="absolute -right-2 -top-2 h-16 w-16 rounded-full border border-white/20" />
              <small className="text-[10px] font-bold uppercase tracking-[.14em] text-lime">Your first year</small>
              <b className="mt-1.5 block font-display text-[17px] leading-tight">Find your place on campus.</b>
              <span className="mt-1 block text-[12px] text-white/75">Every room, lift and staircase in 3D.</span>
              <span className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/35 px-2.5 py-1.5 text-[12px] font-semibold">Explore campus <Icon name="arrowUR" size={13} /></span>
            </a>}
            <div className="flex flex-none gap-1 px-1 text-[12px] font-medium text-muted"><a href="#/about" className="rounded-md px-2 py-1 hover:bg-white/60 hover:text-ink">About</a><a href="#/welcome" className="rounded-md px-2 py-1 hover:bg-white/60 hover:text-ink">Landing page</a></div>
          </nav>
          <div className="mt-2 border-t border-line pt-3">
            {signedIn ? (
              <div className="flex items-center gap-2.5 rounded-xl p-1.5">
                <a href="#/profile" aria-label="Your profile" className="press grid h-10 w-10 flex-none place-items-center rounded-xl bg-lime-soft text-[13px] font-bold text-brand">{initials(me?.name)}</a>
                <a href="#/profile" className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[13.5px] font-semibold">{me?.name || 'New student'}</b><small className="block truncate text-xs text-muted">{role}</small></a>
                <button onClick={() => signOut()} aria-label="Sign out" title="Sign out" className="press grid h-8 w-8 flex-none place-items-center rounded-lg text-muted hover:bg-white hover:text-bad"><Icon name="logout" size={17} /></button>
              </div>
            ) : <a href="#/login" className="press flex min-h-[42px] items-center justify-center rounded-xl bg-brand text-[14px] font-semibold text-white hover:bg-brand-dark">Sign in</a>}
          </div>
        </div>
      </aside>

      <div className={cx('flex min-w-0 flex-1 flex-col', full && 'lg:h-screen')}>
        <header className="glass sticky top-0 z-30 flex items-center justify-between gap-2 border-x-0 border-t-0 px-3 py-2 lg:hidden">
          <Brand compact />
          <span className="flex items-center gap-1">
            <GlobalSearch pages={pages} compact />
            <button type="button" onClick={() => window.dispatchEvent(new Event('campus360:assistant'))} aria-label="Open voice assistant" className="press grid h-9 w-9 place-items-center rounded-xl bg-maroon text-white"><Icon name="mic" size={17} /></button>
            {signedIn ? <><NotificationBell /><a href="#/profile" className="press grid h-9 w-9 place-items-center rounded-xl bg-lime-soft text-[13px] font-bold text-brand" aria-label="Profile">{initials(me?.name)}</a></> : <a href="#/login" className="press rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white">Sign in</a>}
          </span>
        </header>
        {(
          <div className="sticky top-0 z-30 hidden h-16 items-center gap-3 px-6 lg:flex xl:px-8">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-muted"><span className="text-[#8A9A90]">Campus360 /</span> <span className="font-semibold text-ink">{pages.find((n) => active(n.path))?.label || ''}</span></span>
            <GlobalSearch pages={pages} />
            {signedIn ? <>
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-deep text-white shadow-glass"><NotificationBell className="!text-white hover:!bg-white/10" /></span>
              <div className="relative">
                <button onClick={() => setMenu(!menu)} aria-expanded={menu} aria-haspopup="menu" className="press flex h-11 items-center gap-2.5 rounded-xl bg-brand-deep py-1 pl-1.5 pr-3 text-left text-white shadow-glass">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-lime text-[12px] font-bold text-lime-ink">{initials(me?.name)}</span>
                  <span className="hidden max-w-[150px] leading-tight xl:block"><b className="block truncate text-[13px]">{me?.name || 'Profile'}</b><small className="block truncate text-[11px] text-white/70">{role}</small></span>
                  <Icon name="chevDown" size={16} className="text-white/80" />
                </button>
                {menu && <><div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
                  <div role="menu" className="slide-down absolute right-0 z-50 mt-2 w-52 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
                    <a role="menuitem" href="#/profile" onClick={() => setMenu(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] hover:bg-ground"><Icon name="user" size={16} />My profile</a>
                    <a role="menuitem" href="#/notifications" onClick={() => setMenu(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] hover:bg-ground"><Icon name="megaphone" size={16} />Announcements</a>
                    <button role="menuitem" onClick={() => { setMenu(false); signOut() }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[14px] text-bad hover:bg-ground"><Icon name="logout" size={16} />Sign out</button>
                  </div></>}
              </div>
            </> : <a href="#/login" className="press rounded-xl bg-brand px-4 py-2.5 text-[13px] font-semibold text-white">Sign in</a>}
          </div>
        )}
        {session.mode === 'demo' && (
          <div className="mx-3 mt-2 flex items-center justify-center gap-2 rounded-xl border border-[#E1DAF0] bg-[#F7F4FC]/90 px-4 py-1.5 text-center text-[12.5px] text-[#4E3570] lg:mx-6 xl:mx-8">
            <Badge tone="demo">Demo</Badge><span>Simulated {ROLE_LABEL[r]} sign-in · no OTP<span className="hidden sm:inline"> · permissions are checked in this app only; production needs server-side enforcement</span></span>
          </div>
        )}
        <main className={cx('flex-1', full ? 'min-h-0' : 'mx-auto w-full max-w-[1240px] px-4 py-5 pb-28 sm:px-6 lg:px-6 lg:pb-12 xl:px-8')}>
          <div key={route} className={full ? 'h-full' : 'page-in'}><ErrorBoundary resetKey={route}>{children}</ErrorBoundary></div>
        </main>
      </div>

      <nav aria-label="Main" className="glass fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {MOBILE.map((n) => (
          <a key={n.path} href={'#' + n.path} aria-current={active(n.path) ? 'page' : undefined} className={cx('press relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-semibold', active(n.path) ? 'text-brand' : 'text-muted')}>
            <span className={cx('nav-ind absolute top-0 h-[3px] w-8 rounded-b-full bg-brand', active(n.path) ? 'opacity-100' : 'scale-x-0 opacity-0')} />
            <Icon name={n.icon} size={21} />{n.label}
          </a>
        ))}
        <button onClick={() => setMore(true)} aria-expanded={more} className="press flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted"><Icon name="menu" size={21} />More</button>
      </nav>
      {more && (
        <div className="fade-in fixed inset-0 z-50 flex items-end bg-[#12261C]/40 backdrop-blur-[2px] lg:hidden" onClick={() => setMore(false)}>
          <nav aria-label="All sections" className="sheet-in max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 pb-8 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <span className="mx-auto mb-4 block h-1 w-10 rounded-full bg-line2" />
            {groups.map((g) => (
              <div key={g.label} className="mb-3">
                <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[.12em] text-[#7B8C82]">{g.label}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {g.items.map((n) => (
                    <a key={n.path} href={'#' + n.path} onClick={() => setMore(false)} className={cx('press flex min-h-[46px] items-center gap-2 rounded-xl border px-3 text-[14px] font-medium', active(n.path) ? 'border-brand/30 bg-brand-50 text-brand' : 'border-line')}>
                      <Icon name={n.icon} size={18} /><span className="flex-1">{n.label}</span>{n.badge === 'unread' && unread > 0 && <span className="rounded-md bg-lime px-1.5 text-[11px] font-bold text-lime-ink">{unread}</span>}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <a href="#/about" onClick={() => setMore(false)} className="press flex min-h-[46px] items-center gap-2 rounded-xl border border-line px-3 text-[14px] font-medium"><Icon name="spark" size={18} />About</a>
              <a href="#/welcome" onClick={() => setMore(false)} className="press flex min-h-[46px] items-center gap-2 rounded-xl border border-line px-3 text-[14px] font-medium"><Icon name="home" size={18} />Landing page</a>
              {signedIn && <button onClick={() => { setMore(false); signOut() }} className="press flex min-h-[46px] items-center gap-2 rounded-xl border border-line px-3 text-[14px] font-medium text-bad"><Icon name="logout" size={18} />Sign out</button>}
            </div>
          </nav>
        </div>
      )}
    </div>
  )
}

/** Top-bar search: rooms, events, challenges, contacts, stations and pages from the app's real data. */
function GlobalSearch({ pages, compact }) {
  const { db, me } = useApp()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const [mobileOpen, setMobileOpen] = useState(false)
  const input = useRef(null)
  const results = useMemo(() => searchAll(q, { db, me, pages }), [q, db, me, pages])
  useEffect(() => setI(0), [q])
  const go = (r) => { if (!r) return; setQ(''); setOpen(false); setMobileOpen(false); window.location.hash = r.href.replace(/^#/, '') }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(results.length - 1, x + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[i]) }
    else if (e.key === 'Escape') { setOpen(false); setMobileOpen(false) }
  }
  useEffect(() => { const k = (e) => { if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); compact ? setMobileOpen(true) : input.current?.focus() } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [compact])
  const box = (
    <div className="relative w-full">
      <Icon name="search" size={17} className={cx('pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2', compact ? 'text-muted' : 'text-white/70')} />
      <input ref={input} autoFocus={compact} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey}
        role="combobox" aria-expanded={open && results.length > 0} aria-controls="gsearch-list" aria-activedescendant={results[i] ? `gs-${i}` : undefined} aria-label="Search campus, events, challenges, people"
        placeholder="Search campus, rooms, events…" className={cx('h-11 w-full rounded-xl pl-10 pr-10 text-[14px] outline-none', compact ? 'border border-line2 bg-surface text-ink' : 'bg-brand-deep text-white shadow-glass placeholder:text-white/60 focus:ring-2 focus:ring-lime/60')} />
      {!compact && <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-white/25 px-1.5 text-[11px] text-white/60">/</kbd>}
      {open && q.trim().length >= 2 && (
        <ul id="gsearch-list" role="listbox" className="slide-down absolute left-0 right-0 z-50 mt-2 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          {results.length ? results.map((r, k) => (
            <li key={r.kind + r.href + k} id={`gs-${k}`} role="option" aria-selected={k === i} onMouseDown={(e) => { e.preventDefault(); go(r) }} onMouseEnter={() => setI(k)}
              className={cx('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2', k === i && 'bg-brand-50')}>
              <span className="w-[72px] flex-none text-[10.5px] font-bold uppercase tracking-wider text-brand">{r.kind}</span>
              <span className="min-w-0 flex-1"><b className="block truncate text-[14px] font-semibold text-ink">{r.title}</b><small className="block truncate text-[12px] text-muted">{r.sub}</small></span>
            </li>
          )) : <li className="px-3 py-3 text-[13.5px] text-muted">No matches for “{q.trim()}”. Try a room number, lab, event or station.</li>}
        </ul>
      )}
    </div>
  )
  if (!compact) return <div className="w-full max-w-[460px]">{box}</div>
  return (
    <>
      <button onClick={() => setMobileOpen(true)} aria-label="Search" className="press grid h-9 w-9 place-items-center rounded-lg text-[#33443B] hover:bg-white/60"><Icon name="search" size={19} /></button>
      {mobileOpen && createPortal(
        <div className="fade-in fixed inset-0 z-[70] bg-[#12261C]/40 p-3" onMouseDown={(e) => e.target === e.currentTarget && setMobileOpen(false)}>
          <div className="slide-down rounded-2xl bg-surface p-3 shadow-pop">{box}<button onClick={() => setMobileOpen(false)} className="mt-2 w-full rounded-lg py-2 text-[13px] font-semibold text-muted">Close</button></div>
        </div>, document.body)}
    </>
  )
}
