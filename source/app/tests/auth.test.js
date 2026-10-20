import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handle, normalizePhone } from '../netlify/functions/auth.mjs'

const env = { MINIMOTH_API_KEY: 'mm_test_secret123' }
const req = (path, body, cookie) => new Request('https://app.example/api/auth/' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
})
const mmReply = (status, data) => Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }))

let calls
beforeEach(() => { calls = []; vi.restoreAllMocks() })
const mock = (...replies) => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null })
    return replies.shift()()
  })
}

describe('MiniMoth auth proxy', () => {
  it('normalises Indian mobile numbers', () => {
    expect(normalizePhone('98765 43210')).toBe('+919876543210')
    expect(normalizePhone('+919876543210')).toBe('+919876543210')
    expect(normalizePhone('12345')).toBe(null)
    expect(normalizePhone('5876543210')).toBe(null)
  })
  it('sends the OTP with the documented path, body and X-Api-Key header', async () => {
    mock(() => mmReply(200, { otp_id: 'otp_1', expires_at: 't' }))
    const res = await handle(req('send', { phone: '9876543210' }), env)
    expect(res.status).toBe(200)
    expect(calls[0].url).toBe('https://api.minimoth.dev/v1/otp/send')
    expect(calls[0].headers['X-Api-Key']).toBe('mm_test_secret123')
    expect(calls[0].body).toEqual({ phone: '+919876543210' })
    const text = await res.text()
    expect(text).not.toContain('mm_test_secret123')
  })
  it('Teacher tab: refuses unregistered numbers before any code is sent', async () => {
    mock(() => mmReply(200, { otp_id: 'otp_1', expires_at: 't' }))
    const tEnv = { ...env, TEACHER_PHONES: '9000000001=T|D1ADA:Engineering Mathematics I' }
    const no = await handle(req('send', { phone: '9876543210', portal: 'teacher' }), tEnv)
    expect(no.status).toBe(403)
    expect((await no.json()).code).toBe('NOT_TEACHER')
    expect((await handle(req('send', { phone: '9876543210', portal: 'teacher' }), env)).status).toBe(403)
    expect(calls).toHaveLength(0)
    const yes = await handle(req('send', { phone: '9000000001', portal: 'teacher' }), tEnv)
    expect(yes.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ phone: '+919000000001' })
  })
  it('verifies, keeps the refresh token out of the JSON and puts it in an HttpOnly Secure cookie', async () => {
    mock(() => mmReply(200, { access_token: 'AT1', refresh_token: 'RT1', expires_at: 'x', identity_id: 'idn_1' }))
    const res = await handle(req('verify', { phone: '+919876543210', code: '123456' }), env)
    expect(calls[0].url).toBe('https://api.minimoth.dev/v1/otp/verify')
    expect(calls[0].body).toEqual({ phone: '+919876543210', code: '123456' })
    const body = await res.json()
    expect(body.access_token).toBe('AT1')
    expect(JSON.stringify(body)).not.toContain('RT1')
    const set = res.headers.getSetCookie().join('\n')
    expect(set).toMatch(/c360_rt=RT1;.*HttpOnly; Secure; SameSite=Lax/)
  })
  it('passes invalid-OTP errors through with their code', async () => {
    mock(() => mmReply(400, { error: 'OTP is incorrect', code: 'INVALID_OTP', request_id: 'r' }))
    const res = await handle(req('verify', { phone: '9876543210', code: '000000' }), env)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_OTP')
  })
  it('rejects malformed codes before calling MiniMoth', async () => {
    mock()
    const res = await handle(req('verify', { phone: '9876543210', code: '12' }), env)
    expect(res.status).toBe(422)
    expect(calls).toHaveLength(0)
  })
  it('refresh replaces both tokens (new cookie) and validates the new access token', async () => {
    mock(() => mmReply(200, { access_token: 'AT2', refresh_token: 'RT2', expires_at: 'y' }), () => mmReply(200, { valid: true, expires_at: 'y', identity_id: 'idn_1' }))
    const res = await handle(req('session', {}, 'c360_rt=RT1; c360_ph=%2B919876543210'), env)
    expect(calls[0].url).toBe('https://api.minimoth.dev/v1/session/refresh')
    expect(calls[0].body).toEqual({ refresh_token: 'RT1' })
    expect(calls[1].url).toBe('https://api.minimoth.dev/v1/session/validate')
    expect(calls[1].body).toEqual({ access_token: 'AT2' })
    const body = await res.json()
    expect(body).toMatchObject({ access_token: 'AT2', identity_id: 'idn_1', phone: '+919876543210' })
    expect(res.headers.getSetCookie().join('\n')).toMatch(/c360_rt=RT2/)
  })
  it('clears cookies when the refresh token is expired or reused', async () => {
    mock(() => mmReply(401, { error: 'expired', code: 'SESSION_EXPIRED' }))
    const res = await handle(req('session', {}, 'c360_rt=OLD'), env)
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie().join('\n')).toMatch(/c360_rt=; .*Max-Age=0/)
  })
  it('logout revokes; on an expired access token it refreshes first, then logs out', async () => {
    mock(
      () => mmReply(401, { error: 'expired', code: 'INVALID_ACCESS_TOKEN' }),
      () => mmReply(200, { access_token: 'AT3', refresh_token: 'RT3', expires_at: 'z' }),
      () => mmReply(200, { ok: true }),
    )
    const res = await handle(req('logout', { access_token: 'AT_OLD' }, 'c360_rt=RT2'), env)
    expect(calls.map((c) => c.url.split('/v1/')[1])).toEqual(['session/logout', 'session/refresh', 'session/logout'])
    expect(calls[2].body).toEqual({ access_token: 'AT3' })
    expect((await res.json()).revoked).toBe(true)
    expect(res.headers.getSetCookie().join('\n')).toMatch(/Max-Age=0/)
  })
  it('reports missing configuration clearly without calling out', async () => {
    mock()
    const res = await handle(req('send', { phone: '9876543210' }), {})
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('CONFIG_MISSING')
    expect(calls).toHaveLength(0)
  })
  it('survives network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const res = await handle(req('send', { phone: '9876543210' }), env)
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('UPSTREAM_UNREACHABLE')
  })
})

