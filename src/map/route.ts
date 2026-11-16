// Route editing: add a point (straight or along roads), undo, close the loop, import a track, and edit a
// drawn route: remove, move or insert a point anywhere. An edit redraws only the legs beside the point,
// each the way it was made (along the streets, or straight), and never touches an imported track.
import { haversineKm, localDistanceM, pathLengthKm } from './geo'
import { locate, shortestPath, type Graph } from './graph'
import type { LegKind, LonLat, Route } from './types'

export const emptyRoute = (): Route => ({ points: [], legs: [], kinds: [] })

/** How each leg was made. Routes saved before 0.2.0 do not say, so a two-point leg counts as straight. */
export function kindsOf(route: Route): LegKind[] {
  return route.legs.map((leg, i) => route.kinds?.[i] ?? (leg.length === 2 ? 'straight' : 'roads'))
}

export interface AddResult {
  route: Route
  /** Set when something happened the user should know about, such as a straight line being used. */
  note?: string
}

/** Two points closer than this (in metres) are the same point: a double click, say. At shirt scale
 *  one screen pixel is several metres, so this never merges two points anyone meant to be apart. */
export const SAME_M = 3

const OFF_MAP = 'No street or path is within 200 m of that spot, so it joins with a straight line. If the map is missing there, download this view.'

/**
 * Add a point. With a graph, the point snaps onto the connected streets and the new leg follows them.
 * A click farther than SNAP_M from any street (off the downloaded map, say) stays where it was clicked
 * and joins with a straight line. A click on the last point does nothing.
 */
export function addPoint(route: Route, p: LonLat, graph: Graph | null): AddResult {
  const last = route.points[route.points.length - 1]
  const kinds = kindsOf(route)
  if (graph && graph.nodes.length) {
    // The last point is found on the network again, so the new leg starts exactly where it ended.
    const li = last ? locate(graph, last, -1) : -1
    const ni = locate(graph, p, li)
    const onMap = ni >= 0
    const at = onMap ? (graph.nodes[ni] as LonLat) : p
    if (!last) return { route: { points: [at], legs: [], kinds: [] }, note: onMap ? undefined : OFF_MAP }
    if (localDistanceM(at, last) < SAME_M) return { route }
    const add = (leg: LonLat[]): Route => ({ points: [...route.points, at], legs: [...route.legs, leg], kinds: [...kinds, 'roads'] })
    if (onMap && li >= 0) {
      const leg = shortestPath(graph, li, ni)
      if (leg && leg.length > 1) return { route: add(leg), note: detourNote(leg, DRAW_ADVICE) }
      return { route: add([last, at]), note: NOT_JOINED }
    }
    return { route: add([last, at]), note: onMap ? undefined : OFF_MAP }
  }
  if (!last) return { route: { points: [p], legs: [], kinds: [] } }
  if (localDistanceM(p, last) < SAME_M) return { route }
  return { route: { points: [...route.points, p], legs: [...route.legs, [last, p]], kinds: [...kinds, 'straight'] } }
}

const NOT_JOINED = 'No road or path joins those two points in the downloaded map, so they are joined with a straight line.'
const DRAW_ADVICE = 'Press Undo, switch to Straight, and click again.'
const EDIT_ADVICE = 'Press Undo, or drag a point to steer it.'

/**
 * When the map data has no link between two close paths (a missing stair, say), the shortest way along
 * roads can be a long way round. Say so, with the numbers, so the user can draw that bit straight.
 */
export function detourNote(leg: LonLat[], advice = DRAW_ADVICE): string | undefined {
  const along = pathLengthKm(leg) * 1000
  const direct = haversineKm(leg[0] as LonLat, leg[leg.length - 1] as LonLat) * 1000
  if (along > Math.max(direct * 3, direct + 300)) {
    return `That bit goes the long way round: ${Math.round(along)} m along roads for ${Math.round(direct)} m in a straight line. The map may be missing a path. ${advice}`
  }
  return undefined
}

export function undoPoint(route: Route): Route {
  if (route.points.length === 0) return route
  return { points: route.points.slice(0, -1), legs: route.legs.slice(0, -1), kinds: kindsOf(route).slice(0, -1) }
}

