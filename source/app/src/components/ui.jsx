import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon.jsx'

export const cx = (...c) => c.filter(Boolean).join(' ')

export function Button({ variant = 'primary', size = 'md', className = '', children, icon, ...p }) {
  const v = {
    primary: 'bg-maroon text-white border-maroon hover:bg-maroon-dark shadow-[0_1px_2px_rgba(18,53,40,.3)]',
    secondary: 'bg-surface text-ink border-line2 hover:bg-ground hover:border-[#CFC6BE]',
    ghost: 'bg-transparent text-maroon border-transparent hover:bg-maroon-50',
    danger: 'bg-surface text-bad border-[#EBC4BE] hover:bg-[#FDF1EF]',
    blue: 'bg-route text-white border-route hover:bg-[#1D47A6]',
  }[variant]
  const s = { sm: 'min-h-[34px] px-3 text-[13px] gap-1.5', md: 'min-h-[40px] px-4 text-[14px] gap-2', lg: 'min-h-[46px] px-5 text-[15px] gap-2' }[size]
  return (
    <button {...p} className={cx('press inline-flex items-center justify-center rounded-lg border font-semibold disabled:cursor-not-allowed disabled:opacity-45', v, s, className)}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}{children}
    </button>
  )
}

export function Card({ className = '', children, as: Tag = 'section', interactive, ...p }) {
  return <Tag {...p} className={cx('rounded-xl border border-line bg-surface p-4 sm:p-5', interactive && 'lift', className)}>{children}</Tag>
}

export function CardTitle({ children, action, eyebrow }) {
  return (
    <div className="mb-3.5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[.08em] text-muted">{eyebrow}</p>}
        <h2 className="font-display text-[17px] font-semibold leading-snug text-ink">{children}</h2>
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  )
}

const BADGE = {
  ok: 'bg-[#E7F4EC] text-ok ring-[#C9E6D4]', warn: 'bg-[#FDF3E2] text-warn ring-[#F2DDB5]', bad: 'bg-[#FDECEA] text-bad ring-[#F6C9C3]', info: 'bg-[#EAF0FC] text-route ring-[#CCDAF6]',
  neutral: 'bg-sand text-ink ring-line', maroon: 'bg-maroon text-white ring-maroon', demo: 'bg-[#F1ECF8] text-[#5B3D80] ring-[#E0D5EF]',
}
export function Badge({ tone = 'neutral', children, className = '', icon }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-[2px] text-[11.5px] font-semibold ring-1 ring-inset', BADGE[tone], className)}>{icon && <Icon name={icon} size={12} stroke={2.4} />}{children}</span>
}
export const DemoTag = ({ show = true }) => (show ? <Badge tone="demo">Sample</Badge> : null)

export function Field({ label, error, hint, children, id: idProp }) {
  const auto = useId()
  const id = idProp || auto
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-[#3B4048]">{label}</label>
      {typeof children === 'function' ? children(id) : children}
      {hint && !error && <span className="text-xs text-muted">{hint}</span>}
      {error && <span role="alert" className="flex items-center gap-1 text-[13px] font-medium text-bad"><Icon name="alert" size={14} />{error}</span>}
    </div>
  )
}
export const inputCls = 'min-h-[40px] w-full rounded-lg border border-line2 bg-surface px-3 text-[14.5px] text-ink shadow-[inset_0_1px_1px_rgba(31,35,41,.03)] outline-none transition placeholder:text-[#9A9EA6] hover:border-[#CFC6BE] focus:border-maroon focus:ring-[3px] focus:ring-maroon/12'

export function Empty({ icon = 'help', title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line2 bg-ground/60 px-4 py-8 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-surface text-maroon shadow-card ring-1 ring-line"><Icon name={icon} size={18} /></span>
      <p className="font-semibold">{title}</p>
      {children && <p className="max-w-sm text-sm text-muted">{children}</p>}
      {action}
    </div>
  )
}

