import { describe, it, expect } from 'vitest'
import { marksTable, computeSGPA, checkTarget, applyWhatIf, gradeFor, validateScale, validateSubject, RESULT, DEMO_GRADE_SCALE, projectSGPA } from '../src/lib/academic.js'

// Hand-made scale on a 100-mark subject so required totals equal the percentages.
const scale = [
  { grade: 'A', minPercent: 75, points: 9 },
  { grade: 'B', minPercent: 60, points: 7 },
  { grade: 'C', minPercent: 40, points: 5 },
]
const subj = (o = {}) => ({ id: 's1', name: 'Maths', credits: 4, internalMax: 30, internalScored: 22, externalMax: 70, internalMin: 0, externalMin: 0, ...o })
const row = (t, g) => t.rows.find((r) => r.grade === g)

describe('marks needed', () => {
  it('uses Required total − Internal scored (75 − 22 = 53, attainable out of 70)', () => {
    const t = marksTable(subj(), scale)
    expect(row(t, 'A').requiredTotal).toBe(75)
    expect(row(t, 'A').marksNeeded).toBe(53)
    expect(row(t, 'A').status).toBe('achievable')
  })
  it('locks a grade when marks needed exceed the remaining maximum', () => {
    const t = marksTable(subj({ internalScored: 4 }), scale) // A needs 71 > 70
    expect(row(t, 'A').marksNeeded).toBe(71)
    expect(row(t, 'A').status).toBe('locked')
    expect(row(t, 'A').achievable).toBe(false)
  })
  it('does not lock when marks needed equal the remaining maximum exactly', () => {
    const t = marksTable(subj({ internalScored: 5 }), scale) // A needs 70 of 70
    expect(row(t, 'A').marksNeeded).toBe(70)
    expect(row(t, 'A').status).toBe('exact')
    expect(row(t, 'A').achievable).toBe(true)
  })
  it('handles thresholds already met', () => {
    const s = { ...subj({ internalMax: 50, externalMax: 50, internalScored: 45 }) } // total 100, C needs 40
    const t = marksTable(s, scale)
    expect(row(t, 'C').marksNeeded).toBe(-5)
    expect(row(t, 'C').status).toBe('secured')
    expect(row(t, 'C').toScore).toBe(0)
  })
  it('applies the remaining-assessment passing minimum', () => {
    const s = subj({ internalMax: 50, externalMax: 50, internalScored: 45, externalMin: 20 })
    const t = marksTable(s, scale)
    expect(row(t, 'C').status).toBe('secured')
    expect(row(t, 'C').toScore).toBe(20) // threshold met, but must still score the minimum
  })
  it('locks every grade when the internal passing minimum is not met', () => {
    const t = marksTable(subj({ internalScored: 8, internalMin: 12 }), scale)
    expect(t.rows.every((r) => r.status === 'locked')).toBe(true)
    expect(t.canPass).toBe(false)
  })
  it('locks when the external minimum exceeds what is available', () => {
    expect(validateSubject(subj({ externalMin: 80 }))).not.toHaveLength(0) // rejected as invalid input
  })
  it('returns insufficient rows when internal marks are missing', () => {
    const t = marksTable(subj({ internalScored: null }), scale)
    expect(t.missing).toBe(true)
    expect(t.rows.every((r) => r.status === 'insufficient' && r.marksNeeded === null)).toBe(true)
  })
  it('rejects invalid subjects instead of calculating', () => {
    expect(marksTable(subj({ credits: -3 }), scale).valid).toBe(false)
    expect(marksTable(subj({ internalScored: 40 }), scale).valid).toBe(false) // above internal max 30
    expect(marksTable(subj({ externalMax: 0 }), scale).valid).toBe(false)
  })
  it('rejects inconsistent cutoffs', () => {
    expect(validateScale([{ grade: 'A', minPercent: 60, points: 9 }, { grade: 'B', minPercent: 70, points: 7 }]).length).toBeGreaterThan(0)
    expect(marksTable(subj(), [{ grade: 'A', minPercent: 60, points: 9 }, { grade: 'B', minPercent: 70, points: 7 }]).valid).toBe(false)
    expect(validateScale(DEMO_GRADE_SCALE)).toEqual([])
  })
})

