// Binary files (challenge briefs, solution uploads) live in IndexedDB — never as data URLs inside the
// LocalStorage JSON. Records elsewhere keep only { fileId, name, type, size }.
// If IndexedDB is unavailable (some private windows / sandboxed previews), files are kept in memory for this tab
// only and `filesPersistent()` returns false so the UI can say so.
const DB_NAME = 'campus360-files', STORE = 'files'
const memory = new Map()
let dbPromise = null, persistent = true

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (!globalThis.indexedDB) throw new Error('no idb')
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => { persistent = false; resolve(null) }
      req.onblocked = () => { persistent = false; resolve(null) }
    } catch { persistent = false; resolve(null) }
  })
  return dbPromise
}
export const filesPersistent = () => persistent

const tx = (db, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s)
  t.oncomplete = () => resolve(out?.result)
  t.onerror = () => reject(t.error || new Error('Storage error'))
  t.onabort = () => reject(t.error || new Error('Storage was full or blocked'))
})

/** Store a File/Blob. Resolves to metadata only after the write has committed. */
export async function putFile(file) {
  const id = 'file_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  const rec = { id, name: file.name || 'file', type: file.type || 'application/octet-stream', size: file.size, blob: file, savedAt: new Date().toISOString() }
  const db = await openDb()
  if (db) await tx(db, 'readwrite', (s) => s.put(rec))
  else memory.set(id, rec)
  return { fileId: id, name: rec.name, type: rec.type, size: rec.size }
}
export async function getFile(id) {
  const db = await openDb()
  if (!db) return memory.get(id) || null
  return (await tx(db, 'readonly', (s) => s.get(id))) || null
}
export async function deleteFile(id) {
  const db = await openDb()
  if (!db) { memory.delete(id); return }
  try { await tx(db, 'readwrite', (s) => s.delete(id)) } catch { /* best effort */ }
}

/* ---------------- validation ---------------- */
export const FILE_KINDS = {
  pdf: { label: 'PDF', mime: ['application/pdf'], ext: ['pdf'], magic: [[0x25, 0x50, 0x44, 0x46]] },
  jpg: { label: 'JPG', mime: ['image/jpeg'], ext: ['jpg', 'jpeg'], magic: [[0xff, 0xd8, 0xff]] },
  png: { label: 'PNG', mime: ['image/png'], ext: ['png'], magic: [[0x89, 0x50, 0x4e, 0x47]] },
}
export const kindOf = (name = '', type = '') => {
  const ext = name.toLowerCase().split('.').pop()
  return Object.keys(FILE_KINDS).find((k) => FILE_KINDS[k].mime.includes(type) || FILE_KINDS[k].ext.includes(ext)) || null
}
export const typesLabel = (types) => types.map((t) => FILE_KINDS[t]?.label || t).join(', ')
export const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB')

/** Checks extension/MIME, size and the file's first bytes. Returns an error message or null. */
export async function checkFile(file, { types = ['pdf', 'jpg', 'png'], maxMB = 10 } = {}) {
  if (!file) return 'Choose a file.'
  const k = kindOf(file.name, file.type)
  if (!k || !types.includes(k)) return `${file.name}: only ${typesLabel(types)} files are allowed.`
  if (file.size === 0) return `${file.name} is empty.`
  if (file.size > maxMB * 1048576) return `${file.name} is ${fmtSize(file.size)}; the limit is ${maxMB} MB.`
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
    if (!FILE_KINDS[k].magic.some((m) => m.every((b, i) => head[i] === b))) return `${file.name} doesn't look like a real ${FILE_KINDS[k].label} file.`
  } catch { return `${file.name} couldn't be read.` }
  return null
}
