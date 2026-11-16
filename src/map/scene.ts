// Builds the SVG that is both shown in the preview and exported. One function, so exports hold
// exactly what the view shows. Everything is in millimetres on the page. Every element type sits in
// its own named group, so it arrives in Illustrator ready to recolour or delete in one selection.
// While it writes, it notes every ink it uses and the smallest text, so the print check reports what
// the file really prints.
import { haversineKm, makeProjection, pathLengthKm } from './geo'
import { applyInks } from './inks'
import { routeLine } from './route'
import { clipLine, clipRing, lineLength, ringArea, simplifyLine } from './simplify'
import {
  LAYER_NAMES,
  LAYER_ORDER,
  type Detail,
  type Feature,
  type Frame,
  type LayerId,
  type LonLat,
  type Pin,
  type PinIcon,
  type RouteItem,
  type SceneStats,
  type Style,
  type XY,
} from './types'

export const MM_PER_PT = 25.4 / 72
export const KM_PER_MI = 1.609344
/** Share of the page height that the text band takes when the text sits below the map. */
export const BAND = 0.2
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const MIN_TEXT_MM = 8 * MM_PER_PT

const fmt = (n: number) => String(Math.round(n * 100) / 100)
const num = (p: XY) => `${fmt(p[0])} ${fmt(p[1])}`
const lineD = (pts: XY[]) => 'M' + pts.map(num).join('L')
const ringD = (pts: XY[]) => 'M' + pts.map(num).join('L') + 'Z'

/** Only plain hex colours reach the file, so a bad value can never break the markup. */
export function safeColor(c: string, fallback = '#000000'): string {
  return typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : fallback
}

/** A colour in one spelling (#rrggbb, lower case), so the same ink is never counted twice. */
export function normColor(c: string): string {
  const s = safeColor(c).toLowerCase()
  return s.length === 4 ? `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}` : s
}

/** Text that is safe inside XML: special characters escaped, and characters XML forbids dropped. */
export function escapeXml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The part of the page the map fills. With text below the map, the map gets the top 80%. */
export function mapFrame(frame: Frame, style: Style): Frame {
  if (style.text.show && style.text.placement === 'below') return { ...frame, heightMm: frame.heightMm * (1 - BAND) }
  return frame
}

/** Starting font sizes in mm, from the page width. The text block shrinks them to fit. */
export function textSizes(frame: Frame) {
  return { title: frame.widthMm * 0.075, subtitle: frame.widthMm * 0.03, stats: frame.widthMm * 0.024, small: frame.widthMm * 0.014 }
}

export function formatDistance(km: number, units: 'km' | 'mi'): string {
  const v = Math.round((units === 'mi' ? km / KM_PER_MI : km) * 100) / 100
  return `${v < 10 ? v.toFixed(2) : v.toFixed(1)} ${units.toUpperCase()}`
}

/** Points every `stepKm` along a line, with how far along each one is. */
export function pointsAlong(line: LonLat[], stepKm: number): { at: LonLat; km: number }[] {
  const out: { at: LonLat; km: number }[] = []
  if (stepKm <= 0 || line.length < 2) return out
  let walked = 0
  let next = stepKm
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as LonLat
    const b = line[i] as LonLat
    const seg = haversineKm(a, b)
    while (seg > 0 && walked + seg >= next) {
      const t = (next - walked) / seg
      out.push({ at: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], km: next })
      next += stepKm
      if (out.length > 500) return out
    }
    walked += seg
  }
  return out
}

/** Rough width of a line of bold capitals, for layout. Digits and full stops are narrower, CJK wider. */
export function textWidth(s: string, size: number): number {
  let w = 0
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    w += code >= 0x2e80 ? 1 : ch === '.' || ch === ' ' || ch === '·' ? 0.3 : /[0-9]/.test(ch) ? 0.58 : ch === 'M' || ch === 'W' ? 0.86 : 0.66
  }
  return w * size
}

export interface SceneInput {
  features: Feature[]
  routes: RouteItem[]
  pins: Pin[]
  frame: Frame
  style: Style
  detail: Detail
}

export interface Scene {
  svg: string
  stats: SceneStats
}

/** What the scene notes as it writes: the inks it uses and the smallest text it sets. */
interface Ctx {
  use: (color: string) => void
  text: (sizeMm: number) => void
}

const knockout = (style: Style) => safeColor(style.transparent ? style.shirt : style.background, '#ffffff')

