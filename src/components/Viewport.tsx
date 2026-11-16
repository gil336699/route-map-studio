// The page preview. It shows the exact SVG that gets exported. Dragging, scrolling or pinching moves the
// map under the page.
//
// The picture on screen was drawn for one frame (`picMap`), while the user may already be looking at a
// newer one (`viewMap`): just after a drag, or while a redraw is on its way. The transform that turns
// the one into the other is worked out from the two frames every time either changes, and a gesture in
// progress is applied on top. So a committed move never jumps back, a new gesture can start before the
// redraw arrives, and clicks are mapped back through the same transform to land where they were made.
//
// In the Draw tool the selected route can be edited right on the map: its points are handles to drag or
// click, a + sits halfway along each stretch, and dragging the line itself makes a detour. While a drag
// is on, the engine works out the new route again and again, and it shows as a dashed line.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { makeProjection } from '../map/geo'
import { canEditLeg, canEditPoint, isLoop, type RouteEdit } from '../map/route'
import type { Frame, LonLat, Route, XY } from '../map/types'
import { MAX_KM, MIN_KM } from '../lib/doc'
import { ShirtPreview } from './ShirtPreview'
import { tip } from './tip'

export type Tool = 'draw' | 'pin' | 'move'

interface Props {
  svg: string
  /** The page and the map area the picture was drawn for. */
  picFrame: Frame
  picMap: Frame
  /** The map area the user is looking at now. */
  viewMap: Frame
  tool: Tool
  /** The selected route, shown with its handles while drawing. Handles are never exported. */
  route: Route | null
  /** The point picked for removing, by its place in the route, or null. */
  selectedPoint: number | null
  onSelectPoint: (i: number | null) => void
  /** A finished drag or a click on a handle: move a point, add a detour, or add a point on the line. */
  onEdit: (op: RouteEdit) => void
  /** The same edit while a drag is on: the route it would make, or null. */
  onPreview: (op: RouteEdit) => Promise<Route | null>
  onRemovePoint: (i: number) => void
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

/** What a press on the map has hold of while drawing: a point, a + or the line itself. */
type Grab =
  | { kind: 'point'; index: number }
  | { kind: 'plus'; leg: number; at: LonLat }
  | { kind: 'line'; leg: number; at: LonLat }

/** Screen sizes of the handles, in pixels: bigger for fingers. */
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const SIZE = coarse ? { point: 8, hit: 22, plus: 7, plusHit: 18, line: 12, minLeg: 64 } : { point: 6, hit: 14, plus: 5.5, plusHit: 12, line: 7, minLeg: 44 }

/** The nearest spot on a line to p, with how far it is. */
function nearestOn(line: XY[], p: XY): { q: XY; d: number } {
  let best = { q: line[0] as XY, d: Infinity }
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as XY, b = line[i] as XY
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
    const q: XY = [a[0] + t * dx, a[1] + t * dy]
    const d = Math.hypot(p[0] - q[0], p[1] - q[1])
    if (d < best.d) best = { q, d }
  }
  return best
}

/** The spot halfway along a line, by length, and the line's length. */
function halfway(line: XY[]): { at: XY; length: number } {
  let length = 0
  for (let i = 1; i < line.length; i++) length += Math.hypot((line[i] as XY)[0] - (line[i - 1] as XY)[0], (line[i] as XY)[1] - (line[i - 1] as XY)[1])
  let walked = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as XY, b = line[i] as XY
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (walked + seg >= length / 2 && seg > 0) {
      const t = (length / 2 - walked) / seg
      return { at: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], length }
    }
    walked += seg
  }
  return { at: (line[0] ?? [0, 0]) as XY, length }
}

