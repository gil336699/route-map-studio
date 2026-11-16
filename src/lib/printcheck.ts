// A print check a screen printer would do: thin lines, small text, and how many inks the design needs.
// Thresholds come from printers' artwork guides (docs/RESEARCH.md): lines at least 1 pt, 2 pt for light
// ink on a dark shirt, and text at least 8 pt. Printers differ, so the check advises and never blocks.
import { applyInks } from '../map/inks'
import { MM_PER_PT, normColor, textSizes } from '../map/scene'
import { LAYER_NAMES, LAYER_ORDER, type Frame, type Pin, type RouteItem, type SceneStats, type Style } from '../map/types'

export interface PrintCheck {
  /** Every distinct ink the file uses, shirt colour excluded when the background is left out. */
  inks: string[]
  warnings: string[]
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 0
  const n = parseInt(m[1] as string, 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number)
}

/**
 * Check a design for print. Given what the scene really drew (`scene`), the inks and the smallest text
 * come from the file itself, and only layers that reached the page are checked. Without it, the check
 * works from the settings alone.
 */
export function printCheck(input: Style, inputRoutes: RouteItem[], pins: Pin[], frame: Frame, scene?: SceneStats): PrintCheck {
  const { style, routes } = applyInks(input, inputRoutes)
  const paper = style.transparent ? style.shirt : style.background
  const dark = luminance(paper) < 0.2
  const inks = new Set<string>()
  const warnings: string[] = []
  if (!style.transparent) inks.add(style.background.toLowerCase())

  const minFor = (ink: string) => (dark && luminance(ink) > luminance(paper) ? 2 : 1)
  const thin = (what: string, pt: number, ink: string) => {
    const min = minFor(ink)
    if (pt < min) {
      warnings.push(
        `${what} are ${pt} pt. Screen printers usually need at least ${min} pt${min === 2 ? ' for light ink on a dark shirt' : ''}, or the lines fill in or break up.`,
      )
    }
  }

  for (const id of LAYER_ORDER) {
    const ls = style.layers[id]
    if (!ls.show || (scene && scene.byLayer[id] === 0)) continue
    inks.add(ls.color.toLowerCase())
    const isArea = id === 'parks' || id === 'water' || id === 'buildings'
    if (!isArea || ls.outline) thin(LAYER_NAMES[id], ls.outline ? Math.max(ls.widthPt, 1) : ls.widthPt, ls.color)
  }
  const drawn = routes.filter((r) => r.route.points.length > 1)
  for (const r of drawn) inks.add(r.color.toLowerCase())
  if (drawn.length) {
    thin('Route lines', style.route.widthPt, drawn[0]?.color ?? '#000000')
    if (style.route.outline) inks.add(style.route.outlineColor.toLowerCase())
  }
  if (pins.length) inks.add(style.pinColor.toLowerCase())
  if (scene) {
    if (scene.minTextPt !== null && scene.minTextPt < 7.99) {
      warnings.push(`The smallest text is ${scene.minTextPt.toFixed(1)} pt. Printed text should be at least 8 pt. Make the page bigger or the words shorter.`)
    }
    return { inks: scene.inks, warnings }
  }
  if (style.text.show) {
    inks.add(style.text.color.toLowerCase())
    const sizes = textSizes(frame)
    const smallest = Math.min(style.text.subtitle.trim() ? sizes.subtitle : Infinity, style.text.stats ? sizes.stats : Infinity)
    if (smallest / MM_PER_PT < 8) {
      warnings.push(`The smallest text is ${(smallest / MM_PER_PT).toFixed(1)} pt. Printed text should be at least 8 pt. Make the page bigger.`)
    }
  }
  // An ink the same colour as the shirt prints nothing you can see, so it is not counted.
  if (style.transparent) inks.delete(style.shirt.toLowerCase())
  return { inks: [...new Set([...inks].map(normColor))], warnings }
}
