// Turns an Overpass API answer into map features sorted into layers.
import type { Feature, LayerId, LonLat, Place } from './types'

interface Pt {
  lat: number
  lon: number
}
interface OverpassElement {
  type: string
  id?: number
  lat?: number
  lon?: number
  center?: Pt
  tags?: Record<string, string>
  geometry?: Pt[]
  members?: { type: string; role: string; geometry?: Pt[] }[]
}
export interface OverpassResult {
  elements?: OverpassElement[]
}

const MAJOR = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
])
const MINOR = new Set(['residential', 'unclassified', 'living_street'])
const PATH = new Set(['footway', 'path', 'cycleway', 'pedestrian', 'track', 'steps'])
const PARK = new Set(['park', 'garden', 'nature_reserve'])

type Class = { layer: LayerId; kind: 'line' | 'area'; hw?: string }

/** Decide which layer a tagged OSM object belongs to, or null to ignore it. */
export function classify(tags: Record<string, string>, isRelation: boolean): Class | null {
  if (tags.building) return { layer: 'buildings', kind: 'area' }
  if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.landuse === 'reservoir') {
    return { layer: 'water', kind: 'area' }
  }
  if (tags.leisure && PARK.has(tags.leisure)) return { layer: 'parks', kind: 'area' }
  if (isRelation) return null
  const hw = tags.highway
  if (hw) {
    if (MAJOR.has(hw)) return { layer: 'major', kind: 'line', hw }
    if (MINOR.has(hw)) return { layer: 'minor', kind: 'line', hw }
    if (PATH.has(hw)) return { layer: 'paths', kind: 'line', hw }
    return null
  }
  if (tags.railway === 'rail') return { layer: 'railways', kind: 'line' }
  if (tags.waterway === 'river' || tags.waterway === 'canal' || tags.waterway === 'stream') {
    return { layer: 'water', kind: 'line' }
  }
  return null
}

const toLonLat = (g: Pt[]): LonLat[] => g.map((p) => [p.lon, p.lat])
const same = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1]

/** Join ways that share end points into closed rings. Rings that never close are dropped and counted. */
export function stitchRings(ways: LonLat[][]): { rings: LonLat[][]; dropped: number } {
  const pool = ways.filter((w) => w.length > 1).map((w) => w.slice())
  const rings: LonLat[][] = []
  let dropped = 0
  while (pool.length) {
    let cur = pool.pop() as LonLat[]
    let grew = true
    while (grew && !same(cur[0] as LonLat, cur[cur.length - 1] as LonLat)) {
      grew = false
      const end = cur[cur.length - 1] as LonLat
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i] as LonLat[]
        if (same(w[0] as LonLat, end)) {
          cur = cur.concat(w.slice(1))
        } else if (same(w[w.length - 1] as LonLat, end)) {
          cur = cur.concat(w.slice(0, -1).reverse())
        } else continue
        pool.splice(i, 1)
        grew = true
        break
      }
    }
    if (same(cur[0] as LonLat, cur[cur.length - 1] as LonLat) && cur.length >= 4) rings.push(cur)
    else dropped++
  }
  return { rings, dropped }
}

export interface ParsedMap {
  features: Feature[]
  /** Cafés, museums, water fountains and sights, for landmark pins. */
  places: Place[]
  /** Rings of big shapes (such as a river) that were cut off and could not be closed. */
  droppedRings: number
}

/** Which kind of landmark a tagged object is, or null if it is not one. */
export function placeKind(tags: Record<string, string>): Place['kind'] | null {
  if (tags.amenity === 'cafe' || tags.shop === 'coffee') return 'coffee'
  if (tags.tourism === 'museum') return 'museum'
  if (tags.amenity === 'drinking_water') return 'water'
  if (tags.tourism === 'attraction' || tags.tourism === 'viewpoint') return 'sight'
  return null
}

const PLACE_FALLBACK: Record<Place['kind'], string> = { coffee: 'Café', museum: 'Museum', water: 'Water', sight: 'Viewpoint' }

function placePosition(el: OverpassElement): LonLat | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') return [el.lon, el.lat]
  if (el.center) return [el.center.lon, el.center.lat]
  const g = el.geometry
  if (g && g.length) {
    let x = 0
    let y = 0
    for (const p of g) {
      x += p.lon
      y += p.lat
    }
    return [x / g.length, y / g.length]
  }
  return null
}

export function parseOverpass(data: OverpassResult): ParsedMap {
  const features: Feature[] = []
  const places: Place[] = []
  const seen = new Set<string>()
  let droppedRings = 0
  for (const el of data.elements ?? []) {
    const tags = el.tags
    if (!tags) continue
    const kind = placeKind(tags)
    if (kind) {
      // The same museum can come back twice: as a building outline and as a landmark.
      const id = `${el.type}/${el.id ?? places.length}`
      const at = placePosition(el)
      // A sight with no name ("Viewpoint") tells nobody anything, so it is left out.
      const named = !!(tags.name ?? '').trim() || kind !== 'sight'
      if (at && named && !seen.has(id)) {
        seen.add(id)
        places.push({ id, name: (tags.name ?? '').trim() || PLACE_FALLBACK[kind], kind, at })
      }
    }
    if (el.type === 'way' && el.geometry && el.geometry.length > 1) {
      const c = classify(tags, false)
      if (!c) continue
      const pts = toLonLat(el.geometry)
      if (c.kind === 'line') {
        features.push({ layer: c.layer, kind: 'line', parts: [pts], hw: c.hw })
      } else if (pts.length >= 4 && same(pts[0] as LonLat, pts[pts.length - 1] as LonLat)) {
        features.push({ layer: c.layer, kind: 'area', parts: [pts] })
      }
    } else if (el.type === 'relation' && el.members) {
      const c = classify(tags, true)
      if (!c) continue
      const ways = el.members
        .filter((m) => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === 'inner' || m.role === ''))
        .map((m) => toLonLat(m.geometry as Pt[]))
      const { rings, dropped } = stitchRings(ways)
      droppedRings += dropped
      if (rings.length) features.push({ layer: c.layer, kind: 'area', parts: rings })
    }
  }
  return { features, places, droppedRings }
}
