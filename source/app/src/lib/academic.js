// Academic planner calculations.
// Everything here is pure: functions never mutate their inputs.
//
// Formula used for every grade (from the problem statement):
//   Marks needed = Required total marks − Internal marks scored
// SGPA (credit-weighted):
//   SGPA = Σ(credits × grade points) / Σ(credits)

export const RESULT = {
  ACHIEVABLE: 'ACHIEVABLE',
  NOT_ACHIEVABLE: 'NOT ACHIEVABLE',
  INSUFFICIENT: 'INSUFFICIENT DATA',
}

// Fictional demo scale. NOT an official university rule — users can edit it in the planner.
export const DEMO_GRADE_SCALE = [
  { grade: 'O', minPercent: 85, points: 10 },
  { grade: 'A+', minPercent: 75, points: 9 },
  { grade: 'A', minPercent: 65, points: 8 },
  { grade: 'B+', minPercent: 55, points: 7 },
  { grade: 'B', minPercent: 50, points: 6 },
  { grade: 'C', minPercent: 45, points: 5 },
  { grade: 'D', minPercent: 40, points: 4 },
]

export const DEFAULT_ACADEMIC_SETTINGS = { decimals: 2, compareRounded: false }

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const EPS = 1e-9

export function roundTo(value, decimals = 2) {
  const f = 10 ** decimals
  return Math.round((value + Number.EPSILON) * f) / f
}

export function validateScale(scale) {
  const errors = []
  if (!Array.isArray(scale) || scale.length === 0) return ['Add at least one grade to the grading scale.']
  const names = new Set()
  scale.forEach((g, i) => {
    const label = g?.grade ? `Grade ${g.grade}` : `Row ${i + 1}`
    if (!g || typeof g.grade !== 'string' || !g.grade.trim()) errors.push(`${label}: grade name is required.`)
    else if (names.has(g.grade.trim())) errors.push(`${label}: grade names must be unique.`)
    else names.add(g.grade.trim())
    if (!isNum(g?.minPercent) || g.minPercent <= 0 || g.minPercent > 100) errors.push(`${label}: cutoff must be a number above 0 and at most 100.`)
    if (!isNum(g?.points) || g.points < 0) errors.push(`${label}: grade points must be a number of 0 or more.`)
    if (i > 0 && isNum(g?.minPercent) && isNum(scale[i - 1]?.minPercent) && g.minPercent >= scale[i - 1].minPercent)
      errors.push(`${label}: cutoffs must go strictly down the list (${scale[i - 1].minPercent}% is above it).`)
    if (i > 0 && isNum(g?.points) && isNum(scale[i - 1]?.points) && g.points >= scale[i - 1].points)
      errors.push(`${label}: grade points must go strictly down the list.`)
  })
  return errors
}

export function validateSubject(s) {
  const errors = []
  if (!s || typeof s !== 'object') return ['Subject data is missing.']
  if (!s.name || !String(s.name).trim()) errors.push('Subject name is required.')
  if (!isNum(s.credits) || s.credits <= 0 || s.credits > 20) errors.push('Credits must be a number greater than 0 (at most 20).')
  else if (Math.round(s.credits * 10) !== s.credits * 10) errors.push('Credits can have at most one decimal place.')
  if (!isNum(s.internalMax) || s.internalMax <= 0) errors.push('Internal maximum must be greater than 0.')
  if (!isNum(s.externalMax) || s.externalMax <= 0) errors.push('Remaining-assessment maximum must be greater than 0.')
  if (s.internalScored !== null && s.internalScored !== undefined) {
    if (!isNum(s.internalScored) || s.internalScored < 0) errors.push('Internal marks scored must be 0 or more.')
    else if (isNum(s.internalMax) && s.internalScored > s.internalMax) errors.push(`Internal marks scored (${s.internalScored}) can't be above the internal maximum (${s.internalMax}).`)
  }
  const iMin = s.internalMin ?? 0
  const eMin = s.externalMin ?? 0
  if (!isNum(iMin) || iMin < 0) errors.push('Internal passing minimum must be 0 or more.')
  else if (isNum(s.internalMax) && iMin > s.internalMax) errors.push('Internal passing minimum is above the internal maximum.')
  if (!isNum(eMin) || eMin < 0) errors.push('Remaining-assessment passing minimum must be 0 or more.')
  else if (isNum(s.externalMax) && eMin > s.externalMax) errors.push('Remaining-assessment passing minimum is above its maximum.')
  return errors
}

export const totalMax = (s) => s.internalMax + s.externalMax
export const requiredTotal = (grade, s) => Math.ceil((grade.minPercent / 100) * totalMax(s) - EPS)

/**
 * Marks-needed table for one subject.
 * Row status: 'secured' | 'achievable' | 'exact' | 'locked' | 'insufficient'
 */
