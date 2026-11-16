// The page preview. It shows the exact SVG that gets exported. Dragging, scrolling or pinching moves the
// map under the page.
//
// The picture on screen was drawn for one frame (`picMap`), while the user may already be looking at a
// newer one (`viewMap`): just after a drag, or while a redraw is on its way. The transform that turns
// the one into the other is worked out from the two frames every time either changes, and a gesture in
// progress is applied on top. So a committed move never jumps back, a new gesture can start before the
// redraw arrives, and clicks are mapped back through the same transform to land where they were made.
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { flushSync } from 'react-dom'
import { makeProjection } from '../map/geo'
import type { Frame, LonLat } from '../map/types'
import { MAX_KM, MIN_KM } from '../lib/doc'
import { ShirtPreview } from './ShirtPreview'

export type Tool = 'draw' | 'pin' | 'move'

interface Props {
  svg: string
  /** The page and the map area the picture was drawn for. */
  picFrame: Frame
  picMap: Frame
  /** The map area the user is looking at now. */
  viewMap: Frame
  tool: Tool
  /** The selected route's points, shown as dots while drawing. They are not exported. */
  points: LonLat[]
  paper: string
  /** What the print is waiting for, shown on a card with a spinner, or null. */
  busy: string | null
  empty: boolean
  view: 'print' | 'shirt'
  onPick: (p: LonLat) => void
  onView: (next: { centerLon: number; centerLat: number; widthKm: number }) => void
}

/** A transform from picture pixels to screen pixels: screen = t + s * picture. */
interface T {
  tx: number
  ty: number
  s: number
}
type P = { x: number; y: number }
const ID: T = { tx: 0, ty: 0, s: 1 }
const compose = (a: T, b: T): T => ({ s: a.s * b.s, tx: a.tx + a.s * b.tx, ty: a.ty + a.s * b.ty })

