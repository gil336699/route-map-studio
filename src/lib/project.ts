// Project files: settings, routes and pins, with a schema name and version so old files keep opening.
import { DEFAULT_DETAIL, DEFAULT_STYLE } from './presets'
import { LAYER_ORDER, type Detail, type Frame, type LonLat, type Pin, type Route, type RouteItem, type Style } from '../map/types'
import type { Unit } from './units'

export const SCHEMA = 'route-map-studio.project'
export const VERSION = 1

export interface ProjectState {
  frame: Frame
  style: Style
  detail: Detail
  routes: RouteItem[]
  pins: Pin[]
  buildings: boolean
  unit: Unit
}

export function serializeProject(state: ProjectState): string {
  return JSON.stringify({ schema: SCHEMA, version: VERSION, ...state }, null, 1)
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isPt = (v: unknown): v is LonLat => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])
const isLine = (v: unknown): v is LonLat[] => Array.isArray(v) && v.every(isPt)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

function readRoute(v: unknown): Route | null {
  const r = obj(v)
  if (!isLine(r.points) || !Array.isArray(r.legs) || !r.legs.every(isLine)) return null
  return { points: r.points, legs: r.legs as LonLat[][] }
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isColor = (v: unknown): v is string => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)
const color = (v: unknown, fallback: string) => (isColor(v) ? v : fallback)
const str = (v: unknown, fallback: string, max = 200) => (isStr(v) ? v.slice(0, max) : fallback)
const bool = (v: unknown, fallback: boolean) => (isBool(v) ? v : fallback)
const clampNum = (v: unknown, lo: number, hi: number, fallback: number) => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)
const PIN_ICON_IDS = ['dot', 'coffee', 'museum', 'water', 'star', 'flag', 'label'] as const

/** Every style setting checked against its type and range, falling back to the default one by one. */
function readStyle(v: unknown): Style {
  const s = obj(v)
  const d = DEFAULT_STYLE
  const layers = { ...d.layers }
  const sl = obj(s.layers)
  for (const id of LAYER_ORDER) {
    const l = obj(sl[id])
    const def = d.layers[id]
    layers[id] = {
      show: bool(l.show, def.show),
      color: color(l.color, def.color),
      widthPt: clampNum(l.widthPt, 0, 20, def.widthPt),
      ...(isBool(l.outline) ? { outline: l.outline } : def.outline ? { outline: def.outline } : {}),
    }
  }
  const r = obj(s.route)
  const di = obj(s.distance)
  const t = obj(s.text)
  const ln = obj(s.legendNames)
  const ink = Array.isArray(s.inkColors) && s.inkColors.length === 3 && s.inkColors.every(isColor)
    ? (s.inkColors as [string, string, string])
    : d.inkColors
  return {
    background: color(s.background, d.background),
    transparent: bool(s.transparent, d.transparent),
    shirt: color(s.shirt, d.shirt),
    shape: oneOf(s.shape, ['rect', 'rounded', 'circle'] as const, d.shape),
    layers,
    route: {
      widthPt: clampNum(r.widthPt, 0.5, 30, d.route.widthPt),
      outline: bool(r.outline, d.route.outline),
      outlineColor: color(r.outlineColor, d.route.outlineColor),
      markers: bool(r.markers, d.route.markers),
      dashed: bool(r.dashed, d.route.dashed),
    },
    distance: {
      units: oneOf(di.units, ['km', 'mi'] as const, d.distance.units),
      markers: bool(di.markers, d.distance.markers),
      every: clampNum(di.every, 0.1, 50, d.distance.every),
    },
    pinColor: color(s.pinColor, d.pinColor),
    legendNames: {
      coffee: str(ln.coffee, d.legendNames.coffee, 60),
      museum: str(ln.museum, d.legendNames.museum, 60),
      water: str(ln.water, d.legendNames.water, 60),
      star: str(ln.star, d.legendNames.star, 60),
      flag: str(ln.flag, d.legendNames.flag, 60),
    },
    text: {
      show: bool(t.show, d.text.show),
      title: str(t.title, d.text.title),
      subtitle: str(t.subtitle, d.text.subtitle),
      stats: bool(t.stats, d.text.stats),
      placement: oneOf(t.placement, ['below', 'over'] as const, d.text.placement),
      align: oneOf(t.align, ['left', 'center'] as const, d.text.align),
      color: color(t.color, d.text.color),
      hero: bool(t.hero, d.text.hero),
      heroValue: str(t.heroValue, d.text.heroValue, 20),
      legend: bool(t.legend, d.text.legend),
      credit: bool(t.credit, d.text.credit),
    },
    separatePaths: bool(s.separatePaths, d.separatePaths),
    inkLimit: s.inkLimit === 1 || s.inkLimit === 2 || s.inkLimit === 3 ? s.inkLimit : 0,
    inkColors: ink,
  }
}

/** Read a project file. Missing or damaged settings fall back to defaults. Throws a plain message on bad files. */
export function parseProject(text: string): ProjectState {
  let raw: Record<string, unknown>
  try {
    raw = obj(JSON.parse(text))
  } catch {
    throw new Error('This file is not a Route Map Studio project (it is not valid JSON).')
  }
  if (raw.schema !== SCHEMA) throw new Error('This file is not a Route Map Studio project.')
  if (!isNum(raw.version) || raw.version > VERSION) {
    throw new Error('This project was saved by a newer version of Route Map Studio. Update the app to open it.')
  }
  const f = obj(raw.frame)
  const frame: Frame = {
    centerLon: clampNum(f.centerLon, -180, 180, -75.181),
    centerLat: clampNum(f.centerLat, -85, 85, 39.9656),
    widthKm: clampNum(f.widthKm, 0.2, 40, 6),
    widthMm: clampNum(f.widthMm, 25, 1500, 304.8),
    heightMm: clampNum(f.heightMm, 25, 1500, 355.6),
  }
  const style = readStyle(raw.style)
  const dd = obj(raw.detail)
  const detail: Detail = {
    simplifyMm: clampNum(dd.simplifyMm, 0, 5, DEFAULT_DETAIL.simplifyMm),
    minLengthMm: clampNum(dd.minLengthMm, 0, 100, DEFAULT_DETAIL.minLengthMm),
    minAreaMm2: clampNum(dd.minAreaMm2, 0, 1000, DEFAULT_DETAIL.minAreaMm2),
  }
  const routes: RouteItem[] = []
  if (Array.isArray(raw.routes)) {
    raw.routes.forEach((item, i) => {
      const o = obj(item)
      const route = readRoute(o.route)
      if (!route) return
      routes.push({
        id: isStr(o.id) ? o.id : `r${i + 1}`,
        name: str(o.name, `Route ${i + 1}`, 80),
        color: color(o.color, '#e4572e'),
        route,
        ...(isBool(o.dashed) ? { dashed: o.dashed } : {}),
      })
    })
  }
  const pins: Pin[] = []
  if (Array.isArray(raw.pins)) {
    raw.pins.forEach((item, i) => {
      const o = obj(item)
      if (!isPt(o.at)) return
      const icon = PIN_ICON_IDS.includes(o.icon as (typeof PIN_ICON_IDS)[number]) ? (o.icon as Pin['icon']) : undefined
      pins.push({ id: isStr(o.id) ? o.id : `p${i + 1}`, at: o.at, label: str(o.label, '', 80), ...(icon ? { icon } : {}) })
    })
  }
  const unit = raw.unit === 'mm' || raw.unit === 'in' || raw.unit === 'pt' || raw.unit === 'px' ? raw.unit : 'in'
  return { frame, style, detail, routes, pins, buildings: raw.buildings === true, unit }
}
