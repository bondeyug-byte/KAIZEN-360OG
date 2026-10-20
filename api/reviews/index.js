const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

module.exports = async (req, res) => {
  try {
    await sql`CREATE TABLE IF NOT EXISTS kaizen_reviews (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    if (req.method === 'GET') {
      const rows = await sql`SELECT data FROM kaizen_reviews ORDER BY created_at ASC LIMIT 2000`;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(rows.map(r => r.data));
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const r = body || {};
      const rating = Number(r.rating);
      if (!r.id || typeof r.id !== 'string' || r.id.length > 100 ||
          !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Invalid review' });
      }
      if (JSON.stringify(r).length > 5000) {
        return res.status(400).json({ error: 'Review too large' });
      }
      await sql`
        INSERT INTO kaizen_reviews (id, data)
        VALUES (${r.id}, ${JSON.stringify(r)}::jsonb)
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
