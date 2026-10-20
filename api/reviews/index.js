const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

module.exports = async (req, res) => {
  try {
    // Creates the table if it doesn't exist yet
    await sql`CREATE TABLE IF NOT EXISTS canteen_reviews (
      id SERIAL PRIMARY KEY,
      name TEXT,
      rating INT NOT NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;

    if (req.method === 'GET') {
      const rows = await sql`SELECT * FROM canteen_reviews ORDER BY created_at DESC`;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(rows);
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const { name, rating, comment } = body || {};
      if (!comment || !rating) {
        return res.status(400).json({ error: 'Missing fields' });
      }
      const rows = await sql`
        INSERT INTO canteen_reviews (name, rating, comment)
        VALUES (${name || 'Anonymous'}, ${Number(rating)}, ${comment})
        RETURNING *`;
      return res.status(200).json(rows[0]);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
