import { describe, expect, it } from 'vitest'
import { bboxContains, haversineKm, makeProjection, pathLengthKm } from './geo'
import { buildGraph, nearestNode, shortestPath } from './graph'
import { classify, parseOverpass, placeKind, stitchRings } from './osm'
import { distanceToLineM, placesNear } from './places'
import { buildQuery } from '../lib/overpass'
import { addPoint, closeLoop, routeFromTrack, routeLine, undoPoint, emptyRoute } from './route'
import { parseGeoJson, parseGpx, parseRouteFile } from './routefile'
import { BAND, buildScene, formatDistance, mapFrame, placeLabel, pointsAlong, safeColor, textSizes, textWidth } from './scene'
import { clipLine, clipRing, lineLength, ringArea, simplifyLine } from './simplify'
import type { Feature, Frame, LonLat, Pin, RouteItem, Style, XY } from './types'
import { DEFAULT_DETAIL, DEFAULT_STYLE, LOOKS } from '../lib/presets'

const frame: Frame = { centerLon: -75.18, centerLat: 39.96, widthKm: 4, widthMm: 200, heightMm: 250 }

describe('projection', () => {
  const proj = makeProjection(frame)
  it('puts the centre in the middle of the page', () => {
    const [x, y] = proj.toMm([frame.centerLon, frame.centerLat])
    expect(x).toBeCloseTo(100, 6)
    expect(y).toBeCloseTo(125, 6)
  })
  it('round-trips a point', () => {
    const p: LonLat = [-75.17, 39.97]
    const [x, y] = proj.toMm(p)
    const back = proj.toLonLat(x, y)
    expect(back[0]).toBeCloseTo(p[0], 9)
    expect(back[1]).toBeCloseTo(p[1], 9)
  })
  it('puts north at the top of the page', () => {
    expect(proj.toMm([frame.centerLon, frame.centerLat + 0.01])[1]).toBeLessThan(125)
  })
  it('shows the requested width on the ground', () => {
    const [w, e] = [proj.toLonLat(0, 0), proj.toLonLat(200, 0)]
    expect(haversineKm(w, e)).toBeCloseTo(4, 1)
  })
  it('bbox grows with margin and contains the page area', () => {
    expect(bboxContains(proj.bbox(0.3), proj.bbox(0))).toBe(true)
    expect(bboxContains(proj.bbox(0), proj.bbox(0.3))).toBe(false)
  })
  it('measures distance', () => {
    expect(pathLengthKm([[0, 0], [0, 1]])).toBeCloseTo(111.19, 1)
  })
})

describe('simplify and clip', () => {
  it('removes points on a straight line but keeps corners', () => {
    const out = simplifyLine([[0, 0], [1, 0.001], [2, 0], [2, 5]], 0.05)
    expect(out).toEqual([[0, 0], [2, 0], [2, 5]])
  })
  it('does not overflow the stack on a long track', () => {
    const pts: XY[] = Array.from({ length: 60000 }, (_, i) => [i, Math.sin(i / 50) * 10])
    expect(simplifyLine(pts, 0.1).length).toBeGreaterThan(100)
  })
  it('splits a line that leaves and re-enters the page', () => {
    const pieces = clipLine([[-5, 5], [15, 5], [15, 8], [-5, 8]], { w: 10, h: 10 })
    expect(pieces).toHaveLength(2)
    expect(pieces[0]).toEqual([[0, 5], [10, 5]])
  })
  it('drops a line fully outside', () => {
    expect(clipLine([[20, 20], [30, 30]], { w: 10, h: 10 })).toEqual([])
  })
  it('clips a ring to the page', () => {
    const ring = clipRing([[-5, -5], [5, -5], [5, 5], [-5, 5]], { w: 10, h: 10 })
    expect(ringArea(ring)).toBeCloseTo(25, 6)
  })
  it('measures length and area', () => {
    expect(lineLength([[0, 0], [3, 4]])).toBe(5)
    expect(ringArea([[0, 0], [4, 0], [4, 3], [0, 3]])).toBe(12)
  })
})

const way = (tags: Record<string, string>, pts: LonLat[]) => ({
  type: 'way',
  tags,
  geometry: pts.map(([lon, lat]) => ({ lon, lat })),
})

