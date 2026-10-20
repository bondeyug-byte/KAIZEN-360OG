import { describe, it, expect } from 'vitest'
import { makeSeed } from '../src/data/seed.js'
import { parse, compose, isYes, isNo } from '../src/assistant/offline.js'
import { runTool, performAction, ALL_TOOLS, isAction } from '../src/assistant/clientTools.js'
import { resolvePlace, runPublicTool } from '../src/assistant/publicTools.js'
import * as ai from '../netlify/functions/assistant.mjs'
import * as mcp from '../netlify/functions/mcp.mjs'

const now = new Date(Date.UTC(2026, 9, 15, 4, 30)) // Thu 10:00 IST
const db = makeSeed(now)
const me = db.profiles.u_aarav
const ctx = { db, me, myData: db.userData.u_aarav, now }
const call = (text) => parse(text, ctx).calls[0]

describe('offline understanding (en / Hinglish / Hindi / Marathi)', () => {
  it('trains', () => {
    expect(call('next fast train from Kurla to Thane')).toMatchObject({ name: 'next_trains', args: { from: 'Kurla', to: 'Thane', type: 'fast' } })
    expect(call('Chembur se Vashi next train kab hai')).toMatchObject({ name: 'next_trains', args: { from: 'Chembur', to: 'Vashi' } })
    expect(call('चेंबूर से वाशी अगली ट्रेन')).toMatchObject({ name: 'next_trains', args: { from: 'Chembur', to: 'Vashi' } })
    expect(call('कुर्ला ते ठाणे फास्ट ट्रेन')).toMatchObject({ name: 'next_trains', args: { from: 'Kurla', to: 'Thane', type: 'fast' } })
  })
  it('buses, schedule, deadlines, places', () => {
    expect(call('bus to Kurla')).toMatchObject({ name: 'buses_near_campus', args: { toward: 'kurla' } })
    expect(call("what's my next lecture")).toMatchObject({ name: 'my_schedule' })
    expect(call('kal ka timetable')).toMatchObject({ name: 'my_schedule', args: { day: 'tomorrow' } })
    expect(call('कौन से असाइनमेंट बाकी हैं')).toMatchObject({ name: 'my_deadlines' })
    expect(call('माझं पुढचं लेक्चर कधी आहे')).toMatchObject({ name: 'my_schedule' })
    expect(call('take me to the library')).toMatchObject({ name: 'navigate_to' })
    expect(call('where is the physics lab')).toMatchObject({ name: 'find_place' })
  })
  it('actions resolve to the right record', () => {
    expect(call('register me for the photography walk')).toMatchObject({ name: 'register_event', args: { event_id: 'ev_3' } })
    expect(call('book a seat on a ride to campus')).toMatchObject({ name: 'request_ride_seat' })
    expect(call('physics journal assignment done')).toMatchObject({ name: 'mark_deadline_done', args: { deadline_id: 'dl2' } })
  })
  it('yes / no in four languages', () => {
    for (const y of ['yes', 'Haan', 'हाँ', 'हो', 'ok']) expect(isYes(y)).toBe(true)
    for (const n of ['no', 'nahi', 'नहीं', 'नको', 'cancel']) expect(isNo(n)).toBe(true)
  })
})

describe('tools', () => {
  it('places resolve by name, code and Hindi word', () => {
    expect(resolvePlace('library')[0].id).toBe('library')
    expect(resolvePlace('room 305')[0]).toMatchObject({ f: 3, code: '305' })
    expect(resolvePlace('ग्रंथालय')[0].id).toBe('library')
    expect(resolvePlace('canteen')[0].id).toBe('canteen')
  })
  it('campus route returns steps', () => {
    const r = runPublicTool('campus_route', { to: 'library' })
    expect(r.ok).toBe(true); expect(r.steps.length).toBeGreaterThan(1)
  })
  it('schedule for Thursday lists rooms', () => {
    const r = runTool('my_schedule', { day: 'today' }, ctx).result
    expect(r.lectures.length).toBeGreaterThan(0)
    expect(r.lectures[0]).toHaveProperty('room')
  })
  it('actions return pending, and only change data after confirmation', () => {
    const out = runTool('register_event', { event_id: 'ev_3' }, ctx)
    expect(out.pending).toBeTruthy()
    expect(out.result.status).toBe('awaiting_confirmation')
    const before = db.shared.registrations.length
    let state = db.shared
    const runShared = (fn) => { const r = fn(state); if (r.ok) state = r.state; return r }
    const done = performAction(out.pending, { runShared, updateMyData: () => {}, me, now })
    expect(done.ok).toBe(true)
    expect(state.registrations).toHaveLength(before + 1)
    expect(state.registrations.at(-1).status).toBe('Pending approval') // a request, not a registration
  })
  it('invalid actions are refused before asking', () => {
    expect(runTool('register_event', { event_id: 'ev_6' }, ctx).pending).toBeUndefined()
    expect(runTool('request_ride_seat', { ride_id: 'ride_3' }, ctx).result.ok).toBe(false) // own ride
  })
  it('navigate_to opens the navigator with auto-start', () => {
    expect(runTool('navigate_to', { place: 'library' }, ctx).open).toMatch(/^\/navigator\?f=1&id=library&go=1/)
  })
  it('every action tool is flagged, every tool has a schema', () => {
    for (const t of ALL_TOOLS) expect(t.parameters.type).toBe('object')
    expect(isAction('register_event')).toBe(true); expect(isAction('my_schedule')).toBe(false)
  })
  it('composes a short spoken answer', () => {
    const r = runPublicTool('next_trains', { from: 'Chembur', to: 'Vashi' }, now)
    expect(compose('en', 'next_trains', r)).toMatch(/^Next .* train from Chembur is at/)
    expect(compose('hi', 'next_trains', r)).toMatch(/चेंबूर|Chembur/)
  })
})

