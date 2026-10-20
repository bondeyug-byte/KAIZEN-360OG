// Admin operations: the teacher allowlist (who may become a teacher after OTP sign-in) and authorised changes to
// a student's academic identity. Every change keeps history.
import { uid } from './ids.js'
import { isAdmin } from './posts.js'
import { allDivisions, divisionInfo, validateAcademic } from '../data/academics.js'

const fail = (state, error) => ({ ok: false, state, error })
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const normPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); const t = d.length === 12 && d.startsWith('91') ? d.slice(2) : d; return /^[6-9]\d{9}$/.test(t) ? t : null }

export function saveStaff(state, input, actor, now = new Date()) {
  if (!isAdmin(actor)) return fail(state, 'Only an admin can manage teachers.')
  const phone = normPhone(input.phone)
  if (!input.name?.trim()) return fail(state, 'Enter the teacher’s name.')
  if (!phone) return fail(state, 'Enter the teacher’s 10-digit mobile number (used for OTP sign-in).')
  if (input.email && !EMAIL.test(input.email.trim())) return fail(state, 'That email doesn’t look right.')
  const teaches = (input.teaches || []).filter((t) => t.division && t.subject?.trim()).map((t) => ({ division: t.division, subject: t.subject.trim() }))
  if (!teaches.length) return fail(state, 'Assign at least one division and subject.')
  if (teaches.some((t) => !allDivisions().includes(t.division))) return fail(state, 'One of the divisions isn’t configured.')
  const list = state.staffAllowlist || []
  if (list.some((x) => x.phone === phone && x.id !== input.id)) return fail(state, 'That phone number is already on the list.')
  const rec = { id: input.id || uid('staff'), name: input.name.trim(), phone, email: (input.email || '').trim(), role: 'teacher', teaches, active: input.active !== false, updatedAt: now.toISOString(), updatedBy: actor.id }
  const exists = list.some((x) => x.id === rec.id)
  return { ok: true, state: { ...state, staffAllowlist: exists ? list.map((x) => (x.id === rec.id ? rec : x)) : [...list, rec] }, item: rec }
}
export function removeStaff(state, id, actor) {
  if (!isAdmin(actor)) return fail(state, 'Only an admin can manage teachers.')
  return { ok: true, state: { ...state, staffAllowlist: (state.staffAllowlist || []).filter((x) => x.id !== id) } }
}

/** Admin moves a student to another division (e.g. year change). Old identity is kept in academicHistory. */
export function changeStudentAcademic(profiles, studentId, next, actor, now = new Date()) {
  if (!isAdmin(actor)) return { ok: false, error: 'Only an admin can change a student’s division or year.' }
  const p = profiles[studentId]
  if (!p) return { ok: false, error: 'Student not found.' }
  const e = validateAcademic({ ...p, ...next }, profiles, studentId)
  if (Object.keys(e).length) return { ok: false, error: Object.values(e)[0] }
  const hist = [...(p.academicHistory || []), { year: p.year, branchId: p.branchId, division: p.division, roll: p.roll, until: now.toISOString(), changedBy: actor.id }]
  return { ok: true, profile: { ...p, ...next, academicHistory: hist, academicLocked: true }, label: divisionInfo(next.division)?.label }
}