export function Viewport({ svg, picFrame, picMap, viewMap, tool, route, selectedPoint, onSelectPoint, onEdit, onPreview, onRemovePoint, paper, busy, empty, view, onPick, onView }: Props) {
  const artRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // The gesture in progress, on top of the frame transform.
  const g = useRef<T>({ ...ID })
  const pointers = useRef(new Map<number, P>())
  const drag = useRef<{ x: number; y: number; base: T; moved: boolean } | null>(null)
  const pinch = useRef<{ d: number; mid: P; base: T } | null>(null)
  const wheelTimer = useRef(0)
  const latest = useRef({ picFrame, picMap, viewMap, tool, onPick, onView, route, selectedPoint, onSelectPoint, onEdit, onPreview })
  useEffect(() => {
    latest.current = { picFrame, picMap, viewMap, tool, onPick, onView, route, selectedPoint, onSelectPoint, onEdit, onPreview }
  })
  // The handle being dragged, where the press started, and the route the drag would make.
  const grab = useRef<{ g: Grab; id: number; x: number; y: number; moved: boolean } | null>(null)
  const [ghost, setGhost] = useState<{ lines: XY[][]; at: XY; base: Route } | null>(null)
  const previewing = useRef<{ busy: boolean; next: RouteEdit | null }>({ busy: false, next: null })
  // The artboard's width on screen, for handles of a steady screen size.
  const [artW, setArtW] = useState(0)
  useEffect(() => {
    const el = artRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // The observer reports the size once when it starts, and again on every change.
    const ro = new ResizeObserver(() => setArtW(el.getBoundingClientRect().width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [view])
  // The selected route on the page, in millimetres, and the handle sizes.
  const drawing = tool === 'draw' && !!route
  const pointsMm = useMemo(() => {
    if (!route) return []
    const proj = makeProjection(picMap)
    return route.points.map((p) => proj.toMm(p))
  }, [route, picMap])
  const legsMm = useMemo(() => {
    if (!route || tool !== 'draw') return []
    const proj = makeProjection(picMap)
    return route.legs.map((l) => l.map((p) => proj.toMm(p)))
  }, [route, picMap, tool])
  // Handle sizes: screen pixels turned into page millimetres at the zoom shown when this was drawn.
  const u = artW > 0 ? (picFrame.widthMm / artW) * (viewMap.widthKm / picMap.widthKm) : picFrame.widthMm * 0.0016
  const loop = !!route && isLoop(route)
  /** Whether a spot is on the map, not off the page or in the text band below it, where no route is drawn. */
  const onMap = (p: XY) => p[0] >= 0 && p[0] <= picMap.widthMm && p[1] >= 0 && p[1] <= picMap.heightMm
  const pluses = useMemo(() => legsMm.map((line, j) => {
    if (!route || !canEditLeg(route, j)) return null
    const m = halfway(line)
    const inside = m.at[0] >= 0 && m.at[0] <= picMap.widthMm && m.at[1] >= 0 && m.at[1] <= picMap.heightMm
    return inside && m.length / u >= SIZE.minLeg ? m.at : null
  }), [legsMm, route, u, picMap])
  const bubbleAt = drawing && selectedPoint !== null ? pointsMm[selectedPoint] : undefined
  const k = artW > 0 ? picFrame.widthMm / artW : 1
  // The dashed preview belongs to the route it was made from: once a new route comes, it is gone.
  const shownGhost = ghost && ghost.base === route ? ghost : null

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
    // The point's bubble keeps its size while the map zooms under it.
    el.style.setProperty('--zoom', String(t.s))
  }
  // Re-apply before the browser paints whenever the picture or the wanted view changes. The latest props
  // are copied first, because this runs before the effect that usually copies them.
  useLayoutEffect(() => {
    latest.current = { picFrame, picMap, viewMap, tool, onPick, onView, route, selectedPoint, onSelectPoint, onEdit, onPreview }
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

  /** A screen spot as a spot on the page, in millimetres, through the transform now shown. */
  const toMmAt = (clientX: number, clientY: number): XY => {
    const k = mmPerPx()
    const t = total()
    const p = rel(clientX, clientY)
    return [((p.x - t.tx) / t.s) * k, ((p.y - t.ty) / t.s) * k]
  }
  /** Millimetres on the page per screen pixel, with the zoom now shown. */
  const mmPerScreenPx = () => mmPerPx() / total().s

  /** What a press at this spot takes hold of while drawing: a handle, the line, or nothing. */
  const grabAt = (target: EventTarget | null, clientX: number, clientY: number): Grab | null => {
    const r = latest.current.route
    if (latest.current.tool !== 'draw' || !r) return null
    const h = (target as Element | null)?.closest?.('[data-handle]') as SVGElement | null
    if (h) {
      const kind = h.getAttribute('data-handle')
      const n = Number(h.getAttribute('data-n'))
      if (kind === 'point') return { kind: 'point', index: n }
      if (kind === 'plus') return { kind: 'plus', leg: n, at: r.legs[n] ? halfwayLonLat(n) : r.points[n] as LonLat }
    }
    // Near the line itself: a drag from here makes a detour. Off the map there is no line to take.
    const p = toMmAt(clientX, clientY)
    const pm = latest.current.picMap
    if (p[0] < 0 || p[0] > pm.widthMm || p[1] < 0 || p[1] > pm.heightMm) return null
    const reach = SIZE.line * mmPerScreenPx()
    let best: { leg: number; q: XY; d: number } | null = null
    legsMm.forEach((line, j) => {
      if (!canEditLeg(r, j) || line.length < 2) return
      const n = nearestOn(line, p)
      if (n.d <= reach && (!best || n.d < best.d)) best = { leg: j, q: n.q, d: n.d }
    })
    const b = best as { leg: number; q: XY; d: number } | null
    return b ? { kind: 'line', leg: b.leg, at: makeProjection(latest.current.picMap).toLonLat(b.q[0], b.q[1]) } : null
  }
  const halfwayLonLat = (j: number): LonLat => {
    const m = halfway(legsMm[j] ?? [])
    return makeProjection(latest.current.picMap).toLonLat(m.at[0], m.at[1])
  }

  /** The edit a drag of this handle to this spot makes. */
  const opFor = (gr: Grab, p: LonLat): RouteEdit => (gr.kind === 'point' ? { kind: 'move', index: gr.index, p } : { kind: 'insert', leg: gr.leg, p })

  /** Show the route a drag would make: straight lines at once, then the engine's route when it comes. */
  const preview = (gr: Grab, at: LonLat) => {
    const r = latest.current.route
    if (!r) return
    const proj = makeProjection(latest.current.picMap)
    const a = proj.toMm(at)
    const ends = gr.kind === 'point'
      ? [r.points[gr.index - 1], r.points[gr.index + 1], isLoop(r) && (gr.index === 0 || gr.index === r.points.length - 1) ? r.points[r.points.length - 2] ?? r.points[1] : undefined]
      : [r.points[gr.leg], r.points[gr.leg + 1]]
    const base = r
    setGhost((gh) => (gh && gh.base === base ? { ...gh, at: a } : { lines: ends.filter((e): e is LonLat => !!e).map((e) => [proj.toMm(e), a]), at: a, base }))
    const op = opFor(gr, at)
    const q = previewing.current
    q.next = op
    if (q.busy) return
    const run = async () => {
      while (q.next) {
        const next = q.next
        q.next = null
        q.busy = true
        const out = await latest.current.onPreview(next)
        q.busy = false
        if (!grab.current || !out) continue
        // Only the legs the edit changes, drawn over the route as it is now.
        const legs = next.kind === 'move'
          ? out.legs.filter((_, j) => j === next.index - 1 || j === next.index || (isLoop(out) && (next.index === 0 || next.index === out.points.length - 1) && (j === 0 || j === out.legs.length - 1)))
          : next.kind === 'insert' ? out.legs.slice(next.leg, next.leg + 2) : []
        const pm = makeProjection(latest.current.picMap)
        const spot = next.kind === 'move' ? out.points[next.index] : next.kind === 'insert' ? out.points[next.leg + 1] : undefined
        setGhost({ lines: legs.map((l) => l.map((p) => pm.toMm(p))), at: spot ? pm.toMm(spot) : a, base: r })
      }
    }
    void run()
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
    // The point's bubble has buttons of its own.
    if ((e.target as Element).closest?.('.point-bubble')) return
    if (grab.current) return
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Some browsers refuse capture for a pointer they do not track; the gesture still works without it.
    }
    if (pointers.current.size === 0) {
      const gr = grabAt(e.target, e.clientX, e.clientY)
      if (gr) {
        grab.current = { g: gr, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
        return
      }
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
    const gr = grab.current
    if (gr) {
      if (e.pointerId !== gr.id) return
      if (!gr.moved && Math.hypot(e.clientX - gr.x, e.clientY - gr.y) > 4) gr.moved = true
      if (gr.moved) preview(gr.g, toLonLat(e.clientX, e.clientY).at)
      return
    }
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
    const gr = grab.current
    if (gr) {
      if (e.pointerId !== gr.id) return
      grab.current = null
      previewing.current.next = null
      const L = latest.current
      if (gr.moved) {
        L.onEdit(opFor(gr.g, toLonLat(e.clientX, e.clientY).at))
        return
      }
      setGhost(null)
      if (gr.g.kind === 'point') L.onSelectPoint(gr.g.index === L.selectedPoint ? null : gr.g.index)
      else if (gr.g.kind === 'plus') L.onEdit({ kind: 'split', leg: gr.g.leg, p: gr.g.at })
      // A click on the line is a click on the map: the next point, as when going back the way you came.
      else if (L.selectedPoint !== null) L.onSelectPoint(null)
      else {
        const { at, inMap } = toLonLat(e.clientX, e.clientY)
        if (inMap) L.onPick(at)
      }
      return
    }
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
    // With a point picked, a click elsewhere only lets it go.
    if (latest.current.tool === 'draw' && latest.current.selectedPoint !== null) return latest.current.onSelectPoint(null)
    const { at, inMap } = toLonLat(e.clientX, e.clientY)
    if (inMap) latest.current.onPick(at)
  }

  const onPointerCancel = (e: React.PointerEvent) => {
    if (grab.current && grab.current.id === e.pointerId) {
      grab.current = null
      previewing.current.next = null
      setGhost(null)
      return
    }
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
          tool === 'draw' ? 'Print preview. Click to add a route point. Drag a point to move it, drag the line to add a detour, click a point to remove it. Drag elsewhere to move the map.'
            : tool === 'pin' ? 'Print preview. Click to drop a pin. Drag to move the map.'
              : 'Print preview. Drag to move the map, scroll or pinch to zoom.'
        }
      >
        <div ref={contentRef} className="content">
          <div className="art-svg" dangerouslySetInnerHTML={html} />
          <svg className="overlay" viewBox={`0 0 ${picFrame.widthMm} ${picFrame.heightMm}`} aria-hidden="true" data-points={drawing && route ? route.points.length : undefined}>
            {drawing && shownGhost ? (
              <g className="ghost">
                {shownGhost.lines.map((l, j) => <polyline key={j} points={l.map((p) => `${p[0]},${p[1]}`).join(' ')} strokeWidth={u * 5} className="ghost-halo" />)}
                {shownGhost.lines.map((l, j) => <polyline key={`d${j}`} points={l.map((p) => `${p[0]},${p[1]}`).join(' ')} strokeWidth={u * 2.5} strokeDasharray={`${u * 6} ${u * 4}`} className="ghost-line" />)}
                <circle cx={shownGhost.at[0]} cy={shownGhost.at[1]} r={u * SIZE.point} className="handle dragging" strokeWidth={u * 2} />
              </g>
            ) : null}
            {drawing
              ? pluses.map((m, j) => (m ? (
                  <g key={`p${j}`} className="plus" data-handle="plus" data-n={j}>
                    <circle cx={m[0]} cy={m[1]} r={u * SIZE.plusHit} className="hit" />
                    <circle cx={m[0]} cy={m[1]} r={u * SIZE.plus} className="plus-dot" strokeWidth={u * 1.2} />
                    <path d={`M${m[0] - u * 2.6} ${m[1]}H${m[0] + u * 2.6}M${m[0]} ${m[1] - u * 2.6}V${m[1] + u * 2.6}`} strokeWidth={u * 1.5} className="plus-mark" />
                  </g>
                ) : null))
              : null}
            {drawing
              ? pointsMm.map((d, i) => {
                  // A loop's finish is its start: one handle for both. Points off the map show no handle.
                  if ((loop && i === pointsMm.length - 1) || !onMap(d)) return null
                  const editable = !!route && canEditPoint(route, i)
                  const sel = i === selectedPoint
                  const cls = `handle${i === 0 ? ' first' : ''}${sel ? ' sel' : ''}${editable ? '' : ' fixed'}`
                  return editable ? (
                    <g key={i} data-handle="point" data-n={i}>
                      <circle cx={d[0]} cy={d[1]} r={u * SIZE.hit} className="hit" />
                      <circle cx={d[0]} cy={d[1]} r={u * (sel ? SIZE.point + 2 : SIZE.point)} className={cls} strokeWidth={u * (sel ? 3 : 2)} />
                    </g>
                  ) : <circle key={i} cx={d[0]} cy={d[1]} r={u * 4} className={cls} strokeWidth={u * 1.5} />
                })
              : null}
          </svg>
          {bubbleAt && route && selectedPoint !== null ? (
            // Above the point, or below it near the top; kept clear of the sides.
            <div className={`glass point-bubble${bubbleAt[1] / k < 64 ? ' below' : ''}`} role="dialog" aria-label={`Point ${selectedPoint + 1}`}
              style={{ left: Math.min(Math.max(bubbleAt[0] / k, 125), Math.max(125, artW - 125)), top: bubbleAt[1] / k }}>
              <span className="pb-title">{selectedPoint === 0 ? (loop ? 'Start and finish' : 'Start') : selectedPoint === route.points.length - 1 ? 'Finish' : `Point ${selectedPoint + 1} of ${route.points.length - (loop ? 1 : 0)}`}</span>
              <button type="button" className="btn danger pb-remove" onClick={() => onRemovePoint(selectedPoint)} {...tip('Take this point out. The route rejoins its neighbours the way they were drawn.', 'Delete')}>Remove point</button>
              <button type="button" className="btn quiet icon pb-close" aria-label="Close" onClick={() => onSelectPoint(null)} {...tip('Keep the point.', 'Esc')}>✕</button>
            </div>
          ) : null}
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
