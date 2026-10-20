# Campus360 — One Companion for Every First-Year Need (PS-02)

Campus360 brings a first-year student's day into one app: today's lectures and deadlines, the marks needed for each grade, credit-weighted SGPA and target feasibility, ride sharing to campus, class challenges with a live leaderboard, a "Who do I contact?" directory, campus events, peer learning with time credits, a **3D campus navigator** with turn-by-turn routing across floors, **local train timetables for Kurla and Chembur, BEST buses near campus**, and a **voice assistant** (Gemini → Claude → ChatGPT, with an offline fallback) that can answer and act in English, Hinglish, Hindi and Marathi. The same campus tools are published as an **MCP server** so anyone can use them from Claude or ChatGPT.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 5 |
| Styling | Tailwind CSS 3 |
| Data | LocalStorage (one JSON document) seeded from `src/data/seed.js` |
| 3D | Three.js r160 (bundled, no CDN) |
| Auth | MiniMoth phone OTP via a Netlify Function (`netlify/functions/auth.mjs`) |
| Voice assistant | Web Speech API (mic + speech) in the browser; AI proxy `netlify/functions/assistant.mjs` (Gemini, Claude, OpenAI) |
| MCP | `netlify/functions/mcp.mjs` — Streamable HTTP, JSON-RPC, read-only tools |
| Tests | Vitest (77 tests: academic maths, rides, challenges, events, peer credits, auth proxy, transit, assistant, AI proxy, MCP) |
| Hosting | Netlify (from GitHub) |

## Run locally

```bash
npm install
npm run dev            # http://localhost:5173 — auth API not available, use demo sign-in
npm test               # unit tests
npm run build          # production build in dist/
npm run build:single   # ONE self-contained HTML file in dist-single/index.html
```

To run with the real auth function locally: `npm i -g netlify-cli`, create `.env` with `MINIMOTH_API_KEY=...`, then `netlify dev`.

**Check MiniMoth end to end (5 minutes, after deploying):**
1. Set `MINIMOTH_API_KEY` to your `mm_test_…` key and redeploy. `/api/auth/health` should show `{"configured":true,"mode":"test"}`.
2. Open the site, enter any valid Indian mobile number and press **Send code**. Enter `000000`, MiniMoth's documented sandbox code. You should land on profile setup.
3. Reload the page. You should still be signed in (the refresh cookie rotates).
4. Sign out, then reload. You should see the sign-in screen.
5. Switch to the `mm_live_…` key, redeploy, and repeat with your own phone. A real WhatsApp or SMS arrives, and each one costs ₹0.35.

## Project structure

```
src/
  App.jsx                 hash router + auth gate
  store/AppContext.jsx    shared state: session, LocalStorage db, toasts, actions
  lib/academic.js         marks needed, locked grades, SGPA, target feasibility (DP), what-if
  lib/rides.js            Available → Requested → Confirmed seat flow
  lib/challenges.js       posting, one-time completion, derived leaderboard
  lib/events.js           Registration Open / Starting Soon / Live Now / Event Ended
  lib/peer.js             Matched → Booked → Completed, credit ledger, reservations
  lib/auth.js             browser client for /api/auth/* (never sees the API key or refresh token)
  lib/storage.js          safe LocalStorage load/save/reset
  data/seed.js            fictional demo records (all marked demo: true)
  data/config.js          campus centre, timezone, classes, interests
  navigator/building.js   floor data (27 rooms/floor, 8 lifts, 2 stair cores, 4 washrooms) + routing
  navigator/scene.js      Three.js campus (merged geometry, static shadows, adaptive DPR)
  navigator/plan.js       2D SVG floor plan
  pages/*.jsx             Dashboard, Planner, Rides, Challenges, Directory, Events, Peer, Profile, Navigator, Login
  lib/transit.js          next trains (Kurla/Chembur), bus frequency estimates
  data/trains.json        1,215 trains through Kurla & Chembur (Central Railway PTT, Apr 2026)
  data/buses.js           BEST routes at stops near campus + sources
  assistant/publicTools.js  campus tools shared by the assistant and the MCP server
  assistant/clientTools.js  personal + action tools (run in the browser on the student's data)
  assistant/offline.js    offline command understander + spoken-answer templates (en/hl/hi/mr)
  assistant/Assistant.jsx voice assistant panel
  pages/Commute.jsx       Trains & buses page
netlify/functions/auth.mjs       MiniMoth proxy: send, verify, session (refresh+validate), validate, logout
netlify/functions/assistant.mjs  AI proxy with provider fallback (keys server-side only)
netlify/functions/mcp.mjs        MCP server at /mcp
tests/*.test.js
```