export function buildScene(input: SceneInput): Scene {
  const { features, pins, frame, detail } = input
  const { style, routes } = applyInks(input.style, input.routes)
  const map = mapFrame(frame, style)
  const proj = makeProjection(map)
  const rect = { w: map.widthMm, h: map.heightMm }
  const inks = new Set<string>()
  const knock = normColor(knockout(style))
  let minText = Infinity
  const ctx: Ctx = {
    // The shirt colour, where it shows through, is a knockout: no ink.
    use: (c) => {
      const n = normColor(c)
      if (!(style.transparent && n === knock)) inks.add(n)
    },
    text: (mm) => {
      minText = Math.min(minText, mm)
    },
  }

  const byLayer = {} as Record<LayerId, string[]>
  const counts = {} as Record<LayerId, number>
  for (const id of LAYER_ORDER) {
    byLayer[id] = []
    counts[id] = 0
  }
  // Rivers are lines but live in the water layer, so they are kept apart and drawn without fill.
  const waterLines: string[] = []

  for (const f of features) {
    const ls = style.layers[f.layer]
    if (!ls.show) continue
    if (f.kind === 'line') {
      for (const part of f.parts) {
        const projected = part.map(proj.toMm)
        if (outside(projected, rect)) continue
        for (const piece of clipLine(simplifyLine(projected, detail.simplifyMm), rect)) {
          if (lineLength(piece) < detail.minLengthMm) continue
          ;(f.layer === 'water' ? waterLines : byLayer[f.layer]).push(lineD(piece))
        }
      }
      continue
    }
    if (ls.outline) {
      // Drawn by its edges: each ring is cut at the page edge as a line, so the cut itself is never stroked.
      for (const part of f.parts) {
        const projected = part.map(proj.toMm)
        if (outside(projected, rect)) continue
        const simple = simplifyLine(projected, detail.simplifyMm)
        const first = simple[0] as XY
        const last = simple[simple.length - 1] as XY
        const closed = first[0] === last[0] && first[1] === last[1] ? simple : [...simple, first]
        for (const piece of clipLine(closed, rect)) {
          if (lineLength(piece) >= detail.minLengthMm) byLayer[f.layer].push(lineD(piece))
        }
      }
      continue
    }
    const rings: XY[][] = []
    for (const part of f.parts) {
      const projected = part.map(proj.toMm)
      if (outside(projected, rect)) continue
      const ring = clipRing(simplifyLine(projected, detail.simplifyMm), rect)
      if (ring.length >= 3 && ringArea(ring) >= detail.minAreaMm2) rings.push(ring)
    }
    // One path per shape, its holes wound the other way, so overlapping shapes never cut holes in each other.
    if (rings.length) byLayer[f.layer].push(orientedPath(rings))
  }

  const clip = style.shape === 'rect' ? '' : ' clip-path="url(#map-shape)"'
  let paths = 0
  const groups: string[] = []
  for (const id of LAYER_ORDER) {
    const ds = byLayer[id]
    const lines = id === 'water' ? waterLines : []
    counts[id] = ds.length + lines.length
    if (!ds.length && !lines.length) continue
    paths += style.separatePaths ? ds.length + lines.length : (ds.length ? 1 : 0) + (lines.length ? 1 : 0)
    groups.push(layerGroup(id, ds, lines, style, clip, ctx))
  }

  const routeKm: number[] = []
  const markerParts: string[] = []
  routes.forEach((item, i) => {
    const line = routeLine(item.route)
    routeKm.push(pathLengthKm(line))
    const g = buildRoute(item, i, line, proj.toMm, rect, style, detail, clip, ctx)
    if (g) {
      paths += 1
      groups.push(g)
    }
    if (style.distance.markers) markerParts.push(distanceMarkers(item, line, proj.toMm, rect, style, frame, ctx))
  })
  const markers = markerParts.join('')
  if (markers) groups.push(`<g id="distance-markers" data-name="Distance markers"${clip}>${markers}</g>`)
  const pinSvg = buildPins(pins, proj.toMm, rect, style, frame, clip, ctx)
  if (pinSvg) groups.push(pinSvg)
  const text = buildText(routes, routeKm, pins, frame, map, style, ctx)
  if (text) groups.push(text)
  if (style.text.credit) groups.push(buildCredit(frame, style, ctx))

  const W = fmt(frame.widthMm)
  const H = fmt(frame.heightMm)
  const defs = clip ? `<defs><clipPath id="map-shape">${shapeElement(map, style)}</clipPath></defs>\n` : ''
  const bgColor = safeColor(style.background, '#ffffff')
  if (!style.transparent) inks.add(normColor(bgColor))
  // With a circle or rounded frame the background takes the frame's shape, so it reads as a panel.
  const bg = style.transparent
    ? ''
    : style.shape === 'rect'
      ? `<rect id="background" data-name="Background" width="${W}" height="${H}" fill="${bgColor}"/>\n`
      : `<g id="background" data-name="Background" fill="${bgColor}">${shapeElement(map, style)}</g>\n`
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n` +
    `<!-- Made with Route Map Studio. Map data © OpenStreetMap contributors, ODbL (openstreetmap.org/copyright). -->\n` +
    defs +
    bg +
    groups.join('\n') +
    `\n</svg>\n`
  return {
    svg,
    stats: {
      byLayer: counts, paths, bytes: svg.length, routeKm,
      inks: [...inks], minTextPt: Number.isFinite(minText) ? minText / MM_PER_PT : null,
    },
  }
}

/** Twice the signed area of a ring; positive means clockwise on the page (y points down). */
function signedArea(ring: XY[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as XY
    const b = ring[(i + 1) % ring.length] as XY
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s
}

function inRing(p: XY, ring: XY[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as XY
    const b = ring[j] as XY
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

/**
 * The rings of one shape as one path for non-zero filling: rings inside an odd number of others are holes
 * and wind the other way. Then shapes can share one compound path without cutting holes in each other.
 */
function orientedPath(rings: XY[][]): string {
  return rings
    .map((ring, i) => {
      const depth = rings.reduce((n, other, j) => (j !== i && inRing(ring[0] as XY, other) ? n + 1 : n), 0)
      const wantClockwise = depth % 2 === 0
      const isClockwise = signedArea(ring) > 0
      return ringD(wantClockwise === isClockwise ? ring : ring.slice().reverse())
    })
    .join('')
}

function shapeElement(map: Frame, style: Style): string {
  const w = map.widthMm
  const h = map.heightMm
  if (style.shape === 'circle') {
    const r = (Math.min(w, h) / 2) * 0.94
    return `<circle cx="${fmt(w / 2)}" cy="${fmt(h / 2)}" r="${fmt(r)}"/>`
  }
  const inset = Math.min(w, h) * 0.03
  const rx = Math.min(w, h) * 0.06
  return `<rect x="${fmt(inset)}" y="${fmt(inset)}" width="${fmt(w - 2 * inset)}" height="${fmt(h - 2 * inset)}" rx="${fmt(rx)}"/>`
}

function outside(pts: XY[], r: { w: number; h: number }): boolean {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  return maxX < 0 || minX > r.w || maxY < 0 || minY > r.h
}

function layerGroup(id: LayerId, ds: string[], lines: string[], style: Style, clip: string, ctx: Ctx): string {
  const ls = style.layers[id]
  // Rivers print at least as heavy as streets, so they never drop below the print minimum.
  const riverPt = Math.max(ls.widthPt, style.layers.minor.widthPt, 1)
  const isArea = id === 'parks' || id === 'water' || id === 'buildings'
  const color = safeColor(ls.color)
  ctx.use(color)
  const attrs = isArea && ls.outline
    ? `fill="none" stroke="${color}" stroke-width="${fmt(Math.max(ls.widthPt, 1) * MM_PER_PT)}" stroke-linecap="round" stroke-linejoin="round"`
    : isArea
      ? `fill="${color}" fill-rule="nonzero"` +
        (ls.widthPt > 0 ? ` stroke="${color}" stroke-width="${fmt(ls.widthPt * MM_PER_PT)}" stroke-linejoin="round"` : ' stroke="none"')
      : `fill="none" stroke="${color}" stroke-width="${fmt(ls.widthPt * MM_PER_PT)}" stroke-linecap="round" stroke-linejoin="round"`
  const head = `<g id="${id}" data-name="${LAYER_NAMES[id]}"${clip} ${attrs}>`
  const lineAttrs = `fill="none" stroke="${color}" stroke-width="${fmt(riverPt * MM_PER_PT)}" stroke-linecap="round" stroke-linejoin="round"`
  const lineSvg = !lines.length
    ? ''
    : style.separatePaths
      ? lines.map((d) => `<path ${lineAttrs} d="${d}"/>`).join('')
      : `<path ${lineAttrs} d="${lines.join('')}"/>`
  if (style.separatePaths) return head + ds.map((d) => `<path d="${d}"/>`).join('') + lineSvg + '</g>'
  return head + (ds.length ? `<path d="${ds.join('')}"/>` : '') + lineSvg + '</g>'
}

function buildRoute(
  item: RouteItem,
  index: number,
  line: LonLat[],
  toMm: (p: LonLat) => XY,
  rect: { w: number; h: number },
  style: Style,
  detail: Detail,
  clip: string,
  ctx: Ctx,
): string {
  if (line.length < 2) return ''
  const r = style.route
  const wMm = r.widthPt * MM_PER_PT
  const pieces = clipLine(simplifyLine(line.map(toMm), detail.simplifyMm * 0.5), rect)
  if (!pieces.length) return ''
  const d = pieces.map(lineD).join('')
  const color = safeColor(item.color, '#e4572e')
  const outlineColor = safeColor(r.outlineColor, '#ffffff')
  ctx.use(color)
  const n = index + 1
  const dash = item.dashed ?? r.dashed ? ` stroke-dasharray="${fmt(wMm * 2.4)} ${fmt(wMm * 1.8)}"` : ''
  let out = `<g id="route-${n}" data-name="${escapeXml(item.name.trim()) || `Route ${n}`}"${clip} fill="none" stroke-linecap="round" stroke-linejoin="round">`
  if (r.outline) {
    ctx.use(outlineColor)
    out += `<path id="route-${n}-outline" d="${d}" stroke="${outlineColor}" stroke-width="${fmt(wMm * 1.9)}"/>`
  }
  out += `<path id="route-${n}-line" d="${d}" stroke="${color}" stroke-width="${fmt(wMm)}"${dash}/>`
  if (r.markers) {
    const a = toMm(item.route.points[0] as LonLat)
    const b = toMm(item.route.points[item.route.points.length - 1] as LonLat)
    const rad = fmt(wMm * 1.7)
    const inside = (p: XY) => p[0] >= 0 && p[0] <= rect.w && p[1] >= 0 && p[1] <= rect.h
    const loop = Math.hypot(a[0] - b[0], a[1] - b[1]) < wMm
    if (inside(a) || (inside(b) && !loop)) ctx.use(outlineColor)
    if (inside(a)) out += `<circle id="route-${n}-start" cx="${fmt(a[0])}" cy="${fmt(a[1])}" r="${rad}" fill="${color}" stroke="${outlineColor}" stroke-width="${fmt(wMm * 0.5)}"/>`
    if (inside(b) && !loop) out += `<circle id="route-${n}-finish" cx="${fmt(b[0])}" cy="${fmt(b[1])}" r="${rad}" fill="${outlineColor}" stroke="${color}" stroke-width="${fmt(wMm * 0.7)}"/>`
  }
  return out + '</g>'
}

function distanceMarkers(
  item: RouteItem,
  line: LonLat[],
  toMm: (p: LonLat) => XY,
  rect: { w: number; h: number },
  style: Style,
  frame: Frame,
  ctx: Ctx,
): string {
  const stepKm = style.distance.every * (style.distance.units === 'mi' ? KM_PER_MI : 1)
  const wMm = style.route.widthPt * MM_PER_PT
  const color = safeColor(item.color)
  const fill = safeColor(style.route.outlineColor, '#ffffff')
  // Never smaller than 8 pt, the usual minimum for printed text.
  const size = Math.max(textSizes(frame).small, MIN_TEXT_MM)
  let out = ''
  for (const m of pointsAlong(line, stepKm)) {
    const [x, y] = toMm(m.at)
    if (x < 0 || x > rect.w || y < 0 || y > rect.h) continue
    const label = String(Math.round((m.km / (style.distance.units === 'mi' ? KM_PER_MI : 1)) * 10) / 10)
    ctx.use(fill)
    ctx.use(color)
    ctx.text(size)
    out +=
      `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(wMm * 1.1)}" fill="${fill}" stroke="${color}" stroke-width="${fmt(wMm * 0.5)}"/>` +
      `<text x="${fmt(x + wMm * 1.8)}" y="${fmt(y - wMm * 1.4)}" font-family="${FONT}" font-weight="700" font-size="${fmt(size)}" fill="${color}">${label}</text>`
  }
  return out
}

