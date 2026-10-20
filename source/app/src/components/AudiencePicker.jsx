import { useMemo, useState } from 'react'
import { YEARS, BRANCHES, divisionsFor, divisionInfo, DIVISIONS_PLACEHOLDER } from '../data/academics.js'
import { recipients } from '../lib/posts.js'
import Icon from './Icon.jsx'
import { cx } from './ui.jsx'

/**
 * Year → branch → division picker. Only divisions the sender is allowed to reach can be picked. Shows the final
 * audience and the exact recipient count (from saved student profiles) before anything is published.
 */
export default function AudiencePicker({ value, onChange, allowed, profiles, error }) {
  const allowedSet = useMemo(() => new Set(allowed), [allowed])
  const years = YEARS.filter((y) => BRANCHES.some((b) => divisionsFor(y.id, b.id).some((d) => allowedSet.has(d))))
  const [year, setYear] = useState(years[0]?.id || '')
  const branches = BRANCHES.filter((b) => divisionsFor(year, b.id).some((d) => allowedSet.has(d)))
  const [branch, setBranch] = useState('')
  const br = branches.some((b) => b.id === branch) ? branch : branches[0]?.id || ''
  const divs = divisionsFor(year, br).filter((d) => allowedSet.has(d))
  const sel = value?.divisions || []
  const toggle = (d) => onChange({ divisions: sel.includes(d) ? sel.filter((x) => x !== d) : [...sel, d] })
  const rec = recipients(profiles, { divisions: sel })
  const [showNames, setShowNames] = useState(false)
  const step = (n, label) => <span className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-[#33443B]"><span className="grid h-5 w-5 place-items-center rounded-full bg-brand text-[11px] text-white">{n}</span>{label}</span>
  if (!allowed.length) return <p className="rounded-xl bg-[#FDF0D8] px-3 py-2 text-[13.5px] text-warn">You aren't assigned to any division yet. Ask an admin to add your classes.</p>
  return (
    <fieldset className={cx('flex flex-col gap-3 rounded-xl border p-3', error ? 'border-bad' : 'border-line')}>
      <legend className="px-1 text-[13px] font-medium text-[#3B4048]">Send to</legend>
      <div>{step(1, 'Academic year')}
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Academic year">{years.map((y) => <button type="button" role="radio" aria-checked={year === y.id} key={y.id} onClick={() => setYear(y.id)} className={cx('press rounded-lg border px-3 py-1.5 text-[13px] font-semibold', year === y.id ? 'border-brand bg-brand text-white' : 'border-line2 bg-surface')}>{y.label}</button>)}</div>
      </div>
      <div>{step(2, 'Branch')}
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Branch">{branches.map((b) => <button type="button" role="radio" aria-checked={br === b.id} key={b.id} onClick={() => setBranch(b.id)} className={cx('press rounded-lg border px-3 py-1.5 text-[13px] font-semibold', br === b.id ? 'border-brand bg-brand text-white' : 'border-line2 bg-surface')}>{b.label}</button>)}</div>
      </div>
      <div>{step(3, 'Division (tap to add or remove)')}
        <div className="flex flex-wrap gap-1.5">{divs.map((d) => <button type="button" aria-pressed={sel.includes(d)} key={d} onClick={() => toggle(d)} className={cx('press inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 font-mono text-[13px] font-semibold', sel.includes(d) ? 'border-brand bg-lime-soft text-brand' : 'border-line2 bg-surface')}>{sel.includes(d) && <Icon name="check" size={13} stroke={2.6} />}{d}</button>)}</div>
        {DIVISIONS_PLACEHOLDER && <p className="mt-1 text-[11.5px] text-muted">Division list is a placeholder until the college's real list is added.</p>}
      </div>
      <div className={cx('rounded-lg px-3 py-2 text-[13px]', sel.length ? 'bg-brand-50' : 'bg-ground')} aria-live="polite">
        {sel.length ? <>
          <b>Final audience:</b> {sel.map((d) => divisionInfo(d)?.label || d).join(' + ')}
          <span className="mt-0.5 block">{rec.length} student{rec.length === 1 ? '' : 's'} with completed profiles will receive it. <button type="button" className="font-semibold text-brand underline-offset-2 hover:underline" onClick={() => setShowNames(!showNames)}>{showNames ? 'Hide' : 'Show'} recipients</button></span>
          {showNames && <ul className="mt-1 max-h-32 overflow-y-auto text-[12.5px] text-muted">{rec.map((p) => <li key={p.id}>{p.roll} · {p.name} · {p.division}</li>)}{!rec.length && <li>No students in these divisions yet.</li>}</ul>}
        </> : <span className="text-muted">No division selected yet.</span>}
      </div>
      {error && <span role="alert" className="text-[13px] font-medium text-bad">{error}</span>}
    </fieldset>
  )
}
