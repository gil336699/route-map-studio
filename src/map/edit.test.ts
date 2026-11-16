// Editing a drawn route: remove, move and insert points anywhere, on a small grid of streets.
import { describe, expect, it } from 'vitest'
import { pathLengthKm } from './geo'
import { buildGraph, trial, type Graph } from './graph'
import {
  addPoint, canEditLeg, canEditPoint, closeLoop, editRoute, emptyRoute, insertPoint, isLoop, kindsOf, movePoint,
  removePoint, routeFromTrack, routeLine, splitLeg, type RouteEdit,
} from './route'
import { parseProject, serializeProject, SCHEMA } from '../lib/project'
import type { Feature, LonLat, Route } from './types'

// Streets every 0.001° (about 111 m) from 0 to 0.004, both ways: a 5 × 5 grid near 0, 0.
const STEP = 0.001
function grid(): Graph {
  const f: Feature[] = []
  for (let i = 0; i <= 4; i++) {
    const row: LonLat[] = [], col: LonLat[] = []
    for (let j = 0; j <= 4; j++) {
      row.push([j * STEP, i * STEP])
      col.push([i * STEP, j * STEP])
    }
    f.push({ layer: 'minor', kind: 'line', hw: 'residential', parts: [row] }, { layer: 'minor', kind: 'line', hw: 'residential', parts: [col] })
  }
  return buildGraph(f)
}
const onGrid = (p: LonLat) => [p[0], p[1]].some((v) => Math.abs(v / STEP - Math.round(v / STEP)) < 1e-6)
const drawn = (pts: LonLat[], g: Graph | null): Route => pts.reduce((r, p) => addPoint(r, p, g).route, emptyRoute())
const meters = (r: Route) => pathLengthKm(routeLine(r)) * 1000
/** Every leg starts and ends exactly at its two points. */
const joined = (r: Route) => r.legs.every((leg, i) => leg[0] === r.points[i] || (leg[0]![0] === r.points[i]![0] && leg[0]![1] === r.points[i]![1]))
  && r.legs.every((leg, i) => { const e = leg[leg.length - 1]!; const p = r.points[i + 1]!; return e[0] === p[0] && e[1] === p[1] })

describe('kinds of leg', () => {
  it('records how each leg was made, and reads routes saved before 0.2.0', () => {
    const g = grid()
    expect(kindsOf(drawn([[0, 0], [0.002, 0]], g))).toEqual(['roads'])
    expect(kindsOf(drawn([[0, 0], [0.002, 0]], null))).toEqual(['straight'])
    expect(kindsOf(closeLoop(drawn([[0, 0], [0.002, 0], [0.002, 0.002]], g), g).route)).toEqual(['roads', 'roads', 'roads'])
    expect(kindsOf(routeFromTrack([[0, 0], [1, 0], [2, 0]]))).toEqual(['track'])
    // No kinds saved: a two-point leg was drawn straight, a longer one along the streets.
    expect(kindsOf({ points: [[0, 0], [1, 1], [2, 1]], legs: [[[0, 0], [1, 1]], [[1, 1], [1.5, 1], [2, 1]]] })).toEqual(['straight', 'roads'])
  })
})