// ---------- AI proxy ----------
const post = (body, headers = {}) => new Request('https://c360.example/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const tools = [{ name: 'my_schedule', description: 'x', parameters: { type: 'object', properties: {} } }]
const mockFetch = (handlers) => async (url, init) => {
  for (const [re, fn] of handlers) if (re.test(url)) return fn(url, init)
  throw new Error('unexpected ' + url)
}
const res = (status, body) => new Response(JSON.stringify(body), { status })

describe('AI proxy function', () => {
  it('health lists configured providers only, never keys', async () => {
    const r = await ai.handle(new Request('https://c360.example/api/assistant/health'), { GEMINI_API_KEY: 'g-secret', OPENAI_API_KEY: 'o-secret' })
    const j = await r.json()
    expect(j).toEqual({ available: true, providers: ['Gemini', 'ChatGPT'], order: ['gemini', 'openai'] })
    expect(JSON.stringify(j)).not.toMatch(/secret/)
  })
  it('503 when no key is configured', async () => {
    const r = await ai.handle(post({ messages: [{ role: 'user', text: 'hi' }], tools }), {})
    expect(r.status).toBe(503)
  })
  it('rejects cross-site calls and bad bodies', async () => {
    expect((await ai.handle(post({ messages: [{ role: 'user', text: 'x' }], tools }, { origin: 'https://evil.example' }), { GEMINI_API_KEY: 'k' })).status).toBe(403)
    expect((await ai.handle(post({ messages: [], tools }), { GEMINI_API_KEY: 'k' })).status).toBe(400)
  })
  it('Gemini: sends key in header, returns tool calls with raw parts', async () => {
    let seen
    const f = mockFetch([[/generateContent/, (url, init) => { seen = { url, init }; return res(200, { candidates: [{ content: { parts: [{ functionCall: { name: 'my_schedule', args: { day: 'today' } }, thoughtSignature: 'sig' }] } }] }) }]])
    const r = await ai.handle(post({ messages: [{ role: 'user', text: 'next lecture?' }], tools, lang: 'hi' }), { GEMINI_API_KEY: 'gk', GEMINI_MODEL: 'gemini-x-flash' }, f)
    const j = await r.json()
    expect(j.provider).toBe('gemini')
    expect(j.calls[0]).toMatchObject({ name: 'my_schedule', args: { day: 'today' } })
    expect(j.raw[0].thoughtSignature).toBe('sig')
    expect(seen.url).not.toMatch(/gk/)
    expect(seen.init.headers['x-goog-api-key']).toBe('gk')
    const body = JSON.parse(seen.init.body)
    expect(body.systemInstruction.parts[0].text).toMatch(/Hindi/)
    expect(body.tools[0].functionDeclarations[0].name).toBe('my_schedule')
  })
  it('falls back Gemini → Claude when Gemini fails', async () => {
    const f = mockFetch([[/generateContent/, () => res(429, { error: { status: 'RESOURCE_EXHAUSTED' } })], [/anthropic/, (u, init) => { expect(init.headers['x-api-key']).toBe('ak'); return res(200, { content: [{ type: 'text', text: 'Your next lecture is at 10:15.' }] }) }]])
    const j = await (await ai.handle(post({ messages: [{ role: 'user', text: 'hi' }], tools }), { GEMINI_API_KEY: 'gk', GEMINI_MODEL: 'm', ANTHROPIC_API_KEY: 'ak' }, f)).json()
    expect(j).toMatchObject({ provider: 'claude', label: 'Claude', text: 'Your next lecture is at 10:15.' })
    expect(j.fellBackFrom[0]).toMatchObject({ provider: 'gemini', status: 429 })
  })
  it('OpenAI: converts tool results and parses tool calls', async () => {
    let sent
    const f = mockFetch([[/openai/, (u, init) => { sent = JSON.parse(init.body); return res(200, { choices: [{ message: { content: 'Done.', tool_calls: [] } }] }) }]])
    const messages = [{ role: 'user', text: 'q' }, { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'my_schedule', args: {} }] }, { role: 'tool', id: 'c1', name: 'my_schedule', result: { lectures: [] } }]
    const j = await (await ai.handle(post({ messages, tools }), { OPENAI_API_KEY: 'ok' }, f)).json()
    expect(j.text).toBe('Done.')
    expect(sent.messages[2].tool_calls[0].id).toBe('c1')
    expect(sent.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'c1' })
  })
  it('Claude conversion groups tool results into one user turn', () => {
    const out = ai.toClaude([{ role: 'user', text: 'q' }, { role: 'assistant', calls: [{ id: 'a', name: 'x', args: {} }, { id: 'b', name: 'y', args: {} }] }, { role: 'tool', id: 'a', name: 'x', result: 1 }, { role: 'tool', id: 'b', name: 'y', result: 2 }])
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(out[2].content.map((c) => c.tool_use_id)).toEqual(['a', 'b'])
  })
  it('all providers failing gives 502 with no secrets', async () => {
    const f = mockFetch([[/./, () => res(500, {})]])
    const r = await ai.handle(post({ messages: [{ role: 'user', text: 'q' }], tools }), { GEMINI_API_KEY: 'g1', GEMINI_MODEL: 'm', OPENAI_API_KEY: 'o1' }, f)
    expect(r.status).toBe(502)
    expect(await r.text()).not.toMatch(/g1|o1/)
  })
})

