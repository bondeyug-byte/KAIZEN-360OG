// api/sync.js: stores the app's shared teacher/student items in Neon.
// Uses the same signed login cookie and roles as api/app.js.
const { getPhone } = require('./_session');
const access = require('./_access');
const db = require('./_db');

const TEACHER_COLS = new Set(['posts', 'challenges', 'events', 'attSessions']);
const STUDENT_COLS = new Set(['submissions', 'postSubs', 'completions', 'registrations']);
const PRIVATE_COLS = ['submissions', 'postSubs']; // visible only to their owner and to staff
const MAX_ITEM = 900 * 1024;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const phone = getPhone(req);
    if (!phone) return res.status(401).json({ ok: false, code: 'NO_SESSION', error: 'Sign in required.' });
    await db.ensureSchema();
    await db.q(`create table if not exists shared_items (
      col text not null, id text not null, owner text not null,
      data jsonb not null, updated_at timestamptz not null default now(),
      primary key (col, id))`);
    const who = await access.resolve(phone);
    const staff = !!(who.admin || who.teacher);
    const me = String(who.account.id);

    if (req.method === 'GET') {
      const rows = staff
        ? await db.q('select col, id, data from shared_items order by updated_at asc limit 5000')
        : await db.q('select col, id, data from shared_items where (col <> all($1::text[]) or owner = $2) order by updated_at asc limit 5000', [PRIVATE_COLS, me]);
      return res.status(200).json({ ok: true, items: rows.map((r) => ({ c: r.col, id: r.id, data: r.data })) });
    }

    if (req.method === 'POST') {
      let b = req.body;
      if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
      const items = b && Array.isArray(b.items) ? b.items.slice(0, 50) : null;
      if (!items) return res.status(400).json({ ok: false, code: 'BAD_REQUEST', error: 'Send { items: [...] }.' });
      let saved = 0, rejected = 0;
      for (const it of items) {
        const c = it && it.c, id = it && it.id, data = it && it.data;
        const isTeacherCol = TEACHER_COLS.has(c), isStudentCol = STUDENT_COLS.has(c);
        const valid = (isTeacherCol || isStudentCol) && typeof id === 'string' && id.length > 0 && id.length <= 100 &&
          data && typeof data === 'object' && !Array.isArray(data) && data.id === id;
        const json = valid ? JSON.stringify(data) : '';
        if (!valid || json.length > MAX_ITEM || (isTeacherCol && !staff)) { rejected++; continue; }
        // Who may overwrite an existing item: its owner, the HOD, or staff for student items (reviewing submissions).
        const mayEdit = !!who.admin || (staff && isStudentCol);
        const out = await db.q(
          `insert into shared_items (col, id, owner, data) values ($1, $2, $3, $4::jsonb)
           on conflict (col, id) do update set data = excluded.data, updated_at = now()
           where shared_items.owner = $3 or $5
           returning id`, [c, id, me, json, mayEdit]);
        if (out.length) saved++; else rejected++;
      }
      return res.status(200).json({ ok: true, saved, rejected });
    }

    return res.status(405).json({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' });
  } catch (e) {
    console.error('sync error', e && e.message);
    return res.status(500).json({ ok: false, code: 'SERVER_ERROR', error: 'Something went wrong.' });
  }
};