describe('removing a point', () => {
  it('rejoins its neighbours along the streets, and leaves the other legs alone', () => {
    const g = grid()
    const r = drawn([[0, 0], [0.002, 0], [0.002, 0.002], [0.004, 0.002]], g)
    const out = removePoint(r, 2, g, 'roads').route
    expect(out.points).toEqual([r.points[0], r.points[1], r.points[3]])
    expect(out.legs[0]).toBe(r.legs[0])
    expect(routeLine(out).every(onGrid)).toBe(true)
    expect(joined(out)).toBe(true)
    // (0.002, 0) to (0.004, 0.002) is 4 blocks either way round the grid.
    expect(pathLengthKm(out.legs[1]!) * 1000).toBeCloseTo(4 * 111.2, -1)
    expect(kindsOf(out)).toEqual(['roads', 'roads'])
  })
  it('keeps straight legs straight, and joins a straight and a roads leg the way clicks join now', () => {
    const g = grid()
    const straight = drawn([[0, 0], [0.0013, 0.0007], [0.004, 0.004]], null)
    const s = removePoint(straight, 1, g, 'roads').route
    expect(s.legs).toEqual([[[0, 0], [0.004, 0.004]]])
    expect(kindsOf(s)).toEqual(['straight'])
    const mixed: Route = { ...drawn([[0, 0], [0.002, 0]], g) }
    const both = addPoint(mixed, [0.002, 0.002], null).route
    expect(kindsOf(both)).toEqual(['roads', 'straight'])
    expect(removePoint(both, 1, g, 'straight').route.legs).toEqual([[both.points[0], both.points[2]]])
    const along = removePoint(both, 1, g, 'roads').route
    expect(along.legs[0]!.length).toBeGreaterThan(2)
    expect(routeLine(along).every(onGrid)).toBe(true)
  })
  it('takes the first or last point off the end, and the only point leaves an empty route', () => {
    const g = grid()
    const r = drawn([[0, 0], [0.002, 0], [0.002, 0.002]], g)
    const head = removePoint(r, 0, g, 'roads').route
    expect(head.points).toEqual(r.points.slice(1))
    expect(head.legs).toEqual(r.legs.slice(1))
    const tail = removePoint(r, 2, g, 'roads').route
    expect(tail.points).toEqual(r.points.slice(0, 2))
    expect(tail.legs).toEqual(r.legs.slice(0, 1))
    expect(removePoint(drawn([[0, 0]], g), 0, g, 'roads').route.points).toEqual([])
  })
  it('makes the next point the start of a loop, and the loop stays closed', () => {
    const g = grid()
    const loop = closeLoop(drawn([[0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002]], g), g).route
    expect(isLoop(loop)).toBe(true)
    const out = removePoint(loop, 0, g, 'roads').route
    expect(isLoop(out)).toBe(true)
    expect(out.points[0]).toEqual(loop.points[1])
    expect(out.points).toHaveLength(loop.points.length - 1)
    expect(joined(out)).toBe(true)
    // Removing the finish of a loop is removing its start: the same spot.
    expect(removePoint(loop, loop.points.length - 1, g, 'roads').route.points).toEqual(out.points)
  })
})

describe('moving a point', () => {
  it('redraws only the two legs beside it, and lands it on the nearest street', () => {
    const g = grid()
    const r = drawn([[0, 0], [0.001, 0], [0.002, 0], [0.003, 0], [0.004, 0]], g)
    const out = movePoint(r, 2, [0.0021, 0.00195], g).route
    expect(out.points[2]![0]).toBeCloseTo(0.0021, 9)
    expect(out.points[2]![1]).toBeCloseTo(0.002, 9)
    expect(out.legs[0]).toBe(r.legs[0])
    expect(out.legs[3]).toBe(r.legs[3])
    expect(out.legs[1]).not.toBe(r.legs[1])
    expect(routeLine(out).every(onGrid)).toBe(true)
    expect(joined(out)).toBe(true)
    // Up two blocks and back: about 440 m more than the straight run along the bottom street.
    expect(meters(out) - meters(r)).toBeGreaterThan(400)
  })
  it('leaves a point beside straight legs exactly where it was dropped', () => {
    const g = grid()
    const r = drawn([[0, 0], [0.0011, 0.0013], [0.004, 0.004]], null)
    const out = movePoint(r, 1, [0.0017, 0.0005], g).route
    expect(out.points[1]).toEqual([0.0017, 0.0005])
    expect(out.legs).toEqual([[[0, 0], [0.0017, 0.0005]], [[0.0017, 0.0005], [0.004, 0.004]]])
  })
  it('moves the start and finish of a loop together', () => {
    const g = grid()
    const loop = closeLoop(drawn([[0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002]], g), g).route
    const out = movePoint(loop, 0, [0.001, 0.0001], g).route
    expect(out.points[0]).toEqual(out.points[out.points.length - 1])
    expect(isLoop(out)).toBe(true)
    expect(joined(out)).toBe(true)
  })
  it('says so when the new spot is off the downloaded streets', () => {
    const g = grid()
    const r = drawn([[0, 0], [0.002, 0], [0.004, 0]], g)
    const res = movePoint(r, 1, [0.002, 0.05], g)
    expect(res.route.points[1]).toEqual([0.002, 0.05])
    expect(res.note).toMatch(/No street or path is within 200 m/)
  })
})