export function marksTable(subject, scale) {
  const scaleErrors = validateScale(scale)
  const subjectErrors = validateSubject(subject)
  if (scaleErrors.length || subjectErrors.length) return { valid: false, errors: [...subjectErrors, ...scaleErrors], rows: [] }
  const internal = subject.internalScored
  const iMin = subject.internalMin ?? 0
  const eMin = subject.externalMin ?? 0
  const missing = internal === null || internal === undefined
  const rows = scale.map((g) => {
    const req = requiredTotal(g, subject)
    const base = { grade: g.grade, points: g.points, requiredTotal: req, internal: missing ? null : internal, externalMax: subject.externalMax }
    if (missing) return { ...base, marksNeeded: null, toScore: null, status: 'insufficient', achievable: false, reason: 'Enter internal marks scored to calculate this.' }
    const marksNeeded = req - internal // the required formula, shown as-is
    const toScore = Math.max(marksNeeded, eMin, 0) // what must actually be scored in the remaining assessment
    if (internal < iMin) return { ...base, marksNeeded, toScore, status: 'locked', achievable: false, reason: `Internal marks (${internal}) are below the internal passing minimum (${iMin}), so the subject can't be passed.` }
    if (marksNeeded > subject.externalMax) return { ...base, marksNeeded, toScore, status: 'locked', achievable: false, reason: `Needs ${marksNeeded} but the remaining assessment is out of ${subject.externalMax}.` }
    if (toScore > subject.externalMax) return { ...base, marksNeeded, toScore, status: 'locked', achievable: false, reason: `The passing minimum (${eMin}) can't be met.` }
    if (marksNeeded <= 0) return { ...base, marksNeeded, toScore, status: 'secured', achievable: true, reason: eMin > 0 ? `Total threshold already reached. You still need the passing minimum of ${eMin} in the remaining assessment.` : 'Total threshold already reached.' }
    if (toScore === subject.externalMax) return { ...base, marksNeeded, toScore, status: 'exact', achievable: true, reason: 'Achievable only with full marks in the remaining assessment.' }
    const note = toScore > marksNeeded ? ` The passing minimum (${eMin}) is the binding requirement.` : ''
    return { ...base, marksNeeded, toScore, status: 'achievable', achievable: true, reason: `Score ${toScore} of ${subject.externalMax}.${note}` }
  })
  return { valid: true, errors: [], rows, canPass: rows.some((r) => r.achievable), missing }
}

/** The grade actually earned for a given remaining-assessment score (null if inputs missing). */
export function gradeFor(subject, scale, externalScore) {
  if (subject.internalScored === null || subject.internalScored === undefined || !isNum(externalScore)) return null
  if (externalScore < 0 || externalScore > subject.externalMax) return null
  const iMin = subject.internalMin ?? 0
  const eMin = subject.externalMin ?? 0
  const total = subject.internalScored + externalScore
  if (subject.internalScored < iMin || externalScore < eMin) return { grade: 'F', points: 0, pass: false, total }
  const g = scale.find((x) => total >= requiredTotal(x, subject))
  return g ? { grade: g.grade, points: g.points, pass: true, total } : { grade: 'F', points: 0, pass: false, total }
}

/** Credit-weighted SGPA. entries: [{ credits, points }] */
export function computeSGPA(entries, decimals = 2) {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: false, reason: 'Add subjects to calculate SGPA.' }
  if (entries.some((e) => !isNum(e.points))) return { ok: false, reason: 'Every subject needs a grade before SGPA can be calculated.' }
  if (entries.some((e) => !isNum(e.credits) || e.credits <= 0)) return { ok: false, reason: 'Every subject needs valid credits.' }
  const totalCredits = entries.reduce((a, e) => a + e.credits, 0)
  if (totalCredits <= 0) return { ok: false, reason: 'Total credits must be greater than 0.' }
  const weighted = entries.reduce((a, e) => a + e.credits * e.points, 0)
  const value = weighted / totalCredits
  return { ok: true, value, display: roundTo(value, decimals).toFixed(decimals), totalCredits, weighted }
}

/**
 * Target-SGPA feasibility.
 * Considers only grades genuinely achievable in each subject, then finds whether at least one
 * combination reaches the target (dynamic programming over credit-weighted points), returning the
 * least-effort combination when it does.
 */
