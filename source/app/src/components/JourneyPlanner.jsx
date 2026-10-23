import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Card, CardTitle, Badge, Segmented, Field, inputCls, cx, Empty } from './ui.jsx'
import Icon from './Icon.jsx'
import { searchStations, planJourney, LINE_INFO, NETWORK_SOURCE, STATIONS } from '../lib/journey.js'
import { istMinutes, fmt12 } from '../lib/transit.js'
import { prefs } from '../lib/storage.js'

const QUICK = ['Dombivli', 'Thane', 'Kalyan', 'Ghatkopar', 'Panvel', 'Vashi', 'CSMT', 'Andheri']
const LineDot = ({ line }) => <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: LINE_INFO[line]?.color }} aria-hidden="true" />

/** Accessible station combobox with forgiving search. */
export function StationPicker({ label, value, onChange, placeholder = 'Type a station, e.g. Dombivli' }) {
  const id = useId()
  const [q, setQ] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef(null)
  useEffect(() => { setQ(value || '') }, [value])
  const res = useMemo(() => (q.trim() ? searchStations(q, 8) : []), [q])
  useEffect(() => setHi(0), [q])
  useEffect(() => {
    const off = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [])
  const pick = (s) => { onChange(s.name); setQ(s.name); setOpen(false) }
  return (
    <div className="relative" ref={box}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-[#3B4048]">{label}</label>
      <div className="relative">
        <Icon name="train" size={17} className="pointer-events-none absolute left-3 top-[11px] text-muted" />
        <input id={id} role="combobox" aria-expanded={open && res.length > 0} aria-controls={id + '-list'} aria-autocomplete="list" autoComplete="off"
          aria-activedescendant={open && res[hi] ? `${id}-o${hi}` : undefined}
          className={cx(inputCls, 'pl-10')} placeholder={placeholder} value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, res.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
            else if (e.key === 'Enter' && res[hi]) { e.preventDefault(); pick(res[hi].station) }
            else if (e.key === 'Escape') setOpen(false)
          }} />
      </div>
      {open && q.trim() && (
        <ul id={id + '-list'} role="listbox" className="fade-in absolute inset-x-0 top-full z-40 mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-surface p-1 shadow-pop">
          {res.length ? res.map((r, i) => (
            <li key={r.station.code} id={`${id}-o${i}`} role="option" aria-selected={i === hi} onPointerDown={(e) => { e.preventDefault(); pick(r.station) }} onMouseEnter={() => setHi(i)}
              className={cx('flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[14px]', i === hi && 'bg-ground')}>
              <span className="min-w-0 flex-1"><b className="font-semibold">{r.station.name}</b>{r.fuzzy && <span className="ml-1.5 text-[12px] text-muted">did you mean?</span>}</span>
              <span className="flex flex-none items-center gap-1">{r.station.lines.map((l) => <span key={l} className="inline-flex items-center gap-1 rounded bg-sand px-1.5 py-0.5 text-[11px] font-semibold text-[#3B4048]"><LineDot line={l} />{LINE_INFO[l].short}</span>)}</span>
            </li>
          )) : <li className="px-3 py-2.5 text-[13.5px] text-muted">No station in the Central & Harbour network matches “{q}”.</li>}
        </ul>
      )}
    </div>
  )
}

function waitText(w) { return w == null ? '' : w === 0 ? 'now' : w < 60 ? `in ${w} min` : `in ${Math.floor(w / 60)} h ${w % 60} min` }

