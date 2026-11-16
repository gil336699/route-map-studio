import { describe, expect, it } from 'vitest'
import { createEngine } from './engine'
import { memoryCache } from '../lib/mapcache'
import { parseOverpass, type OverpassResult } from '../map/osm'
import { DEFAULT_DETAIL, DEFAULT_FRAME, DEFAULT_STYLE } from '../lib/presets'
import type { BBox, LonLat } from '../map/types'
import { applyLook, defaultUnits, downloadBox, fitFrame, isCovered, movedFrame, newDoc, setBuildings } from '../lib/doc'
import { LOOKS } from '../lib/presets'
import { makeProjection } from '../map/geo'
import { mapFrame } from '../map/scene'

// A tiny map: a square of streets and a café, near the default page centre.
const c = { lon: DEFAULT_FRAME.centerLon, lat: DEFAULT_FRAME.centerLat }
const d = 0.002
const corner = (i: number, j: number) => ({ lon: c.lon + i * d, lat: c.lat + j * d })
const fixture: OverpassResult = {
  elements: [
    { type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [corner(0, 0), corner(1, 0), corner(1, 1)] },
    { type: 'way', id: 2, tags: { highway: 'residential' }, geometry: [corner(1, 1), corner(0, 1), corner(0, 0)] },
    { type: 'node', id: 3, lat: c.lat + d / 2, lon: c.lon + d / 2, tags: { amenity: 'cafe', name: 'Test Café' } },
  ],
}
const box: BBox = { west: c.lon - 0.01, south: c.lat - 0.01, east: c.lon + 0.01, north: c.lat + 0.01 }