export function Viewport({ svg, picFrame, picMap, viewMap, tool, points, paper, busy, empty, view, onPick, onView }: Props) {
  const artRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // The gesture in progress, on top of the frame transform.
  const g = useRef<T>({ ...ID })
  const pointers = useRef(new Map<number, P>())
  const drag = useRef<{ x: number; y: number; base: T; moved: boolean } | null>(null)
  const pinch = useRef<{ d: number; mid: P; base: T } | null>(null)
  const wheelTimer = useRef(0)
  const latest = useRef({ picFrame, picMap, viewMap, tool, onPick, onView })
  useEffect(() => {
    latest.current = { picFrame, picMap, viewMap, tool, onPick, onView }
  })

  const rect = () => (artRef.current as HTMLDivElement).getBoundingClientRect()
  /** Millimetres of the page per screen pixel. */
  const mmPerPx = () => latest.current.picFrame.widthMm / Math.max(1, rect().width)

  /** The transform that shows the picture's frame as the frame the user is looking at. */
  const frameT = (): T => {
    if (!artRef.current) return ID
    const { picMap: pm, viewMap: vm } = latest.current
    const k = mmPerPx()
    const s = pm.widthKm / vm.widthKm
    const c = makeProjection(pm).toMm([vm.centerLon, vm.centerLat])
    const cx = pm.widthMm / 2 / k
    const cy = pm.heightMm / 2 / k
    return { s, tx: cx - s * (c[0] / k), ty: cy - s * (c[1] / k) }
  }
  const total = () => compose(g.current, frameT())

  const apply = () => {
    const el = contentRef.current
    if (!el) return
    const t = total()
    const still = Math.abs(t.tx) < 0.01 && Math.abs(t.ty) < 0.01 && Math.abs(t.s - 1) < 1e-6
    el.style.transform = still ? '' : `translate(${t.tx}px,${t.ty}px) scale(${t.s})`
  }
  // Re-apply before the browser paints whenever the picture or the wanted view changes. The latest props
  // are copied first, because this runs before the effect that usually copies them.
  useLayoutEffect(() => {
    latest.current = { picFrame, picMap, viewMap, tool, onPick, onView }
    apply()
  })

  const clampScale = (s: number) => {
    const km = latest.current.viewMap.widthKm
    return Math.min(km / MIN_KM, Math.max(km / MAX_KM, s))
  }
  const rel = (x: number, y: number): P => {
    const r = rect()
    return { x: x - r.left, y: y - r.top }
  }
  const two = (): [P, P] => {
    const v = [...pointers.current.values()]
    return [v[0] as P, v[1] as P]
  }

  /** A screen spot on the artboard as a place on the map, through the transform now shown. */
  const toLonLat = (clientX: number, clientY: number): { at: LonLat; inMap: boolean } => {
    const { picMap: pm } = latest.current
    const k = mmPerPx()
    const t = total()
    const p = rel(clientX, clientY)
    const x = ((p.x - t.tx) / t.s) * k
    const y = ((p.y - t.ty) / t.s) * k
    // Only clicks inside the map area count; the text band below it does nothing.
    const page = rect()
    const onPage = p.x >= 0 && p.x <= page.width && p.y >= 0 && p.y <= (pm.heightMm / k)
    return { at: makeProjection(pm).toLonLat(x, y), inMap: onPage }
  }

  /** Turn the gesture into a new view, then let the frame transform carry it until the redraw comes. */
  const commit = () => {
    const gt = g.current
    if (gt.tx === 0 && gt.ty === 0 && gt.s === 1) return
    const { picMap: pm } = latest.current
    const k = mmPerPx()
    const t = total()
    // The spot now shown at the centre of the map area becomes the new centre.
    const cx = pm.widthMm / 2 / k
    const cy = pm.heightMm / 2 / k
    const [centerLon, centerLat] = makeProjection(pm).toLonLat(((cx - t.tx) / t.s) * k, ((cy - t.ty) / t.s) * k)
    const widthKm = Math.min(MAX_KM, Math.max(MIN_KM, pm.widthKm / t.s))
    // Render the new view at once, so the gesture can be dropped in the same frame without a jump.
    g.current = { ...ID }
    if (drag.current) drag.current.base = { ...ID }
    flushSync(() => latest.current.onView({ centerLon, centerLat, widthKm }))
    apply()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Some browsers refuse capture for a pointer they do not track; the gesture still works without it.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, base: { ...g.current }, moved: false }
    } else if (pointers.current.size === 2) {
      const [a, b] = two()
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: rel((a.x + b.x) / 2, (a.y + b.y) / 2), base: { ...g.current } }
      if (drag.current) drag.current.moved = true
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = two()
      const p = pinch.current
      const scale = clampScale(p.base.s * ((Math.hypot(a.x - b.x, a.y - b.y) || 1) / p.d)) / p.base.s
      const mid = rel((a.x + b.x) / 2, (a.y + b.y) / 2)
      // Zoom about the first midpoint, then follow the midpoint as it moves.
      g.current = { s: p.base.s * scale, tx: mid.x - scale * (p.mid.x - p.base.tx), ty: mid.y - scale * (p.mid.y - p.base.ty) }
      apply()
    } else if (drag.current) {
      const d = drag.current
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true
      if (d.moved) {
        g.current = { s: d.base.s, tx: d.base.tx + dx, ty: d.base.ty + dy }
        apply()
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    if (pinch.current) {
      if (pointers.current.size === 1) {
        // One finger lifted: carry on as a drag from the finger still down, keeping the zoom so far.
        const rest = [...pointers.current.values()][0] as P
        pinch.current = null
        drag.current = { x: rest.x, y: rest.y, base: { ...g.current }, moved: true }
      } else if (pointers.current.size === 0) {
        pinch.current = null
        drag.current = null
        commit()
      }
      return
    }
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) return commit()
    if (latest.current.tool === 'move') return
    const { at, inMap } = toLonLat(e.clientX, e.clientY)
    if (inMap) latest.current.onPick(at)
  }

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 0) {
      drag.current = null
      pinch.current = null
      g.current = { ...ID }
      apply()
    }
  }

  // The wheel listener is added by hand, because React's wheel handlers cannot stop the page from
  // scrolling. It calls the newest handler through a ref.
  const onWheel = useRef<(e: WheelEvent) => void>(() => undefined)
  useEffect(() => {
    onWheel.current = (e: WheelEvent) => {
      e.preventDefault()
      const cur = g.current
      // The zoom limit counts the frame's own zoom too, so it holds however many wheels came before.
      const now = frameT().s * cur.s
      const scale = clampScale(now * Math.exp(-e.deltaY * 0.002)) / now
      const a = rel(e.clientX, e.clientY)
      g.current = { s: cur.s * scale, tx: a.x - (a.x - cur.tx) * scale, ty: a.y - (a.y - cur.ty) * scale }
      apply()
      window.clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(commit, 200)
    }
  })
  useEffect(() => {
    const art = artRef.current
    if (!art) return
    const handler = (e: WheelEvent) => onWheel.current(e)
    art.addEventListener('wheel', handler, { passive: false })
    return () => {
      art.removeEventListener('wheel', handler)
      window.clearTimeout(wheelTimer.current)
    }
  }, [view])

  const html = useMemo(() => ({ __html: svg.slice(Math.max(0, svg.indexOf('<svg'))) }), [svg])
  const dots = useMemo(() => {
    const proj = makeProjection(picMap)
    return points.map((p) => proj.toMm(p))
  }, [points, picMap])
  const r = picFrame.widthMm * 0.006
  const ratio = picFrame.widthMm / picFrame.heightMm

  if (view === 'shirt') {
    return (
      <div className="stage">
        <div className="shirt-wrap">
          <ShirtPreview svg={svg} color={paper} widthMm={picFrame.widthMm} heightMm={picFrame.heightMm} />
        </div>
      </div>
    )
  }

  return (
    <div className="stage">
      <div
        ref={artRef}
        className={`artboard tool-${tool}`}
        style={{ '--ratio': ratio, background: paper } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        role="application"
        aria-label={
          tool === 'draw' ? 'Print preview. Click to add a route point. Drag to move the map.'
            : tool === 'pin' ? 'Print preview. Click to drop a pin. Drag to move the map.'
              : 'Print preview. Drag to move the map, scroll or pinch to zoom.'
        }
      >
        <div ref={contentRef} className="content">
          <div className="art-svg" dangerouslySetInnerHTML={html} />
          <svg className="overlay" viewBox={`0 0 ${picFrame.widthMm} ${picFrame.heightMm}`} aria-hidden="true">
            {tool === 'draw'
              ? dots.map((d, i) => (
                  <circle key={i} cx={d[0]} cy={d[1]} r={i === 0 ? r * 1.4 : r} className={i === 0 ? 'dot first' : 'dot'} strokeWidth={r * 0.45} />
                ))
              : null}
          </svg>
        </div>
        {empty && !busy ? (
          <div className="empty">
            <strong>No map yet</strong>
            <span>Find a place in the Place tab, then download its map.</span>
          </div>
        ) : null}
        {busy ? (
          <div className="empty busy" role="status">
            <span className="spinner" aria-hidden="true" />
            <strong>{busy}</strong>
          </div>
        ) : null}
      </div>
    </div>
  )
}
