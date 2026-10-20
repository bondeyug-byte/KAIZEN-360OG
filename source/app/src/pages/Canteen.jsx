import { useMemo, useState } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { PageHeader, Card, Button, Badge, Empty, Segmented, Dialog, Field, inputCls, relTime, cx } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { CANTEENS } from '../data/menus.js'
import { menuView, categoriesOf, saveReview, deleteReview, upsertDish, removeDish, SORTS } from '../lib/canteen.js'
import { isAdmin } from '../lib/posts.js'

export const Stars = ({ value, size = 14 }) => (
  <span className="inline-flex" aria-label={value == null ? 'No ratings' : `${value} out of 5`}>{[1, 2, 3, 4, 5].map((i) => <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill={value != null && i <= Math.round(value) ? '#E0A63A' : '#DCE3DD'} /></svg>)}</span>
)

/** VESIT and VESIM canteens — separate menus, prices and reviews. Prices are numbers, so sorting is numeric. */
export default function Canteen({ query = {} }) {
  const { db, me, signedIn } = useApp()
  const [canteen, setCanteen] = useState(query.c === 'VESIM' ? 'VESIM' : 'VESIT')
  const [cat, setCat] = useState('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('price_asc')
  const [open, setOpen] = useState(null)
  const [editing, setEditing] = useState(null)
  const cats = categoriesOf(db.shared, canteen)
  const list = useMemo(() => menuView(db.shared, { canteen, category: cat, q, sort }), [db.shared, canteen, cat, q, sort])
  const info = CANTEENS[canteen]
  const switchTo = (c) => { setCanteen(c); setCat('all') }
  return (
    <div>
      <PageHeader back title="Canteens" subtitle="Menus and prices for the VESIT and VESIM canteens, with ratings and reviews from students." actions={isAdmin(me) && <Button icon="plus" onClick={() => setEditing({ canteen, category: cats[0] || '', name: '', price: '', available: true })}>Add dish</Button>} />
      <div className="mb-3"><Segmented label="Canteen" value={canteen} onChange={switchTo} options={[{ value: 'VESIT', label: 'VESIT Canteen' }, { value: 'VESIM', label: 'VESIM Canteen' }]} /></div>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-muted"><Icon name="pin" size={14} />{info.where}{info.hours && <> · {info.hours}</>}{info.place && <a href={`#/navigator?f=${info.place.f}&id=${info.place.id}`} className="font-semibold text-maroon hover:underline">Route</a>}<span>· Source: {info.source}</span>{info.partial && <Badge tone="warn">Partial menu</Badge>}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="relative min-w-[220px] flex-1"><span className="sr-only">Search dishes</span><Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className={cx(inputCls, 'pl-9')} placeholder={`Search ${info.name}`} value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-muted">Sort<select className={cx(inputCls, '!w-auto')} value={sort} onChange={(e) => setSort(e.target.value)}>{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <div className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Category">
        {['all', ...cats].map((c) => <button key={c} aria-pressed={cat === c} onClick={() => setCat(c)} className={cx('press flex-none rounded-full border px-3 py-1.5 text-[13px] font-semibold', cat === c ? 'border-brand bg-brand text-white' : 'border-line2 bg-surface hover:bg-brand-50')}>{c === 'all' ? 'All' : c}</button>)}
      </div>
      <p className="mb-2 text-[12.5px] text-muted" aria-live="polite">{list.length} dish{list.length === 1 ? '' : 'es'}</p>
      <div className="stagger grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {list.length ? list.map((d) => (
          <Card key={d.id} interactive className={cx('flex flex-col !p-4', !d.available && 'opacity-60')}>
            <button onClick={() => setOpen(d.id)} className="flex flex-1 flex-col text-left">
              <span className="flex items-start justify-between gap-2"><b className="text-[15px] font-semibold leading-snug">{d.name}</b><b className="flex-none font-display text-[18px] font-bold text-brand">₹{d.price}</b></span>
              <small className="mt-0.5 text-[12px] text-muted">{d.category}{!d.available && ' · not available today'}</small>
              <span className="mt-2 flex items-center gap-1.5 text-[12.5px]"><Stars value={d.avg} /><span className="text-muted">{d.avg == null ? 'No reviews yet' : `${d.avg} · ${d.count} review${d.count === 1 ? '' : 's'}`}</span></span>
            </button>
            {isAdmin(me) && <div className="mt-2 flex gap-1.5 border-t border-line pt-2"><Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(d)}>Edit</Button></div>}
          </Card>
        )) : <div className="sm:col-span-2 lg:col-span-3"><Empty icon="cup" title="No dishes match">Try another category or clear the search.</Empty></div>}
      </div>
      <Dialog open={!!open} onClose={() => setOpen(null)} title={db.shared.dishes.find((d) => d.id === open)?.name || ''}>{open && <DishDetail id={open} signedIn={signedIn} />}</Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit dish' : 'Add dish'}>{editing && <DishForm d={editing} cats={cats} onDone={() => setEditing(null)} />}</Dialog>
    </div>
  )
}

