// The scale bar, the compass and the coordinates printed with the map (map furniture, in cartographers'
// words). Each is built as plain shapes and words with a box around them, so the scene can put it in a
// corner of the map or in the text band, and draw a knockout halo behind it over the streets. The looks
// follow the research in docs/RESEARCH.md: a round length with few parts and its numbers above, a small
// and simple north arrow, and the coordinates as one letter-spaced line, as on city posters.
import { KM_PER_MI, textWidth } from './measure'
import type { CompassStyle, CoordFormat, Frame, LonLat, RouteItem, ScaleStyle } from './types'

type Units = 'km' | 'mi'
type Anchor = 'start' | 'middle' | 'end'

/** A shape or a line of text, in mm on the page. Paths use the absolute commands M, L, H, V, A and Z only. */
export type Mark =
  | { kind: 'path'; d: string; fill?: 'ink' | 'accent'; stroke?: number }
  | { kind: 'text'; x: number; y: number; text: string; size: number; weight: number; anchor: Anchor; spacing: number; knockout: boolean }

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Marks and the box around them. */
export interface Piece {
  marks: Mark[]
  box: Box
}

/** Sizes for one print, in mm: the label text, the smallest text a printer holds, and the line width. */
export interface Pen {
  size: number
  min: number
  line: number
}

const n = (v: number) => String(Math.round(v * 100) / 100)
const unitKm = (u: Units) => (u === 'mi' ? KM_PER_MI : 1)
/** The width of a line of text, letter spacing included. */
const wide = (s: string, size: number, spacing = 0) => textWidth(s, size) + spacing * [...s].length

/** The box around a line of capitals: from the baseline up to the cap height. */
function textBox(x: number, y: number, s: string, size: number, anchor: Anchor, spacing: number): Box {
  const w = wide(s, size, spacing)
  const x0 = anchor === 'start' ? x : anchor === 'middle' ? x - w / 2 : x - w
  return { x0, y0: y - size * 0.74, x1: x0 + w, y1: y + size * 0.04 }
}

function union(boxes: Box[]): Box {
  return boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }))
}

/** Collects marks and the box around each. */
function sketch() {
  const marks: Mark[] = []
  const boxes: Box[] = []
  return {
    path(d: string, box: Box, paint: { fill?: 'ink' | 'accent'; stroke?: number }) {
      marks.push({ kind: 'path', d, ...paint })
      const h = (paint.stroke ?? 0) / 2
      boxes.push({ x0: box.x0 - h, y0: box.y0 - h, x1: box.x1 + h, y1: box.y1 + h })
    },
    text(x: number, y: number, s: string, size: number, weight: number, anchor: Anchor = 'start', spacing = 0, knockout = false) {
      marks.push({ kind: 'text', x, y, text: s, size, weight, anchor, spacing, knockout })
      boxes.push(textBox(x, y, s, size, anchor, spacing))
    },
    done(): Piece {
      return { marks, box: union(boxes) }
    },
  }
}

// ---- Scale bar ----

/** Round lengths a scale bar can show, in its own units. */
const ROUND = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50]

/**
 * The round length nearest a share of the map's width (a quarter unless asked otherwise), and never more
 * than a third longer than that share.
 */
export function scaleLength(mapKm: number, units: Units, share = 0.25): number {
  const span = mapKm / unitKm(units)
  const target = span * share
  let best = ROUND[0] as number
  for (const v of ROUND) {
    if (v > target * (4 / 3)) break
    if (Math.abs(Math.log(v / target)) < Math.abs(Math.log(best / target))) best = v
  }
  return best
}

/** How many parts the bar is split into: quarters, or fifths for lengths such as 2.5 and 5. */
export function scaleParts(v: number): number {
  const lead = Math.round((v / 10 ** Math.floor(Math.log10(v))) * 10) / 10
  return lead === 2.5 || lead === 5 ? 5 : 4
}

