// Builds the SVG that is both shown in the preview and exported. One function, so exports hold
// exactly what the view shows. Everything is in millimetres on the page. Every element type sits in
// its own named group, so it arrives in Illustrator ready to recolour or delete in one selection.
// While it writes, it notes every ink it uses and the smallest text, so the print check reports what
// the file really prints.
import { haversineKm, makeProjection, pathLengthKm } from './geo'
import { ICON_PATHS, ICON_SCALE, ICONS, type BadgeIcon } from './icons'
import { compass, coordsAt, coordsLine, formatCoords, scaleBar, type Box, type Mark, type Pen, type Piece, type ScaleInput } from './furniture'
import { applyInks, luminance } from './inks'
import { KM_PER_MI, MIN_TEXT_MM, MM_PER_PT, textWidth } from './measure'
import { routeLine } from './route'
import { clipLine, clipRing, lineLength, ringArea, simplifyLine } from './simplify'
import {
  LAYER_NAMES,
  LAYER_ORDER,
  type CompassStyle,
  type Detail,
  type Feature,
  type Frame,
  type FurniturePlace,
  type LayerId,
  type LonLat,
  type Pin,
  type PinIcon,
  type RouteItem,
  type ScaleStyle,
  type SceneStats,
  type Style,
  type XY,
} from './types'

export { KM_PER_MI, MM_PER_PT, textWidth } from './measure'
/** Share of the page height that the text band takes when the text sits below the map. */
export const BAND = 0.2
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"

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
  const plan = planFurniture(frame, style, routes, routeKm)
  const text = buildText(routes, routeKm, pins, frame, map, style, plan, ctx)
  if (text) groups.push(text)
  groups.push(...drawFurniture(plan, style, ctx))
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
  const dash = item.dashed ? ` stroke-dasharray="${fmt(wMm * 2.4)} ${fmt(wMm * 1.8)}"` : ''
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

const ICON_INFO = new Map(ICONS.map((i) => [i.id, i]))

/** Whether a pin icon draws a badge with a shape in it (not a plain dot or text only). */
const isBadge = (icon: PinIcon): icon is BadgeIcon => icon !== 'dot' && icon !== 'label' && ICON_INFO.has(icon)

/** The key's name for an icon: the one the user typed, or the icon's own. */
export const legendName = (style: Style, icon: BadgeIcon): string => style.legendNames[icon] ?? ICON_INFO.get(icon)?.legend ?? ''

