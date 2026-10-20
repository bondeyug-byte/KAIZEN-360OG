// Offline mode: a rule-based command understander (no AI, no network). It maps what the student says
// in English, Hinglish, Hindi or Marathi to the same tools the AI uses, then answers from templates.
// It is shown in the UI as "Offline mode" — it never pretends to be an AI model.
import { allStations } from '../lib/transit.js'
import { searchKnowledge } from './knowledge.js'
import { resolveStation } from '../lib/journey.js'

const has = (re, t) => re.test(t)

const ST_LOCAL = { 'कुर्ला': 'Kurla', 'चेंबूर': 'Chembur', 'चेम्बूर': 'Chembur', 'ठाणे': 'Thane', 'थाने': 'Thane', 'सीएसएमटी': 'CSMT', 'सीएसटी': 'CSMT', 'वीटी': 'CSMT', 'वाशी': 'Vashi', 'पनवेल': 'Panvel', 'दादर': 'Dadar', 'घाटकोपर': 'Ghatkopar', 'कल्याण': 'Kalyan', 'डोंबिवली': 'Dombivli', 'बेलापुर': 'Belapur CBD', 'बेलापूर': 'Belapur CBD', 'मानखुर्द': 'Mankhurd', 'गोवंडी': 'Govandi', 'वडाला': 'Vadala Road', 'अंधेरी': 'Andheri', 'बांद्रा': 'Bandra', 'वांद्रे': 'Bandra', 'सायन': 'Sion', 'शीव': 'Sion', 'मुलुंड': 'Mulund', 'नेरुळ': 'Nerul', 'नेरुल': 'Nerul', 'भायखला': 'Byculla', 'भायखळा': 'Byculla', 'मस्जिद': 'Masjid', 'कसारा': 'Kasara', 'कर्जत': 'Karjat', 'बदलापुर': 'Badlapur', 'बदलापूर': 'Badlapur', 'अंबरनाथ': 'Ambernath', 'खारघर': 'Kharghar', 'टिळक नगर': 'Tilak Nagar', 'तिलक नगर': 'Tilak Nagar', 'विद्याविहार': 'Vidyavihar', 'गोरेगाव': 'Goregaon', 'cst': 'CSMT', 'vt': 'CSMT' }
const BUS_PLACES = ['kurla', 'ghatkopar', 'airoli', 'mahul', 'trombay', 'deonar', 'mulund', 'santacruz', 'colaba', 'anushakti', 'shivaji nagar', 'gadkari', 'backbay', 'museum', 'mumbai central', 'vashi naka']
const BUS_LOCAL = { 'कुर्ला': 'kurla', 'घाटकोपर': 'ghatkopar', 'ऐरोली': 'airoli', 'माहुल': 'mahul', 'ट्रॉम्बे': 'trombay', 'देवनार': 'deonar', 'मुलुंड': 'mulund' }

function stationsIn(text) {
  const t = ' ' + text.toLowerCase() + ' '
  const found = []
  for (const [k, v] of Object.entries(ST_LOCAL)) { const i = t.indexOf(k); if (i >= 0 && (k.length > 3 || /\W/.test(t[i - 1] || ' '))) found.push([i, v]) }
  for (const s of allStations()) { const i = t.search(new RegExp(`\\b${s.toLowerCase().replace(/[.*+?^${}()|[\]\\']/g, '.')}\\b`)); if (i >= 0) found.push([i, s]) }
  found.sort((a, b) => a[0] - b[0])
  return [...new Set(found.map((x) => x[1]))]
}

