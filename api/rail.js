const { neon } = require('@neondatabase/serverless');
const { getIdentity: getPhone } = require('./_session'); // identity = verified Google email
const sql = neon(process.env.DATABASE_URL);
const BASE = 'https://api.railradar.in/v1';

const KINDS = {
  live:    { ttl: 180,   ok: (q) => /^\d{5}$/.test(q.train || ''),         path: (q) => `/trains/${q.train}/live` },
  station: { ttl: 180,   ok: (q) => /^[A-Za-z]{2,5}$/.test(q.code || ''),  path: (q) => `/stations/${q.code.toUpperCase()}/live` },
  route:   { ttl: 86400, ok: (q) => /^\d{5}$/.test(q.train || ''),         path: (q) => `/trains/${q.train}/route` }
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).end();
  if (!getPhone(req)) return res.status(401).json({ error: 'Sign in required' });

  const kind = KINDS[req.query.kind];
  if (!kind || !kind.ok(req.query)) return res.status(400).json({ error: 'Bad request' });
  const path = kind.path(req.query);

  // Free RailRadar plan = 100 requests/month, so serve from cache when fresh.
  const fresh = await sql`select body from api_cache where key = ${path}
                          and fetched_at > now() - make_interval(secs => ${kind.ttl})`;
  if (fresh.length) return res.json(fresh[0].body);

  try {
    const r = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${process.env.RAILRADAR_API_KEY}` }
    });
    if (!r.ok) throw new Error('upstream ' + r.status);
    const body = await r.json();
    await sql`insert into api_cache (key, body) values (${path}, ${JSON.stringify(body)}::jsonb)
              on conflict (key) do update set body = excluded.body, fetched_at = now()`;
    return res.json(body);
  } catch (e) {
    const stale = await sql`select body from api_cache where key = ${path}`;
    if (stale.length) return res.json(stale[0].body);   // serve old data if RailRadar fails
    return res.status(502).json({ error: 'Rail data unavailable' });
  }
};