/** Icon shapes on a unit square (-1 to 1, y down). Fills and strokes are knocked out of the badge. */
type BadgeIcon = Exclude<PinIcon, 'dot' | 'label'>

const ICON: Record<BadgeIcon, { fill?: string; stroke?: string }> = {
  coffee: {
    fill: 'M-0.62 -0.18H0.36L0.28 0.42Q0.25 0.62 0.05 0.62H-0.33Q-0.53 0.62 -0.56 0.42Z',
    stroke: 'M0.34 -0.06Q0.68 -0.06 0.64 0.18Q0.6 0.4 0.3 0.36M-0.36 -0.36Q-0.24 -0.5 -0.36 -0.66M-0.06 -0.36Q0.06 -0.5 -0.06 -0.66',
  },
  museum: {
    fill: 'M-0.72 -0.26L0 -0.72L0.72 -0.26ZM-0.56 -0.16H-0.3V0.4H-0.56ZM-0.13 -0.16H0.13V0.4H-0.13ZM0.3 -0.16H0.56V0.4H0.3ZM-0.76 0.48H0.76V0.66H-0.76Z',
  },
  water: { fill: 'M0 -0.72C0.32 -0.3 0.54 0 0.54 0.24A0.54 0.54 0 0 1 -0.54 0.24C-0.54 0 -0.32 -0.3 0 -0.72Z' },
  star: { fill: 'M0 -0.72L0.17 -0.23L0.68 -0.22L0.27 0.09L0.42 0.58L0 0.29L-0.42 0.58L-0.27 0.09L-0.68 -0.22L-0.17 -0.23Z' },
  flag: { fill: 'M-0.36 -0.66L0.6 -0.42L-0.36 -0.16Z', stroke: 'M-0.4 -0.7V0.7' },
}

