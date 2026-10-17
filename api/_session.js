const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// Verified phone number from the signed login cookie, or null.
function getPhone(req) {
  const key = process.env.MINIMOTH_API_KEY;
  if (!key) return null;
  const raw = readCookie(req, 'mm_phone');
  if (!raw) return null;
  const i = raw.lastIndexOf('.');
  if (i < 0) return null;
  const phone = decodeURIComponent(raw.slice(0, i));
  const expected = crypto.createHmac('sha256', key).update('phone:' + phone).digest('hex').slice(0, 32);
  const given = Buffer.from(raw.slice(i + 1));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  return phone;
}

// Signed-in user with roles from the database. Unknown numbers become students.
async function getUser(req) {
  const phone = getPhone(req);
  if (!phone) return null;
  const rows = await sql`insert into users (phone) values (${phone})
    on conflict (phone) do update set phone = excluded.phone
    returning phone, name, roles`;
  return rows[0];
}

// Use at the top of a route. Returns the user, or sends 401/403 and returns null.
async function requireRole(req, res, ...allowed) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Sign in required' }); return null; }
  if (!allowed.some((r) => user.roles.includes(r))) {
    res.status(403).json({ error: 'Not allowed for your role' });
    return null;
  }
  return user;
}

module.exports = { getPhone, getUser, requireRole };
