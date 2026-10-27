import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { loadDb, saveDb, clearDb, prefs, KEY as DB_KEY, isValidDb, sanitizeDb } from '../lib/storage.js'
import { makeSeed, emptyUserData, DEMO_USERS, refreshDemoTimes } from '../data/seed.js'
import * as auth from '../lib/auth.js'
import { loadAccount, saveAccount, adoptAccount, syncableProfile } from '../lib/account.js'
import { TRUSTED_DEMO } from '../lib/roles.js'

// Demo sign-in (fictional sample users, browser-only data) exists only in the offline demo file. The deployed site
// is built with __DEMO__ = false, so there is no way to enter it without a real Google sign-in.
const DEMO_ENABLED = typeof __DEMO__ === 'undefined' ? true : __DEMO__ // eslint-disable-line no-undef
// College site: while Google sign-in is NOT configured on the server, the demo accounts stay available so the site
// is usable. They only ever see fictional sample data in this browser; the server never trusts them. The moment the
// server reports Google sign-in as configured, demo sign-in switches off by itself.
const DEMO_FALLBACK = typeof __DEMO_FALLBACK__ === 'undefined' ? false : __DEMO_FALLBACK__ // eslint-disable-line no-undef
const demoAllowedFor = (s) => DEMO_ENABLED || (DEMO_FALLBACK && !!s && s.checked !== false && !(s.available && s.configured))
import { notify, deadlineNotifications, markRead, markAllRead } from '../lib/notifications.js'

const Ctx = createContext(null)
/** Role fields from a server response (/api/app/me or /api/auth/*). The browser never decides these. */
const rolesFrom = (r) => ({ role: r.role || 'student', hod: r.hod || null, teacher: r.teacher || null, parent: r.role === 'parent' ? r.parent || {} : null, admin: false, ...(r.cr ? { cr: r.cr } : {}), ...('enrollment' in r ? { enrollment: r.enrollment, joinRequest: r.joinRequest, crRequest: r.crRequest, counts: r.counts } : {}) })
export const useApp = () => useContext(Ctx)

