// ONE source for "my academic record" on phone (cloud) accounts: GET /api/app/my-record. The server picks the
// student from the signed-in session, never from the browser, and computes from the teachers' saved records.
// Used by the Attendance page and the Overview so they always show the same numbers as College portal →
// Attendance & marks. Refresh: when a view opens, when the tab regains focus (if older than 30 s), after a
// confirmed division change (the key includes the division), and on refreshMyRecord().
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useApp } from '../store/AppContext.jsx'
import { api } from './portal.js'
import { isStudent } from './posts.js'
import { summarize, studentSummary, rowsFromServer } from './attendance.js'

let state = { key: null, status: 'idle', data: null, message: '', at: 0 }
let inflight = null
const subs = new Set()
const set = (s) => { state = { ...state, ...s }; subs.forEach((f) => f()) }

function load(key, force = false) {
  if (inflight && state.key === key && !force) return inflight
  if (!force && state.key === key && state.status === 'ok' && Date.now() - state.at < 30000) return Promise.resolve()
  if (state.key !== key) set({ key, status: 'loading', data: null, message: '' })
  inflight = api('my-record')
    .then((r) => { if (state.key === key) set({ status: 'ok', data: r, message: '', at: Date.now() }) })
    .catch((e) => { if (state.key === key) set({ status: 'error', message: e.message, at: Date.now() }) }) // keeps the last good data (shown as stale)
    .finally(() => { inflight = null })
  return inflight
}
export function refreshMyRecord() { if (state.key) return load(state.key, true) }

/** { cloud, status: 'demo'|'loading'|'ok'|'error', data, message, at } */
export function useMyRecord() {
  const { session, me } = useApp()
  const cloud = session.mode === 'minimoth' && !!session.cloud && isStudent(me) // phone students have no role field
  const key = cloud ? `${session.userId}:${session.enrollment?.division_code || ''}` : null
  const snap = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => state)
  useEffect(() => {
    if (!key) return
    load(key)
    const onFocus = () => { if (document.visibilityState !== 'hidden') load(key) }
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [key])
  if (!cloud) return { cloud: false, status: 'demo', data: null, message: '', at: 0 }
  if (snap.key !== key) return { cloud: true, status: 'loading', data: null, message: '', at: 0 }
  return { cloud: true, ...snap }
}

/**
 * Attendance for the signed-in student, computed by summarize() in lib/attendance.js.
 *  - phone accounts: from the server record (the same rows the College portal and Parent portal use);
 *    threshold = the HOD's setting for the branch, or null when none is set (no warning is invented).
 *  - demo accounts: from the browser's sample sheets; the 75% line is a labelled reference only.
 */
export function useStudentAttendance() {
  const { db, me, now } = useApp()
  const rec = useMyRecord()
  const demo = useMemo(() => (rec.cloud ? null : studentSummary(db.shared, me?.id, now)), [rec.cloud, db.shared, me?.id, now])
  const cloudSum = useMemo(() => (rec.cloud && rec.data ? summarize(rowsFromServer(rec.data.attendance?.history), now) : null), [rec.cloud, rec.data, now])
  if (!rec.cloud) return { source: 'demo', status: 'ok', sum: demo, threshold: 75, thresholdIsReference: true, message: '', record: null }
  return {
    source: 'server', status: rec.status, sum: cloudSum, message: rec.message, at: rec.at, record: rec.data,
    threshold: rec.data?.attendanceThreshold ?? null, thresholdIsReference: false,
    stale: rec.status === 'error' && !!rec.data,
  }
}
