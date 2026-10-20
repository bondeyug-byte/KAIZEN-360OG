// Stable unique IDs for records (prefix + time + random).
let counter = 0
export function uid(prefix = 'id') {
  counter = (counter + 1) % 1e6
  const rand = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 10)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`
}