const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|confirm|do it|go ahead|haan?|ha|haa|ji|ho|hoy|हाँ|हां|हा|हो|होय|जी|ठीक|कर दो|कर)(?=[\s,.!]|$)/i
const NO = /^(no|nope|nah|cancel|stop|don'?t|mat|nahi|nahin|nako|नहीं|नही|नको|रद्द|मत)(?=[\s,.!]|$)/i
export const isYes = (t) => YES.test(t.trim().replace(/[.!,]/g, ''))
export const isNo = (t) => NO.test(t.trim().replace(/[.!,]/g, ''))

const words = (s) => s.toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter((w) => w.length > 2)
function bestMatch(text, items, getText) {
  const w = words(text)
  let best = null, bs = 0
  for (const it of items) { const tt = getText(it).toLowerCase(); const s = w.reduce((n, x) => n + (tt.includes(x) ? 1 : 0), 0); if (s > bs) { bs = s; best = it } }
  return best
}

/**
 * Turn an utterance into tool calls. ctx gives access to the student's data for picking ids.
 * Returns { calls: [{ name, args }], intent }.
 */
export function parse(text, ctx = {}) {
  const t = text.toLowerCase().trim()
  const sh = ctx.db?.shared, me = ctx.me, my = ctx.myData
  const doneWord = /\b(done|completed|finished|submitted|ho gaya|ho gayi|kar diya|kar liya)\b|हो गया|हो गई|कर दिया|झाले|झालं|पूर्ण/
  const bookWord = /\b(book|request|reserve|chahiye|chaiye|want a seat|get me a seat|sign me up|register|join)\b|बुक|चाहिए|हवी|हवा|रजिस्टर|नोंदणी|नाम लिख/

  // Journey from a station to campus ("Dombivli se college kaise jaun", "how do I get to college from Thane")
  {
    const m = t.match(/from ([a-z .'-]{3,30}?)(?: station)?(?: to (?:college|campus|vesit)|\?|$| how| kaise)/) || t.match(/([a-z .'-]{3,30}?) (?:se|seh|hun|vrun|varun) (?:college|campus|vesit)/)
    const devStation = stationsIn(text).find((x) => x !== 'Kurla' && x !== 'Chembur') || stationsIn(text)[0]
    if ((m || devStation) && has(/college|campus|vesit|कॉलेज|reach|get to|come to|journey|route|kaise|कैसे|कसे/, t) && !has(/\b(train|local) (from|time)/, t)) {
      const from = m ? m[1].trim() : devStation
      if (resolveStation(from)) return { intent: 'journey', calls: [{ name: 'plan_journey', args: { from } }] }
    }
  }
  // How to reach campus / facts about the college (before navigation, which is for inside the building)
  if (has(/(reach|get to|come to|travel to|go to)\s.*(campus|college|vesit)|(campus|college|vesit).*(address|located|location)|where is (the )?(campus|college|vesit)|is vesit|vesit (is|was)|कॉलेज कैसे|कॉलेज.*पहुँच|कॉलेजला कसे/, t)) return { intent: 'info', calls: [{ name: 'campus_info', args: { query: text } }] }
  // Trains
  if (has(/\b(train|trains|local|locals|railway)\b|ट्रेन|लोकल|गाड़ी|गाडी|रेल/, t)) {
    const st = stationsIn(text)
    const home = st.filter((s) => s === 'Kurla' || s === 'Chembur')
    const other = st.filter((s) => s !== 'Kurla' && s !== 'Chembur')
    let from = home[0] || 'Chembur', to = other[0]
    if (home.length === 2) { from = home[0]; to = home[1] }
    if (!home.length && /kurla|कुर्ला/.test(t)) from = 'Kurla'
    const type = has(/\bac\b|एसी|ए\.सी/, t) ? 'ac' : has(/fast|फास्ट|जलद/, t) ? 'fast' : has(/slow|स्लो|धीमी|धिमी/, t) ? 'slow' : 'any'
    const tm = t.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?/)
    let time
    if (tm) { let h = +tm[1]; if (tm[3] === 'pm' && h < 12) h += 12; if (tm[3] === 'am' && h === 12) h = 0; time = `${h}:${tm[2]}` }
    return { intent: 'trains', calls: [{ name: 'next_trains', args: { from, to, type, time, limit: 4 } }] }
  }
  // Buses
  if (has(/\b(bus|buses|best)\b|बस/, t)) {
    let toward = BUS_PLACES.find((p) => t.includes(p))
    for (const [k, v] of Object.entries(BUS_LOCAL)) if (text.includes(k)) toward = v
    const num = t.match(/\b(a-?)?(\d{2,3})\s*(ltd)?\b/)
    if (!toward && num) toward = (num[1] ? 'A-' : '') + num[2] + (num[3] ? ' LTD' : '')
    return { intent: 'buses', calls: [{ name: 'buses_near_campus', args: { toward } }] }
  }
  // Rides (sharing)
  if (has(/\b(ride|rides|carpool|car pool|pool|share auto|seat)\b|राइड|सीट/, t)) {
    if (bookWord.test(t) && sh && me) {
      const open = sh.rides.filter((r) => r.creatorId !== me.id && Date.parse(r.departAt) > (ctx.now ? +ctx.now : Date.now()) && !r.cancelled)
      const r = bestMatch(text, open, (x) => `${x.to.name} ${x.from.name} ${x.creatorName}`) || open[0]
      if (r) return { intent: 'ride-book', calls: [{ name: 'request_ride_seat', args: { ride_id: r.id } }] }
    }
    return { intent: 'rides', calls: [{ name: 'my_rides', args: {} }] }
  }
  // Deadlines / assignments
  if (has(/deadline|assignment|due|submission|submit|homework|journal|pending|remaining|baaki|baki|बाकी|असाइनमेंट|सबमिशन|उरलेले|प्रलंबित|होमवर्क|जर्नल/, t)) {
    if (doneWord.test(t) && my) {
      const d = bestMatch(text, (my.deadlines || []).filter((x) => !x.done), (x) => `${x.title} ${x.subject}`)
      if (d) return { intent: 'deadline-done', calls: [{ name: 'mark_deadline_done', args: { deadline_id: d.id } }] }
    }
    return { intent: 'deadlines', calls: [{ name: 'my_deadlines', args: {} }] }
  }
  // Events
  if (has(/\b(event|events|fest|workshop|seminar|hackathon|competition|club|register|sign me up)\b|इवेंट|इव्हेंट|कार्यक्रम|फेस्ट|रजिस्टर|नोंदणी/, t)) {
    if (bookWord.test(t) && sh) {
      const e = bestMatch(text, sh.events, (x) => `${x.title} ${(x.tags || []).join(' ')}`)
      if (e) return { intent: 'event-register', calls: [{ name: 'register_event', args: { event_id: e.id } }] }
    }
    return { intent: 'events', calls: [{ name: 'my_events', args: {} }] }
  }
  // Challenges
  if (has(/challenge|leaderboard|points|rank|चैलेंज|पॉइंट|रैंक/, t)) {
    if (doneWord.test(t) && sh && me) {
      const c = bestMatch(text, sh.challenges, (x) => x.title)
      if (c) return { intent: 'challenge-done', calls: [{ name: 'complete_challenge', args: { challenge_id: c.id } }] }
    }
    return { intent: 'challenges', calls: [{ name: 'my_challenges', args: {} }] }
  }
  // Marks / SGPA
  if (has(/sgpa|cgpa|gpa|marks|grade|target|pass hon|kitne number|मार्क्स|नंबर|गुण|ग्रेड|पास/, t)) return { intent: 'academics', calls: [{ name: 'my_academics', args: {} }] }
  // Peer learning
  if (has(/credit|peer|teach|tutor|learn|सीख|शिक|क्रेडिट/, t)) return { intent: 'peer', calls: [{ name: 'my_peer_learning', args: {} }] }
  // Navigation / directions
  if (has(/take me|navigate|directions?|route to|how (do i|to|can i) (get|reach|go)|guide me|le chal|le chalo|rasta|raasta|रास्ता|ले चलो|ले चल|मार्ग|घेऊन चल|कसे जायचे|कैसे जाऊं|कैसे जाएं/, t)) {
    return { intent: 'navigate', calls: [{ name: 'navigate_to', args: { place: text } }] }
  }
  // Schedule
  if (has(/lecture|lectures|class|classes|timetable|time table|schedule|period|practical|lab today|लेक्चर|क्लास|तास|वेळापत्रक|टाइमटेबल|पीरियड/, t)) {
    const day = has(/tomorrow|\bkal\b|कल|उद्या/, t) ? 'tomorrow' : (t.match(/monday|tuesday|wednesday|thursday|friday|saturday/) || ['today'])[0]
    return { intent: 'schedule', calls: [{ name: 'my_schedule', args: { day } }] }
  }
  // Where is …
  if (has(/where|kaha|kahan|kidhar|कहाँ|कहां|किधर|कुठे|find|nearest|closest|sabse paas|जवळ/, t) || has(/library|canteen|washroom|toilet|lab|room|office|principal|exam|lift|stairs|amphi|लाइब्रेरी|कैंटीन|टॉयलेट|वॉशरूम|ग्रंथालय/, t)) {
    return { intent: 'where', calls: [{ name: 'find_place', args: { query: text } }] }
  }
  // Who to contact
  if (has(/who (do|should|can) i|who can (help|teach)|doubt|contact|faculty|professor|teacher|mentor|senior|hod|sir|ma'?am|किसे|कोणाला|संपर्क|मेंटर/, t)) return { intent: 'contact', calls: [{ name: 'directory_search', args: { query: text } }] }
  // General campus facts from the knowledge base
  if (has(/address|located|reach|get to|how to come|establish|founded|history|autonom|affiliat|university|principal|praxis|fest|emergency|airport|pin code|पता|कैसे पहुँच|कसे पोहोच/, t) || searchKnowledge(text).length) {
    if (searchKnowledge(text).length) return { intent: 'info', calls: [{ name: 'campus_info', args: { query: text } }] }
  }
  // Day overview
  if (has(/today|my day|aaj|आज|what'?s up|plan|overview|summary/, t)) return { intent: 'day', calls: [{ name: 'my_schedule', args: { day: 'today' } }, { name: 'my_deadlines', args: {} }] }
  // A real question we can't map: say we don't know (from the knowledge base) instead of guessing
  if (t.length > 10 && has(/\?|^(what|how|who|when|where|why|is|are|does|do|can|kya|kab|kaun|kitna|kitni)\b|क्या|कब|कौन|कितन|काय|कधी|कोण/, t)) return { intent: 'unknown', calls: [{ name: 'campus_info', args: { query: text } }] }
  return { intent: 'help', calls: [] }
}

// ---------------- answers ----------------
const L = (lang, o) => o[lang] || o.en
const dur = (m, lang) => {
  if (m < 60) return L(lang, { en: `in ${m} min`, hl: `${m} min mein`, hi: `${m} मिनट में`, mr: `${m} मिनिटांत` })
  const h = Math.floor(m / 60), r = m % 60
  return L(lang, { en: `in ${h} h ${r} min`, hl: `${h} ghante ${r} min mein`, hi: `${h} घंटे ${r} मिनट में`, mr: `${h} तास ${r} मिनिटांत` })
}

/** Answer in the language the student actually used: Devanagari text → Hindi or Marathi. */
export function detectLang(text, chosen) {
  if (!/[\u0900-\u097F]/.test(text)) return chosen === 'hi' || chosen === 'mr' ? (chosen === 'mr' ? 'mr' : 'hi') : chosen
  if (/आहे|आहेत|माझ|माझं|कधी|पुढच|कुठे|सांग|हवी|नको|ते |साठी|मध्ये|कोणते|ला /.test(text)) return 'mr'
  return chosen === 'mr' ? 'mr' : 'hi'
}
const first = (a) => a?.[0]

/** Short speakable answer for one tool result. */
export function compose(lang, name, r) {
  if (!r) return ''
  if (r.ok === false) return r.message
  switch (name) {
    case 'next_trains': {
      const [a, b, c] = r.trains
      if (!a) return L(lang, { en: `No more direct trains found from ${r.from}${r.to ? ' to ' + r.to : ''} right now.`, hl: `${r.from} se${r.to ? ' ' + r.to + ' ke liye' : ''} abhi koi direct train nahi mili.`, hi: `${r.from} से${r.to ? ' ' + r.to + ' के लिए' : ''} अभी कोई सीधी ट्रेन नहीं मिली।`, mr: `${r.from} वरून${r.to ? ' ' + r.to + ' साठी' : ''} आत्ता थेट ट्रेन सापडली नाही.` })
      const wait = a.inMinutes === 0 ? L(lang, { en: 'leaving now', hl: 'abhi nikal rahi hai', hi: 'अभी निकल रही है', mr: 'आत्ता सुटते आहे' }) : dur(a.inMinutes, lang)
      const arr = a.arrives ? L(lang, { en: `, reaching ${r.to} at ${a.arrives}`, hl: `, ${r.to} ${a.arrives} tak`, hi: `, ${r.to} ${a.arrives} तक`, mr: `, ${r.to} ला ${a.arrives} पर्यंत` }) : ''
      const more = [b, c].filter(Boolean).map((x) => x.departs).join(L(lang, { en: ' and ', hl: ' aur ', hi: ' और ', mr: ' आणि ' }))
      return L(lang, {
        en: `Next ${a.type.toLowerCase()} train from ${r.from} is at ${a.departs}, ${wait}, towards ${a.towards}${arr}.${more ? ` After that, ${more}.` : ''}`,
        hl: `${r.from} se next ${a.type} train ${a.departs} ko hai, ${wait}, ${a.towards} ke liye${arr}.${more ? ` Uske baad ${more}.` : ''}`,
        hi: `${r.from} से अगली ${a.type} ट्रेन ${a.departs} बजे है, ${wait}, ${a.towards} के लिए${arr}।${more ? ` उसके बाद ${more}।` : ''}`,
        mr: `${r.from} वरून पुढची ${a.type} ट्रेन ${a.departs} ला आहे, ${wait}, ${a.towards} साठी${arr}.${more ? ` त्यानंतर ${more}.` : ''}`,
      })
    }
    case 'buses_near_campus': {
      const routes = r.stops.flatMap((s) => s.routes.map((x) => ({ ...x, stop: s.stop })))
      const top = routes.slice(0, 3).map((x) => `${x.route} (${x.between})`).join(', ')
      const s0 = first(routes)
      return L(lang, {
        en: `From ${s0.stop}: ${top}. ${s0.route}: ${s0.next} Waits are estimates; check the Chalo app for live buses.`,
        hl: `${s0.stop} stop se: ${top}. ${s0.route}: ${s0.next} Ye estimate hai, live ke liye Chalo app dekho.`,
        hi: `${s0.stop} स्टॉप से: ${top}। ${s0.route}: ${s0.next} यह अनुमान है, लाइव समय के लिए Chalo ऐप देखें।`,
        mr: `${s0.stop} स्टॉपवरून: ${top}. ${s0.route}: ${s0.next} हा अंदाज आहे, लाइव्हसाठी Chalo ॲप पहा.`,
      })
    }
    case 'my_schedule': {
      const up = r.lectures.filter((x) => x.status !== 'over')
      if (!r.lectures.length) return L(lang, { en: `No lectures ${r.day}.`, hl: `${r.day} koi lecture nahi hai.`, hi: `${r.day} कोई लेक्चर नहीं है।`, mr: `${r.day} एकही लेक्चर नाही.` })
      if (!up.length) return L(lang, { en: `All of ${r.day}'s lectures are over.`, hl: `Aaj ke saare lectures khatam ho gaye.`, hi: 'आज के सारे लेक्चर खत्म हो गए।', mr: 'आजचे सगळे लेक्चर संपले.' })
      const a = up[0], rest = up.length - 1
      const now = a.status === 'happening now'
      return L(lang, {
        en: `${now ? 'Right now' : r.day === 'today' ? 'Next up' : `First on ${r.day}`}: ${a.title} (${a.type}) at ${a.time.split('–')[0]} in ${a.room}, ${a.floor}.${rest ? ` Then ${rest} more${up[1] ? `, starting with ${up[1].title} at ${up[1].time.split('–')[0]}` : ''}.` : ''}`,
        hl: `${now ? 'Abhi' : 'Next'}: ${a.title} ${a.time.split('–')[0]} ko, ${a.room}, ${a.floor}.${rest ? ` Uske baad ${rest} aur, pehla ${up[1].title} ${up[1].time.split('–')[0]} ko.` : ''}`,
        hi: `${now ? 'अभी' : 'अगला'}: ${a.title}, ${a.time.split('–')[0]} बजे, ${a.room}, ${a.floor}।${rest ? ` उसके बाद ${rest} और।` : ''}`,
        mr: `${now ? 'आत्ता' : 'पुढचं'}: ${a.title}, ${a.time.split('–')[0]} ला, ${a.room}, ${a.floor}.${rest ? ` त्यानंतर अजून ${rest}.` : ''}`,
      })
    }
    case 'my_deadlines': {
      const p = r.pending
      if (!p.length) return L(lang, { en: 'Nothing pending. All your deadlines are done.', hl: 'Kuch pending nahi hai, sab done!', hi: 'कुछ भी बाकी नहीं है।', mr: 'काहीही बाकी नाही.' })
      const a = p[0]
      return L(lang, {
        en: `You have ${p.length} pending. Most urgent: ${a.title}, ${a.status}.${p[1] ? ` Next: ${p[1].title}, ${p[1].status}.` : ''}`,
        hl: `${p.length} pending hain. Sabse urgent: ${a.title}, ${a.status}.${p[1] ? ` Phir ${p[1].title}.` : ''}`,
        hi: `${p.length} काम बाकी हैं। सबसे ज़रूरी: ${a.title}, ${a.status}।${p[1] ? ` फिर ${p[1].title}।` : ''}`,
        mr: `${p.length} कामं बाकी आहेत. सर्वात आधी: ${a.title}, ${a.status}.${p[1] ? ` मग ${p[1].title}.` : ''}`,
      })
    }
    case 'my_events': {
      const open = r.events.filter((e) => e.canRequest)
      const live = r.events.find((e) => e.status === 'Live Now')
      const sug = first(r.suggestedForYou)
      return L(lang, {
        en: `${live ? `${live.title} is live now at ${live.where}. ` : ''}${open.length} event${open.length === 1 ? '' : 's'} open for registration.${sug ? ` Suggested for you: ${sug.title}. Say "register me" to send a request.` : ''}`,
        hl: `${live ? `${live.title} abhi live hai, ${live.where}. ` : ''}${open.length} events mein registration open hai.${sug ? ` Aapke liye: ${sug.title}. "Register me" bolo.` : ''}`,
        hi: `${live ? `${live.title} अभी चल रहा है। ` : ''}${open.length} इवेंट में रजिस्ट्रेशन खुला है।${sug ? ` आपके लिए: ${sug.title}।` : ''}`,
        mr: `${live ? `${live.title} आत्ता सुरू आहे. ` : ''}${open.length} इव्हेंटसाठी नोंदणी सुरू आहे.${sug ? ` तुमच्यासाठी: ${sug.title}.` : ''}`,
      })
    }
    case 'my_rides': {
      const a = first(r.ridesWithSeats)
      if (!a) return L(lang, { en: 'No rides with free seats right now. You can offer one in Rides.', hl: 'Abhi koi ride free nahi hai.', hi: 'अभी कोई राइड खाली नहीं है।', mr: 'आत्ता एकही राइड रिकामी नाही.' })
      return L(lang, {
        en: `${r.ridesWithSeats.length} ride${r.ridesWithSeats.length === 1 ? '' : 's'} with seats. Soonest: ${a.driver}, ${a.from} to ${a.to}, ${a.leaves}, ${a.seatsLeft} seat${a.seatsLeft === 1 ? '' : 's'} left. Say "book a seat" to request it.`,
        hl: `${r.ridesWithSeats.length} rides available. ${a.driver} ki ride, ${a.from} se ${a.to}, ${a.leaves}. "Book a seat" bolo.`,
        hi: `${r.ridesWithSeats.length} राइड उपलब्ध हैं। ${a.driver} की राइड, ${a.from} से ${a.to}, ${a.leaves}।`,
        mr: `${r.ridesWithSeats.length} राइड उपलब्ध आहेत. ${a.driver} ची राइड, ${a.from} ते ${a.to}, ${a.leaves}.`,
      })
    }
    case 'my_academics': {
      const res = r.targetResult
      const s = r.subjects.filter((x) => x.bestGradeStillPossible).map((x) => `${x.subject}: ${x.bestGradeStillPossible} needs ${x.externalNeededForIt}`).slice(0, 2).join('; ')
      return L(lang, {
        en: `${res ? `Target SGPA ${r.targetSGPA}: ${res.toLowerCase()}. ` : 'No target SGPA set yet. '}${s}. Open the Planner for the full plan.`,
        hl: `${res ? `Target ${r.targetSGPA}: ${res}. ` : 'Target SGPA set nahi hai. '}${s}.`,
        hi: `${res ? `लक्ष्य ${r.targetSGPA}: ${res}। ` : 'लक्ष्य SGPA सेट नहीं है। '}${s}।`,
        mr: `${res ? `लक्ष्य ${r.targetSGPA}: ${res}. ` : 'लक्ष्य SGPA सेट नाही. '}${s}.`,
      })
    }
    case 'my_challenges': {
      const a = first(r.open)
      return L(lang, { en: `You have ${r.yourPoints} points${r.classRank ? `, class rank ${r.classRank}` : ''}. ${a ? `Open: ${a.title} for ${a.points} points.` : 'No open challenges.'}`, hl: `Aapke ${r.yourPoints} points hain. ${a ? `Open: ${a.title}, ${a.points} points.` : ''}`, hi: `आपके ${r.yourPoints} पॉइंट हैं। ${a ? `खुला: ${a.title}, ${a.points} पॉइंट।` : ''}`, mr: `तुमचे ${r.yourPoints} पॉइंट आहेत. ${a ? `${a.title}, ${a.points} पॉइंट.` : ''}` })
    }
    case 'my_peer_learning': {
      const m = r.matches.find((x) => x.teachers.length)
      return L(lang, { en: `You have ${r.credits.available} credit${r.credits.available === 1 ? '' : 's'} available.${m ? ` ${m.teachers[0]} can teach you ${m.wantToLearn}.` : ''}`, hl: `${r.credits.available} credits available.${m ? ` ${m.teachers[0]} aapko ${m.wantToLearn} sikha sakte hain.` : ''}`, hi: `${r.credits.available} क्रेडिट उपलब्ध हैं।${m ? ` ${m.teachers[0]} आपको ${m.wantToLearn} सिखा सकते हैं।` : ''}`, mr: `${r.credits.available} क्रेडिट उपलब्ध.${m ? ` ${m.teachers[0]} तुम्हाला ${m.wantToLearn} शिकवू शकतात.` : ''}` })
    }
    case 'directory_search': {
      const a = first(r.matches)
      if (!a) return L(lang, { en: "I couldn't find anyone for that. Try the directory.", hl: 'Koi nahi mila, directory dekho.', hi: 'कोई नहीं मिला।', mr: 'कोणी सापडले नाही.' })
      return `${a.name} — ${a.role}. ${a.where}${a.hours ? ', ' + a.hours : ''}.`
    }
    case 'find_place': {
      const a = first(r.matches)
      return L(lang, {
        en: `${a.name} is on the ${a.floor}, ${a.wing}${a.side ? ', ' + a.side : ''}.${a.walk ? ` ${a.walk} from ${r.from}.` : ''} Say "take me there" to navigate.`,
        hl: `${a.name} ${a.floor} pe hai, ${a.wing}.${a.walk ? ` ${r.from} se ${a.walk}.` : ''}`,
        hi: `${a.name} ${a.floor} पर है, ${a.wing}।`,
        mr: `${a.name} ${a.floor} वर आहे, ${a.wing}.`,
      })
    }
    case 'campus_route': return `${r.time}: ${r.steps.slice(0, 3).join('. ')}.`
    case 'navigate_to': return L(lang, { en: `Starting navigation to ${r.navigatingTo}.`, hl: `${r.navigatingTo} ka rasta shuru kar raha hoon.`, hi: `${r.navigatingTo} का रास्ता शुरू कर रहा हूँ।`, mr: `${r.navigatingTo} कडे मार्गदर्शन सुरू करतो.` })
    case 'open_page': return L(lang, { en: 'Opening it.', hl: 'Khol raha hoon.', hi: 'खोल रहा हूँ।', mr: 'उघडतो.' })
    case 'plan_journey': {
      const o = r.options[0]
      if (!o) return ''
      const legs = o.legs.map((l) => `${l.line} from ${l.ride.replace(' to ', ' to ')}`).join(', then ')
      const first = o.legs[0] && Array.isArray(o.legs[0].nextTrains) ? o.legs[0].nextTrains[0] : null
      return L(lang, {
        en: `${o.legs.length ? `Best is via ${o.via}${o.changes ? ` with ${o.changes} change` : ', direct'}: ${legs}.${first ? ` Next train ${first}.` : ''} ` : `You're already at ${o.via}. `}${o.lastLeg || ''}`,
        hl: `${o.legs.length ? `${o.via} se jao${o.changes ? `, ${o.changes} change` : ', direct'}: ${legs}.${first ? ` Next train ${first}.` : ''} ` : ''}${o.lastLeg || ''}`,
        hi: `${o.legs.length ? `${o.via} होकर जाइए${o.changes ? `, ${o.changes} बार बदलना` : ', सीधी ट्रेन'}: ${legs}।${first ? ` अगली ट्रेन ${first}।` : ''} ` : ''}${o.lastLeg || ''}`,
        mr: `${o.legs.length ? `${o.via} मार्गे जा${o.changes ? `, ${o.changes} वेळा बदल` : ', थेट'}: ${legs}.${first ? ` पुढची ट्रेन ${first}.` : ''} ` : ''}${o.lastLeg || ''}`,
      })
    }
    case 'campus_info': {
      if (!r.found) return L(lang, { en: "I don't have that in my campus notes. The college office can confirm it.", hl: 'Ye mere campus notes mein nahi hai. College office se confirm karo.', hi: 'यह जानकारी मेरे पास नहीं है। कॉलेज ऑफिस से पुष्टि करें।', mr: 'ही माहिती माझ्याकडे नाही. कॉलेज ऑफिसकडून खात्री करा.' })
      return r.results[0].answer
    }
    case 'floor_guide': return `${r.floor}: ${r.rooms} rooms, labs ${r.labs.join(', ') || 'none'}${r.special.length ? ', ' + r.special.join(', ') : ''}.`
    default: return ''
  }
}

export const confirmPrompt = (lang, summary) => L(lang, { en: `${summary}. Shall I go ahead? Say yes or no.`, hl: `${summary}. Karun? Haan ya na bolo.`, hi: `${summary}। क्या मैं कर दूँ? हाँ या ना बोलिए।`, mr: `${summary}. करू का? हो किंवा नाही सांगा.` })
export const cancelledText = (lang) => L(lang, { en: 'Okay, cancelled. Nothing was changed.', hl: 'Theek hai, cancel kar diya.', hi: 'ठीक है, रद्द कर दिया।', mr: 'ठीक आहे, रद्द केलं.' })
export const helpText = (lang) => L(lang, {
  en: 'I can tell you your next lecture, pending assignments, events, the next train from Kurla or Chembur, buses near campus, find a room, take you there in 3D, and book ride seats or send event registration requests after you confirm.',
  hl: 'Main next lecture, pending assignments, events, Kurla ya Chembur se next train, bus, room dhoondhna, 3D mein rasta, aur ride ya event booking kar sakta hoon.',
  hi: 'मैं अगला लेक्चर, बाकी असाइनमेंट, इवेंट, कुर्ला या चेंबूर से अगली ट्रेन, बस, कमरा ढूँढना और 3D में रास्ता बता सकता हूँ।',
  mr: 'मी पुढचं लेक्चर, बाकी असाइनमेंट, इव्हेंट, कुर्ला किंवा चेंबूरहून पुढची ट्रेन, बस, खोली शोधणे आणि 3D मार्ग सांगू शकतो.',
})
