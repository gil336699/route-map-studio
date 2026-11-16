// A small road graph for "follow roads and paths" drawing: click two points and the route
// takes the shortest way between them along streets, paths and trails in the downloaded data.
import { localDistanceM } from './geo'
import type { Feature, LonLat } from './types'

export interface Graph {
  nodes: LonLat[]
  adj: { to: number; w: number }[][]
  /** Which connected piece of the network each node is in, and how big each piece is. */
  comp: number[]
  compSize: number[]
  /** While a trial runs, the splits it made, so they can be taken back. See `trial`. */
  journal?: Split[]
}

/** One split of a segment a–b at a new node i, with the link lists of a and b as they were. */
interface Split {
  i: number
  a: number
  b: number
  prevA: { to: number; w: number }[]
  prevB: { to: number; w: number }[]
}

const key = (p: LonLat) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`

export function buildGraph(features: Feature[]): Graph {
  const index = new Map<string, number>()
  const nodes: LonLat[] = []
  const adj: { to: number; w: number }[][] = []
  const nodeOf = (p: LonLat): number => {
    const k = key(p)
    let i = index.get(k)
    if (i === undefined) {
      i = nodes.length
      index.set(k, i)
      nodes.push(p)
      adj.push([])
    }
    return i
  }
  for (const f of features) {
    if (f.kind !== 'line' || !f.hw) continue
    if (f.layer !== 'major' && f.layer !== 'minor' && f.layer !== 'paths') continue
    // People do not walk or run on motorways, so keep them out of the graph.
    if (f.hw.startsWith('motorway')) continue
    for (const part of f.parts) {
      for (let i = 1; i < part.length; i++) {
        const a = nodeOf(part[i - 1] as LonLat)
        const b = nodeOf(part[i] as LonLat)
        if (a === b) continue
        const w = localDistanceM(part[i - 1] as LonLat, part[i] as LonLat)
        ;(adj[a] as { to: number; w: number }[]).push({ to: b, w })
        ;(adj[b] as { to: number; w: number }[]).push({ to: a, w })
      }
    }
  }
  const { comp, compSize } = components(adj)
  return { nodes, adj, comp, compSize }
}

/** Label the connected pieces of the network. Map data often has small paths joined to nothing. */
function components(adj: { to: number; w: number }[][]): { comp: number[]; compSize: number[] } {
  const comp: number[] = new Array(adj.length).fill(-1)
  const compSize: number[] = []
  for (let start = 0; start < adj.length; start++) {
    if (comp[start] !== -1) continue
    const id = compSize.length
    let size = 0
    const stack = [start]
    comp[start] = id
    while (stack.length) {
      const u = stack.pop() as number
      size++
      for (const e of adj[u] as { to: number; w: number }[]) {
        if (comp[e.to] === -1) {
          comp[e.to] = id
          stack.push(e.to)
        }
      }
    }
    compSize.push(size)
  }
  return { comp, compSize }
}

/** How far a click may be snapped onto the connected network before it takes the nearest path instead. */
export const SNAP_M = 200

/** The nearest point on any street, path or trail: the segment's two nodes, the point, and how far it is. */
export interface Hit {
  a: number
  b: number
  q: LonLat
  d: number
}

/** The nearest point on a segment of the network to `p`, among nodes `keep` allows, or null. */
export function nearestOnNetwork(g: Graph, p: LonLat, keep?: (i: number) => boolean): Hit | null {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180)
  const ky = 110574
  let best: Hit | null = null
  for (let a = 0; a < g.nodes.length; a++) {
    if (keep && !keep(a)) continue
    const na = g.nodes[a] as LonLat
    const ax = (na[0] - p[0]) * kx
    const ay = (na[1] - p[1]) * ky
    for (const e of g.adj[a] as { to: number; w: number }[]) {
      if (e.to < a) continue
      const nb = g.nodes[e.to] as LonLat
      const bx = (nb[0] - p[0]) * kx
      const by = (nb[1] - p[1]) * ky
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
      const d = Math.hypot(ax + t * dx, ay + t * dy)
      if (!best || d < best.d) best = { a, b: e.to, q: [na[0] + t * (nb[0] - na[0]), na[1] + t * (nb[1] - na[1])], d }
    }
  }
  return best
}

/**
 * Put a node at a point on a segment: the segment a–b becomes a–q–b. A point within 3 m of an end is
 * that end. Splitting rather than adding keeps a second click on the same block routing along it.
 */
export function splitAt(g: Graph, hit: Hit): number {
  const { a, b, q } = hit
  if (localDistanceM(g.nodes[a] as LonLat, q) < 3) return a
  if (localDistanceM(g.nodes[b] as LonLat, q) < 3) return b
  const i = g.nodes.length
  g.nodes.push(q)
  const wa = localDistanceM(g.nodes[a] as LonLat, q)
  const wb = localDistanceM(g.nodes[b] as LonLat, q)
  const adjA = g.adj[a] as { to: number; w: number }[]
  const adjB = g.adj[b] as { to: number; w: number }[]
  g.journal?.push({ i, a, b, prevA: adjA, prevB: adjB })
  g.adj[a] = adjA.filter((e) => e.to !== b).concat({ to: i, w: wa })
  g.adj[b] = adjB.filter((e) => e.to !== a).concat({ to: i, w: wb })
  g.adj.push([{ to: a, w: wa }, { to: b, w: wb }])
  const c = g.comp[a] as number
  g.comp.push(c)
  g.compSize[c] = (g.compSize[c] as number) + 1
  return i
}

/**
 * Run `fn` and then take back every split it made, newest first, so the network is exactly as it was.
 * Previews of an edit, sent many times a second while a point is dragged, use it so they leave no trace.
 */
export function trial<T>(g: Graph, fn: () => T): T {
  const outer = g.journal
  const mine: Split[] = []
  g.journal = mine
  try {
    return fn()
  } finally {
    for (let k = mine.length - 1; k >= 0; k--) {
      const { a, b, prevA, prevB } = mine[k] as Split
      g.adj[a] = prevA
      g.adj[b] = prevB
      g.nodes.pop()
      g.adj.pop()
      const c = g.comp.pop() as number
      g.compSize[c] = (g.compSize[c] as number) - 1
    }
    g.journal = outer
  }
}

/**
 * Where a click lands on the network: the nearest point on a street of the same connected piece as
 * `from` (or, for a first point, of a big piece), when that is within SNAP_M; else the nearest street
 * of any piece within SNAP_M; else nowhere (-1), so the click stays where it was made.
 */
export function locate(g: Graph, p: LonLat, from: number): number {
  if (!g.nodes.length) return -1
  const big = bigPiece(g)
  const fromComp = from >= 0 ? (g.comp[from] as number) : -1
  const want = fromComp >= 0 ? (i: number) => g.comp[i] === fromComp : (i: number) => (g.compSize[g.comp[i] as number] as number) >= big
  const hit = nearestOnNetwork(g, p, want)
  if (hit && hit.d <= SNAP_M) return splitAt(g, hit)
  const any = nearestOnNetwork(g, p)
  if (any && any.d <= SNAP_M) return splitAt(g, any)
  return -1
}

/**
 * The node a click should snap to. It prefers the same connected piece as the previous point (or, for a
 * first point, a big piece of the network), so a click near a stray path still lands on the streets.
 */
export function snapNode(g: Graph, p: LonLat, from: number): number {
  const any = nearestNode(g, p)
  if (any < 0) return any
  const big = bigPiece(g)
  const fromComp = from >= 0 ? (g.comp[from] as number) : -1
  const want = fromComp >= 0 ? (i: number) => g.comp[i] === fromComp : (i: number) => (g.compSize[g.comp[i] as number] as number) >= big
  if (want(any)) return any
  const better = nearestNode(g, p, want)
  if (better >= 0 && localDistanceM(g.nodes[better] as LonLat, p) <= SNAP_M) return better
  return any
}

/** A piece counts as big when it holds at least 2% of the network, or is the biggest there is. */
function bigPiece(g: Graph): number {
  let largest = 0
  for (const n of g.compSize) if (n > largest) largest = n
  return Math.min(largest, Math.max(20, Math.round(g.nodes.length * 0.02)))
}

/** The graph node closest to a point (among those `keep` allows), or -1 if there is none. */
export function nearestNode(g: Graph, p: LonLat, keep?: (i: number) => boolean): number {
  let best = -1
  let bestD = Infinity
  const kx = Math.cos((p[1] * Math.PI) / 180)
  for (let i = 0; i < g.nodes.length; i++) {
    if (keep && !keep(i)) continue
    const n = g.nodes[i] as LonLat
    const dx = (n[0] - p[0]) * kx
    const dy = n[1] - p[1]
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Shortest path between two nodes (Dijkstra with a binary heap). Null when they are not connected. */
export function shortestPath(g: Graph, from: number, to: number): LonLat[] | null {
  if (from < 0 || to < 0) return null
  if (from === to) return [g.nodes[from] as LonLat]
  const dist = new Float64Array(g.nodes.length).fill(Infinity)
  const prev = new Int32Array(g.nodes.length).fill(-1)
  const heap: [number, number][] = [[0, from]]
  dist[from] = 0
  while (heap.length) {
    const [d, u] = heapPop(heap)
    if (d > (dist[u] as number)) continue
    if (u === to) break
    for (const e of g.adj[u] as { to: number; w: number }[]) {
      const nd = d + e.w
      if (nd < (dist[e.to] as number)) {
        dist[e.to] = nd
        prev[e.to] = u
        heapPush(heap, [nd, e.to])
      }
    }
  }
  if ((prev[to] as number) === -1) return null
  const out: LonLat[] = []
  for (let u = to; u !== -1; u = prev[u] as number) out.push(g.nodes[u] as LonLat)
  return out.reverse()
}

function heapPush(h: [number, number][], item: [number, number]) {
  h.push(item)
  let i = h.length - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if ((h[p] as [number, number])[0] <= (h[i] as [number, number])[0]) break
    ;[h[p], h[i]] = [h[i] as [number, number], h[p] as [number, number]]
    i = p
  }
}

function heapPop(h: [number, number][]): [number, number] {
  const top = h[0] as [number, number]
  const last = h.pop() as [number, number]
  if (h.length) {
    h[0] = last
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < h.length && (h[l] as [number, number])[0] < (h[m] as [number, number])[0]) m = l
      if (r < h.length && (h[r] as [number, number])[0] < (h[m] as [number, number])[0]) m = r
      if (m === i) break
      ;[h[m], h[i]] = [h[i] as [number, number], h[m] as [number, number]]
      i = m
    }
  }
  return top
}