describe('OSM parsing', () => {
  it('sorts tags into layers', () => {
    expect(classify({ highway: 'primary' }, false)?.layer).toBe('major')
    expect(classify({ highway: 'residential' }, false)?.layer).toBe('minor')
    expect(classify({ highway: 'footway' }, false)?.layer).toBe('paths')
    expect(classify({ highway: 'service' }, false)).toBeNull()
    expect(classify({ natural: 'water' }, true)?.layer).toBe('water')
    expect(classify({ highway: 'primary' }, true)).toBeNull()
    expect(classify({ waterway: 'river' }, false)).toEqual({ layer: 'water', kind: 'line' })
  })
  it('joins split ways into one ring and drops rings that never close', () => {
    const a: LonLat[] = [[0, 0], [1, 0], [1, 1]]
    const b: LonLat[] = [[0, 0], [0, 1], [1, 1]] // meets a at both ends, one reversed
    const { rings, dropped } = stitchRings([a, b])
    expect(dropped).toBe(0)
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(5)
    expect(stitchRings([[[0, 0], [1, 1]]]).dropped).toBe(1)
  })
  it('reads ways and relations', () => {
    const sq: LonLat[] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    const out = parseOverpass({
      elements: [
        way({ highway: 'residential' }, [[0, 0], [1, 1]]),
        way({ building: 'yes' }, sq),
        way({ leisure: 'park' }, [[0, 0], [1, 1], [2, 2]]), // not closed: ignored
        {
          type: 'relation',
          tags: { natural: 'water' },
          members: [
            { type: 'way', role: 'outer', geometry: [{ lon: 0, lat: 0 }, { lon: 1, lat: 0 }, { lon: 1, lat: 1 }] },
            { type: 'way', role: 'outer', geometry: [{ lon: 1, lat: 1 }, { lon: 0, lat: 1 }, { lon: 0, lat: 0 }] },
          ],
        },
      ],
    })
    expect(out.features.map((f) => f.layer).sort()).toEqual(['buildings', 'minor', 'water'])
    expect(out.droppedRings).toBe(0)
  })
})

// A 3 x 3 grid of streets, one lon/lat degree-thousandth apart, plus an island road with no connection.
const gridFeatures = (): Feature[] => {
  const f: Feature[] = []
  for (let i = 0; i < 3; i++) {
    f.push({ layer: 'minor', kind: 'line', hw: 'residential', parts: [[[0, i * 0.001], [0.001, i * 0.001], [0.002, i * 0.001]]] })
    f.push({ layer: 'minor', kind: 'line', hw: 'residential', parts: [[[i * 0.001, 0], [i * 0.001, 0.001], [i * 0.001, 0.002]]] })
  }
  f.push({ layer: 'minor', kind: 'line', hw: 'residential', parts: [[[0.01, 0.01], [0.011, 0.01]]] })
  f.push({ layer: 'major', kind: 'line', hw: 'motorway', parts: [[[0, 0], [0.002, 0.002]]] })
  return f
}

describe('routing along roads', () => {
  const g = buildGraph(gridFeatures())
  it('finds the shortest way along the grid', () => {
    const path = shortestPath(g, nearestNode(g, [0, 0]), nearestNode(g, [0.002, 0.002])) as LonLat[]
    expect(path[0]).toEqual([0, 0])
    expect(path[path.length - 1]).toEqual([0.002, 0.002])
    // Every step is along a street, so the path cannot cut the diagonal.
    expect(pathLengthKm(path)).toBeGreaterThan(0.4)
    expect(path).toHaveLength(5)
  })
  it('keeps motorways out of the graph', () => {
    const withoutMotorway = buildGraph(gridFeatures().filter((f) => f.hw !== 'motorway'))
    expect(g.nodes.length).toBe(withoutMotorway.nodes.length)
    expect(g.adj.flat().length).toBe(withoutMotorway.adj.flat().length)
  })
  it('returns null for roads that are not connected', () => {
    expect(shortestPath(g, nearestNode(g, [0, 0]), nearestNode(g, [0.011, 0.01]))).toBeNull()
  })
})