/** A length as printed: metres below 1 km, otherwise kilometres or miles. */
function amount(v: number, units: Units): { num: string; unit: string; metres: boolean } {
  if (units === 'km' && v < 1) return { num: n(v * 1000), unit: 'M', metres: true }
  return { num: n(v), unit: units === 'mi' ? 'MI' : 'KM', metres: false }
}

export interface ScaleInput {
  style: ScaleStyle
  /** Millimetres on the page for each kilometre on the ground. */
  mmPerKm: number
  /** How wide the map is on the ground, which sets the round length. */
  mapKm: number
  units: Units
  pen: Pen
  /** How much of the map's width the bar aims for: a quarter unless a tight spot asks for less. */
  share?: number
}

type Sketch = ReturnType<typeof sketch>

/** Numbers along a bar: 0, the half way mark when the parts allow it, and the length with its unit. */
function labels(s: Sketch, x0: number, y: number, v: number, len: number, units: Units, size: number) {
  const a = amount(v, units)
  s.text(x0, y, '0', size, 700, 'middle')
  if (scaleParts(v) % 2 === 0) s.text(x0 + len / 2, y, a.metres ? n((v / 2) * 1000) : n(v / 2), size, 700, 'middle')
  // The last number sits over its tick, with the unit after it.
  s.text(x0 + len - wide(a.num, size) / 2, y, `${a.num} ${a.unit}`, size, 700)
}

/** Ticks along a bar, longer at the ends and half way, with their numbers above or below. */
function ruler(s: Sketch, x0: number, y0: number, v: number, len: number, units: Units, pen: Pen, up: boolean) {
  const parts = scaleParts(v)
  const tick = pen.size * 0.95
  const dir = up ? -1 : 1
  let d = ''
  for (let i = 0; i <= parts; i++) {
    const x = x0 + (len * i) / parts
    const major = i === 0 || i === parts || (parts % 2 === 0 && i === parts / 2)
    d += `M${n(x)} ${n(y0)}V${n(y0 + dir * (major ? tick : tick * 0.5))}`
  }
  s.path(d, { x0, y0: Math.min(y0, y0 + dir * tick), x1: x0 + len, y1: Math.max(y0, y0 + dir * tick) }, { stroke: pen.line })
  labels(s, x0, up ? y0 - tick - pen.size * 0.35 : y0 + tick + pen.size * 0.95, v, len, units, pen.size)
}

/** A scale bar with the left end of its line at (x0, y0). Its length is a round distance at the map's true scale. */
export function scaleBar(input: ScaleInput, x0: number, y0: number): Piece {
  const { pen, units, mmPerKm, mapKm } = input
  const share = input.share ?? 0.25
  const s = sketch()
  const v = scaleLength(mapKm, units, share)
  const len = v * unitKm(units) * mmPerKm
  const line = (to: number) => s.path(`M${n(x0)} ${n(y0)}H${n(x0 + to)}`, { x0, y0, x1: x0 + to, y1: y0 }, { stroke: pen.line })
  switch (input.style) {
    case 'bracket': {
      // One length between two ticks, named in words: the quietest bar.
      const a = amount(v, units)
      const tick = pen.size * 1.2
      const name = a.unit === 'MI' ? (v === 1 ? 'MILE' : 'MILES') : a.unit
      s.path(`M${n(x0)} ${n(y0 - tick)}V${n(y0)}H${n(x0 + len)}V${n(y0 - tick)}`, { x0, y0: y0 - tick, x1: x0 + len, y1: y0 }, { stroke: pen.line })
      s.text(x0 + len / 2, y0 - pen.size * 0.38, `${a.num} ${name}`, pen.size, 700, 'middle', pen.size * 0.08)
      break
    }
    case 'ruler':
      line(len)
      ruler(s, x0, y0, v, len, units, pen, true)
      break
    case 'checker': {
      // The atlas bar: parts filled and empty in turn, the numbers above.
      const parts = scaleParts(v)
      const tall = Math.max(pen.size * 0.42, pen.line * 3)
      s.path(`M${n(x0)} ${n(y0 - tall)}H${n(x0 + len)}V${n(y0)}H${n(x0)}Z`, { x0, y0: y0 - tall, x1: x0 + len, y1: y0 }, { stroke: pen.line })
      let fill = ''
      for (let i = 0; i < parts; i += 2) {
        const a = x0 + (len * i) / parts
        const b = x0 + (len * (i + 1)) / parts
        fill += `M${n(a)} ${n(y0 - tall)}H${n(b)}V${n(y0)}H${n(a)}Z`
      }
      s.path(fill, { x0, y0: y0 - tall, x1: x0 + len, y1: y0 }, { fill: 'ink' })
      labels(s, x0, y0 - tall - pen.size * 0.42, v, len, units, pen.size)
      break
    }
    case 'dual': {
      // Kilometres above the line and miles below, each at its own round length.
      const vk = scaleLength(mapKm, 'km', share)
      const vm = scaleLength(mapKm, 'mi', share)
      const lk = vk * mmPerKm
      const lm = vm * KM_PER_MI * mmPerKm
      line(Math.max(lk, lm))
      ruler(s, x0, y0, vk, lk, 'km', pen, true)
      ruler(s, x0, y0, vm, lm, 'mi', pen, false)
      break
    }
  }
  return s.done()
}