describe('MiniMoth finishing touches', () => {
  it('health reports test vs live mode without exposing the key', async () => {
    const t = await (await handle(req('health'), { MINIMOTH_API_KEY: 'mm_test_abc' })).json()
    const l = await (await handle(req('health'), { MINIMOTH_API_KEY: 'mm_live_abc' })).json()
    const n = await (await handle(req('health'), {})).json()
    expect(t).toEqual({ configured: true, mode: 'test' }); expect(l.mode).toBe('live'); expect(n).toEqual({ configured: false, mode: null })
  })
  it('reports delivery channel via GET /v1/otp/status/:otp_id', async () => {
    mock(() => mmReply(200, { otp_id: 'otp_9', channel: 'whatsapp', status: 'delivered', delivered_at: 't' }))
    const r = await handle(req('status?otp_id=otp_9'), env)
    expect(await r.json()).toEqual({ channel: 'whatsapp', status: 'delivered', delivered_at: 't' })
    expect(calls[0]).toMatchObject({ url: 'https://api.minimoth.dev/v1/otp/status/otp_9', method: 'GET' })
    expect((await handle(req('status?otp_id=../../x'), env)).status).toBe(422)
  })
  it('blocks cross-site POSTs', async () => {
    const r = await handle(new Request('https://app.example/api/auth/send', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ phone: '9876543210' }) }), env)
    expect(r.status).toBe(403)
  })
  it('a rejected API key becomes a generic configuration error', async () => {
    mock(() => mmReply(401, { error: 'Invalid API key mm_test_secret123', code: 'INVALID_API_KEY' }))
    const r = await handle(req('send', { phone: '9876543210' }), env)
    const body = await r.text()
    expect(r.status).toBe(500); expect(body).toContain('CONFIG_INVALID'); expect(body).not.toContain('mm_test_secret123')
  })
  it('logout succeeds when MiniMoth returns an empty body, and clears both cookies', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })))
    const r = await handle(req('logout', { access_token: 'AT' }, 'c360_rt=RT'), env)
    expect(await r.json()).toEqual({ ok: true, revoked: true })
    expect(r.headers.get('set-cookie')).toMatch(/c360_rt=;.*Max-Age=0/)
  })
  it('test keys return no identity_id: the session still works with the phone as the profile key', async () => {
    mock(() => mmReply(200, { access_token: 'AT1', refresh_token: 'RT1', expires_at: 'x' }))
    const j = await (await handle(req('verify', { phone: '9876543210', code: '000000' }), env)).json()
    expect(j).toMatchObject({ access_token: 'AT1', phone: '+919876543210' })
    expect(j.identity_id).toBeUndefined()
  })
})

import { teacherFor } from '../netlify/functions/auth.mjs'
describe('TEACHER_PHONES (server-side teacher list)', () => {
  const env = { TEACHER_PHONES: '9876543210=Prof. Meera Kulkarni|D1ADA:Engineering Mathematics I, d1adb:Engineering Mathematics I; +91 91234 56789=D1CSA:Programming in C;bad;9000000000=Name|NOPE:x' }
  it('matches any phone format and returns name + classes', () => {
    expect(teacherFor('+919876543210', env)).toEqual({ name: 'Prof. Meera Kulkarni', teaches: [{ division: 'D1ADA', subject: 'Engineering Mathematics I' }, { division: 'D1ADB', subject: 'Engineering Mathematics I' }] })
    expect(teacherFor('9123456789', env)).toEqual({ name: '', teaches: [{ division: 'D1CSA', subject: 'Programming in C' }] })
  })
  it('unlisted, malformed or empty → not a teacher', () => {
    expect(teacherFor('9111111111', env)).toBeNull()
    expect(teacherFor('9000000000', env)).toBeNull() // invalid division
    expect(teacherFor('9876543210', {})).toBeNull()
    expect(teacherFor('', env)).toBeNull()
  })
})
