// Shared types for the map engine. Plain data only, so everything here is testable without React.

/** A position as [longitude, latitude] in degrees (the GeoJSON order). */
export type LonLat = [number, number]
/** A position on the page in millimetres, y pointing down. */
export type XY = [number, number]

export type LayerId = 'parks' | 'water' | 'buildings' | 'railways' | 'paths' | 'minor' | 'major'

/** Layers from the bottom of the stack to the top. Export keeps this order. */
export const LAYER_ORDER: LayerId[] = ['parks', 'water', 'buildings', 'railways', 'paths', 'minor', 'major']

export const LAYER_NAMES: Record<LayerId, string> = {
  parks: 'Parks',
  water: 'Water',
  buildings: 'Buildings',
  railways: 'Railways',
  paths: 'Paths and trails',
  minor: 'Streets',
  major: 'Main roads',
}

/** A piece of map data. Areas hold rings (filled even-odd); lines hold open polylines. */
export interface Feature {
  layer: LayerId
  kind: 'line' | 'area'
  parts: LonLat[][]
  /** The OSM highway value, for road lines. Routing uses it to skip motorways. */
  hw?: string
}

export interface BBox {
  west: number
  south: number
  east: number
  north: number
}

/** The route: clicked or imported points, plus the line between each pair. */
export interface Route {
  points: LonLat[]
  /** legs[i] joins points[i] to points[i + 1]. */
  legs: LonLat[][]
}

/** One of the club's routes. A design can show several, each in its own colour. */
export interface RouteItem {
  id: string
  name: string
  color: string
  route: Route
  /** Dashed instead of solid, so a second route can share the first one's ink. */
  dashed?: boolean
}

export type PinIcon = 'dot' | 'coffee' | 'museum' | 'water' | 'star' | 'flag' | 'label'

export const PIN_ICONS: { id: PinIcon; label: string }[] = [
  { id: 'dot', label: 'Dot' },
  { id: 'coffee', label: 'Coffee' },
  { id: 'museum', label: 'Museum' },
  { id: 'water', label: 'Water' },
  { id: 'star', label: 'Star' },
  { id: 'flag', label: 'Flag' },
  { id: 'label', label: 'Text only' },
]

/** A labelled spot such as the start, a landmark, a coffee stop or a water fountain. */
export interface Pin {
  id: string
  at: LonLat
  label: string
  icon?: PinIcon
}

/** A point of interest found in the map data, which can be turned into a pin. */
export interface Place {
  id: string
  name: string
  kind: 'coffee' | 'museum' | 'water' | 'sight'
  at: LonLat
}

export interface Frame {
  centerLon: number
  centerLat: number
  /** Real-world width of the map, in km. Smaller means zoomed in. */
  widthKm: number
  /** Page size in mm. */
  widthMm: number
  heightMm: number
}

export interface LayerStyle {
  show: boolean
  color: string
  /** Line width in pt for lines. For areas, the outline width (0 for none). */
  widthPt: number
  /** Areas only: draw the edge and leave the inside empty, like a river drawn as its banks. */
  outline?: boolean
}

export type Shape = 'rect' | 'rounded' | 'circle'

export interface TextStyle {
  show: boolean
  title: string
  subtitle: string
  /** Add a line with each route's distance. */
  stats: boolean
  placement: 'below' | 'over'
  align: 'left' | 'center'
  color: string
  /** Show the first route's distance as a huge number, like the 13.1 on a half-marathon shirt. */
  hero: boolean
  /** The big number as typed, such as 13.1. Empty means the first route's length. */
  heroValue: string
  /** Add a key for the pin icons, such as a cup for coffee stops. */
  legend: boolean
  /** Credit OpenStreetMap on the print, as its licence asks. It can go on the shirt's tag instead. */
  credit: boolean
}

export interface Style {
  background: string
  /** Leave the background out of the file, so the shirt shows through. */
  transparent: boolean
  /** Shirt colour, for the preview and the print check. Never exported. */
  shirt: string
  shape: Shape
  layers: Record<LayerId, LayerStyle>
  route: { widthPt: number; outline: boolean; outlineColor: string; markers: boolean; dashed: boolean }
  distance: { units: 'km' | 'mi'; markers: boolean; every: number }
  pinColor: string
  /** What each pin icon means, for the legend. */
  legendNames: Record<'coffee' | 'museum' | 'water' | 'star' | 'flag', string>
  text: TextStyle
  /** Keep every road and shape as its own path instead of one compound path per layer. */
  separatePaths: boolean
  /** Hold the design to 1, 2 or 3 inks for screen printing. 0 means any number of colours. */
  inkLimit: 0 | 1 | 2 | 3
  /** The inks, by role: main (roads and text), accent (routes and pins), quiet (streets and water). */
  inkColors: [string, string, string]
}

export interface Detail {
  /** How far a simplified line may stray from the original, in mm on the page. */
  simplifyMm: number
  /** Drop lines shorter than this, in mm on the page. */
  minLengthMm: number
  /** Drop shapes smaller than this, in mm² on the page. */
  minAreaMm2: number
}

export interface SceneStats {
  byLayer: Record<LayerId, number>
  paths: number
  bytes: number
  /** Length of each route, in km, in the order given. */
  routeKm: number[]
  /** Every ink the file uses, as #rrggbb, with the shirt colour left out where it shows through. */
  inks: string[]
  /** The smallest text set, in points, or null when there is no text. */
  minTextPt: number | null
}