function Option({ o, i }) {
  return (
    <Card className={cx('!p-0 overflow-hidden', o.best && 'ring-1 ring-maroon/25')} style={{ animationDelay: `${i * 60}ms` }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <b className="font-display text-[16px] font-semibold">Via {o.via}</b>
          {o.best && <Badge tone="maroon" icon="star">Fewest changes</Badge>}
          <Badge tone={o.transfers ? 'warn' : 'ok'}>{o.atStart ? 'You are here' : o.transfers ? `${o.transfers} change${o.transfers > 1 ? 's' : ''}` : 'Direct'}</Badge>
          {!o.atStart && <span className="text-[12.5px] text-muted">{o.stops} stops</span>}
        </div>
        {o.timed && <span className="text-[13px] text-[#3B4048]"><b className="font-semibold">{o.departs}</b> → <b className="font-semibold">{o.arrives}</b> <span className="text-muted">· {o.rideMins} min on trains</span></span>}
      </div>
      <ol className="flex flex-col px-4 py-3">
        {o.legs.map((l, k) => (
          <li key={k} className="relative flex gap-3 pb-3">
            <span className="flex flex-none flex-col items-center"><span className="mt-1 h-3 w-3 rounded-full border-2 bg-surface" style={{ borderColor: l.color }} /><span className="w-[3px] flex-1 rounded-full" style={{ background: l.color }} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px]"><b className="font-semibold">{l.from.name}</b> <span className="text-muted">→</span> <b className="font-semibold">{l.to.name}</b></p>
              <p className="text-[12.5px] text-muted">{l.lineName} · any train towards {l.towards.join(' / ')} that stops at {l.to.name} · {l.stops} stop{l.stops > 1 ? 's' : ''}</p>
              {l.trains ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">{l.trains.map((t, j) => <span key={j} className={cx('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px]', j === 0 ? 'border-maroon/25 bg-maroon-50' : 'border-line')}><b className="font-semibold tabular-nums">{t.depText}</b><span className="text-muted">{t.typeLabel}{t.mins != null ? ` · ${t.mins} min` : ''}</span></span>)}</div>
              ) : <p className="mt-1 text-[12px] text-warn">Timetable for this leg isn't loaded in the app. Trains run on this route; check the station display for times.</p>}
              {k < o.legs.length - 1 && <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[#FDF3E2] px-2 py-1 text-[12px] font-semibold text-warn"><Icon name="swap" size={13} />Change at {l.to.name} to the {o.legs[k + 1].lineName}</p>}
            </div>
          </li>
        ))}
        {o.finalLeg && (
          <li className="flex gap-3">
            <span className="mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full bg-maroon text-white"><Icon name="pin" size={11} stroke={2.6} /></span>
            <div className="min-w-0 flex-1 text-[13.5px]">
              <p><b className="font-semibold">{o.via} → VESIT campus</b></p>
              <p className="text-[12.5px] text-[#3B4048]"><Icon name="bus" size={13} className="mr-1 inline text-muted" />{o.finalLeg.bus}, then {o.finalLeg.walk}. {o.finalLeg.auto}.</p>
              <p className="text-[11.5px] text-muted">Source: VES "how to reach" page.</p>
            </div>
          </li>
        )}
      </ol>
    </Card>
  )
}

export default function JourneyPlanner({ initialFrom }) {
  const [from, setFrom] = useState(() => initialFrom || prefs.get('homeStation', ''))
  const [to, setTo] = useState('campus')
  const [toStation, setToStation] = useState('')
  const [at, setAt] = useState('')
  const [tick, setTick] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setTick(new Date()), 30000); return () => clearInterval(t) }, [])
  useEffect(() => { if (from) prefs.set('homeStation', from) }, [from])
  const now = useMemo(() => {
    if (!at) return tick
    const [h, m] = at.split(':').map(Number)
    return new Date(tick.getTime() + (h * 60 + m - istMinutes(tick)) * 60000)
  }, [at, tick])
  const plan = useMemo(() => (from ? planJourney({ from, to: to === 'campus' ? 'campus' : toStation || 'campus', now }) : null), [from, to, toStation, now])
  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <Card className="h-fit">
        <CardTitle eyebrow="Plan by train">Get to campus</CardTitle>
        <div className="flex flex-col gap-3.5">
          <StationPicker label="From station" value={from} onChange={setFrom} />
          <div className="flex flex-wrap gap-1.5">{QUICK.map((s) => <button key={s} onClick={() => setFrom(s)} aria-pressed={from === s} className={cx('press min-h-[32px] rounded-md border px-2.5 text-[12.5px] font-semibold', from === s ? 'border-maroon/40 bg-maroon-50 text-maroon' : 'border-line2 hover:bg-ground')}>{s}</button>)}</div>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-[#3B4048]">To</p>
            <Segmented label="Destination" value={to} onChange={setTo} options={[{ value: 'campus', label: 'VESIT campus' }, { value: 'station', label: 'Another station' }]} />
          </div>
          {to === 'station' && <StationPicker label="To station" value={toStation} onChange={setToStation} />}
          <Field label="Leaving at" hint="Leave empty for right now (India time).">{(id) => <input id={id} type="time" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />}</Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3 text-[11.5px] text-muted">
          {Object.entries(LINE_INFO).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1.5"><LineDot line={k} />{v.name}</span>)}
        </div>
      </Card>
      <div className="flex flex-col gap-3">
        {!from ? <Empty icon="train" title="Where are you coming from?">Pick any station on the Central main line, Harbour line, Trans-Harbour or Uran line: {STATIONS.length} stations.</Empty>
          : plan?.error ? <Empty icon="alert" title={plan.error} />
          : plan && (
            <>
              <p className="text-[13px] text-muted">From <b className="text-ink">{plan.from.name}</b> to <b className="text-ink">{plan.to}</b> · {at ? `leaving after ${fmt12(istMinutes(now))}` : `now ${fmt12(istMinutes(now))}`}</p>
              <div className="stagger flex flex-col gap-3">{plan.options.map((o, i) => <Option key={o.via} o={o} i={i} />)}</div>
            </>
          )}
        <p className="rounded-lg border border-line bg-ground/60 p-3 text-[12px] text-muted">
          <b className="text-ink">How this works.</b> Routes use only service patterns that actually run end to end, with the fewest changes first. Listing a station doesn't mean every train stops there; fast trains skip some stations. Times are from the published timetable ({NETWORK_SOURCE.text}) where the app has it, not live running status — no live delays or platform numbers. Station list checked {NETWORK_SOURCE.checked}.
        </p>
      </div>
    </div>
  )
}