describe('SGPA', () => {
  it('weights by credits (4×9 + 2×5)/6 = 7.67, not the plain average 7', () => {
    const r = computeSGPA([{ credits: 4, points: 9 }, { credits: 2, points: 5 }])
    expect(r.ok).toBe(true)
    expect(r.value).toBeCloseTo(46 / 6, 10)
    expect(r.display).toBe('7.67')
  })
  it('guards against zero credits and missing grades', () => {
    expect(computeSGPA([]).ok).toBe(false)
    expect(computeSGPA([{ credits: 0, points: 9 }]).ok).toBe(false)
    expect(computeSGPA([{ credits: 3, points: null }]).ok).toBe(false)
  })
})

describe('target SGPA feasibility', () => {
  const s1 = subj({ id: 'a', name: 'Maths', credits: 4, internalScored: 22 }) // best A(9)
  const s2 = subj({ id: 'b', name: 'Physics', credits: 2, internalScored: 4 }) // A locked (71>70) → best B(7)
  it('max SGPA uses only achievable grades: (4×9+2×7)/6 = 8.33', () => {
    const r = checkTarget([s1, s2], scale, 8.4)
    expect(r.result).toBe(RESULT.NOT_ACHIEVABLE)
    expect(r.maxDisplay).toBe('8.33')
  })
  it('is ACHIEVABLE when a valid combination meets the target and returns a least-effort plan', () => {
    const r = checkTarget([s1, s2], scale, 8)
    expect(r.result).toBe(RESULT.ACHIEVABLE)
    const sg = r.plan.reduce((a, p, i) => a + p.points * [4, 2][i], 0) / 6
    expect(sg).toBeGreaterThanOrEqual(8)
    // Least effort: A in Maths (53) + C in Physics (36) → (36+10)/6 = 7.67 < 8, so needs A + B.
    expect(r.plan.map((p) => p.grade)).toEqual(['A', 'B'])
  })
  it('reports INSUFFICIENT DATA with missing marks', () => {
    expect(checkTarget([s1, subj({ id: 'c', name: 'Chem', internalScored: null })], scale, 7).result).toBe(RESULT.INSUFFICIENT)
  })
  it('is NOT ACHIEVABLE when a subject cannot be passed', () => {
    const r = checkTarget([s1, subj({ id: 'd', name: 'BEE', internalScored: 5, internalMin: 12 })], scale, 5)
    expect(r.result).toBe(RESULT.NOT_ACHIEVABLE)
    expect(r.reason).toMatch(/BEE/)
  })
  it('rejects targets outside the scale', () => {
    expect(checkTarget([s1], scale, 11).result).toBe(RESULT.INSUFFICIENT)
  })
})

describe('what-if', () => {
  it('never mutates saved marks', () => {
    const saved = [subj({ id: 'x', internalScored: 10 })]
    const snapshot = JSON.stringify(saved)
    const hypo = applyWhatIf(saved, { x: { internalScored: 28 } })
    expect(hypo[0].internalScored).toBe(28)
    expect(JSON.stringify(saved)).toBe(snapshot)
  })
  it('projects grades and SGPA from expected scores', () => {
    const p = projectSGPA([subj({ id: 'a', credits: 4 }), subj({ id: 'b', credits: 2, internalScored: 4 })], scale, { a: 53, b: 56 })
    expect(p.ok).toBe(true)
    expect(p.grades.map((g) => g.g.grade)).toEqual(['A', 'B'])
    expect(p.display).toBe('8.33')
  })
  it('gives F when a passing minimum is missed', () => {
    expect(gradeFor(subj({ externalMin: 30 }), scale, 29).grade).toBe('F')
  })
})
