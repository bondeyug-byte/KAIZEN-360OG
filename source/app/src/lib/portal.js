// Browser client for the college portal API (/api/app/*). The server decides identity and permissions;
// this file only sends requests and turns failures into readable messages.
const API = '/api/app'

export class PortalError extends Error {
  constructor(code, message, data) { super(message); this.code = code; this.data = data }
}

export async function api(route, { method = 'GET', body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : ''
  let res
  try {
    res = await fetch(`${API}/${route}${qs}`, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  } catch { throw new PortalError('NETWORK', 'You appear to be offline. Try again when you are connected.') }
  if (!(res.headers.get('content-type') || '').includes('application/json')) throw new PortalError('UNAVAILABLE', 'The college portal server is not available here.')
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) throw new PortalError(data?.code || `HTTP_${res.status}`, data?.error || 'Something went wrong. Try again.', data)
  return data
}

/** Download a shared file (the server checks the class before sending it). */
export async function downloadFile(id, name) {
  let res
  try { res = await fetch(`${API}/file?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' }) } catch { throw new PortalError('NETWORK', 'You appear to be offline.') }
  if (!res.ok) { const d = await res.json().catch(() => null); throw new PortalError(d?.code || 'HTTP', d?.error || 'Could not download the file.') }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export const MAX_UPLOAD = 3 * 1024 * 1024
export const UPLOAD_TYPES = {
  'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPG', 'text/plain': 'Text',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
}
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(new PortalError('FILE_READ', 'Could not read that file.'))
    r.readAsDataURL(file)
  })
}

export const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
