// Undo and redo for what the user makes on the map: route points and legs, whole routes, and pins.
// Each change names the one thing it touched, so taking it back leaves everything else as it is now:
// a route renamed or recoloured after a point was added keeps its new name when the point is undone.
import type { Doc } from './doc'
import type { Pin, Route, RouteItem } from '../map/types'

export type Change =
  /** A route's points and legs, before and after. */
  | { kind: 'route'; id: string; before: Route; after: Route; what: string }
  | { kind: 'add-route'; item: RouteItem; index: number; what: string }
  | { kind: 'delete-route'; item: RouteItem; index: number; what: string }
  /** A pin added (before is null), removed (after is null) or changed. */
  | { kind: 'pin'; id: string; before: Pin | null; after: Pin | null; index: number; what: string }

export interface History {
  undo: Change[]
  redo: Change[]
}

/** How many changes undo can go back. */
export const HISTORY_LIMIT = 200

export const emptyHistory = (): History => ({ undo: [], redo: [] })

/** A new change: it goes on the undo list, and the redo list is dropped. */
export function record(h: History, c: Change): History {
  return { undo: [...h.undo, c].slice(-HISTORY_LIMIT), redo: [] }
}

function withRoute(doc: Doc, id: string, route: Route): Doc {
  return { ...doc, routes: doc.routes.map((r) => (r.id === id ? { ...r, route } : r)) }
}

function insertAt<T>(list: T[], item: T, index: number): T[] {
  const i = Math.max(0, Math.min(list.length, index))
  return [...list.slice(0, i), item, ...list.slice(i)]
}

function setPin(doc: Doc, id: string, pin: Pin | null, index: number): Doc {
  if (!pin) return { ...doc, pins: doc.pins.filter((p) => p.id !== id) }
  if (doc.pins.some((p) => p.id === id)) return { ...doc, pins: doc.pins.map((p) => (p.id === id ? pin : p)) }
  return { ...doc, pins: insertAt(doc.pins, pin, index) }
}

/** The document with the change taken back. */
export function undoChange(doc: Doc, c: Change): Doc {
  switch (c.kind) {
    case 'route': return withRoute(doc, c.id, c.before)
    case 'add-route': return { ...doc, routes: doc.routes.filter((r) => r.id !== c.item.id) }
    case 'delete-route': return doc.routes.some((r) => r.id === c.item.id) ? doc : { ...doc, routes: insertAt(doc.routes, c.item, c.index) }
    case 'pin': return setPin(doc, c.id, c.before, c.index)
  }
}

/** The document with the change made again. */
export function redoChange(doc: Doc, c: Change): Doc {
  switch (c.kind) {
    case 'route': return withRoute(doc, c.id, c.after)
    case 'add-route': return doc.routes.some((r) => r.id === c.item.id) ? doc : { ...doc, routes: insertAt(doc.routes, c.item, c.index) }
    case 'delete-route': return { ...doc, routes: doc.routes.filter((r) => r.id !== c.item.id) }
    case 'pin': return setPin(doc, c.id, c.after, c.index)
  }
}

/** Step back: the document as it was, and the lists with the change moved to redo. Null if nothing to undo. */
export function stepBack(doc: Doc, h: History): { doc: Doc; history: History; change: Change } | null {
  const c = h.undo[h.undo.length - 1]
  if (!c) return null
  return { doc: undoChange(doc, c), history: { undo: h.undo.slice(0, -1), redo: [...h.redo, c] }, change: c }
}

/** Step forward again. Null if nothing to redo. */
export function stepForward(doc: Doc, h: History): { doc: Doc; history: History; change: Change } | null {
  const c = h.redo[h.redo.length - 1]
  if (!c) return null
  return { doc: redoChange(doc, c), history: { undo: [...h.undo, c], redo: h.redo.slice(0, -1) }, change: c }
}