/** Scale an icon path from the unit square to a spot on the page. */
function placeIcon(d: string, cx: number, cy: number, s: number): string {
  // Turn absolute commands into page coordinates. Arc radii scale, flags stay.
  return d.replace(/([MLHVQCAZ])([^MLHVQCAZ]*)/g, (_, cmd: string, args: string) => {
    const n = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : []
    const xy = (i: number) => (i % 2 === 0 ? fmt(cx + (n[i] as number) * s) : fmt(cy + (n[i] as number) * s))
    if (cmd === 'H') return 'H' + fmt(cx + (n[0] as number) * s)
    if (cmd === 'V') return 'V' + fmt(cy + (n[0] as number) * s)
    if (cmd === 'A') return `A${fmt((n[0] as number) * s)} ${fmt((n[1] as number) * s)} ${n[2]} ${n[3]} ${n[4]} ${fmt(cx + (n[5] as number) * s)} ${fmt(cy + (n[6] as number) * s)}`
    if (cmd === 'Z') return 'Z'
    return cmd + n.map((_, i) => xy(i)).join(' ')
  })
}

/** A pin icon on its own, as a small SVG, for lists in the app. Same shapes as the export. */
export function iconSvg(icon: PinIcon, color: string, knock: string, px = 20): string {
  const c = safeColor(color, '#e4572e')
  const k = safeColor(knock, '#ffffff')
  if (icon === 'label') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5H19V8.5H14V19H10V8.5H5Z" fill="${c}"/></svg>`
  }
  let body = `<circle cx="12" cy="12" r="${icon === 'dot' ? 5 : 11}" fill="${c}"/>`
  if (icon !== 'dot') {
    const g = ICON[icon]
    if (g.fill) body += `<path d="${placeIcon(g.fill, 12, 12, 7.5)}" fill="${k}"/>`
    if (g.stroke) body += `<path d="${placeIcon(g.stroke, 12, 12, 7.5)}" fill="none" stroke="${k}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** Pick a label spot next to a pin: right, left, above or below, the first that is free and on the page. */
export function placeLabel(
  label: string, x: number, y: number, r: number, size: number, rect: { w: number; h: number }, taken: Box[],
): { x: number; y: number; anchor: 'start' | 'end' | 'middle' } {
  const w = textWidth(label, size)
  const gap = r * 1.6
  const options: { x: number; y: number; anchor: 'start' | 'end' | 'middle'; box: Box }[] = [
    { x: x + gap, y: y + size * 0.35, anchor: 'start', box: { x0: x + gap, y0: y - size * 0.5, x1: x + gap + w, y1: y + size * 0.5 } },
    { x: x - gap, y: y + size * 0.35, anchor: 'end', box: { x0: x - gap - w, y0: y - size * 0.5, x1: x - gap, y1: y + size * 0.5 } },
    { x, y: y - gap - size * 0.25, anchor: 'middle', box: { x0: x - w / 2, y0: y - gap - size, x1: x + w / 2, y1: y - gap } },
    { x, y: y + gap + size * 0.85, anchor: 'middle', box: { x0: x - w / 2, y0: y + gap, x1: x + w / 2, y1: y + gap + size } },
  ]
  const onPage = (b: Box) => b.x0 >= 0 && b.x1 <= rect.w && b.y0 >= 0 && b.y1 <= rect.h
  const pick = options.find((o) => onPage(o.box) && !taken.some((t) => overlaps(t, o.box))) ?? options.find((o) => onPage(o.box)) ?? (options[0] as (typeof options)[number])
  taken.push(pick.box)
  return { x: pick.x, y: pick.y, anchor: pick.anchor }
}

/** A round badge with its icon knocked out, centred on a spot. Pins and the legend share it. */
function badge(icon: BadgeIcon | 'dot', x: number, y: number, r: number, color: string, knock: string, ctx: Ctx): string {
  const minStroke = MM_PER_PT
  ctx.use(color)
  let out = `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}" fill="${color}"${icon === 'dot' ? '' : ` stroke="${knock}" stroke-width="${fmt(Math.max(r * 0.14, minStroke))}"`}/>`
  if (icon !== 'dot') {
    ctx.use(knock)
    const g = ICON[icon]
    const s = r * 0.68
    if (g.fill) out += `<path d="${placeIcon(g.fill, x, y, s)}" fill="${knock}"/>`
    if (g.stroke) out += `<path d="${placeIcon(g.stroke, x, y, s)}" fill="none" stroke="${knock}" stroke-width="${fmt(Math.max(s * 0.16, minStroke))}" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  return out
}

/** Text with a knockout halo and a fill, so a label reads over streets. The halo prints as no ink. */
function haloText(attrs: string, label: string, size: number, knock: string, fill: string, ctx: Ctx): string {
  ctx.use(knock)
  ctx.use(fill)
  ctx.text(size)
  return (
    `<text ${attrs} fill="none" stroke="${knock}" stroke-width="${fmt(size * 0.28)}" stroke-linejoin="round">${escapeXml(label)}</text>` +
    `<text ${attrs} fill="${fill}">${escapeXml(label)}</text>`
  )
}

const pinRadius = (icon: PinIcon, frame: Frame, size: number) =>
  icon === 'dot' ? frame.widthMm * 0.007 : icon === 'label' ? 0 : Math.max(frame.widthMm * 0.013, size * 0.75)

function buildPins(pins: Pin[], toMm: (p: LonLat) => XY, rect: { w: number; h: number }, style: Style, frame: Frame, clip: string, ctx: Ctx): string {
  if (!pins.length) return ''
  const color = safeColor(style.pinColor, '#e4572e')
  const textColor = safeColor(style.text.color, '#111111')
  const knock = knockout(style)
  const size = Math.max(textSizes(frame).small, MIN_TEXT_MM)
  // Every badge and label box placed so far, so labels do not land on each other.
  const taken: Box[] = []
  for (const p of pins) {
    const [x, y] = toMm(p.at)
    const r = pinRadius(p.icon ?? 'dot', frame, size)
    if (r > 0) taken.push({ x0: x - r, y0: y - r, x1: x + r, y1: y + r })
  }
  let out = ''
  for (const p of pins) {
    const [x, y] = toMm(p.at)
    if (x < 0 || x > rect.w || y < 0 || y > rect.h) continue
    const icon = p.icon ?? 'dot'
    const label = p.label.trim().toUpperCase()
    out += `<g class="pin">`
    if (icon === 'label') {
      // A street name or note: text only, centred on the spot.
      if (label) {
        const w = textWidth(label, size)
        taken.push({ x0: x - w / 2, y0: y - size * 0.5, x1: x + w / 2, y1: y + size * 0.5 })
        out += haloText(`x="${fmt(x)}" y="${fmt(y + size * 0.35)}" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${fmt(size)}" letter-spacing="${fmt(size * 0.06)}"`, label, size, knock, textColor, ctx)
      }
    } else {
      const r = pinRadius(icon, frame, size)
      out += badge(icon, x, y, r, color, knock, ctx)
      if (label) {
        const spot = placeLabel(label, x, y, r, size, rect, taken)
        const anchor = spot.anchor === 'end' ? ' text-anchor="end"' : spot.anchor === 'middle' ? ' text-anchor="middle"' : ''
        out += haloText(`x="${fmt(spot.x)}" y="${fmt(spot.y)}"${anchor} font-family="${FONT}" font-weight="700" font-size="${fmt(size)}"`, label, size, knock, textColor, ctx)
      }
    }
    out += `</g>`
  }
  // Pins are clipped to a circle or rounded frame like the map, so nothing prints outside it.
  return out ? `<g id="pins" data-name="Pins"${clip}>${out}</g>` : ''
}

