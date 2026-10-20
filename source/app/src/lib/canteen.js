// Canteen menus and reviews. Menus are admin-editable; each student has at most one review per dish
// (create, update or delete their own). Averages are always computed from the stored reviews.
import { uid } from './ids.js'
import { isAdmin } from './posts.js'

const fail = (state, error) => ({ ok: false, state, error })
export const SORTS = { price_asc: 'Price: low to high', price_desc: 'Price: high to low', rating: 'Highest rated', name: 'Name A–Z' }

export function ratingOf(state, dishId) {
  const rs = (state.reviews || []).filter((r) => r.dishId === dishId)
  return { avg: rs.length ? Math.round((rs.reduce((a, r) => a + r.rating, 0) / rs.length) * 10) / 10 : null, count: rs.length }
}
/** Filter + search + sort; numeric price sort, unavailable dishes stay listed but marked. */
export function menuView(state, { canteen, category = 'all', q = '', sort = 'price_asc' }) {
  const query = q.trim().toLowerCase()
  const list = (state.dishes || []).filter((d) => d.canteen === canteen && (category === 'all' || d.category === category) && (!query || d.name.toLowerCase().includes(query) || d.category.toLowerCase().includes(query)))
    .map((d) => ({ ...d, ...ratingOf(state, d.id) }))
  const cmp = {
    price_asc: (a, b) => a.price - b.price || a.name.localeCompare(b.name),
    price_desc: (a, b) => b.price - a.price || a.name.localeCompare(b.name),
    rating: (a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.count - a.count || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
  }[sort] || ((a, b) => a.price - b.price)
  return list.sort(cmp)
}
export const categoriesOf = (state, canteen) => [...new Set((state.dishes || []).filter((d) => d.canteen === canteen).map((d) => d.category))]

const clean = (t) => String(t || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()
export function saveReview(state, dishId, user, { rating, text }, now = new Date()) {
  if (!user?.id || ['admin', 'organiser'].includes(user.role) || user.system) return fail(state, 'Sign in as a student or teacher to review.')
  const dish = (state.dishes || []).find((d) => d.id === dishId)
  if (!dish) return fail(state, 'That dish is no longer on the menu.')
  const r = Number(rating)
  if (!Number.isInteger(r) || r < 1 || r > 5) return fail(state, 'Choose 1 to 5 stars.')
  const body = clean(text)
  if (body.length > 500) return fail(state, 'Keep the review under 500 characters.')
  const mine = (state.reviews || []).find((x) => x.dishId === dishId && x.userId === user.id)
  if (mine) {
    const upd = { ...mine, rating: r, text: body, updatedAt: now.toISOString() }
    return { ok: true, state: { ...state, reviews: state.reviews.map((x) => (x.id === mine.id ? upd : x)) }, item: upd, updated: true }
  }
  const rec = { id: uid('rev'), dishId, canteen: dish.canteen, userId: user.id, userName: user.name, rating: r, text: body, at: now.toISOString(), updatedAt: now.toISOString() }
  return { ok: true, state: { ...state, reviews: [...(state.reviews || []), rec] }, item: rec }
}
export function deleteReview(state, reviewId, user) {
  const r = (state.reviews || []).find((x) => x.id === reviewId)
  if (!r) return fail(state, 'That review no longer exists.')
  if (r.userId !== user?.id && !isAdmin(user)) return fail(state, 'You can only remove your own review.')
  return { ok: true, state: { ...state, reviews: state.reviews.filter((x) => x.id !== reviewId) } }
}

/* ---------- admin menu management ---------- */
export function validateDish(d) {
  const e = {}
  if (!clean(d.name)) e.name = 'Dish name is required.'
  if (!clean(d.category)) e.category = 'Category is required.'
  const p = Number(d.price)
  if (!Number.isFinite(p) || p < 0 || p > 5000 || Math.round(p * 100) !== p * 100) e.price = 'Enter a price in rupees (0–5000).'
  if (!['VESIT', 'VESIM'].includes(d.canteen)) e.canteen = 'Choose the canteen.'
  return e
}
export function upsertDish(state, input, actor) {
  if (!isAdmin(actor)) return fail(state, 'Only an admin can change menus and prices.')
  const e = validateDish(input)
  if (Object.keys(e).length) return { ...fail(state, Object.values(e)[0]), errors: e }
  const rec = { id: input.id || uid('dish'), canteen: input.canteen, category: clean(input.category), name: clean(input.name), price: Number(input.price), available: input.available !== false, description: clean(input.description) }
  const exists = (state.dishes || []).some((d) => d.id === rec.id)
  return { ok: true, state: { ...state, dishes: exists ? state.dishes.map((d) => (d.id === rec.id ? rec : d)) : [...state.dishes, rec] }, item: rec }
}
export function removeDish(state, dishId, actor) {
  if (!isAdmin(actor)) return fail(state, 'Only an admin can change menus.')
  return { ok: true, state: { ...state, dishes: state.dishes.filter((d) => d.id !== dishId), reviews: (state.reviews || []).filter((r) => r.dishId !== dishId) } }
}