describe('route editing', () => {
  const g = buildGraph(gridFeatures())
  it('adds straight legs without a graph', () => {
    let r = addPoint(emptyRoute(), [0, 0], null).route
    r = addPoint(r, [1, 1], null).route
    expect(r.points).toHaveLength(2)
    expect(r.legs).toEqual([[[0, 0], [1, 1]]])
  })
  it('puts a click on the nearest street, where it was clicked, and follows the streets', () => {
    const g2 = buildGraph(gridFeatures())
    let r = addPoint(emptyRoute(), [0.0004, 0.00003], g2).route
    // On the bottom street, below the click, not moved to a corner.
    expect(r.points[0]![0]).toBeCloseTo(0.0004, 9)
    expect(r.points[0]![1]).toBeCloseTo(0, 9)
    r = addPoint(r, [0.00197, 0.0016], g2).route
    expect(r.points[1]![0]).toBeCloseTo(0.002, 9)
    const onGrid = (p: LonLat) => [0, 0.001, 0.002].some((v) => Math.abs(p[0] - v) < 1e-9 || Math.abs(p[1] - v) < 1e-9)
    expect(routeLine(r).every(onGrid)).toBe(true)
    // Two clicks on the same block route straight along it.
    const two = addPoint(addPoint(emptyRoute(), [0.0002, 0], g2).route, [0.0008, 0], g2).route
    expect(pathLengthKm(routeLine(two)) * 1000).toBeCloseTo(66.8, 0)
  })
  it('falls back to a straight line, with a note, when roads are not connected', () => {
    let r = addPoint(emptyRoute(), [0, 0], g).route
    const res = addPoint(r, [0.011, 0.01], g)
    r = res.route
    expect(res.note).toMatch(/straight line/)
    expect(r.legs[0]).toHaveLength(2)
  })
  it('warns when following roads goes a long way round', () => {
    // From the end of one street to the next street over, with no link between them except far away.
    const f: Feature[] = [
      { layer: 'paths', kind: 'line', hw: 'footway', parts: [[[0, 0], [0, 0.01], [0.0005, 0.01], [0.0005, 0]]] },
    ]
    const g2 = buildGraph(f)
    let r = addPoint(emptyRoute(), [0, 0], g2).route
    const res = addPoint(r, [0.0005, 0], g2)
    expect(res.note).toMatch(/long way round: 22[0-9]{2} m along roads for 5[0-9] m/)
    r = addPoint(emptyRoute(), [0, 0], g2).route
    expect(addPoint(r, [0, 0.01], g2).note).toBeUndefined()
  })
  it('snaps a click near a stray path onto the connected streets', () => {
    // The grid, plus a short path joined to nothing, right next to where the user clicks.
    const stray: Feature = { layer: 'paths', kind: 'line', hw: 'footway', parts: [[[0.0021, 0.0005], [0.0022, 0.0006]]] }
    const g2 = buildGraph([...gridFeatures(), stray])
    const first = addPoint(emptyRoute(), [0.0021, 0.0005], g2).route
    expect(g2.comp[nearestNode(g2, first.points[0]!)]).toBe(g2.comp[nearestNode(g2, [0, 0])])
    const r = addPoint(addPoint(emptyRoute(), [0, 0], g2).route, [0.00215, 0.00055], g2)
    expect(r.note).toBeUndefined()
    expect(r.route.legs[0]!.length).toBeGreaterThan(2)
    // Far from the streets, the click keeps the stray path and says so.
    const far = buildGraph([...gridFeatures(), { layer: 'paths', kind: 'line', hw: 'footway', parts: [[[0.01, 0.01], [0.0101, 0.0101]]] }])
    expect(addPoint(addPoint(emptyRoute(), [0, 0], far).route, [0.0101, 0.0101], far).note).toMatch(/straight line/)
  })
  it('undoes the last point and its leg', () => {
    let r = addPoint(emptyRoute(), [0, 0], null).route
    r = addPoint(r, [1, 1], null).route
    r = undoPoint(r)
    expect(r.points).toHaveLength(1)
    expect(r.legs).toHaveLength(0)
    expect(undoPoint(emptyRoute())).toEqual(emptyRoute())
  })
  it('closes a loop back to the start', () => {
    let r = emptyRoute()
    for (const p of [[0, 0], [0.002, 0], [0.002, 0.002]] as LonLat[]) r = addPoint(r, p, g).route
    const closed = closeLoop(r, g).route
    expect(closed.points[closed.points.length - 1]).toEqual([0, 0])
    expect(routeLine(closed)[0]).toEqual([0, 0])
  })
  it('does not repeat joint points when joining legs', () => {
    const line = routeLine({ points: [[0, 0], [1, 1], [2, 2]], legs: [[[0, 0], [1, 1]], [[1, 1], [2, 2]]] })
    expect(line).toEqual([[0, 0], [1, 1], [2, 2]])
  })
  it('turns an imported track into a route', () => {
    const r = routeFromTrack([[0, 0], [1, 0], [2, 0]])
    expect(r.points).toEqual([[0, 0], [2, 0]])
    expect(routeLine(r)).toHaveLength(3)
  })
})

