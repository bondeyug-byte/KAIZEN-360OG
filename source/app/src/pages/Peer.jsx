import { useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Field, inputCls, Dialog, Empty, DemoTag, fmtDateTime, cx, AnimatedNumber } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { Stars } from './Canteen.jsx'
import { tutorRating, saveTutorReview, deleteTutorReview, SESSION, creditsOf, addOffer, addLearnRequest, findMatches, createMatch, bookSession, cancelBooking, completeSession } from '../lib/peer.js'

const TONE = { [SESSION.MATCHED]: 'info', [SESSION.BOOKED]: 'warn', [SESSION.COMPLETED]: 'ok' }

export default function Peer({ query = {} }) {
  const { db, me, runShared } = useApp()
  const sh = db.shared
  const c = creditsOf(sh, me.id)
  const matches = findMatches(sh, db.profiles, me.id)
  const mySessions = sh.sessions.filter((s) => s.teacherId === me.id || s.learnerId === me.id).sort((a, b) => ['Matched', 'Booked', 'Completed'].indexOf(a.status) - ['Matched', 'Booked', 'Completed'].indexOf(b.status))
  const myLedger = sh.ledger.filter((t) => t.userId === me.id).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const [booking, setBooking] = useState(null)
  const [offering, setOffering] = useState(false)
  const [reviewing, setReviewing] = useState(null)
  const [learn, setLearn] = useState({ skill: '', hours: '1' })
  return (
    <div>
      <PageHeader back title="Peer learning" subtitle="Teach 1 hour, earn 1 credit. Learn 1 hour, spend 1 credit. Credits move only when a session is completed." />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          <Tutors onReview={setReviewing} initialQ={query.q || ''} />
          <Card>
            <CardTitle eyebrow="Suggested for you">Matches</CardTitle>
            {matches.length ? matches.map((m) => (
              <div key={m.request.id} className="mb-3 last:mb-0">
                <p className="mb-2 flex items-center gap-2 text-[13.5px]"><Icon name="book" size={15} className="text-route" /><b className="font-semibold">You want to learn {m.request.skill}</b><span className="text-muted">· {m.request.hours} h</span></p>
                {m.teachers.length ? (
                  <ul className="flex flex-col gap-2">
                    {m.teachers.map((t) => {
                      const existing = sh.sessions.find((s) => s.offerId === t.offer.id && s.requestId === m.request.id && s.status !== SESSION.COMPLETED)
                      return (
                        <li key={t.offer.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-ground/60">
                          <span className="text-[15px]"><b>{t.offer.userName}</b> teaches {t.offer.skill} <span className="text-muted">· {t.offer.level}</span>{t.shared.length > 0 && <span className="block text-xs text-muted">You both have: {t.shared.join(', ')}</span>}</span>
                          {existing ? <Badge tone={TONE[existing.status]}>{existing.status}</Badge> : <Button size="sm" onClick={() => runShared((s) => createMatch(s, t.offer.id, m.request.id, me), `Matched with ${t.offer.userName}.`)}>Match</Button>}
                        </li>
                      )
                    })}
                  </ul>
                ) : <p className="rounded-xl bg-ground px-3 py-2 text-sm text-muted">No one offers this yet.</p>}
              </div>
            )) : <Empty icon="swap" title="Ask to learn something">Add a learning request below to see who can teach you.</Empty>}
          </Card>

          <Card>
            <CardTitle eyebrow="Sessions">Matched → Booked → Completed</CardTitle>
            {mySessions.length ? (
              <ul className="stagger flex flex-col gap-2">
                {mySessions.map((s) => {
                  const teaching = s.teacherId === me.id
                  return (
                    <li key={s.id} id={'sess-' + s.id} className="rounded-lg border border-line p-3 transition-colors hover:bg-ground/50">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2.5"><span className={cx('grid h-8 w-8 place-items-center rounded-lg', teaching ? 'bg-[#E7F4EC] text-ok' : 'bg-[#EAF0FC] text-route')}><Icon name={teaching ? 'star' : 'book'} size={16} /></span><span className="leading-tight"><b className="block text-[14px] font-semibold">{s.skill} · {s.hours} h</b><small className="text-[12.5px] text-muted">{teaching ? `You teach ${s.learnerName}` : `${s.teacherName} teaches you`}</small></span></span>
                        <span className="flex gap-1"><Badge tone={TONE[s.status]}>{s.status}</Badge><DemoTag show={s.demo} /></span>
                      </div>
                      <ol className="mt-2.5 flex items-center gap-1.5" aria-label={`Status: ${s.status}`}>{[SESSION.MATCHED, SESSION.BOOKED, SESSION.COMPLETED].map((st, k, arr) => { const reached = arr.indexOf(s.status) >= k; return <li key={st} className="flex flex-1 items-center gap-1.5"><span className={cx('h-1.5 flex-1 rounded-full transition-colors', reached ? (s.status === SESSION.COMPLETED ? 'bg-ok' : 'bg-maroon') : 'bg-sand')} /><span className={cx('text-[11px] font-semibold', reached ? 'text-ink' : 'text-[#9A9EA6]')}>{st}</span></li> })}</ol>
                      {s.scheduledAt && <p className="mt-1 text-sm text-muted">{s.status === SESSION.COMPLETED ? 'Held' : 'Booked for'} {fmtDateTime(s.scheduledAt)}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {s.status === SESSION.MATCHED && <Button size="sm" onClick={() => setBooking(s)}>Book a time</Button>}
                        {s.status === SESSION.BOOKED && <><Button size="sm" icon="check" onClick={() => runShared((st) => completeSession(st, s.id, me, new Date()), `Completed. ${s.hours} credit${s.hours > 1 ? 's' : ''} moved from ${s.learnerName} to ${s.teacherName}.`)}>Mark completed</Button><Button size="sm" variant="secondary" onClick={() => runShared((st) => cancelBooking(st, s.id, me), 'Booking cancelled; reserved credits released.')}>Cancel booking</Button></>}
                        {s.status === SESSION.COMPLETED && <span className="text-sm text-ok">{teaching ? `+${s.hours} earned` : `−${s.hours} spent`}</span>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : <Empty icon="calendar" title="No sessions yet">Match with a teacher to start.</Empty>}
          </Card>

          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardTitle eyebrow="I can teach">Teaching offers</CardTitle>
              <ul className="mb-3 flex flex-wrap gap-2">{sh.offers.filter((o) => o.userId === me.id).map((o) => <li key={o.id}><Badge tone="ok">{o.skill}</Badge></li>)}</ul>
              <Button icon="plus" onClick={() => setOffering(true)} aria-label="Add teaching offer">Offer to teach</Button>
            </Card>
            <Card>
              <CardTitle eyebrow="I want to learn">Learning requests</CardTitle>
              <ul className="mb-3 flex flex-wrap gap-2">{sh.learnRequests.filter((r) => r.userId === me.id).map((r) => <li key={r.id}><Badge tone="info">{r.skill} · {r.hours} h</Badge></li>)}</ul>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const r = runShared((s) => addLearnRequest(s, { skill: learn.skill, hours: Number(learn.hours) }, me), 'Request added — see your matches.'); if (r.ok) setLearn({ skill: '', hours: '1' }) }}>
                <label className="flex-1"><span className="sr-only">Skill to learn</span><input className={inputCls} placeholder="e.g. Arduino" value={learn.skill} onChange={(e) => setLearn({ ...learn, skill: e.target.value })} /></label>
                <label><span className="sr-only">Hours</span><select className={cx(inputCls, 'w-auto')} value={learn.hours} onChange={(e) => setLearn({ ...learn, hours: e.target.value })}>{[1, 2, 3, 4].map((h) => <option key={h} value={h}>{h} h</option>)}</select></label>
                <Button type="submit" icon="plus" aria-label="Add learning request" />
              </form>
            </Card>
          </div>
        </div>

        <div className="flex flex-col gap-5 lg:sticky lg:top-6 lg:h-fit">
          <Card>
            <CardTitle eyebrow="Time credits">Your balance</CardTitle>
            <div className="flex items-end justify-between gap-3">
              <div><p className="font-display text-[44px] font-semibold leading-none tabular-nums"><AnimatedNumber value={c.available} /></p><p className="mt-1 text-[12.5px] font-medium text-muted">credits available to learn</p></div>
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-maroon-50 text-maroon"><Icon name="credit" size={20} /></span>
            </div>
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-sand" aria-hidden="true">{c.balance > 0 && <><span className="bar-in h-full bg-maroon" style={{ width: `${(c.available / Math.max(1, c.balance)) * 100}%` }} /><span className="h-full bg-[#E3B45C]" style={{ width: `${(c.reserved / Math.max(1, c.balance)) * 100}%` }} /></>}</div>
            <dl className="mt-2 flex justify-between text-[12.5px]"><div className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-maroon" /><dt className="text-muted">Balance</dt><dd className="font-semibold">{c.balance}</dd></div><div className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#E3B45C]" /><dt className="text-muted">Reserved</dt><dd className="font-semibold">{c.reserved}</dd></div></dl>
            <p className="mt-2 text-xs text-muted">Booking a session reserves the learner's credits. They are spent only when the session is completed, and released if it's cancelled.</p>
          </Card>
          <Card>
            <CardTitle eyebrow="Audit trail">Credit history</CardTitle>
            {myLedger.length ? (
              <ul className="flex max-h-[320px] flex-col gap-1.5 overflow-auto">
                {myLedger.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13.5px] transition-colors hover:bg-ground">
                    <span className={cx('grid h-7 w-7 flex-none place-items-center rounded-md text-[13px] font-bold', t.type === 'earn' ? 'bg-[#E7F4EC] text-ok' : 'bg-[#FDECEA] text-bad')} aria-hidden="true">{t.type === 'earn' ? '↑' : '↓'}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate">{t.note}</span><small className="text-[12px] text-muted">{fmtDateTime(t.at)}{t.demo ? ' · sample' : ''}</small></span>
                    <b className={cx('tabular-nums', t.type === 'earn' ? 'text-ok' : 'text-bad')}>{t.type === 'earn' ? 'Earned +' : 'Spent −'}{t.amount}</b>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No credit changes yet. Teach a session to earn your first credit.</p>}
          </Card>
        </div>
      </div>
      <Dialog open={offering} onClose={() => setOffering(false)} title="Offer to teach">{offering && <OfferForm onDone={() => setOffering(false)} />}</Dialog>
      <Dialog open={!!reviewing} onClose={() => setReviewing(null)} title={reviewing ? `Rate ${reviewing.userName}` : ''}>{reviewing && <TutorReviews tutor={reviewing} />}</Dialog>
      <Dialog open={!!booking} onClose={() => setBooking(null)} title={booking ? `Book ${booking.skill}` : ''}>
        {booking && <BookForm s={booking} onCancel={() => setBooking(null)} onBook={(when) => { const r = runShared((st) => bookSession(st, booking.id, me, when), `Booked. ${booking.hours} credit${booking.hours > 1 ? 's' : ''} reserved.`); if (r.ok) setBooking(null) }} />}
      </Dialog>
    </div>
  )
}

function BookForm({ s, onBook, onCancel }) {
  const d = new Date(Date.now() + 86400000); d.setMinutes(0, 0, 0)
  const [when, setWhen] = useState(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16))
  return (
    <form onSubmit={(e) => { e.preventDefault(); onBook(new Date(when).toISOString()) }} className="flex flex-col gap-3">
      <p className="text-sm">{s.teacherName} teaches {s.learnerName} for {s.hours} hour{s.hours > 1 ? 's' : ''}. Booking reserves {s.hours} credit{s.hours > 1 ? 's' : ''} from {s.learnerName}.</p>
      <Field label="When">{(id) => <input id={id} type="datetime-local" className={inputCls} value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit">Book session</Button></div>
    </form>
  )
}

/** Tutor directory: what each student tutor teaches, their course and year, experience, topics and ratings. */
function Tutors({ onReview, initialQ = '' }) {
  const { db, me } = useApp()
  const [q, setQ] = useState(initialQ)
  const byTutor = new Map()
  for (const o of db.shared.offers) { if (!byTutor.has(o.userId)) byTutor.set(o.userId, []); byTutor.get(o.userId).push(o) }
  const list = [...byTutor.entries()].map(([id, offers]) => ({ id, name: offers[0].userName, offers, rating: tutorRating(db.shared, id) }))
    .filter((t) => !q.trim() || JSON.stringify(t.offers).toLowerCase().includes(q.trim().toLowerCase()) || t.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (b.rating.avg || 0) - (a.rating.avg || 0) || a.name.localeCompare(b.name))
  return (
    <Card>
      <CardTitle eyebrow="Student tutors">Find a tutor</CardTitle>
      <label className="mb-3 block"><span className="sr-only">Search tutors</span><input className={inputCls} placeholder="Search by subject, topic or name" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {list.length ? <ul className="grid gap-3 md:grid-cols-2">{list.map((t) => {
        const o = t.offers[0]
        return (
          <li key={t.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
            <div className="flex items-start gap-2.5">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-lime-soft text-[13px] font-bold text-brand">{t.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</span>
              <span className="min-w-0 flex-1 leading-tight"><b className="block text-[15px]">{t.name}{t.id === me.id ? ' (you)' : ''}</b><small className="text-[12.5px] text-muted">{[o.course, o.studyYear].filter(Boolean).join(' · ') || 'Course and year not given'}</small></span>
            </div>
            <span className="flex items-center gap-1.5 text-[12.5px]"><Stars value={t.rating.avg} /><span className="text-muted">{t.rating.avg == null ? 'No reviews yet' : `${t.rating.avg} · ${t.rating.count} review${t.rating.count === 1 ? '' : 's'}`}</span></span>
            <p className="text-[13px]"><b>Teaches:</b> {t.offers.map((x) => `${x.skill} (${x.level})`).join(', ')}</p>
            {t.offers.some((x) => x.topics?.length) && <ul className="flex flex-wrap gap-1">{[...new Set(t.offers.flatMap((x) => x.topics || []))].map((x) => <li key={x} className="rounded-md bg-ground px-2 py-0.5 text-[12px]">{x}</li>)}</ul>}
            <p className="text-[12.5px] text-[#33443B]"><b>Experience:</b> {t.offers.map((x) => x.qualifications).filter(Boolean).join(' · ') || 'Not provided'}</p>
            <div className="mt-auto flex justify-end"><Button size="sm" variant="secondary" icon="star" onClick={() => onReview({ userId: t.id, userName: t.name })}>{t.id === me.id ? 'See reviews' : 'Reviews & rating'}</Button></div>
          </li>)
      })}</ul> : <Empty icon="swap" title="No tutors found">Try another subject, or offer to teach something yourself.</Empty>}
    </Card>
  )
}

function TutorReviews({ tutor }) {
  const { db, me, runShared } = useApp()
  const { avg, list } = tutorRating(db.shared, tutor.userId)
  const mine = list.find((r) => r.userId === me.id)
  const [rating, setRating] = useState(mine?.rating || 0)
  const [text, setText] = useState(mine?.text || '')
  const [err, setErr] = useState('')
  const self = tutor.userId === me.id
  const save = (e) => { e.preventDefault(); const r = runShared((s) => saveTutorReview(s, tutor.userId, me, { rating, text }, new Date()), mine ? 'Review updated.' : 'Thanks — review posted.'); setErr(r.ok ? '' : r.error) }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2"><Stars value={avg} size={18} /><span className="text-[14px]">{avg == null ? 'No reviews yet' : <><b>{avg}</b> from {list.length} review{list.length === 1 ? '' : 's'}</>}</span></div>
      {!self && <form onSubmit={save} noValidate className="flex flex-col gap-2 rounded-xl border border-line p-3">
        <span className="text-[13px] font-medium">{mine ? 'Update your rating' : 'Your rating'}</span>
        <span className="flex gap-1" role="radiogroup" aria-label="Tutor rating">{[1, 2, 3, 4, 5].map((i) => <button type="button" role="radio" aria-checked={rating === i} aria-label={`${i} star${i > 1 ? 's' : ''}`} key={i} onClick={() => setRating(i)} className="press"><svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill={i <= rating ? '#E0A63A' : '#DCE3DD'} /></svg></button>)}</span>
        <label htmlFor="tutor-rev" className="sr-only">Review</label>
        <textarea id="tutor-rev" rows={2} maxLength={300} placeholder="How was the session? (optional)" className={cx(inputCls, 'py-2')} value={text} onChange={(e) => setText(e.target.value)} />
        {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
        <div className="flex justify-end gap-2">{mine && <Button type="button" size="sm" variant="secondary" className="!text-bad" onClick={() => { const r = runShared((s) => deleteTutorReview(s, mine.id, me), 'Review removed.'); if (r.ok) { setRating(0); setText('') } }}>Remove mine</Button>}<Button type="submit" size="sm">{mine ? 'Update review' : 'Post review'}</Button></div>
        <p className="text-[11.5px] text-muted">Demo: reviews are stored in this browser. A real deployment should only allow reviews after a completed session.</p>
      </form>}
      {list.length ? <ul className="flex flex-col gap-2">{list.map((r) => <li key={r.id} className="rounded-lg bg-ground px-3 py-2 text-[13.5px]"><span className="flex items-center gap-2"><Stars value={r.rating} size={12} /><b>{r.userName}</b>{r.demo && <Badge tone="demo">Sample</Badge>}</span>{r.text && <p className="mt-0.5">{r.text}</p>}</li>)}</ul> : <p className="text-[13px] text-muted">No reviews yet.</p>}
    </div>
  )
}

function OfferForm({ onDone }) {
  const { me, runShared } = useApp()
  const [f, setF] = useState({ skill: '', level: 'Beginner-friendly', course: me.branch || '', studyYear: me.year ? `Year ${me.year}` : '', qualifications: '', topics: '' })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = (e) => {
    e.preventDefault()
    const input = { ...f, topics: f.topics.split(',').map((x) => x.trim()).filter(Boolean) }
    const r = runShared((s) => addOffer(s, input, me), `You now offer ${f.skill.trim()}.`)
    if (r.ok) onDone(); else setErr(r.error)
  }
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Skill or subject">{(id) => <input id={id} maxLength={60} className={inputCls} placeholder="e.g. Python" value={f.skill} onChange={set('skill')} />}</Field>
        <Field label="Level">{(id) => <select id={id} className={inputCls} value={f.level} onChange={set('level')}>{['Beginner-friendly', 'Exam-focused', 'Hands-on', 'Advanced'].map((x) => <option key={x}>{x}</option>)}</select>}</Field>
        <Field label="Your course / branch">{(id) => <input id={id} maxLength={60} className={inputCls} value={f.course} onChange={set('course')} />}</Field>
        <Field label="Your year">{(id) => <input id={id} maxLength={40} className={inputCls} placeholder="e.g. Second year (SE)" value={f.studyYear} onChange={set('studyYear')} />}</Field>
      </div>
      <Field label="Qualifications / experience">{(id) => <textarea id={id} rows={2} maxLength={200} className={cx(inputCls, 'py-2')} placeholder="e.g. Top scorer in FE C programming; club mentor" value={f.qualifications} onChange={set('qualifications')} />}</Field>
      <Field label="Topics you can teach (comma-separated)">{(id) => <input id={id} className={inputCls} placeholder="Pointers, Arrays, File handling" value={f.topics} onChange={set('topics')} />}</Field>
      {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit">Publish offer</Button></div>
    </form>
  )
}
