import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { loadDb, saveDb, clearDb, prefs, KEY as DB_KEY, isValidDb, sanitizeDb } from '../lib/storage.js'
import { makeSeed, emptyUserData, DEMO_USERS, refreshDemoTimes } from '../data/seed.js'
import * as auth from '../lib/auth.js'
import { loadAccount, saveAccount, adoptAccount, syncableProfile } from '../lib/account.js'
import { TRUSTED_DEMO } from '../lib/roles.js'
import { notify, deadlineNotifications, markRead, markAllRead } from '../lib/notifications.js'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function AppProvider({ children }) {
  const initial = useMemo(() => { const r = loadDb(makeSeed, emptyUserData); const db = refreshDemoTimes(r.db, new Date()); return db === r.db ? r : { ...r, db, fresh: true } }, [])
  const [db, setDbState] = useState(initial.db)
  const [toasts, setToasts] = useState([])
  const [now, setNow] = useState(() => new Date())
  const [session, setSession] = useState({ status: 'loading', mode: null, userId: null, accessToken: null, expiresAt: null, phone: null, message: null })
  const [server, setServer] = useState({ checked: false, available: false, configured: false })
  const refreshTimer = useRef(null)
  // Cloud sync state. `acct` holds the server version this browser last saw and the JSON last sent.
  const [sync, setSync] = useState({ status: 'off', at: null })
  const acct = useRef({ version: null, lastSent: null, timer: null, saving: false })

  // Persist every change. Updates are applied synchronously to a ref so that a transition and
  // its result (ok / error) are known immediately, then mirrored into React state.
  const dbRef = useRef(db)
  const setDb = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(dbRef.current) : updater
    if (next === dbRef.current) return
    dbRef.current = next
    if (!saveDb(next)) pushToast('Couldn\u2019t save to browser storage — changes last until you close this tab.', 'warn')
    setDbState(next)
  }, []) // eslint-disable-line
  useEffect(() => { if (initial.fresh) saveDb(initial.db); if (initial.notice) pushToast(initial.notice, 'warn') }, []) // eslint-disable-line

  // Another tab of this browser saved data: adopt it, so this tab's next save doesn't overwrite that change.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== DB_KEY || !e.newValue) return
      try { const d = JSON.parse(e.newValue); if (isValidDb(d)) { const clean = sanitizeDb(d, emptyUserData).db; dbRef.current = clean; setDbState(clean) } } catch { /* ignore unreadable data from another tab */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Clock for time-based statuses
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])

  const pushToast = useCallback((text, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  /* ---------------- Authentication ---------------- */
  const scheduleRefresh = useCallback((expiresAt) => {
    clearTimeout(refreshTimer.current)
    const at = Date.parse(expiresAt)
    const wait = Number.isFinite(at) ? Math.max(15000, at - Date.now() - 60000) : 240000
    refreshTimer.current = setTimeout(async () => {
      try {
        const r = await auth.restoreSession()
        setSession((s) => ({ ...s, accessToken: r.access_token, expiresAt: r.expires_at, admin: !!r.admin, teacher: r.teacher || null }))
        scheduleRefresh(r.expires_at)
      } catch (e) {
        // A failed silent refresh ends the session: back to sign-in with a clear message.
        setSession({ status: 'signedOut', mode: null, userId: null, accessToken: null, expiresAt: null, phone: null, message: 'Your session has ended. Please sign in again.' })
        if (!/^#\/(login|welcome)?$/.test(window.location.hash)) window.location.hash = '/login'
      }
    }, wait)
  }, [])

  // Role comes from verified sources only: `admin` from the server's ADMIN_PHONES check, `teacher` from the
  // admin-maintained staff allowlist matched on the OTP-verified phone. A profile can't promote itself.
  const ensureProfileForIdentity = useCallback((identityId, phone, admin = false) => {
    const id = `mm_${identityId}`
    setDb((d) => {
      const staff = (d.shared.staffAllowlist || []).find((x) => x.active !== false && x.phone && phone && x.phone.replace(/\D/g, '').slice(-10) === String(phone).replace(/\D/g, '').slice(-10))
      const roleBits = admin ? { role: 'admin' } : staff ? { role: 'teacher', teaches: staff.teaches, name: d.profiles[id]?.name || staff.name, email: staff.email || d.profiles[id]?.email || '' } : { role: d.profiles[id]?.role === 'admin' || d.profiles[id]?.role === 'teacher' ? undefined : d.profiles[id]?.role }
      if (d.profiles[id]) return { ...d, profiles: { ...d.profiles, [id]: { ...d.profiles[id], ...roleBits, phone, phoneVerified: true } } }
      return {
        ...d,
        profiles: { ...d.profiles, [id]: { id, name: '', classId: '', branch: '', year: '', interests: [], subjects: [], phone, phoneVerified: true, authMethod: 'minimoth', demo: false, ...roleBits } },
        userData: { ...d.userData, [id]: emptyUserData() },
      }
    })
    return id
  }, [setDb])

  /** Switch an OTP session to its cloud account: the same account and data on every device. */
  const attachAccount = useCallback(async (phone) => {
    setSync({ status: 'loading', at: null })
    try {
      const r = await loadAccount()
      const { db: next, uid, migrated } = adoptAccount(dbRef.current, r, phone, emptyUserData)
      setDb(next)
      const snap = JSON.stringify({ profile: syncableProfile(next.profiles[uid]), data: next.userData[uid] })
      acct.current = { ...acct.current, version: r.version, lastSent: migrated ? null : snap }
      setSession((s) => (s.mode === 'minimoth' ? { ...s, userId: uid, cloud: true, admin: s.admin || !!r.admin, teacher: s.teacher || r.teacher || null } : s))
      setSync({ status: 'synced', at: new Date() })
      if (migrated) pushToast('Your profile from this browser was copied to your account. It now syncs across devices.')
    } catch (e) {
      acct.current = { ...acct.current, version: null }
      setSync({ status: e.code === 'NETWORK' ? 'offline' : 'unavailable', at: null, message: e.message })
    }
  }, [setDb, pushToast])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await auth.serverAvailable()
      if (cancelled) return
      setServer({ checked: true, ...s })
      const demoUser = prefs.get('demoUser', null)
      if (demoUser && dbRef.current.profiles[demoUser]) {
        setSession({ status: 'signedIn', mode: 'demo', userId: demoUser, accessToken: null, expiresAt: null, phone: null, message: null })
        return
      }
      if (s.available && s.configured) {
        try {
          const r = await auth.restoreSession()
          if (cancelled) return
          const uid = ensureProfileForIdentity(r.identity_id || r.phone, r.phone, !!r.admin)
          setSession({ status: 'signedIn', mode: 'minimoth', userId: uid, accessToken: r.access_token, expiresAt: r.expires_at, phone: r.phone, admin: !!r.admin, teacher: r.teacher || null, message: null })
          scheduleRefresh(r.expires_at)
          attachAccount(r.phone)
          return
        } catch (e) {
          // No session is normal; an expired or revoked one gets a message on the sign-in page.
          if (!cancelled && e?.code && e.code !== 'NO_SESSION' && e.code !== 'NETWORK') { setSession((x) => ({ ...x, status: 'signedOut', message: 'Your session has ended. Please sign in again.' })); return }
        }
      }
      setSession((x) => ({ ...x, status: 'signedOut' }))
    })()
    return () => { cancelled = true; clearTimeout(refreshTimer.current) }
  }, []) // eslint-disable-line

  const completeOtpLogin = useCallback((r) => {
    const uid = ensureProfileForIdentity(r.identity_id || r.phone, r.phone, !!r.admin)
    if (r.teacher?.name) setDb((d) => (d.profiles[uid] && !d.profiles[uid].name ? { ...d, profiles: { ...d.profiles, [uid]: { ...d.profiles[uid], name: r.teacher.name } } } : d))
    setSession({ status: 'signedIn', mode: 'minimoth', userId: uid, accessToken: r.access_token, expiresAt: r.expires_at, phone: r.phone, admin: !!r.admin, teacher: r.teacher || null, message: null })
    scheduleRefresh(r.expires_at)
    attachAccount(r.phone)
    return uid
  }, [ensureProfileForIdentity, scheduleRefresh, attachAccount])

  const demoLogin = useCallback((userId) => {
    if (!DEMO_USERS.includes(userId)) return
    prefs.set('demoUser', userId)
    setSession({ status: 'signedIn', mode: 'demo', userId, accessToken: null, expiresAt: null, phone: null, message: null })
  }, [])

  const signOut = useCallback(async (message = null) => {
    clearTimeout(refreshTimer.current)
    clearTimeout(acct.current.timer)
    acct.current = { version: null, lastSent: null, timer: null, saving: false }
    setSync({ status: 'off', at: null })
    if (session.mode === 'minimoth') {
      try { await auth.logout(session.accessToken) } catch { /* cookies are cleared server-side anyway */ }
    }
    prefs.set('demoUser', null)
    setSession({ status: 'signedOut', mode: null, userId: null, accessToken: null, expiresAt: null, phone: null, message })
  }, [session])

  const resetDemo = useCallback(() => {
    clearDb()
    const fresh = makeSeed()
    saveDb(fresh)
    dbRef.current = fresh
    setDbState(fresh)
    pushToast('Demo data reset.')
  }, [pushToast])

  /* ---------------- Data helpers ---------------- */
  // For OTP sessions the role is re-derived from verified sources on every render (server admin flag, staff allowlist
  // matched on the verified phone), so editing a stored profile can't grant admin or teacher access.
  const me = useMemo(() => {
    let p = session.userId ? db.profiles[session.userId] : null
    if (!p) return p
    // Demo accounts: role and class assignments come from the trusted table in code, never from storage.
    if (session.mode === 'demo') { const t = TRUSTED_DEMO[session.userId]; if (!t) return null; return { ...p, role: t.role === 'student' ? undefined : t.role, teaches: t.teaches, classRep: t.classRep } }
    if (session.mode !== 'minimoth') return null
    const digits = (x) => String(x || '').replace(/\D/g, '').slice(-10)
    const staff = (db.shared.staffAllowlist || []).find((x) => x.active !== false && x.phone && session.phone && digits(x.phone) === digits(session.phone))
    if (p.classRep) p = { ...p, classRep: false } // class rep is assigned by the app, never by a profile edit
    if (session.admin) return p.role === 'admin' ? p : { ...p, role: 'admin' }
    // Teacher: from the server's TEACHER_PHONES (works on every device) or the admin's staff list in this browser.
    if (session.teacher?.teaches?.length) return { ...p, role: 'teacher', teaches: session.teacher.teaches, name: p.name || session.teacher.name || p.name }
    if (staff) return { ...p, role: 'teacher', teaches: staff.teaches }
    return p.role === 'admin' || p.role === 'teacher' || p.role === 'organiser' ? { ...p, role: undefined, teaches: undefined } : p
  }, [db.profiles, db.shared.staffAllowlist, session.userId, session.mode, session.phone, session.admin, session.teacher])
  const myData = session.userId ? db.userData[session.userId] : null

  /** Apply a pure shared-state transition from src/lib/*. Returns the result. */
  const runShared = useCallback((fn, okText) => {
    const result = fn(dbRef.current.shared)
    if (result.ok) { setDb((d) => ({ ...d, shared: result.state })); if (okText) pushToast(okText) }
    else pushToast(result.error, 'bad')
    return result
  }, [setDb, pushToast])

  const updateMyData = useCallback((fn) => {
    if (!session.userId) return
    setDb((d) => ({ ...d, userData: { ...d.userData, [session.userId]: fn(d.userData[session.userId] || emptyUserData()) } }))
  }, [session.userId, setDb])

  const updateProfile = useCallback((patch) => {
    if (!session.userId) return
    // Fields that only verified sign-in or an admin may set are never taken from a profile edit.
    const { role, teaches, phone, phoneVerified, authMethod, demo, academicHistory, id, classRep, ...safe } = patch || {} // eslint-disable-line no-unused-vars
    setDb((d) => ({ ...d, profiles: { ...d.profiles, [session.userId]: { ...d.profiles[session.userId], ...safe } } }))
  }, [session.userId, setDb])

  // Deadline notifications come from the student's own deadline records: new, changed, and due within 24 h.
  // Idempotent (keyed), so re-renders and reloads never duplicate them.
  useEffect(() => {
    const uid = session.userId
    if (!uid) return
    const ud = dbRef.current.userData[uid]
    if (!ud) return
    const { items, seen } = deadlineNotifications(uid, ud.deadlines, ud.seenDeadlines, now)
    const seenChanged = JSON.stringify(seen) !== JSON.stringify(ud.seenDeadlines || null)
    const nextShared = notify(dbRef.current.shared, items, now)
    if (!seenChanged && nextShared === dbRef.current.shared) return
    setDb((d) => ({ ...d, shared: notify(d.shared, items, now), userData: { ...d.userData, [uid]: { ...d.userData[uid], seenDeadlines: seen } } }))
  }, [session.userId, myData?.deadlines, now, setDb])

  /* ---------------- Cloud sync (profile + private data) ---------------- */
  const cloudUid = session.cloud ? session.userId : null
  const pull = useCallback(async () => {
    const uid = cloudUid
    if (!uid || acct.current.saving || acct.current.timer) return
    try {
      const r = await loadAccount()
      if (r.version === acct.current.version || `acc_${r.account.id}` !== uid) return
      const { db: next } = adoptAccount(dbRef.current, r, session.phone, emptyUserData)
      acct.current = { ...acct.current, version: r.version, lastSent: JSON.stringify({ profile: syncableProfile(next.profiles[uid]), data: next.userData[uid] }) }
      setDb(next)
      setSync({ status: 'synced', at: new Date() })
    } catch (e) { setSync((x) => ({ ...x, status: e.code === 'NETWORK' ? 'offline' : x.status })) }
  }, [cloudUid, session.phone, setDb])

  const profileNow = cloudUid ? db.profiles[cloudUid] : null
  const dataNow = cloudUid ? db.userData[cloudUid] : null
  useEffect(() => {
    if (!cloudUid || acct.current.version === null) return
    const payload = { profile: syncableProfile(profileNow), data: dataNow }
    const snap = JSON.stringify(payload)
    if (snap === acct.current.lastSent) return
    clearTimeout(acct.current.timer)
    acct.current.timer = setTimeout(async () => {
      acct.current.timer = null
      acct.current.saving = true
      setSync((x) => ({ ...x, status: 'saving' }))
      try {
        const r = await saveAccount({ ...payload, baseVersion: acct.current.version })
        acct.current = { ...acct.current, version: r.version, lastSent: snap }
        setSync({ status: 'synced', at: new Date() })
      } catch (e) {
        if (e.code === 'VERSION_CONFLICT' && e.data) {
          // Another device saved first. Its copy wins; this device's unsaved edit is dropped and the user told.
          const { db: next } = adoptAccount(dbRef.current, { account: { id: cloudUid.slice(4), name: '' }, profile: e.data.profile, data: e.data.data }, session.phone, emptyUserData)
          acct.current = { ...acct.current, version: e.data.version, lastSent: JSON.stringify({ profile: syncableProfile(next.profiles[cloudUid]), data: next.userData[cloudUid] }) }
          setDb(next)
          setSync({ status: 'synced', at: new Date() })
          pushToast('This account was changed on another device, so that version is shown. Re-do your last edit if it is missing.', 'warn')
        } else setSync({ status: e.code === 'NETWORK' ? 'offline' : 'error', at: null, message: e.message })
      } finally { acct.current.saving = false }
    }, 1200)
  }, [cloudUid, profileNow, dataNow]) // eslint-disable-line

  // Pick up changes made on another device when this tab regains focus, and once a minute.
  useEffect(() => {
    if (!cloudUid) return
    const onFocus = () => { if (document.visibilityState !== 'hidden') pull() }
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus)
    const t = setInterval(pull, 60000)
    return () => { window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); clearInterval(t) }
  }, [cloudUid, pull])

  const markNotificationsRead = useCallback((ids) => { if (session.userId) setDb((d) => ({ ...d, shared: markRead(d.shared, session.userId, ids) })) }, [session.userId, setDb])
  const markAllNotificationsRead = useCallback(() => { if (session.userId) setDb((d) => ({ ...d, shared: markAllRead(d.shared, session.userId) })) }, [session.userId, setDb])

  const value = {
    db, setDb, now, toasts, pushToast, session, server, me, myData, sync,
    completeOtpLogin, demoLogin, signOut, resetDemo, runShared, updateMyData, updateProfile, markNotificationsRead, markAllNotificationsRead,
    signedIn: session.status === 'signedIn',
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function profileCompletion(p) {
  if (!p) return { pct: 0, missing: [] }
  if (['teacher', 'admin', 'organiser'].includes(p.role)) return { pct: p.name?.trim() ? 100 : 50, missing: p.name?.trim() ? [] : ['name'] }
  const checks = [['name', !!p.name?.trim()], ['year, branch and division', !!(p.year && p.branchId && p.division)], ['roll number', !!p.roll], ['interests', (p.interests || []).length > 0], ['subjects', (p.subjects || []).length > 0]]
  const missing = checks.filter(([, ok]) => !ok).map(([k]) => k)
  return { pct: Math.round(((checks.length - missing.length) / checks.length) * 100), missing }
}
