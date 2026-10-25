// Ride sharing: pure state transitions over { rides, rideRequests }.
// Seat states shown to a student are exactly: Available → Requested → Confirmed.
import { uid } from './ids.js'
import { notify } from './notifications.js'

/**
 * Ride trust level. 'verified' = phone verified by OTP and a college email or ID on the profile; demo accounts
 * are 'demo' (allowed to try rides, clearly labelled); real accounts without the college detail are 'unverified'.
 */
// Google accounts: verified when the Google-verified sign-in email is a college (…@ves.ac.in) account.
const collegeEmail = (e) => { const x = String(e || '').trim().toLowerCase(); const i = x.lastIndexOf('@'); return i > 0 && x.indexOf('@') === i && x.slice(i + 1) === 'ves.ac.in' }
export const verificationOf = (p) => (!p ? 'unverified' : p.demo ? 'demo' : p.authMethod === 'google' ? (collegeEmail(p.email) ? 'verified' : 'unverified') : p.phoneVerified && (String(p.email || '').trim() || String(p.collegeId || '').trim()) ? 'verified' : 'unverified')
const needsVerify = (u) => ['google', 'minimoth'].includes(u?.authMethod) && verificationOf(u) !== 'verified'
const VERIFY_MSG = 'Rides are for verified students: sign in with your college Google account (…@ves.ac.in).'
export const SEAT = { AVAILABLE: 'Available', REQUESTED: 'Requested', CONFIRMED: 'Confirmed', DECLINED: 'Declined' }
const N = (state, list, now) => (state.notifications ? notify(state, list, now) : state)

