// Tests for the bugs an independent review found. Each one failed on the code before its fix.
import { describe, expect, it } from 'vitest'
import { makeProjection, pathLengthKm } from './geo'
import { buildGraph } from './graph'
import { placesNear, distanceToLineM } from './places'
import { addPoint, canClose, closeLoop, emptyRoute, routeFromTrack } from './route'
import { parseGpx } from './routefile'
import { buildScene, normColor, textWidth } from './scene'
import type { Feature, Frame, LonLat, Pin, Place, RouteItem, Style, XY } from './types'
import { DEFAULT_DETAIL, DEFAULT_STYLE, LOOKS } from '../lib/presets'
import { printCheck } from '../lib/printcheck'

const frame: Frame = { centerLon: 0, centerLat: 0, widthKm: 4, widthMm: 304.8, heightMm: 355.6 }
const proj = makeProjection({ ...frame, heightMm: frame.heightMm * 0.8 })
const at = (x: number, y: number) => proj.toLonLat(x, y)
const look = (id: string) => LOOKS.find((l) => l.id === id)!.style
const build = (style: Style, extra: { features?: Feature[]; routes?: RouteItem[]; pins?: Pin[]; f?: Frame } = {}) =>
  buildScene({ features: extra.features ?? [], routes: extra.routes ?? [], pins: extra.pins ?? [], frame: extra.f ?? frame, style, detail: { ...DEFAULT_DETAIL, minAreaMm2: 0 } })

/** The rings of a path's data, as points, for checking how they wind. */
function rings(d: string): XY[][] {
  return d.split('Z').filter((r) => r.trim()).map((r) => r.replace(/^M/, '').split('L').map((p) => p.trim().split(' ').map(Number) as XY))
}
const winding = (ring: XY[]) => ring.reduce((s, a, i) => { const b = ring[(i + 1) % ring.length] as XY; return s + a[0] * b[1] - b[0] * a[1] }, 0)
const square = (x0: number, y0: number, x1: number, y1: number): LonLat[] => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]

describe('fixed: the SVG is always valid XML', () => {
  it('escapes the big number and drops characters XML forbids', () => {
    const s = look('marathon')
    const svg = build({ ...s, text: { ...s.text, title: 'RUN\u000BCLUB', heroValue: '5 & 10K <' } }, {
      routes: [{ id: 'r', name: 'x', color: '#fff', route: { points: [at(10, 10), at(200, 200)], legs: [[at(10, 10), at(200, 200)]] } }],
    }).svg
    expect(svg).toContain('>5 &amp; 10K &lt;</text>')
    expect(svg).not.toContain('\u000B')
    expect(svg).toContain('>RUNCLUB</text>')
  })
})

describe('fixed: shapes fill the way they look', () => {
  it('keeps a park inside another park filled, and a lake’s island a hole', () => {
    const features: Feature[] = [
      { layer: 'parks', kind: 'area', parts: [square(20, 20, 200, 200)] },
      { layer: 'parks', kind: 'area', parts: [square(60, 60, 120, 120)] },
      { layer: 'water', kind: 'area', parts: [square(210, 20, 290, 100), square(240, 40, 260, 60)] },
    ]
    const svg = build({ ...DEFAULT_STYLE, text: { ...DEFAULT_STYLE.text, show: false }, layers: { ...DEFAULT_STYLE.layers, water: { ...DEFAULT_STYLE.layers.water, outline: false } } }, { features }).svg
    const d = (id: string) => /<g id="${id}"[^>]*fill-rule="nonzero"[^>]*><path d="([^"]+)"/.exec(svg.replace('${id}', id))
    const parks = /<g id="parks"[^>]*fill-rule="nonzero"[^>]*><path d="([^"]+)"/.exec(svg)?.[1] as string
    const water = /<g id="water"[^>]*fill-rule="nonzero"[^>]*><path d="([^"]+)"/.exec(svg)?.[1] as string
    expect(d).toBeTypeOf('function')
    expect(rings(parks).map((r) => Math.sign(winding(r)))).toEqual([1, 1])
    expect(rings(water).map((r) => Math.sign(winding(r))).sort()).toEqual([-1, 1])
  })
  it('cuts river banks at the page edge as lines, so the edge itself is not stroked', () => {
    const s = look('marathon')
    const river: Feature = { layer: 'water', kind: 'area', parts: [square(-50, 150, 360, 170)] }
    const svg = build({ ...s, text: { ...s.text, show: false } }, { features: [river] }).svg
    const water = /<g id="water"[^>]*><path d="([^"]+)"/.exec(svg)?.[1] as string
    expect(water).not.toContain('Z')
    expect(water.match(/M/g)).toHaveLength(2)
  })
})

