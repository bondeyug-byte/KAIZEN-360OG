import { useEffect, useState } from 'react'
import Layout from './components/Layout.jsx'
import { Toasts, Spinner } from './components/ui.jsx'
import { useApp, profileCompletion } from './store/AppContext.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Planner from './pages/Planner.jsx'
import Rides from './pages/Rides.jsx'
import Challenges from './pages/Challenges.jsx'
import Directory from './pages/Directory.jsx'
import Events from './pages/Events.jsx'
import Peer from './pages/Peer.jsx'
import Profile from './pages/Profile.jsx'
import NavigatorPage from './pages/NavigatorPage.jsx'
import Commute from './pages/Commute.jsx'
import Assistant from './assistant/Assistant.jsx'
import About from './pages/About.jsx'
import Organiser from './pages/Organiser.jsx'
import TeacherPortal from './pages/TeacherPortal.jsx'
import Classwork from './pages/Classwork.jsx'
import AttendancePage from './pages/Attendance.jsx'
import Canteen from './pages/Canteen.jsx'
import Notes from './pages/Notes.jsx'
import Admin from './pages/Admin.jsx'
import Landing from './pages/Landing.jsx'
import Tour from './components/Tour.jsx'
import { isStudent } from './lib/posts.js'
import { canAccess, roleOf, ROLE_LABEL } from './lib/roles.js'
import { hasAcademicIdentity } from './data/academics.js'
import { NotificationsPage } from './components/Notifications.jsx'

// Hash routing works on any static host and inside a single offline HTML file.
function parseHash() {
  const h = window.location.hash.replace(/^#/, '') || '/'
  const [path, qs] = h.split('?')
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) }
}
export const go = (path) => { window.location.hash = path }

const PUBLIC = ['/directory', '/events', '/navigator', '/commute', '/about', '/login', '/welcome', '/canteen']

export default function App() {
  const { session, toasts, me, signedIn } = useApp()
  const [loc, setLoc] = useState(parseHash)
  useEffect(() => {
    const on = () => { setLoc(parseHash()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  // Freshly verified students with an empty profile go to onboarding first.
  useEffect(() => {
    if (signedIn && me && !me.demo && isStudent(me) && (!hasAcademicIdentity(me) || profileCompletion(me).pct < 60) && loc.path !== '/profile') go('/profile?onboard=1')
  }, [signedIn, me, loc.path])

  if (session.status === 'loading') return <div className="grid min-h-screen place-items-center"><Spinner label="Starting Campus360…" /></div>

  // Public landing page: at "/" for visitors, and at "/welcome" for everyone.
  if (loc.path === '/welcome' || (loc.path === '/' && !signedIn)) return (<><Landing /><Assistant route="/welcome" /><Toasts toasts={toasts} /></>)
  const needsAuth = !PUBLIC.includes(loc.path)
  if (loc.path === '/login' || (needsAuth && !signedIn)) {
    return (<><Login next={loc.path === '/login' ? '/' : loc.path} /><Assistant route={loc.path} /><Toasts toasts={toasts} /></>)
  }

  const pages = {
    '/': me?.role === 'organiser' ? <Organiser query={loc.query} /> : me?.role === 'teacher' ? <TeacherPortal query={loc.query} /> : me?.role === 'admin' ? <Admin /> : <Dashboard query={loc.query} />,
    '/teacher': <TeacherPortal query={loc.query} />, '/classwork': <Classwork query={loc.query} />, '/attendance': <AttendancePage />, '/canteen': <Canteen query={loc.query} />, '/notes': <Notes query={loc.query} />, '/admin': <Admin />, '/organiser': <Organiser query={loc.query} />, '/notifications': <NotificationsPage />, '/planner': <Planner query={loc.query} />, '/rides': <Rides query={loc.query} />, '/challenges': <Challenges query={loc.query} />, '/directory': <Directory />,
    '/events': <Events query={loc.query} />, '/peer': <Peer query={loc.query} />, '/profile': <Profile query={loc.query} />, '/navigator': <NavigatorPage query={loc.query} />, '/commute': <Commute query={loc.query} />, '/about': <About />,
  }
  // Route-level permission: a page outside this role's portal is never rendered, whatever the URL says.
  const known = !!pages[loc.path]
  const allowed = !known || !signedIn || canAccess(me, loc.path)
  const page = !allowed ? (
    <div className="py-16 text-center" role="alert">
      <h1 className="font-display text-3xl font-bold">Not part of the {ROLE_LABEL[roleOf(me)]} portal</h1>
      <p className="mx-auto mt-2 max-w-md text-muted">This page belongs to another role, so it isn't available with your account. In this demo the check runs in the app; a production server must enforce it too.</p>
      <a className="mt-4 inline-block font-semibold text-maroon" href="#/">Back to your home page</a>
    </div>
  ) : pages[loc.path] || (
    <div className="py-16 text-center"><h1 className="font-display text-3xl font-bold">Page not found</h1><a className="mt-3 inline-block font-semibold text-maroon" href="#/">Back to the dashboard</a></div>
  )
  return (
    <>
      <Layout route={loc.path} full={loc.path === '/navigator'}>{page}</Layout>
      <Assistant route={loc.path} inApp />
      <Tour route={loc.path} />
      <Toasts toasts={toasts} />
    </>
  )
}
