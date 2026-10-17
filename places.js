const { neon } = require('@neondatabase/serverless');
const { requireRole } = require('./_session');
const sql = neon(process.env.DATABASE_URL);

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    const rows = await sql`select id, name, category, lat, lng, note from places order by name`;
    return res.json(rows);
  }

  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST') {
    const user = await requireRole(req, res, 'council', 'teacher');
    if (!user) return;
    const { name, category, lat, lng, note } = req.body || {};
    const la = Number(lat), lo = Number(lng);
    if (!name || String(name).length > 100 || lat == null || lng == null ||
        !(la >= -90 && la <= 90) || !(lo >= -180 && lo <= 180) ||
        (note && String(note).length > 300)) {
      return res.status(400).json({ error: 'Invalid fields' });
    }
    const rows = await sql`insert into places (name, category, lat, lng, note)
      values (${name}, ${category || 'other'}, ${la}, ${lo}, ${note || null})
      returning id, name, category, lat, lng, note`;
    return res.status(201).json(rows[0]);
  }

  if (req.method === 'DELETE') {
    const user = await requireRole(req, res, 'council', 'teacher');
    if (!user) return;
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
    await sql`delete from places where id = ${id}`;
    return res.json({ ok: true });
  }

  res.status(405).end();
};