/** Whether the route already ends where it starts. */
export function isClosed(route: Route): boolean {
  const line = routeLine(route)
  if (line.length < 3) return false
  return localDistanceM(line[0] as LonLat, line[line.length - 1] as LonLat) < SAME_M
}

/** Whether Close loop can do anything: a line of three or more points that is not closed yet. */
export const canClose = (route: Route) => routeLine(route).length >= 3 && !isClosed(route)

/** Join the last point back to the first. A loop that is already closed stays as it is. */
export function closeLoop(route: Route, graph: Graph | null): AddResult {
  const first = route.points[0]
  if (!first || !canClose(route)) return { route }
  const last = route.points[route.points.length - 1] as LonLat
  const kinds = kindsOf(route)
  const close = (leg: LonLat[], kind: LegKind): Route => ({ points: [...route.points, first], legs: [...route.legs, leg], kinds: [...kinds, kind] })
  if (graph && graph.nodes.length) {
    const fi = locate(graph, first, -1)
    const li = locate(graph, last, fi)
    const leg = fi >= 0 && li >= 0 ? shortestPath(graph, li, fi) : null
    if (leg && leg.length > 1) return { route: close([...leg.slice(0, -1), first], 'roads') }
    return { route: close([last, first], 'roads'), note: 'No road or path joins the end back to the start, so a straight line closes the loop.' }
  }
  return { route: close([last, first], 'straight') }
}

/** A route made from an imported track: one leg holding the whole line, kept exactly as recorded. */
export function routeFromTrack(track: LonLat[]): Route {
  return { points: [track[0] as LonLat, track[track.length - 1] as LonLat], legs: [track], kinds: ['track'] }
}

// ---- Editing a drawn route ----

export interface EditResult {
  route: Route
  /** Something the user should know, such as a leg that had to be drawn straight. */
  note?: string
  /** For an insert: where the new point went in the list of points. */
  index?: number
}

/** Whether the first and last points are the same spot: a loop, whose start is also its finish. */
export function isLoop(route: Route): boolean {
  const n = route.points.length
  return n >= 3 && localDistanceM(route.points[0] as LonLat, route.points[n - 1] as LonLat) < SAME_M
}

/** The legs that meet at point i. A loop's start and finish are one point, so both end legs meet there. */
function legsAt(route: Route, i: number): number[] {
  const n = route.points.length
  const out = new Set<number>()
  const ends = isLoop(route) && (i === 0 || i === n - 1) ? [0, n - 1] : [i]
  for (const k of ends) for (const j of [k - 1, k]) if (j >= 0 && j < route.legs.length) out.add(j)
  return [...out].sort((a, b) => a - b)
}

/** Whether point i can be moved or removed: it was drawn here, and no imported track meets it. */
export function canEditPoint(route: Route, i: number): boolean {
  if (i < 0 || i >= route.points.length) return false
  const kinds = kindsOf(route)
  return legsAt(route, i).every((j) => kinds[j] !== 'track')
}

/** Whether a new point can go on leg i: it was drawn here, not imported. */
export function canEditLeg(route: Route, i: number): boolean {
  const k = kindsOf(route)[i]
  return k !== undefined && k !== 'track'
}

const hasMap = (g: Graph | null): g is Graph => !!g && g.nodes.length > 0

const NO_MAP_YET = 'The map is not here yet, so that stretch is drawn straight for now. Move a point again once the map is in to follow the streets.'

/** A new leg from a to b: along the network for a roads leg where there is a way, else straight. */
function join(a: LonLat, b: LonLat, kind: LegKind, graph: Graph | null): { leg: LonLat[]; note?: string } {
  if (kind === 'roads' && !hasMap(graph)) return { leg: [a, b], note: NO_MAP_YET }
  if (kind === 'roads' && hasMap(graph)) {
    const ai = locate(graph, a, -1)
    const bi = ai >= 0 ? locate(graph, b, ai) : -1
    const path = ai >= 0 && bi >= 0 ? shortestPath(graph, ai, bi) : null
    if (path && path.length > 1) {
      // The ends are the points themselves, so legs meet exactly.
      const leg = [a, ...path.slice(1, -1), b]
      return { leg, note: detourNote(leg, EDIT_ADVICE) }
    }
    if (localDistanceM(a, b) < SAME_M) return { leg: [a, b] }
    return { leg: [a, b], note: ai >= 0 && bi >= 0 ? NOT_JOINED : OFF_MAP }
  }
  return { leg: [a, b] }
}

