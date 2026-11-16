// Undo and redo: each change takes back only what it touched.
import { describe, expect, it } from 'vitest'
import { newDoc, type Doc } from './doc'
import { emptyHistory, HISTORY_LIMIT, record, stepBack, stepForward, type Change, type History } from './history'
import type { Pin, Route, RouteItem } from '../map/types'

const route = (n: number): Route => ({
  points: Array.from({ length: n }, (_, i) => [i, 0] as [number, number]),
  legs: Array.from({ length: Math.max(0, n - 1) }, (_, i) => [[i, 0], [i + 1, 0]] as [number, number][]),
  kinds: Array.from({ length: Math.max(0, n - 1) }, () => 'straight' as const),
})

function start(): { doc: Doc; h: History } {
  const doc = newDoc()
  const first = doc.routes[0] as RouteItem
  return { doc: { ...doc, routes: [{ ...first, id: 'r1', name: 'Loop', route: route(3) }] }, h: emptyHistory() }
}

/** Make a change: apply it and record it, the way the app does. */
function make(s: { doc: Doc; h: History }, c: Change, apply: (d: Doc) => Doc) {
  return { doc: apply(s.doc), h: record(s.h, c) }
}

describe('undo and redo', () => {
  it('takes back a route edit and puts it back, keeping a rename made since', () => {
    let s = start()
    const before = s.doc.routes[0]!.route
    const after = route(4)
    s = make(s, { kind: 'route', id: 'r1', before, after, what: 'adding a point' }, (d) => ({ ...d, routes: d.routes.map((r) => ({ ...r, route: after })) }))
    // Renamed after the point went in: undo must not bring the old name back.
    s = { ...s, doc: { ...s.doc, routes: s.doc.routes.map((r) => ({ ...r, name: 'River loop' })) } }
    const back = stepBack(s.doc, s.h)!
    expect(back.doc.routes[0]!.route).toBe(before)
    expect(back.doc.routes[0]!.name).toBe('River loop')
    expect(back.change.what).toBe('adding a point')
    const again = stepForward(back.doc, back.history)!
    expect(again.doc.routes[0]!.route).toBe(after)
    expect(again.history.redo).toEqual([])
    expect(stepForward(again.doc, again.history)).toBeNull()
  })
  it('brings back a deleted route where it was, and removes an added one', () => {
    let s = start()
    const extra: RouteItem = { ...s.doc.routes[0]!, id: 'r2', name: 'Out and back', route: route(2) }
    s = make(s, { kind: 'add-route', item: extra, index: 1, what: 'adding Out and back' }, (d) => ({ ...d, routes: [...d.routes, extra] }))
    const gone = s.doc.routes[0]!
    s = make(s, { kind: 'delete-route', item: gone, index: 0, what: 'deleting Loop' }, (d) => ({ ...d, routes: d.routes.filter((r) => r.id !== 'r1') }))
    expect(s.doc.routes.map((r) => r.id)).toEqual(['r2'])
    const one = stepBack(s.doc, s.h)!
    expect(one.doc.routes.map((r) => r.id)).toEqual(['r1', 'r2'])
    const two = stepBack(one.doc, one.history)!
    expect(two.doc.routes.map((r) => r.id)).toEqual(['r1'])
    expect(stepBack(two.doc, two.history)).toBeNull()
    const redone = stepForward(stepForward(two.doc, two.history)!.doc, stepForward(two.doc, two.history)!.history)!
    expect(redone.doc.routes.map((r) => r.id)).toEqual(['r2'])
  })
  it('takes back a pin without losing a label typed on another pin since', () => {
    let s = start()
    const a: Pin = { id: 'a', at: [0, 0], label: '', icon: 'star' }
    const b: Pin = { id: 'b', at: [1, 1], label: '', icon: 'coffee' }
    s = make(s, { kind: 'pin', id: 'a', before: null, after: a, index: 0, what: 'dropping a pin' }, (d) => ({ ...d, pins: [a] }))
    s = make(s, { kind: 'pin', id: 'b', before: null, after: b, index: 1, what: 'dropping a pin' }, (d) => ({ ...d, pins: [...d.pins, b] }))
    s = { ...s, doc: { ...s.doc, pins: s.doc.pins.map((p) => (p.id === 'a' ? { ...p, label: 'Start' } : p)) } }
    const back = stepBack(s.doc, s.h)!
    expect(back.doc.pins).toEqual([{ ...a, label: 'Start' }])
    // A removed pin comes back in its place in the list.
    const removed = make({ doc: s.doc, h: emptyHistory() }, { kind: 'pin', id: 'a', before: s.doc.pins[0]!, after: null, index: 0, what: 'removing a pin' }, (d) => ({ ...d, pins: d.pins.filter((p) => p.id !== 'a') }))
    expect(stepBack(removed.doc, removed.h)!.doc.pins.map((p) => p.id)).toEqual(['a', 'b'])
  })
  it('drops the redo list on a new change, and keeps the last 200 changes', () => {
    let s = start()
    const c = (n: number): Change => ({ kind: 'route', id: 'r1', before: route(n), after: route(n + 1), what: 'adding a point' })
    s = make(s, c(3), (d) => d)
    const back = stepBack(s.doc, s.h)!
    expect(record(back.history, c(5)).redo).toEqual([])
    let h = emptyHistory()
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = record(h, c(i))
    expect(h.undo).toHaveLength(HISTORY_LIMIT)
    expect((h.undo[0] as Extract<Change, { kind: 'route' }>).before.points).toHaveLength(20)
  })
})
