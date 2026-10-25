import { useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Field, inputCls, Dialog, Empty, Segmented, DemoTag, fmtDateTime, relTime, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import MapView from '../components/MapView.jsx'
import JourneyPlanner, { StationPicker } from '../components/JourneyPlanner.jsx'
import { stationByName } from '../lib/journey.js'
import { createRide, requestSeat, confirmRequest, withdrawRequest, declineRequest, cancelRide, seatsInfo, seatStatusFor, departed, validateRide, SEAT } from '../lib/rides.js'
import { verificationOf } from '../lib/rides.js'
import { CAMPUS_CENTER } from '../data/config.js'

const st = (n) => { const x = stationByName(n); return { name: `${x.name} station`, lat: x.lat, lng: x.lng } }
const PRESETS = [
  { name: 'VESIT main gate', lat: CAMPUS_CENTER.lat, lng: CAMPUS_CENTER.lng },
  st('Chembur'), st('Kurla'), st('Ghatkopar'), st('Govandi'), st('Tilak Nagar'),
]
export const directionsUrl = (a, b) => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=driving`
const seatTone = { [SEAT.AVAILABLE]: 'info', [SEAT.REQUESTED]: 'warn', [SEAT.CONFIRMED]: 'ok', [SEAT.DECLINED]: 'bad' }
const clean = (n) => n.replace(' (demo pin)', '')

export default function Rides({ query = {} }) {
  const [mode, setMode] = useState(query.mode === 'train' ? 'train' : 'share')
  return (
    <div>
      <PageHeader back title="Rides" subtitle="Share a ride with classmates, or plan the train from your station to campus." actions={<Segmented label="Ride type" value={mode} onChange={setMode} options={[{ value: 'share', label: 'Ride share' }, { value: 'train', label: 'By train' }]} />} />
      {mode === 'train' ? <JourneyPlanner /> : <RideShare />}
    </div>
  )
}

/** "Verified student" / "Demo · unverified" / "Unverified" label for a rider, from their profile. */
export function VerifyBadge({ userId }) {
  const { db } = useApp()
  const v = verificationOf(db.profiles[userId])
  return v === 'verified' ? <Badge tone="ok" icon="check">Verified student</Badge> : v === 'demo' ? <Badge tone="demo">Demo · unverified</Badge> : <Badge tone="warn">Unverified</Badge>
}

/** Seat requests and new rides need a verified student. Demo accounts are told and may continue as a demo. */
function useVerifyGate() {
  const { me } = useApp()
  const [pending, setPending] = useState(null)
  const v = verificationOf(me)
  const gate = (action) => (v === 'verified' ? action() : setPending(() => action))
  const dialog = (
    <Dialog open={!!pending} onClose={() => setPending(null)} title="Verify before you ride">
      {pending && <div className="flex flex-col gap-3 text-[14px]">
        <p>Riders must be verified students: signed in with a college Google account (…@ves.ac.in). Anyone can browse rides; requesting a seat or offering a ride needs verification.</p>
        {v === 'demo' ? <p className="rounded-lg bg-[#F7F4FC] px-3 py-2 text-[13.5px] text-[#4E3570]">You’re using a <b>demo account</b>, which can’t be verified. You can continue to try the flow; nothing is shared with real people.</p>
          : <p className="rounded-lg bg-[#FDF0D8] px-3 py-2 text-[13.5px] text-warn">Your phone is verified. Add your college email or college ID in your profile to finish.</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button>
          {v === 'demo' ? <Button onClick={() => { const a = pending; setPending(null); a() }}>Continue as demo</Button> : <a href="#/profile" className="press inline-flex min-h-[42px] items-center rounded-xl bg-maroon px-4 text-[14px] font-semibold text-white">Open my profile</a>}
        </div>
      </div>}
    </Dialog>
  )
  return { gate, dialog }
}

function RideShare() {
  const { db, me, now, runShared } = useApp()
  const { rides, rideRequests } = db.shared
  const { gate, dialog } = useVerifyGate()
  const [tab, setTab] = useState('discover')
  const [q, setQ] = useState('')
  const [onlySeats, setOnlySeats] = useState(false)
  const [focus, setFocus] = useState(null)
  const [creating, setCreating] = useState(false)

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return rides
      .filter((r) => (tab === 'mine' ? r.creatorId === me.id || rideRequests.some((x) => x.rideId === r.id && x.userId === me.id) : !departed(r, now)))
      .filter((r) => !t || `${r.from.name} ${r.to.name} ${r.creatorName} ${r.notes}`.toLowerCase().includes(t))
      .filter((r) => !onlySeats || !seatsInfo(r, rideRequests).full)
      .sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt))
  }, [rides, rideRequests, q, onlySeats, tab, me.id, now])

  const markers = list.flatMap((r) => [
    r.from.lat !== undefined && { id: r.id + ':from', lat: r.from.lat, lng: r.from.lng, kind: 'from', title: `Pickup: ${clean(r.from.name)}`, sub: `${r.creatorName} · ${fmtDateTime(r.departAt)}` },
    r.to.lat !== undefined && { id: r.id + ':to', lat: r.to.lat, lng: r.to.lng, kind: 'to', title: `Drop: ${clean(r.to.name)}`, sub: r.creatorName },
  ].filter(Boolean))
  const lines = list.filter((r) => r.from.lat !== undefined && r.to.lat !== undefined).map((r) => ({ id: r.id, from: r.from, to: r.to }))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button icon="plus" onClick={() => gate(() => setCreating(true))}>Offer a ride</Button>
        <Segmented label="Rides view" value={tab} onChange={setTab} options={[{ value: 'discover', label: 'Find a ride' }, { value: 'mine', label: 'My rides & requests' }]} />
        <label className="relative min-w-[220px] flex-1"><span className="sr-only">Search rides</span>
          <Icon name="search" size={17} className="absolute left-3 top-[11px] text-muted" />
          <input className={cx(inputCls, 'pl-10')} placeholder="Search pickup, destination or driver" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-line2 bg-surface px-3 text-[13.5px] font-semibold hover:bg-ground"><input type="checkbox" className="h-4 w-4" checked={onlySeats} onChange={(e) => setOnlySeats(e.target.checked)} />Seats left only</label>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
        <div className="stagger flex flex-col gap-3">
          {list.length ? list.map((r) => <RideCard key={r.id} r={r} me={me} now={now} requests={rideRequests} runShared={runShared} gate={gate} onShow={() => setFocus(r.id + ':from')} />)
            : <Empty icon="car" title={tab === 'mine' ? 'No rides yet' : 'No rides match'} action={<Button size="sm" icon="plus" onClick={() => gate(() => setCreating(true))}>Offer a ride</Button>}>{tab === 'mine' ? 'Rides you offer or request will show here.' : 'Try clearing the search or the seats filter.'}</Empty>}
        </div>
        <div className="lg:sticky lg:top-6 lg:h-fit">
          <MapView label="Ride pickup and drop-off map" markers={markers} lines={lines} focusId={focus} height={420} />
          <p className="mt-2 flex gap-4 text-xs text-muted"><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-route" />Pickup</span><span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-terra" />Drop-off</span><span className="inline-flex items-center gap-1.5"><i className="w-4 border-t-2 border-dashed border-route" />Ride</span></p>
        </div>
      </div>
      {dialog}
      <Dialog open={creating} onClose={() => setCreating(false)} title="Offer a ride" wide>
        <CreateRide now={now} onCancel={() => setCreating(false)} onCreate={(input) => { const r = runShared((s) => createRide(s, input, me, new Date()), 'Ride published. Students can now request seats.'); if (r.ok) { setCreating(false); setTab('mine') } return r }} />
      </Dialog>
    </div>
  )
}

function RideCard({ r, me, now, requests, runShared, onShow, gate = (a) => a() }) {
  const info = seatsInfo(r, requests)
  const mine = r.creatorId === me.id
  const status = seatStatusFor(r, requests, me.id)
  const myReq = requests.find((x) => x.rideId === r.id && x.userId === me.id)
  const reqs = requests.filter((x) => x.rideId === r.id)
  const gone = departed(r, now)
  const statusIcon = { [SEAT.AVAILABLE]: 'plus', [SEAT.REQUESTED]: 'clock', [SEAT.CONFIRMED]: 'check' }
  return (
    <Card id={'ride-' + r.id} interactive className={cx('!p-0 overflow-hidden', gone && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted"><span className="grid h-6 w-6 place-items-center rounded-full bg-maroon-100 text-[10.5px] font-bold text-maroon">{r.creatorName.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span><span className="font-medium text-[#3B4048]">{r.creatorName}</span><VerifyBadge userId={r.creatorId} />{mine && <Badge tone="maroon">Your ride</Badge>}<DemoTag show={r.demo} /></p>
          <ol className="mt-3 flex flex-col gap-0.5">
            <li className="flex items-center gap-2.5"><span className="h-2.5 w-2.5 flex-none rounded-full bg-route ring-[3px] ring-[#EAF0FC]" /><b className="truncate text-[15.5px] font-semibold">{clean(r.from.name)}</b><span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Pickup</span></li>
            <li aria-hidden="true" className="ml-[4.5px] h-3 border-l-2 border-dotted border-line2" />
            <li className="flex items-center gap-2.5"><span className="h-2.5 w-2.5 flex-none rounded-sm bg-terra ring-[3px] ring-[#FBEDE6]" /><b className="truncate text-[15.5px] font-semibold">{clean(r.to.name)}</b><span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Drop</span></li>
          </ol>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[#3B4048]"><span className="inline-flex items-center gap-1.5"><Icon name="clock" size={14} className="text-muted" />{fmtDateTime(r.departAt)}</span><span className="text-muted">{relTime(r.departAt, now)}</span></p>
          {r.notes && <p className="mt-1 text-[13px] text-muted">“{r.notes}”</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="flex gap-1" aria-hidden="true">{Array.from({ length: r.seats }).map((_, i) => <span key={i} className={cx('h-3.5 w-3.5 rounded-[4px] border', i < r.seats - info.seatsLeft ? 'border-maroon bg-maroon' : 'border-line2 bg-surface')} />)}</span>
          <span className="text-[13px] text-muted"><b className="font-display text-[18px] font-semibold text-ink">{info.seatsLeft}</b> of {r.seats} seats left</span>
          {gone ? <Badge>Departed</Badge> : info.full && (mine || status === SEAT.AVAILABLE) ? <Badge tone="bad">Full</Badge> : null}
          {!mine && !(info.full && status === SEAT.AVAILABLE) && <Badge tone={seatTone[status]} icon={statusIcon[status]}>{status === SEAT.AVAILABLE ? 'Seat available' : status}</Badge>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-ground/50 px-4 py-2.5">
        {!mine && status === SEAT.AVAILABLE && !r.cancelled && <Button size="sm" disabled={gone || info.full} onClick={() => gate(() => runShared((s) => requestSeat(s, r.id, me, new Date()), 'Seat requested. The driver will confirm.'))}>{info.full ? 'Ride full' : 'Request seat'}</Button>}
        {!mine && status === SEAT.REQUESTED && <><span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-warn"><Icon name="clock" size={15} />Waiting for {r.creatorName.split(' ')[0]} to confirm</span><Button size="sm" variant="secondary" onClick={() => runShared((s) => withdrawRequest(s, myReq.id, me), 'Request withdrawn.')}>Withdraw</Button></>}
        {!mine && status === SEAT.CONFIRMED && <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ok"><Icon name="check" size={15} />Your seat is confirmed</span>}
        {mine && <span className="text-[13px] text-muted">{r.cancelled ? 'Cancelled' : reqs.length ? `${reqs.length} request${reqs.length > 1 ? 's' : ''}` : 'No requests yet'}</span>}
        {mine && !r.cancelled && !departed(r, now) && <Button size="sm" variant="ghost" className="!text-bad" onClick={() => { if (confirm('Cancel this ride? Everyone who asked for a seat will be told.')) runShared((s) => cancelRide(s, r.id, me, new Date()), 'Ride cancelled.') }}>Cancel ride</Button>}
        {!mine && r.cancelled && <Badge tone="bad">Cancelled by the driver</Badge>}
        {!mine && status === SEAT.DECLINED && <Badge tone="bad">Request declined</Badge>}
        {(r.from.lat !== undefined) && <span className="ml-auto flex gap-1"><Button size="sm" variant="ghost" icon="map" onClick={onShow}>Show on map</Button>{r.to.lat !== undefined && <a href={directionsUrl(r.from, r.to)} target="_blank" rel="noopener" className="press inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 text-[13px] font-semibold text-maroon hover:bg-maroon-50"><Icon name="route" size={15} />Directions</a>}</span>}
      </div>
      {mine && reqs.length > 0 && (
        <ul className="flex flex-col divide-y divide-line border-t border-line">
          {reqs.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="flex items-center gap-2 text-[14px]"><span className="grid h-7 w-7 place-items-center rounded-full bg-sand text-[11px] font-bold">{q.userName.split(' ').map((x) => x[0]).join('')}</span><b className="font-semibold">{q.userName}</b><VerifyBadge userId={q.userId} /><Badge tone={seatTone[q.status]} icon={statusIcon[q.status]}>{q.status}</Badge></span>
              {q.status === SEAT.REQUESTED && <span className="flex gap-1.5"><Button size="sm" variant="secondary" disabled={gone} onClick={() => runShared((s) => declineRequest(s, q.id, me, new Date()), `Declined ${q.userName}.`)}>Decline</Button><Button size="sm" variant="blue" icon="check" disabled={info.full || gone} onClick={() => runShared((s) => confirmRequest(s, q.id, me, new Date()), `${q.userName}'s seat confirmed.`)}>{info.full ? 'No seats left' : 'Confirm seat'}</Button></span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function CreateRide({ onCreate, onCancel, now }) {
  const def = new Date(now.getTime() + 3600000); def.setSeconds(0, 0)
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
  const [f, setF] = useState({ from: PRESETS[1], to: PRESETS[0], departAt: local(def), seats: '2', notes: '' })
  const [picking, setPicking] = useState('from')
  const [errors, setErrors] = useState([])
  const input = { from: f.from, to: f.to, departAt: f.departAt ? new Date(f.departAt).toISOString() : '', seats: Number(f.seats), notes: f.notes }
  const submit = (e) => {
    e.preventDefault()
    const errs = validateRide({ ...input, seats: Number.isInteger(input.seats) ? input.seats : NaN }, new Date())
    setErrors(errs)
    if (!errs.length) onCreate(input)
  }
  const place = (k) => (
    <Field label={k === 'from' ? 'Pickup point' : 'Destination'} hint="Pick a preset, type a name, or click the map">
      {(id) => (
        <div className="flex gap-2">
          <input id={id} className={cx(inputCls, 'min-w-0 flex-1')} value={f[k].name} onChange={(e) => setF({ ...f, [k]: { ...f[k], name: e.target.value } })} />
          <select aria-label={`${k} presets`} className={cx(inputCls, '!w-[118px] flex-none')} value="" onChange={(e) => e.target.value !== '' && setF({ ...f, [k]: PRESETS[+e.target.value] })}>
            <option value="">Presets</option>{PRESETS.map((p, i) => <option key={p.name} value={i}>{clean(p.name)}</option>)}
          </select>
        </div>
      )}
    </Field>
  )
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">{place('from')}{place('to')}</div>
      <LocateMe onLocate={(ll) => setF((x) => ({ ...x, from: { name: 'My current location', ...ll } }))} />
      <StationPicker label="Coming from a railway station? Pick it to set the pickup" value="" placeholder="e.g. Dombivli, Thane, Panvel" onChange={(n) => { const st = stationByName(n); if (st) setF((x) => ({ ...x, from: { name: `${st.name} station`, lat: st.lat, lng: st.lng } })) }} />
      <div className="flex items-center gap-2 text-sm"><span className="font-semibold text-muted">Map click sets:</span>
        <Segmented label="Map click target" value={picking} onChange={setPicking} options={[{ value: 'from', label: 'Pickup' }, { value: 'to', label: 'Destination' }]} />
      </div>
      <MapView label="Choose ride locations" height={220} markers={[{ id: 'f', ...f.from, kind: 'from', title: f.from.name || 'Pickup' }, { id: 't', ...f.to, kind: 'to', title: f.to.name || 'Destination' }].filter((m) => m.lat !== undefined)}
        onPick={(ll) => setF((x) => ({ ...x, [picking]: { name: x[picking].name.replace(' (demo pin)', '') || 'Pinned spot', ...ll } }))} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Departure">{(id) => <input id={id} type="datetime-local" className={inputCls} value={f.departAt} onChange={(e) => setF({ ...f, departAt: e.target.value })} />}</Field>
        <Field label="Seats offered">{(id) => <input id={id} inputMode="numeric" className={inputCls} value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} />}</Field>
      </div>
      <Field label="Notes (optional)">{(id) => <input id={id} className={inputCls} maxLength={120} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Auto share, split fare" />}</Field>
      {errors.length > 0 && <ul role="alert" className="list-disc rounded-xl bg-[#FBEDEA] py-2 pl-8 pr-3 text-sm text-bad">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit">Publish ride</Button></div>
    </form>
  )
}

/** Sets the pickup from the device's location. Needs the user's permission; nothing is stored beyond the ride. */
function LocateMe({ onLocate }) {
  const [st, setSt] = useState('idle')
  const go = () => {
    if (!navigator.geolocation) return setSt('unsupported')
    setSt('busy')
    navigator.geolocation.getCurrentPosition(
      (p) => { onLocate({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }); setSt('ok') },
      (e) => setSt(e.code === 1 ? 'denied' : 'fail'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
  }
  const msg = { busy: 'Finding you…', ok: 'Pickup set to your current location.', denied: 'Location permission was denied.', fail: 'Couldn\u2019t get your location. Pick on the map instead.', unsupported: 'This browser can\u2019t share location.' }[st]
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <Button type="button" size="sm" variant="secondary" icon="pin" onClick={go} disabled={st === 'busy'}>Use my location for pickup</Button>
      {msg && <span role="status" className={st === 'ok' ? 'text-ok' : st === 'busy' ? 'text-muted' : 'text-bad'}>{msg}</span>}
    </div>
  )
}
