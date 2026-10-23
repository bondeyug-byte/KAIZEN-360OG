// Local stand-in for Vercel: real api/auth.js + api/app.js (MiniMoth stubbed, Postgres = PGlite).
process.env.MINIMOTH_API_KEY = 'mm_test_k'; process.env.DATABASE_URL = 'postgres://u:p@h/db';
process.env.TEACHER_PHONES = ''; process.env.HOD_PHONES = '9100000001=CMPN;9100000002=AIDS';
const http = require('http'), fs = require('fs');
const path = require('path'); const ROOT = path.join(__dirname, '../..'); const R = ROOT + '/api/';
const realFetch = global.fetch;
global.fetch = async (url, opt) => {
  const u = String(url);
  if (!u.startsWith('https://api.minimoth.dev')) return realFetch(url, opt);
  const j = (b) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => b, text: async () => JSON.stringify(b) });
  if (u.includes('/otp/send')) return j({ otp_id: 'otp_1', expires_at: new Date(Date.now() + 600000).toISOString(), channel: 'whatsapp' });
  if (u.includes('/otp/status')) return j({ status: 'delivered' });
  return j({ access_token: 'at', refresh_token: 'rt', expires_at: new Date(Date.now() + 3600000).toISOString(), identity_id: undefined });
};
const { PGlite } = require('@electric-sql/pglite');
const db = require(R + '_db'); const pg = new PGlite();
db._setClient((t, p) => pg.query(t, p).then((r) => r.rows));
const auth = require(R + 'auth'), app = require(R + 'app'), sync = require(R + 'sync');
const VH = JSON.parse(fs.readFileSync(ROOT + '/vercel.json', 'utf8')).headers[0].headers;
const html = fs.readFileSync(process.argv[2], 'utf8');
http.createServer((req, res) => {
  for (const h of VH) res.setHeader(h.key, h.value); // same headers as vercel.json
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/api\/(auth|app)\/([a-z-]+)/);
    if (url.pathname === '/timetable-template.xlsx') { res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); return res.end(fs.readFileSync(ROOT + '/timetable-template.xlsx')); }
    if (url.pathname === '/api/sync') { const vreq = { method: req.method, url: req.url, headers: req.headers, query: {}, body: body ? JSON.parse(body) : {} }; const vres = { setHeader: (k, v) => res.setHeader(k, v), status(c) { res.statusCode = c; return this; }, json(b) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); } }; return sync(vreq, vres); }
    if (/\.(js|ico|png)$/.test(url.pathname)) { const f = ROOT + url.pathname; if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(fs.readFileSync(f)); } res.statusCode = 404; return res.end() }
    if (!m) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
    const vreq = { method: req.method, url: req.url, headers: req.headers, query: { ...Object.fromEntries(url.searchParams), route: m[2] }, body: body ? JSON.parse(body) : {} };
    const vres = { setHeader: (k, v) => res.setHeader(k, v), status(c) { res.statusCode = c; return this; }, json(b) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); }, end(b) { res.end(b); } };
    (m[1] === 'auth' ? auth : app)(vreq, vres);
  });
}).listen(Number(process.env.PORT || 4300), () => console.log('up'));
