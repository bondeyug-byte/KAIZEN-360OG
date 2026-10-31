// Minimal, dependency-light reader for .xlsx and .csv files: returns [{ name, rows: [[cell, ...], ...] }].
// Cells are strings, numbers (Excel times stay as day fractions, e.g. 0.354 = 08:30) or booleans.
// Values are read as plain data only: formulas are not evaluated and nothing in the file is executed.
// Legacy .xls (binary) is not supported — save it as .xlsx first.
import { unzipSync, strFromU8 } from 'fflate'

const MAX_BYTES = 5 * 1024 * 1024

export class SheetError extends Error {}

function colIndex(ref) {
  const m = /^([A-Z]+)\d+$/.exec(ref || '')
  if (!m) return null
  let n = 0
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}
const xml = (s) => new DOMParser().parseFromString(s, 'application/xml')
const kids = (el, name) => Array.from(el.getElementsByTagName(name))
const text = (el) => kids(el, 't').map((t) => t.textContent).join('')

function readXlsx(bytes) {
  let files
  try { files = unzipSync(bytes) } catch { throw new SheetError('This file is not a valid .xlsx workbook.') }
  const get = (p) => (files[p] ? strFromU8(files[p]) : null)
  const wbXml = get('xl/workbook.xml')
  if (!wbXml) throw new SheetError('This file is not a valid .xlsx workbook.')
  const shared = get('xl/sharedStrings.xml') ? kids(xml(get('xl/sharedStrings.xml')), 'si').map(text) : []
  const rels = {}
  const relXml = get('xl/_rels/workbook.xml.rels')
  if (relXml) for (const r of kids(xml(relXml), 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target')
  const out = []
  for (const s of kids(xml(wbXml), 'sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
    let target = rels[rid] || ''
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')
    const sx = get(target)
    if (!sx) continue
    const rows = []
    const doc = xml(sx)
    for (const row of kids(doc, 'row')) {
      const ri = Number(row.getAttribute('r')) - 1
      const cells = []
      for (const c of kids(row, 'c')) {
        const ci = colIndex(c.getAttribute('r'))
        if (ci === null || ci > 40) continue
        const t = c.getAttribute('t')
        const v = kids(c, 'v')[0]?.textContent
        let val = ''
        if (t === 's') val = shared[Number(v)] ?? ''
        else if (t === 'inlineStr') val = text(c)
        else if (t === 'str' || t === 'e') val = v ?? ''
        else if (t === 'b') val = v === '1'
        else if (v !== undefined && v !== '') val = Number(v)
        cells[ci] = val
      }
      for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
      if (ri >= 0 && ri < 6000) rows[ri] = cells
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
    // Merged cells (e.g. a two-hour lab spanning two time rows in the college timetable), as "F5:F6" ranges.
    const merges = kids(doc, 'mergeCell').map((m) => m.getAttribute('ref')).filter((r) => /^[A-Z]{1,3}\d{1,5}:[A-Z]{1,3}\d{1,5}$/.test(r || '')).slice(0, 4000)
    out.push({ name: s.getAttribute('name') || `Sheet${out.length + 1}`, rows, merges })
  }
  if (!out.length) throw new SheetError('The workbook has no readable sheets.')
  return out
}

export function parseCsv(textIn) {
  const rows = []; let row = []; let cell = ''; let q = false
  const s = textIn.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/** Read a File (from an <input type="file">) into sheets. */
export async function readSheets(file) {
  if (!file) throw new SheetError('Choose a file.')
  if (file.size > MAX_BYTES) throw new SheetError('The file is larger than 5 MB.')
  const name = file.name || ''
  if (/\.xls$/i.test(name)) throw new SheetError('Old .xls files are not supported. In Excel, use File → Save As → .xlsx, then upload again.')
  if (/\.csv$/i.test(name)) return [{ name: 'Timetable', rows: parseCsv(await file.text()) }]
  if (!/\.xlsx$/i.test(name)) throw new SheetError('Upload an .xlsx or .csv file.')
  return readXlsx(new Uint8Array(await file.arrayBuffer()))
}