/** Scale an icon path from the unit square to a spot on the page. */
function placeIcon(d: string, cx: number, cy: number, s: number): string {
  // Turn absolute commands into page coordinates. Arc radii scale, flags stay.
  return d.replace(/([MLHVQCAZ])([^MLHVQCAZ]*)/g, (_, cmd: string, args: string) => {
    const n = args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
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
  let body = `<circle cx="12" cy="12" r="${isBadge(icon) ? 11 : 5}" fill="${c}"/>`
  if (isBadge(icon)) body += `<path d="${placeIcon(ICON_PATHS[icon], 12, 12, 11 * ICON_SCALE)}" fill="${k}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`
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
    out += `<path d="${placeIcon(ICON_PATHS[icon], x, y, r * ICON_SCALE)}" fill="${knock}"/>`
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
  icon === 'label' ? 0 : !isBadge(icon) ? frame.widthMm * 0.007 : Math.max(frame.widthMm * 0.013, size * 0.75)

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
      out += badge(isBadge(icon) ? icon : 'dot', x, y, r, color, knock, ctx)
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
export function legendIcons(pins: Pin[]): BadgeIcon[] {
  const out: BadgeIcon[] = []
  for (const p of pins) {
    const i = p.icon ?? 'dot'
    if (isBadge(i) && !out.includes(i)) out.push(i)
  }
  return out
}

function buildText(routes: RouteItem[], routeKm: number[], pins: Pin[], frame: Frame, map: Frame, style: Style, plan: FurniturePlan, ctx: Ctx): string {
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
  /**
   * The room the scale bar, compass and coordinates take beside a line of text set at `y` and at most
   * `size` high: on the left and on the right of the band. Lines above or below them keep the full width.
   */
  const room = (y: number, size: number) => {
    const gap = W * 0.03
    let l = 0
    let r = 0
    for (const b of plan.band) {
      // Capitals reach 0.74 of the size above the line, and a fifth of the size below it stays clear.
      if (b.y1 < y - size * 0.74 || b.y0 > y + size * 0.2) continue
      if (b.x0 + b.x1 < W) l = Math.max(l, b.x1 - W * 0.06 + gap)
      else r = Math.max(r, W * 0.94 - b.x0 + gap)
    }
    return { l, r }
  }

  const title = t.title.trim()
  // Centred text takes the coordinates at the end of its subtitle line.
  const subtitle = [t.subtitle.trim(), plan.subtitleCoords].filter(Boolean).join(' · ')
  const units = style.distance.units
  const firstKm = routeKm.find((k) => k > 0) ?? 0
  const legendItems = (t.legend ? legendIcons(pins) : []).map((icon) => ({ icon, name: legendName(style, icon).trim().toUpperCase() }))
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
    const baseline = top + band * 0.9
    // The number takes at most 55% of the width, less what sits at the right, so the words always have room beside it.
    const hero = fit(value, band * 0.95, Math.min(W * 0.55, Math.max(W * 0.25, W * 0.63 - room(baseline, band * 0.95).r)))
    const heroW = textWidth(value, hero)
    items.push(el('hero', x0, baseline, '', 800, hero, ` letter-spacing="${fmt(-hero * 0.02)}"`, escapeXml(value)))
    extent(x0, x0 + heroW)
    const x1 = x0 + heroW + W * 0.025
    /** The width for words beside the number, on a line at `y`. */
    const avail = (y: number, size: number) => Math.max(W * 0.1, W * 0.94 - x1 - room(y, size).r)
    const unitLabel = units === 'mi' ? 'MILES' : 'KM'
    const unitMax = Math.min(Math.max(base.stats * 1.1, MIN_TEXT_MM), cap.stats * 1.2)
    const unitSize = fit(unitLabel, unitMax, avail(baseline, unitMax), 1.1)
    items.push(el('hero-unit', x1, baseline, '', 800, unitSize, ` letter-spacing="${fmt(unitSize * 0.1)}"`, unitLabel))
    extent(x1, x1 + textWidth(unitLabel, unitSize) * 1.1)
    let y = top + band * 0.38
    if (title) {
      const max = Math.min(base.title * 0.62, cap.title * 0.7)
      const size = fit(title, max, avail(y, max))
      items.push(el('title', x1, y, '', 800, size, '', escapeXml(title)))
      extent(x1, x1 + textWidth(title, size))
      y += Math.min(base.subtitle, cap.subtitle) * 1.6
    }
    if (subtitle) {
      const max = Math.min(base.subtitle, cap.subtitle)
      const size = fit(subtitle, max, avail(y, max), 0.85)
      items.push(el('subtitle', x1, y, '', 500, size, '', escapeXml(subtitle)))
      extent(x1, x1 + textWidth(subtitle, size) * 0.85)
      y += size * 1.5
    }
    if (legendItems.length) {
      const w = legendWidth(legendBase)
      const ly = Math.min(y + legendBase * 0.4, baseline - unitSize * 1.6)
      const room_ = avail(ly, legendBase)
      const size = w > room_ ? legendBase * (room_ / w) : legendBase
      items.push(legendAt(x1, Math.min(y + size * 0.4, baseline - unitSize * 1.6), size))
    }
  } else {
    const center = t.align === 'center'
    const x = center ? W / 2 : W * 0.06
    const anchor = center ? ' text-anchor="middle"' : ''
    const span = (w: number): [number, number] => (center ? [x - w / 2, x + w / 2] : [x, x + w])
    /** The width a line at `y` may take. Centred text stays centred, so it gives up the room on both sides. */
    const avail = (y: number, size: number) => {
      const { l, r } = room(y, size)
      return Math.max(W * 0.2, W * 0.88 - (center ? 2 * Math.max(l, r) : l + r))
    }
    if (title) {
      // Long titles shrink to fit the page instead of running off it.
      const y = top + band * 0.45
      const max = Math.min(base.title, cap.title)
      const size = fit(title, max, avail(y, max))
      items.push(el('title', x, y, anchor, 800, size, '', escapeXml(title)))
      extent(...span(textWidth(title, size)))
    }
    if (subtitle) {
      const y = top + band * 0.66
      const max = Math.min(base.subtitle, cap.subtitle)
      const size = fit(subtitle, max, avail(y, max), 0.85)
      items.push(el('subtitle', x, y, anchor, 500, size, '', escapeXml(subtitle)))
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
    const statsY = top + band * 0.85
    const statsMax = Math.min(base.stats, cap.stats)
    const statsAvail = avail(statsY, statsMax)
    // The key shares the stats line when there is room for both, and takes its own line when not.
    const keyW = legendItems.length ? legendWidth(legendBase) : 0
    const shareRow = !center && statsLine && keyW > 0 && textWidth(statsLine, statsMax) * 1.12 + W * 0.04 + keyW <= statsAvail
    if (statsLine) {
      const size = fit(statsLine, statsMax, shareRow ? statsAvail - keyW - W * 0.04 : statsAvail, 1.12)
      items.push(el('stats', x, statsY, anchor, 700, size, ` letter-spacing="${fmt(size * 0.08)}"`, escapeXml(statsLine)))
      const w = textWidth(statsLine, size) * 1.12
      extent(...span(w))
      statsEnd = x + w
    }
    if (legendItems.length) {
      const ly = shareRow || !statsLine ? statsY : top + band * 0.97
      const lAvail = shareRow ? statsAvail : avail(ly, legendBase)
      const size = keyW > lAvail ? legendBase * (lAvail / keyW) : legendBase
      const w = legendWidth(size)
      const lx = shareRow ? W * 0.94 - room(ly, legendBase).r - w : center ? W / 2 - w / 2 : x
      items.push(legendAt(Math.max(lx, shareRow ? statsEnd + W * 0.04 : 0), ly, size))
    }
  }
  // Over the map, the plate also goes behind whatever sits in the band.
  if (t.placement === 'over') for (const b of plan.band) extent(b.x0, b.x1)
  if (!items.length && !(plan.band.length && t.placement === 'over')) return ''
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

// ---- The scale bar, compass and coordinates ----

type Corner = Exclude<FurniturePlace, 'band'>
const FURNITURE_NAMES = { 'scale-bar': 'Scale bar', compass: 'Compass', coordinates: 'Coordinates' } as const
type FurnitureId = keyof typeof FURNITURE_NAMES

/** Where the scale bar, compass and coordinates land on this page. */
export interface FurniturePlan {
  /** Each piece placed on the page, with the knockout halo it needs (0 where it sits on empty shirt). */
  pieces: { id: FurnitureId; piece: Piece; halo: number }[]
  /** The boxes they take in the text band, so the lines beside them make room. */
  band: Box[]
  /** For centred text, the coordinates go at the end of the subtitle line instead. */
  subtitleCoords: string
}

/** Label size and line width for the furniture. Light ink on a dark shirt gets 2 pt lines, as the print check asks. */
export function furniturePen(frame: Frame, style: Style): Pen {
  const paper = normColor(knockout(style))
  const ink = normColor(safeColor(style.text.color, '#111111'))
  const heavy = luminance(paper) < 0.2 && luminance(ink) > luminance(paper)
  return { size: Math.max(textSizes(frame).small * 0.9, MIN_TEXT_MM), min: MIN_TEXT_MM, line: (heavy ? 2 : 1.25) * MM_PER_PT }
}

/** A piece built at the origin, then moved so its box starts at (x, y) or, when `right`, ends at x. */
function placed(build: (x: number, y: number) => Piece, x: number, y: number, right: boolean): Piece {
  const probe = build(0, 0).box
  return build(x - (right ? probe.x1 : probe.x0), y - probe.y0)
}

/** A piece built at the origin, then moved so its box ends at x (or starts there) and sits on y. */
function seated(build: (x: number, y: number) => Piece, x: number, bottom: number, right: boolean): Piece {
  const probe = build(0, 0).box
  return build(x - (right ? probe.x1 : probe.x0), bottom - probe.y1)
}

/**
 * Lay out the scale bar, compass and coordinates. In a corner of the map they stack, compass on top, lined
 * up on that corner's side, with a halo so they read over the streets. In the text band they sit under the
 * title's line, so a long title keeps the whole width: at the right for text on the left, the coordinates
 * opposite the subtitle or under the other two; and at both ends for centred text, which takes the
 * coordinates into its subtitle. Without text there is no band, so all of them go to the corner (bottom
 * right when the band was asked for).
 */
export function planFurniture(frame: Frame, style: Style, routes: RouteItem[], routeKm: number[]): FurniturePlan {
  const fu = style.furniture
  const t = style.text
  const plan: FurniturePlan = { pieces: [], band: [], subtitleCoords: '' }
  if (!fu.scale && !fu.compass && !fu.coords) return plan
  const W = frame.widthMm
  const map = mapFrame(frame, style)
  const pen = furniturePen(frame, style)
  const scaleIn: ScaleInput = { style: fu.scaleStyle, mmPerKm: frame.widthMm / frame.widthKm, mapKm: frame.widthKm, units: style.distance.units, pen }
  const coords = fu.coords ? formatCoords(coordsAt(frame, routes, fu.coordsOf), fu.coordFormat) : ''
  const band = t.show
  const inBand = band && fu.place === 'band' && (fu.scale || fu.compass)

  if (band && (inBand || coords)) {
    const top = t.placement === 'below' ? map.heightMm : frame.heightMm * (1 - BAND)
    const h = frame.heightMm * BAND
    const hero = t.hero && (!!t.heroValue.trim() || routeKm.some((k) => k > 0))
    const centred = t.align === 'center' && !hero
    // Everything here sits clear under the title's line, so the title keeps the whole width.
    const titleMax = hero ? Math.min(textSizes(frame).title * 0.62, h * 0.28) : Math.min(textSizes(frame).title, h * 0.4)
    const ceiling = top + h * (hero ? 0.38 : 0.45) + titleMax * 0.25
    const statsY = top + h * 0.85
    const add = (id: FurnitureId, piece: Piece) => {
      plan.pieces.push({ id, piece, halo: 0 })
      plan.band.push(piece.box)
    }
    /** A compass shrunk, if need be, to fit between the ceiling and `bottom`. */
    const fitted = (x: number, bottom: number, right: boolean) => {
      const full = compass(fu.compassStyle, 0, 0, pen).box
      const k = Math.min(1, Math.max(0.4, (bottom - ceiling) / (full.y1 - full.y0)))
      return seated((cx, y) => compass(fu.compassStyle, cx, y, pen, k), x, bottom, right)
    }
    if (centred) {
      if (coords) plan.subtitleCoords = coords
      if (inBand) {
        // Centred text keeps its middle: the compass at the left end, a shorter scale bar at the right.
        if (fu.compass) add('compass', fitted(W * 0.06, statsY, false))
        if (fu.scale) add('scale-bar', seated((x, y) => scaleBar({ ...scaleIn, share: 1 / 7 }, x, y), W * 0.94, statsY, true))
      }
    } else {
      let bottom = statsY
      if (coords) {
        const size = Math.max(Math.min(textSizes(frame).stats, h * 0.13) * 0.82, MIN_TEXT_MM)
        // Opposite the subtitle, or on the bottom line when the scale bar and compass sit above it.
        const line = coordsLine(coords, W * 0.94, inBand ? statsY : top + h * 0.66, size, 'end')
        add('coordinates', line)
        if (inBand) bottom = line.box.y0 - pen.size * 0.9
      }
      if (inBand) {
        let edge = W * 0.94
        if (fu.compass) {
          const c = fitted(edge, bottom, true)
          add('compass', c)
          edge = c.box.x0 - pen.size * 1.6
        }
        if (fu.scale) add('scale-bar', seated((x, y) => scaleBar(scaleIn, x, y), edge, bottom, true))
      }
    }
  }

  // The corner stack: compass, then scale bar, then the coordinates when there is no band for them.
  const stack: { id: FurnitureId; build: (x: number, y: number) => Piece }[] = []
  if (!inBand && fu.compass) stack.push({ id: 'compass', build: (x, y) => compass(fu.compassStyle, x, y, pen) })
  if (!inBand && fu.scale) stack.push({ id: 'scale-bar', build: (x, y) => scaleBar(scaleIn, x, y) })
  if (!band && coords) stack.push({ id: 'coordinates', build: (x, y) => coordsLine(coords, x, y, pen.size, 'start') })
  if (stack.length) {
    const corner: Corner = fu.place === 'band' ? 'bottom-right' : fu.place
    const right = corner.endsWith('right')
    // A rounded frame's corners are cut away, so the stack sits further in to stay on the map.
    const short = Math.min(map.widthMm, map.heightMm)
    const m = style.shape === 'rounded' ? Math.max(W * 0.04, short * 0.03 + short * 0.06 * 0.3 + pen.size * 0.6) : W * 0.04
    // Text over the map covers its bottom fifth, so the bottom corners sit above it.
    const floor = band && t.placement === 'over' ? frame.heightMm * (1 - BAND) : map.heightMm
    const gaps = stack.map((it) => (it.id === 'compass' ? pen.size * 1.6 : pen.size * 0.9))
    const heights = stack.map((it) => {
      const b = it.build(0, 0).box
      return b.y1 - b.y0
    })
    const total = heights.reduce((a, b) => a + b, 0) + gaps.slice(0, -1).reduce((a, b) => a + b, 0)
    let y = corner.startsWith('bottom') ? floor - m - total : m
    stack.forEach((it, i) => {
      plan.pieces.push({ id: it.id, piece: placed(it.build, right ? map.widthMm - m : m, y, right), halo: pen.size * 0.22 })
      y += (heights[i] as number) + (gaps[i] as number)
    })
  }
  return plan
}

interface Paint {
  ink: string
  accent: string
  knock: string
}

/** Marks as SVG: a halo in the knockout colour behind them when `halo` is above 0, then the ink. */
function marksSvg(marks: Mark[], c: Paint, halo: number, ctx: Ctx): string {
  let back = ''
  let front = ''
  for (const m of marks) {
    if (m.kind === 'path') {
      const fill = m.fill === 'accent' ? c.accent : m.fill === 'ink' ? c.ink : 'none'
      if (halo) back += `<path d="${m.d}" fill="${m.fill ? c.knock : 'none'}" stroke="${c.knock}" stroke-width="${fmt((m.stroke ?? 0) + halo * 2)}"/>`
      if (m.fill) ctx.use(fill)
      if (m.stroke) ctx.use(c.ink)
      front += `<path d="${m.d}" fill="${fill}"${m.stroke ? ` stroke="${c.ink}" stroke-width="${fmt(m.stroke)}"` : ''}/>`
    } else {
      const anchor = m.anchor === 'start' ? '' : ` text-anchor="${m.anchor}"`
      const attrs = `x="${fmt(m.x)}" y="${fmt(m.y)}"${anchor} font-family="${FONT}" font-weight="${m.weight}" font-size="${fmt(m.size)}"${m.spacing ? ` letter-spacing="${fmt(m.spacing)}"` : ''}`
      ctx.text(m.size)
      if (halo && !m.knockout) back += `<text ${attrs} fill="${c.knock}" stroke="${c.knock}" stroke-width="${fmt(halo * 2)}">${escapeXml(m.text)}</text>`
      ctx.use(m.knockout ? c.knock : c.ink)
      front += `<text ${attrs} fill="${m.knockout ? c.knock : c.ink}">${escapeXml(m.text)}</text>`
    }
  }
  if (halo) ctx.use(c.knock)
  return back + front
}

/** Draw the plan, each piece in its own group, so it arrives in Illustrator ready to move or delete. */
function drawFurniture(plan: FurniturePlan, style: Style, ctx: Ctx): string[] {
  const c: Paint = { ink: safeColor(style.text.color, '#111111'), accent: safeColor(style.pinColor, '#e4572e'), knock: knockout(style) }
  return plan.pieces.map(({ id, piece, halo }) =>
    `<g id="${id}" data-name="${FURNITURE_NAMES[id]}" stroke-linecap="round" stroke-linejoin="round">${marksSvg(piece.marks, c, halo, ctx)}</g>`)
}

const PREVIEW_PEN: Pen = { size: 3, min: 2.4, line: 0.55 }
const NO_CTX: Ctx = { use: () => {}, text: () => {} }

function previewSvg(piece: Piece, c: Paint, w: number, h: number): string {
  const b = piece.box
  const pad = 1.2
  const vb = `${fmt(b.x0 - pad)} ${fmt(b.y0 - pad)} ${fmt(b.x1 - b.x0 + pad * 2)} ${fmt(b.y1 - b.y0 + pad * 2)}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}" aria-hidden="true"><g stroke-linecap="round" stroke-linejoin="round">${marksSvg(piece.marks, c, 0, NO_CTX)}</g></svg>`
}

/** A scale bar style drawn small for the picker in the app, showing one round unit. The same drawing as the print. */
export function scalePreviewSvg(style: ScaleStyle, units: 'km' | 'mi', ink: string, w: number, h: number): string {
  const unit = units === 'mi' ? KM_PER_MI : 1
  const piece = scaleBar({ style, units, mmPerKm: 30 / unit, mapKm: 4 * unit, pen: PREVIEW_PEN }, 0, 0)
  const c = safeColor(ink, '#111111')
  return previewSvg(piece, { ink: c, accent: c, knock: c }, w, h)
}

/** A compass style drawn small for the picker in the app. The same drawing as the print. */
export function compassPreviewSvg(style: CompassStyle, ink: string, accent: string, knock: string, w: number, h: number): string {
  const c = { ink: safeColor(ink, '#111111'), accent: safeColor(accent, '#e4572e'), knock: safeColor(knock, '#ffffff') }
  return previewSvg(compass(style, 0, 0, PREVIEW_PEN), c, w, h)
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