describe('map engine', () => {
  it('downloads, reads and reports a map', async () => {
    const engine = createEngine(async () => parseOverpass(fixture))
    const res = await engine.handle({ id: 1, type: 'load', bbox: box, buildings: false })
    expect(res.type).toBe('loaded')
    if (res.type !== 'loaded') return
    expect(res.counts.minor).toBe(2)
    expect(res.places.map((p) => p.name)).toEqual(['Test Café'])
    expect(res.nodes).toBe(4)
  })
  it('draws the page and checks it for print', async () => {
    const engine = createEngine(async () => parseOverpass(fixture))
    await engine.handle({ id: 1, type: 'load', bbox: box, buildings: false })
    const res = await engine.handle({ id: 2, type: 'scene', frame: DEFAULT_FRAME, style: DEFAULT_STYLE, detail: DEFAULT_DETAIL, routes: [], pins: [] })
    expect(res.type).toBe('scene')
    if (res.type !== 'scene') return
    expect(res.svg).toContain('id="minor"')
    expect(res.check.inks.length).toBeGreaterThan(0)
    expect(res.mapFrame.heightMm).toBeLessThan(DEFAULT_FRAME.heightMm)
  })
  it('follows the streets when asked, and draws straight when not', async () => {
    const engine = createEngine(async () => parseOverpass(fixture))
    await engine.handle({ id: 1, type: 'load', bbox: box, buildings: false })
    const a: LonLat = [corner(0, 0).lon, corner(0, 0).lat]
    const b: LonLat = [corner(1, 1).lon, corner(1, 1).lat]
    const along = await engine.handle({ id: 2, type: 'route-from-points', points: [a, b], follow: true, loop: false })
    const straight = await engine.handle({ id: 3, type: 'route-from-points', points: [a, b], follow: false, loop: false })
    if (along.type !== 'route' || straight.type !== 'route') throw new Error('expected routes')
    expect(along.route.legs[0]).toHaveLength(3)
    expect(straight.route.legs[0]).toHaveLength(2)
  })
  it('passes on a plain message when the download fails', async () => {
    const engine = createEngine(async () => {
      throw new Error('OpenStreetMap is busy.')
    })
    const res = await engine.handle({ id: 1, type: 'load', bbox: box, buildings: false })
    expect(res).toEqual({ id: 1, type: 'error', message: 'OpenStreetMap is busy.' })
  })
  it('opens a saved copy instead of downloading again, unless asked for fresh data', async () => {
    let downloads = 0
    const engine = createEngine(async () => { downloads++; return parseOverpass(fixture) }, memoryCache())
    await engine.handle({ id: 1, type: 'load', bbox: box, buildings: false })
    const again = await engine.handle({ id: 2, type: 'load', bbox: box, buildings: false })
    expect(downloads).toBe(1)
    expect(again.type === 'loaded' && typeof again.cachedAt).toBe('number')
    const fresh = await engine.handle({ id: 3, type: 'load', bbox: box, buildings: false, fresh: true })
    expect(downloads).toBe(2)
    expect(fresh.type === 'loaded' && fresh.cachedAt).toBeUndefined()
  })
  it('passes on news about a download that is still running', async () => {
    const news: [number, string][] = []
    const engine = createEngine(async (_b, _x, _s, opts) => {
      opts?.onProgress?.('overpass-api.de is busy. Trying the next…')
      return parseOverpass(fixture)
    }, memoryCache(), (id, text) => news.push([id, text]))
    await engine.handle({ id: 7, type: 'load', bbox: box, buildings: false })
    expect(news).toEqual([[7, 'overpass-api.de is busy. Trying the next…']])
  })
  it('cancels a download that is still running', async () => {
    const engine = createEngine((_b, _x, signal) => new Promise((_, reject) => {
      signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')))
    }))
    const pending = engine.handle({ id: 1, type: 'load', bbox: box, buildings: false })
    const cancel = await engine.handle({ id: 2, type: 'cancel' })
    expect(cancel.type).toBe('cancelled')
    expect((await pending).type).toBe('cancelled')
  })
  it('numbers each map it loads, and says which map each picture was drawn from', async () => {
    let fail = false
    const engine = createEngine(async () => {
      if (fail) throw new Error('OpenStreetMap is busy.')
      return parseOverpass(fixture)
    }, memoryCache())
    const scene = (id: number) => engine.handle({ id, type: 'scene', frame: DEFAULT_FRAME, style: DEFAULT_STYLE, detail: DEFAULT_DETAIL, routes: [], pins: [] })
    const before = await scene(1)
    expect(before.type === 'scene' && before.mapId).toBe(0)
    const first = await engine.handle({ id: 2, type: 'load', bbox: box, buildings: false })
    expect(first.type === 'loaded' && first.mapId).toBe(1)
    const after = await scene(3)
    expect(after.type === 'scene' && after.mapId).toBe(1)
    // A copy opened from the cache is a new map too; a failed download is not.
    const again = await engine.handle({ id: 4, type: 'load', bbox: box, buildings: false })
    expect(again.type === 'loaded' && again.mapId).toBe(2)
    fail = true
    expect((await engine.handle({ id: 5, type: 'load', bbox: box, buildings: false, fresh: true })).type).toBe('error')
    const still = await scene(6)
    expect(still.type === 'scene' && still.mapId).toBe(2)
  })
})

describe('buildings', () => {
  it('says whether a map came with buildings, from a download or a saved copy', async () => {
    const engine = createEngine(async () => parseOverpass(fixture))
    const plain = await engine.handle({ id: 1, type: 'load', bbox: box, buildings: false })
    expect(plain.type === 'loaded' && plain.buildings).toBe(false)
    const withThem = await engine.handle({ id: 2, type: 'load', bbox: box, buildings: true })
    expect(withThem.type === 'loaded' && withThem.buildings).toBe(true)
    const copy = await engine.handle({ id: 3, type: 'load', bbox: box, buildings: true })
    expect(copy.type === 'loaded' && !!copy.cachedAt && copy.buildings).toBe(true)
  })
  it('are one setting: downloaded and shown together, and a look keeps them', () => {
    const on = setBuildings(newDoc(), true)
    expect([on.buildings, on.style.layers.buildings.show]).toEqual([true, true])
    for (const look of LOOKS) {
      const kept = applyLook(on, look)
      expect([look.id, kept.buildings, kept.style.layers.buildings.show]).toEqual([look.id, true, true])
      expect(kept.style.layers.buildings.color).toBe(look.style.layers.buildings.color)
    }
    const off = setBuildings(on, false)
    expect([off.buildings, off.style.layers.buildings.show]).toEqual([false, false])
    expect(applyLook(off, LOOKS[0]!).style.layers.buildings.show).toBe(false)
  })
})