// ---- Compass ----

/** A compass centred on cx with its top at `top`. `k` below 1 shrinks it to fit a short text band. */
export function compass(style: CompassStyle, cx: number, top: number, pen: Pen, k = 1): Piece {
  const u = pen.size * k
  const s = sketch()
  if (style === 'arrow' || style === 'split') {
    const big = Math.max(u * 1.6, pen.min)
    const base = top + big * 0.74
    s.text(cx, base, 'N', big, 800, 'middle')
    if (style === 'arrow') {
      // A bold N over a slim arrow.
      const y1 = base + u * 0.5
      const hw = u * 0.78
      const hh = u * 1.45
      const tail = y1 + u * 4.3
      s.path(`M${n(cx)} ${n(y1)}L${n(cx + hw)} ${n(y1 + hh)}H${n(cx - hw)}Z`, { x0: cx - hw, y0: y1, x1: cx + hw, y1: y1 + hh }, { fill: 'ink' })
      s.path(`M${n(cx)} ${n(y1 + hh - u * 0.1)}V${n(tail)}`, { x0: cx, y0: y1 + hh, x1: cx, y1: tail }, { stroke: pen.line * 1.3 })
    } else {
      // The classic north arrow: one half filled, the other outlined.
      const y1 = base + u * 0.55
      const w = u * 2.6
      const y2 = y1 + u * 4.1
      const notch = y2 - u * 4.1 * 0.26
      const box = { x0: cx - w / 2, y0: y1, x1: cx + w / 2, y1: y2 }
      s.path(`M${n(cx)} ${n(y1)}L${n(cx - w / 2)} ${n(y2)}L${n(cx)} ${n(notch)}Z`, box, { fill: 'ink' })
      s.path(`M${n(cx)} ${n(y1)}L${n(cx + w / 2)} ${n(y2)}L${n(cx)} ${n(notch)}Z`, box, { stroke: pen.line })
    }
    return s.done()
  }
  if (style === 'badge') {
    // A round badge in the pin colour with the N knocked out, and a pointer above it, like the pins.
    const r = u * 1.75
    const tipH = u * 1.05
    const tipW = u * 1.3
    const cy = top + tipH + u * 0.38 + r
    const tip = `M${n(cx)} ${n(top)}L${n(cx + tipW / 2)} ${n(top + tipH)}H${n(cx - tipW / 2)}Z`
    const circle = `M${n(cx + r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx - r)} ${n(cy)}A${n(r)} ${n(r)} 0 1 1 ${n(cx + r)} ${n(cy)}Z`
    s.path(tip + circle, { x0: cx - r, y0: top, x1: cx + r, y1: cy + r }, { fill: 'accent' })
    const letter = Math.max(r * 1.2, pen.min)
    s.text(cx, cy + letter * 0.36, 'N', letter, 800, 'middle', 0, true)
    return s.done()
  }
  // A compass rose: four points, each half filled, small points between them, a ring and N E S W.
  const R = u * 3
  const big = Math.max(u * 1.15, pen.min)
  const small = Math.max(u * 0.85, pen.min)
  const base = top + big * 0.74
  const cy = base + u * 0.32 + R
  const at = (deg: number, rad: number) => {
    const t = (deg * Math.PI) / 180
    return `${n(cx + rad * Math.sin(t))} ${n(cy - rad * Math.cos(t))}`
  }
  const inner = R * 0.24
  let solid = ''
  let open = ''
  let minor = ''
  for (let i = 0; i < 4; i++) {
    const t = i * 90
    solid += `M${n(cx)} ${n(cy)}L${at(t, R)}L${at(t + 45, inner)}Z`
    open += `M${n(cx)} ${n(cy)}L${at(t, R)}L${at(t - 45, inner)}Z`
    minor += `M${at(t + 45, R * 0.56)}L${at(t + 90, inner * 0.75)}L${n(cx)} ${n(cy)}L${at(t, inner * 0.75)}Z`
  }
  const rr = R * 0.66
  const ring = `M${n(cx + rr)} ${n(cy)}A${n(rr)} ${n(rr)} 0 1 1 ${n(cx - rr)} ${n(cy)}A${n(rr)} ${n(rr)} 0 1 1 ${n(cx + rr)} ${n(cy)}Z`
  const box = { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R }
  s.path(ring, box, { stroke: pen.line })
  s.path(minor, box, { fill: 'ink' })
  s.path(open, box, { stroke: pen.line })
  s.path(solid, box, { fill: 'ink' })
  s.text(cx, base, 'N', big, 800, 'middle')
  s.text(cx + R + u * 0.3, cy + small * 0.36, 'E', small, 700)
  s.text(cx, cy + R + u * 0.3 + small * 0.74, 'S', small, 700, 'middle')
  s.text(cx - R - u * 0.3, cy + small * 0.36, 'W', small, 700, 'end')
  return s.done()
}

