const MODEL = 'gemini-2.5-flash';
const LANGS = {
  en: 'English',
  hl: 'Hinglish (Hindi written in Roman letters mixed with English)',
  hi: 'Hindi (Devanagari)',
  mr: 'Marathi (Devanagari)',
};

function toContents(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: String(m.text || '') }] });
    } else if (m.role === 'assistant') {
      if (m.raw && m.provider === 'gemini') {
        out.push(m.raw);
      } else {
        const parts = [];
        if (m.text) parts.push({ text: m.text });
        for (const c of m.calls || []) parts.push({ functionCall: { name: c.name, args: c.args || {} } });
        if (parts.length) out.push({ role: 'model', parts });
      }
    } else if (m.role === 'tool') {
      const part = {
        functionResponse: { name: m.name, response: { result: m.result === undefined ? {} : m.result } },
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && last.parts[0] && last.parts[0].functionResponse) {
        last.parts.push(part);
      } else {
        out.push({ role: 'user', parts: [part] });
      }
    }
  }
  return out;
}

async function underLimit(key, max, sec) {
  try { const db = require('../_db'); await db.ensureSchema(); return await db.allow(key, max, sec); }
  catch (e) { return true; } // the database being down must not take the offline-capable assistant with it
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ code: 'method' });
  // Gemini costs money: only signed-in users may use it (others get the built-in offline assistant).
  const phone = require('../_session').getPhone(req);
  if (!phone) return res.status(401).json({ code: 'NO_SESSION' });
  // Per-number cap so one account can't run up the AI bill (a chat turn can use up to 5 calls).
  if (!(await underLimit('ai:' + phone, 150, 3600))) return res.status(429).json({ code: 'rate_limited' });

  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return res.status(503).json({ code: 'no_key' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-30) : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const ctx = body.context || {};
  const lang = LANGS[body.lang] || LANGS.en;
  if (!messages.length) return res.status(400).json({ code: 'no_messages' });

  const system =
    'You are Campus Assistant for VES Institute of Technology (VESIT), Chembur, inside the Campus360 app. ' +
    'Reply in ' + lang + '. Keep answers short (1 to 3 sentences) and friendly. ' +
    'Always use the provided tools to get real data (timetable, deadlines, trains, buses, rooms). Never invent data. ' +
    'For actions that change something, call the tool, then tell the student in one sentence what you will do and ask them to confirm. Never say it is done before they confirm. ' +
    'Current time (India): ' + (ctx.nowText || '') + '. ' +
    'Page the student is on: ' + (ctx.page || 'unknown') + '. ' +
    'Student: ' + (ctx.student || 'not signed in') + '.';

  const decls = tools.map((t) => {
    const d = { name: t.name, description: t.description || '' };
    const p = t.parameters;
    if (p && p.properties && Object.keys(p.properties).length) {
      d.parameters = { type: 'object', properties: p.properties };
      if (p.required && p.required.length) d.parameters.required = p.required;
    }
    return d;
  });

  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toContents(messages),
  };
  if (decls.length) payload.tools = [{ functionDeclarations: decls }];

  try {
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(payload),
      }
    );
    if (!r.ok) return res.status(502).json({ code: 'gemini_' + r.status });

    const data = await r.json();
    const content = data.candidates && data.candidates[0] && data.candidates[0].content;
    const parts = (content && content.parts) || [];
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    const calls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({ id: 'call_' + Date.now() + '_' + i, name: p.functionCall.name, args: p.functionCall.args || {} }));

    return res.json({ text, calls, provider: 'gemini', label: 'Gemini', raw: content || null });
  } catch (e) {
    return res.status(502).json({ code: 'error' });
  }
};
