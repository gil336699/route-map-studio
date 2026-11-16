// The document the user edits (page, look, routes, pins) and plain helpers for it, kept out of React
// so they can be tested.
import { bboxContains, makeProjection } from '../map/geo'
import { emptyRoute, routeLine } from '../map/route'
import { mapFrame } from '../map/scene'
import type { BBox, Frame, LonLat, RouteItem, Style } from '../map/types'
import { DEFAULT_DETAIL, DEFAULT_FRAME, DEFAULT_STYLE, EXTRA_ROUTE_COLORS, LOOK_ROUTE_COLOR, ONE_INK_LOOKS, type Look } from './presets'
import type { ProjectState } from './project'

export type Doc = ProjectState

export const MIN_KM = 0.2
export const MAX_KM = 40

let counter = 0
/** A short id that is unique within this page. */
export const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`

/** The first route takes the look's route colour; later ones get colours that stand apart. */
export function routeColor(index: number, lookId: string): string {
  if (index === 0 || ONE_INK_LOOKS.has(lookId)) return LOOK_ROUTE_COLOR[lookId] ?? '#e4572e'
  return EXTRA_ROUTE_COLORS[(index - 1) % EXTRA_ROUTE_COLORS.length] as string
}

/** One-ink looks tell their routes apart by dashes, not colours. */
export const routeDashed = (index: number, lookId: string) => index > 0 && ONE_INK_LOOKS.has(lookId)

export function newRoute(index: number, lookId: string): RouteItem {
  return { id: uid('r'), name: `Route ${index + 1}`, color: routeColor(index, lookId), dashed: routeDashed(index, lookId), route: { points: [], legs: [] } }
}

/**
 * The next route for a document: the first free "Route n" name and, unless the look prints in one ink,
 * a colour no route uses yet. Counting routes would repeat a name and colour after a delete.
 */
export function nextRoute(doc: Doc, lookId: string): RouteItem {
  const names = new Set(doc.routes.map((r) => r.name.trim()))
  let n = 1
  while (names.has(`Route ${n}`)) n++
  const index = doc.routes.length
  let color = routeColor(index, lookId)
  if (!ONE_INK_LOOKS.has(lookId)) {
    const used = new Set(doc.routes.map((r) => r.color.toLowerCase()))
    color = [LOOK_ROUTE_COLOR[lookId] ?? '#e4572e', ...EXTRA_ROUTE_COLORS].find((c) => !used.has(c.toLowerCase())) ?? color
  }
  return { id: uid('r'), name: `Route ${n}`, color, dashed: routeDashed(index, lookId), route: emptyRoute() }
}

/** Runners in the United States count in miles; everyone else starts in kilometres. */
export function defaultUnits(language = typeof navigator === 'undefined' ? '' : navigator.language): 'mi' | 'km' {
  return /^en-US$/i.test(language) ? 'mi' : 'km'
}

export function newDoc(): Doc {
  const style = structuredClone(DEFAULT_STYLE)
  style.distance.units = defaultUnits()
  return {
    frame: { ...DEFAULT_FRAME },
    style,
    detail: { ...DEFAULT_DETAIL },
    routes: [newRoute(0, 'vintage')],
    pins: [],
    buildings: false,
    unit: 'in',
  }
}

/** Which look a style came from, by its shirt and background, or '' if it has been changed. */
export function lookIdOf(style: Style, looks: Look[]): string {
  const l = looks.find((x) => x.style.shirt === style.shirt && x.style.layers.major.color === style.layers.major.color)
  return l ? l.id : ''
}

/**
 * Buildings on or off. One setting behind both switches (Place and Look): whether the map downloads
 * buildings and whether the print shows them. Two settings that had to agree showed nothing when they
 * did not, and every look turned the layer off.
 */
export function setBuildings(doc: Doc, on: boolean): Doc {
  const layers = doc.style.layers
  return { ...doc, buildings: on, style: { ...doc.style, layers: { ...layers, buildings: { ...layers.buildings, show: on } } } }
}

/**
 * Apply a look: its colours, frame and layout. The user's own words, distance units, ink limit and
 * buildings stay, and routes are recoloured in order.
 */
export function applyLook(doc: Doc, look: Look): Doc {
  const mine = doc.style
  const lookLayers = structuredClone(look.style.layers)
  const style: Style = {
    ...structuredClone(look.style),
    layers: { ...lookLayers, buildings: { ...lookLayers.buildings, show: doc.buildings } },
    inkLimit: mine.inkLimit,
    legendNames: { ...mine.legendNames },
    distance: { ...look.style.distance, units: mine.distance.units },
    text: {
      ...look.style.text,
      show: mine.text.show,
      title: mine.text.title,
      subtitle: mine.text.subtitle,
      heroValue: mine.text.heroValue,
    },
  }
  return { ...doc, style, routes: doc.routes.map((r, i) => ({ ...r, color: routeColor(i, look.id), dashed: routeDashed(i, look.id) })) }
}

/** The area to download for a page: what it shows, plus a margin so small moves need no new download. */
export function downloadBox(frame: Frame, style: Style, margin = 0.15): BBox {
  return makeProjection(mapFrame(frame, style)).bbox(margin)
}

/** Whether the downloaded map covers everything the page shows. */
export function isCovered(bbox: BBox | null, frame: Frame, style: Style): boolean {
  return !!bbox && bboxContains(bbox, makeProjection(mapFrame(frame, style)).bbox(0))
}

/** Move and zoom the map so all routes fit on the page with a margin. Null when there is nothing to fit. */
export function fitFrame(frame: Frame, style: Style, routes: RouteItem[], margin = 1.25): Frame | null {
  const pts: LonLat[] = routes.flatMap((r) => routeLine(r.route))
  if (pts.length < 2) return null
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const [lon, lat] of pts) {
    minLon = Math.min(minLon, lon)
    maxLon = Math.max(maxLon, lon)
    minLat = Math.min(minLat, lat)
    maxLat = Math.max(maxLat, lat)
  }
  const centerLat = (minLat + maxLat) / 2
  const centerLon = (minLon + maxLon) / 2
  const map = mapFrame(frame, style)
  const aspect = map.widthMm / map.heightMm
  const wKm = (maxLon - minLon) * 111.32 * Math.cos((centerLat * Math.PI) / 180)
  const hKm = (maxLat - minLat) * 110.574
  const widthKm = Math.min(MAX_KM, Math.max(0.3, Math.max(wKm, hKm * aspect) * margin))
  return { ...frame, centerLon, centerLat, widthKm }
}

/** The frame after a drag or zoom: the new centre is a spot on the map shown, in mm, and the zoom factor. */
export function movedFrame(frame: Frame, shown: Frame, centerMm: [number, number], scale: number): Frame {
  const [centerLon, centerLat] = makeProjection(shown).toLonLat(centerMm[0], centerMm[1])
  const widthKm = Math.min(MAX_KM, Math.max(MIN_KM, shown.widthKm / scale))
  return { ...frame, centerLon, centerLat, widthKm }
}
