const { neon } = require('@neondatabase/serverless');
const { getIdentity: getPhone } = require('./_session'); // identity = verified Google email
const sql = neon(process.env.DATABASE_URL);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const phone = getPhone(req);
  if (!phone) return res.status(401).json({ error: 'Sign in required' });

  if (req.method === 'GET') {
    // owner_phone is deliberately not returned
    const rows = await sql`select id, driver_name, origin, destination, depart_at, seats
                           from rides where depart_at > now() order by depart_at limit 100`;
    return res.status(200).json(rows);
  }

  if (req.method === 'POST') {
    const { driver_name, origin, destination, depart_at, seats } = req.body || {};
    const n = Number(seats || 1);
    if (!driver_name || !origin || !destination || isNaN(Date.parse(depart_at)) ||
        String(driver_name).length > 60 || String(origin).length > 100 ||
        String(destination).length > 100 || !(n >= 1 && n <= 8)) {
      return res.status(400).json({ error: 'Invalid fields' });
    }
    const rows = await sql`insert into rides (driver_name, origin, destination, depart_at, seats, owner_phone)
      values (${driver_name}, ${origin}, ${destination}, ${depart_at}, ${n}, ${phone})
      returning id, driver_name, origin, destination, depart_at, seats`;
    return res.status(201).json(rows[0]);
  }

  res.status(405).end();
};
