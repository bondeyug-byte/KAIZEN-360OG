// ONE source for "my timetable", used by the Overview widget, College portal → Timetable and the assistant.
//  - Phone (cloud) accounts: the server's published timetable for the student's approved division
//    (GET /api/app/timetable — the server picks the division from the enrollment, never from the browser).
//  - Demo accounts: the built-in sample timetable.
// Refresh behaviour (not instant push): fetched when a view opens, again when the tab regains focus if older than
// 60 s, and immediately after this browser publishes or restores a timetable (refreshTimetable()).
import { useEffect, useSyncExternalStore } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { timetableForClass } from '../data/seed.js'
import { api } from './portal.js'

const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Server rows → the shape the app's timetable views use. Server day 1 = Monday … 6 = Saturday (same as JS getDay). */
export function toAppEntries(rows = []) {
  return rows.map((e, i) => ({
    id: `tt_${e.day}_${e.start_min}_${e.batch || 'all'}_${i}`,
    day: e.day, start: hm(e.start_min), end: hm(e.end_min),
    title: e.subject_name || e.subject, subject: e.subject, type: e.type || 'Lecture',
    teacher: e.teacher_name || e.teacher_code || '', room: e.room || '', batch: e.batch || '', place: null,
  }))
}

let state = { key: null, status: 'idle', entries: [], division: null, term: null, message: '', at: 0 }
let inflight = null
const subs = new Set()
const set = (s) => { state = { ...state, ...s }; subs.forEach((f) => f()) }

function load(key, force = false) {
  if (inflight && state.key === key && !force) return inflight
  if (!force && state.key === key && state.status === 'ok' && Date.now() - state.at < 60000) return Promise.resolve()
  if (state.key !== key) set({ key, status: 'loading', entries: [], division: null, term: null, message: '' })
  inflight = api('timetable')
    .then((r) => { if (state.key === key) set({ status: r.entries.length ? 'ok' : 'empty', entries: toAppEntries(r.entries), division: r.division, term: r.term || null, message: r.message || '', at: Date.now() }) })
    .catch((e) => { if (state.key === key) set({ status: 'error', message: e.message, at: Date.now() }) })
    .finally(() => { inflight = null })
  return inflight
}
/** Call after publishing or restoring a timetable, or after joining a class. */
export function refreshTimetable() { if (state.key) return load(state.key, true) }
/** Synchronous read for non-React code (the assistant). */
export const currentTimetable = () => state

/** { entries, status: 'demo'|'loading'|'ok'|'empty'|'error'|'none', division, term, message } */
export function useMyTimetable() {
  const { me, session } = useApp()
  const cloud = session.mode === 'minimoth' && session.cloud
  const key = cloud ? `${session.userId}` : null
  const snap = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => state)
  useEffect(() => {
    if (!key) return
    load(key)
    const onFocus = () => { if (document.visibilityState !== 'hidden') load(key) }
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [key])
  if (!cloud) {
    if (session.mode === 'minimoth') return { entries: [], status: 'none', message: 'Connecting to the college server…' }
    const entries = me?.classId ? timetableForClass(me.classId) : []
    return { entries, status: 'demo', division: me?.classId || null, term: 'Sample timetable', message: entries.length ? '' : 'Set your class in your profile to see your lectures.' }
  }
  if (snap.key !== key) return { entries: [], status: 'loading', message: '' }
  return snap
}