export function checkTarget(subjects, scale, target, settings = DEFAULT_ACADEMIC_SETTINGS) {
  const decimals = settings.decimals ?? 2
  const maxPoints = Array.isArray(scale) && scale.length ? Math.max(...scale.map((g) => g.points)) : 10
  if (!isNum(target) || target < 0 || target > maxPoints) return { result: RESULT.INSUFFICIENT, reason: `Enter a target SGPA between 0 and ${maxPoints}.` }
  const scaleErrors = validateScale(scale)
  if (scaleErrors.length) return { result: RESULT.INSUFFICIENT, reason: 'The grading scale has errors: ' + scaleErrors[0] }
  if (!subjects.length) return { result: RESULT.INSUFFICIENT, reason: 'Add your subjects first.' }
  const incomplete = []
  const invalid = []
  const options = []
  for (const s of subjects) {
    const t = marksTable(s, scale)
    if (!t.valid) { invalid.push(s.name || 'Unnamed subject'); continue }
    if (t.missing) { incomplete.push(s.name); continue }
    options.push({ subject: s, rows: t.rows.filter((r) => r.achievable) })
  }
  if (invalid.length) return { result: RESULT.INSUFFICIENT, reason: `Fix the data for: ${invalid.join(', ')}.` }
  if (incomplete.length) return { result: RESULT.INSUFFICIENT, reason: `Enter internal marks for: ${incomplete.join(', ')}.` }
  const unpassable = options.filter((o) => o.rows.length === 0).map((o) => o.subject.name)
  const totalCredits = subjects.reduce((a, s) => a + s.credits, 0)
  const impact = subjects
    .map((s) => ({ name: s.name, credits: s.credits, perPoint: s.credits / totalCredits }))
    .sort((a, b) => b.credits - a.credits)
  if (unpassable.length) {
    return { result: RESULT.NOT_ACHIEVABLE, exact: true, reason: `${unpassable.join(', ')} can no longer be passed under the configured rules, so no SGPA target can be met.`, maxSGPA: null, impact }
  }
  const best = computeSGPA(options.map((o) => ({ credits: o.subject.credits, points: o.rows[0].points })), decimals)
  const maxCompare = settings.compareRounded ? roundTo(best.value, decimals) : best.value
  if (maxCompare + EPS < target) {
    return {
      result: RESULT.NOT_ACHIEVABLE, exact: true, maxSGPA: best.value, maxDisplay: best.display, impact,
      reason: `The highest SGPA still possible is ${best.display}, below your target of ${target}.`,
      bestPlan: options.map((o) => ({ subject: o.subject.name, grade: o.rows[0].grade, points: o.rows[0].points, toScore: o.rows[0].toScore, externalMax: o.subject.externalMax })),
    }
  }
  // DP: integer weights (credits ×10, points ×10) → minimise total marks to score.
  const W = options.map((o) => Math.round(o.subject.credits * 10))
  const need = Math.ceil(target * W.reduce((a, b) => a + b, 0) * 10 - EPS)
  let dp = new Map([[0, { cost: 0, picks: [] }]])
  options.forEach((o, i) => {
    const next = new Map()
    for (const [sum, st] of dp) {
      for (const r of o.rows) {
        const s2 = Math.min(need, sum + W[i] * Math.round(r.points * 10))
        const c2 = st.cost + Math.max(0, r.toScore)
        const prev = next.get(s2)
        if (!prev || c2 < prev.cost) next.set(s2, { cost: c2, picks: [...st.picks, r] })
      }
    }
    dp = next
  })
  const win = dp.get(need)
  const plan = win.picks.map((r, i) => ({ subject: options[i].subject.name, grade: r.grade, points: r.points, toScore: Math.max(0, r.toScore), externalMax: options[i].subject.externalMax }))
  const planSGPA = computeSGPA(options.map((o, i) => ({ credits: o.subject.credits, points: win.picks[i].points })), decimals)
  return {
    result: RESULT.ACHIEVABLE, exact: true, maxSGPA: best.value, maxDisplay: best.display, impact, plan, planSGPA: planSGPA.display,
    reason: `Reachable. The least-effort combination below gives ${planSGPA.display}. The highest SGPA still possible is ${best.display}.`,
  }
}

/** What-if: returns a NEW subject list with hypothetical internal marks; never mutates the saved list. */
export function applyWhatIf(subjects, overrides) {
  return subjects.map((s) => {
    const o = overrides?.[s.id]
    if (!o || o.internalScored === undefined) return { ...s }
    return { ...s, internalScored: o.internalScored }
  })
}

/** Projected SGPA from expected remaining-assessment scores. */
export function projectSGPA(subjects, scale, expected, decimals = 2) {
  const grades = subjects.map((s) => ({ s, g: gradeFor(s, scale, expected?.[s.id]) }))
  if (grades.some((x) => !x.g)) return { ok: false, reason: 'Enter an expected score for every subject.', grades }
  const failed = grades.filter((x) => !x.g.pass).map((x) => x.s.name)
  const sg = computeSGPA(grades.map((x) => ({ credits: x.s.credits, points: x.g.points })), decimals)
  return { ...sg, grades, failed }
}
