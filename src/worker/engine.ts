// The map engine behind a message interface. In the app it runs in a Web Worker, so downloading and
// reading a city's worth of map data, routing and drawing never freeze the page. Tests call it directly.
import { memoryCache, type MapCache } from '../lib/mapcache'
import { fetchMap, type FetchOptions } from '../lib/overpass'
import { printCheck } from '../lib/printcheck'
import { buildGraph, type Graph } from '../map/graph'
import type { ParsedMap } from '../map/osm'
import { addPoint, closeLoop, emptyRoute } from '../map/route'
import { buildScene, mapFrame } from '../map/scene'
import { LAYER_ORDER, type BBox, type Feature, type LayerId } from '../map/types'
import type { EngineRequest, EngineResponse } from './messages'

export type Fetcher = (b: BBox, buildings: boolean, signal?: AbortSignal, opts?: FetchOptions) => Promise<ParsedMap>

function countLayers(features: Feature[]): Record<LayerId, number> {
  const counts = {} as Record<LayerId, number>
  for (const id of LAYER_ORDER) counts[id] = 0
  for (const f of features) counts[f.layer] += 1
  return counts
}

export function createEngine(fetcher: Fetcher = fetchMap, cache: MapCache = memoryCache(), progress: (id: number, text: string) => void = () => undefined) {
  let features: Feature[] = []
  let graph: Graph | null = null
  let loading: AbortController | null = null
  const graphFor = (follow: boolean) => (follow && graph && graph.nodes.length ? graph : null)

  async function handle(req: EngineRequest): Promise<EngineResponse> {
    try {
      switch (req.type) {
        case 'load': {
          loading?.abort()
          const ctrl = new AbortController()
          loading = ctrl
          const t0 = performance.now()
          const copy = req.fresh ? null : await cache.find(req.bbox, req.buildings)
          // A stop can arrive while the saved copy is being looked up.
          if (ctrl.signal.aborted) return { id: req.id, type: 'cancelled' }
          const map = copy ? copy.map : await fetcher(req.bbox, req.buildings, ctrl.signal, { onProgress: (text) => progress(req.id, text) })
          if (ctrl.signal.aborted) return { id: req.id, type: 'cancelled' }
          if (!copy) await cache.put(req.bbox, req.buildings, map)
          // A newer download or a stop can arrive while the copy is saved; then this one must not take over.
          if (ctrl.signal.aborted) return { id: req.id, type: 'cancelled' }
          features = map.features
          graph = buildGraph(features)
          if (loading === ctrl) loading = null
          return {
            id: req.id, type: 'loaded', bbox: copy ? copy.bbox : req.bbox, places: map.places, counts: countLayers(features),
            droppedRings: map.droppedRings, nodes: graph.nodes.length, ms: performance.now() - t0,
            ...(copy ? { cachedAt: copy.savedAt } : {}),
          }
        }
        case 'cancel':
          loading?.abort()
          loading = null
          return { id: req.id, type: 'cancelled' }
        case 'scene': {
          const scene = buildScene({ features, routes: req.routes, pins: req.pins, frame: req.frame, style: req.style, detail: req.detail })
          const check = printCheck(req.style, req.routes, req.pins, req.frame, scene.stats)
          return { id: req.id, type: 'scene', svg: scene.svg, stats: scene.stats, check, frame: req.frame, mapFrame: mapFrame(req.frame, req.style) }
        }
        case 'add-point': {
          const r = addPoint(req.route, req.p, graphFor(req.follow))
          return { id: req.id, type: 'route', route: r.route, note: r.note }
        }
        case 'close-loop': {
          const r = closeLoop(req.route, graphFor(req.follow))
          return { id: req.id, type: 'route', route: r.route, note: r.note }
        }
        case 'route-from-points': {
          let r = emptyRoute()
          for (const p of req.points) r = addPoint(r, p, graphFor(req.follow)).route
          if (req.loop) r = closeLoop(r, graphFor(req.follow)).route
          return { id: req.id, type: 'route', route: r }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return { id: req.id, type: 'cancelled' }
      return { id: req.id, type: 'error', message: e instanceof Error ? e.message : String(e) }
    }
  }
  return { handle }
}
