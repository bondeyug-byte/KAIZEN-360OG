// Landing-page 3D preview, split out so three.js loads only when it is shown.
import { useEffect, useMemo, useRef, useState } from 'react'
import { getScene } from '../navigator/scene.js'
import { cx } from './ui.jsx'

/** The real 3D model, interactive. Clicking a room opens it in the navigator. */
export default function CampusPreview() {
  const host = useRef(null)
  const scene = useMemo(() => getScene(), [])
  const [hint, setHint] = useState(null)
  useEffect(() => {
    if (!scene.ok) return
    scene.mount(host.current)
    scene.viewCampus()
    return () => scene.unmount()
  }, [scene])
  // A click (not a drag) opens the full navigator; dragging orbits the model here.
  const down = useRef(null)
  const onDown = (e) => { down.current = { x: e.clientX, y: e.clientY } }
  const onUp = (e) => { const d = down.current; down.current = null; if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) { setHint(true); setTimeout(() => { window.location.hash = '/navigator' }, 400) } }
  return (
    <div className="relative">
      <div ref={host} onPointerDown={onDown} onPointerUp={onUp} role="img" aria-label="Interactive 3D model of the VESIT main building" className={cx('h-[340px] overflow-hidden rounded-2xl border border-line bg-[#C7DCEC] shadow-pop sm:h-[440px]', !scene.ok && 'grid place-items-center')}>
        {!scene.ok && <p className="p-6 text-center text-sm text-muted">3D needs WebGL, which this browser has turned off. <a href="#/navigator" className="font-semibold text-maroon">Open the floor plan instead</a>.</p>}
      </div>
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-surface/90 px-2.5 py-1 text-[12px] font-semibold shadow-card">Live 3D model</span>
        <span className="rounded-full bg-surface/90 px-2.5 py-1 text-[12px] font-medium text-muted shadow-card">Drag to orbit · click to open the navigator</span>
      </div>
      {hint && <div role="status" className="fade-in absolute bottom-3 left-3 rounded-lg bg-maroon px-3 py-2 text-[13px] font-semibold text-white shadow-pop">Opening the 3D navigator…</div>}
      <div className="pointer-events-none absolute bottom-3 right-3 flex gap-1.5 text-[11.5px] font-semibold">
        <span className="rounded-md bg-[#FBF0DC] px-2 py-0.5 text-[#8A5A0E] shadow-card">Labs · west</span><span className="rounded-md bg-[#E7F0FB] px-2 py-0.5 text-[#1F4F8A] shadow-card">Classrooms · east</span>
      </div>
    </div>
  )
}