/** The icons the pins use, in order, for the legend. Plain dots and text labels need no key. */
function legendIcons(pins: Pin[]): BadgeIcon[] {
  const out: BadgeIcon[] = []
  for (const p of pins) {
    const i = p.icon ?? 'dot'
    if (i !== 'dot' && i !== 'label' && !out.includes(i)) out.push(i)
  }
  return out
}

function buildText(routes: RouteItem[], routeKm: number[], pins: Pin[], frame: Frame, map: Frame, style: Style, ctx: Ctx): string {
  const t = style.text
  if (!t.show) return ''
  const W = frame.widthMm
  const base = textSizes(frame)
  const color = safeColor(t.color, '#111111')
  const knock = knockout(style)
  const top = t.placement === 'below' ? map.heightMm : frame.heightMm * (1 - BAND)
  const band = frame.heightMm * BAND
  // No line of text may be taller than its share of the band, so a short page keeps its rows apart.
  const cap = { title: band * 0.4, subtitle: band * 0.16, stats: band * 0.13, legend: band * 0.12 }
  const items: string[] = []
  let left = W
  let right = 0
  const extent = (x0: number, x1: number) => {
    left = Math.min(left, x0)
    right = Math.max(right, x1)
  }
  const el = (id: string, x: number, y: number, anchor: string, weight: number, size: number, extra: string, content: string) => {
    ctx.use(color)
    ctx.text(size)
    return `<text id="${id}" x="${fmt(x)}" y="${fmt(y)}"${anchor} font-family="${FONT}" font-weight="${weight}" font-size="${fmt(size)}"${extra} fill="${color}">${content}</text>`
  }
  /** The size at which a line fits a width, no bigger than `size`. */
  // Rounded down to the 0.01 mm the file is written in, so a fitted line never ends up a hair too wide.
  const fit = (s: string, size: number, width: number, factor = 1) =>
    Math.max(0.1, Math.floor(Math.min(size, width / Math.max(0.01, textWidth(s, 1) * factor)) * 100) / 100)

  const title = t.title.trim()
  const subtitle = t.subtitle.trim()
  const units = style.distance.units
  const firstKm = routeKm.find((k) => k > 0) ?? 0
  const legendItems = (t.legend ? legendIcons(pins) : []).map((icon) => ({ icon, name: (style.legendNames[icon] ?? '').trim().toUpperCase() }))
  const legendWidth = (size: number) =>
    legendItems.reduce((w, it) => w + size * 1.5 + textWidth(it.name, size) + size * 1.2, 0) - (legendItems.length ? size * 1.2 : 0)
  const legendAt = (x0: number, y: number, size: number) => {
    let x = x0
    let out = ''
    for (const it of legendItems) {
      const r = size * 0.62
      out += badge(it.icon, x + r, y - size * 0.35, r, safeColor(style.pinColor, '#e4572e'), knock, ctx)
      x += size * 1.5
      ctx.use(color)
      ctx.text(size)
      out += `<text x="${fmt(x)}" y="${fmt(y)}" font-family="${FONT}" font-weight="700" font-size="${fmt(size)}" letter-spacing="${fmt(size * 0.06)}" fill="${color}">${escapeXml(it.name)}</text>`
      x += textWidth(it.name, size) + size * 1.2
    }
    extent(x0, x - size * 1.2)
    return out ? `<g id="legend" data-name="Legend">${out}</g>` : ''
  }
  const legendBase = Math.min(Math.max(base.small * 1.1, MIN_TEXT_MM), cap.legend)

  const typed = t.heroValue.trim()
  if (t.hero && (typed || firstKm > 0)) {
    // A race-shirt layout: the distance as a huge number, with the title stacked beside it.
    const value = typed || (units === 'mi' ? firstKm / KM_PER_MI : firstKm).toFixed(1)
    const x0 = W * 0.06
    // The number takes at most 55% of the width, so the words always have room beside it.
    const hero = fit(value, band * 0.95, W * 0.55)
    const heroW = textWidth(value, hero)
    const baseline = top + band * 0.9
    items.push(el('hero', x0, baseline, '', 800, hero, ` letter-spacing="${fmt(-hero * 0.02)}"`, escapeXml(value)))
    extent(x0, x0 + heroW)
    const x1 = x0 + heroW + W * 0.025
    const avail = W * 0.94 - x1
    const unitLabel = units === 'mi' ? 'MILES' : 'KM'
    const unitSize = fit(unitLabel, Math.min(Math.max(base.stats * 1.1, MIN_TEXT_MM), cap.stats * 1.2), avail, 1.1)
    items.push(el('hero-unit', x1, baseline, '', 800, unitSize, ` letter-spacing="${fmt(unitSize * 0.1)}"`, unitLabel))
    extent(x1, x1 + textWidth(unitLabel, unitSize) * 1.1)
    let y = top + band * 0.38
    if (title) {
      const size = fit(title, Math.min(base.title * 0.62, cap.title * 0.7), avail)
      items.push(el('title', x1, y, '', 800, size, '', escapeXml(title)))
      extent(x1, x1 + textWidth(title, size))
      y += Math.min(base.subtitle, cap.subtitle) * 1.6
    }
    if (subtitle) {
      const size = fit(subtitle, Math.min(base.subtitle, cap.subtitle), avail, 0.85)
      items.push(el('subtitle', x1, y, '', 500, size, '', escapeXml(subtitle)))
      extent(x1, x1 + textWidth(subtitle, size) * 0.85)
      y += size * 1.5
    }
    if (legendItems.length) {
      const w = legendWidth(legendBase)
      const size = w > avail ? legendBase * (avail / w) : legendBase
      items.push(legendAt(x1, Math.min(y + size * 0.4, baseline - unitSize * 1.6), size))
    }
  } else {
    const center = t.align === 'center'
    const x = center ? W / 2 : W * 0.06
    const avail = W * 0.88
    const anchor = center ? ' text-anchor="middle"' : ''
    const span = (w: number): [number, number] => (center ? [x - w / 2, x + w / 2] : [x, x + w])
    if (title) {
      // Long titles shrink to fit the page instead of running off it.
      const size = fit(title, Math.min(base.title, cap.title), avail)
      items.push(el('title', x, top + band * 0.45, anchor, 800, size, '', escapeXml(title)))
      extent(...span(textWidth(title, size)))
    }
    if (subtitle) {
      const size = fit(subtitle, Math.min(base.subtitle, cap.subtitle), avail, 0.85)
      items.push(el('subtitle', x, top + band * 0.66, anchor, 500, size, '', escapeXml(subtitle)))
      extent(...span(textWidth(subtitle, size) * 0.85))
    }
    let statsEnd = x
    let statsLine = ''
    if (t.stats) {
      const drawn = routes.map((r, i) => ({ r, km: routeKm[i] ?? 0 })).filter((d) => d.km > 0)
      statsLine = drawn.length === 1
        ? formatDistance(drawn[0]?.km ?? 0, units)
        : drawn.map((d) => `${d.r.name.toUpperCase()} ${formatDistance(d.km, units)}`).join('   ·   ')
    }
    // The key shares the stats line when there is room for both, and takes its own line when not.
    const keyW = legendItems.length ? legendWidth(legendBase) : 0
    const shareRow = !center && statsLine && keyW > 0 && textWidth(statsLine, Math.min(base.stats, cap.stats)) * 1.12 + W * 0.04 + keyW <= avail
    if (statsLine) {
      const size = fit(statsLine, Math.min(base.stats, cap.stats), shareRow ? avail - keyW - W * 0.04 : avail, 1.12)
      items.push(el('stats', x, top + band * 0.85, anchor, 700, size, ` letter-spacing="${fmt(size * 0.08)}"`, escapeXml(statsLine)))
      const w = textWidth(statsLine, size) * 1.12
      extent(...span(w))
      statsEnd = x + w
    }
    if (legendItems.length) {
      const size = keyW > avail ? legendBase * (avail / keyW) : legendBase
      const w = legendWidth(size)
      const lx = shareRow ? W * 0.94 - w : center ? W / 2 - w / 2 : x
      const ly = shareRow || !statsLine ? top + band * 0.85 : top + band * 0.97
      items.push(legendAt(Math.max(lx, shareRow ? statsEnd + W * 0.04 : 0), ly, size))
    }
  }
  if (!items.length) return ''
  if (t.placement === 'over' && right > left) {
    // A plate in the knockout colour behind the text, so the type reads over busy streets. It prints as no ink.
    const pad = W * 0.03
    // Run the plate to the page edge when it nearly reaches it, so no slivers of street peek past it.
    const x0 = left - pad < W * 0.08 ? 0 : left - pad
    const x1 = right + pad > W * 0.92 ? W : right + pad
    ctx.use(knock)
    items.unshift(`<rect id="text-backing" data-name="Text backing" x="${fmt(x0)}" y="${fmt(top + band * 0.08)}" width="${fmt(x1 - x0)}" height="${fmt(frame.heightMm - (top + band * 0.08))}" fill="${knock}"/>`)
  }
  return `<g id="text" data-name="Text">${items.join('')}</g>`
}

/** The OpenStreetMap credit, small and up the right edge, where it never meets the type. */
function buildCredit(frame: Frame, style: Style, ctx: Ctx): string {
  const size = MIN_TEXT_MM
  const x = frame.widthMm - frame.widthMm * 0.018
  const y = frame.heightMm - frame.widthMm * 0.03
  const color = safeColor(style.text.color, '#111111')
  ctx.use(color)
  ctx.text(size)
  return `<g id="credit" data-name="OpenStreetMap credit"><text x="${fmt(x)}" y="${fmt(y)}" transform="rotate(-90 ${fmt(x)} ${fmt(y)})" font-family="${FONT}" font-weight="500" font-size="${fmt(size)}" letter-spacing="${fmt(size * 0.08)}" fill="${color}">MAP DATA © OPENSTREETMAP CONTRIBUTORS</text></g>`
}
