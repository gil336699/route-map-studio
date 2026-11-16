// Landmarks near a route: the cafés, museums, water fountains and sights a club passes or stops at.
import { simplifyLine } from './simplify'
import type { LonLat, Place, XY } from './types'

const M_PER_DEG_LAT = 110574
const M_PER_DEG_LON = 111320

/** Shortest ground distance in metres from a point to a line. */
export function distanceToLineM(p: LonLat, line: LonLat[]): number {
  const kx = M_PER_DEG_LON * Math.cos((p[1] * Math.PI) / 180)
  const toXY = (q: LonLat): [number, number] => [(q[0] - p[0]) * kx, (q[1] - p[1]) * M_PER_DEG_LAT]
  let best = Infinity
  if (line.length === 1) {
    const [x, y] = toXY(line[0] as LonLat)
    return Math.hypot(x, y)
  }
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = toXY(line[i - 1] as LonLat)
    const [bx, by] = toXY(line[i] as LonLat)
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < best) best = d
  }
  return best
}

export interface NearPlace extends Place {
  distM: number
}

/** A line with points that change it by less than `tolM` metres taken out. A 100,000-point GPS track
 *  shrinks to a few thousand, which is all a distance test needs. */
export function simplifyLonLat(line: LonLat[], tolM: number): LonLat[] {
  if (line.length < 3) return line
  const [lon0, lat0] = line[0] as LonLat
  const kx = M_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180)
  const xy: XY[] = line.map((p) => [(p[0] - lon0) * kx, (p[1] - lat0) * M_PER_DEG_LAT])
  const at = new Map<XY, number>()
  xy.forEach((p, i) => at.set(p, i))
  return simplifyLine(xy, tolM).map((p) => line[at.get(p) as number] as LonLat)
}

/** Places within `maxM` metres of any of the lines, nearest first. */
export function placesNear(places: Place[], lines: LonLat[][], maxM: number): NearPlace[] {
  const drawn = lines.filter((l) => l.length > 0).map((l) => simplifyLonLat(l, 3))
  if (!drawn.length) return []
  // A box round each line, grown by the distance, rules out most places before any measuring.
  const boxes = drawn.map((l) => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    for (const [lon, lat] of l) {
      if (lon < w) w = lon
      if (lon > e) e = lon
      if (lat < s) s = lat
      if (lat > n) n = lat
    }
    const dLat = maxM / M_PER_DEG_LAT
    const dLon = maxM / (M_PER_DEG_LON * Math.max(0.01, Math.cos((((s + n) / 2) * Math.PI) / 180)))
    return { w: w - dLon, s: s - dLat, e: e + dLon, n: n + dLat }
  })
  const out: NearPlace[] = []
  for (const pl of places) {
    let d = Infinity
    drawn.forEach((l, i) => {
      const b = boxes[i] as { w: number; s: number; e: number; n: number }
      if (pl.at[0] < b.w || pl.at[0] > b.e || pl.at[1] < b.s || pl.at[1] > b.n) return
      d = Math.min(d, distanceToLineM(pl.at, l))
    })
    if (d <= maxM) out.push({ ...pl, distM: d })
  }
  return out.sort((a, b) => a.distM - b.distM || a.name.localeCompare(b.name))
}

export const PLACE_ICON = { coffee: 'coffee', museum: 'museum', water: 'water', sight: 'star' } as const
