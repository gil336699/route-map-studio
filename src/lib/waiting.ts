// The card over the print while it waits for a map, so the print never sits blank without saying why.
import type { LayerId } from '../map/types'

export interface Waiting {
  /** A download is running. */
  downloading: boolean
  /** Words to show while the app gets a picture ready itself, as the example does while it works out its route. */
  preparing: string | null
  /** The number of the newest map downloaded, or null before the first. */
  loadedMapId: number | null
  /** The picture on screen: the number of the map it was drawn from (0 for none) and what it shows. */
  shown: { mapId: number; byLayer: Record<LayerId, number> } | null
}

/** What the card says, or null for no card. A picture that shows some of an older map needs none. */
export function waitingCard(w: Waiting): string | null {
  const blank = !w.shown || Object.values(w.shown.byLayer).every((n) => n === 0)
  if (w.downloading && blank) return 'Downloading the map…'
  if (w.preparing) return w.preparing
  // The map has arrived but the picture on screen was drawn before it.
  if (w.loadedMapId !== null && blank && w.shown?.mapId !== w.loadedMapId) return 'Drawing the map…'
  return null
}
