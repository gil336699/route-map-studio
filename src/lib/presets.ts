// Starting looks, drawn from real running-club and race-map designs (see docs/RESEARCH.md).
// A look sets every colour and the composition, but never the user's own text.
import { defaultInks } from '../map/inks'
import type { Detail, Frame, LayerId, Style, TextStyle } from '../map/types'

type LayerRow = { show: boolean; color: string; widthPt: number }
const L = (show: boolean, color: string, widthPt: number): LayerRow => ({ show, color, widthPt })
type LayerRow2 = LayerRow & { outline?: boolean }

export interface Look {
  id: string
  label: string
  /** One line on where the look comes from and what it suits. */
  note: string
  style: Style
}

const TEXT: TextStyle = {
  show: true,
  title: 'CLUB NAME',
  subtitle: 'Training route · Philadelphia',
  stats: true,
  placement: 'below',
  align: 'left',
  color: '#111111',
  hero: false,
  heroValue: '',
  legend: false,
  credit: true,
}

/** No names typed yet: the key uses each icon's own name (see ICONS). */
export const LEGEND_NAMES: Style['legendNames'] = {}

function look(
  id: string,
  label: string,
  note: string,
  base: { background: string; transparent?: boolean; shirt: string; shape?: Style['shape'] },
  layers: Record<LayerId, LayerRow2>,
  route: Partial<Style['route']> & { outlineColor: string },
  more: { text: Partial<TextStyle>; pinColor: string; markers?: boolean },
): Look {
  return {
    id,
    label,
    note,
    style: {
      background: base.background,
      transparent: base.transparent ?? false,
      shirt: base.shirt,
      shape: base.shape ?? 'rect',
      layers,
      route: { widthPt: 4, outline: true, markers: true, ...route },
      distance: { units: 'km', markers: more.markers ?? false, every: 1 },
      pinColor: more.pinColor,
      legendNames: { ...LEGEND_NAMES },
      text: { ...TEXT, ...more.text },
      separatePaths: false,
      inkLimit: 0,
      inkColors: ['#111111', '#e4572e', '#888888'],
    },
  }
}