describe('document helpers', () => {
  it('starts in miles for US English and kilometres elsewhere', () => {
    expect(defaultUnits('en-US')).toBe('mi')
    expect(defaultUnits('en-GB')).toBe('km')
    expect(defaultUnits('de-DE')).toBe('km')
    expect(defaultUnits('')).toBe('km')
  })
  it('starts with one empty route and the Vintage look', () => {
    const doc = newDoc()
    expect(doc.routes).toHaveLength(1)
    expect(doc.style.shirt).toBe(DEFAULT_STYLE.shirt)
  })
  it('applies a look but keeps the words, units and ink limit', () => {
    const doc = newDoc()
    doc.style.text.title = 'RIVER RUN CLUB'
    doc.style.distance.units = 'mi'
    doc.style.inkLimit = 2
    doc.routes.push({ ...doc.routes[0]!, id: 'b' })
    const out = applyLook(doc, LOOKS.find((l) => l.id === 'marathon')!)
    expect(out.style.shirt).toBe('#c8102e')
    expect(out.style.text.title).toBe('RIVER RUN CLUB')
    expect(out.style.text.hero).toBe(true)
    expect(out.style.distance.units).toBe('mi')
    expect(out.style.inkLimit).toBe(2)
    // A one-ink look keeps every route in its ink and dashes the second.
    expect(out.routes[0]!.color).toBe('#ffffff')
    expect(out.routes[1]!.color).toBe('#ffffff')
    expect(out.routes[1]!.dashed).toBe(true)
    expect(out.routes[0]!.dashed).toBe(false)
    const colourful = applyLook(out, LOOKS.find((l) => l.id === 'city-blue')!)
    expect(colourful.routes[1]!.color).not.toBe(colourful.routes[0]!.color)
    expect(colourful.routes[1]!.dashed).toBe(false)
  })
  it('downloads a little more than the page shows, and knows when the page leaves it', () => {
    const box2 = downloadBox(DEFAULT_FRAME, DEFAULT_STYLE)
    expect(isCovered(box2, DEFAULT_FRAME, DEFAULT_STYLE)).toBe(true)
    expect(isCovered(box2, { ...DEFAULT_FRAME, widthKm: DEFAULT_FRAME.widthKm * 1.5 }, DEFAULT_STYLE)).toBe(false)
    expect(isCovered(null, DEFAULT_FRAME, DEFAULT_STYLE)).toBe(false)
  })
  it('fits the page to the routes', () => {
    const doc = newDoc()
    const line: LonLat[] = [[-75.19, 39.95], [-75.18, 39.97]]
    const routes = [{ ...doc.routes[0]!, route: { points: [line[0]!, line[1]!], legs: [line] } }]
    const f = fitFrame(doc.frame, doc.style, routes)!
    expect(f.centerLon).toBeCloseTo(-75.185, 6)
    expect(f.centerLat).toBeCloseTo(39.96, 6)
    const shown = makeProjection(mapFrame(f, doc.style)).bbox(0)
    expect(shown.south).toBeLessThan(39.95)
    expect(shown.north).toBeGreaterThan(39.97)
    expect(fitFrame(doc.frame, doc.style, [doc.routes[0]!])).toBeNull()
  })
  it('turns a drag and zoom into a new centre and width, within limits', () => {
    const f = DEFAULT_FRAME
    const moved = movedFrame(f, f, [f.widthMm / 2 + 10, f.heightMm / 2], 2)
    expect(moved.centerLon).toBeGreaterThan(f.centerLon)
    expect(moved.widthKm).toBeCloseTo(f.widthKm / 2, 9)
    expect(movedFrame(f, f, [0, 0], 1000).widthKm).toBe(0.2)
  })
})
