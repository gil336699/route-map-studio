// Downloads map data from OpenStreetMap through the public Overpass API, straight from the browser.
import { parseOverpass, type OverpassResult, type ParsedMap } from '../map/osm'
import type { BBox } from '../map/types'

// Public Overpass servers, tried in turn. The main one is often at capacity at busy times of day.
export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const HIGHWAYS =
  'motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|residential|unclassified|living_street|pedestrian|footway|path|cycleway|track|steps'

export function buildQuery(b: BBox, buildings: boolean): string {
  const box = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`
  return (
    `[out:json][timeout:90];(` +
    `way["highway"~"^(${HIGHWAYS})$"]["footway"!~"^(sidewalk|crossing)$"](${box});` +
    `way["railway"="rail"](${box});` +
    `way["waterway"~"^(river|canal|stream|riverbank)$"](${box});` +
    `way["natural"="water"](${box});rel["natural"="water"](${box});` +
    `way["leisure"~"^(park|garden|nature_reserve)$"](${box});rel["leisure"~"^(park|garden|nature_reserve)$"](${box});` +
    (buildings ? `way["building"](${box});` : '') +
    `);out geom;` +
    // Landmarks come back as single points (centres), which is all a pin needs. Parks, bridges and
    // stadiums are only worth a pin with a name.
    `(nwr["amenity"~"^(cafe|drinking_water|toilets|bar|pub|biergarten|restaurant|ice_cream)$"](${box});` +
    `nwr["shop"~"^(coffee|bakery|pastry|ice_cream)$"](${box});nwr["craft"="brewery"](${box});` +
    `nwr["tourism"~"^(museum|attraction|viewpoint)$"](${box});` +
    `nwr["historic"~"^(monument|memorial)$"]["memorial"!="plaque"]["name"](${box});` +
    `nwr["leisure"~"^(park|stadium)$"]["name"](${box});nwr["man_made"="bridge"]["name"](${box});` +
    `nwr["railway"~"^(station|halt)$"](${box}););out center;`
  )
}

export interface FetchOptions {
  /** Longest wait for one server before trying the next. */
  timeoutMs?: number
  /** Pause before a second round when every server was busy. */
  retryAfterMs?: number
  /** Called with a plain message whenever the download changes course. */
  onProgress?: (text: string) => void
  /** Replaced in tests, so a retry does not really wait. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>
}

const host = (url: string) => new URL(url).host

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('stopped', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('stopped', 'AbortError'))
    }, { once: true })
  })
}

type Answer = { status: number; json?: OverpassResult & { remark?: string }; unreadable?: boolean } | 'timeout'

/**
 * One request with its own time limit, covering the whole answer: Overpass often sends its headers
 * at once and the map data much later, so the limit and the user's Stop must last until the body is read.
 */
async function post(url: string, body: URLSearchParams, signal: AbortSignal | undefined, timeoutMs: number): Promise<Answer> {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)
  const stop = () => ctrl.abort()
  signal?.addEventListener('abort', stop, { once: true })
  try {
    const res = await fetch(url, { method: 'POST', body, signal: ctrl.signal })
    if (!res.ok) return { status: res.status }
    try {
      return { status: res.status, json: (await res.json()) as OverpassResult & { remark?: string } }
    } catch (e) {
      if (timedOut) return 'timeout'
      if (signal?.aborted) throw e
      return { status: res.status, unreadable: true }
    }
  } catch (e) {
    if (timedOut) return 'timeout'
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
  }
}

/**
 * Download the map for a box. Each public server gets a time limit; a busy or slow one passes the
 * request to the next. When all are busy, wait and go round once more, as Overpass asks.
 */
export async function fetchMap(b: BBox, buildings: boolean, signal?: AbortSignal, opts: FetchOptions = {}): Promise<ParsedMap> {
  const { timeoutMs = 100_000, retryAfterMs = 20_000, onProgress, wait = sleep } = opts
  const body = new URLSearchParams({ data: buildQuery(b, buildings) })
  let lastError = 'Could not reach OpenStreetMap. Check your internet connection.'
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < ENDPOINTS.length; i++) {
      const url = ENDPOINTS[i] as string
      const next = ENDPOINTS[i + 1]
      const moveOn = (why: string) => {
        if (next) onProgress?.(`${host(url)} ${why}. Trying ${host(next)}…`)
      }
      if (signal?.aborted) throw new DOMException('stopped', 'AbortError')
      let res: Answer
      try {
        res = await post(url, body, signal, timeoutMs)
      } catch (e) {
        if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e
        lastError = 'Could not reach OpenStreetMap. Check your internet connection.'
        moveOn('could not be reached')
        continue
      }
      if (res === 'timeout') {
        lastError = 'The map servers took too long to answer. Make the area smaller, or try again later.'
        moveOn('is taking too long')
        continue
      }
      if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
        lastError = 'The OpenStreetMap servers are busy. Try again in a few minutes, or make the area smaller.'
        moveOn('is busy')
        continue
      }
      if (res.unreadable || !res.json) {
        if (res.status >= 200 && res.status < 300) {
          lastError = 'The map server sent an answer that could not be read.'
          moveOn('sent an unreadable answer')
        } else {
          lastError = `OpenStreetMap answered with an error (${res.status}).`
          moveOn(`answered with an error (${res.status})`)
        }
        continue
      }
      const json = res.json
      if (json.remark && /error|timed out|out of memory/i.test(json.remark)) {
        lastError = 'The area was too big for OpenStreetMap to answer. Make it smaller.'
        moveOn('could not finish the area')
        continue
      }
      // A stop that came while the answer was read wins over the answer.
      if (signal?.aborted) throw new DOMException('stopped', 'AbortError')
      return parseOverpass(json)
    }
    if (round === 0) {
      onProgress?.(`Every map server is busy. Trying again in ${Math.round(retryAfterMs / 1000)} s…`)
      await wait(retryAfterMs, signal)
    }
  }
  throw new Error(lastError)
}
