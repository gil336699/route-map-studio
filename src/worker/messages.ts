// Messages between the page and the map engine worker.
import type { PrintCheck } from '../lib/printcheck'
import type { BBox, Detail, Frame, LayerId, LonLat, Pin, Place, Route, RouteItem, SceneStats, Style } from '../map/types'

export type EngineRequest =
  | { id: number; type: 'load'; bbox: BBox; buildings: boolean; fresh?: boolean }
  | { id: number; type: 'cancel' }
  | { id: number; type: 'scene'; frame: Frame; style: Style; detail: Detail; routes: RouteItem[]; pins: Pin[] }
  | { id: number; type: 'add-point'; route: Route; p: LonLat; follow: boolean }
  | { id: number; type: 'close-loop'; route: Route; follow: boolean }
  | { id: number; type: 'route-from-points'; points: LonLat[]; follow: boolean; loop: boolean }

export type EngineResponse =
  | {
      id: number
      type: 'loaded'
      bbox: BBox
      places: Place[]
      counts: Record<LayerId, number>
      droppedRings: number
      nodes: number
      ms: number
      /** When the map came from this browser's copy, when that copy was saved. */
      cachedAt?: number
      /** This map's number: 1 for the first map the engine loads, 2 for the next, and so on. */
      mapId: number
    }
  | { id: number; type: 'cancelled' }
  | {
      id: number
      type: 'scene'
      svg: string
      stats: SceneStats
      check: PrintCheck
      /** The page and the map area this picture was drawn for. */
      frame: Frame
      mapFrame: Frame
      /** The number of the map this picture was drawn from, or 0 if none had been loaded. */
      mapId: number
    }
  | { id: number; type: 'route'; route: Route; note?: string }
  | { id: number; type: 'error'; message: string }
  /** Not an answer: news about a request that is still running. */
  | { id: number; type: 'progress'; text: string }

/** A request without its id, as the page writes it. */
export type EngineCall = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never
