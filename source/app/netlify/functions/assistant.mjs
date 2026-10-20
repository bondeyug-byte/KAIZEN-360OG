// Campus360 voice assistant — AI proxy (Netlify Function).
// Keys live ONLY here, in server environment variables:
//   GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY   (any subset; missing ones are skipped)
//   optional: GEMINI_MODEL, ANTHROPIC_MODEL, OPENAI_MODEL, AI_ORDER (e.g. "gemini,claude,openai")
// The browser sends the conversation and tool definitions; the model's tool calls are returned to the
// browser, which runs them against the student's own data and sends the results back. The server is
// stateless and never sees an API key in a request, and never returns one.

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const TIMEOUT_MS = 20000
const LIMITS = { messages: 40, tools: 30, bodyBytes: 120000, text: 2000 }

export const PROVIDERS = {
  gemini: { label: 'Gemini', key: 'GEMINI_API_KEY' },
  claude: { label: 'Claude', key: 'ANTHROPIC_API_KEY' },
  openai: { label: 'ChatGPT', key: 'OPENAI_API_KEY' },
}
export function providerOrder(env) {
  const order = (env.AI_ORDER || 'gemini,claude,openai').split(',').map((s) => s.trim()).filter((p) => PROVIDERS[p])
  return order.filter((p) => !!env[PROVIDERS[p].key])
}

const LANG = {
  en: 'Reply in simple English.',
  hl: 'Reply in Hinglish: Hindi words written in Latin script mixed with English, the way Mumbai students text.',
  hi: 'Reply in Hindi (Devanagari script). Keep English names of places, trains and subjects as they are.',
  mr: 'Reply in Marathi (Devanagari script). Keep English names of places, trains and subjects as they are.',
}

export function systemPrompt({ lang = 'en', context = {} } = {}) {
  return [
    'You are Campus360, the voice assistant for first-year students at VES Institute of Technology (VESIT), Collector Colony, Chembur, Mumbai. You are friendly, quick and practical, like a helpful senior.',
    '',
    'HOW TO ANSWER',
    '- Your answer is read aloud. Use 1 to 3 short sentences. No markdown, lists, emojis or URLs.',
    '- Lead with the direct answer. Then, if useful, one concrete next step ("Say take me there", "Want me to register you?").',
    '- Use times like "9:15 AM" and say how long until things happen ("in 12 minutes").',
    '',
    'GROUNDING RULES (most important)',
    '- Only state facts that come from a tool result in this conversation. Never invent times, rooms, people, phone numbers, fees, dates, rules or train/bus details.',
    '- For any general question about VESIT (address, history, floors, how to reach, labs, fest, emergency) call campus_info first. If it returns found=false, say you do not know and suggest the college office.',
    '- For the student\'s own day call my_schedule, my_deadlines, my_events, my_rides, my_academics, my_challenges or my_peer_learning. For places inside the building call find_place or campus_route. For trains call next_trains; for buses call buses_near_campus.',
    '- If a result is marked sample, demo, placeholder or estimate, say so in a few words ("sample data", "estimated"). Train times are scheduled, not live. Bus waits are estimates; mention the Chalo app for live buses.',
    '- Grades and SGPA use the app\'s demo grading scale; never present it as an official university rule.',
    '',
    'ACTIONS',
    '- Event registration is a REQUEST that the organiser approves or rejects later; never say the student is registered until my_events shows request "Approved".',
    '- Booking a ride seat, requesting an event place, marking or adding a deadline, and completing a challenge: call the matching tool. It returns awaiting_confirmation and the app shows a Confirm button. Then ask the student to confirm in one sentence. Never say it is done.',
    '- If you need an id (ride, event, deadline, challenge), call the list tool first (my_rides, my_events, my_deadlines, my_challenges) and pick the item that matches what the student said. If two match, ask which one.',
    '- navigate_to and open_page need no confirmation; call them when the student wants to go somewhere or see a page.',
    '',
    'EXAMPLES (tool results shortened)',
    'Student: whats my next lecture -> call my_schedule {day:"today"} -> You say: "Next up is Engineering Physics at 10:15 AM in Room 105 on Floor 1, in 20 minutes. Say take me there if you need directions."',
    'Student: Chembur se Vashi train kab hai (Hinglish) -> call next_trains {from:"Chembur", to:"Vashi"} -> You say: "Chembur se next slow train 8:04 AM ko hai, 6 min mein, Vashi 8:19 tak pahunchegi. Uske baad 8:10 aur 8:16."',
    'Student: how do I get to college from Kurla -> call campus_info -> You say: "From Kurla East take BEST bus 432 to the Vivekanand College stop, then walk about 9 minutes. An auto is about 4 km."',
    'Student: register me for the photography walk -> call my_events, then register_event {event_id} -> You say: "I can send a registration request for the Photography walk on Sunday at 12:34 PM at the main lobby; the organiser then approves it. Shall I send it?"',
    'Student: who is the HOD of computers -> call campus_info (found=false) and directory_search -> You say: "The directory only has sample contacts, so I can\'t confirm the real HOD. The department office on the department\'s floor can tell you."',
    '',
    'SCOPE',
    '- Stay on campus life, study and commuting. For anything else, answer in one line or say you can only help with campus things.',
    '- If the student sounds distressed or unsafe, give the emergency number 112 and suggest telling campus security.',
    '',
    LANG[lang] || LANG.en,
    'If the student writes in a different language from that setting, reply in the language they used.',
    `Now: ${context.now || new Date().toISOString()} (India time ${context.nowText || ''}).`,
    context.page ? `The student is on the ${context.page} page.` : '',
    context.student ? `Student: ${context.student}.` : 'The student is not signed in; personal tools will say so.',
  ].filter((x) => x !== '').join('\n')
}

