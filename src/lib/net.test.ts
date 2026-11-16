import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ENDPOINTS, fetchMap } from './overpass'
import { memoryCache } from './mapcache'
import type { OverpassResult, ParsedMap } from '../map/osm'

const box = { west: -75.2, south: 39.9, east: -75.1, north: 40 }
const okJson: OverpassResult = {
  elements: [{ type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [{ lat: 39.95, lon: -75.15 }, { lat: 39.96, lon: -75.15 }] }],
}
const reply = (status: number, body?: unknown) => new Response(body ? JSON.stringify(body) : 'busy', { status })
const hang = (_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
const noWait = async () => undefined

afterEach(() => vi.unstubAllGlobals())

describe('downloading from busy servers', () => {
  it('passes a busy server’s request to the next one, and says so', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return calls.length === 1 ? reply(504) : reply(200, okJson)
    }))
    const news: string[] = []
    const map = await fetchMap(box, false, undefined, { onProgress: (t) => news.push(t), wait: noWait })
    expect(map.features).toHaveLength(1)
    expect(calls).toEqual(ENDPOINTS.slice(0, 2))
    expect(news[0]).toBe('overpass-api.de is busy. Trying overpass.private.coffee…')
  })
  it('gives up on a server that never answers once its time limit passes', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => (++n === 1 ? hang(url, init) : Promise.resolve(reply(200, okJson)))))
    const news: string[] = []
    const map = await fetchMap(box, false, undefined, { timeoutMs: 20, onProgress: (t) => news.push(t), wait: noWait })
    expect(map.features).toHaveLength(1)
    expect(news[0]).toMatch(/is taking too long/)
  })
  it('waits and goes round once more when every server is busy, then says so plainly', async () => {
    const waits: number[] = []
    vi.stubGlobal('fetch', vi.fn(async () => reply(429)))
    await expect(fetchMap(box, false, undefined, { wait: async (ms) => { waits.push(ms) } })).rejects.toThrow(/servers are busy/)
    expect(waits).toEqual([20000])
    expect((fetch as Mock).mock.calls).toHaveLength(ENDPOINTS.length * 2)
  })
  it('stops at once when the user stops it', async () => {
    const ctrl = new AbortController()
    vi.stubGlobal('fetch', vi.fn(hang))
    const p = fetchMap(box, false, ctrl.signal, { wait: noWait })
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect((fetch as Mock).mock.calls).toHaveLength(1)
  })
  it('tries the next server when one sends something unreadable', async () => {
    let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? new Response('<html>oops</html>', { status: 200 }) : reply(200, okJson))))
    expect((await fetchMap(box, false, undefined, { wait: noWait })).features).toHaveLength(1)
  })
})

describe('the browser’s copy of downloaded maps', () => {
  const map = (n: number): ParsedMap => ({ features: [], places: [{ id: String(n), name: `P${n}`, kind: 'coffee', at: [0, 0] }], droppedRings: 0 })
  const inner = { west: -75.16, south: 39.94, east: -75.14, north: 39.96 }
  it('finds the newest copy that covers the box, with the same buildings choice', async () => {
    let t = 1000
    const c = memoryCache(() => t)
    await c.put(box, false, map(1))
    t = 2000
    await c.put({ ...box, west: -75.21 }, false, map(2))
    expect((await c.find(inner, false))?.map).toEqual(map(2))
    expect(await c.find(inner, true)).toBeNull()
    expect(await c.find({ ...inner, west: -75.5 }, false)).toBeNull()
  })
  it('forgets copies older than 30 days', async () => {
    let t = 0
    const c = memoryCache(() => t)
    await c.put(box, false, map(1))
    t = 31 * 86_400_000
    expect(await c.find(inner, false)).toBeNull()
  })
  it('keeps only the five newest', async () => {
    let t = 0
    const c = memoryCache(() => t)
    // Six areas a degree apart, so each copy covers only its own.
    const area = (i: number) => ({ west: i, south: 0, east: i + 0.5, north: 0.5 })
    const inside = (i: number) => ({ west: i + 0.1, south: 0.1, east: i + 0.2, north: 0.2 })
    for (let i = 0; i < 6; i++) {
      t = i * 1000
      await c.put(area(i), false, map(i))
    }
    expect(await c.find(inside(0), false)).toBeNull()
    expect((await c.find(inside(1), false))?.map).toEqual(map(1))
    expect((await c.find(inside(5), false))?.map).toEqual(map(5))
  })
})