const fail = (state, error) => ({ ok: false, state, error })
const validCoord = (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180

export function validateRide(input, now = new Date()) {
  const e = []
  const from = input?.from?.name?.trim(), to = input?.to?.name?.trim()
  if (!from) e.push('Pickup point is required.')
  if (!to) e.push('Destination is required.')
  if (from && to && from.toLowerCase() === to.toLowerCase()) e.push('Pickup and destination must be different.')
  const t = Date.parse(input?.departAt)
  if (!Number.isFinite(t)) e.push('Choose a valid departure date and time.')
  else if (t <= now.getTime()) e.push('Departure time must be in the future.')
  if (!Number.isInteger(input?.seats) || input.seats < 1 || input.seats > 6) e.push('Seats must be a whole number from 1 to 6.')
  if (input?.from?.lat !== undefined && !validCoord(input.from)) e.push('Pickup coordinates are invalid.')
  if (input?.to?.lat !== undefined && !validCoord(input.to)) e.push('Destination coordinates are invalid.')
  return e
}

export function seatsInfo(ride, requests) {
  const confirmed = requests.filter((r) => r.rideId === ride.id && r.status === SEAT.CONFIRMED).length
  const pending = requests.filter((r) => r.rideId === ride.id && r.status === SEAT.REQUESTED).length
  const seatsLeft = Math.max(0, ride.seats - confirmed)
  return { confirmed, pending, seatsLeft, full: seatsLeft === 0 }
}

export const departed = (ride, now = new Date()) => Date.parse(ride.departAt) <= now.getTime()

/** What one student sees for one ride. */
export function seatStatusFor(ride, requests, userId) {
  const mine = requests.find((r) => r.rideId === ride.id && r.userId === userId)
  return mine ? mine.status : SEAT.AVAILABLE
}

export function createRide(state, input, user, now = new Date()) {
  if (!user?.id) return fail(state, 'Sign in to offer a ride.')
  if (needsVerify(user)) return fail(state, VERIFY_MSG)
  const errors = validateRide(input, now)
  if (errors.length) return { ...fail(state, errors[0]), errors }
  const ride = {
    id: uid('ride'), creatorId: user.id, creatorName: user.name,
    from: { ...input.from, name: input.from.name.trim() }, to: { ...input.to, name: input.to.name.trim() },
    departAt: new Date(input.departAt).toISOString(), seats: input.seats, notes: (input.notes || '').trim(),
    createdAt: now.toISOString(), demo: false,
  }
  return { ok: true, state: { ...state, rides: [ride, ...state.rides] }, item: ride }
}

export function requestSeat(state, rideId, user, now = new Date()) {
  if (!user?.id) return fail(state, 'Sign in to request a seat.')
  if (needsVerify(user)) return fail(state, VERIFY_MSG)
  const ride = state.rides.find((r) => r.id === rideId)
  if (!ride) return fail(state, 'That ride no longer exists.')
  if (ride.creatorId === user.id) return fail(state, "You can't request a seat on your own ride.")
  if (departed(ride, now)) return fail(state, 'This ride has already left.')
  const existing = state.rideRequests.find((r) => r.rideId === rideId && r.userId === user.id)
  if (existing && existing.status !== SEAT.DECLINED) return fail(state, existing.status === SEAT.CONFIRMED ? 'Your seat is already confirmed.' : 'You have already requested a seat on this ride.')
  if (existing) return fail(state, 'The driver declined your request for this ride.')
  if (seatsInfo(ride, state.rideRequests).full) return fail(state, 'This ride is full.')
  if (ride.cancelled) return fail(state, 'This ride was cancelled.')
  const req = { id: uid('req'), rideId, userId: user.id, userName: user.name, status: SEAT.REQUESTED, requestedAt: now.toISOString() }
  const next = N({ ...state, rideRequests: [...state.rideRequests, req] }, [{ userId: ride.creatorId, key: `ride-req:${req.id}`, category: 'ride', title: 'New seat request', body: `${user.name} asked for a seat: ${ride.from.name} → ${ride.to.name}`, href: '#/rides?tab=mine' }], now)
  return { ok: true, state: next, item: req }
}

export function confirmRequest(state, requestId, actor, now = new Date()) {
  if (!actor?.id) return fail(state, 'Sign in to manage your rides.')
  const req = state.rideRequests.find((r) => r.id === requestId)
  if (!req) return fail(state, 'That request no longer exists.')
  const ride = state.rides.find((r) => r.id === req.rideId)
  if (!ride) return fail(state, 'That ride no longer exists.')
  if (ride.creatorId !== actor.id) return fail(state, 'Only the person offering this ride can confirm seats.')
  if (ride.cancelled) return fail(state, 'This ride was cancelled.')
  if (req.status === SEAT.CONFIRMED) return fail(state, 'This seat is already confirmed.')
  if (req.status !== SEAT.REQUESTED) return fail(state, `A ${req.status} request can't be confirmed.`)
  if (departed(ride, now)) return fail(state, 'This ride has already left.')
  if (seatsInfo(ride, state.rideRequests).full) return fail(state, 'No seats left — confirming would overbook the ride.')
  const updated = { ...req, status: SEAT.CONFIRMED, confirmedAt: now.toISOString() }
  const next = N({ ...state, rideRequests: state.rideRequests.map((r) => (r.id === requestId ? updated : r)) }, [{ userId: req.userId, key: `ride-ok:${req.id}`, category: 'ride', title: 'Seat confirmed', body: `${ride.creatorName} confirmed your seat: ${ride.from.name} → ${ride.to.name}`, href: '#/rides?tab=mine' }], now)
  return { ok: true, state: next, item: updated }
}

/** Driver declines a pending request; the seat stays free and the student is told. */
export function declineRequest(state, requestId, actor, now = new Date()) {
  const req = state.rideRequests.find((r) => r.id === requestId)
  if (!req) return fail(state, 'That request no longer exists.')
  const ride = state.rides.find((r) => r.id === req.rideId)
  if (!ride || ride.creatorId !== actor?.id) return fail(state, 'Only the person offering this ride can decline requests.')
  if (req.status !== SEAT.REQUESTED) return fail(state, `A ${req.status.toLowerCase()} request can't be declined.`)
  const updated = { ...req, status: SEAT.DECLINED, declinedAt: now.toISOString() }
  const next = N({ ...state, rideRequests: state.rideRequests.map((r) => (r.id === requestId ? updated : r)) }, [{ userId: req.userId, key: `ride-no:${req.id}`, category: 'ride', title: 'Seat request declined', body: `${ride.creatorName} couldn't take you on ${ride.from.name} → ${ride.to.name}.`, href: '#/rides' }], now)
  return { ok: true, state: next, item: updated }
}

/** Driver cancels the whole ride; everyone with a request or seat is notified. */
export function cancelRide(state, rideId, actor, now = new Date()) {
  const ride = state.rides.find((r) => r.id === rideId)
  if (!ride) return fail(state, 'That ride no longer exists.')
  if (ride.creatorId !== actor?.id) return fail(state, 'Only the person offering this ride can cancel it.')
  if (ride.cancelled) return fail(state, 'Already cancelled.')
  const who = state.rideRequests.filter((r) => r.rideId === rideId && [SEAT.REQUESTED, SEAT.CONFIRMED].includes(r.status)).map((r) => r.userId)
  const next = N({ ...state, rides: state.rides.map((r) => (r.id === rideId ? { ...r, cancelled: true, cancelledAt: now.toISOString() } : r)) }, who.map((u) => ({ userId: u, key: `ride-x:${rideId}`, category: 'ride', title: 'Ride cancelled', body: `${ride.creatorName} cancelled ${ride.from.name} → ${ride.to.name}.`, href: '#/rides' })), now)
  return { ok: true, state: next }
}

/** A student may withdraw a pending request (Requested → Available). */
export function withdrawRequest(state, requestId, actor) {
  const req = state.rideRequests.find((r) => r.id === requestId)
  if (!req) return fail(state, 'That request no longer exists.')
  if (req.userId !== actor?.id) return fail(state, 'You can only withdraw your own request.')
  if (req.status !== SEAT.REQUESTED) return fail(state, 'Confirmed seats can only be released by talking to the driver.')
  return { ok: true, state: { ...state, rideRequests: state.rideRequests.filter((r) => r.id !== requestId) } }
}
