// Campus360 MCP server (Streamable HTTP, stateless, JSON responses).
// Add https://<your-site>/mcp as a custom connector in Claude or ChatGPT (developer mode) to ask about
// VESIT rooms and routes, Kurla/Chembur trains, buses near campus, events and contacts.
// Public, read-only data only: students' personal data lives in their own browser and is never here.
import { PUBLIC_TOOLS, runPublicTool } from '../../src/assistant/publicTools.js'
import { makeSeed } from '../../src/data/seed.js'
import { eventStatus } from '../../src/lib/events.js'

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const LATEST = '2025-06-18'
const SERVER = { name: 'campus360', title: 'Campus360 — VESIT campus companion', version: '1.1.0' }
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Authorization', 'Access-Control-Expose-Headers': 'Mcp-Session-Id' }
const send = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...(body === null ? {} : { 'Content-Type': 'application/json' }), 'Cache-Control': 'no-store', ...CORS } })

const fmt = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
const EXTRA_TOOLS = [
  { name: 'campus_events', description: 'Upcoming campus events with status (Registration Open / Starting Soon / Live Now). SAMPLE data in this demo.', parameters: { type: 'object', properties: { interest: { type: 'string', description: 'Optional interest tag, e.g. coding, music, robotics' } } } },
  { name: 'campus_contacts', description: 'Who to contact on campus: faculty, senior mentors, labs, library, canteen, exam cell, admin office. SAMPLE records with fictional names.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Need or name, e.g. "exam cell", "maths doubts"' } }, required: ['query'] } },
]
function runExtra(name, args, now) {
  const seed = makeSeed(now)
  if (name === 'campus_events') {
    const q = (args.interest || '').toLowerCase()
    const list = seed.shared.events.map((e) => ({ title: e.title, when: fmt(e.start), where: e.place.label, status: eventStatus(e, now), tags: e.tags })).filter((e) => e.status !== 'Event Ended' && (!q || e.tags.some((t) => t.includes(q))))
    return { events: list, note: 'Sample events for the demo; real events come from the college.' }
  }
  if (name === 'campus_contacts') {
    const w = String(args.query || '').toLowerCase().split(/\s+/).filter((x) => x.length > 2)
    const hits = seed.shared.directory.map((e) => ({ e, s: w.reduce((n, x) => n + ([e.name, e.purpose, e.category, e.place.label].join(' ').toLowerCase().includes(x) ? 1 : 0), 0) })).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 5)
    return { matches: hits.map(({ e }) => ({ name: e.name, role: e.purpose, where: e.place.label, hours: e.hours || null })), note: 'Sample directory with fictional people. Offices follow VESIT’s public description; names are not real.' }
  }
}

export const TOOLS = [...PUBLIC_TOOLS, ...EXTRA_TOOLS].map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters, annotations: { readOnlyHint: true, openWorldHint: false } }))

function rpc(msg, now) {
  const { id, method, params = {} } = msg || {}
  const ok = (result) => ({ jsonrpc: '2.0', id, result })
  const err = (code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return err(-32600, 'Invalid Request')
  if (id === undefined) return null // notification
  switch (method) {
    case 'initialize': {
      const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : LATEST
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: 'Campus360 answers questions about VES Institute of Technology (Chembur, Mumbai): campus facts with sources (campus_info), train journeys from any Central/Harbour/Trans-Harbour/Uran station to campus (plan_journey), rooms and walking routes in the main building, the next local trains from Kurla and Chembur (official Central Railway timetable, scheduled times), BEST buses near campus (estimates), campus events and contacts (sample data). Room numbers are placeholders until confirmed by the college.' })
    }
    case 'ping': return ok({})
    case 'tools/list': return ok({ tools: TOOLS })
    case 'tools/call': {
      const name = params.name, args = params.arguments || {}
      if (!TOOLS.some((t) => t.name === name)) return err(-32602, `Unknown tool: ${name}`)
      try {
        const result = runPublicTool(name, args, now) ?? runExtra(name, args, now)
        const isError = result?.ok === false || result?.found === false
        return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 1) }], structuredContent: result, isError })
      } catch {
        return ok({ content: [{ type: 'text', text: 'The tool failed. Try different wording.' }], isError: true })
      }
    }
    case 'resources/list': return ok({ resources: [] })
    case 'prompts/list': return ok({ prompts: [] })
    default: return err(-32601, `Method not found: ${method}`)
  }
}

export async function handle(req, now = new Date()) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return send(405, { error: 'This MCP endpoint accepts POST (Streamable HTTP, JSON responses). Add this URL as a custom connector.' })
  let body
  try { body = JSON.parse(await req.text()) } catch { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) }
  if (Array.isArray(body)) {
    const out = body.map((m) => rpc(m, now)).filter(Boolean)
    return out.length ? send(200, out) : send(202, null)
  }
  const out = rpc(body, now)
  return out ? send(200, out) : send(202, null)
}

export default async (req) => handle(req)
export const config = { path: '/mcp' }