describe('route files', () => {
  it('reads GPX track and route points in any attribute order and ignores waypoints', () => {
    const gpx = `<gpx><wpt lat="1" lon="1"/><trk><trkseg><trkpt lon="-75.1" lat="39.9"><ele>5</ele></trkpt><trkpt lat="39.91" lon="-75.11"/></trkseg></trk></gpx>`
    expect(parseGpx(gpx)).toEqual([[-75.1, 39.9], [-75.11, 39.91]])
  })
  it('explains a GPX file with no track', () => {
    expect(() => parseGpx('<gpx><wpt lat="1" lon="1"/></gpx>')).toThrow(/no track/)
  })
  it('reads GeoJSON lines of every wrapping', () => {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } }] }
    expect(parseGeoJson(JSON.stringify(fc))).toEqual([[1, 2], [3, 4]])
    expect(() => parseGeoJson('nope')).toThrow(/not valid JSON/)
    expect(() => parseGeoJson('{"type":"Point","coordinates":[1,2]}')).toThrow(/no line/)
  })
  it('chooses the reader by file name, then by content', () => {
    expect(parseRouteFile('a.gpx', '<trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/>')).toHaveLength(2)
    expect(parseRouteFile('route', '<trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/>')).toHaveLength(2)
  })
  it('rejects out-of-range coordinates', () => {
    expect(() => parseGpx('<trkpt lat="95" lon="2"/><trkpt lat="3" lon="400"/>')).toThrow()
  })
})

