// Line and polygon clean-up on the page: simplify, clip to the page, measure.
import type { XY } from './types'

/** Douglas-Peucker. Iterative, so a 50,000-point GPS track cannot overflow the stack. */
export function simplifyLine(pts: XY[], tolerance: number): XY[] {
  if (pts.length <= 2 || tolerance <= 0) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  const tol2 = tolerance * tolerance
  while (stack.length) {
    const [lo, hi] = stack.pop() as [number, number]
    const a = pts[lo] as XY
    const b = pts[hi] as XY
    let worst = -1
    let worstD = tol2
    for (let i = lo + 1; i < hi; i++) {
      const d = segDist2(pts[i] as XY, a, b)
      if (d > worstD) {
        worstD = d
        worst = i
      }
    }
    if (worst > 0) {
      keep[worst] = 1
      stack.push([lo, worst], [worst, hi])
    }
  }
  const out: XY[] = []
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i] as XY)
  return out
}

function segDist2(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const ex = a[0] + t * dx - p[0]
  const ey = a[1] + t * dy - p[1]
  return ex * ex + ey * ey
}

export interface Rect {
  w: number
  h: number
}

/** Clip a polyline to the page (Liang-Barsky). A line that leaves and re-enters becomes several pieces. */
export function clipLine(pts: XY[], rect: Rect): XY[][] {
  const out: XY[][] = []
  let cur: XY[] = []
  for (let i = 1; i < pts.length; i++) {
    const seg = clipSegment(pts[i - 1] as XY, pts[i] as XY, rect)
    if (!seg) {
      if (cur.length) out.push(cur)
      cur = []
      continue
    }
    const [a, b, aMoved, bMoved] = seg
    if (cur.length === 0 || aMoved) {
      if (cur.length) out.push(cur)
      cur = [a]
    }
    cur.push(b)
    if (bMoved) {
      out.push(cur)
      cur = []
    }
  }
  if (cur.length > 1) out.push(cur)
  return out.filter((l) => l.length > 1)
}

function clipSegment(a: XY, b: XY, r: Rect): [XY, XY, boolean, boolean] | null {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  let t0 = 0
  let t1 = 1
  const p = [-dx, dx, -dy, dy]
  const q = [a[0], r.w - a[0], a[1], r.h - a[1]]
  for (let i = 0; i < 4; i++) {
    const pi = p[i] as number
    const qi = q[i] as number
    if (pi === 0) {
      if (qi < 0) return null
    } else {
      const t = qi / pi
      if (pi < 0) {
        if (t > t1) return null
        if (t > t0) t0 = t
      } else {
        if (t < t0) return null
        if (t < t1) t1 = t
      }
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
    t0 > 0,
    t1 < 1,
  ]
}

/** Clip a ring to the page (Sutherland-Hodgman). Returns an empty array when nothing is left. */
export function clipRing(ring: XY[], rect: Rect): XY[] {
  let pts = ring.slice()
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (first && last && first[0] === last[0] && first[1] === last[1]) pts.pop()
  const edges: [(p: XY) => boolean, (a: XY, b: XY) => XY][] = [
    [(p) => p[0] >= 0, (a, b) => cross(a, b, 'x', 0)],
    [(p) => p[0] <= rect.w, (a, b) => cross(a, b, 'x', rect.w)],
    [(p) => p[1] >= 0, (a, b) => cross(a, b, 'y', 0)],
    [(p) => p[1] <= rect.h, (a, b) => cross(a, b, 'y', rect.h)],
  ]
  for (const [inside, intersect] of edges) {
    if (pts.length === 0) break
    const next: XY[] = []
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i] as XY
      const prev = pts[(i + pts.length - 1) % pts.length] as XY
      if (inside(cur)) {
        if (!inside(prev)) next.push(intersect(prev, cur))
        next.push(cur)
      } else if (inside(prev)) {
        next.push(intersect(prev, cur))
      }
    }
    pts = next
  }
  return pts.length >= 3 ? pts : []
}

function cross(a: XY, b: XY, axis: 'x' | 'y', at: number): XY {
  if (axis === 'x') {
    const t = (at - a[0]) / (b[0] - a[0])
    return [at, a[1] + t * (b[1] - a[1])]
  }
  const t = (at - a[1]) / (b[1] - a[1])
  return [a[0] + t * (b[0] - a[0]), at]
}

export function lineLength(pts: XY[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    total += Math.hypot((pts[i] as XY)[0] - (pts[i - 1] as XY)[0], (pts[i] as XY)[1] - (pts[i - 1] as XY)[1])
  }
  return total
}

/** Unsigned area of a ring (shoelace). */
export function ringArea(ring: XY[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as XY
    const b = ring[(i + 1) % ring.length] as XY
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}