function DishDetail({ id, signedIn }) {
  const { db, me, now, runShared } = useApp()
  const d = db.shared.dishes.find((x) => x.id === id)
  const reviews = (db.shared.reviews || []).filter((r) => r.dishId === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const mine = reviews.find((r) => r.userId === me?.id)
  const [rating, setRating] = useState(mine?.rating || 0)
  const [text, setText] = useState(mine?.text || '')
  const avg = reviews.length ? Math.round((reviews.reduce((a, r) => a + r.rating, 0) / reviews.length) * 10) / 10 : null
  const canReview = signedIn && me && !isAdmin(me) && me.role !== 'organiser'
  if (!d) return <Empty title="Removed">This dish is no longer on the menu.</Empty>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><span className="text-[13px] text-muted">{CANTEENS[d.canteen].name} · {d.category}</span><b className="font-display text-[22px] text-brand">₹{d.price}</b></div>
      <div className="flex items-center gap-2"><Stars value={avg} size={18} /><span className="text-[14px]">{avg == null ? 'No reviews yet' : <><b>{avg}</b> from {reviews.length} review{reviews.length === 1 ? '' : 's'}</>}</span></div>
      {canReview ? (
        <form className="flex flex-col gap-2 rounded-xl border border-line p-3" onSubmit={(e) => { e.preventDefault(); runShared((s) => saveReview(s, id, me, { rating, text }, new Date()), mine ? 'Review updated.' : 'Thanks for the review.') }}>
          <b className="text-[14px]">{mine ? 'Your review' : 'Rate this dish'}</b>
          <span className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((i) => <button type="button" role="radio" aria-checked={rating === i} aria-label={`${i} star${i > 1 ? 's' : ''}`} key={i} onClick={() => setRating(i)} className="press"><svg width="28" height="28" viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill={i <= rating ? '#E0A63A' : '#DCE3DD'} /></svg></button>)}</span>
          <label className="sr-only" htmlFor="rev-text">Review</label>
          <textarea id="rev-text" rows={2} maxLength={500} placeholder="What was it like? (optional)" className={cx(inputCls, 'py-2')} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex justify-end gap-2">{mine && <Button type="button" size="sm" variant="secondary" className="!text-bad" onClick={() => { runShared((s) => deleteReview(s, mine.id, me), 'Review removed.'); setRating(0); setText('') }}>Remove</Button>}<Button type="submit" size="sm" disabled={!rating}>{mine ? 'Update review' : 'Post review'}</Button></div>
          <small className="text-[11.5px] text-muted">One review per dish; you can edit or remove it.</small>
        </form>
      ) : !signedIn ? <a href="#/login" className="font-semibold text-maroon">Sign in to rate and review</a> : null}
      <ul className="flex flex-col gap-2">{reviews.map((r) => (
        <li key={r.id} className="rounded-xl bg-ground/70 p-3 text-[13.5px]"><div className="flex items-center justify-between gap-2"><b>{r.userName}{r.userId === me?.id && ' (you)'}</b><Stars value={r.rating} /></div>{r.text && <p className="mt-1 break-words">{r.text}</p>}<small className="text-[11.5px] text-muted">{relTime(r.updatedAt, now)}{r.updatedAt !== r.at ? ' · edited' : ''}</small>
          {isAdmin(me) && <button className="ml-2 text-[12px] font-semibold text-bad" onClick={() => runShared((s) => deleteReview(s, r.id, me), 'Review removed.')}>Remove</button>}</li>))}
        {!reviews.length && <li className="text-[13px] text-muted">Be the first to review this dish.</li>}</ul>
    </div>
  )
}

function DishForm({ d, cats, onDone }) {
  const { me, runShared } = useApp()
  const [f, setF] = useState({ ...d, price: String(d.price ?? '') })
  const [err, setErr] = useState({})
  const submit = (e) => { e.preventDefault(); const r = runShared((s) => upsertDish(s, { ...f, price: Number(f.price) }, me), 'Menu updated.'); if (r.ok) onDone(); else setErr(r.errors || { form: r.error }) }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Field label="Dish name" error={err.name}>{(id) => <input id={id} className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" error={err.category}>{(id) => <><input id={id} list="cats" className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></>}</Field>
        <Field label="Price (₹)" error={err.price}>{(id) => <input id={id} inputMode="decimal" className={inputCls} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}</Field>
      </div>
      <Field label="Description (optional)">{(id) => <input id={id} className={inputCls} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" className="h-4 w-4" checked={f.available !== false} onChange={(e) => setF({ ...f, available: e.target.checked })} />Available today</label>
      {err.form && <p role="alert" className="text-sm text-bad">{err.form}</p>}
      <div className="flex justify-between gap-2">{d.id ? <Button type="button" variant="secondary" className="!text-bad" onClick={() => { if (confirm(`Remove ${d.name} and its reviews?`)) { runShared((s) => removeDish(s, d.id, me), 'Dish removed.'); onDone() } }}>Remove dish</Button> : <span />}<span className="flex gap-2"><Button type="button" variant="secondary" onClick={onDone}>Cancel</Button><Button type="submit">Save</Button></span></div>
    </form>
  )
}
