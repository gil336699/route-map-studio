// The scale bar, compass and coordinates: true to the map's scale, round numbers, in their place, and
// printable (no new ink, lines and text at print minimums).
import { describe, expect, it } from 'vitest'
import { applyLook } from '../lib/doc'
import { DEFAULT_FRAME, DEFAULT_STYLE, LOOKS } from '../lib/presets'
import { parseProject, serializeProject } from '../lib/project'
import { coordsAt, formatCoords, scaleBar, scaleLength, scaleParts, type Box } from './furniture'
import { KM_PER_MI, MIN_TEXT_MM, MM_PER_PT } from './measure'
import { BAND, buildScene, furniturePen, mapFrame, planFurniture, textWidth } from './scene'
import type { CompassStyle, Frame, Furniture, FurniturePlace, RouteItem, ScaleStyle, Style } from './types'

const SCALES: ScaleStyle[] = ['bracket', 'ruler', 'checker', 'dual']
const COMPASSES: CompassStyle[] = ['arrow', 'split', 'badge', 'rose']
const CORNERS: FurniturePlace[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const ALL: Partial<Furniture> = { scale: true, compass: true, coords: true }

const look = (id: string) => LOOKS.find((l) => l.id === id)!.style
function withFurniture(base: Style, fu: Partial<Furniture>, text: Partial<Style['text']> = {}): Style {
  return { ...structuredClone(base), text: { ...base.text, ...text }, furniture: { ...base.furniture, ...fu } }
}
const route: RouteItem = {
  id: 'r1', name: 'Loop', color: '#e4572e',
  route: { points: [[-75.19, 39.97], [-75.17, 39.96]], legs: [[[-75.19, 39.97], [-75.17, 39.96]]], kinds: ['straight'] },
}
const scene = (style: Style, frame: Frame = DEFAULT_FRAME, routes: RouteItem[] = [route]) =>
  buildScene({ features: [], routes, pins: [], frame, style, detail: { simplifyMm: 0, minLengthMm: 0, minAreaMm2: 0 } })
/** The markup of one named group in a scene. */
const group = (svg: string, id: string) => {
  const m = new RegExp(`<g id="${id}"[^>]*>(.*?)</g>`).exec(svg)
  return m ? (m[1] as string) : null
}
const inside = (b: Box, o: Box, slack = 0.01) => b.x0 >= o.x0 - slack && b.y0 >= o.y0 - slack && b.x1 <= o.x1 + slack && b.y1 <= o.y1 + slack
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
/** Horizontal reach of a path drawn with M, L, H and V. */
function reach(d: string): [number, number] {
  const xs: number[] = []
  for (const [, cmd, args] of d.matchAll(/([MLHV])([^MLHVZA]*)/g)) {
    const v = (args as string).trim().split(/\s+/).map(Number)
    if (cmd === 'H') xs.push(v[0] as number)
    if (cmd === 'M' || cmd === 'L') xs.push(v[0] as number)
  }
  return [Math.min(...xs), Math.max(...xs)]
}

describe('scale bar length', () => {
  it('picks the round length nearest a quarter of the map, never more than a third', () => {
    expect(scaleLength(7.54, 'mi')).toBe(1)
    expect(scaleLength(7.54, 'km')).toBe(2)
    expect(scaleLength(6, 'mi')).toBe(1)
    expect(scaleLength(0.2, 'km')).toBe(0.05)
    expect(scaleLength(0.2, 'mi')).toBe(0.025)
    expect(scaleLength(40, 'km')).toBe(10)
    expect(scaleLength(40, 'mi')).toBe(5)
    for (let km = 0.2; km <= 40; km *= 1.13) {
      for (const u of ['km', 'mi'] as const) {
        const v = scaleLength(km, u)
        expect([0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50]).toContain(v)
        expect(v * (u === 'mi' ? KM_PER_MI : 1)).toBeLessThanOrEqual(km / 3 + 1e-9)
      }
    }
  })
  it('splits into quarters, or fifths for 2.5 and 5', () => {
    expect([1, 2, 10, 0.2, 0.1].map(scaleParts)).toEqual([4, 4, 4, 4, 4])
    expect([2.5, 5, 0.25, 0.05, 25, 50].map(scaleParts)).toEqual([5, 5, 5, 5, 5, 5])
  })
  it('is drawn true to the map: one mile is a mile at the print scale, in every style', () => {
    const frame = { ...DEFAULT_FRAME, widthKm: 7.54 }
    const mmPerKm = frame.widthMm / frame.widthKm
    for (const s of SCALES) {
      const style = withFurniture(DEFAULT_STYLE, { scale: true, scaleStyle: s }, { show: false })
      style.distance.units = 'mi'
      const svg = scene(style, frame).svg
      const g = group(svg, 'scale-bar')
      expect(g, s).not.toBeNull()
      // The ink paths, not the halo: the first stroked path in the text colour.
      const ink = [...(g as string).matchAll(/<path d="([^"]+)" fill="none" stroke="([^"]+)" stroke-width/g)].filter((m) => m[2] === DEFAULT_STYLE.text.color)
      const [x0, x1] = reach(ink[0]![1] as string)
      const want = s === 'dual' ? 2 * mmPerKm : KM_PER_MI * mmPerKm
      expect(x1 - x0, s).toBeCloseTo(want, 1)
    }
  })
  it('names the length in words on the bracket, and in metres under a kilometre', () => {
    const pen = { size: 4, min: MIN_TEXT_MM, line: 0.5 }
    const words = (p: ReturnType<typeof scaleBar>) => p.marks.flatMap((m) => (m.kind === 'text' ? [m.text] : []))
    expect(words(scaleBar({ style: 'bracket', mmPerKm: 40, mapKm: 7.54, units: 'mi', pen }, 0, 0))).toEqual(['1 MILE'])
    expect(words(scaleBar({ style: 'bracket', mmPerKm: 40, mapKm: 13, units: 'mi', pen }, 0, 0))).toEqual(['2 MILES'])
    expect(words(scaleBar({ style: 'ruler', mmPerKm: 400, mapKm: 0.8, units: 'km', pen }, 0, 0))).toEqual(['0', '100', '200 M'])
    expect(words(scaleBar({ style: 'ruler', mmPerKm: 400, mapKm: 1.6, units: 'km', pen }, 0, 0))).toEqual(['0', '500 M'])
    expect(words(scaleBar({ style: 'ruler', mmPerKm: 40, mapKm: 7.54, units: 'km', pen }, 0, 0))).toEqual(['0', '1', '2 KM'])
  })
})

describe('coordinates', () => {
  it('writes degrees and minutes, decimal degrees, and seconds', () => {
    const at: [number, number] = [-75.19088, 39.96889]
    expect(formatCoords(at, 'dm')).toBe('39°58′ N 75°11′ W')
    expect(formatCoords(at, 'decimal')).toBe('39.9689° N 75.1909° W')
    expect(formatCoords(at, 'dms')).toBe('39°58′08″ N 75°11′27″ W')
    expect(formatCoords([151.2093, -33.8688], 'dm')).toBe('33°52′ S 151°13′ E')
  })
  it('carries a rounded 60 into the next minute or degree, and puts a spot on the line in no hemisphere sign', () => {
    expect(formatCoords([10, 39.99999], 'dm')).toBe('40°00′ N 10°00′ E')
    expect(formatCoords([10, 39.9999999], 'dms')).toBe('40°00′00″ N 10°00′00″ E')
    expect(formatCoords([-0.000001, -0.000001], 'dm')).toBe('0°00′ N 0°00′ E')
  })
  it('gives the start of the first route that has one, or the map centre', () => {
    const empty: RouteItem = { ...route, id: 'r0', route: { points: [], legs: [] } }
    expect(coordsAt(DEFAULT_FRAME, [empty, route], 'start')).toEqual([-75.19, 39.97])
    expect(coordsAt(DEFAULT_FRAME, [empty], 'start')).toEqual([DEFAULT_FRAME.centerLon, DEFAULT_FRAME.centerLat])
    expect(coordsAt(DEFAULT_FRAME, [route], 'center')).toEqual([DEFAULT_FRAME.centerLon, DEFAULT_FRAME.centerLat])
  })
})

describe('placing the scale bar, compass and coordinates', () => {
  it('keeps the corner stack on the map, apart, and above the text when it covers the map', () => {
    for (const placement of ['below', 'over'] as const) {
      for (const place of CORNERS) {
        for (const c of COMPASSES) {
          const style = withFurniture(DEFAULT_STYLE, { scale: true, compass: true, place, compassStyle: c, scaleStyle: 'dual' }, { placement })
          const map = mapFrame(DEFAULT_FRAME, style)
          const floor = placement === 'over' ? DEFAULT_FRAME.heightMm * (1 - BAND) : map.heightMm
          const plan = planFurniture(DEFAULT_FRAME, style, [route], [1])
          expect(plan.pieces.map((p) => p.id)).toEqual(['compass', 'scale-bar'])
          const [a, b] = plan.pieces.map((p) => p.piece.box) as [Box, Box]
          const room = { x0: 0, y0: 0, x1: map.widthMm, y1: floor }
          expect(inside(a, room) && inside(b, room), `${placement} ${place} ${c}`).toBe(true)
          expect(overlap(a, b), `${place} ${c}`).toBe(false)
          // Lined up on the corner's side.
          if (place.endsWith('right')) expect(Math.abs(a.x1 - b.x1)).toBeLessThan(0.01)
          else expect(Math.abs(a.x0 - b.x0)).toBeLessThan(0.01)
        }
      }
    }
  })
  it('in the band, keeps the title its full width and the lines beside them clear', () => {
    const long = { title: 'SCHUYLKILL RIVER RUNNING CLUB', subtitle: 'Saturday long run from the Art Museum steps' }
    const plain = scene(withFurniture(DEFAULT_STYLE, {}, long)).svg
    const style = withFurniture(DEFAULT_STYLE, { ...ALL, place: 'band' }, long)
    const svg = scene(style).svg
    const size = (s: string, id: string) => Number(new RegExp(`<text id="${id}"[^>]* font-size="([\\d.]+)"`).exec(s)?.[1])
    expect(size(svg, 'title')).toBe(size(plain, 'title'))
    const plan = planFurniture(DEFAULT_FRAME, style, [route], [1])
    const top = mapFrame(DEFAULT_FRAME, style).heightMm
    for (const p of plan.pieces) expect(inside(p.piece.box, { x0: 0, y0: top, x1: DEFAULT_FRAME.widthMm, y1: DEFAULT_FRAME.heightMm }), p.id).toBe(true)
    const left = Math.min(...plan.band.map((b) => b.x0))
    for (const id of ['subtitle', 'stats']) {
      const m = new RegExp(`<text id="${id}" x="([\\d.]+)"[^>]* font-size="([\\d.]+)"[^>]*>([^<]+)<`).exec(svg)!
      const end = Number(m[1]) + textWidth(m[3] as string, Number(m[2])) * (id === 'stats' ? 1.12 : 0.85)
      expect(end, id).toBeLessThanOrEqual(left)
    }
    // On the band they sit on empty shirt, so no halo.
    expect(plan.pieces.every((p) => p.halo === 0)).toBe(true)
  })
  it('with centred text, puts the coordinates in the subtitle and the compass and scale bar at the two ends', () => {
    const style = withFurniture(look('emblem'), { ...ALL, place: 'band' })
    const plan = planFurniture(DEFAULT_FRAME, style, [route], [1])
    const coords = formatCoords([DEFAULT_FRAME.centerLon, DEFAULT_FRAME.centerLat], 'dm')
    expect(plan.subtitleCoords).toBe(coords)
    expect(scene(style).svg).toContain(`· ${coords}</text>`)
    const c = plan.pieces.find((p) => p.id === 'compass')!.piece.box
    const s = plan.pieces.find((p) => p.id === 'scale-bar')!.piece.box
    const W = DEFAULT_FRAME.widthMm
    expect(c.x0).toBeCloseTo(W * 0.06, 1)
    expect(s.x1).toBeCloseTo(W * 0.94, 1)
  })
  it('without text, takes the band choice to the bottom-right corner, with the coordinates under the scale bar', () => {
    const style = withFurniture(DEFAULT_STYLE, { ...ALL, place: 'band' }, { show: false })
    const plan = planFurniture(DEFAULT_FRAME, style, [route], [1])
    expect(plan.pieces.map((p) => p.id)).toEqual(['compass', 'scale-bar', 'coordinates'])
    expect(plan.band).toEqual([])
    const boxes = plan.pieces.map((p) => p.piece.box)
    const m = DEFAULT_FRAME.widthMm * 0.04
    expect(Math.max(...boxes.map((b) => b.x1))).toBeCloseTo(DEFAULT_FRAME.widthMm - m, 1)
    expect(Math.max(...boxes.map((b) => b.y1))).toBeCloseTo(DEFAULT_FRAME.heightMm - m, 1)
    expect(plan.pieces.every((p) => p.halo > 0)).toBe(true)
  })
  it('puts each piece in its own named group, with a knockout halo over the map', () => {
    const style = withFurniture(DEFAULT_STYLE, { ...ALL, place: 'top-left' })
    const svg = scene(style).svg
    expect(svg).toContain('<g id="scale-bar" data-name="Scale bar"')
    expect(svg).toContain('<g id="compass" data-name="Compass"')
    expect(svg).toContain('<g id="coordinates" data-name="Coordinates"')
    const knock = style.shirt
    expect(group(svg, 'compass')).toContain(`stroke="${knock}"`)
    expect(group(svg, 'coordinates')).not.toContain(`stroke="${knock}"`)
  })
})

describe('printing the scale bar, compass and coordinates', () => {
  it('adds no ink: they print in the text colour, and the badge in the pin colour', () => {
    for (const id of ['vintage', 'tonal', 'marathon', 'one-ink']) {
      const off = scene(withFurniture(look(id), {})).stats.inks
      for (const s of SCALES) {
        for (const c of ['arrow', 'split', 'rose'] as CompassStyle[]) {
          const on = scene(withFurniture(look(id), { ...ALL, scaleStyle: s, compassStyle: c })).stats.inks
          expect(on.slice().sort(), `${id} ${s} ${c}`).toEqual(off.slice().sort())
        }
      }
    }
  })
  it('draws lines of at least 2 pt for light ink on a dark shirt, and 1.25 pt otherwise', () => {
    for (const [id, min] of [['tonal', 2], ['night-neon', 2], ['vintage', 1.25], ['coastal', 1.25]] as const) {
      const style = withFurniture(look(id), { ...ALL, scaleStyle: 'checker', compassStyle: 'rose' })
      expect(furniturePen(DEFAULT_FRAME, style).line / MM_PER_PT, id).toBeCloseTo(min, 6)
      const svg = scene(style).svg
      for (const g of ['scale-bar', 'compass']) {
        const widths = [...(group(svg, g) as string).matchAll(new RegExp(`stroke="${style.text.color}" stroke-width="([\\d.]+)"`, 'g'))].map((m) => Number(m[1]))
        expect(widths.length, `${id} ${g}`).toBeGreaterThan(0)
        expect(Math.min(...widths) / MM_PER_PT, `${id} ${g}`).toBeGreaterThanOrEqual(min - 0.02)
      }
    }
  })
  it('keeps every word at 8 pt or more, even on a small print', () => {
    const small: Frame = { ...DEFAULT_FRAME, widthMm: 5 * 25.4, heightMm: 6 * 25.4 }
    for (const s of SCALES) {
      for (const c of COMPASSES) {
        for (const place of ['band', 'top-left'] as FurniturePlace[]) {
          const stats = scene(withFurniture(DEFAULT_STYLE, { ...ALL, scaleStyle: s, compassStyle: c, place, coordFormat: 'dms' }, { title: '', subtitle: '' }), small).stats
          expect(stats.minTextPt!, `${s} ${c} ${place}`).toBeGreaterThanOrEqual(7.99)
        }
      }
    }
  })
})

describe('saving the scale bar, compass and coordinates', () => {
  it('keeps them in a project file, and opens older files with them off', () => {
    const style = withFurniture(DEFAULT_STYLE, { ...ALL, place: 'top-right', scaleStyle: 'dual', compassStyle: 'badge', coordFormat: 'dms', coordsOf: 'start' })
    const state = { frame: DEFAULT_FRAME, style, detail: { simplifyMm: 0.15, minLengthMm: 1.5, minAreaMm2: 1 }, routes: [route], pins: [], buildings: false, unit: 'in' as const }
    expect(parseProject(serializeProject(state)).style.furniture).toEqual(style.furniture)
    const old = JSON.parse(serializeProject(state))
    delete old.style.furniture
    expect(parseProject(JSON.stringify(old)).style.furniture).toEqual(DEFAULT_STYLE.furniture)
    expect(DEFAULT_STYLE.furniture.scale || DEFAULT_STYLE.furniture.compass || DEFAULT_STYLE.furniture.coords).toBe(false)
    // Damaged values fall back one by one.
    old.style.furniture = { scale: 'yes', scaleStyle: 'zigzag', compass: true, place: 'middle', coordFormat: 'utm' }
    expect(parseProject(JSON.stringify(old)).style.furniture).toEqual({ ...DEFAULT_STYLE.furniture, compass: true })
  })
  it('keeps them when a look is applied', () => {
    const doc = { frame: DEFAULT_FRAME, style: withFurniture(DEFAULT_STYLE, { ...ALL, place: 'band', scaleStyle: 'ruler' }), detail: { simplifyMm: 0.15, minLengthMm: 1.5, minAreaMm2: 1 }, routes: [route], pins: [], buildings: false, unit: 'in' as const }
    for (const l of LOOKS) expect(applyLook(doc, l).style.furniture, l.id).toEqual(doc.style.furniture)
  })
})
