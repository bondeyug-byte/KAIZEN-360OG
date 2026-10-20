// Campus knowledge base for the assistant ("training" by grounding, not fine-tuning).
// Every entry carries its source. `verified: true` = taken from a public source listed in `source`;
// `verified: false` = how this app works, or a demo/placeholder that must be presented as such.
// Last checked: 15 Oct 2026. Update entries here; the assistant and the MCP server both read this file.

const WIKI = 'Wikipedia — Vivekanand Education Society\'s Institute of Technology (checked 15 Oct 2026)'
const VES = 'VES — how to reach the Collector Colony campus, vbs.ves.ac.in/contact-vbs (checked 15 Oct 2026)'
const APP = 'Campus360 app behaviour'

export const KNOWLEDGE = [
  { id: 'about', title: 'About VESIT', tags: 'vesit about college institute history established founded university affiliation autonomous ves society principal chairman', verified: true, source: WIKI,
    text: "VES Institute of Technology (VESIT) was established in 1984 by the Vivekanand Education Society. It is affiliated to the University of Mumbai, and the UGC granted it autonomous status for ten years from 13 December 2023. Wikipedia lists the principal as J. M. Nair and the chairman as B. L. Boolani; check the college website for current office-holders." },
  { id: 'address', title: 'Address and campus', tags: 'address where location campus collector colony chembur pin code hashu advani complex map building c-shaped shared pharmacy management hostel', verified: true, source: `${WIKI}; ${VES}`,
    text: 'The campus is the Hashu Advani Memorial Complex, Collector Colony, Chembur (East), Mumbai 400074. The engineering college is the C-shaped building; the complex also houses the VES College of Pharmacy, the management college and hostels. VESIT moved here in December 2010.' },
  { id: 'floors', title: 'What is on each floor', tags: 'floor floors ground first second library canteen admin office principal exam examination cell department hod open section terrace amphitheatre', verified: true, source: WIKI,
    text: 'Ground floor: administrative office, principal\'s office, examination department and canteen. First floor: library. Second floor: the open section, a colonnaded terrace facing the courtyard. Each upper floor is allotted to one department, but the public description does not say which department is on which floor, so the app shows those as placeholders.' },
  { id: 'reach-chembur', title: 'Getting here from Chembur station', tags: 'reach how to get come travel chembur station harbour bus 364 auto walk chembur camp distance', verified: true, source: VES,
    text: 'Chembur station is on the Harbour line, about 3.3 km from campus. From Chembur (East) take BEST bus 364 to the Chembur Camp stop, then walk about 10 minutes. Autos are also available.' },
  { id: 'reach-kurla', title: 'Getting here from Kurla station', tags: 'reach how to get come travel kurla station central main line bus 432 auto walk vivekanand college stop distance', verified: true, source: VES,
    text: 'Kurla is on the Central main line and the Harbour line, about 3.9 km from campus. From Kurla (East) bus station take BEST bus 432 to the Vivekanand College stop, then walk about 9 minutes. Autos are also available. Harbour-line passengers can also change at Kurla for Chembur.' },
  { id: 'airport', title: 'Distance to the airport', tags: 'airport flight csmia distance', verified: true, source: VES,
    text: 'Chhatrapati Shivaji Maharaj International Airport is about 12.7 km from the campus.' },
  { id: 'labs', title: 'Industry labs', tags: 'lab labs labview national instruments cloudera big data cadence vlsi e-yantra iit bombay embedded industry', verified: true, source: WIKI,
    text: 'Public sources list an NI LabVIEW Academy (National Instruments), a Big Data Analytics lab (Cloudera), a VLSI design lab (Cadence) and an e-Yantra embedded systems lab supported by IIT Bombay. Room numbers for labs in this app are placeholders.' },
  { id: 'praxis', title: 'Praxis tech fest', tags: 'fest festival praxis technical event annual competition workshop', verified: true, source: WIKI,
    text: 'Praxis is VESIT\'s annual inter-collegiate technical festival, with workshops, competitions and lectures. Dates are announced by the college each year.' },
  { id: 'trains', title: 'Local train timings in the app', tags: 'train trains local timetable m-indicator schedule live delay platform kurla chembur', verified: true, source: 'Central Railway public timetable PDFs (April 2026)',
    text: 'The Trains & buses page uses Central Railway\'s published timetable (April 2026) for every train stopping at Kurla or Chembur. Times are scheduled, not live; delays and platform numbers are not available. Sunday and holiday services are not separated.' },
  { id: 'buses', title: 'BEST buses near campus', tags: 'bus buses best 501 361 362 364 381 432 chembur colony stop chalo live timing frequency', verified: true, source: 'Moovit stop pages and VES contact page (checked 15 Oct 2026)',
    text: 'Routes at the Chembur Colony stop include 501 LTD (Kurla–Airoli), 361 and 363 (Kurla–Mahul), A-362 (Deonar–Kurla), A-381 (Ghatkopar–Mahul) and others. BEST does not publish full-day timetables, so the app shows printed early-morning departures or a frequency estimate. Use the BEST Chalo app for live arrivals.' },
  // ---- how the app works ----
  { id: 'app-planner', title: 'Academic planner', tags: 'planner marks grade sgpa cgpa target pass fail internal external what-if cutoff grading scale', verified: false, source: APP,
    text: 'The planner shows, for each subject, the marks needed in the remaining assessment for each grade (required total minus internal marks), locks grades that are no longer possible, computes credit-weighted SGPA and checks whether a target SGPA is still achievable. The grading scale is a demo scale you can edit; it is not an official university rule.' },
  { id: 'app-rides', title: 'Ride sharing', tags: 'ride rides carpool share seat request confirm driver pool auto bike', verified: false, source: APP,
    text: 'Students offer rides with a pickup, destination, time and seats. Others request a seat (Requested) and the driver confirms it (Confirmed). Rides in the demo are sample records; pickups can be any place or railway station.' },
  { id: 'app-peer', title: 'Peer learning credits', tags: 'peer learning credit credits teach learn session book match tutor', verified: false, source: APP,
    text: 'Teach 1 hour to earn 1 credit; learn 1 hour to spend 1 credit. Booking reserves the learner\'s credits; they move only when the session is completed and are released if it is cancelled.' },
  { id: 'app-challenges', title: 'Class challenges', tags: 'challenge challenges points leaderboard class rank complete', verified: false, source: APP,
    text: 'Anyone can post a challenge for a class. Completing it once adds its points to your class; the leaderboard is calculated from recorded completions.' },
  { id: 'app-events', title: 'Event statuses', tags: 'event events register registration open starting soon live ended', verified: false, source: APP,
    text: 'Events show Registration Open, Starting Soon (within 2 hours, or registration closed), Live Now or Event Ended, worked out from their times. Events in the demo are samples.' },
  { id: 'app-navigator', title: '3D campus navigator', tags: 'navigator 3d map route directions find room lift stairs washroom walk mode floor plan', verified: false, source: APP,
    text: 'The navigator routes along the building\'s corridors, lifts and stairs, with step-by-step directions. Walking times are estimates. There is no indoor GPS: you set where you are, and during navigation the marker walks at a typical pace. Room numbers are placeholders until the college confirms them.' },
  { id: 'app-signin', title: 'Sign-in and privacy', tags: 'sign in login otp phone verify verified enrolment privacy data demo account', verified: false, source: APP,
    text: 'Sign-in uses a one-time code to your phone, which proves you control the number, not that you are enrolled. Your planner, deadlines and choices are stored in your own browser. Demo sign-in uses fictional sample students.' },
  { id: 'app-contacts', title: 'Contacts in the directory', tags: 'contact faculty teacher professor hod mentor senior phone email directory who', verified: false, source: APP,
    text: 'The directory\'s people, phone numbers and emails are fictional samples for the demo. Office locations follow the public floor description. Ask the department office for real contacts.' },
  { id: 'emergency', title: 'Emergency', tags: 'emergency help police ambulance fire hurt injured unsafe 112', verified: true, source: 'Government of India Emergency Response Support System (112)',
    text: 'In an emergency in India, call 112. On campus, also tell the nearest staff member or security at the gate.' },
]

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ')
const STOP = new Set(['the', 'is', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'what', 'where', 'how', 'when', 'who', 'which', 'do', 'does', 'i', 'me', 'my', 'can', 'tell', 'about', 'there', 'are', 'it', 'kya', 'hai', 'ka', 'ki', 'ke', 'se'])
const HI = { 'पता': 'address', 'कहाँ': 'where', 'कॉलेज': 'college', 'लाइब्रेरी': 'library', 'ग्रंथालय': 'library', 'कैंटीन': 'canteen', 'प्रिंसिपल': 'principal', 'प्राचार्य': 'principal', 'स्टेशन': 'station', 'बस': 'bus', 'ट्रेन': 'train', 'फेस्ट': 'fest', 'मंजिल': 'floor', 'मजला': 'floor', 'आपातकाल': 'emergency', 'पोहोचायचे': 'reach', 'पहुँचें': 'reach', 'पहुंचे': 'reach' }

/** Simple keyword retrieval over the knowledge base. */
export function searchKnowledge(query, limit = 3) {
  let q = norm(query)
  for (const [k, v] of Object.entries(HI)) if (q.includes(k)) q += ' ' + v
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
  if (!words.length) return []
  return KNOWLEDGE.map((e) => {
    const hay = norm(`${e.title} ${e.tags}`), body = norm(e.text)
    const s = words.reduce((n, w) => n + (hay.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0)
    const covered = words.filter((w) => hay.includes(w) || body.includes(w)).length / words.length
    return { e, s, covered }
  }).filter((x) => x.s >= 3 && x.covered >= 0.5).sort((a, b) => b.s - a.s).slice(0, limit).map(({ e }) => ({ title: e.title, answer: e.text, source: e.source, verified: e.verified }))
}

export function campusInfoTool({ query } = {}) {
  const hits = searchKnowledge(query)
  if (!hits.length) return { found: false, message: "That isn't in the campus knowledge base. Say you don't know and suggest asking the college office; do not guess." }
  return { found: true, results: hits }
}
