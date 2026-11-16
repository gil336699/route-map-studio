// The Web Worker that runs the map engine. Requests are handled as they arrive; a new download
// cancels the one before it.
import { indexedDbCache } from '../lib/mapcache'
import { fetchMap } from '../lib/overpass'
import { createEngine } from './engine'
import type { EngineRequest, EngineResponse } from './messages'

const post = (r: EngineResponse) => (self as unknown as Worker).postMessage(r)
const engine = createEngine(fetchMap, indexedDbCache(), (id, text) => post({ id, type: 'progress', text }))

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  post(await engine.handle(e.data))
}
