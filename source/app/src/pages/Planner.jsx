import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Button, Badge, Field, inputCls, Dialog, Empty, Segmented, cx, DemoTag, ConfirmButton, AnimatedNumber } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { useStudentAttendance } from '../lib/record.js'
import { tutorsFor, weakestSubject } from '../lib/insights.js'
import { marksTable, validateSubject, validateScale, computeSGPA, checkTarget, applyWhatIf, gradeFor, projectSGPA, RESULT, DEMO_GRADE_SCALE, requiredTotal, totalMax } from '../lib/academic.js'
import { uid } from '../lib/ids.js'

const STATUS = {
  secured: { tone: 'ok', label: 'Already reached', icon: 'check' },
  achievable: { tone: 'ok', label: 'Achievable', icon: 'check' },
  exact: { tone: 'warn', label: 'Needs full marks', icon: 'alert' },
  locked: { tone: 'bad', label: 'Locked', icon: 'lock' },
  insufficient: { tone: 'neutral', label: 'Need marks', icon: 'help' },
}
const resultTone = (r) => (r === RESULT.ACHIEVABLE ? 'ok' : r === RESULT.NOT_ACHIEVABLE ? 'bad' : 'warn')

export default function Planner({ query = {} }) {
  const { myData, updateMyData } = useApp()
  const [tab, setTab] = useState(['marks', 'sgpa', 'whatif', 'rules'].includes(query.tab) ? query.tab : 'marks')
  useEffect(() => { if (['marks', 'sgpa', 'whatif', 'rules'].includes(query.tab)) setTab(query.tab) }, [query.tab])
  const subjects = myData.subjects
  const scale = myData.gradeScale
  const settings = myData.academic
  return (
    <div>
      <PageHeader back title="Academic planner" subtitle="Marks you need for each grade, your credit-weighted SGPA, and whether your target SGPA is still reachable." />
      <div className="mb-5 overflow-x-auto"><Segmented label="Planner section" value={tab} onChange={setTab} options={[{ value: 'marks', label: 'Subjects & marks needed' }, { value: 'sgpa', label: 'SGPA & target' }, { value: 'whatif', label: 'What-if' }, { value: 'rules', label: 'Grading rules' }]} /></div>
      {validateScale(scale).length > 0 && <p role="alert" className="mb-4 rounded-xl bg-[#FBEDEA] px-4 py-3 text-sm text-bad">The grading scale has errors, so calculations are paused. Fix it under <b>Grading rules</b>.</p>}
      {tab === 'marks' && <Marks subjects={subjects} scale={scale} updateMyData={updateMyData} focus={query.subject} />}
      {tab === 'sgpa' && <Sgpa subjects={subjects} scale={scale} settings={settings} target={myData.target} updateMyData={updateMyData} />}
      {tab === 'whatif' && <WhatIf subjects={subjects} scale={scale} settings={settings} target={myData.target} />}
      {tab === 'rules' && <Rules scale={scale} settings={settings} updateMyData={updateMyData} />}
    </div>
  )
}

/* ---------------- Subjects & marks-needed table ---------------- */
const blank = { name: '', code: '', credits: '', internalMax: '40', internalScored: '', externalMax: '60', internalMin: '16', externalMin: '24' }
function SubjectForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState(initial ? Object.fromEntries(Object.entries({ ...blank, ...initial }).map(([k, v]) => [k, v ?? ''])) : blank)
  const [errors, setErrors] = useState([])
  const num = (v) => (String(v).trim() === '' ? NaN : Number(v))
  const submit = (e) => {
    e.preventDefault()
    const s = { ...(initial || {}), id: initial?.id || uid('sub'), name: f.name.trim(), code: f.code.trim(), credits: num(f.credits), internalMax: num(f.internalMax), externalMax: num(f.externalMax), internalScored: String(f.internalScored).trim() === '' ? null : num(f.internalScored), internalMin: String(f.internalMin).trim() === '' ? 0 : num(f.internalMin), externalMin: String(f.externalMin).trim() === '' ? 0 : num(f.externalMin) }
    const errs = validateSubject(s)
    setErrors(errs)
    if (!errs.length) onSave(s)
  }
  const inp = (k, label, props = {}) => (
    <Field label={label}>{(id) => <input id={id} className={inputCls} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />}</Field>
  )
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">{inp('name', 'Subject name', { required: true })}{inp('code', 'Short code', { placeholder: 'e.g. EM-I' })}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {inp('credits', 'Credits', { inputMode: 'decimal' })}
        {inp('internalMax', 'Internal max', { inputMode: 'numeric' })}
        {inp('internalScored', 'Internal scored', { inputMode: 'decimal', placeholder: 'Leave blank if unknown' })}
        {inp('externalMax', 'Remaining assessment max', { inputMode: 'numeric' })}
        {inp('internalMin', 'Internal pass minimum', { inputMode: 'numeric' })}
        {inp('externalMin', 'Remaining pass minimum', { inputMode: 'numeric' })}
      </div>
      <p className="text-xs text-muted">Passing minimums are subject-specific. Enter your university's actual rules; the defaults are demo values.</p>
      {errors.length > 0 && <ul role="alert" className="list-disc rounded-xl bg-[#FBEDEA] py-2 pl-8 pr-3 text-sm text-bad">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button><Button type="submit">Save subject</Button></div>
    </form>
  )
}