describe('scene', () => {
  const proj = makeProjection(frame)
  const at = (x: number, y: number) => proj.toLonLat(x, y)
  const features: Feature[] = [
    { layer: 'major', kind: 'line', hw: 'primary', parts: [[at(10, 10), at(190, 10), at(190, 240)]] },
    { layer: 'minor', kind: 'line', hw: 'residential', parts: [[at(10, 50), at(190, 50)]] },
    { layer: 'minor', kind: 'line', hw: 'residential', parts: [[at(10, 70), at(190, 70)]] },
    { layer: 'water', kind: 'area', parts: [[at(20, 100), at(80, 100), at(80, 160), at(20, 160), at(20, 100)]] },
    { layer: 'water', kind: 'line', parts: [[at(0, 200), at(200, 200)]] },
    { layer: 'parks', kind: 'area', parts: [[at(100, 100), at(180, 100), at(180, 160), at(100, 160), at(100, 100)]] },
  ]
  const route = { points: [at(20, 20), at(150, 120)], legs: [[at(20, 20), at(150, 20), at(150, 120)]] }
  const routes: RouteItem[] = [{ id: 'r1', name: 'Loop', color: '#e4572e', route }]
  const noText: Style = { ...DEFAULT_STYLE, transparent: false, text: { ...DEFAULT_STYLE.text, show: false } }
  const base = { features, routes, pins: [] as Pin[], frame, style: noText, detail: DEFAULT_DETAIL }
  const withStyle = (patch: Partial<Style>) => ({ ...base, style: { ...noText, ...patch } })

  it('writes a real-size SVG with named layers, bottom to top', () => {
    const { svg, stats } = buildScene(base)
    expect(svg).toContain('width="200mm" height="250mm" viewBox="0 0 200 250"')
    const order = ['id="parks"', 'id="water"', 'id="minor"', 'id="major"', 'id="route-1"']
    const idx = order.map((o) => svg.indexOf(o))
    expect(idx.every((i) => i > 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    expect(svg).toContain('data-name="Main roads"')
    expect(svg).toContain('id="route-1" data-name="Loop"')
    expect(svg).toContain('OpenStreetMap contributors')
    expect(stats.routeKm[0]).toBeGreaterThan(0)
  })
  it('leaves out a layer that is switched off, and an empty route', () => {
    const layers = { ...noText.layers, minor: { ...noText.layers.minor, show: false } }
    const { svg } = buildScene({ ...withStyle({ layers }), routes: [{ ...routes[0]!, route: emptyRoute() }] })
    expect(svg).not.toContain('id="minor"')
    expect(svg).not.toContain('id="route-1"')
  })
  it('does not fill river lines', () => {
    const { svg } = buildScene(base)
    const water = svg.slice(svg.indexOf('id="water"'), svg.indexOf('id="minor"'))
    expect(water).toMatch(/<path fill="none" stroke="#b7cbd3"/)
  })
  it('keeps each shape separate on request', () => {
    const merged = (buildScene(base).svg.match(/<path /g) ?? []).length
    const sep = buildScene(withStyle({ separatePaths: true }))
    expect((sep.svg.match(/<path /g) ?? []).length).toBeGreaterThan(merged)
  })
  it('drops the background when it is left out for the shirt', () => {
    expect(buildScene(base).svg).toContain('id="background"')
    expect(buildScene(withStyle({ transparent: true })).svg).not.toContain('id="background"')
  })
  it('only ever writes safe colours and escaped text', () => {
    expect(safeColor('red"/><script>')).toBe('#000000')
    expect(safeColor('#a1B2c3')).toBe('#a1B2c3')
    const evil = buildScene({
      ...withStyle({ text: { ...DEFAULT_STYLE.text, show: true, title: '<script>&' } }),
      routes: [{ ...routes[0]!, color: '"><script>', name: '<b>' }],
    }).svg
    expect(evil).not.toContain('<script>')
    expect(evil).not.toContain('<b>')
    expect(evil).toContain('&lt;script&gt;&amp;')
  })
  it('removes tiny shapes and short lines', () => {
    const tiny: Feature[] = [
      { layer: 'minor', kind: 'line', hw: 'residential', parts: [[at(10, 10), at(10.5, 10)]] },
      { layer: 'parks', kind: 'area', parts: [[at(50, 50), at(50.5, 50), at(50.5, 50.5), at(50, 50.5), at(50, 50)]] },
    ]
    const { stats } = buildScene({ ...base, features: tiny, routes: [] })
    expect(stats.paths).toBe(0)
  })
  it('is deterministic', () => {
    expect(buildScene(base).svg).toBe(buildScene(base).svg)
  })
  it('gives each route its own group and colour', () => {
    const second: RouteItem = { id: 'r2', name: 'Hills', color: '#2a9d8f', route: { points: [at(30, 200), at(170, 200)], legs: [[at(30, 200), at(170, 200)]] } }
    const { svg, stats } = buildScene({ ...base, routes: [...routes, second] })
    expect(svg).toContain('id="route-2"')
    expect(svg).toContain('stroke="#2a9d8f"')
    expect(stats.routeKm).toHaveLength(2)
  })
  it('clips the map to a circle with a clipping path', () => {
    const { svg } = buildScene(withStyle({ shape: 'circle' }))
    expect(svg).toContain('<clipPath id="map-shape"><circle')
    expect(svg).toContain('id="major" data-name="Main roads" clip-path="url(#map-shape)"')
    expect(buildScene(base).svg).not.toContain('clipPath')
  })
  it('makes room for the text below the map', () => {
    const below = { ...DEFAULT_STYLE.text, show: true, placement: 'below' as const }
    expect(mapFrame(frame, { ...noText, text: below }).heightMm).toBeCloseTo(250 * (1 - BAND), 6)
    expect(mapFrame(frame, { ...noText, text: { ...below, placement: 'over' } }).heightMm).toBe(250)
    const { svg } = buildScene(withStyle({ text: { ...below, title: 'ART MUSEUM LOOP', subtitle: 'Sundays 7am' } }))
    expect(svg).toContain('>ART MUSEUM LOOP</text>')
    expect(svg).toContain('>Sundays 7am</text>')
    expect(svg).toMatch(/id="stats"[^>]*>[0-9.]+ KM<\/text>/)
  })
  it('lists every route in the stats line when there are several', () => {
    const second: RouteItem = { id: 'r2', name: 'Hills', color: '#2a9d8f', route: { points: [at(30, 200), at(170, 200)], legs: [[at(30, 200), at(170, 200)]] } }
    const { svg } = buildScene({ ...withStyle({ text: { ...DEFAULT_STYLE.text, show: true } }), routes: [...routes, second] })
    expect(svg).toMatch(/LOOP [0-9.]+ KM {3}· {3}HILLS [0-9.]+ KM/)
  })
  it('puts a marker at every kilometre or mile', () => {
    const line: LonLat[] = [[0, 0], [0, 0.05]] // about 5.56 km due north
    expect(pointsAlong(line, 1).map((p) => p.km)).toEqual([1, 2, 3, 4, 5])
    expect(pointsAlong(line, 0)).toEqual([])
    const long = { points: [at(5, 5), at(195, 245)], legs: [[at(5, 5), at(195, 5), at(195, 245), at(5, 245)]] }
    const km = buildScene({ ...withStyle({ distance: { units: 'km', markers: true, every: 1 } }), routes: [{ ...routes[0]!, route: long }] })
    const mi = buildScene({ ...withStyle({ distance: { units: 'mi', markers: true, every: 1 } }), routes: [{ ...routes[0]!, route: long }] })
    const count = (s: string) => (s.slice(s.indexOf('id="distance-markers"')).match(/<circle/g) ?? []).length
    expect(count(km.svg)).toBeGreaterThan(count(mi.svg))
    expect(formatDistance(16.0934, 'mi')).toBe('10.0 MI')
    expect(formatDistance(5.4321, 'km')).toBe('5.43 KM')
  })
  it('draws pins with their labels, and skips pins off the page', () => {
    const pins: Pin[] = [{ id: 'p1', at: at(100, 125), label: 'Rocky steps' }, { id: 'p2', at: at(500, 500), label: 'Far' }]
    const { svg } = buildScene({ ...base, pins })
    expect(svg).toContain('id="pins"')
    expect(svg).toContain('>ROCKY STEPS</text>')
    expect(svg).not.toContain('FAR')
  })
  it('dashes the route on request, for all routes or just one', () => {
    expect(buildScene(withStyle({ route: { ...noText.route, dashed: true } })).svg).toContain('stroke-dasharray')
    expect(buildScene(base).svg).not.toContain('stroke-dasharray')
    const one = buildScene({ ...base, routes: [{ ...routes[0]!, dashed: true }] }).svg
    expect(one.slice(one.indexOf('id="route-1-line"'))).toMatch(/^id="route-1-line"[^>]*stroke-dasharray/)
  })
})

describe('landmarks', () => {
  it('knows cafés, museums, water and sights', () => {
    expect(placeKind({ amenity: 'cafe' })).toBe('coffee')
    expect(placeKind({ shop: 'coffee' })).toBe('coffee')
    expect(placeKind({ tourism: 'museum' })).toBe('museum')
    expect(placeKind({ amenity: 'drinking_water' })).toBe('water')
    expect(placeKind({ tourism: 'viewpoint' })).toBe('sight')
    expect(placeKind({ amenity: 'bank' })).toBeNull()
  })
  it('reads places from points, centres and outlines, once each', () => {
    const out = parseOverpass({
      elements: [
        { type: 'node', id: 1, lat: 39.96, lon: -75.18, tags: { amenity: 'cafe', name: 'Rocky Brew' } },
        { type: 'way', id: 2, center: { lat: 39.965, lon: -75.181 }, tags: { tourism: 'museum', name: 'Art Museum' } },
        {
          type: 'way', id: 2, tags: { tourism: 'museum', building: 'yes' },
          geometry: [{ lat: 39.964, lon: -75.182 }, { lat: 39.964, lon: -75.18 }, { lat: 39.966, lon: -75.18 }, { lat: 39.966, lon: -75.182 }, { lat: 39.964, lon: -75.182 }],
        },
        { type: 'node', id: 3, lat: 39.97, lon: -75.19, tags: { amenity: 'drinking_water' } },
        { type: 'node', id: 4, lat: 39.97, lon: -75.19, tags: { tourism: 'viewpoint' } },
      ],
    })
    expect(out.places.map((p) => [p.kind, p.name])).toEqual([['coffee', 'Rocky Brew'], ['museum', 'Art Museum'], ['water', 'Water']])
    expect(out.features.map((f) => f.layer)).toEqual(['buildings'])
  })
  it('measures distance from a place to a route', () => {
    const line: LonLat[] = [[0, 0], [0.01, 0]]
    expect(distanceToLineM([0.005, 0.001], line)).toBeCloseTo(110.6, 0)
    expect(distanceToLineM([-0.001, 0], line)).toBeCloseTo(111.3, 0)
    expect(distanceToLineM([0.3, 0.3], [[0.3, 0.3]])).toBe(0)
  })
  it('finds places near any route, nearest first', () => {
    const places = [
      { id: 'a', name: 'Far Café', kind: 'coffee' as const, at: [0.005, 0.01] as LonLat },
      { id: 'b', name: 'Near Café', kind: 'coffee' as const, at: [0.005, 0.0005] as LonLat },
      { id: 'c', name: 'Fountain', kind: 'water' as const, at: [0.02, 0.0002] as LonLat },
    ]
    const near = placesNear(places, [[[0, 0], [0.01, 0]], [[0.02, 0], [0.03, 0]]], 100)
    expect(near.map((p) => p.name)).toEqual(['Fountain', 'Near Café'])
    expect(placesNear(places, [], 100)).toEqual([])
  })
})

describe('pin icons', () => {
  const f: Frame = { centerLon: 0, centerLat: 0, widthKm: 2, widthMm: 200, heightMm: 200 }
  const proj = makeProjection(f)
  const style: Style = { ...DEFAULT_STYLE, text: { ...DEFAULT_STYLE.text, show: false } }
  const scene = (pins: Pin[]) => buildScene({ features: [], routes: [], pins, frame: f, style, detail: DEFAULT_DETAIL }).svg
  it('draws an icon knocked out of the badge, with a halo behind the label', () => {
    const svg = scene([{ id: 'p', at: proj.toLonLat(50, 50), label: 'Rocky Brew', icon: 'coffee' }])
    const pin = svg.slice(svg.indexOf('id="pins"'))
    expect(pin).toContain(`fill="${DEFAULT_STYLE.shirt}"`)
    expect((pin.match(/<path /g) ?? []).length).toBe(2)
    expect((pin.match(/>ROCKY BREW<\/text>/g) ?? []).length).toBe(2)
    expect(pin).toMatch(/fill="none" stroke="#f2ede1" stroke-width="[0-9.]+" stroke-linejoin="round">ROCKY BREW/)
  })
  it('keeps every icon path inside its badge', () => {
    for (const icon of ['coffee', 'museum', 'water', 'star', 'flag'] as const) {
      const svg = scene([{ id: 'p', at: proj.toLonLat(100, 100), label: '', icon }])
      // Every end point and control point, leaving out arc radii and flags.
      const nums = [...svg.slice(svg.indexOf('id="pins"')).matchAll(/<path d="([^"]+)"/g)].flatMap((m) =>
        [...(m[1] as string).matchAll(/([A-Z])([^A-Z]*)/g)].flatMap(([, cmd, args]) => {
          const n = (args as string).trim() ? (args as string).trim().split(/\s+/).map(Number) : []
          return cmd === 'A' ? n.slice(5) : n
        }),
      )
      expect(nums.length, icon).toBeGreaterThan(0)
      for (const n of nums) expect(Math.abs(n - 100), icon).toBeLessThan(5)
    }
  })
  it('puts a label left of a pin near the right edge', () => {
    const svg = scene([{ id: 'p', at: proj.toLonLat(195, 100), label: 'Boathouse Row', icon: 'star' }])
    expect(svg).toContain('text-anchor="end"')
    expect(scene([{ id: 'p', at: proj.toLonLat(20, 100), label: 'Boathouse Row', icon: 'star' }])).not.toContain('text-anchor="end"')
  })
  it('asks OpenStreetMap for landmarks as centre points', () => {
    expect(buildQuery({ west: 0, south: 0, east: 1, north: 1 }, false)).toMatch(/drinking_water.*out center;$/)
  })
})

describe('readable type and labels', () => {
  const f: Frame = { centerLon: 0, centerLat: 0, widthKm: 2, widthMm: 200, heightMm: 240 }
  const base: Style = { ...DEFAULT_STYLE, text: { ...DEFAULT_STYLE.text, show: true, title: 'LOOP' } }
  const svg = (style: Style, pins: Pin[] = []) => buildScene({ features: [], routes: [], pins, frame: f, style, detail: DEFAULT_DETAIL }).svg
  it('backs text over the map with a knockout plate, and not text below it', () => {
    expect(svg({ ...base, text: { ...base.text, placement: 'over' } })).toContain(`id="text-backing" data-name="Text backing"`)
    expect(svg({ ...base, text: { ...base.text, placement: 'below' } })).not.toContain('text-backing')
  })
  it('moves a label that would land on a neighbour', () => {
    const proj = makeProjection(mapFrame(f, base))
    const pins: Pin[] = [
      { id: 'a', at: proj.toLonLat(60, 60), label: 'Boathouse Row', icon: 'star' },
      { id: 'b', at: proj.toLonLat(64, 61), label: 'Cosmic Cafe', icon: 'coffee' },
    ]
    const s = svg({ ...base, text: { ...base.text, show: false } }, pins)
    // Both labels would sit to the right and overlap; one of them has to move to another side.
    expect(s).toMatch(/text-anchor="(end|middle)"[^>]*fill="#/)
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = []
    const a = placeLabel('BOATHOUSE ROW', 60, 60, 2.6, 2.8, { w: 200, h: 200 }, taken)
    const b = placeLabel('COSMIC CAFE', 60, 60, 2.6, 2.8, { w: 200, h: 200 }, taken)
    expect([a.anchor, b.anchor]).toEqual(['start', 'end'])
    const edge = placeLabel('BOATHOUSE ROW', 195, 100, 2.6, 2.8, { w: 200, h: 200 }, [])
    expect(edge.anchor).toBe('end')
  })
  it('makes the route heavier with one ink', () => {
    const line = { points: [[0, 0], [0.001, 0.001]] as LonLat[], legs: [[[0, 0], [0.001, 0.001]]] as LonLat[][] }
    const r = [{ id: 'r', name: 'R', color: '#ff0000', route: line }]
    const w = (n: 0 | 1) => Number(/id="route-1-line"[^>]*stroke-width="([0-9.]+)"/.exec(buildScene({ features: [], routes: r, pins: [], frame: f, style: { ...base, inkLimit: n }, detail: DEFAULT_DETAIL }).svg)?.[1])
    expect(w(1)).toBeCloseTo(w(0) * 1.5, 1)
  })
})

describe('race-shirt type', () => {
  const f: Frame = { centerLon: 0, centerLat: 0, widthKm: 8, widthMm: 304.8, heightMm: 355.6 }
  const proj = makeProjection(f)
  const line: LonLat[] = [proj.toLonLat(20, 20), proj.toLonLat(280, 20), proj.toLonLat(280, 200)]
  const routes: RouteItem[] = [{ id: 'r', name: 'Loop', color: '#ffffff', route: { points: [line[0]!, line[2]!], legs: [line] } }]
  const marathon = LOOKS.find((l) => l.id === 'marathon')!.style
  const build = (style: Style, pins: Pin[] = []) => buildScene({ features: [], routes, pins, frame: f, style, detail: DEFAULT_DETAIL }).svg
  it('shows the distance as a huge number with its unit', () => {
    const km = pathLengthKm(line)
    const svg = build({ ...marathon, distance: { ...marathon.distance, units: 'mi' }, text: { ...marathon.text, title: 'RIVER RUN CLUB' } })
    expect(svg).toContain(`>${(km / 1.609344).toFixed(1)}</text>`)
    expect(svg).toContain('>MILES</text>')
    expect(svg).toContain('>RIVER RUN CLUB</text>')
    expect(svg).not.toContain('id="stats"')
    const typed = build({ ...marathon, text: { ...marathon.text, heroValue: '13.1' } })
    expect(typed).toContain('>13.1</text>')
  })
  it('adds a key for the pin icons in use, and none for plain dots or text labels', () => {
    const pins: Pin[] = [
      { id: 'a', at: proj.toLonLat(100, 100), label: 'Cafe', icon: 'coffee' },
      { id: 'b', at: proj.toLonLat(150, 100), label: 'Kelly Dr', icon: 'label' },
      { id: 'c', at: proj.toLonLat(200, 100), label: '', icon: 'dot' },
    ]
    const svg = build(marathon, pins)
    const legend = svg.slice(svg.indexOf('id="legend"'))
    expect(legend).toContain('>COFFEE STOPS</text>')
    expect(legend).not.toContain('LANDMARKS')
    expect(build({ ...marathon, text: { ...marathon.text, legend: false } }, pins)).not.toContain('id="legend"')
  })
  it('draws a text-only label centred on its spot with no badge', () => {
    const svg = build(marathon, [{ id: 'b', at: proj.toLonLat(150, 100), label: 'Kelly Dr', icon: 'label' }])
    const pin = svg.slice(svg.indexOf('id="pins"'))
    expect(pin).not.toContain('<circle')
    expect(pin).toContain('text-anchor="middle"')
    expect(pin).toContain('>KELLY DR</text>')
  })
  it('draws the river as its banks when water is set to outline', () => {
    const water: Feature[] = [{ layer: 'water', kind: 'area', parts: [[proj.toLonLat(10, 10), proj.toLonLat(100, 10), proj.toLonLat(100, 100), proj.toLonLat(10, 10)]] }]
    const svg = buildScene({ features: water, routes: [], pins: [], frame: f, style: marathon, detail: DEFAULT_DETAIL }).svg
    expect(svg).toMatch(/id="water" data-name="Water" fill="none" stroke="#ffffff"/)
  })
  it('credits OpenStreetMap up the right edge, unless switched off', () => {
    expect(build(marathon)).toMatch(/id="credit"[^>]*><text [^>]*rotate\(-90[^>]*>MAP DATA © OPENSTREETMAP CONTRIBUTORS</)
    expect(build({ ...marathon, text: { ...marathon.text, credit: false } })).not.toContain('id="credit"')
  })
  it('shrinks a long title to fit the page', () => {
    const style = { ...DEFAULT_STYLE, text: { ...DEFAULT_STYLE.text, show: true, hero: false, title: 'SCHUYLKILL RIVER TRAIL SUNDAY CLUB' } }
    const svg = build(style)
    const size = Number(/id="title"[^>]*font-size="([0-9.]+)"/.exec(svg)?.[1])
    expect(textWidth('SCHUYLKILL RIVER TRAIL SUNDAY CLUB', size)).toBeLessThanOrEqual(304.8 * 0.88 + 0.01)
    expect(size).toBeLessThan(textSizes(f).title)
  })
})