## MiniMoth authentication

Documented contract used (https://minimoth.dev/docs): base `https://api.minimoth.dev`, header `X-Api-Key`, `POST /v1/otp/send {phone}`, `POST /v1/otp/verify {phone, code}` → `access_token, refresh_token, expires_at, identity_id`, `POST /v1/session/validate {access_token}`, `POST /v1/session/refresh {refresh_token}` (rotates both tokens), `POST /v1/session/logout {access_token}` (on `INVALID_ACCESS_TOKEN`: refresh first, then log out).

Also used: `GET /v1/otp/status/:otp_id` (the login screen shows whether the code went by WhatsApp or SMS, and whether delivery failed).

**Test vs live keys.** `/api/auth/health` reports `mode: "test" | "live"`, worked out from the key prefix. The key itself is never returned. With an `mm_test_` key, MiniMoth sends no message. Its docs give `000000` as the sandbox code, and test keys never return an `identity_id`. Campus360 then uses the verified phone number as the profile key, and the login screen shows a test-mode notice.

Security:
- `MINIMOTH_API_KEY` exists only in the Netlify Function environment. It is never in the bundle or a `VITE_` variable.
- The refresh token is stored only in an `HttpOnly; Secure; SameSite=Lax; Path=/api/auth` cookie and is never returned in JSON.
- The 5-minute access token is kept in memory only and refreshed about a minute before expiry. On reload the app calls `/api/auth/session`, which refreshes through the cookie.
- Expired, reused or revoked refresh tokens clear the cookies, and the app returns to sign-in with a message.
- **Cross-site requests are blocked:** POSTs to `/api/auth/*` with a foreign `Origin` get a 403.
- **A rejected key** (`INVALID_API_KEY` / `MISSING_API_KEY`) shows up as a generic `CONFIG_INVALID` error, without any detail about the key.
- **Upstream calls time out** after 15 seconds.
- **The login screen** has a 30-second resend cooldown, a 10-minute expiry countdown and the delivery channel. Wrong codes, expired codes, the code lock (`VERIFY_RATE_LIMITED`) and send limits (`OTP_RATE_LIMITED`) each get a clear message.
- OTP proves control of a phone number. It is **not** shown as college-enrolment verification.

**Demo sign-in.** When no auth server is reachable (local `npm run dev`, or the single-file demo), the login page offers a clearly labelled demo sign-in with fictional students. A banner marks every screen as "Demo mode — not verified". It never pretends to be OTP.

### Environment variables

| Name | Where | Purpose |
|---|---|---|
| `MINIMOTH_API_KEY` | Netlify → Site settings → Environment variables (Functions scope) | MiniMoth project key (`mm_live_…` or `mm_test_…`) |
| `MINIMOTH_REFRESH_MAX_AGE` | optional | Refresh-cookie lifetime in seconds. Match your project's refresh window (default 864000 = 10 days) |

## Deploy (GitHub → Netlify)

1. `git init && git add . && git commit -m "Campus360"`, then create a GitHub repo and `git push`.
2. Netlify → **Add new site → Import from Git** → pick the repo. The build command (`npm run build`), publish directory (`dist`) and functions directory come from `netlify.toml`.
3. Add `GEMINI_API_KEY` (and `MINIMOTH_API_KEY`, plus optional `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) under Site configuration → Environment variables, then redeploy.
4. Check `/api/assistant/health`. It should list your providers, e.g. `{"available":true,"providers":["Gemini"]}`.
5. Check `/api/auth/health`. It should return `{"configured":true}` once MiniMoth is set.


## Sliding interactions

- **Tabs:** every segmented control has a sliding indicator, and the arrow keys move between options.
- **Pages:** pages slide in on navigation.
- **Panels:** route cards slide in, search results slide down, and the mobile "More" menu slides up as a sheet. Escape closes overlays.
- **Navigator on phones:** the panel is a bottom sheet with three heights (peek, half, full). You can drag the handle or tap it. It drops to "peek" during navigation and walk mode. The 3D view stays visible behind it, and the assistant opens from the sheet's **Ask** button.
- **Reduced motion:** all motion turns off when the device asks for it.

## Design system

The UI is built on one set of tokens and components:
- **Tokens** in `tailwind.config.js` and `src/index.css`: a warm off-white canvas, white surfaces with hairline borders and a subtle shadow, slate text, deep burgundy `#7A1F35` as the brand colour, blush as the secondary colour, and accessible status colours.
- **Type:** Inter for text, Inter Tight for headings.
- **Shared components** in `src/components/ui.jsx`: Button, Card, Badge, Field and inputs, Segmented control, Dialog, PageHeader, Stat and AnimatedNumber.
- **Navigation:** the sidebar is grouped into My day, Campus and Community. On phones there's a bottom tab bar and a "More" sheet.
- **Motion:** pages fade in, cards rise in sequence, clickable cards lift on hover, buttons depress on press, numbers count up, bars grow, and dialogs and sheets slide in. The voice orb pulses while listening or speaking. All of this is off when the device asks for reduced motion.

## Trains & buses (Commute page)

**Trains.** Every scheduled local train that stops at Kurla (Central main line and Harbour line) or Chembur (Harbour line): 1,215 services with all their stops. Source: Central Railway's public timetable PDFs (PTT, April 2026), as parsed by the open-source [Mumbai-Local-Navigation](https://github.com/FaheemShaikhUXUI/Mumbai-Local-Navigation---MLN---V1) project. I spot-checked rows against the PDFs. The page shows the next trains, fast/slow/AC filters, direction, the destination, and the arrival time at any station further along the line.
- These are **scheduled** times, not live running status. No free, official live API exists for Mumbai locals.
- Sunday and holiday services aren't separated in the data.
- 18 trains with parsing problems were dropped.

**Buses.** BEST routes at the Chembur Colony, Vivekanand College and Chembur Camp stops, from Moovit's stop pages and the VES "how to reach" page (checked 15 Oct 2026). BEST doesn't publish full-day timetables, so:
- "Printed time" means a departure Moovit lists.
- "Estimate" means the typical gap between buses.
- The app points students to the BEST Chalo app for live arrivals.

## Journey planner (Rides → By train, and Trains & buses → Plan journey)

**Scope:** 96 stations on these lines. The station data is `src/data/network.js`, kept separate from the UI and marked with its source and the date it was checked:
- Central main line: CSMT–Kasara, and CSMT–Karjat–Khopoli.
- Harbour line: CSMT–Panvel, CSMT–Goregaon, and Panvel–Goregaon.
- Trans-Harbour line: Thane–Vashi, and Thane–Nerul–Panvel.
- Port line: Nerul/Belapur–Uran.

**Not included:** the Western line (except the Harbour-served Bandra–Goregaon stations), the Vasai–Diva–Panvel MEMU and the Pune suburban services.

**How it works:**
- **Station order** comes from Central Railway's April 2026 timetables.
- **Search** is forgiving: "Dombili", "Dombivali" and "DI" all find **Dombivli**, and "VT", "CST", "wadala" and "belapur" also work.
- **Routing** uses only service patterns that run end to end, with the fewest changes first. It shows changes at Kurla, Thane, Kalyan, Vashi, Nerul or Belapur where one is needed, and never invents a direct train.
- **Train times** come from the timetable where the app has it, which is every train through Kurla or Chembur. For a journey with a change, the times are chained: the second train leaves after the first one arrives. Legs the timetable doesn't cover, such as Trans-Harbour, are clearly marked as untimed.
- **The last leg to campus** comes from the VES "how to reach" page: bus 432 from Kurla or bus 364 from Chembur, plus the walk.
- **There is no live running data, fare information or platform information.**

## The "trained" assistant

The assistant isn't fine-tuned. It's grounded in campus data instead:
- **`src/assistant/knowledge.js`** is a small campus knowledge base. Every entry has a source and a verified flag: facts from Wikipedia and the VES website, plus how each app feature works. The `campus_info` tool searches it, and if nothing matches, it says so rather than guessing.
- **The system prompt** (in `netlify/functions/assistant.mjs`) sets the persona, strict grounding rules and the rules for actions, with five worked examples.
- **Context:** the assistant is told which page the student is on, and the suggestion chips change to match the page.
- **Offline mode** uses the same knowledge base and journey planner.

Update the knowledge base by editing `knowledge.js`. Both the AI and the MCP server read it.

## Voice assistant

A mic button sits on every page. A student taps it and speaks in English, Hinglish, Hindi or Marathi. The answer is short, read aloud, and shown with a card: train list, lectures, deadlines and so on.

**What it can do:** answer about the next lecture and room, pending assignments and deadlines, events, marks and the target SGPA, rides, challenges, peer credits, contacts, trains and buses. It can find a room. "Take me to the library" opens the 3D navigator and starts turn-by-turn navigation.

**Actions always ask first.** Requesting a ride seat, registering for an event, marking a deadline done, adding a deadline and completing a challenge all wait for "yes" (or *haan* / *ho*) or a tap on Confirm. Nothing changes before that. Opening a page or starting navigation doesn't change data, so those happen right away.

**How it works:**
1. The browser sends the conversation and tool definitions to `/api/assistant`.
2. The server adds a fixed campus system prompt and calls the first provider that works: **Gemini → Claude → ChatGPT**. Change the order with `AI_ORDER`.
3. When the model asks for a tool, the call comes back to the browser. The browser runs it on the student's own data (LocalStorage) and sends back the result.
4. API keys exist only in Netlify environment variables. The browser never sees them.

**Offline mode.** When no AI key is configured, the AI can't be reached, or "Offline" is ticked, a built-in rule-based understander maps the same questions in all four languages to the same tools. It answers from templates and is labelled **Offline mode** in the panel. It is not an AI model and never claims to be one. It's the safety net for bad venue Wi-Fi and for the single-file demo.

**Voice input** uses the browser's Web Speech API, which works best in Chrome or Edge, so voice needs one of those. Speech output uses the device's voices. When a device has no Marathi voice, the Hindi voice reads the answer. Typing always works.

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key (has a free tier). |
| `ANTHROPIC_API_KEY` | Optional. Claude (default model `claude-haiku-5-5`, override with `ANTHROPIC_MODEL`). |
| `OPENAI_API_KEY` | Optional. ChatGPT (default model `gpt-5.4-mini`, override with `OPENAI_MODEL`). |
| `GEMINI_MODEL` | Optional. Without it, the newest Gemini Flash model on your key is picked automatically. |
| `AI_ORDER` | Optional, e.g. `claude,gemini,openai`. |

**Abuse limits:**
- Same-site requests only.
- Capped conversation and body size.
- A fixed campus-only system prompt.
- Short outputs.

These are basic limits. Add rate limiting before a public launch.

## MCP server

`https://<your-site>/mcp` is a remote MCP server (Streamable HTTP, stateless, JSON responses, protocol versions 2024-11-05 to 2025-11-25). Its tools are read-only and public: `find_place`, `campus_route`, `next_trains`, `buses_near_campus`, `floor_guide`, `campus_events` (sample) and `campus_contacts` (sample).
- **Claude:** Settings → Connectors → Add custom connector → paste the URL.
- **ChatGPT:** turn on developer mode in settings, then add a custom connector/app with this URL and no authentication. Whether developer mode is offered depends on your ChatGPT plan, and menu names change, so check OpenAI's help pages if the path looks different.

Personal data (marks, deadlines) lives only in each student's browser, so it is **not** exposed over MCP. Exposing it would need a shared database and OAuth sign-in for the connector.

## Demo data

- Seeded once into LocalStorage (`campus360.db.v1`). Your changes persist across reloads and seed data never overwrites them.
- **Profile → Reset demo data** restores the starting state for repeat presentations.
- Malformed or blocked storage falls back to the seed (with a notice) instead of crashing.
- LocalStorage is per browser. Students on different devices do not see each other's records; a real deployment would need a shared backend.
- Peer-learning credits start from an auditable history: students earned credits by teaching at a "Peer Help Desk" programme account funded by an explicit grant entry. No one is rewarded for creating a profile.

## Campus data: what's real and what's a placeholder

- The building model follows walkthrough videos and photos of VESIT's main block: the C shape with tall end blocks, the curved courtyard face, and the statue plaza.
- **Building outline (corrected):** the courtyard face is one continuous curve on every floor. The earlier version wrongly had a block sticking out into the courtyard, holding up the terrace and the top floors on pillars. That block has been removed.
- **The amphitheatre is inside the curve.** It's an open, two-storey terrace recessed into the curved block, matching the photos:
  - an octagon-tiled deck on Floor 2, with a balustrade on the building line;
  - giant Corinthian columns standing on the courtyard face and rising to the Floor 4 slab;
  - a Floor 3 balcony gallery overlooking the deck;
  - a dark-glass bay at the back, a dark-glass drum, the relief mural and planters;
  - the entrance and the blue "V.E.S. Institute of Technology" board below it, on the same face;
  - routes that reach it from the corridor through the central doors.
- **Lifts and stairs** sit outside that central stretch and line up on every floor. Tests check this.
- **Inferred, not verified:** the terrace's exact arc and depth, the column count (11), the drum's size and position, and every room position. Floor layouts are provisional and live in `src/navigator/building.js` (`LOGGIA`, the floor lists), separate from rendering, so a verified plan can replace them.
- **Floor coverage:** six floors (G + 5) are modelled with the same corridor, core and washroom layout. Only the ground-floor offices, the canteen, the first-floor library and the second-floor open terrace come from a public source. The rest is placeholder.
- Ground-floor offices (principal, admin, exam department), the ground-floor canteen and the first-floor library follow VESIT's public description (Wikipedia).
- **Placeholders:** room numbers, lab positions, which department owns which floor (`FLOOR_DEPT` in `src/navigator/building.js`), faculty and senior names and contacts, and all map coordinates. `CAMPUS_CENTER` in `src/data/config.js` is a city-level placeholder.
- The grading scale is a fictional demo scale. Edit it in **Planner → Grading rules**.

## Known limitations

- Live MiniMoth OTP was implemented against the documented contract and unit-tested with a mocked API. It has **not** been tested against the live service, because no API key was available.
- The app has **not** been deployed. There's no GitHub/Netlify account access from the build environment.
- Indoor position during navigation is simulated (walking pace). There's no indoor GPS. Students set "You are at" manually.
- The single-file demo has no server, so only demo sign-in and the assistant's offline mode are available there.
- The live AI providers were tested with mocked APIs only, because no key was available while building. They haven't been tested against the live Gemini, Claude or OpenAI services. Check `/api/assistant/health` and ask one question after you add a key.
- Train times are the published schedule (April 2026 PTT). Bus times are estimates.

## Requirement traceability

| # | Requirement | Priority | Where | Test | Result | Status |
|---|---|---|---|---|---|---|
| 1 | Responsive React + Vite + Tailwind app | Must | whole app | build; browser run at 1440, 1100 and 390 px | pass | Implemented and verified |
| 2 | Dashboard: lectures, deadlines, recommendations, quick help | Must | `pages/Dashboard.jsx` | browser run | pass | Implemented and verified |
| 3 | Profiles with interests and subjects | Must | `pages/Profile.jsx`, `AppContext` | browser run; per-user `userData` | pass | Implemented and verified |
| 4 | Planner: subjects, credits, marks, cutoffs, passing minimums | Must | `pages/Planner.jsx`, `lib/academic.js` | unit tests (validation) | pass | Implemented and verified |
| 5 | Marks needed = required total − internal | Must | `marksTable` | `75−22=53` and other cases | pass | Implemented and verified |
| 6 | Locked impossible grades | Must | `marksTable` | needed > max locks; needed = max stays achievable | pass | Implemented and verified |
| 7 | Credit-weighted SGPA | Must | `computeSGPA` | (4×9+2×5)/6 = 7.67; zero credits guarded | pass | Implemented and verified |
| 8 | Target-SGPA feasibility | Must | `checkTarget` (DP over achievable grades) | ACHIEVABLE / NOT ACHIEVABLE / INSUFFICIENT DATA cases | pass | Implemented and verified |
| 9 | Subject passing minimums | Must | `marksTable`, `gradeFor` | internal and external minimum cases | pass | Implemented and verified |
| 10 | Ride discovery | Must | `pages/Rides.jsx` | browser run; search and filters | pass | Implemented and verified |
| 11 | Ride creation | Must | `createRide` | valid and invalid inputs | pass | Implemented and verified |
| 12 | Seat states Available, Requested, Confirmed | Must | `lib/rides.js` | flow, duplicates, overbooking, owner-only, refresh | pass | Implemented and verified |
| 13 | Student authentication | Must | `auth.mjs`, `lib/auth.js` | mocked-API unit tests | pass (mocked) | Needs external configuration (API key) |
| 14 | Challenge posting and completion | Must | `lib/challenges.js` | unit tests; browser run | pass | Implemented and verified |
| 15 | Points and live leaderboard | Must | `leaderboard()` | derived from completions; no double award | pass | Implemented and verified |
| 16 | Directory: faculty, seniors, labs, library, canteen | Must | `pages/Directory.jsx` | browser run; search and categories | pass | Implemented and verified |
| 17 | MiniMoth OTP send and verify | Must | `auth.mjs` | path, body, header and error-code tests | pass (mocked) | Needs external configuration |
| 18 | Access and refresh token handling | Must | cookie + memory token | refresh token never in JSON | pass (mocked) | Needs external configuration |
| 19 | Session validation | Must | `/api/auth/validate`, `/session` | mocked | pass (mocked) | Needs external configuration |
| 20 | Token refresh | Must | `/api/auth/session` | rotation replaces cookie | pass (mocked) | Needs external configuration |
| 21 | Logout and revocation | Must | `/api/auth/logout` | refresh-then-logout path | pass (mocked) | Needs external configuration |
| 22 | Meaningful interactions and animations | Expected | toasts, leaderboard flash and bars, result pop, 3D flights | browser run | pass | Implemented and verified |
| 23 | Leaflet + OSM for rides and places | Expected | `components/MapView.jsx`, `pages/Rides.jsx` | ride pins, campus pin, click-to-place, show on map, directions | pass (tiles need network) | Restored in the Rides section at the team's request (Oct 16) |
| 24 | LocalStorage / mock JSON data | Expected | `lib/storage.js`, `data/seed.js` | persistence, recovery and reset | pass | Implemented and verified |
| 25 | Responsive testing | Expected | — | 1440, 1100 and 390 px runs | pass | Implemented and verified |
| 26 | Four event statuses | USP | `lib/events.js` | boundary tests at start, end and reg-close | pass | Implemented and verified |
| 27 | Interest-based event suggestions | USP | `suggestEvents` | unit test; dashboard | pass | Implemented and verified |
| 28 | Time-credit rules | USP | `lib/peer.js` | 1 h = 1 credit, once; no negatives; reservations | pass | Implemented and verified |
| 29 | Peer statuses Matched, Booked, Completed | USP | `lib/peer.js` | transition tests; browser run | pass | Implemented and verified |
| 30 | What-if planner | USP | Planner → What-if | never mutates saved marks | pass | Implemented and verified |
| 31 | GitHub workflow | Deploy | repo layout, `.gitignore` | — | — | Ready; push not performed |
| 32 | Netlify readiness | Deploy | `netlify.toml`, function `config.path` | build | pass | Ready; not deployed |
| 33 | Server-side key protection | Deploy | `auth.mjs` | key absent from responses; bundle grep | pass | Implemented and verified |
| 34 | Build and runtime checks | Deploy | `npm run build`, `build:single` | browser run, no runtime errors | pass | Implemented and verified |
| 35 | README and env docs | Deploy | this file, `.env.example` | — | — | Implemented |
| 36 | Local train timetables, Kurla & Chembur | Added | `lib/transit.js`, `pages/Commute.jsx` | ordering, destination filter, fast filter, midnight wrap | pass | Implemented and verified |
| 37 | BEST buses near campus | Added | `data/buses.js` | frequency, printed vs estimate vs closed | pass | Implemented; full timetables not published by BEST |
| 38 | Voice assistant (4 languages, speaks back) | Added | `assistant/*` | offline understanding in en/hl/hi/mr, tool results, browser run | pass | Implemented and verified (offline); live AI needs a key |
| 39 | Confirm before any data change | Added | `clientTools.js` | pending → confirm → change; refusal of invalid actions | pass | Implemented and verified |
| 40 | Gemini → Claude → ChatGPT fallback, keys server-side | Added | `functions/assistant.mjs` | mocked providers, fallback, no key in responses | pass (mocked) | Needs API keys |
| 41 | MCP server | Added | `functions/mcp.mjs` | initialize, notifications, tools/list, tools/call, errors | pass | Implemented; not deployed |


## Phase update (Oct 2026): campus detail, weekly timetable, notifications, event approvals, challenge uploads

A backup of the previous build is kept: git tag `backup-before-phases`, and `campus360-demo.backup-before-phases.html`.

**3D campus (no rebuild).** The footprint, floors, lifts, stairs, amphitheatre, camera and routing are unchanged. The default view looks at the courtyard face from the south, so in these fixed coordinates the **west half (angle > 90°) is the left-hand side**. Every teaching room on the left is now a laboratory, and every one on the right is a classroom (`LEFT_OF` in `navigator/building.js`, enforced by a test on every floor).
- Window side, between the fixed staff-lift shafts: 8 labs on the left and 13 classrooms on the right.
- On floor 1, the library takes the centre-left stretch.
- Lab names appear only where the app's own records (directory, timetable, events) put them. Every other lab has a neutral "Lab ‹code›" label.
- Furniture is merged into each floor's single mesh, so it adds no draw calls and can't be clicked. Room picking is mathematical, so furniture never blocks selection or routes.
  - Classrooms: a dais, a board, a teacher's desk, and desks with benches in rows with a centre aisle.
  - Labs: wall benches with monitors, a two-sided island bench and storage cabinets.
  - Door signs are amber for labs and blue for classrooms.
- Top-down view is now north-up, so it matches the default view and the floor plan.

**Weekly timetable.** The Dashboard shows Monday to Sunday tabs (arrow keys work), with Monday first and the last choice remembered. Each entry shows its time, title, lecture/lab type, the room's own kind (Laboratory or Classroom), the room and floor, and a Route link. Days with no records say so; no entries are invented.

**Notification centre.** A bell with an unread count sits in the desktop top bar and the mobile header. On the full-screen navigator it moves to the sidebar, so the map keeps its full height. Records come only from real actions:
- new event published;
- request received, approved, rejected or waitlisted;
- event updated;
- deadline added, changed or due within 24 h;
- challenge posted for your class;
- solution submitted or reviewed.

Each record has a key, so reloads never duplicate it. Read state persists.

**Event requests.** The flow is: event details → form (prefilled from the profile, per-event fields) → review → submit → **Pending approval**. The organiser then approves, rejects (with an optional reason) or waitlists the request.
- Only Approved counts towards capacity, and approval beyond capacity is refused.
- The registration window is checked on submit, and on decision (decisions stop once the event starts).
- Duplicate requests are blocked, and students can withdraw.
- Demo organiser: **Events Office (demo organiser)** on the sign-in page, which opens the **Organiser desk** (requests, my events, publish event, submissions).

**Challenge briefs and solutions.** Posters can attach PDF, JPG or PNG files (10 MB each, up to 5) and require a solution upload, choosing the allowed formats and size limit.
- Files are checked by extension, MIME type, size and first bytes, and stored in **IndexedDB**, never in LocalStorage.
- A submission is saved only after the file write commits.
- Reviewers (the poster or an organiser) can accept, request changes (feedback required) or reject.
- Acceptance writes the normal completion record, so leaderboard points are awarded exactly once.
- Upload challenges can't be self-completed.

### Notifications, requests and files: multi-user delivery (not in this build)
Everything above is stored in **this browser**. Demo accounts on the same browser see each other's requests and notifications, but **other devices do not**. Real multi-user use needs:
1. A database with tables `events`, `registrations`, `notifications`, `challenges` and `submissions`. Netlify DB, Supabase Postgres or any Postgres works.
2. Server endpoints that run the same rules as `src/lib/events.js` and `src/lib/challenges.js`, and that check the caller's role from the verified session (MiniMoth identity → profile role). Hiding buttons is not enough.
3. File storage for briefs and solutions, such as Netlify Blobs or S3, with signed URLs. The `fileId` field becomes the object key.
4. Delivery: notifications are written server-side and fetched on load or polled. Web Push or email is optional.


## Oct 16 update: landing page and rides map
- **Landing page** (`src/pages/Landing.jsx`): this is what visitors see at `/`. Everyone can open it at `/welcome`. It has:
  - the live, orbitable 3D model (click it to open the navigator);
  - counts taken from the app's own data;
  - the next timetabled trains from Chembur and Kurla;
  - upcoming published events;
  - links to every feature.

  It shows public data only. Nothing personal appears on it.
- **Rides map:**
  - Leaflet with the CARTO light basemap (OpenStreetMap data).
  - The campus pin uses VESIT's real coordinates (19.045879, 72.889285).
  - Station pins come from `data/network.js` and are approximate.
  - Each ride card has *Show on map* and *Directions* (opens Google Maps).
  - Offering a ride supports click-to-place on the map and *Use my location for pickup*, which needs browser permission.
  - If tiles can't load, the map switches to a plain grid with a notice.


## Oct 16 (later): teacher portal, targeting, attendance, canteens, notes

**Storage, read this first.** The database phase was skipped at the team's request. Everything in this section is saved in the browser: records in LocalStorage, files in IndexedDB. The rules run in shared pure functions (`src/lib/posts.js`, `attendance.js`, `canteen.js`, `notes.js`, `admin.js`), so they can be moved to server endpoints unchanged. Until then:
- Accounts on the same browser see each other's data.
- Other devices don't see any of it.
- Rules are enforced in the app's code, not on a server.

**Roles**
- **Admin:** set on the server only, by `ADMIN_PHONES` (comma-separated numbers) in the hosting environment. `netlify/functions/auth.mjs` returns `admin: true` for a verified phone on that list. There is also a demo admin account.
- **Teacher:** the admin adds the teacher's phone number, linked email and classes (division + subject) to the allowlist. When that phone signs in with MiniMoth OTP, the profile gets the teacher role. Knowing a phone number or email alone grants nothing.
- **Students:** must complete year → branch → division → roll number at onboarding. The roll number is unique within a year + branch. After saving, these are locked, and only an admin can change them. History is kept.

**Divisions** are placeholders (two per year and branch, e.g. D1ADA / D1ADB) in `src/data/academics.js`. Replace them with the college's list.

**Teacher portal** (`/teacher`)
- Send assignments, challenges, notices, lecture announcements and documents. Each one picks a year, then branch, then one or more divisions. Teachers can only pick their own assigned divisions. The final audience and exact recipient count are shown before sending.
- Edit, close, reopen or archive what you sent. The audience can't change after sending.
- Review assignment and challenge submissions.
- Teaching schedule.
- Attendance desk (below).

**Students**
- **Classwork** (`/classwork`): items for their division only. A direct link to another division's item is refused. Students can submit assignments.

**Attendance** is recorded per lecture: one division + subject + date + start time, which must be unique.
- Corrections need the teacher's edit password, stored as a salted PBKDF2-SHA-256 hash, and lock for 10 minutes after 5 wrong tries. Each correction also needs a reason. Every change is logged with its before and after values.
- A stale-version check stops overwriting a newer save.
- Students see only their own records: overall, week, month and year figures, subject by subject, a calendar and lecture history.
- The percentage is present ÷ recorded × 100. Cancelled lectures and lectures with no saved record are excluded, and are never counted as absences.
- Lectures in the timetable with no saved record are listed as "unrecorded".
- The class register can be exported as CSV.

**Canteens** (`/canteen`): separate VESIT and VESIM menus, transcribed from the team's photos. Only clearly priced items are included. The VESIM menu is marked partial.
- Category filters, search, and sorting by price (numeric), rating or name.
- One review per student per dish, which they can edit or remove. Averages are computed from the stored reviews.
- Only an admin can edit menus and prices.

**Notes library** (`/notes`)
- Files are organised by year → branch → subject → topic/chapter → subtopic.
- Each note is visible either institute-wide or to its year + branch only.
- Filters and search, plus edit or remove for the uploader. Files are checked by extension, MIME type, size and first bytes.
- Students can report a note. Three open reports hide it until an admin reviews it.

**Rides and peer learning**
- The driver can decline requests and cancel the ride. Seat requests, confirmations, declines and cancellations all notify the right person.
- Peer matches, bookings and cancellations notify the other student.

**Tests**
- 120 unit tests, including the batch-targeting, assignment, notice, attendance, canteen, notes, rides and peer scenarios from the spec.
- A 34-check browser run covering teacher, D1ADA student, D1ADB student, other-branch student and admin.
- The earlier 48-check run, the landing-page checks and the older regression run.