/** Where a moved or inserted point lands: on the network next to a roads leg, else where it was dropped. */
function landing(p: LonLat, near: LonLat | undefined, roads: boolean, graph: Graph | null): { at: LonLat; note?: string } {
  if (!roads || !hasMap(graph)) return { at: p }
  const from = near ? locate(graph, near, -1) : -1
  const ni = locate(graph, p, from)
  return ni >= 0 ? { at: graph.nodes[ni] as LonLat } : { at: p, note: OFF_MAP }
}

/** Legs that meet where two were taken out: the same kind if both were, else how clicks join points now. */
const merged = (a: LegKind, b: LegKind, mode: LegKind): LegKind => (a === b ? a : mode)

/**
 * Remove point i. Its two legs become one, drawn again between its neighbours: along the streets if both
 * were, straight if both were, and otherwise the way new clicks join points (`mode`). Removing the
 * start of a loop makes the next point the start, and the loop stays closed.
 */
export function removePoint(route: Route, i: number, graph: Graph | null, mode: 'roads' | 'straight'): EditResult {
  if (!canEditPoint(route, i)) return { route }
  const { points, legs } = route
  const kinds = kindsOf(route)
  const n = points.length
  if (n <= 1) return { route: emptyRoute() }
  if (isLoop(route) && (i === 0 || i === n - 1)) {
    const inner = points.slice(1, -1)
    if (inner.length < 2) return { route: { points: inner, legs: [], kinds: [] } }
    const k = merged(kinds[n - 2] as LegKind, kinds[0] as LegKind, mode)
    const closing = join(inner[inner.length - 1] as LonLat, inner[0] as LonLat, k, graph)
    return {
      route: { points: [...inner, inner[0] as LonLat], legs: [...legs.slice(1, -1), closing.leg], kinds: [...kinds.slice(1, -1), k] },
      note: closing.note,
    }
  }
  if (i === 0) return { route: { points: points.slice(1), legs: legs.slice(1), kinds: kinds.slice(1) } }
  if (i === n - 1) return { route: { points: points.slice(0, -1), legs: legs.slice(0, -1), kinds: kinds.slice(0, -1) } }
  const k = merged(kinds[i - 1] as LegKind, kinds[i] as LegKind, mode)
  const leg = join(points[i - 1] as LonLat, points[i + 1] as LonLat, k, graph)
  return {
    route: {
      points: [...points.slice(0, i), ...points.slice(i + 1)],
      legs: [...legs.slice(0, i - 1), leg.leg, ...legs.slice(i + 1)],
      kinds: [...kinds.slice(0, i - 1), k, ...kinds.slice(i + 1)],
    },
    note: leg.note,
  }
}

/**
 * Move point i to p. Only the legs that meet there are drawn again, each the way it was made; next to
 * a roads leg the point lands on the nearest street. Every other leg is left exactly as it was.
 */
export function movePoint(route: Route, i: number, p: LonLat, graph: Graph | null): EditResult {
  if (!canEditPoint(route, i)) return { route }
  const kinds = kindsOf(route)
  const n = route.points.length
  const touching = legsAt(route, i)
  const near = route.points[i - 1] ?? route.points[i + 1]
  const land = landing(p, near, touching.some((j) => kinds[j] === 'roads'), graph)
  const points = route.points.slice()
  points[i] = land.at
  if (isLoop(route) && (i === 0 || i === n - 1)) {
    points[0] = land.at
    points[n - 1] = land.at
  }
  const legs = route.legs.slice()
  let note = land.note
  for (const j of touching) {
    const r = join(points[j] as LonLat, points[j + 1] as LonLat, kinds[j] as LegKind, graph)
    legs[j] = r.leg
    note ??= r.note
  }
  return { route: { points, legs, kinds }, note }
}

