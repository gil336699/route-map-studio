// Place search with OpenStreetMap's Nominatim service.
export interface PlaceResult {
  name: string
  lon: number
  lat: number
  /** A sensible map width in km for this place, from its bounding box. */
  widthKm: number
}

interface Raw {
  display_name: string
  lon: string
  lat: string
  boundingbox?: [string, string, string, string]
}

export function placeFromRaw(r: Raw): PlaceResult | null {
  const lon = Number(r.lon)
  const lat = Number(r.lat)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  let widthKm = 5
  if (r.boundingbox) {
    const [s, n, w, e] = r.boundingbox.map(Number) as [number, number, number, number]
    const wKm = (e - w) * 111.32 * Math.cos((lat * Math.PI) / 180)
    const hKm = (n - s) * 110.57
    const span = Math.max(wKm, hKm)
    if (Number.isFinite(span) && span > 0) widthKm = span
  }
  // Keep the first view small enough to download quickly, and large enough to be a map.
  widthKm = Math.min(20, Math.max(1, Math.round(widthKm * 10) / 10))
  return { name: r.display_name, lon, lat, widthKm }
}

export async function searchPlace(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const q = query.trim()
  if (!q) return []
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new Error('Could not search. Check your internet connection.', { cause: e })
  }
  if (!res.ok) throw new Error('The place search is busy. Try again in a moment.')
  const raw = (await res.json()) as Raw[]
  return raw.map(placeFromRaw).filter((p): p is PlaceResult => p !== null)
}
