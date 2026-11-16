import { describe, expect, it } from 'vitest'
import { buildQuery } from './overpass'
import { placeFromRaw } from './nominatim'
import { parseProject, serializeProject, SCHEMA } from './project'
import { DEFAULT_DETAIL, DEFAULT_FRAME, DEFAULT_STYLE } from './presets'
import { formatUnit, fromMm, toMm } from './units'
import { luminance, printCheck } from './printcheck'
import { LOOKS } from './presets'
import { applyInks, inksFor, INK_ROLES } from '../map/inks'

describe('units', () => {
  it('converts both ways', () => {
    expect(toMm(12, 'in')).toBeCloseTo(304.8, 6)
    expect(fromMm(304.8, 'in')).toBeCloseTo(12, 6)
    expect(toMm(72, 'px')).toBeCloseTo(25.4, 6)
    expect(toMm(72, 'pt')).toBeCloseTo(25.4, 6)
  })
  it('formats with sensible digits', () => {
    expect(formatUnit(304.8, 'in')).toBe('12')
    expect(formatUnit(210, 'mm')).toBe('210')
    expect(formatUnit(25.4, 'px')).toBe('72')
  })
})

describe('project files', () => {
  const shown = { ...DEFAULT_STYLE, layers: { ...DEFAULT_STYLE.layers, buildings: { ...DEFAULT_STYLE.layers.buildings, show: true } } }
  const state = {
    frame: DEFAULT_FRAME, style: shown, detail: DEFAULT_DETAIL,
    routes: [{ id: 'r1', name: 'Loop', color: '#ff0000', dashed: true, route: { points: [[1, 2], [3, 4]] as [number, number][], legs: [[[1, 2], [3, 4]]] as [number, number][][] } }],
    pins: [{ id: 'p1', at: [1, 2] as [number, number], label: 'Start' }],
    buildings: true, unit: 'mm' as const,
  }
  it('round-trips', () => {
    expect(parseProject(serializeProject(state))).toEqual(state)
  })
  it('opens files from before 0.2.0: buildings on if either old setting was, the old dashed setting kept', () => {
    const route = { points: [[1, 2], [3, 4]], legs: [[[1, 2], [3, 4]]] }
    const old = (buildings: boolean, show: boolean, dashed: boolean, routeDashed?: boolean) => parseProject(JSON.stringify({
      schema: SCHEMA, version: 1, buildings,
      style: { ...DEFAULT_STYLE, route: { ...DEFAULT_STYLE.route, dashed }, layers: { ...DEFAULT_STYLE.layers, buildings: { ...DEFAULT_STYLE.layers.buildings, show } } },
      routes: [{ id: 'r1', name: 'A', color: '#ff0000', route, ...(routeDashed === undefined ? {} : { dashed: routeDashed }) }],
    }))
    // Downloaded with buildings but the layer hidden, the way every look left it: now one setting, on.
    const a = old(true, false, false)
    expect([a.buildings, a.style.layers.buildings.show]).toEqual([true, true])
    const b = old(false, true, false)
    expect([b.buildings, b.style.layers.buildings.show]).toEqual([true, true])
    const c = old(false, false, false)
    expect([c.buildings, c.style.layers.buildings.show]).toEqual([false, false])
    // The Look tab's dashed switch reached only routes without their own setting.
    expect(old(false, false, true).routes[0]!.dashed).toBe(true)
    expect(old(false, false, true, false).routes[0]!.dashed).toBe(false)
    expect(old(false, false, false).routes[0]!.dashed).toBe(false)
  })
  it('opens an old file with fewer settings, using defaults', () => {
    const old = JSON.stringify({ schema: SCHEMA, version: 1, frame: { centerLon: 1, centerLat: 2 } })
    const p = parseProject(old)
    expect(p.frame.centerLon).toBe(1)
    expect(p.frame.widthKm).toBe(6)
    expect(p.style.layers.water.show).toBe(true)
    expect(p.routes).toEqual([])
    expect(p.style.text.title).toBe(DEFAULT_STYLE.text.title)
  })
  it('refuses other files and newer versions with plain messages', () => {
    expect(() => parseProject('nope')).toThrow(/not valid JSON/)
    expect(() => parseProject('{"hello":1}')).toThrow(/not a Route Map Studio project/)
    expect(() => parseProject(JSON.stringify({ schema: SCHEMA, version: 99 }))).toThrow(/newer version/)
  })
  it('skips a damaged route or pin instead of failing', () => {
    const bad = JSON.stringify({
      schema: SCHEMA, version: 1,
      routes: [{ name: 'Bad', route: { points: [['x']], legs: [] } }, { name: 'Good', route: { points: [[1, 2]], legs: [] } }],
      pins: [{ at: 'nowhere' }],
    })
    const p = parseProject(bad)
    expect(p.routes.map((r) => r.name)).toEqual(['Good'])
    expect(p.pins).toEqual([])
  })
})

describe('overpass query', () => {
  const b = { west: -75.2, south: 39.9, east: -75.1, north: 40 }
  it('asks for the box in south, west, north, east order', () => {
    expect(buildQuery(b, false)).toContain('(39.900000,-75.200000,40.000000,-75.100000)')
  })
  it('leaves out mapped sidewalks and crossings, which double every street', () => {
    expect(buildQuery(b, false)).toContain('["footway"!~"^(sidewalk|crossing)$"]')
  })
  it('only asks for buildings when told to', () => {
    expect(buildQuery(b, false)).not.toContain('"building"')
    expect(buildQuery(b, true)).toContain('"building"')
  })
})

