import { useEffect, useMemo, useState } from 'react'
import { PageHeader, Card, CardTitle, Badge, Segmented, Field, inputCls, cx, Empty } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import JourneyPlanner from '../components/JourneyPlanner.jsx'
import { nextTrains, allStations, findStation, busesNear, BUS_SOURCE, TRAIN_SOURCE, trainCounts, fmt12, istMinutes, istDay } from '../lib/transit.js'

const TYPE_TONE = { S: 'neutral', F: 'maroon', AS: 'info', AF: 'info' }
const KIND = { sample: ['ok', 'Printed time'], estimate: ['warn', 'Estimate'], closed: ['neutral', 'Not running'], unknown: ['neutral', 'Not published'] }

function useTick(ms = 30000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t) }, [ms])
  return now
}

const waitText = (w) => (w === 0 ? 'now' : w < 60 ? `in ${w} min` : `in ${Math.floor(w / 60)} h ${w % 60} min`)

function Trains({ query }) {
  const tick = useTick()
  const [from, setFrom] = useState(findStation(query.from) === 'Kurla' ? 'Kurla' : 'Chembur')
  const [to, setTo] = useState(findStation(query.to) || '')
  const [dir, setDir] = useState('')
  const [kind, setKind] = useState(query.fast ? 'fast' : 'all')
  const [line, setLine] = useState('')
  const [at, setAt] = useState('')
  const now = useMemo(() => {
    if (!at) return tick
    const [h, m] = at.split(':').map(Number)
    const d = new Date(tick); const diff = h * 60 + m - istMinutes(tick)
    return new Date(d.getTime() + diff * 60000)
  }, [at, tick])
  const types = { all: null, fast: ['F', 'AF'], slow: ['S', 'AS'], ac: ['AS', 'AF'] }[kind]
  const r = nextTrains({ from, to: to || undefined, dir: dir || undefined, line: line || undefined, types, now, limit: 10 })
  const counts = trainCounts(from)
  const stations = allStations().filter((s) => s !== from)
  const dirOpts = from === 'Chembur'
    ? [{ value: '', label: 'Both ways' }, { value: 'UP', label: 'To CSMT / Andheri' }, { value: 'DN', label: 'To Vashi / Panvel' }]
    : [{ value: '', label: 'Both ways' }, { value: 'UP', label: 'To CSMT' }, { value: 'DN', label: line === 'H' ? 'To Panvel' : 'To Thane / Kalyan' }]
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <Card className="h-fit">
        <CardTitle eyebrow="Find a train">From {from}</CardTitle>
        <div className="flex flex-col gap-3">
          <Segmented label="Station" value={from} onChange={(v) => { setFrom(v); if (v === 'Chembur') setLine(''); setTo(to === v ? '' : to) }} options={[{ value: 'Chembur', label: 'Chembur' }, { value: 'Kurla', label: 'Kurla' }]} />
          {from === 'Kurla' && <Segmented label="Line" value={line} onChange={setLine} options={[{ value: '', label: 'All lines' }, { value: 'M', label: 'Main' }, { value: 'H', label: 'Harbour' }]} />}
          <Field label="Going to (optional)">{(id) => (
            <select id={id} className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Any station</option>
              {stations.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}</Field>
          {!to && <Segmented label="Direction" value={dir} onChange={setDir} options={dirOpts} />}
          <Segmented label="Train type" value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'fast', label: 'Fast' }, { value: 'slow', label: 'Slow' }, { value: 'ac', label: 'AC' }]} />
          <Field label="Leaving at" hint="Leave empty for right now.">{(id) => <input id={id} type="time" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} />}</Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5 text-xs text-muted">
          {Object.entries(counts).map(([k, v]) => <span key={k} className="rounded-md bg-sand px-2 py-0.5">{k[0] === 'M' ? 'Main' : 'Harbour'} {k.slice(1)} · {v}/day</span>)}
        </div>
      </Card>
      <Card>
        <CardTitle eyebrow={`${istDay(now)} · ${at ? 'from ' + fmt12(istMinutes(now)) : 'now ' + fmt12(istMinutes(now))}`} action={<Badge tone="ok" icon="check">Official timetable</Badge>}>
          {to ? `${from} → ${to}` : `Next trains from ${from}`}
        </CardTitle>
        {r.error ? <Empty icon="train" title={r.error} /> : r.trains.length === 0 ? <Empty icon="train" title="No direct trains match">Try "Any station" or another train type.</Empty> : (
          <ul key={`${from}${to}${dir}${kind}${line}${at}`} className="stagger flex flex-col divide-y divide-line">
            {r.trains.map((t, i) => (
              <li key={t.no + i} className="flex items-center gap-3 py-3">
                <div className="w-[76px] flex-none">
                  <b className="block font-display text-[20px] font-semibold leading-none tabular-nums">{t.depText.replace(/ (AM|PM)/, '')}<small className="ml-0.5 text-xs font-semibold text-muted">{t.depText.slice(-2)}</small></b>
                  <span className={cx('text-xs font-semibold', t.wait <= 5 ? 'text-bad' : 'text-muted')}>{waitText(t.wait)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{t.dest} <span className="font-normal text-muted">· {t.direction.replace('Towards ', 'via ')}</span></p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <Badge tone={TYPE_TONE[t.type]}>{t.typeLabel}</Badge>{t.lineLabel} · <span className="font-mono">{t.code}</span>
                    {t.arrText && <> · reaches {t.to} <b className="text-ink">{t.arrText}</b> ({t.mins} min)</>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 rounded-lg border border-line bg-ground/60 p-3 text-xs text-muted">
          <b className="text-ink">Source:</b> {TRAIN_SOURCE.text}. Times are the published schedule, not live running status. Some services don't run on Sundays and holidays, and this data doesn't separate them. Check station announcements for delays.
        </p>
      </Card>
    </div>
  )
}

function Buses({ query }) {
  const now = useTick()
  const [q, setQ] = useState(query.toward || '')
  const stops = busesNear({ toward: q.trim() || undefined, now })
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <Field label="Going to (stop or route number)">{(id) => <input id={id} className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Kurla, Ghatkopar, 501 LTD" />}</Field>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['Kurla', 'Ghatkopar', 'Airoli', 'Mahul', 'Trombay'].map((s) => <button key={s} onClick={() => setQ(s)} aria-pressed={q === s} className={cx('press min-h-[36px] rounded-lg border px-3 text-[13px] font-semibold', q === s ? 'border-maroon/40 bg-maroon-50 text-maroon' : 'border-line2 hover:bg-ground')}>{s}</button>)}
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#FBEFD9] p-3 text-[13px] text-[#5C3A07]"><Icon name="alert" size={16} className="mt-0.5 flex-none" />BEST doesn't publish full-day timetables for these routes. "Printed time" is a departure from Moovit's published schedule; anything else is an estimate from the gap between buses. For live arrivals, use the BEST Chalo app.</p>
      </Card>
      {stops.length === 0 && <Empty icon="bus" title={`No route near campus goes to "${q}"`}>Try Kurla or Ghatkopar.</Empty>}
      {stops.map((s) => (
        <Card key={s.id}>
          <CardTitle eyebrow={s.where} action={s.walk && <Badge tone="info" icon="pin">{s.walk}</Badge>}>{s.name} bus stop</CardTitle>
          <ul className="grid gap-2 sm:grid-cols-2">
            {s.routes.map((r) => (
              <li key={r.no} className="lift flex gap-3 rounded-lg border border-line p-3">
                <span className="grid h-11 min-w-[56px] flex-none place-items-center rounded-lg bg-[#B4232A] px-2 font-display text-sm font-bold text-white">{r.no}</span>
                <div className="min-w-0 text-sm">
                  <p className="font-semibold leading-snug">{r.ends.filter((e) => e !== '—').join(' ⇄ ')}</p>
                  {r.note && <p className="text-xs text-muted">{r.note}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"><Badge tone={KIND[r.next.kind][0]}>{KIND[r.next.kind][1]}</Badge><span className="text-muted">{r.next.text}</span></p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      <p className="text-xs text-muted">Checked {BUS_SOURCE.checked}. Sources: {BUS_SOURCE.links.map((l, i) => <span key={l.url}>{i ? ', ' : ''}<a className="underline" href={l.url} target="_blank" rel="noreferrer">{l.label}</a></span>)}.</p>
    </div>
  )
}

export default function Commute({ query = {} }) {
  const [tab, setTab] = useState(['buses', 'trains'].includes(query.tab) ? query.tab : 'plan')
  return (
    <div>
      <PageHeader back title="Trains & buses" subtitle="Plan a train journey to campus from any Central or Harbour line station, see the next trains at Kurla and Chembur, and find BEST buses near campus." actions={<Segmented label="Mode" value={tab} onChange={setTab} options={[{ value: 'plan', label: 'Plan journey' }, { value: 'trains', label: 'Kurla & Chembur' }, { value: 'buses', label: 'Buses' }]} />} />
      {tab === 'plan' ? <JourneyPlanner initialFrom={query.from} /> : tab === 'trains' ? <Trains key={JSON.stringify(query)} query={query} /> : <Buses query={query} />}
    </div>
  )
}