describe('inserting a point', () => {
  it('puts a detour between two points, through the new spot, along the streets', () => {
    const g = grid()
    const r = drawn([[0, 0], [0.004, 0]], g)
    // Between two streets, nearer the east–west one: it lands there, straight below.
    const res = insertPoint(r, 0, [0.0023, 0.0011], g)
    const out = res.route
    expect(res.index).toBe(1)
    expect(out.points).toHaveLength(3)
    expect(out.points[1]![0]).toBeCloseTo(0.0023, 9)
    expect(out.points[1]![1]).toBeCloseTo(0.001, 9)
    expect(routeLine(out).some((p) => Math.abs(p[1] - 0.001) < 1e-9)).toBe(true)
    expect(kindsOf(out)).toEqual(['roads', 'roads'])
    expect(joined(out)).toBe(true)
  })
  it('bends a straight leg through the new spot without snapping it', () => {
    const g = grid()
    const out = insertPoint(drawn([[0, 0], [0.004, 0.004]], null), 0, [0.0031, 0.0009], g).route
    expect(out.legs).toEqual([[[0, 0], [0.0031, 0.0009]], [[0.0031, 0.0009], [0.004, 0.004]]])
  })
  it('can add a point on the line without changing it, ready to drag later', () => {
    const g = grid()
    const r = drawn([[0, 0], [0.003, 0], [0.003, 0.003]], g)
    const res = splitLeg(r, 1, [0.0031, 0.0016])
    const out = res.route
    expect(res.index).toBe(2)
    expect(out.points).toHaveLength(4)
    expect(out.points[2]![0]).toBeCloseTo(0.003, 9)
    expect(out.points[2]![1]).toBeCloseTo(0.0016, 9)
    expect(meters(out)).toBeCloseTo(meters(r), 6)
    expect(joined(out)).toBe(true)
    // At an end of the leg there is nothing to add.
    expect(splitLeg(r, 1, [0.003, 0]).route).toBe(r)
  })
})

describe('imported tracks', () => {
  it('are never changed by an edit, but points drawn on after them can be', () => {
    const g = grid()
    const track = routeFromTrack([[0, 0], [0.0011, 0.0002], [0.0021, 0.0001], [0.003, 0]])
    expect(canEditPoint(track, 0)).toBe(false)
    expect(canEditPoint(track, 1)).toBe(false)
    expect(canEditLeg(track, 0)).toBe(false)
    expect(removePoint(track, 0, g, 'roads').route).toBe(track)
    expect(movePoint(track, 1, [0, 0.002], g).route).toBe(track)
    expect(insertPoint(track, 0, [0.002, 0.002], g).route).toBe(track)
    expect(splitLeg(track, 0, [0.002, 0]).route).toBe(track)
    const more = drawn([[0.003, 0.002], [0.004, 0.004]], null).points.reduce((r, p) => addPoint(r, p, null).route, track)
    expect(kindsOf(more)).toEqual(['track', 'straight', 'straight'])
    expect(canEditPoint(more, 1)).toBe(false)
    expect(canEditPoint(more, 2)).toBe(true)
    expect(canEditPoint(more, 3)).toBe(true)
    expect(canEditLeg(more, 1)).toBe(true)
  })
})

describe('previews', () => {
  it('leave the street network exactly as it was, and match the edit made for real', () => {
    const g = grid()
    const r = drawn([[0, 0], [0.002, 0], [0.004, 0]], g)
    const before = JSON.stringify({ nodes: g.nodes, adj: g.adj, comp: g.comp, compSize: g.compSize })
    const ops: RouteEdit[] = [
      { kind: 'move', index: 1, p: [0.00213, 0.00271] },
      { kind: 'insert', leg: 1, p: [0.00317, 0.00122] },
      { kind: 'remove', index: 1, mode: 'roads' },
    ]
    const previews = ops.map((op) => trial(g, () => editRoute(r, op, g).route))
    expect(JSON.stringify({ nodes: g.nodes, adj: g.adj, comp: g.comp, compSize: g.compSize })).toBe(before)
    ops.forEach((op, i) => expect(editRoute(r, op, grid()).route).toEqual(previews[i]))
  })
})

describe('project files', () => {
  it('keep each leg’s kind, and skip a route whose points and legs do not match', () => {
    const g = grid()
    const r = addPoint(drawn([[0, 0], [0.002, 0]], g), [0.003, 0.003], null).route
    const file = (route: unknown) => JSON.stringify({ schema: SCHEMA, version: 1, routes: [{ id: 'r1', name: 'A', color: '#ff0000', route }] })
    const back = parseProject(serializeProject({ ...parseProject(file(r)) }))
    expect(back.routes[0]!.route.kinds).toEqual(['roads', 'straight'])
    expect(parseProject(file({ ...r, kinds: ['roads', 'boat'] })).routes[0]!.route.kinds).toBeUndefined()
    expect(parseProject(file({ points: r.points, legs: r.legs.slice(1) })).routes).toEqual([])
  })
})
