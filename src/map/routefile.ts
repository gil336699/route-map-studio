// Reads a route from a GPX or GeoJSON file. Throws an Error with a plain message when the file has no route.
import type { LonLat } from './types'

function validPoint(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

function points(text: string, tagName: 'trkpt' | 'rtept'): LonLat[] {
  const pts: LonLat[] = []
  const tag = new RegExp(`<${tagName}\\b([^>]*)>`, 'gi')
  let m: RegExpExecArray | null
  while ((m = tag.exec(text))) {
    const attrs = m[1] ?? ''
    const lat = /\blat\s*=\s*["']([^"']+)["']/i.exec(attrs)
    const lon = /\blon\s*=\s*["']([^"']+)["']/i.exec(attrs)
    if (!lat || !lon) continue
    const la = Number(lat[1])
    const lo = Number(lon[1])
    if (validPoint(lo, la)) pts.push([lo, la])
  }
  return pts
}

/** Throw a plain message for a line the flat map cannot draw: one that crosses the 180° line. */
function checkDrawable(pts: LonLat[]): LonLat[] {
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs((pts[i] as LonLat)[0] - (pts[i - 1] as LonLat)[0]) > 180) {
      throw new Error('This route crosses the 180° line of longitude, which Route Map Studio cannot draw yet.')
    }
  }
  return pts
}

/**
 * GPX: the recorded track (trkpt) in file order, or the planned route (rtept) when there is no track.
 * A file with both holds the same course twice, so only one is used. Waypoints are ignored.
 */
export function parseGpx(text: string): LonLat[] {
  const track = points(text, 'trkpt')
  const pts = track.length >= 2 ? track : points(text, 'rtept')
  if (pts.length < 2) throw new Error('This GPX file has no track. Export a recorded or planned route, not just waypoints.')
  return checkDrawable(pts)
}

function collectLines(node: unknown, out: LonLat[][]): void {
  if (!node || typeof node !== 'object') return
  const n = node as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown; geometries?: unknown }
  if (n.type === 'LineString' && Array.isArray(n.coordinates)) out.push(toPoints(n.coordinates))
  else if (n.type === 'MultiLineString' && Array.isArray(n.coordinates)) {
    for (const l of n.coordinates) if (Array.isArray(l)) out.push(toPoints(l))
  } else if (n.type === 'Feature') collectLines(n.geometry, out)
  else if (n.type === 'FeatureCollection' && Array.isArray(n.features)) for (const f of n.features) collectLines(f, out)
  else if (n.type === 'GeometryCollection' && Array.isArray(n.geometries)) for (const g of n.geometries) collectLines(g, out)
}

function toPoints(coords: unknown[]): LonLat[] {
  const out: LonLat[] = []
  for (const c of coords) {
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && validPoint(c[0], c[1])) out.push([c[0], c[1]])
  }
  return out
}

/** GeoJSON: all line strings, joined in order. */
export function parseGeoJson(text: string): LonLat[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  const lines: LonLat[][] = []
  collectLines(json, lines)
  const pts = lines.flat()
  if (pts.length < 2) throw new Error('This GeoJSON file has no line. Export the route as a LineString.')
  return checkDrawable(pts)
}

export function parseRouteFile(name: string, text: string): LonLat[] {
  const lower = name.toLowerCase()
  if (lower.endsWith('.gpx')) return parseGpx(text)
  if (lower.endsWith('.json') || lower.endsWith('.geojson')) return parseGeoJson(text)
  if (text.trimStart().startsWith('<')) return parseGpx(text)
  return parseGeoJson(text)
}
