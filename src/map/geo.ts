// Map projection and distance helpers. A local flat projection is accurate enough for areas up to a few
// tens of km and keeps the maths simple and deterministic.
import type { BBox, Frame, LonLat, XY } from './types'

const M_PER_DEG_LAT = 110574
const M_PER_DEG_LON_EQUATOR = 111320

export interface Projection {
  toMm(p: LonLat): XY
  toLonLat(x: number, y: number): LonLat
  /** Metres on the ground per mm on the page. */
  metresPerMm: number
  /** The area the page shows, grown by `margin` (0.3 = 30% on every side). */
  bbox(margin?: number): BBox
}

export function makeProjection(frame: Frame): Projection {
  const cosLat = Math.cos((frame.centerLat * Math.PI) / 180)
  const metresPerMm = (frame.widthKm * 1000) / frame.widthMm
  const mPerDegLon = M_PER_DEG_LON_EQUATOR * cosLat
  const toMm = (p: LonLat): XY => [
    frame.widthMm / 2 + ((p[0] - frame.centerLon) * mPerDegLon) / metresPerMm,
    frame.heightMm / 2 - ((p[1] - frame.centerLat) * M_PER_DEG_LAT) / metresPerMm,
  ]
  const toLonLat = (x: number, y: number): LonLat => [
    frame.centerLon + ((x - frame.widthMm / 2) * metresPerMm) / mPerDegLon,
    frame.centerLat - ((y - frame.heightMm / 2) * metresPerMm) / M_PER_DEG_LAT,
  ]
  const bbox = (margin = 0): BBox => {
    const mx = frame.widthMm * margin
    const my = frame.heightMm * margin
    const nw = toLonLat(-mx, -my)
    const se = toLonLat(frame.widthMm + mx, frame.heightMm + my)
    return { west: nw[0], north: nw[1], east: se[0], south: se[1] }
  }
  return { toMm, toLonLat, metresPerMm, bbox }
}

export function bboxContains(outer: BBox, inner: BBox, tolerance = 1e-6): boolean {
  return (
    inner.west >= outer.west - tolerance &&
    inner.east <= outer.east + tolerance &&
    inner.south >= outer.south - tolerance &&
    inner.north <= outer.north + tolerance
  )
}

export function haversineKm(a: LonLat, b: LonLat): number {
  const R = 6371.0088
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLon = (b[0] - a[0]) * rad
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pathLengthKm(pts: LonLat[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += haversineKm(pts[i - 1] as LonLat, pts[i] as LonLat)
  return total
}

/** Approximate ground distance in metres between nearby points. Cheap enough to call in a loop. */
export function localDistanceM(a: LonLat, b: LonLat): number {
  const dx = (b[0] - a[0]) * M_PER_DEG_LON_EQUATOR * Math.cos((a[1] * Math.PI) / 180)
  const dy = (b[1] - a[1]) * M_PER_DEG_LAT
  return Math.hypot(dx, dy)
}
