import { useEffect, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Badge, Empty, Segmented, Spinner } from '../components/ui.jsx'
import { MyClass, Feed, MyTimetable, JoinRequests, Composer, ReminderForm, Reminders, Roster, MyPosts } from '../components/CloudPortal.jsx'

/**
 * Student College portal (server data). Class representatives get extra "CR Tools" here — CR is not a separate
 * login. Teachers use the Teacher portal and HODs the HOD portal. The server re-checks every action.
 */
export default function Portal({ query = {} }) {
  const { session, sync, me } = useApp()
  const cr = session.cr || []
  const tabs = [['class', 'My class'], ['feed', 'From teachers'], ['tt', 'Timetable'], ...(cr.length ? [['cr', 'CR Tools']] : [])]
  const [tab, setTab] = useState(query.tab || null)
  useEffect(() => { if (query.tab) setTab(query.tab) }, [query.tab])
  const active = tabs.find((t) => t[0] === tab) ? tab : session.enrollment ? 'feed' : 'class'
  if (session.mode !== 'minimoth') return <div className="py-10"><Empty icon="lock" title="Sign in with your phone">The college portal keeps your class, notices and timetable on the college server so they appear on every device. Demo accounts can’t use it.</Empty></div>
  if (me?.role === 'teacher') return <div className="py-10"><Empty icon="shield" title="Teachers use the Teacher portal">Join requests, posting, instructions and the Timetable Schedule are in the <a className="font-semibold text-maroon underline" href="#/teacher">Teacher portal</a>.</Empty></div>
  if (me?.role === 'hod') return <div className="py-10"><Empty icon="shield" title="Open the HOD portal">Your tools are in the <a className="font-semibold text-maroon underline" href="#/hod">HOD portal</a>.</Empty></div>
  if (!session.cloud) return <div className="py-10">{sync?.status === 'loading' ? <Spinner label="Connecting to the college server" /> : <Empty icon="refresh" title="College server not reachable">{sync?.message || 'Try again in a moment.'}</Empty>}</div>
  return (
    <div>
      <PageHeader title="College portal" subtitle="Your class, timetable, notices and reminders — the same on every device."
        actions={<Badge tone={session.enrollment ? 'ok' : 'warn'}>{session.enrollment ? session.enrollment.division_code : session.joinRequest?.status === 'pending' ? 'Request pending' : 'Not in a class yet'}{cr.length ? ' · Class rep' : ''}</Badge>} />
      <div className="mb-4 overflow-x-auto"><Segmented label="Portal section" value={active} onChange={setTab} options={tabs.map(([value, label]) => ({ value, label }))} /></div>
      {active === 'class' && <MyClass />}
      {active === 'feed' && <Feed />}
      {active === 'tt' && <MyTimetable />}
      {active === 'cr' && <CrTools division={cr[0]} />}
    </div>
  )
}

function CrTools({ division }) {
  const [tab, setTab] = useState('requests')
  return (
    <div>
      <p className="mb-3 text-[13.5px] text-muted">Class representative of <Badge tone="info">{division}</Badge> — you can manage this class only.</p>
      <div className="mb-4 overflow-x-auto"><Segmented label="CR tools" value={tab} onChange={setTab} options={[{ value: 'requests', label: 'Join requests' }, { value: 'notice', label: 'Post notice' }, { value: 'reminder', label: 'Set reminder' }, { value: 'list', label: 'Class list' }, { value: 'mine', label: 'My posts' }]} /></div>
      {tab === 'requests' && <JoinRequests title={`Join requests for ${division}`} />}
      {tab === 'notice' && <Composer crDivision={division} />}
      {tab === 'reminder' && <div className="grid gap-4 xl:grid-cols-2"><ReminderForm divisions={[division]} /><Reminders /></div>}
      {tab === 'list' && <Roster division={division} />}
      {tab === 'mine' && <MyPosts />}
    </div>
  )
}
