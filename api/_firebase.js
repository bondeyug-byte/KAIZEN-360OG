// Verifies Firebase Authentication ID tokens on the server (no service account needed).
// Follows https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
// Only Google sign-in tokens for THIS Firebase project, with a verified email, are accepted.
const crypto = require('crypto');

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const SKEW = 300; // seconds of clock skew tolerated for iat / auth_time

let cache = { certs: null, until: 0 };
let fetchCerts = async () => {
  if (cache.certs && Date.now() < cache.until) return cache.certs;
  const r = await fetch(CERT_URL);
  if (!r.ok) throw new AuthError('CERTS_UNAVAILABLE', 'Couldn’t check the sign-in with Google. Try again.');
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  cache = { certs: await r.json(), until: Date.now() + (m ? Number(m[1]) : 3600) * 1000 };
  return cache.certs;
};

class AuthError extends Error { constructor(code, message) { super(message); this.code = code; } }
const b64json = (s) => { try { return JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); } catch (e) { return null; } };

/** Returns { uid, email, name } or throws AuthError. */
async function verifyIdToken(token, projectId, nowSec = Math.floor(Date.now() / 1000)) {
  if (!projectId) throw new AuthError('CONFIG_MISSING', 'Google sign-in isn’t configured on the server.');
  if (typeof token !== 'string' || token.length > 4096) throw new AuthError('INVALID_TOKEN', 'Sign-in failed. Try again.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('INVALID_TOKEN', 'Sign-in failed. Try again.');
  const header = b64json(parts[0]), p = b64json(parts[1]);
  if (!header || !p || header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('INVALID_TOKEN', 'Sign-in failed. Try again.');
  const certs = await fetchCerts();
  const cert = certs[header.kid];
  if (!cert) throw new AuthError('INVALID_TOKEN', 'Sign-in failed. Try again.');
  const ok = crypto.createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(cert, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new AuthError('INVALID_TOKEN', 'Sign-in failed. Try again.');
  if (p.aud !== projectId || p.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError('WRONG_PROJECT', 'This sign-in belongs to a different app.');
  if (typeof p.exp !== 'number' || p.exp <= nowSec) throw new AuthError('TOKEN_EXPIRED', 'Your Google sign-in expired. Try again.');
  if (typeof p.iat !== 'number' || p.iat > nowSec + SKEW) throw new AuthError('INVALID_TOKEN', 'Sign-in failed. Try again.');
  if (typeof p.auth_time !== 'number' || p.auth_time > nowSec + SKEW) throw new AuthError('INVALID_TOKEN', 'Sign-in failed. Try again.');
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) throw new AuthError('INVALID_TOKEN', 'Sign-in failed. Try again.');
  if (!p.firebase || p.firebase.sign_in_provider !== 'google.com') throw new AuthError('NOT_GOOGLE', 'Use “Continue with Google” to sign in.');
  if (typeof p.email !== 'string' || !p.email) throw new AuthError('NO_EMAIL', 'Your Google account didn’t share an email address.');
  if (p.email_verified !== true) throw new AuthError('EMAIL_NOT_VERIFIED', 'Your Google email address isn’t verified.');
  return { uid: p.sub, email: p.email, name: typeof p.name === 'string' ? p.name.slice(0, 80) : '' };
}

module.exports = { verifyIdToken, AuthError, _setCertFetcher: (f) => { fetchCerts = f; } };