export const LOOKS: Look[] = [
  look('marathon', 'Marathon shirt', 'One white ink on a red shirt: a bold route, the river banks, landmark icons and a huge distance, like a city half-marathon tee.',
    { background: '#c8102e', transparent: true, shirt: '#c8102e' },
    {
      parks: L(false, '#ffffff', 0), water: { show: true, color: '#ffffff', widthPt: 2, outline: true }, buildings: L(false, '#ffffff', 0),
      railways: L(false, '#ffffff', 2), paths: L(false, '#ffffff', 2), minor: L(false, '#ffffff', 2), major: L(true, '#ffffff', 2),
    },
    { outlineColor: '#c8102e', widthPt: 7 },
    { text: { color: '#ffffff', placement: 'over', hero: true, legend: true }, pinColor: '#ffffff' }),
  look('vintage', 'Vintage', 'Muted retro colours on a cream shirt, the 2026 club-shirt mood. Six colours, so best printed DTG.',
    { background: '#f2ede1', transparent: true, shirt: '#f2ede1' },
    {
      parks: L(true, '#d5dcc4', 0), water: L(true, '#b7cbd3', 0), buildings: L(false, '#e2dccd', 0),
      railways: L(false, '#a99f8c', 1), paths: L(true, '#b9ad97', 1), minor: L(true, '#b9ad97', 1), major: L(true, '#7a6e5c', 2.2),
    },
    { outlineColor: '#f2ede1' },
    { text: { color: '#3b3127' }, pinColor: '#c8553d' }),
  look('night-neon', 'Night neon', 'Dark streets with one volt route and kilometre marks, like Nike’s city run maps. Five inks on black.',
    { background: '#0d0f12', transparent: true, shirt: '#0d0f12' },
    {
      parks: L(false, '#141a16', 0), water: L(true, '#1d2733', 0), buildings: L(false, '#1b1f25', 0),
      railways: L(false, '#2e333b', 2), paths: L(true, '#3a404a', 2), minor: L(true, '#3a404a', 2), major: L(true, '#5b6370', 3),
    },
    { outlineColor: '#0d0f12', widthPt: 4.5 },
    { text: { color: '#f2f4f7', placement: 'over' }, pinColor: '#d7ff3a', markers: true }),
  look('race-red', 'Race red', 'Black shirt, faint city and one bold red course, like a marathon poster. Five inks.',
    { background: '#0b0b0b', transparent: true, shirt: '#0b0b0b' },
    {
      parks: L(false, '#161616', 0), water: L(true, '#1c1c1c', 0), buildings: L(false, '#1a1a1a', 0),
      railways: L(false, '#2b2b2b', 2), paths: L(false, '#2b2b2b', 2), minor: L(true, '#3a3a3a', 2), major: L(true, '#5a5a5a', 3),
    },
    { outlineColor: '#0b0b0b', widthPt: 5 },
    { text: { color: '#ffffff' }, pinColor: '#ff2d2d' }),
  look('emblem', 'Emblem', 'Every street in one light ink inside a circle, the route in a second ink, and a title block. Two inks.',
    { background: '#13213a', transparent: true, shirt: '#13213a', shape: 'circle' },
    {
      parks: L(false, '#e8ecf2', 0), water: L(true, '#e8ecf2', 0), buildings: L(false, '#e8ecf2', 0),
      railways: L(false, '#e8ecf2', 2), paths: L(true, '#e8ecf2', 2), minor: L(true, '#e8ecf2', 2), major: L(true, '#e8ecf2', 3.2),
    },
    { outlineColor: '#13213a', widthPt: 5 },
    { text: { color: '#e8ecf2', align: 'center' }, pinColor: '#e8ecf2' }),
  look('tonal', 'Tonal', 'A map one shade lighter than the navy shirt and a quiet route. Subtle, like a trail jersey. Four inks.',
    { background: '#1c2a44', transparent: true, shirt: '#1c2a44' },
    {
      parks: L(false, '#2a3b5c', 0), water: L(true, '#26375a', 0), buildings: L(false, '#2a3b5c', 0),
      railways: L(false, '#33466b', 2), paths: L(true, '#33466b', 2), minor: L(true, '#33466b', 2), major: L(true, '#40557e', 3),
    },
    { outlineColor: '#1c2a44', widthPt: 3.5 },
    { text: { color: '#a9c8ff' }, pinColor: '#a9c8ff' }),
  look('coastal', 'Coastal pins', 'Light teal streets with red pins for landmarks, like a city guide map. Five inks on white.',
    { background: '#ffffff', transparent: true, shirt: '#ffffff' },
    {
      parks: L(true, '#dcefe9', 0), water: L(true, '#a8d8cf', 0), buildings: L(false, '#e6f2ef', 0),
      railways: L(false, '#8cc7bb', 1), paths: L(true, '#a8d8cf', 1), minor: L(true, '#86c4b7', 1), major: L(true, '#1d5c55', 2.2),
    },
    { outlineColor: '#ffffff', widthPt: 4 },
    { text: { color: '#1d5c55' }, pinColor: '#e63946' }),
  look('city-blue', 'City blue', 'Dense blue streets and a red route, bright and graphic. Five inks on white.',
    { background: '#ffffff', transparent: true, shirt: '#ffffff' },
    {
      parks: L(true, '#d6e2fb', 0), water: L(true, '#9fbaf3', 0), buildings: L(false, '#dbe5fb', 0),
      railways: L(false, '#6f95e6', 1), paths: L(true, '#5a86e3', 1), minor: L(true, '#5a86e3', 1), major: L(true, '#1f3f99', 2.2),
    },
    { outlineColor: '#ffffff', widthPt: 4.5 },
    { text: { color: '#1f3f99' }, pinColor: '#ef3b3b' }),
  look('one-ink', '1 ink, light shirt', 'Black only. The cheapest screen print, and it works on any light shirt.',
    { background: '#ffffff', transparent: true, shirt: '#e9e9e6' },
    {
      parks: L(false, '#111111', 0), water: L(true, '#111111', 0), buildings: L(false, '#111111', 0),
      railways: L(false, '#111111', 1), paths: L(false, '#111111', 1), minor: L(true, '#111111', 1), major: L(true, '#111111', 2),
    },
    { outlineColor: '#e9e9e6', widthPt: 7 },
    { text: { color: '#111111' }, pinColor: '#111111' }),
]

// The route colour lives on each route, not the look. This is the first route's colour for each look.
export const LOOK_ROUTE_COLOR: Record<string, string> = {
  marathon: '#ffffff',
  vintage: '#c8553d', 'night-neon': '#d7ff3a', 'race-red': '#ff2d2d', emblem: '#ffb000',
  tonal: '#a9c8ff', coastal: '#e63946', 'city-blue': '#ef3b3b', 'one-ink': '#111111',
}

/** Looks printed in a single ink. Extra routes keep that ink and are dashed instead of changing colour. */
export const ONE_INK_LOOKS = new Set(['marathon', 'one-ink'])

/** Colours for second and later routes, picked to stand apart from each other. */
export const EXTRA_ROUTE_COLORS = ['#2a9d8f', '#f4a261', '#8e5cd9', '#3a86ff', '#ff006e']

// Each look's inks come from its own colours: text, route and streets.
for (const l of LOOKS) l.style.inkColors = defaultInks(l.style, LOOK_ROUTE_COLOR[l.id] ?? '#e4572e')

export const DEFAULT_STYLE: Style = (LOOKS.find((l) => l.id === 'vintage') as Look).style

export const DEFAULT_DETAIL: Detail = { simplifyMm: 0.15, minLengthMm: 1.5, minAreaMm2: 1 }

export const DEFAULT_FRAME: Frame = {
  centerLon: -75.181,
  centerLat: 39.9656,
  widthKm: 6,
  widthMm: 12 * 25.4,
  heightMm: 14 * 25.4,
}
