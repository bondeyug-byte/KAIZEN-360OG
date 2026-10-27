// Roles from server settings. Shared by api/auth.js and api/app.js; never sent to the browser as a list.
const EMAIL_RE = /^[a-z0-9._%+-]+@ves\.ac\.in$/;
function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  const email = input.trim().toLowerCase();
  if (EMAIL_RE.test(email)) return email; // college Google accounts are identified by email
  const s = input.replace(/[\s\-().]/g, '');
  if (/^0[6-9]\d{9}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  if (/^\+91[6-9]\d{9}$/.test(s)) return s;
  return null;
}
const DIVISION_RE = /^D\d[A-Z0-9]{0,4}$/; // D1ADA, D1EC, D2A, D3, D4B ...

// ADMIN_PHONES=9876543210,9123456789
function isAdminPhone(phone) {
  const me = normalizePhone(phone);
  if (!me) return false;
  return String(process.env.ADMIN_PHONES || '').split(/[,;\s]+/).some((x) => x && normalizePhone(x) === me);
}
// TEACHER_PHONES=9876543210=Prof. Name|D1ADA:Engineering Mathematics I,D1ADB:Engineering Mathematics I;9123456789=...
function teacherFor(phone) {
  const me = normalizePhone(phone);
  if (!me) return null;
  for (const raw of String(process.env.TEACHER_PHONES || '').split(';')) {
    const i = raw.indexOf('=');
    if (i < 0 || normalizePhone(raw.slice(0, i).trim()) !== me) continue;
    const rest = raw.slice(i + 1).trim();
    const bar = rest.indexOf('|');
    const name = bar >= 0 ? rest.slice(0, bar).trim().slice(0, 80) : '';
    const teaches = (bar >= 0 ? rest.slice(bar + 1) : rest).split(',').map((x) => {
      const c = x.indexOf(':');
      return c < 0 ? null : { division: x.slice(0, c).trim().toUpperCase(), subject: x.slice(c + 1).trim().slice(0, 80) };
    }).filter((t) => t && DIVISION_RE.test(t.division) && t.subject);
    return teaches.length ? { name, teaches } : null;
  }
  return null;
}


// HOD_PHONES=9876543210=CMPN;9123456789=AIDS   (one HOD per branch; a number may head more than one branch)
function hodEntries(env = process.env) {
  const out = [];
  for (const raw of String(env.HOD_PHONES || '').split(/[;\n]/)) {
    const i = raw.indexOf('=');
    if (i < 0) continue;
    const phone = normalizePhone(raw.slice(0, i).trim());
    const branch = raw.slice(i + 1).trim().toUpperCase();
    if (phone && /^[A-Z]{2,6}$/.test(branch)) out.push({ phone, branch });
  }
  return out;
}

module.exports = { normalizePhone, isAdminPhone, teacherFor, hodEntries, DIVISION_RE };
