// Keeps the last few downloaded maps in this browser (IndexedDB), so reopening a project or coming back
// to the same area does not depend on the busy public map servers. Map data changes slowly, so a copy
// is used for 30 days; "Download again" always fetches fresh.
import { bboxContains } from '../map/geo'
import type { ParsedMap } from '../map/osm'
import type { BBox } from '../map/types'

export interface CachedMap {
  bbox: BBox
  map: ParsedMap
  savedAt: number
}

export interface MapCache {
  find(bbox: BBox, buildings: boolean): Promise<CachedMap | null>
  put(bbox: BBox, buildings: boolean, map: ParsedMap): Promise<void>
}

const MAX_AGE_MS = 30 * 24 * 3600 * 1000
const KEEP = 5

interface Entry {
  key: string
  bbox: BBox
  buildings: boolean
  savedAt: number
}

const keyOf = (b: BBox, buildings: boolean) =>
  `${buildings ? 'b' : 'n'}:${[b.west, b.south, b.east, b.north].map((v) => v.toFixed(5)).join(',')}`

/** The newest saved copy that covers the box, with the same choice of buildings. */
function pick(entries: Entry[], bbox: BBox, buildings: boolean, now: number): Entry | null {
  return entries
    .filter((e) => e.buildings === buildings && now - e.savedAt < MAX_AGE_MS && bboxContains(e.bbox, bbox))
    .sort((a, b) => b.savedAt - a.savedAt)[0] ?? null
}

/** A cache in memory, for tests and for browsers without IndexedDB. */
export function memoryCache(now = () => Date.now()): MapCache {
  const entries: Entry[] = []
  const maps = new Map<string, ParsedMap>()
  return {
    async find(bbox, buildings) {
      const e = pick(entries, bbox, buildings, now())
      const map = e && maps.get(e.key)
      return e && map ? { bbox: e.bbox, map, savedAt: e.savedAt } : null
    },
    async put(bbox, buildings, map) {
      const key = keyOf(bbox, buildings)
      const i = entries.findIndex((e) => e.key === key)
      if (i >= 0) entries.splice(i, 1)
      entries.push({ key, bbox, buildings, savedAt: now() })
      maps.set(key, map)
      while (entries.length > KEEP) {
        entries.sort((a, b) => a.savedAt - b.savedAt)
        const old = entries.shift() as Entry
        maps.delete(old.key)
      }
    },
  }
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})

/** The browser's own store. Any failure (private browsing, a full disk) just means no copy. */
export function indexedDbCache(): MapCache {
  let db: Promise<IDBDatabase> | null = null
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const r = indexedDB.open('route-map-studio', 1)
      r.onupgradeneeded = () => {
        r.result.createObjectStore('index', { keyPath: 'key' })
        r.result.createObjectStore('maps')
      }
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    return db
  }
  return {
    async find(bbox, buildings) {
      try {
        const d = await open()
        const entries = await req(d.transaction('index').objectStore('index').getAll() as IDBRequest<Entry[]>)
        const e = pick(entries, bbox, buildings, Date.now())
        if (!e) return null
        const map = await req(d.transaction('maps').objectStore('maps').get(e.key) as IDBRequest<ParsedMap | undefined>)
        return map ? { bbox: e.bbox, map, savedAt: e.savedAt } : null
      } catch {
        return null
      }
    },
    async put(bbox, buildings, map) {
      try {
        const d = await open()
        const key = keyOf(bbox, buildings)
        const tx = d.transaction(['index', 'maps'], 'readwrite')
        tx.objectStore('index').put({ key, bbox, buildings, savedAt: Date.now() } satisfies Entry)
        tx.objectStore('maps').put(map, key)
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        const entries = await req(d.transaction('index').objectStore('index').getAll() as IDBRequest<Entry[]>)
        const old = entries.sort((a, b) => b.savedAt - a.savedAt).slice(KEEP)
        if (old.length) {
          const del = d.transaction(['index', 'maps'], 'readwrite')
          for (const e of old) {
            del.objectStore('index').delete(e.key)
            del.objectStore('maps').delete(e.key)
          }
        }
      } catch {
        // No copy this time; the map still works.
      }
    },
  }
}
