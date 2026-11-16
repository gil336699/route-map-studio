// Route editing: add a point (straight or along roads), undo, close the loop, import a track.
import { haversineKm, localDistanceM, pathLengthKm } from './geo'
import { locate, shortestPath, type Graph } from './graph'
import type { LonLat, Route } from './types'

export const emptyRoute = (): Route => ({ points: [], legs: [] })

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
  if (graph && graph.nodes.length) {
    // The last point is found on the network again, so the new leg starts exactly where it ended.
    const li = last ? locate(graph, last, -1) : -1
    const ni = locate(graph, p, li)
    const onMap = ni >= 0
    const at = onMap ? (graph.nodes[ni] as LonLat) : p
    if (!last) return { route: { points: [at], legs: [] }, note: onMap ? undefined : OFF_MAP }
    if (localDistanceM(at, last) < SAME_M) return { route }
    if (onMap && li >= 0) {
      const leg = shortestPath(graph, li, ni)
      if (leg && leg.length > 1) {
        return { route: { points: [...route.points, at], legs: [...route.legs, leg] }, note: detourNote(leg) }
      }
      return {
        route: { points: [...route.points, at], legs: [...route.legs, [last, at]] },
        note: 'No road or path joins those two points in the downloaded map, so they are joined with a straight line.',
      }
    }
    return { route: { points: [...route.points, at], legs: [...route.legs, [last, at]] }, note: onMap ? undefined : OFF_MAP }
  }
  if (!last) return { route: { points: [p], legs: [] } }
  if (localDistanceM(p, last) < SAME_M) return { route }
  return { route: { points: [...route.points, p], legs: [...route.legs, [last, p]] } }
}

/**
 * When the map data has no link between two close paths (a missing stair, say), the shortest way along
 * roads can be a long way round. Say so, with the numbers, so the user can draw that bit straight.
 */
export function detourNote(leg: LonLat[]): string | undefined {
  const along = pathLengthKm(leg) * 1000
  const direct = haversineKm(leg[0] as LonLat, leg[leg.length - 1] as LonLat) * 1000
  if (along > Math.max(direct * 3, direct + 300)) {
    return `That bit goes the long way round: ${Math.round(along)} m along roads for ${Math.round(direct)} m in a straight line. The map may be missing a path. Press Undo, switch to Straight, and click again.`
  }
  return undefined
}

export function undoPoint(route: Route): Route {
  if (route.points.length === 0) return route
  return { points: route.points.slice(0, -1), legs: route.legs.slice(0, -1) }
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
  if (graph && graph.nodes.length) {
    const fi = locate(graph, first, -1)
    const li = locate(graph, last, fi)
    const leg = fi >= 0 && li >= 0 ? shortestPath(graph, li, fi) : null
    if (leg && leg.length > 1) return { route: { points: [...route.points, first], legs: [...route.legs, [...leg.slice(0, -1), first]] } }
    return {
      route: { points: [...route.points, first], legs: [...route.legs, [last, first]] },
      note: 'No road or path joins the end back to the start, so a straight line closes the loop.',
    }
  }
  return { route: { points: [...route.points, first], legs: [...route.legs, [last, first]] } }
}

/** A route made from an imported track: one leg holding the whole line. */
export function routeFromTrack(track: LonLat[]): Route {
  return { points: [track[0] as LonLat, track[track.length - 1] as LonLat], legs: [track] }
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