// ---------- MCP ----------
const rpc = (body) => mcp.handle(new Request('https://c360.example/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) }), now)

describe('MCP server', () => {
  it('initializes with a supported protocol version', async () => {
    const j = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json()
    expect(j.result.protocolVersion).toBe('2025-06-18')
    expect(j.result.capabilities.tools).toBeTruthy()
    expect(j.result.serverInfo.name).toBe('campus360')
  })
  it('acknowledges notifications with 202', async () => {
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
  })
  it('lists read-only public tools only', async () => {
    const j = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
    const names = j.result.tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['find_place', 'campus_route', 'next_trains', 'buses_near_campus', 'campus_events', 'campus_contacts']))
    expect(names.some((n) => n.startsWith('my_') || isAction(n))).toBe(false)
    expect(j.result.tools.every((t) => t.annotations.readOnlyHint && t.inputSchema.type === 'object')).toBe(true)
  })
  it('calls a tool and returns text + structured content', async () => {
    const j = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'next_trains', arguments: { from: 'Kurla', to: 'Thane' } } })).json()
    expect(j.result.isError).toBe(false)
    expect(j.result.structuredContent.trains.length).toBeGreaterThan(0)
    expect(JSON.parse(j.result.content[0].text).from).toBe('Kurla')
  })
  it('unknown method and tool give JSON-RPC errors; GET is 405', async () => {
    expect((await (await rpc({ jsonrpc: '2.0', id: 4, method: 'nope' })).json()).error.code).toBe(-32601)
    expect((await (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'my_deadlines' } })).json()).error.code).toBe(-32602)
    expect((await mcp.handle(new Request('https://c360.example/mcp'))).status).toBe(405)
  })
})

describe('knowledge and journeys in the assistant', () => {
  it('answers campus facts from the knowledge base with a source', () => {
    const c = parse('how do I get to college from Kurla station', ctx).calls[0]
    expect(['campus_info', 'plan_journey']).toContain(c.name)
    const r = runPublicTool('campus_info', { query: 'is VESIT autonomous' })
    expect(r.found).toBe(true); expect(r.results[0].source).toMatch(/Wikipedia/)
    expect(runPublicTool('campus_info', { query: 'hostel fees for 2027 xyz' }).found).toBe(false)
  })
  it('plans a journey from a misspelled station', () => {
    expect(parse('Dombili se college kaise jaun', ctx).calls[0]).toMatchObject({ name: 'plan_journey', args: { from: 'dombili' } })
    expect(parse('how do I get to campus from Thane', ctx).calls[0]).toMatchObject({ name: 'plan_journey' })
    const r = runPublicTool('plan_journey', { from: 'dombili' }, now)
    expect(r.ok).toBe(true); expect(r.from).toBe('Dombivli')
    expect(compose('en', 'plan_journey', r)).toMatch(/via Kurla/)
  })
})
