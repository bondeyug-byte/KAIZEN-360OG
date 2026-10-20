import { useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, CardTitle, Badge, Empty, Segmented, DemoTag, inputCls, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { floorPlaces, floorName } from '../navigator/building.js'

const CATS = [
  { value: 'all', label: 'All' }, { value: 'faculty', label: 'Faculty' }, { value: 'senior', label: 'Seniors' },
  { value: 'lab', label: 'Labs' }, { value: 'library', label: 'Library' }, { value: 'canteen', label: 'Canteen' }, { value: 'office', label: 'Offices' },
]
const CAT_ICON = { faculty: 'contact', senior: 'user', lab: 'flask', library: 'library', canteen: 'cup', office: 'office' }
const navHref = (p) => `#/navigator?f=${p.f}&id=${p.id}`

export default function Directory() {
  const { db } = useApp()
  const initialCat = new URLSearchParams(window.location.hash.split('?')[1] || '').get('c') || 'all'
  const [cat, setCat] = useState(CATS.some((c) => c.value === initialCat) ? initialCat : 'all')
  const [q, setQ] = useState('')
  const entries = db.shared.directory
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return entries.filter((e) => (cat === 'all' || e.category === cat) && (!t || `${e.name} ${e.purpose} ${e.place?.label} ${e.category}`.toLowerCase().includes(t)))
  }, [entries, cat, q])
  return (
    <div>
      <PageHeader back title="Who do I contact?" subtitle="Faculty, senior mentors, labs, the library and the canteen — with where to find them on campus." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative min-w-[240px] flex-1"><span className="sr-only">Search the directory</span>
          <Icon name="search" size={17} className="absolute left-3 top-[11px] text-muted" />
          <input className={cx(inputCls, 'pl-10')} placeholder="Try “maths”, “fees”, “Python”, “hall ticket”" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="overflow-x-auto"><Segmented label="Category" value={cat} onChange={setCat} options={CATS} /></div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        <div className="stagger grid gap-3 sm:grid-cols-2">
          {list.length ? list.map((e) => (
            <Card key={e.id} interactive className="flex flex-col !p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-maroon-50 text-maroon ring-1 ring-maroon/10"><Icon name={CAT_ICON[e.category] || 'help'} size={18} /></span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5"><Badge tone="info">{CATS.find((c) => c.value === e.category)?.label || e.category}</Badge><DemoTag show={e.demo} /></p>
                  <h3 className="mt-1 text-[15.5px] font-semibold leading-snug">{e.name}</h3>
                  <p className="text-[13.5px] text-muted">{e.purpose}</p>
                </div>
              </div>
              <dl className="mt-3 flex flex-col gap-1.5 text-[13px] text-[#3B4048]">
                {e.place && <div className="flex items-center gap-2"><Icon name="pin" size={15} className="text-muted" /><dd>{e.place.label}</dd></div>}
                {e.hours && <div className="flex items-center gap-2"><Icon name="clock" size={15} className="text-muted" /><dd>{e.hours}</dd></div>}
                {e.email && <div className="flex items-center gap-2"><Icon name="mail" size={15} className="text-muted" /><dd><a className="font-semibold text-maroon underline-offset-2 hover:underline" href={`mailto:${e.email}`}>{e.email}</a></dd></div>}
                {e.phone && <div className="flex items-center gap-2"><Icon name="phone" size={15} className="text-muted" /><dd>{e.phone}</dd></div>}
              </dl>
              <div className="mt-auto flex flex-wrap gap-2 pt-3">
                {e.place && <a href={navHref(e.place)} className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-maroon px-3 text-[13px] font-semibold text-white hover:bg-maroon-dark"><Icon name="cube" size={16} />Show in 3D & route</a>}
              </div>
            </Card>
          )) : <div className="sm:col-span-2"><Empty icon="search" title="No one matches that">Try another word or pick “All”.</Empty></div>}
        </div>
        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:h-fit">
          <CampusGuide />
        </div>
      </div>
    </div>
  )
}

function CampusGuide() {
  const floors = [0, 1, 2, 3, 4, 5].map((f) => {
    const ps = floorPlaces(f)
    const key = ps.filter((p) => ['office', 'library', 'canteen', 'amphi', 'lobby'].includes(p.type)).map((p) => p.short)
    const labs = ps.filter((p) => p.type === 'lab').length
    return { f, key, labs }
  })
  return (
    <Card>
      <CardTitle eyebrow="Campus guide">What's on each floor</CardTitle>
      <ol className="flex flex-col divide-y divide-line">
        {floors.map(({ f, key, labs }) => (
          <li key={f} className="flex items-start gap-3 py-2">
            <a href={`#/navigator?floor=${f}`} className="press grid h-8 w-8 flex-none place-items-center rounded-md bg-maroon-50 font-mono text-[13px] font-bold text-maroon ring-1 ring-maroon/15 hover:bg-maroon hover:text-white" aria-label={`Open ${floorName(f)} in 3D`}>{f === 0 ? 'G' : f}</a>
            <span className="text-sm"><b>{floorName(f)}</b><br /><span className="text-muted">{key.join(' · ')}{labs ? ` · ${labs} labs` : ''} · washrooms W1–W4 · lifts at both cores</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted">Ground-floor offices, the canteen, the first-floor library and the second-floor open terrace follow VESIT's public description. Room numbers and department floors are placeholders until confirmed.</p>
    </Card>
  )
}
