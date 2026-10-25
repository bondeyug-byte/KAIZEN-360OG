// Canteen reviews shared through Neon (used by /reviews-sync.js).
// GET: newest 500 reviews. POST: signed-in users only; a review can only be changed by the person who wrote it.
const { neon } = require('@neondatabase/serverless');
const { getIdentity: getPhone } = require('../_session'); // identity = verified Google email

let sql = null, ready = null;
const db = () => (sql = sql || neon(process.env.DATABASE_URL));
const ensure = () => (ready = ready || (async () => {
  const s = db();
  await s`CREATE TABLE IF NOT EXISTS kaizen_reviews (id TEXT PRIMARY KEY, data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await s`ALTER TABLE kaizen_reviews ADD COLUMN IF NOT EXISTS owner TEXT`;
})().catch((e) => { ready = null; throw e; }));

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await ensure();
    const s = db();
    if (req.method === 'GET') {
      const rows = await s`SELECT data FROM kaizen_reviews ORDER BY created_at DESC LIMIT 500`;
      return res.status(200).json(rows.map((r) => r.data).reverse());
    }
    if (req.method === 'POST') {
      const phone = getPhone(req);
      if (!phone) return res.status(401).json({ error: 'Sign in required' });
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
      const r = body || {};
      const rating = Number(r.rating);
      if (!r.id || typeof r.id !== 'string' || r.id.length > 100 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Invalid review' });
      }
      if (JSON.stringify(r).length > 5000) return res.status(400).json({ error: 'Review too large' });
      const rows = await s`
        INSERT INTO kaizen_reviews (id, data, owner) VALUES (${r.id}, ${JSON.stringify(r)}::jsonb, ${phone})
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
        WHERE kaizen_reviews.owner = EXCLUDED.owner
        RETURNING id`;
      if (!rows.length) return res.status(403).json({ error: 'You can only change your own review' });
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('reviews error', err && err.code); // no details to the browser
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