function Marks({ subjects, scale, updateMyData, focus }) {
  const [editing, setEditing] = useState(null) // null | 'new' | subject
  const match = focus ? subjects.find((s) => s.name.toLowerCase() === String(focus).toLowerCase() || (s.code && s.code.toLowerCase() === String(focus).toLowerCase())) : null
  const [sel, setSel] = useState(match?.id || subjects[0]?.id)
  const current = subjects.find((s) => s.id === sel) || subjects[0]
  const save = (s) => {
    updateMyData((u) => ({ ...u, subjects: u.subjects.some((x) => x.id === s.id) ? u.subjects.map((x) => (x.id === s.id ? s : x)) : [...u.subjects, s] }))
    setSel(s.id); setEditing(null)
  }
  const remove = (s) => updateMyData((u) => ({ ...u, subjects: u.subjects.filter((x) => x.id !== s.id) }))
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      {focus && !match && <p className="rounded-xl border border-[#EBDDB9] bg-[#FDF8EC] px-4 py-3 text-[13.5px] lg:col-span-2"><b>{focus}</b> isn’t in your planner yet. Add it with its credits and internal marks to see what you need.</p>}
      <Card>
        <CardTitle action={<Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add</Button>}>Subjects</CardTitle>
        {subjects.length ? (
          <ul className="flex flex-col gap-2">
            {subjects.map((s) => {
              const t = marksTable(s, scale)
              const best = t.valid ? t.rows.find((r) => r.achievable) : null
              return (
                <li key={s.id}>
                  <button onClick={() => setSel(s.id)} aria-pressed={current?.id === s.id} className={cx('press w-full rounded-lg border px-3 py-2.5 text-left', current?.id === s.id ? 'border-maroon/40 bg-maroon-50 ring-1 ring-maroon/20' : 'border-line hover:bg-ground')}>
                    <span className="flex items-center justify-between gap-2"><b className="text-[14px] font-semibold">{s.name}</b><span className="rounded bg-sand px-1.5 py-0.5 font-mono text-[11px] text-muted">{s.credits} cr</span></span>
                    {s.internalScored != null && <span className="mt-2 block h-1 overflow-hidden rounded-full bg-sand" title={`Internal ${s.internalScored}/${s.internalMax}`}><span className="bar-in block h-full rounded-full bg-maroon/70" style={{ width: `${Math.min(100, (s.internalScored / s.internalMax) * 100)}%` }} /></span>}
                    <span className="mt-1 flex flex-wrap gap-1">
                      {!t.valid ? <Badge tone="bad">Fix data</Badge> : t.missing ? <Badge>Internal marks missing</Badge> : best ? <Badge tone="ok">Best possible: {best.grade}</Badge> : <Badge tone="bad" icon="lock">Can't pass</Badge>}
                      <DemoTag show={!!s.demo} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : <Empty icon="book" title="No subjects yet" action={<Button size="sm" icon="plus" onClick={() => setEditing('new')}>Add a subject</Button>}>Add each subject with its credits and marks.</Empty>}
      </Card>
      {current ? <SubjectTable s={current} scale={scale} onEdit={() => setEditing(current)} onRemove={() => remove(current)} /> : <Card><Empty icon="book" title="Pick or add a subject" /></Card>}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add subject' : 'Edit subject'} wide>
        {editing && <SubjectForm initial={editing === 'new' ? null : editing} onSave={save} onCancel={() => setEditing(null)} />}
      </Dialog>
    </div>
  )
}

function SubjectTable({ s, scale, onEdit, onRemove }) {
  const { db, me } = useApp()
  const t = marksTable(s, scale)
  const A = useStudentAttendance() // same records as the Attendance page (server for phone accounts)
  const att = A.sum?.bySubject.find((x) => x.subject.toLowerCase() === s.name.toLowerCase())
  const line = A.threshold // HOD setting for phone accounts (null = none); 75 reference for the demo
  const low = line != null && att && att.pct != null && att.pct < line
  const tutor = tutorsFor(db.shared, s, me.id)[0]
  return (
    <Card>
      {att && <div className={cx('mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[13.5px]', low ? 'bg-[#FDF0D8] text-warn' : 'bg-ground')}>
        <Icon name="check" size={15} /><span className="flex-1">Attendance in {s.code || s.name}: <b>{att.pct}%</b> ({att.present}/{att.total} recorded lectures){low ? `, below ${A.thresholdIsReference ? `the ${line}% reference line` : `your branch requirement of ${line}%`}` : ''}</span>
        <a href="#/attendance" className="font-semibold text-maroon hover:underline">Details</a>
        {low && tutor && <a href={`#/peer?q=${encodeURIComponent(s.name)}`} className="font-semibold text-maroon hover:underline">Catch up with {tutor.offer.userName}</a>}
      </div>}
      <CardTitle eyebrow={`${s.code || 'Subject'} · ${s.credits} credits · out of ${s.internalMax + s.externalMax}`} action={<div className="flex gap-1"><Button size="sm" variant="secondary" icon="edit" onClick={onEdit}>Edit</Button><ConfirmButton size="sm" variant="danger" icon="trash" confirmText={`Remove ${s.code || "subject"}`} onConfirm={onRemove} aria-label={`Remove ${s.name}`} /></div>}>{s.name}</CardTitle>
      {!t.valid ? (
        <ul role="alert" className="list-disc rounded-xl bg-[#FBEDEA] py-2 pl-8 pr-3 text-sm text-bad">{t.errors.map((e) => <li key={e}>{e}</li>)}</ul>
      ) : (
        <>
          <dl className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[['Internal scored', s.internalScored ?? '—', `of ${s.internalMax}`], ['Remaining max', s.externalMax, 'still to be assessed'], ['Internal pass min', s.internalMin ?? 0, ''], ['Remaining pass min', s.externalMin ?? 0, '']].map(([k, v, sub]) => (
              <div key={k} className="rounded-lg border border-line bg-ground/50 px-3 py-2.5"><dt className="text-[12px] font-medium text-muted">{k}</dt><dd className="mt-0.5 font-display text-[22px] font-semibold tabular-nums">{typeof v === 'number' ? <AnimatedNumber value={v} /> : v} <span className="font-sans text-xs font-normal text-muted">{sub}</span></dd></div>
            ))}
          </dl>
          {t.missing && <p className="mb-3 rounded-xl bg-sand px-3 py-2 text-sm">Enter the internal marks you've scored to see what you need. <button className="font-semibold text-maroon underline" onClick={onEdit}>Add marks</button></p>}
          {!t.missing && !t.canPass && <p role="alert" className="mb-3 rounded-xl bg-[#FBEDEA] px-3 py-2 text-sm text-bad"><b>This subject can't be passed</b> under the configured rules. {t.rows[0].reason}</p>}
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <caption className="sr-only">Marks needed for each grade in {s.name}</caption>
              <thead className="bg-ground text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
                <tr><th className="px-3 py-2.5">Grade</th><th className="px-3 py-2.5">Required total</th><th className="px-3 py-2.5">Internal</th><th className="px-3 py-2.5">Marks needed</th><th className="px-3 py-2.5">To score in remaining</th><th className="px-3 py-2.5">Status</th></tr>
              </thead>
              <tbody>
                {t.rows.map((r) => {
                  const st = STATUS[r.status]
                  return (
                    <tr key={r.grade} className={cx('border-t border-line transition-colors hover:bg-ground/60', r.status === 'locked' && 'bg-[repeating-linear-gradient(135deg,#FCF6F5,#FCF6F5_8px,#FFFFFF_8px,#FFFFFF_16px)] text-muted')}>
                      <td className="px-3 py-2.5"><span className="inline-flex items-center gap-2"><span className={cx('grid h-8 min-w-[32px] place-items-center rounded-md px-1 font-display text-[15px] font-semibold', r.status === 'locked' ? 'bg-[#F6E3E0] text-bad' : r.achievable ? 'bg-[#E7F4EC] text-ok' : 'bg-sand text-ink')}>{r.status === 'locked' ? <Icon name="lock" size={14} /> : r.grade}</span><span className="leading-tight">{r.status === 'locked' && <b className="block text-ink">{r.grade}</b>}<span className="whitespace-nowrap text-xs text-muted">{r.points} pts</span></span></span></td>
                      <td className="px-3 py-2.5 font-mono">{r.requiredTotal}</td>
                      <td className="px-3 py-2.5 font-mono">{r.internal ?? '—'}</td>
                      <td className="px-3 py-2.5 font-mono"><b>{r.marksNeeded ?? '—'}</b>{r.marksNeeded !== null && <span className="block text-[11px] font-sans text-muted">{r.requiredTotal} − {r.internal}</span>}</td>
                      <td className="px-3 py-2.5">{r.toScore == null ? '—' : <span className="flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-sand"><span className={cx('bar-in block h-full rounded-full', r.status === 'locked' ? 'bg-bad/60' : r.status === 'exact' ? 'bg-[#D99A2B]' : 'bg-ok')} style={{ width: `${Math.min(100, Math.max(0, r.toScore) / r.externalMax * 100)}%` }} /></span><span className="font-mono text-[12.5px]">{Math.max(0, r.toScore)}/{r.externalMax}</span></span>}</td>
                      <td className="px-3 py-2.5"><Badge tone={st.tone} icon={st.icon}>{st.label}</Badge><span className="mt-1 block max-w-[240px] text-[11.5px] leading-snug text-muted">{r.reason}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Marks needed = Required total − Internal scored. Required total = cutoff % × {totalMax(s)} (rounded up). A grade is only shown as achievable if the subject's passing minimums can also be met.</p>
        </>
      )}
    </Card>
  )
}

/* ---------------- SGPA & target ---------------- */
function Sgpa({ subjects, scale, settings, target, updateMyData }) {
  const tables = subjects.map((s) => ({ s, t: marksTable(s, scale) }))
  const [picked, setPicked] = useState({})
  const [input, setInput] = useState(target ?? '')
  const projected = tables.map(({ s, t }) => {
    const options = t.valid ? t.rows.filter((r) => r.achievable) : []
    const choice = options.find((r) => r.grade === picked[s.id]) || options[0] || null
    return { s, t, options, choice }
  })
  const sg = computeSGPA(projected.map((p) => ({ credits: p.s.credits, points: p.choice ? p.choice.points : null })), settings.decimals)
  const tNum = input === '' ? NaN : Number(input)
  const res = useMemo(() => (input === '' ? null : checkTarget(subjects, scale, tNum, settings)), [subjects, scale, tNum, settings, input])
  if (!subjects.length) return <Card><Empty icon="book" title="Add subjects first">SGPA needs your subjects and credits.</Empty></Card>
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardTitle eyebrow="Credit-weighted">Projected SGPA</CardTitle>
        <p className="mb-3 text-sm text-muted">Choose a target grade for each subject. Only grades still achievable are offered.</p>
        <ul className="flex flex-col gap-2">
          {projected.map(({ s, t, options, choice }) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2 transition-colors hover:bg-ground/60">
              <span className="min-w-0 flex-1"><b className="block text-[15px]">{s.name}</b><small className="text-muted">{s.credits} credits</small></span>
              {!t.valid ? <Badge tone="bad">Fix data</Badge> : t.missing ? <Badge>Needs internal marks</Badge> : !options.length ? <Badge tone="bad" icon="lock">Can't pass</Badge> : (
                <label className="flex items-center gap-2 text-sm"><span className="sr-only">Grade for {s.name}</span>
                  <select className={cx(inputCls, 'w-auto min-w-[210px]')} value={choice.grade} onChange={(e) => setPicked({ ...picked, [s.id]: e.target.value })}>
                    {options.map((o) => <option key={o.grade} value={o.grade}>{o.grade} ({o.points} pts) · score {o.toScore}/{s.externalMax}</option>)}
                  </select>
                </label>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-lg border border-line bg-ground/60 p-4">
          {sg.ok ? (
            <>
              <div className="flex items-end justify-between gap-3"><p className="font-display text-[40px] font-semibold leading-none tabular-nums"><AnimatedNumber value={Number(sg.display)} decimals={settings.decimals} /></p><span className="text-[12px] font-medium text-muted">out of 10</span></div>
              <span className="mt-3 block h-2 overflow-hidden rounded-full bg-sand"><span className="bar-grow block h-full rounded-full bg-maroon" style={{ width: `${Math.min(100, Number(sg.display) * 10)}%` }} /></span>
              <p className="mt-1 font-mono text-xs text-muted">Σ(credits × points) / Σ credits = {projected.map((p) => `${p.s.credits}×${p.choice.points}`).join(' + ')} / {sg.totalCredits} = {sg.weighted}/{sg.totalCredits}</p>
            </>
          ) : <p className="text-sm text-muted">{sg.reason}</p>}
        </div>
      </Card>

      <Card>
        <CardTitle eyebrow="Feasibility">Can I still reach my target?</CardTitle>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (Number.isFinite(tNum)) updateMyData((u) => ({ ...u, target: tNum })) }}>
          <div className="flex-1"><Field label="Target SGPA">{(id) => <input id={id} className={inputCls} inputMode="decimal" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. 8.5" />}</Field></div>
          <Button type="submit" variant="secondary">Save target</Button>
        </form>
        {res && (
          <div key={res.result + input} className={cx('pop mt-4 rounded-lg border border-l-4 p-4', res.result === RESULT.ACHIEVABLE ? 'border-[#C9E6D4] border-l-ok bg-[#F5FBF7]' : res.result === RESULT.NOT_ACHIEVABLE ? 'border-[#F6C9C3] border-l-bad bg-[#FEF7F6]' : 'border-[#F2DDB5] border-l-[#D99A2B] bg-[#FFFBF2]')}>
            <Badge tone={resultTone(res.result)} icon={res.result === RESULT.ACHIEVABLE ? 'check' : res.result === RESULT.NOT_ACHIEVABLE ? 'x' : 'alert'}>{res.result}</Badge>
            <p className="mt-2 text-[15px]">{res.reason}</p>
            {res.exact && <p className="mt-1 text-xs text-muted">Exact result: every combination of grades still achievable in each subject was considered.</p>}
            {res.plan && (
              <table className="mt-3 w-full text-sm">
                <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wider text-muted">Least-effort combination</caption>
                <tbody>{res.plan.map((p) => <tr key={p.subject} className="border-t border-line"><td className="py-1.5">{p.subject}</td><td className="font-bold">{p.grade}</td><td className="text-right font-mono">{p.toScore}/{p.externalMax}</td></tr>)}</tbody>
              </table>
            )}
            {res.result === RESULT.NOT_ACHIEVABLE && <WeakestTutor subjects={subjects} />}
            {res.bestPlan && (
              <p className="mt-2 text-sm">Best you can get: {res.bestPlan.map((p) => `${p.subject} ${p.grade}`).join(', ')}.</p>
            )}
            {res.impact && res.result !== RESULT.INSUFFICIENT && (
              <p className="mt-3 text-xs text-muted">Biggest levers: {res.impact.slice(0, 2).map((i) => `${i.name} (${i.credits} cr: one grade point moves SGPA by ${i.perPoint.toFixed(2)})`).join('; ')}.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ---------------- What-if (never writes to saved data) ---------------- */
function WhatIf({ subjects, scale, settings, target }) {
  const init = () => Object.fromEntries(subjects.map((s) => [s.id, { internalScored: s.internalScored ?? 0, expected: Math.round(s.externalMax * 0.6) }]))
  const [h, setH] = useState(init)
  const hypo = applyWhatIf(subjects, Object.fromEntries(Object.entries(h).map(([k, v]) => [k, { internalScored: v.internalScored }])))
  const proj = projectSGPA(hypo, scale, Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.expected])), settings.decimals)
  const feas = target != null ? checkTarget(hypo, scale, target, settings) : null
  if (!subjects.length) return <Card><Empty icon="book" title="Add subjects first" /></Card>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-route/50 bg-[#F2F6FD] px-4 py-3">
        <p className="text-sm"><b>What-if mode.</b> These are hypothetical marks. Your saved marks are not changed.</p>
        <Button size="sm" variant="secondary" icon="refresh" onClick={() => setH(init())}>Reset to saved marks</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-3">
          {hypo.map((s) => {
            const t = marksTable(s, scale)
            const g = gradeFor(s, scale, h[s.id].expected)
            const changed = (subjects.find((x) => x.id === s.id).internalScored ?? 0) !== h[s.id].internalScored
            return (
              <Card key={s.id} className={cx('!p-4 transition-shadow', changed && 'ring-1 ring-route/30')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <b>{s.name} <span className="font-mono text-xs text-muted">{s.credits} cr</span></b>
                  {g && <Badge tone={g.pass ? 'ok' : 'bad'}>Projected {g.grade} · {g.total}/{s.internalMax + s.externalMax}</Badge>}
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm"><span className="flex justify-between font-semibold text-muted">Internal marks {changed && <Badge tone="info">changed</Badge>}<span className="font-mono text-ink">{h[s.id].internalScored}/{s.internalMax}</span></span>
                    <input type="range" min="0" max={s.internalMax} step="1" value={h[s.id].internalScored} onChange={(e) => setH({ ...h, [s.id]: { ...h[s.id], internalScored: Number(e.target.value) } })} className="w-full accent-maroon" /></label>
                  <label className="text-sm"><span className="flex justify-between font-semibold text-muted">Expected in remaining<span className="font-mono text-ink">{h[s.id].expected}/{s.externalMax}</span></span>
                    <input type="range" min="0" max={s.externalMax} step="1" value={h[s.id].expected} onChange={(e) => setH({ ...h, [s.id]: { ...h[s.id], expected: Number(e.target.value) } })} className="w-full accent-route" /></label>
                </div>
                {t.valid && <p className="mt-2 flex flex-wrap gap-1 text-xs">{t.rows.map((r) => <Badge key={r.grade} tone={r.achievable ? 'ok' : 'bad'} icon={r.achievable ? undefined : 'lock'}>{r.grade}{r.achievable ? ` ${Math.max(0, r.toScore)}` : ''}</Badge>)}</p>}
              </Card>
            )
          })}
        </div>
        <Card className="h-fit lg:sticky lg:top-6">
          <CardTitle eyebrow="Hypothetical">Projected result</CardTitle>
          {proj.ok ? <><p className="font-display text-[44px] font-semibold leading-none tabular-nums"><AnimatedNumber value={Number(proj.display)} decimals={settings.decimals} duration={350} /></p><span className="mt-3 block h-2 overflow-hidden rounded-full bg-sand"><span className="bar-grow block h-full rounded-full bg-route" style={{ width: `${Math.min(100, Number(proj.display) * 10)}%` }} /></span></> : <p className="text-sm text-muted">{proj.reason}</p>}
          <p className="text-sm text-muted">Projected SGPA from the expected scores</p>
          {proj.failed?.length > 0 && <p className="mt-2 rounded-xl bg-[#FBEDEA] px-3 py-2 text-sm text-bad">Fails: {proj.failed.join(', ')}</p>}
          {feas ? (
            <div className="mt-4 rounded-xl bg-ground p-3"><p className="text-xs font-semibold uppercase tracking-wider text-muted">Target {target}</p><Badge tone={resultTone(feas.result)}>{feas.result}</Badge><p className="mt-1 text-sm">{feas.reason}</p></div>
          ) : <p className="mt-4 text-sm text-muted">Save a target SGPA in the SGPA tab to check it here.</p>}
        </Card>
      </div>
    </div>
  )
}

/* ---------------- Grading rules ---------------- */
function Rules({ scale, settings, updateMyData }) {
  const [rows, setRows] = useState(scale.map((g) => ({ ...g })))
  const parsed = rows.map((r) => ({ grade: String(r.grade).trim(), minPercent: r.minPercent === '' ? NaN : Number(r.minPercent), points: r.points === '' ? NaN : Number(r.points) }))
  const errors = validateScale(parsed)
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardTitle eyebrow="Configurable" action={<Badge tone="demo">Demo values · not official</Badge>}>Grade cutoffs & points</CardTitle>
        <p className="mb-3 text-sm text-muted">The problem statement gives no official scale. Replace these with your university's rules. Cutoffs are a percentage of each subject's total marks.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-muted"><tr><th className="py-2">Grade</th><th>Min % of total</th><th>Grade points</th><th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1.5 pr-2"><input aria-label={`Grade ${i + 1} name`} className={cx(inputCls, 'w-20')} value={r.grade} onChange={(e) => set(i, 'grade', e.target.value)} /></td>
                  <td className="pr-2"><input aria-label={`Grade ${i + 1} cutoff`} inputMode="decimal" className={cx(inputCls, 'w-28')} value={r.minPercent} onChange={(e) => set(i, 'minPercent', e.target.value)} /></td>
                  <td className="pr-2"><input aria-label={`Grade ${i + 1} points`} inputMode="decimal" className={cx(inputCls, 'w-24')} value={r.points} onChange={(e) => set(i, 'points', e.target.value)} /></td>
                  <td><button aria-label={`Remove grade ${r.grade}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="press grid h-10 w-10 place-items-center rounded-lg text-bad hover:bg-[#FBEDEA]"><Icon name="trash" size={18} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Below the lowest cutoff (or a missed passing minimum) the result is F with 0 points.</p>
        {errors.length > 0 && <ul role="alert" className="mt-3 list-disc rounded-xl bg-[#FBEDEA] py-2 pl-8 pr-3 text-sm text-bad">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={errors.length > 0} onClick={() => updateMyData((u) => ({ ...u, gradeScale: parsed }))}>Save scale</Button>
          <Button variant="secondary" icon="plus" onClick={() => setRows([...rows, { grade: '', minPercent: '', points: '' }])}>Add grade</Button>
          <Button variant="ghost" onClick={() => setRows(DEMO_GRADE_SCALE.map((g) => ({ ...g })))}>Restore demo scale</Button>
        </div>
      </Card>
      <Card>
        <CardTitle eyebrow="Display">Rounding</CardTitle>
        <Field label="SGPA decimal places">{(id) => (
          <select id={id} className={inputCls} value={settings.decimals} onChange={(e) => updateMyData((u) => ({ ...u, academic: { ...u.academic, decimals: Number(e.target.value) } }))}>
            {[0, 1, 2, 3].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}</Field>
        <label className="mt-4 flex min-h-[44px] items-center justify-between gap-3 text-sm">
          <span><b>Compare targets using the rounded SGPA</b><br /><span className="text-muted">Off: a target counts as reached only if the exact SGPA meets it.</span></span>
          <input type="checkbox" className="h-6 w-6 accent-maroon" checked={settings.compareRounded} onChange={(e) => updateMyData((u) => ({ ...u, academic: { ...u.academic, compareRounded: e.target.checked } }))} />
        </label>
      </Card>
    </div>
  )
}

/** Planner → peer learning: when the target can't be reached, point at a tutor for the weakest subject. */
function WeakestTutor({ subjects }) {
  const { db, me } = useApp()
  const w = weakestSubject(subjects)
  if (!w) return null
  const t = tutorsFor(db.shared, w, me.id)[0]
  return <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-[13.5px]">Weakest subject: <b>{w.name}</b> ({w.internalScored}/{w.internalMax} internal). {t ? <a href={`#/peer?q=${encodeURIComponent(w.name)}`} className="font-semibold text-maroon hover:underline">Book a session with {t.offer.userName}{t.rating.avg ? ` (${t.rating.avg}★)` : ''}</a> : <a href="#/peer" className="font-semibold text-maroon hover:underline">Find a peer tutor</a>}</p>
}
