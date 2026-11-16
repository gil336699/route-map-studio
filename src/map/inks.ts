// Ink limits for screen printing. Each ink is a separate screen and a separate cost, so a club shirt is
// often held to one, two or three inks. With a limit set, every colour in the design is mapped onto
// that many inks by role, and the shirt itself shows through as the background.
import { LAYER_ORDER, type LayerId, type RouteItem, type Style } from './types'

export type InkLimit = 0 | 1 | 2 | 3

/** What each ink is used for, by limit. Shown in the app next to the ink colour pickers. */
export const INK_ROLES: Record<1 | 2 | 3, string[]> = {
  1: ['Everything'],
  2: ['Map', 'Route, pins, markers and text'],
  3: ['Main roads and text', 'Route, pins and markers', 'Streets, paths and water'],
}

/** Which of the look's colours start each ink: [main, accent, quiet]. */
export function defaultInks(style: Style, routeColor: string): [string, string, string] {
  return [style.text.color, routeColor, style.layers.minor.color]
}

/** The ink colours, in role order, for a limit. Ink 1 is always first. */
export function inksFor(limit: 1 | 2 | 3, colors: [string, string, string]): string[] {
  const [main, accent, quiet] = colors
  if (limit === 1) return [main]
  if (limit === 2) return [quiet, accent]
  return [main, accent, quiet]
}

/** The design as it prints under the ink limit. With no limit, returns the input unchanged. */
export function applyInks(style: Style, routes: RouteItem[]): { style: Style; routes: RouteItem[] } {
  const n = style.inkLimit
  if (!n) return { style, routes }
  const [main, accent, quiet] = style.inkColors
  // Map each role onto an ink. With fewer inks, roles share.
  const mapInk = n === 1 ? main : quiet
  const roadInk = n === 3 ? main : mapInk
  const accentInk = n === 1 ? main : accent
  const textInk = n === 2 ? accent : main
  const layers = { ...style.layers }
  for (const id of LAYER_ORDER) {
    const color: Record<LayerId, string> = {
      parks: mapInk, water: mapInk, buildings: mapInk, railways: mapInk, paths: mapInk, minor: mapInk, major: roadInk,
    }
    // Parks would need an ink of their own to read as parks, so an ink limit leaves them out.
    layers[id] = { ...layers[id], color: color[id], show: id === 'parks' ? false : layers[id].show }
  }
  return {
    style: {
      ...style,
      transparent: true,
      layers,
      // An outline in the shirt colour is a knockout: no ink at all.
      // With one ink the route can only stand out by weight, so it gets half again as heavy.
      route: { ...style.route, outlineColor: style.shirt, widthPt: n === 1 ? style.route.widthPt * 1.5 : style.route.widthPt },
      pinColor: accentInk,
      text: { ...style.text, color: textInk },
    },
    routes: routes.map((r, i) => ({ ...r, color: i === 0 ? accentInk : n === 3 ? main : mapInk })),
  }
}
