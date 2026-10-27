// Identities and roles from server settings. Shared by api/auth.js and api/app.js; never sent to the browser as a list.
//
// Sign-in is Google (Firebase Authentication). The identity is the verified Google email, lower-cased.
// Students, teachers and HODs must use an @ves.ac.in account; parents may use any Google account.
// The database columns named `phone` / `parent_phone` / `teacher_phone` now hold this identity
// (migration 6). Accounts created with the earlier phone sign-in keep their +91 numbers and records.
const INSTITUTION_DOMAIN = 'ves.ac.in';

/** Lower-cased email or null. One @, no spaces, a dotted domain. */
function normalizeEmail(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s.length > 254 || !/^[^@\s]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}
/** Exactly …@ves.ac.in (not ves.ac.in.example.com, not a subdomain, not a look-alike). */
function isInstitutional(email) {
  const e = normalizeEmail(email);
  if (!e) return false;
  const at = e.lastIndexOf('@');
  return e.indexOf('@') === at && e.slice(at + 1) === INSTITUTION_DOMAIN;
}
/** For people who must not see full contact details (teachers, class reps): pa•••@gmail.com / +91 98xxxx 3210. */
function maskIdentity(v) {
  if (!v) return '';
  const s = String(v);
  if (s.includes('@')) { const [u, d] = s.split('@'); return `${u.slice(0, 2)}•••@${d}`; }
  return `${s.slice(0, 3)} ${s.slice(3, 5)}xxxx ${s.slice(-4)}`;
}

/** Legacy +91 phone format (accounts created with the earlier phone sign-in). */
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\s\-().]/g, '');
  if (/^0[6-9]\d{9}$/.test(s)) return `+91${s.slice(1)}`; // leading trunk 0
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  if (/^\+91[6-9]\d{9}$/.test(s)) return s;
  return null;
}
const DIVISION_RE = /^D\d[A-Z0-9]{0,4}$/; // D1ADA, D1EC, D2A, D3, D4B ...

// HOD_EMAILS=hod.cmpn@ves.ac.in=CMPN;hod.aids@ves.ac.in=AIDS   (one HOD per branch; an account may head several)
// Set by the college in the hosting settings. Only @ves.ac.in addresses are accepted.
function hodEntries(env = process.env) {
  const out = [];
  // HOD_PHONES is the older setting's name; only its @ves.ac.in entries are used (phone numbers can't sign in any more)
  for (const raw of `${env.HOD_EMAILS || ''};${env.HOD_PHONES || ''}`.split(/[;\n]/)) {
    const i = raw.lastIndexOf('=');
    if (i < 0) continue;
    const email = normalizeEmail(raw.slice(0, i));
    const branch = raw.slice(i + 1).trim().toUpperCase();
    if (email && isInstitutional(email) && /^[A-Z]{2,6}$/.test(branch)) out.push({ email, branch });
  }
  return out;
}

/**
 * Teachers set in the hosting settings (TEACHER_EMAILS, or @ves.ac.in entries in the older TEACHER_PHONES):
 * email=Name|D1ADA:Subject,D1ADB:Subject;…  Copied into the database once per account (an HOD's later removal stands).
 */
function teacherEntries(env = process.env) {
  const out = [];
  for (const raw of `${env.TEACHER_EMAILS || ''};${env.TEACHER_PHONES || ''}`.split(/[;\n]/)) {
    const i = raw.indexOf('=');
    if (i < 0) continue;
    const email = normalizeEmail(raw.slice(0, i));
    if (!email || !isInstitutional(email)) continue;
    const rest = raw.slice(i + 1).trim(), bar = rest.indexOf('|');
    const name = (bar >= 0 ? rest.slice(0, bar) : '').trim().slice(0, 80);
    const teaches = (bar >= 0 ? rest.slice(bar + 1) : rest).split(',').map((x) => { const c = x.indexOf(':'); return c < 0 ? null : { division: x.slice(0, c).trim().toUpperCase(), subject: x.slice(c + 1).trim().slice(0, 80) }; })
      .filter((t) => t && DIVISION_RE.test(t.division) && t.subject);
    out.push({ email, name, teaches });
  }
  return out;
}

module.exports = { teacherEntries, normalizePhone, normalizeEmail, isInstitutional, maskIdentity, INSTITUTION_DOMAIN, hodEntries, DIVISION_RE };