export function AppProvider({ children }) {
  const initial = useMemo(() => { const r = loadDb(makeSeed, emptyUserData); const db = refreshDemoTimes(r.db, new Date()); return db === r.db ? r : { ...r, db, fresh: true } }, [])
  const [db, setDbState] = useState(initial.db)
  const [toasts, setToasts] = useState([])
  const [now, setNow] = useState(() => new Date())
  const [session, setSession] = useState({ status: 'loading', mode: null, userId: null, email: null, phone: null, message: null })
  const [server, setServer] = useState({ checked: false, available: false, configured: false })
  const serverRef = useRef({ checked: false })
  useEffect(() => { serverRef.current = server }, [server])
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
    if (!saveDb(next)) pushToast('Couldn\u2019t save to browser storage. Changes last until you close this tab.', 'warn')
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
  // Google sign-in (lib/auth.js). The server keeps the session in an HttpOnly cookie and re-checks the domain and
  // role on every request, so there is no token in the page to refresh. A 401/403 from the server ends the session.
  const endSession = useCallback((message) => {
    setSession({ status: 'signedOut', mode: null, userId: null, email: null, phone: null, message })
    if (!/^#\/(login|welcome)?(\?|$)/.test(window.location.hash)) window.location.hash = '/login'
  }, [])
  const ENDED = ['NO_SESSION', 'SESSION_ENDED', 'NO_ACCESS']

  // A local profile for the signed-in Google account. Roles never come from here: they come from the server.
  const ensureProfileForIdentity = useCallback((email, name = '') => {
    const id = `g_${email}`
    setDb((d) => {
      if (d.profiles[id]) return { ...d, profiles: { ...d.profiles, [id]: { ...d.profiles[id], email, role: undefined, teaches: undefined } } }
      return {
        ...d,
        profiles: { ...d.profiles, [id]: { id, name: name || '', classId: '', branch: '', year: '', interests: [], subjects: [], email, phone: null, phoneVerified: false, authMethod: 'google', demo: false } },
        userData: { ...d.userData, [id]: emptyUserData() },
      }
    })
    return id
  }, [setDb])

  /** Switch a signed-in session to its cloud account: the same account and data on every device. */
  const attachAccount = useCallback(async (email) => {
    setSync({ status: 'loading', at: null })
    try {
      const r = await loadAccount()
      const { db: next, uid, migrated } = adoptAccount(dbRef.current, r, email, emptyUserData)
      setDb(next)
      const snap = JSON.stringify({ profile: syncableProfile(next.profiles[uid]), data: next.userData[uid] })
      acct.current = { ...acct.current, version: r.version, lastSent: migrated ? null : snap }
      setSession((s) => (s.mode === 'google' ? { ...s, userId: uid, cloud: true, ...rolesFrom(r) } : s))
      setSync({ status: 'synced', at: new Date() })
      if (migrated) pushToast('Your profile from this browser was copied to your account. It now syncs across devices.')
    } catch (e) {
      acct.current = { ...acct.current, version: null }
      if (ENDED.includes(e.code)) { setSync({ status: 'off', at: null }); return endSession(e.message) }
      setSync({ status: e.code === 'NETWORK' ? 'offline' : 'unavailable', at: null, message: e.message })
    }
  }, [setDb, pushToast, endSession]) // eslint-disable-line

  const startSession = useCallback((r) => {
    const uid = ensureProfileForIdentity(r.email, r.name)
    if (r.teacher?.name || r.name) setDb((d) => (d.profiles[uid] && !d.profiles[uid].name ? { ...d, profiles: { ...d.profiles, [uid]: { ...d.profiles[uid], name: r.teacher?.name || r.name } } } : d))
    setSession({ status: 'signedIn', mode: 'google', userId: uid, email: r.email, phone: null, ...rolesFrom(r), message: null })
    attachAccount(r.email)
    return uid
  }, [ensureProfileForIdentity, attachAccount, setDb])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await auth.serverAvailable()
      if (cancelled) return
      setServer({ checked: true, ...s }); serverRef.current = { checked: true, ...s }
      const demoUser = demoAllowedFor({ ...s, checked: true }) ? prefs.get('demoUser', null) : null
      if (demoUser && dbRef.current.profiles[demoUser]) {
        setSession({ status: 'signedIn', mode: 'demo', userId: demoUser, email: null, phone: null, message: null })
        return
      }
      if (s.available && s.configured) {
        // Coming back from a redirect sign-in (popup was blocked): finish it first.
        try {
          const r = await auth.finishPendingSignIn()
          if (cancelled) return
          if (r && r.otpRequired) { auth.rememberCodeStep(r); setSession((x) => ({ ...x, status: 'signedOut' })); window.location.hash = `/login?role=${r.portal || 'student'}`; return }
          if (r) { startSession(r); return }
        } catch (e) {
          if (!cancelled) { setSession((x) => ({ ...x, status: 'signedOut', message: e.message })); return }
        }
        try {
          const r = await auth.restoreSession()
          if (cancelled) return
          startSession(r)
          return
        } catch (e) {
          // No session is normal; an ended or refused one gets a message on the sign-in page.
          if (!cancelled && e?.code && e.code !== 'NO_SESSION' && e.code !== 'NETWORK') { setSession((x) => ({ ...x, status: 'signedOut', message: e.message })); return }
        }
      }
      setSession((x) => ({ ...x, status: 'signedOut' }))
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line

  /** Called by the sign-in page with the server's answer to a verified Google sign-in. */
  const completeGoogleLogin = startSession

  const demoLogin = useCallback((userId) => {
    if (!demoAllowedFor(serverRef.current) || !DEMO_USERS.includes(userId)) return
    prefs.set('demoUser', userId)
    setSession({ status: 'signedIn', mode: 'demo', userId, email: null, phone: null, message: null })
  }, [])

  const signOut = useCallback(async (message = null) => {
    clearTimeout(acct.current.timer)
    acct.current = { version: null, lastSent: null, timer: null, saving: false }
    setSync({ status: 'off', at: null })
    if (session.mode === 'google') {
      try { await auth.logout() } catch { /* the cookie also expires on its own */ }
    }
    prefs.set('demoUser', null)
    setSession({ status: 'signedOut', mode: null, userId: null, email: null, phone: null, message })
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
  // For Google sessions the role is re-derived from verified sources on every render (server admin flag, staff allowlist
  // matched on the verified phone), so editing a stored profile can't grant admin or teacher access.
  const me = useMemo(() => {
    let p = session.userId ? db.profiles[session.userId] : null
    if (!p) return p
    // Demo accounts: role and class assignments come from the trusted table in code, never from storage.
    if (session.mode === 'demo') { const t = TRUSTED_DEMO[session.userId]; if (!t) return null; return { ...p, role: t.role === 'student' ? undefined : t.role, teaches: t.teaches, classRep: t.classRep } }
    if (session.mode !== 'google') return null
    const staff = null // phone-number staff list (demo admin page) no longer grants anything; roles come from the server
    if (p.classRep) p = { ...p, classRep: false } // class rep is assigned by the app, never by a profile edit
    // Phone accounts: the role comes from the server (HOD outranks teacher, teacher outranks student).
    if (session.hod) return { ...p, role: 'hod', hodBranches: session.hod.branches, teaches: undefined }
    if (session.parent) return { ...p, role: 'parent', teaches: undefined, classRep: false }
    if (session.teacher) return { ...p, role: 'teacher', teaches: session.teacher.teaches || [], name: p.name || session.teacher.name || p.name }
    if (session.cloud) {
      const e = session.enrollment
      return { ...(p.role ? { ...p, role: undefined, teaches: undefined } : p), cr: session.cr || [], enrollment: e || null, ...(e ? { division: e.division_code } : {}) }
    }
    if (staff) return { ...p, role: 'teacher', teaches: staff.teaches }
    return p.role === 'admin' || p.role === 'teacher' || p.role === 'organiser' ? { ...p, role: undefined, teaches: undefined } : p
  }, [db.profiles, db.shared.staffAllowlist, session.userId, session.mode, session.email, session.admin, session.teacher, session.hod, session.parent, session.cloud, session.cr, session.enrollment])
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
      if (`acc_${r.account.id}` !== uid) return
      // Roles can change at any time (teacher removed, class rep appointed or removed): always take the server's view.
      setSession((s) => (s.mode === 'google' && s.userId === uid ? { ...s, ...rolesFrom(r) } : s))
      if (r.version === acct.current.version) return
      const { db: next } = adoptAccount(dbRef.current, r, session.email, emptyUserData)
      acct.current = { ...acct.current, version: r.version, lastSent: JSON.stringify({ profile: syncableProfile(next.profiles[uid]), data: next.userData[uid] }) }
      setDb(next)
      setSync({ status: 'synced', at: new Date() })
    } catch (e) {
      if (ENDED.includes(e.code)) return endSession(e.message) // signed out elsewhere, link removed, or no longer allowed
      setSync((x) => ({ ...x, status: e.code === 'NETWORK' ? 'offline' : x.status }))
    }
  }, [cloudUid, session.email, setDb, endSession]) // eslint-disable-line

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
          const { db: next } = adoptAccount(dbRef.current, { account: { id: cloudUid.slice(4), name: '' }, profile: e.data.profile, data: e.data.data }, session.email, emptyUserData)
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

  /** Re-read roles/enrollment from the server now (after joining, approvals, CR changes). */
  const refreshAccount = useCallback(async () => {
    if (!session.cloud) return
    try { const r = await loadAccount(); setSession((s) => (s.mode === 'google' ? { ...s, ...rolesFrom(r) } : s)) } catch { /* next focus will retry */ }
  }, [session.cloud])
  const value = {
    refreshAccount,
    db, setDb, now, toasts, pushToast, session, server, me, myData, sync,
    completeGoogleLogin, demoLogin, demoEnabled: demoAllowedFor(server), googleReady: server.available && server.configured, signOut, resetDemo, runShared, updateMyData, updateProfile, markNotificationsRead, markAllNotificationsRead,
    signedIn: session.status === 'signedIn',
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function profileCompletion(p) {
  if (!p) return { pct: 0, missing: [] }
  if (['teacher', 'admin', 'organiser', 'hod', 'parent'].includes(p.role)) return { pct: p.name?.trim() ? 100 : 50, missing: p.name?.trim() ? [] : ['name'] }
  const checks = [['name', !!p.name?.trim()], ['year, branch and division', !!(p.year && p.branchId && p.division)], ['roll number', !!p.roll], ['interests', (p.interests || []).length > 0], ['subjects', (p.subjects || []).length > 0]]
  const missing = checks.filter(([, ok]) => !ok).map(([k]) => k)
  return { pct: Math.round(((checks.length - missing.length) / checks.length) * 100), missing }
}