describe('fixed: text stays on the page and readable', () => {
  const two: RouteItem[] = [
    { id: 'a', name: 'Long run', color: '#f00', route: { points: [at(10, 10), at(280, 10)], legs: [[at(10, 10), at(280, 10)]] } },
    { id: 'b', name: 'Hills', color: '#0f0', route: { points: [at(10, 50), at(280, 50)], legs: [[at(10, 50), at(280, 50)]] } },
  ]
  const size = (svg: string, id: string) => Number(new RegExp(`id="${id}"[^>]*font-size="([0-9.]+)"`).exec(svg)?.[1])
  const content = (svg: string, id: string) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(svg)?.[1] ?? ''
  it('shrinks a long subtitle and stats line to fit', () => {
    const sub = 'Tuesday and Thursday mornings at 6:30 from the Art Museum steps'
    const svg = build({ ...DEFAULT_STYLE, text: { ...DEFAULT_STYLE.text, subtitle: sub } }, { routes: two }).svg
    expect(textWidth(sub, size(svg, 'subtitle')) * 0.85).toBeLessThanOrEqual(304.8 * 0.88 + 0.01)
    expect(textWidth(content(svg, 'stats'), size(svg, 'stats')) * 1.12).toBeLessThanOrEqual(304.8 * 0.88 + 0.01)
  })
  it('keeps the big number to just over half the page, and the title a real size', () => {
    const m = look('marathon')
    const svg = build({ ...m, text: { ...m.text, title: 'RIVER RUN CLUB', heroValue: 'MARATHON' } }, { routes: two }).svg
    expect(textWidth('MARATHON', size(svg, 'hero'))).toBeLessThanOrEqual(304.8 * 0.55 + 0.01)
    expect(size(svg, 'title')).toBeGreaterThan(1)
    const a4 = build({ ...m, text: { ...m.text, heroValue: '42.195', title: 'RIVER RUN CLUB' } }, { routes: two, f: { ...frame, widthMm: 210, heightMm: 297 } }).svg
    expect(size(a4, 'title')).toBeGreaterThan(1)
  })
  it('keeps rows apart on a short page', () => {
    const svg = build({ ...DEFAULT_STYLE, text: { ...DEFAULT_STYLE.text, title: 'RUN CLUB', subtitle: 'Philadelphia' } }, { f: { ...frame, heightMm: 101.6 } }).svg
    expect(size(svg, 'title')).toBeLessThanOrEqual(101.6 * 0.2 * 0.4 + 0.01)
  })
  it('backs the subtitle and stats with the plate, and never draws a plate of negative width', () => {
    const nn = look('night-neon')
    const svg = build({ ...nn, text: { ...nn.text, title: '', subtitle: 'A subtitle with no title above it' } }, { routes: two }).svg
    const plate = /id="text-backing"[^>]*x="([0-9.]+)"[^>]*width="(-?[0-9.]+)"/.exec(svg)
    expect(plate).not.toBeNull()
    expect(Number(plate?.[2])).toBeGreaterThan(0)
    const rc = build({ ...nn, text: { ...nn.text, title: 'RUN CLUB' } }, { routes: two }).svg
    const p2 = /id="text-backing"[^>]*x="([0-9.]+)"[^>]*width="([0-9.]+)"/.exec(rc)
    const statsEnd = 304.8 * 0.06 + textWidth(content(rc, 'stats'), size(rc, 'stats')) * 1.12
    expect(Number(p2?.[1]) + Number(p2?.[2])).toBeGreaterThanOrEqual(statsEnd)
  })
  it('clips pins to a circle frame like the map', () => {
    const svg = build({ ...DEFAULT_STYLE, shape: 'circle' }, { pins: [{ id: 'p', at: at(5, 5), label: 'Corner', icon: 'star' }] }).svg
    expect(svg).toMatch(/<g id="pins" data-name="Pins" clip-path="url\(#map-shape\)">/)
  })
})