describe('place search', () => {
  it('turns a bounding box into a map width, capped', () => {
    const p = placeFromRaw({ display_name: 'X', lon: '-75.18', lat: '39.96', boundingbox: ['39.94', '39.99', '-75.2', '-75.15'] })
    expect(p?.widthKm).toBeGreaterThan(3)
    expect(p?.widthKm).toBeLessThan(6)
    const big = placeFromRaw({ display_name: 'State', lon: '-75', lat: '40', boundingbox: ['38', '42', '-80', '-70'] })
    expect(big?.widthKm).toBe(20)
  })
  it('skips results without a position', () => {
    expect(placeFromRaw({ display_name: 'X', lon: 'a', lat: 'b' })).toBeNull()
  })
})

describe('print check', () => {
  const route = { points: [[0, 0], [1, 1]] as [number, number][], legs: [[[0, 0], [1, 1]]] as [number, number][][] }
  const routes = [{ id: 'r1', name: 'Loop', color: '#ffffff', route }]
  const look = (id: string) => LOOKS.find((l) => l.id === id)!.style
  it('measures luminance', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1, 6)
  })
  it('asks for 2 pt lines when light ink goes on a dark shirt', () => {
    const style = { ...look('emblem'), layers: { ...look('emblem').layers, minor: { show: true, color: '#e8ecf2', widthPt: 1.5 } } }
    const c = printCheck(style, routes, [], DEFAULT_FRAME)
    expect(c.warnings.some((w) => w.startsWith('Streets are 1.5 pt') && w.includes('2 pt for light ink on a dark shirt'))).toBe(true)
  })
  it('accepts 1 pt dark lines on a light shirt', () => {
    const c = printCheck(look('one-ink'), [{ ...routes[0]!, color: '#111111' }], [], DEFAULT_FRAME)
    expect(c.warnings).toEqual([])
  })
  it('counts inks, leaving out the shirt colour', () => {
    const one = printCheck(look('one-ink'), [{ ...routes[0]!, color: '#111111' }], [], DEFAULT_FRAME)
    expect(one.inks).toEqual(['#111111'])
    const emblem = printCheck(look('emblem'), routes, [], DEFAULT_FRAME)
    expect(emblem.inks.sort()).toEqual(['#e8ecf2', '#ffffff'])
  })
  it('warns when text gets smaller than 8 pt on a small page', () => {
    const pocket = { ...DEFAULT_FRAME, widthMm: 101.6, heightMm: 101.6 }
    expect(printCheck(look('one-ink'), routes, [], pocket).warnings.some((w) => w.includes('at least 8 pt'))).toBe(true)
    expect(printCheck(look('one-ink'), routes, [], DEFAULT_FRAME).warnings.some((w) => w.includes('8 pt'))).toBe(false)
  })
  it('gives every look a full set of styles that pass on its own shirt', () => {
    for (const l of LOOKS) {
      const c = printCheck(l.style, [{ ...routes[0]!, color: '#ff0000' }], [], DEFAULT_FRAME)
      expect(c.warnings, l.id).toEqual([])
    }
  })
})

describe('ink limit', () => {
  const line = { points: [[0, 0], [1, 1]] as [number, number][], legs: [[[0, 0], [1, 1]]] as [number, number][][] }
  const two = [
    { id: 'r1', name: 'Loop', color: '#ff0000', route: line },
    { id: 'r2', name: 'Hills', color: '#00ff00', route: line },
  ]
  const pins = [{ id: 'p1', at: [0, 0] as [number, number], label: 'Cafe' }]
  const full = (s: (typeof LOOKS)[number]['style']) => ({
    ...s,
    text: { ...s.text, show: true },
    distance: { ...s.distance, markers: true },
    layers: Object.fromEntries(Object.entries(s.layers).map(([k, v]) => [k, { ...v, show: true }])) as typeof s.layers,
  })
  it('holds every look to the chosen number of inks, with two routes, pins, markers and text', () => {
    for (const l of LOOKS) {
      for (const n of [1, 2, 3] as const) {
        const c = printCheck({ ...full(l.style), inkLimit: n }, two, pins, DEFAULT_FRAME)
        expect(c.inks.length, `${l.id} at ${n}`).toBeLessThanOrEqual(n)
      }
    }
  })
  it('leaves the design alone with no limit', () => {
    const s = full(LOOKS[0]!.style)
    expect(applyInks(s, two)).toEqual({ style: s, routes: two })
  })
  it('uses the shirt as the background and knocks the route outline out of it', () => {
    const { style } = applyInks({ ...LOOKS[0]!.style, transparent: false, inkLimit: 2 }, two)
    expect(style.transparent).toBe(true)
    expect(style.route.outlineColor).toBe(LOOKS[0]!.style.shirt)
  })
  it('gives the first route the accent ink', () => {
    const s = { ...LOOKS[1]!.style, inkLimit: 3 as const, inkColors: ['#111111', '#d7ff3a', '#444444'] as [string, string, string] }
    const { routes, style } = applyInks(s, two)
    expect(routes[0]!.color).toBe('#d7ff3a')
    expect(style.layers.minor.color).toBe('#444444')
    expect(style.layers.major.color).toBe('#111111')
    expect(style.text.color).toBe('#111111')
  })
  it('lists the inks in role order', () => {
    expect(inksFor(1, ['#a', '#b', '#c'] as never)).toEqual(['#a'])
    expect(inksFor(2, ['#a', '#b', '#c'] as never)).toEqual(['#c', '#b'])
    expect(inksFor(3, ['#a', '#b', '#c'] as never)).toEqual(['#a', '#b', '#c'])
    expect(INK_ROLES[2]).toHaveLength(2)
  })
})
