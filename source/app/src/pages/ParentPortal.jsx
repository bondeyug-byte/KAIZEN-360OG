// Parent Portal: read-only view of the child (or children) the college confirmed for this Google account.
// Every value comes from the server (api/_records.js), which re-checks the parent ↔ student link on each request.
import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { Card, CardTitle, Badge, Empty, Spinner, Button, relTime, cx } from '../components/ui.jsx'
import { api } from '../lib/portal.js'
import { RecordView } from '../components/Records.jsx'

const KIND = { alert: ['Alert', 'bad'], marks: ['Marks', 'ok'], notice: ['Notice', 'neutral'], event: ['Event', 'neutral'], 'event-cancelled': ['Event cancelled', 'bad'] }

export default function ParentPortal() {
  const { session, me } = useApp()
  const [kids, setKids] = useState(null), [err, setErr] = useState(''), [child, setChild] = useState(''), [rec, setRec] = useState(null), [loading, setLoading] = useState(false), [stamp, setStamp] = useState(null)
  const cloud = session.mode === 'google'
  useEffect(() => {
    if (!cloud) return
    api('parent-children').then((r) => { setKids(r.children); if (r.children[0]) setChild((c) => c || r.children[0].id) }).catch((e) => setErr(e.message))
  }, [cloud])
  const load = (id = child) => { if (!id) return; setLoading(true); setErr(''); api('parent-record', { query: { child: id } }).then((r) => { setRec(r); setStamp(new Date()) }).catch((e) => setErr(e.message)).finally(() => setLoading(false)) }
  useEffect(() => { setRec(null); load(child) }, [child]) // eslint-disable-line
  // refresh when the parent comes back to the tab (published changes show up without a manual reload)
  useEffect(() => { const on = () => { if (document.visibilityState === 'visible' && stamp && Date.now() - stamp > 60000) load() }; document.addEventListener('visibilitychange', on); return () => document.removeEventListener('visibilitychange', on) })
  const seen = async () => { try { await api('parent-seen', { method: 'POST', body: { child } }); load() } catch (e) { setErr(e.message) } }

  if (!cloud) return <Empty icon="lock" title="The Parent portal needs the college server">Sign in on the Parent tab with the Google account your child added and their class teacher confirmed. There is no demo parent account because this view shows a real student's record.</Empty>
  if (err && !rec) return <Card><p role="alert" className="text-[14px] text-bad">{err}</p><Button className="mt-3" size="sm" variant="secondary" onClick={() => load()}>Try again</Button></Card>
  if (!kids) return <Spinner label="Loading your child's record" />
  if (!kids.length) return <Empty icon="user" title="No confirmed student yet">Your child adds your Google account email in Campus360 (College portal → My class), then their class teacher confirms it.</Empty>
  const news = rec?.whatsNew
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-[28px] font-semibold leading-tight">Parent portal</h1><p className="text-[13.5px] text-muted">Hello{me?.name ? ` ${me.name}` : ''}. Read-only: attendance and marks come from teachers; alerts and events from the HOD.{stamp ? ` Updated ${relTime(stamp.toISOString())}.` : ''}</p></div>
        {kids.length > 1 && <div role="tablist" aria-label="Choose your child" className="flex gap-1 rounded-xl bg-sand p-1">{kids.map((k) => <button key={k.id} role="tab" aria-selected={child === k.id} onClick={() => setChild(k.id)} className={cx('press min-h-[40px] rounded-lg px-3 text-[13.5px] font-semibold', child === k.id ? 'bg-surface shadow-card' : 'text-muted')}>{k.name || 'Student'}{k.division_code ? ` · ${k.division_code}` : ''}</button>)}</div>}
      </div>
      {news && (news.items.length > 0 || news.newAttendance > 0) && (
        <Card className="border-l-4 border-l-maroon">
          <CardTitle eyebrow={news.since ? `New since ${relTime(news.since)}` : 'New for you'} action={<Button size="sm" variant="secondary" onClick={seen}>Mark all as seen</Button>}>{news.items.length + (news.newAttendance ? 1 : 0)} updates</CardTitle>
          <ul className="mt-2 flex flex-col gap-1.5 text-[13.5px]">
            {news.newAttendance > 0 && <li className="flex items-center gap-2"><Badge>Attendance</Badge>{news.newAttendance} lecture{news.newAttendance > 1 ? 's' : ''} recorded or corrected</li>}
            {news.items.map((n) => <li key={n.kind + n.id} className="flex items-center gap-2"><Badge tone={KIND[n.kind][1]}>{KIND[n.kind][0]}</Badge><span className="truncate">{n.title}</span><span className="ml-auto shrink-0 text-[12px] text-muted">{relTime(n.at)}</span></li>)}
          </ul>
        </Card>)}
      {err && <p role="alert" className="text-[13.5px] text-bad">{err}</p>}
      {loading && !rec ? <Spinner label="Loading" /> : rec && (rec.enrolled ? <RecordView rec={rec} audience="parent" /> : <Empty icon="user" title="Not in a class right now">This student isn't in an active class, so there is nothing to show.</Empty>)}
    </div>
  )
}