// ---------- helpers ----------
async function withTimeout(f, url, init) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try { return await f(url, { ...init, signal: ac.signal }) } finally { clearTimeout(t) }
}
class ProviderError extends Error { constructor(provider, status, code) { super(`${provider} ${status} ${code || ''}`.trim()); this.provider = provider; this.status = status; this.code = code } }
const safeId = (s, i) => (String(s || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || `call_${i}`)

/** Merge consecutive messages of the same role; used by providers that need alternation. */
function groupTurns(messages) {
  const out = []
  for (const m of messages) {
    const role = m.role === 'tool' ? 'tool' : m.role
    const last = out[out.length - 1]
    if (last && last.role === role) last.items.push(m)
    else out.push({ role, items: [m] })
  }
  return out
}

// Gemini's schema dialect: drop keys it doesn't accept.
function geminiSchema(s) {
  if (!s || typeof s !== 'object') return s
  const o = {}
  for (const [k, v] of Object.entries(s)) {
    if (['additionalProperties', '$schema', 'default'].includes(k)) continue
    o[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, geminiSchema(pv)])) : typeof v === 'object' && !Array.isArray(v) ? geminiSchema(v) : v
  }
  return o
}

// ---------- Gemini ----------
let geminiModelCache = null
export async function pickGeminiModel(env, f) {
  if (env.GEMINI_MODEL) return env.GEMINI_MODEL
  if (geminiModelCache) return geminiModelCache
  try {
    const r = await withTimeout(f, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } })
    const j = await r.json()
    const names = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''))
    const ver = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0')
    const pick = (re) => names.filter((n) => re.test(n)).sort((a, b) => ver(b) - ver(a))[0]
    geminiModelCache = pick(/^gemini-[\d.]+-flash$/) || pick(/^gemini-[\d.]+-flash-latest$|^gemini-flash-latest$/) || pick(/^gemini-[\d.]+-flash(-preview)?(-\d\d-\d{4})?$/) || 'gemini-flash-latest'
  } catch { geminiModelCache = 'gemini-flash-latest' }
  return geminiModelCache
}

export function toGemini(messages) {
  const contents = []
  for (const turn of groupTurns(messages)) {
    if (turn.role === 'user') contents.push({ role: 'user', parts: turn.items.map((m) => ({ text: String(m.text || '').slice(0, LIMITS.text) })) })
    else if (turn.role === 'assistant') {
      const parts = []
      for (const m of turn.items) {
        if (m.provider === 'gemini' && Array.isArray(m.raw)) { parts.push(...m.raw); continue }
        if (m.text) parts.push({ text: m.text })
        for (const c of m.calls || []) parts.push({ functionCall: { name: c.name, args: c.args || {} }, thoughtSignature: 'skip_thought_signature_validator' })
      }
      if (parts.length) contents.push({ role: 'model', parts })
    } else contents.push({ role: 'user', parts: turn.items.map((m) => ({ functionResponse: { name: m.name, response: { result: m.result } } })) })
  }
  return contents
}

async function callGemini({ system, messages, tools }, env, f) {
  const model = await pickGeminiModel(env, f)
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGemini(messages),
    tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.parameters) })) }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
  }
  const r = await withTimeout(f, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { if (r.status === 404) geminiModelCache = null; throw new ProviderError('gemini', r.status, j.error?.status) }
  const parts = j.candidates?.[0]?.content?.parts || []
  const calls = parts.filter((p) => p.functionCall).map((p, i) => ({ id: safeId(p.functionCall.id, i) + '_' + Date.now().toString(36), name: p.functionCall.name, args: p.functionCall.args || {} }))
  const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim()
  if (!calls.length && !text) throw new ProviderError('gemini', 502, j.candidates?.[0]?.finishReason || 'EMPTY')
  return { model, text, calls, raw: parts }
}

