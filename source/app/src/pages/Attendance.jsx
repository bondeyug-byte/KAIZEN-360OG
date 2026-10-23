import { useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Badge, Empty, Spinner, Button, relTime, cx } from '../components/ui.jsx'
import { MARK } from '../lib/attendance.js'
import { useStudentAttendance, refreshMyRecord } from '../lib/record.js'
import { isStudent } from '../lib/posts.js'

const fmtPct = (x) => (x == null ? 'n/a' : `${x}%`)
const below = (x, t) => t != null && x != null && x < t

/** A student's own attendance only, computed from saved lecture records (never typed in as a percentage). */
export default function Attendance() {
  const { me, now } = useApp()
  const att = useStudentAttendance()
  const [subject, setSubject] = useState('all')
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now).slice(0, 7))
  if (!isStudent(me)) return <div className="py-8"><Empty icon="lock" title="Students only">Teachers record attendance in the Teacher portal.</Empty></div>
  const header = <PageHeader back title="My attendance" subtitle="Present ÷ recorded lectures × 100. Lectures that were cancelled or not recorded are not counted. Only your teachers can change a record." />
  if (att.source === 'server' && att.status === 'loading') return <div>{header}<Spinner label="Loading your attendance" /></div>
  if (att.source === 'server' && att.status === 'error' && !att.sum) return <div>{header}<Card><p role="alert" className="text-[14px] text-bad">Couldn’t load your attendance: {att.message}</p><Button className="mt-3" size="sm" variant="secondary" onClick={refreshMyRecord}>Try again</Button></Card></div>
  if (att.source === 'server' && att.record && !att.record.enrolled) return <div>{header}<Empty icon="user" title="Join your class first">Attendance appears once your class is approved. <a className="font-semibold text-maroon underline" href="#/portal?tab=class">Go to My class</a></Empty></div>
  const sum = att.sum, t = att.threshold
  const rows = sum.rows.filter((r) => subject === 'all' || r.subject === subject)
  return (
    <div>
      {header}
      <SourceLine att={att} />
      {!sum.overall.total ? <Empty icon="check" title="No attendance recorded yet">Your percentage appears once a teacher records a lecture for {me.division || 'your division'}.</Empty> : <>
        <AttendanceSummary sum={sum} threshold={t} />
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <Card>
            <CardTitle eyebrow="Subject-wise">By subject</CardTitle>
            <ul className="flex flex-col gap-3">{sum.bySubject.map((s) => (
              <li key={s.subject}><div className="flex items-center justify-between text-[14px]"><span className="font-semibold">{s.subject}</span><span><b className={below(s.pct, t) ? 'text-bad' : 'text-ink'}>{fmtPct(s.pct)}</b> <small className="text-muted">{s.present}/{s.total}</small></span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand"><div className={cx('h-full rounded-full', below(s.pct, t) ? 'bg-bad' : 'bg-brand')} style={{ width: `${s.pct}%` }} /></div></li>))}</ul>
            <p className="mt-3 text-[12px] text-muted">{t == null ? 'Your HOD has not set an attendance requirement in Campus360, so no subject is flagged.' : att.thresholdIsReference ? `Sample data: ${t}% is shown only as a reference line, not a college rule.` : `Flagged below ${t}%, the requirement your HOD set for your branch.`}</p>
          </Card>
          <MonthCalendar rows={sum.rows} month={month} setMonth={setMonth} />
        </div>
        <Card className="mt-5">
          <CardTitle eyebrow="Lecture by lecture" action={<select aria-label="Filter by subject" className="min-h-[36px] rounded-lg border border-line2 bg-surface px-2 text-[13px]" value={subject} onChange={(e) => setSubject(e.target.value)}><option value="all">All subjects</option>{sum.bySubject.map((s) => <option key={s.subject}>{s.subject}</option>)}</select>}>History</CardTitle>
          <ul className="flex flex-col divide-y divide-line">{rows.map((r) => <li key={r.id} className="flex items-center gap-3 py-2 text-[14px]"><span className="w-[150px] flex-none font-mono text-[13px]">{r.date} {r.start}</span><span className="min-w-0 flex-1 truncate">{r.subject}{r.division && r.division !== me.division ? <small className="ml-1 text-muted">({r.division})</small> : null}</span><Badge tone={r.mark === 'P' ? 'ok' : 'bad'}>{MARK[r.mark]}</Badge></li>)}</ul>
        </Card>
      </>}
    </div>
  )
}

/** Where the numbers come from and how fresh they are. */
export function SourceLine({ att }) {
  if (att.source === 'demo') return <p className="mb-4 text-[12.5px] text-muted">Sample data in this browser (demo account).</p>
  return (
    <p className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
      {att.stale ? <Badge tone="warn">Couldn’t refresh: showing the last copy</Badge> : null}
      <span>From your teachers’ records on the college server{att.at ? `, updated ${relTime(new Date(att.at).toISOString())}` : ''}.</span>
      <button type="button" className="font-semibold text-maroon underline-offset-2 hover:underline" onClick={refreshMyRecord}>Refresh</button>
    </p>
  )
}

export function AttendanceSummary({ sum, compact, threshold = null }) {
  const cards = [['Overall', sum.overall], ['This week', sum.week], ['This month', sum.month], ['This year', sum.year]]
  return (
    <div className={cx('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4')}>
      {cards.map(([l, a]) => (
        <div key={l} className="rounded-xl border border-line bg-surface p-4">
          <small className="text-[12px] font-semibold text-muted">{l}</small>
          <b className={cx('mt-1 block font-display text-[26px] font-semibold leading-none tabular-nums', below(a.pct, threshold) ? 'text-bad' : 'text-ink')}>{fmtPct(a.pct)}</b>
          <small className="mt-1.5 block text-[12px] text-muted">{a.total ? `${a.present} present · ${a.absent} absent` : 'No lectures recorded'}</small>
        </div>
      ))}
    </div>
  )
}

function MonthCalendar({ rows, month, setMonth }) {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = (first.getUTCDay() + 6) % 7
  const byDate = {}
  for (const r of rows) if (r.date.startsWith(month)) (byDate[r.date] = byDate[r.date] || []).push(r)
  const shift = (k) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); setMonth(d.toISOString().slice(0, 7)) }
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between"><button onClick={() => shift(-1)} aria-label="Previous month" className="press min-h-[40px] min-w-[40px] rounded-lg text-[18px] hover:bg-ground">‹</button><b className="font-display text-[16px]">{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first)}</b><button onClick={() => shift(1)} aria-label="Next month" className="press min-h-[40px] min-w-[40px] rounded-lg text-[18px] hover:bg-ground">›</button></div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => <span key={'x' + i} />)}
        {Array.from({ length: days }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`, list = byDate[date] || []; const p = list.filter((r) => r.mark === 'P').length; return (
          <span key={date} title={list.map((r) => `${r.start} ${r.subject}: ${MARK[r.mark]}`).join('\n') || 'No recorded lectures'} className={cx('flex aspect-square flex-col items-center justify-center rounded-lg text-[12.5px]', list.length ? (p === list.length ? 'bg-[#E7F4EC] text-ok' : p === 0 ? 'bg-[#FBEDEA] text-bad' : 'bg-[#FDF0D8] text-warn') : 'bg-ground/60 text-muted')}>
            <b>{i + 1}</b>{list.length > 0 && <small className="text-[10px]">{p}/{list.length}</small>}
          </span>) })}
      </div>
      <p className="mt-2 flex flex-wrap gap-3 text-[11.5px] text-muted"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-[#E7F4EC]" />all present</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-[#FDF0D8]" />some absent</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-[#FBEDEA]" />absent</span><span>grey = no recorded lecture</span></p>
    </Card>
  )
}
