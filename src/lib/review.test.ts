// Tests for the bugs an independent review found in files, downloads and documents.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMap, ENDPOINTS } from './overpass'
import { parseProject, serializeProject, SCHEMA } from './project'
import { memoryCache, type MapCache } from './mapcache'
import { nextRoute, newDoc } from './doc'
import { DEFAULT_DETAIL, DEFAULT_FRAME, DEFAULT_STYLE } from './presets'
import { buildScene } from '../map/scene'
import { createEngine } from '../worker/engine'
import { parseOverpass, type OverpassResult } from '../map/osm'

afterEach(() => vi.unstubAllGlobals())
const box = { west: -75.2, south: 39.9, east: -75.1, north: 40 }
const okJson: OverpassResult = { elements: [{ type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [{ lat: 39.95, lon: -75.15 }, { lat: 39.96, lon: -75.15 }] }] }

/** An answer that sends its start and then nothing more, until the request is stopped. */
function stalling(init: RequestInit): Response {
  return new Response(new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('{"elements":['))
      init.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
    },
  }), { status: 200 })
}

describe('fixed: downloads that stall after their headers', () => {
  it('give up after the time limit and pass to the next server', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => (++n === 1 ? stalling(init) : new Response(JSON.stringify(okJson), { status: 200 }))))
    const news: string[] = []
    const map = await fetchMap(box, false, undefined, { timeoutMs: 50, onProgress: (t) => news.push(t), wait: async () => undefined })
    expect(map.features).toHaveLength(1)
    expect(news[0]).toBe(`${new URL(ENDPOINTS[0] as string).host} is taking too long. Trying ${new URL(ENDPOINTS[1] as string).host}…`)
  })
  it('stop when the user stops them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => stalling(init)))
    const ctrl = new AbortController()
    const p = fetchMap(box, false, ctrl.signal, { timeoutMs: 60_000, wait: async () => undefined })
    setTimeout(() => ctrl.abort(), 30)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('fixed: an old download cannot take over', () => {
  it('a download still saving its copy when a newer one starts is dropped, and Stop still works', async () => {
    let release = () => undefined as void
    const gate = new Promise<void>((r) => { release = r })
    const inner = memoryCache()
    const slowCache: MapCache = { find: inner.find, put: async (...a) => { await gate; return inner.put(...a) } }
    let n = 0
    const engine = createEngine((_b, _x, signal) => {
      n++
      if (n === 1) return Promise.resolve(parseOverpass(okJson))
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError'))))
    }, slowCache)
    const a = engine.handle({ id: 1, type: 'load', bbox: box, buildings: false })
    await new Promise((r) => setTimeout(r, 10))
    const b = engine.handle({ id: 2, type: 'load', bbox: { ...box, west: -75.3 }, buildings: false, fresh: true })
    release()
    expect((await a).type).toBe('cancelled')
    await engine.handle({ id: 3, type: 'cancel' })
    expect((await b).type).toBe('cancelled')
  })
})

describe('fixed: project files', () => {
  it('keep each pin’s icon', () => {
    const doc = newDoc()
    doc.pins = [{ id: 'p', at: [1, 2], label: 'Cafe', icon: 'coffee' }, { id: 'q', at: [1, 2], label: 'HQ', icon: 'flag' }]
    expect(parseProject(serializeProject(doc)).pins.map((p) => p.icon)).toEqual(['coffee', 'flag'])
  })
  it('never trust a damaged or hand-edited file', () => {
    const bad = JSON.stringify({
      schema: SCHEMA, version: 1,
      frame: { centerLon: -75, centerLat: 40, widthKm: 5000, widthMm: -3, heightMm: 'tall' },
      style: { inkLimit: 1, inkColors: ['black', '#fff', '#000'], text: { title: null, color: '#12345' }, layers: { minor: { color: 'red', widthPt: 900 } } },
      routes: [{ id: 'r', name: 7, color: 'blue', route: { points: [[1, 2]], legs: [] } }],
      pins: [{ at: [1, 2], label: 3, icon: 'rocket' }],
    })
    const p = parseProject(bad)
    expect(p.frame.widthKm).toBe(40)
    expect(p.frame.widthMm).toBe(25)
    expect(p.frame.heightMm).toBe(355.6)
    expect(p.style.inkColors).toEqual(DEFAULT_STYLE.inkColors)
    expect(p.style.text.title).toBe(DEFAULT_STYLE.text.title)
    expect(p.style.text.color).toBe(DEFAULT_STYLE.text.color)
    expect(p.style.layers.minor).toEqual({ ...DEFAULT_STYLE.layers.minor, widthPt: 20 })
    expect(p.routes[0]).toMatchObject({ name: 'Route 1', color: '#e4572e' })
    expect(p.pins[0]).toEqual({ id: 'p1', at: [1, 2], label: '' })
    expect(() => buildScene({ features: [], routes: p.routes, pins: p.pins, frame: p.frame, style: p.style, detail: DEFAULT_DETAIL })).not.toThrow()
  })
})

describe('fixed: a new route after a delete', () => {
  it('takes the first free name and a colour no route uses', () => {
    const doc = newDoc()
    const r1 = doc.routes[0]!
    const r2 = nextRoute(doc, 'vintage')
    doc.routes.push(r2)
    const r3 = nextRoute(doc, 'vintage')
    doc.routes.push(r3)
    doc.routes = doc.routes.filter((r) => r.id !== r2.id)
    const again = nextRoute(doc, 'vintage')
    expect(again.name).toBe('Route 2')
    expect(again.color).toBe(r2.color)
    expect(new Set([r1.color, r3.color, again.color]).size).toBe(3)
    expect(DEFAULT_FRAME.widthKm).toBeGreaterThan(0)
  })
})