// ---- Coordinates ----

/** The spot the coordinates give: the map's centre, or the start of the first route that has one. */
export function coordsAt(frame: Frame, routes: RouteItem[], of: 'center' | 'start'): LonLat {
  const start = routes.find((r) => r.route.points.length > 0)?.route.points[0]
  return of === 'start' && start ? start : [frame.centerLon, frame.centerLat]
}

const two = (v: number) => String(v).padStart(2, '0')

/** A position written out, such as 39°58′ N 75°11′ W. Rounded to the format's last place. */
export function formatCoords(at: LonLat, format: CoordFormat): string {
  const [lon, lat] = at
  // How many steps make a degree in this format: whole minutes, ten-thousandths, or whole seconds.
  const steps = format === 'dm' ? 60 : format === 'dms' ? 3600 : 10000
  const part = (v: number, pos: string, neg: string) => {
    const q = Math.round(Math.abs(v) * steps)
    // A spot that rounds to 0 is on the line itself, so it takes the first letter, not a minus.
    const side = q === 0 || v > 0 ? pos : neg
    if (format === 'decimal') return `${(q / steps).toFixed(4)}° ${side}`
    if (format === 'dm') return `${Math.floor(q / 60)}°${two(q % 60)}′ ${side}`
    return `${Math.floor(q / 3600)}°${two(Math.floor(q / 60) % 60)}′${two(q % 60)}″ ${side}`
  }
  return `${part(lat, 'N', 'S')} ${part(lon, 'E', 'W')}`
}

/** The coordinates as one letter-spaced line, starting or ending at x. */
export function coordsLine(text: string, x: number, y: number, size: number, anchor: 'start' | 'end'): Piece {
  const s = sketch()
  s.text(x, y, text, size, 600, anchor, size * 0.1)
  return s.done()
}
