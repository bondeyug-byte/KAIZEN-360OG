import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { CAMPUS_CENTER } from '../data/config.js'
import Icon from './Icon.jsx'
import { cx } from './ui.jsx'

const COLORS = { campus: '#1E5240', from: '#2457C5', to: '#B4532F', pick: '#1E7A4C' }
const icon = (kind, label) => L.divIcon({ className: '', html: `<div class="c360-pin" style="background:${COLORS[kind] || '#7A2E3B'}" aria-label="${label || ''}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -10] })
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/**
 * markers: [{ id, lat, lng, kind: 'campus'|'from'|'to'|'pick', title, sub }]
 * lines:   [{ id, from: {lat,lng}, to: {lat,lng} }]
 * onPick(latlng) enables click-to-place.
 */
export default function MapView({ markers = [], lines = [], onPick, height = 360, focusId, label = 'Map' }) {
  const el = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  const pickRef = useRef(onPick)
  const [state, setState] = useState('loading') // loading | ok | tilefail
  pickRef.current = onPick
  const key = JSON.stringify([markers, lines, focusId])

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([CAMPUS_CENTER.lat, CAMPUS_CENTER.lng], 14)
    let errors = 0, loaded = 0
    // CARTO's light basemap (OpenStreetMap data). The OSM tile servers return "Access blocked" images to
    // requests without a referrer (e.g. sandboxed previews) and aren't meant for app traffic.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', referrerPolicy: 'strict-origin-when-cross-origin', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' })
      .on('tileload', () => { loaded++; setState('ok') })
      .on('tileerror', () => { errors++; if (errors >= 3 && loaded === 0) setState('tilefail') })
      .addTo(m)
    const t = setTimeout(() => { if (loaded === 0) setState('tilefail') }, 8000)
    m.on('click', (e) => pickRef.current && pickRef.current({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }))
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current)
    return () => { clearTimeout(t); ro.disconnect(); m.remove() }
  }, [])

  useEffect(() => {
    const g = layer.current, m = map.current
    if (!g || !m) return
    g.clearLayers()
    const pts = []
    L.marker([CAMPUS_CENTER.lat, CAMPUS_CENTER.lng], { icon: icon('campus', 'VESIT'), title: 'VESIT campus', zIndexOffset: 500 }).bindPopup('<b>VESIT campus</b><br><span style="color:#6E5459">Collector Colony, Chembur</span>').addTo(g)
    for (const l of lines) L.polyline([[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]], { color: l.id === focusId?.split(':')[0] ? '#1E5240' : '#2457C5', weight: l.id === focusId?.split(':')[0] ? 5 : 3, dashArray: '6 6', opacity: 0.8 }).addTo(g)
    let focus = null
    for (const mk of markers) {
      if (!Number.isFinite(mk.lat) || !Number.isFinite(mk.lng)) continue
      const marker = L.marker([mk.lat, mk.lng], { icon: icon(mk.kind, mk.title), title: mk.title, keyboard: true })
        .bindPopup(`<b>${esc(mk.title)}</b>${mk.sub ? `<br><span style="color:#6E5459">${esc(mk.sub)}</span>` : ''}`)
        .addTo(g)
      pts.push([mk.lat, mk.lng])
      if (mk.id === focusId) focus = marker
    }
    if (focus) { m.setView(focus.getLatLng(), 16); focus.openPopup() }
    else if (pts.length > 1) m.fitBounds(pts, { padding: [30, 30], maxZoom: 16 })
    else if (pts.length === 1) m.setView(pts[0], 15)
  }, [key]) // eslint-disable-line

  return (
    <div className="relative">
      {/* Leaflet owns the inner element's class list, so React only styles the wrapper. */}
      <div role="region" aria-label={label} style={{ height }} className={cx('w-full overflow-hidden rounded-xl border border-line', state === 'tilefail' ? 'map-fallback' : 'bg-sand')}><div ref={el} className="h-full w-full" /></div>
      {state === 'loading' && <div className="shimmer pointer-events-none absolute inset-0 z-[300] rounded-xl opacity-60" />}
      {state === 'tilefail' && (
        <div className="fade-in absolute left-14 right-3 top-3 z-[500] flex items-start gap-2.5 rounded-lg border border-line bg-surface/95 px-3 py-2.5 text-[13px] shadow-lift">
          <Icon name="map" size={17} className="mt-0.5 flex-none text-muted" />
          <span><b className="font-semibold">Street map unavailable here.</b> <span className="text-muted">Map tiles can't load (offline, or blocked by this preview). Pins, routes and the ride list still work.</span></span>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-7 left-2 z-[400] rounded-md bg-surface/90 px-2 py-0.5 text-[11px] font-semibold text-muted shadow-card">Station pins approximate</div>
    </div>
  )
}