describe('fixed: the print check reports what the file prints', () => {
  it('counts exactly the colours written, leaving out the shirt', () => {
    const v = look('vintage')
    const style = { ...v, text: { ...v.text, show: false } }
    const features: Feature[] = [{ layer: 'minor', kind: 'line', hw: 'residential', parts: [[at(10, 10), at(200, 10)]] }]
    const { svg, stats } = build(style, { features })
    const written = new Set([...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,6})"/g)].map((m) => normColor(m[1] as string)))
    written.delete(normColor(style.shirt))
    expect(new Set(stats.inks)).toEqual(written)
    expect(printCheck(style, [], [], frame, stats).inks.sort()).toEqual([...written].sort())
  })
  it('warns about text that had to shrink below 8 pt', () => {
    const pocket: Frame = { ...frame, widthMm: 101.6, heightMm: 101.6 }
    const s = { ...DEFAULT_STYLE, text: { ...DEFAULT_STYLE.text, subtitle: 'A subtitle far too long for a pocket-sized print, really far too long to fit' } }
    const { stats } = build(s, { f: pocket })
    expect(stats.minTextPt).toBeLessThan(8)
    expect(printCheck(s, [], [], pocket, stats).warnings.some((w) => /at least 8 pt/.test(w))).toBe(true)
  })
})

// A small grid of streets near 0,0.
const grid = buildGraph(Array.from({ length: 3 }, (_, i) => [
  { layer: 'minor' as const, kind: 'line' as const, hw: 'residential', parts: [[[0, i * 0.001], [0.001, i * 0.001], [0.002, i * 0.001]]] as LonLat[][] },
  { layer: 'minor' as const, kind: 'line' as const, hw: 'residential', parts: [[[i * 0.001, 0], [i * 0.001, 0.001], [i * 0.001, 0.002]]] as LonLat[][] },
]).flat())

describe('fixed: drawing', () => {
  it('leaves a click far from the downloaded streets where it was clicked', () => {
    const first = addPoint(emptyRoute(), [1, 1], grid)
    expect(first.route.points[0]).toEqual([1, 1])
    expect(first.note).toMatch(/No street or path is within 200 m/)
    const r = addPoint(addPoint(emptyRoute(), [0, 0], grid).route, [1.001, 1], grid)
    expect(r.route.points[1]).toEqual([1.001, 1])
    expect(r.route.legs[0]).toEqual([[0, 0], [1.001, 1]])
  })
  it('ignores a double click instead of adding a zero-length leg', () => {
    const one = addPoint(emptyRoute(), [0.001, 0.001], grid).route
    const again = addPoint(one, [0.00101, 0.001], grid)
    expect(again.route).toBe(one)
    expect(again.note).toBeUndefined()
    const straight = addPoint(addPoint(emptyRoute(), [5, 5], null).route, [5, 5], null)
    expect(straight.route.legs).toHaveLength(0)
  })
  it('leaves a closed loop alone, and can close an imported track', () => {
    let r = emptyRoute()
    for (const p of [[0, 0], [0.002, 0], [0.002, 0.002]] as LonLat[]) r = addPoint(r, p, grid).route
    const closed = closeLoop(r, grid).route
    expect(closeLoop(closed, grid).route).toBe(closed)
    expect(canClose(closed)).toBe(false)
    const track = routeFromTrack([[0, 0], [0.002, 0], [0.002, 0.002]])
    expect(canClose(track)).toBe(true)
    expect(closeLoop(track, null).route.legs).toHaveLength(2)
  })
})

describe('fixed: route files', () => {
  it('reads a GPX holding both a planned route and a recorded track once, as the track', () => {
    const gpx = '<gpx><rte><rtept lat="1" lon="1"/><rtept lat="1.1" lon="1.1"/></rte><trk><trkseg><trkpt lat="2" lon="2"/><trkpt lat="2.1" lon="2.1"/></trkseg></trk></gpx>'
    expect(parseGpx(gpx)).toEqual([[2, 2], [2.1, 2.1]])
  })
  it('refuses a track over the 180° line with a plain message', () => {
    expect(() => parseGpx('<trkpt lat="-16.8" lon="179.99"/><trkpt lat="-16.8" lon="-179.99"/>')).toThrow(/180°/)
  })
})

describe('fixed: landmarks near a long track', () => {
  it('finds the same places on a 100,000-point track, quickly', () => {
    const line: LonLat[] = Array.from({ length: 100_000 }, (_, i) => [i * 0.000001, Math.sin(i / 3000) * 0.001])
    const places: Place[] = Array.from({ length: 300 }, (_, i) => ({ id: String(i), name: `P${i}`, kind: 'coffee', at: [(i / 300) * 0.1, ((i % 7) - 3) * 0.0006] }))
    const t0 = performance.now()
    const near = placesNear(places, [line], 200)
    const ms = performance.now() - t0
    const brute = places.filter((p) => distanceToLineM(p.at, line) <= 200)
    expect(new Set(near.map((p) => p.id))).toEqual(new Set(brute.map((p) => p.id)))
    expect(ms).toBeLessThan(400)
    expect(pathLengthKm(line)).toBeGreaterThan(10)
  })
})
