import { PageHeader, Card, CardTitle, Badge, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { STATIONS, NETWORK_SOURCE } from '../lib/journey.js'
import { KNOWLEDGE } from '../assistant/knowledge.js'
import { allPlaces } from '../navigator/building.js'

// What makes Campus360 different, where every piece of data comes from, and the feature audit — written so a
// reviewer can check claims quickly. Statuses here are kept honest: "Needs key" / "Sample" mean exactly that.
const UNIQUE = [
  { icon: 'mic', title: 'Voice assistant that acts', text: 'Ask in English, Hinglish, Hindi or Marathi. It answers from your own timetable, deadlines and campus data, speaks back, and books seats or registers you only after you confirm. Gemini → Claude → ChatGPT fallback, plus an offline mode that still works with no internet.' },
  { icon: 'cube', title: '3D campus you can walk', text: 'The VESIT main block modelled from photos and video: the curved courtyard face, the recessed two-storey amphitheatre terrace, lifts, stairs and every floor. Turn-by-turn routes follow corridors and real vertical connections.' },
  { icon: 'train', title: 'Door-to-door commute', text: `Plan from any of ${STATIONS.length} Central, Harbour, Trans-Harbour or Uran-line stations to campus, with changes shown, timetable times for every train through Kurla and Chembur, and the last bus to the gate.` },
  { icon: 'shield', title: 'Honest by design', text: 'Every fact carries its source. Sample data, estimates and placeholders are labelled on screen. No fake live trains, fake GPS or invented contacts.' },
  { icon: 'layers', title: 'One app for the whole first year', text: 'Marks-needed calculator and SGPA target check, ride sharing with seat confirmation, class challenges, peer learning with time credits, events and a who-to-contact directory.' },
  { icon: 'bot', title: 'Open to other AIs (MCP)', text: 'The same campus tools are published as an MCP server, so students can ask Claude or ChatGPT about rooms, routes and trains straight from those apps.' },
]

const DATA = [
  ['Trains (times)', 'Central Railway public timetables, April 2026', 'Verified source', 'ok'],
  ['Stations & lines', `${NETWORK_SOURCE.text}; checked ${NETWORK_SOURCE.checked}`, 'Verified source', 'ok'],
  ['BEST buses', 'Moovit stop pages + VES "how to reach" page', 'Partial: waits are estimates', 'warn'],
  ['Campus facts', `${KNOWLEDGE.filter((k) => k.verified).length} sourced entries (Wikipedia, VES)`, 'Verified source', 'ok'],
  ['Building shape', 'Photos and walkthrough videos', 'Inferred from photos', 'warn'],
  ['Room numbers & labs', `${allPlaces().length} mapped spaces; labs west, classrooms east (team rule)`, 'Placeholder', 'demo'],
  ['Notifications, requests, uploads', 'Stored in this browser (files in IndexedDB)', 'Single device', 'warn'],
  ['Faculty, seniors, events, rides', 'Fictional demo records', 'Sample', 'demo'],
  ['Grading scale', 'Editable demo scale', 'Not official', 'demo'],
]

const AUDIT = [
  ['Dashboard: lectures, deadlines, stats, recommendations, quick help', 'Pass'],
  ['Academic planner: marks needed, locked grades, SGPA, target, what-if', 'Pass'],
  ['Rides: offer, request, confirm, withdraw, station pickup', 'Pass'],
  ['Rides map: pins, show on map, click-to-place, my location, directions', 'Pass'],
  ['Public landing page with live 3D preview, trains and events', 'Pass'],
  ['Journey planner: search incl. "Dombili", changes, chained times', 'Pass'],
  ['Trains at Kurla/Chembur, BEST buses near campus', 'Pass'],
  ['3D navigator: search, nearest, routes, lift/stairs, walk, top-down, legend', 'Pass'],
  ['Labs on the left (west), classrooms on the right (east), furnished differently', 'Pass'],
  ['Weekly timetable: Monday–Sunday tabs, room type, route to each room', 'Pass'],
  ['Notification centre: bell, unread count, mark read, opens the record', 'Pass'],
  ['Event requests: form, review, organiser approve / reject / waitlist', 'Pass'],
  ['Challenge briefs (PDF / images) and solution uploads with review', 'Pass'],
  ['Teacher portal: division-targeted assignments, challenges, notices, documents', 'Pass'],
  ['Attendance per lecture: hashed edit password, audit log, student summaries', 'Pass'],
  ['VESIT & VESIM canteens: filters, numeric price sort, reviews', 'Pass'],
  ['Notes library: year › branch › subject › chapter › subtopic, reports', 'Pass'],
  ['Notifications and approvals across devices', 'Needs shared backend'],
  ['Server-side storage and permissions (database phase)', 'Needs shared backend'],
  ['Mobile bottom sheet (drag or tap), sliding tabs and panels', 'Pass'],
  ['Challenges & live leaderboard, peer credits & sessions, events', 'Pass'],
  ['Voice assistant: offline mode, confirmations, 4 languages', 'Pass'],
  ['Voice assistant: live Gemini / Claude / ChatGPT', 'Needs API key'],
  ['Phone OTP sign-in (MiniMoth)', 'Needs API key'],
  ['MCP server for Claude / ChatGPT', 'Needs deployment'],
]

export default function About() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back title="About Campus360" subtitle="What it does, what makes it different, where the data comes from, and what has been tested." />
      <section aria-label="What makes it different" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {UNIQUE.map((u) => (
          <Card key={u.title} interactive>
            <span className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-maroon-50 text-maroon ring-1 ring-maroon/10"><Icon name={u.icon} size={19} /></span>
            <h2 className="font-display text-[16px] font-semibold">{u.title}</h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{u.text}</p>
          </Card>
        ))}
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle eyebrow="Transparency">Where the data comes from</CardTitle>
          <ul className="flex flex-col divide-y divide-line">
            {DATA.map(([what, src, status, tone]) => (
              <li key={what} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13.5px]">
                <span className="min-w-0"><b className="block font-semibold">{what}</b><span className="text-[12.5px] text-muted">{src}</span></span>
                <Badge tone={tone}>{status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle eyebrow="Checked in a real browser">Feature audit</CardTitle>
          <ul className="flex flex-col gap-1.5">
            {AUDIT.map(([f, st]) => (
              <li key={f} className="flex items-start gap-2.5 text-[13.5px]">
                <span className={cx('mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full', st === 'Pass' ? 'bg-[#E7F4EC] text-ok' : 'bg-[#FDF3E2] text-warn')}><Icon name={st === 'Pass' ? 'check' : 'clock'} size={12} stroke={2.6} /></span>
                <span className="min-w-0 flex-1">{f}</span>
                <span className={cx('flex-none text-[12px] font-semibold', st === 'Pass' ? 'text-ok' : 'text-warn')}>{st}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted">Unit, server and browser tests run on every change; physical phones and live OTP delivery are tested separately.</p>
        </Card>
      </div>
      <Card>
        <CardTitle eyebrow="Credits">Open-source software, fonts and map data</CardTitle>
        <ul className="grid gap-x-6 gap-y-1 text-[13.5px] sm:grid-cols-2">
          {[['React and React DOM 18.3', 'MIT licence, © Meta Platforms'], ['three.js 0.160', 'MIT licence, © three.js authors'], ['Leaflet 1.9.4', 'BSD 2-Clause licence, © Volodymyr Agafonkin, CloudMade'], ['fflate 0.8', 'MIT licence, © Arjun Barrett'], ['IBM Plex Sans and Mono', 'SIL Open Font Licence 1.1, © IBM'], ['Map tiles and data', '© OpenStreetMap contributors (ODbL), © CARTO']].map(([a, b]) => <li key={a} className="flex flex-wrap justify-between gap-2 border-t border-line py-1.5"><b className="font-semibold">{a}</b><span className="text-muted">{b}</span></li>)}
        </ul>
        <p className="mt-3 text-[12.5px] text-muted">Campus photographs: source and permission to be confirmed by the project team before public launch. <a href="#/privacy" className="font-semibold text-maroon">Privacy notice</a> · <a href="#/terms" className="font-semibold text-maroon">Terms</a></p>
      </Card>
    </div>
  )
}