/**
 * A new point at p between points j and j + 1: a detour. Leg j becomes two legs through it, each made
 * the way leg j was. Every other leg is left exactly as it was.
 */
export function insertPoint(route: Route, j: number, p: LonLat, graph: Graph | null): EditResult {
  if (!canEditLeg(route, j)) return { route }
  const kinds = kindsOf(route)
  const k = kinds[j] as LegKind
  const a = route.points[j] as LonLat
  const b = route.points[j + 1] as LonLat
  const land = landing(p, a, k === 'roads', graph)
  const first = join(a, land.at, k, graph)
  const second = join(land.at, b, k, graph)
  return {
    route: {
      points: [...route.points.slice(0, j + 1), land.at, ...route.points.slice(j + 1)],
      legs: [...route.legs.slice(0, j), first.leg, second.leg, ...route.legs.slice(j + 1)],
      kinds: [...kinds.slice(0, j), k, k, ...kinds.slice(j + 1)],
    },
    note: land.note ?? first.note ?? second.note,
    index: j + 1,
  }
}

/**
 * A new point on leg j, at the spot on the line nearest p, without changing the line: more detail, so
 * a later drag moves only that part. Returns the route unchanged when the spot is one of the leg's ends.
 */
export function splitLeg(route: Route, j: number, p: LonLat): EditResult {
  if (!canEditLeg(route, j)) return { route }
  const leg = route.legs[j] as LonLat[]
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180)
  const ky = 110574
  let best = { d: Infinity, s: 1, q: leg[0] as LonLat }
  for (let s = 1; s < leg.length; s++) {
    const a = leg[s - 1] as LonLat
    const b = leg[s] as LonLat
    const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < best.d) best = { d, s, q: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] }
  }
  if (localDistanceM(best.q, leg[0] as LonLat) < SAME_M || localDistanceM(best.q, leg[leg.length - 1] as LonLat) < SAME_M) return { route }
  // On a corner of the line, the corner itself is the new point, so the two legs meet exactly there.
  const a = leg[best.s - 1] as LonLat
  const b = leg[best.s] as LonLat
  const q: LonLat = localDistanceM(best.q, a) < 0.01 ? a : localDistanceM(best.q, b) < 0.01 ? b : best.q
  const first = q === a ? leg.slice(0, best.s) : [...leg.slice(0, best.s), q]
  const second = q === b ? leg.slice(best.s) : [q, ...leg.slice(best.s)]
  const kinds = kindsOf(route)
  return {
    route: {
      points: [...route.points.slice(0, j + 1), q, ...route.points.slice(j + 1)],
      legs: [...route.legs.slice(0, j), first, second, ...route.legs.slice(j + 1)],
      kinds: [...kinds.slice(0, j), kinds[j] as LegKind, kinds[j] as LegKind, ...kinds.slice(j + 1)],
    },
    index: j + 1,
  }
}

/** The whole route as one line. */
export function routeLine(route: Route): LonLat[] {
  if (route.legs.length === 0) return route.points.length === 1 ? [route.points[0] as LonLat] : []
  const out: LonLat[] = []
  for (const leg of route.legs) {
    for (let i = out.length === 0 ? 0 : 1; i < leg.length; i++) out.push(leg[i] as LonLat)
  }
  return out
}

/** One edit of a drawn route, as the page asks for it. */
export type RouteEdit =
  | { kind: 'remove'; index: number; mode: 'roads' | 'straight' }
  | { kind: 'move'; index: number; p: LonLat }
  | { kind: 'insert'; leg: number; p: LonLat }
  | { kind: 'split'; leg: number; p: LonLat }

export function editRoute(route: Route, op: RouteEdit, graph: Graph | null): EditResult {
  switch (op.kind) {
    case 'remove': return removePoint(route, op.index, graph, op.mode)
    case 'move': return movePoint(route, op.index, op.p, graph)
    case 'insert': return insertPoint(route, op.leg, op.p, graph)
    case 'split': return splitLeg(route, op.leg, op.p)
  }
}
