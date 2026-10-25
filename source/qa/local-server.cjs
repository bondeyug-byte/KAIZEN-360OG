// Local stand-in for Vercel with Google sign-in: real api/ handlers, PGlite instead of Neon, and Google's Firebase
// token certificates replaced by a local test key. /__test/idtoken mints tokens "as Google would" for the browser
// tests (this route exists only in this test server).
process.env.SESSION_SECRET = 'e2e-session-secret-0123456789-abcdefghij'; process.env.DATABASE_URL = 'postgres://u:p@h/db';
process.env.HOD_EMAILS = 'hod.cmpn@ves.ac.in=CMPN;hod.aids@ves.ac.in=AIDS';
Object.assign(process.env, { FIREBASE_PROJECT_ID: 'campus360-e2e', FIREBASE_WEB_API_KEY: 'e2e-web-key', FIREBASE_AUTH_DOMAIN: 'campus360-e2e.firebaseapp.com', FIREBASE_APP_ID: '1:1:web:e2e' });
const http = require('http'), fs = require('fs'), crypto = require('crypto');
const ROOT = process.env.ROOT || require('path').join(__dirname, '../..'), R = ROOT + '/api/';
const { PGlite } = require('@electric-sql/pglite');
const db = require(R + '_db'); const pg = new PGlite();
db._setClient((t, p) => pg.query(t, p).then((r) => r.rows));
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
require(R + '_firebase')._setCertFetcher(async () => ({ e2e: publicKey.export({ type: 'spki', format: 'pem' }) }));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken({ email, verified = true, provider = 'google.com', name = '' }) {
  const t = Math.floor(Date.now() / 1000), pid = process.env.FIREBASE_PROJECT_ID;
  const h = b64({ alg: 'RS256', kid: 'e2e', typ: 'JWT' }), p = b64({ iss: `https://securetoken.google.com/${pid}`, aud: pid, sub: 'g-' + crypto.createHash('sha1').update(String(email)).digest('hex').slice(0, 20), iat: t, exp: t + 3600, auth_time: t, ...(email ? { email } : {}), email_verified: verified, name, firebase: { sign_in_provider: provider } });
  return `${h}.${p}.${crypto.createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey).toString('base64url')}`;
}
if (process.env.E2E_UNSET === '1') delete process.env.FIREBASE_PROJECT_ID // diagnostic test: broken config
const auth = require(R + 'auth'), app = require(R + 'app'), sync = require(R + 'sync');
const VH = JSON.parse(fs.readFileSync(ROOT + '/vercel.json', 'utf8')).headers[0].headers;
const html = fs.readFileSync(process.argv[2], 'utf8');
http.createServer((req, res) => {
  for (const h of VH) res.setHeader(h.key, h.value);
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    const vres = { setHeader: (k, v) => res.setHeader(k, v), status(c) { res.statusCode = c; return this; }, json(b) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(b)); }, end(b) { res.end(b); } };
    const parsed = body ? JSON.parse(body) : {};
    if (url.pathname === '/__test/idtoken') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ idToken: idToken(parsed) })); }
    if (url.pathname === '/api/sync') return sync({ method: req.method, url: req.url, headers: req.headers, query: {}, body: parsed }, vres);
    const m = url.pathname.match(/^\/api\/(auth|app)\/([a-z-]+)/);
    if (/\.(js|ico|png)$/.test(url.pathname)) { const f = ROOT + url.pathname; if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(fs.readFileSync(f)); } res.statusCode = 404; return res.end(); }
    if (!m) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
    const vreq = { method: req.method, url: req.url, headers: req.headers, query: { ...Object.fromEntries(url.searchParams), route: m[2] }, body: parsed };
    (m[1] === 'auth' ? auth : app)(vreq, vres);
  });
}).listen(Number(process.env.PORT || 4340), () => console.log('up'));