// ---------- Claude ----------
export function toClaude(messages) {
  const out = []
  for (const turn of groupTurns(messages)) {
    if (turn.role === 'assistant') {
      const content = []
      for (const m of turn.items) {
        if (m.text) content.push({ type: 'text', text: m.text })
        for (const c of m.calls || []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} })
      }
      if (content.length) out.push({ role: 'assistant', content })
    } else {
      const content = turn.items.map((m) => (m.role === 'tool' ? { type: 'tool_result', tool_use_id: m.id, content: JSON.stringify(m.result ?? null) } : { type: 'text', text: String(m.text || '').slice(0, LIMITS.text) }))
      const prev = out[out.length - 1]
      if (prev && prev.role === 'user') prev.content.push(...content)
      else out.push({ role: 'user', content })
    }
  }
  return out
}

async function callClaude({ system, messages, tools }, env, f) {
  const model = env.ANTHROPIC_MODEL || 'claude-haiku-5-5'
  const r = await withTimeout(f, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 700, system, messages: toClaude(messages), tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ProviderError('claude', r.status, j.error?.type)
  const content = j.content || []
  return { model, text: content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim(), calls: content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, args: c.input || {} })) }
}

// ---------- OpenAI ----------
export function toOpenAI(messages) {
  const out = []
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: String(m.text || '').slice(0, LIMITS.text) })
    else if (m.role === 'assistant') {
      const msg = { role: 'assistant', content: m.text || null }
      if (m.calls?.length) msg.tool_calls = m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }))
      if (msg.content || msg.tool_calls) out.push(msg)
    } else out.push({ role: 'tool', tool_call_id: m.id, content: JSON.stringify(m.result ?? null) })
  }
  return out
}

async function callOpenAI({ system, messages, tools }, env, f) {
  const model = env.OPENAI_MODEL || 'gpt-5.4-mini'
  const r = await withTimeout(f, 'https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...toOpenAI(messages)], tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), max_completion_tokens: 1500 }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new ProviderError('openai', r.status, j.error?.code || j.error?.type)
  const m = j.choices?.[0]?.message || {}
  return { model, text: (m.content || '').trim(), calls: (m.tool_calls || []).map((c) => { let args = {}; try { args = JSON.parse(c.function.arguments || '{}') } catch { /* keep empty */ } return { id: c.id, name: c.function.name, args } }) }
}

const CALL = { gemini: callGemini, claude: callClaude, openai: callOpenAI }

// ---------- validation ----------
function validate(body) {
  if (!body || !Array.isArray(body.messages) || !body.messages.length) return 'messages required'
  if (body.messages.length > LIMITS.messages) return 'conversation too long'
  if (!Array.isArray(body.tools) || body.tools.length > LIMITS.tools) return 'tools invalid'
  for (const m of body.messages) {
    if (!['user', 'assistant', 'tool'].includes(m.role)) return 'bad role'
    if (m.role === 'tool' && (!m.id || !m.name)) return 'bad tool result'
  }
  for (const t of body.tools) if (!t?.name || !/^[a-zA-Z0-9_-]{1,64}$/.test(t.name) || typeof t.parameters !== 'object') return 'bad tool'
  return null
}

export async function handle(req, env = process.env, f = fetch) {
  const url = new URL(req.url)
  const sub = url.pathname.replace(/^\/api\/assistant\/?/, '')
  if (req.method === 'GET' && (sub === 'health' || sub === '')) {
    const order = providerOrder(env)
    return json(200, { available: order.length > 0, providers: order.map((p) => PROVIDERS[p].label), order })
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const origin = req.headers.get('origin')
  if (origin && new URL(origin).host !== url.host) return json(403, { error: 'Cross-site requests are not allowed' })
  const raw = await req.text()
  if (raw.length > LIMITS.bodyBytes) return json(413, { error: 'Request too large' })
  let body
  try { body = JSON.parse(raw) } catch { return json(400, { error: 'Invalid JSON' }) }
  const bad = validate(body)
  if (bad) return json(400, { error: bad })

  let order = providerOrder(env)
  if (!order.length) return json(503, { error: 'No AI provider is configured on the server', code: 'NOT_CONFIGURED' })
  if (body.prefer && order.includes(body.prefer)) order = [body.prefer, ...order.filter((p) => p !== body.prefer)]
  const system = systemPrompt({ lang: body.lang, context: body.context || {} })
  const tried = []
  for (const p of order) {
    try {
      const out = await CALL[p]({ system, messages: body.messages, tools: body.tools }, env, f)
      return json(200, { provider: p, label: PROVIDERS[p].label, model: out.model, text: out.text, calls: out.calls, raw: out.raw, fellBackFrom: tried })
    } catch (e) {
      tried.push({ provider: p, status: e.status || 0, code: e.code || (e.name === 'AbortError' ? 'TIMEOUT' : 'ERROR') })
    }
  }
  return json(502, { error: 'All AI providers failed', code: 'ALL_FAILED', tried })
}

export default async (req) => handle(req, process.env)
export const config = { path: ['/api/assistant', '/api/assistant/*'] }