export function Dialog({ open, onClose, title, children, wide }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    const t = setTimeout(() => ref.current?.querySelector('input,select,textarea,button')?.focus(), 30)
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  // Portalled to <body>: page wrappers use transform animations, which would otherwise trap position:fixed.
  return createPortal(
    <div className="fade-in fixed inset-0 z-50 flex items-end justify-center bg-[#1F2329]/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('dialog-in max-h-[92vh] w-full overflow-auto rounded-t-2xl border border-line bg-surface p-5 shadow-pop max-sm:max-h-[88dvh] max-sm:px-4 max-sm:pb-[calc(20px+env(safe-area-inset-bottom))] sm:rounded-2xl sm:p-6', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="press grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sand hover:text-ink"><Icon name="x" size={18} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 max-sm:mb-4 max-sm:gap-3">
      <div className="min-w-0">
        {back && <a href="#/" className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-maroon max-sm:-ml-1 max-sm:mb-1 max-sm:min-h-[36px] max-sm:px-1"><Icon name="back" size={14} />Home</a>}
        <h1 className="font-display text-[26px] font-semibold leading-tight text-ink max-sm:text-[23px] sm:text-[30px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[14.5px] text-muted max-sm:text-[13.5px] max-sm:leading-snug">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Segmented control with a sliding active indicator. Arrow keys move between options. */
export function Segmented({ options, value, onChange, label }) {
  const wrap = useRef(null)
  const [ind, setInd] = useState(null)
  useEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector('[aria-checked="true"]')
      if (el) setInd({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
    }
    measure()
    // Phones: the options sit in one scrolling row, so keep the selected one in view (no effect when nothing overflows).
    const w = wrap.current, el = w?.querySelector('[aria-checked="true"]')
    if (w && el && w.scrollWidth > w.clientWidth + 1) { const l = el.offsetLeft - 12, r = el.offsetLeft + el.offsetWidth + 12; if (l < w.scrollLeft) w.scrollLeft = l; else if (r > w.scrollLeft + w.clientWidth) w.scrollLeft = r - w.clientWidth }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(wrap.current)
    return () => ro?.disconnect()
  }, [value, options.length])
  const move = (dir) => { const i = options.findIndex((o) => o.value === value); const n = options[(i + dir + options.length) % options.length]; onChange(n.value); requestAnimationFrame(() => wrap.current?.querySelector('[aria-checked="true"]')?.focus()) }
  return (
    <div ref={wrap} role="radiogroup" aria-label={label} className="relative inline-flex flex-wrap gap-0.5 rounded-lg bg-sand p-[3px] ring-1 ring-inset ring-line max-sm:max-w-full max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:overscroll-x-contain max-sm:[scrollbar-width:none]"
      onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1) } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) } }}>
      {ind && <span aria-hidden="true" className="seg-ind pointer-events-none absolute left-0 top-0 rounded-md bg-surface shadow-[0_1px_2px_rgba(31,35,41,.12)] ring-1 ring-line" style={{ transform: `translate(${ind.x}px, ${ind.y}px)`, width: ind.w, height: ind.h }} />}
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} tabIndex={value === o.value ? 0 : -1} onClick={() => onChange(o.value)}
          className={cx('relative z-[1] min-h-[34px] rounded-md px-3 text-[13px] font-semibold transition-colors max-sm:min-h-[38px] max-sm:flex-none max-sm:whitespace-nowrap', value === o.value ? 'text-ink' : 'text-muted hover:text-ink', !ind && value === o.value && 'bg-surface shadow-sm')}>{o.label}</button>
      ))}
    </div>
  )
}

export function Toasts({ toasts }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-[calc(84px+env(safe-area-inset-bottom))] left-1/2 z-[60] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2 lg:bottom-6">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast-in pointer-events-auto flex items-start gap-2.5 rounded-xl px-4 py-3 text-[14px] font-medium shadow-pop', t.kind === 'bad' ? 'bg-bad text-white' : t.kind === 'warn' ? 'bg-[#4A3410] text-white' : 'bg-ink text-white')}>
          <Icon name={t.kind === 'bad' || t.kind === 'warn' ? 'alert' : 'check'} size={17} className="mt-0.5 flex-none" />{t.text}
        </div>
      ))}
    </div>
  )
}

/** Counts up to a number once it appears (respects reduced motion). */
export function AnimatedNumber({ value, decimals = 0, duration = 700 }) {
  const n = Number(value)
  const [shown, setShown] = useState(Number.isFinite(n) ? 0 : value)
  const from = useRef(0)
  useEffect(() => {
    if (!Number.isFinite(n)) { setShown(value); return }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setShown(n); from.current = n; return }
    const start = performance.now(), a = from.current
    let raf
    const step = (t) => {
      const k = Math.min(1, (t - start) / duration), e = 1 - Math.pow(1 - k, 3)
      setShown(a + (n - a) * e)
      if (k < 1) raf = requestAnimationFrame(step); else from.current = n
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [n]) // eslint-disable-line
  return <>{Number.isFinite(n) ? Number(shown).toFixed(decimals) : shown}</>
}

export function Stat({ label, value, sub, tone }) {
  const num = typeof value === 'number'
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted">{label}</span>
      <span className={cx('font-display text-[28px] font-semibold tabular-nums', tone === 'ok' && 'text-ok', tone === 'bad' && 'text-bad')}>{num ? <AnimatedNumber value={value} decimals={Number.isInteger(value) ? 0 : 2} /> : value}</span>
      {sub && <span className="text-[13px] text-muted">{sub}</span>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }) {
  return <span role="status" className="inline-flex items-center gap-2 text-sm text-muted"><span className="h-4 w-4 animate-spin rounded-full border-2 border-line2 border-t-maroon" />{label}</span>
}

export const fmtDateTime = (iso, tz = 'Asia/Kolkata') => new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
export function relTime(iso, now = new Date()) {
  const d = Date.parse(iso) - now.getTime(), a = Math.abs(d), m = Math.round(a / 60000), h = Math.round(a / 3600000), dd = Math.round(a / 86400000)
  const s = m < 60 ? `${m} min` : h < 36 ? `${h} h` : `${dd} days`
  return d >= 0 ? `in ${s}` : `${s} ago`
}

/** Two-step confirm built into the page (no browser dialogs). */
export function ConfirmButton({ children, confirmText = 'Confirm', onConfirm, ...p }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 5000); return () => clearTimeout(t) }, [armed])
  if (!armed) return <Button {...p} onClick={() => setArmed(true)}>{children}</Button>
  return (
    <span className="fade-in inline-flex flex-wrap items-center gap-2" role="group" aria-label="Confirm action">
      <Button {...p} icon={undefined} variant="danger" onClick={() => { setArmed(false); onConfirm() }}>{confirmText}</Button>
      <Button size={p.size} variant="secondary" onClick={() => setArmed(false)}>Cancel</Button>
    </span>
  )
}
