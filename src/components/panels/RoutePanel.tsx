// Route: the club's routes, how clicks draw them, and the landmarks and pins along them.
import { useMemo, useState } from 'react'
import type { Doc } from '../../lib/doc'
import { placesNear, type NearPlace } from '../../map/places'
import { canClose, routeLine } from '../../map/route'
import { formatDistance, iconSvg } from '../../map/scene'
import { PIN_ICONS, type Pin, type Place, type PinIcon } from '../../map/types'
import { Btn, ColorField, Group, Segmented, TextField } from '../Controls'
import { tip } from '../tip'

export interface RouteOps {
  addRoute: () => void
  deleteRoute: (id: string) => void
  renameRoute: (id: string, name: string) => void
  recolorRoute: (id: string, color: string) => void
  setDashed: (id: string, dashed: boolean) => void
  undo: () => void
  closeLoop: () => void
  clear: () => void
  importRoute: () => void
  fit: () => void
  togglePlace: (p: Place) => void
  updatePin: (id: string, patch: Partial<Pin>) => void
  deletePin: (id: string) => void
}

interface Props {
  doc: Doc
  selectedId: string
  onSelect: (id: string) => void
  follow: boolean
  setFollow: (v: boolean) => void
  hasMap: boolean
  routeKm: number[]
  places: Place[]
  ops: RouteOps
}

const KINDS: { id: Place['kind']; label: string; icon: PinIcon }[] = [
  { id: 'coffee', label: 'Coffee', icon: 'coffee' },
  { id: 'museum', label: 'Museums', icon: 'museum' },
  { id: 'water', label: 'Water', icon: 'water' },
  { id: 'sight', label: 'Sights', icon: 'star' },
]

/** The same array as last time when every item is the same object, so memos keyed on it hold. */
function useSameItems<T>(items: T[]): T[] {
  const [kept, setKept] = useState(items)
  const same = kept.length === items.length && kept.every((x, i) => x === items[i])
  if (!same) setKept(items)
  return same ? kept : items
}

export function RoutePanel({ doc, selectedId, onSelect, follow, setFollow, hasMap, routeKm, places, ops }: Props) {
  const [maxM, setMaxM] = useState<'100' | '200' | '400'>('200')
  const [kinds, setKinds] = useState<Set<Place['kind']>>(() => new Set(['coffee', 'museum', 'water', 'sight']))
  const units = doc.style.distance.units
  const selected = doc.routes.find((r) => r.id === selectedId) ?? doc.routes[0]
  // Renaming or recolouring a route keeps its shape, so the landmark search does not run again.
  const shapes = useSameItems(doc.routes.map((r) => r.route))
  const lines = useMemo(() => shapes.map(routeLine).filter((l) => l.length > 1), [shapes])
  const near = useMemo(
    () => placesNear(places.filter((p) => kinds.has(p.kind)), lines, Number(maxM)).slice(0, 40),
    [places, kinds, lines, maxM],
  )
  const pinIds = new Set(doc.pins.map((p) => p.id))
  const pointsLeft = selected ? selected.route.points.length : 0
  const knock = doc.style.transparent ? doc.style.shirt : doc.style.background

  return (
    <>
      <Group title="Routes" hint="Each route has its own colour and its own layer in the export.">
        <ul className="routes" role="radiogroup" aria-label="Route to draw">
          {doc.routes.map((r, i) => (
            <li key={r.id} className={r.id === selected?.id ? 'route sel' : 'route'}>
              <input type="radio" name="route" className="sr-only" id={`route-${r.id}`} checked={r.id === selected?.id} onChange={() => onSelect(r.id)} />
              <ColorField value={r.color} onChange={(c) => ops.recolorRoute(r.id, c)} label={`Colour of ${r.name}`} />
              <label htmlFor={`route-${r.id}`} className="route-pick" {...tip('Draw on this route.')}>
                <TextField value={r.name} onChange={(v) => ops.renameRoute(r.id, v)} label={`Name of route ${i + 1}`} tip="The name used in the stats line and the layer name." />
              </label>
              <button type="button" className={(r.dashed ?? doc.style.route.dashed) ? 'chip dash on' : 'chip dash'} aria-pressed={!!(r.dashed ?? doc.style.route.dashed)}
                onClick={() => ops.setDashed(r.id, !(r.dashed ?? doc.style.route.dashed))} aria-label={`Dashed line for ${r.name}`}
                {...tip('Dashed or solid. A dashed second route can share the first one’s ink.')}>- -</button>
              <span className="route-km" {...tip('Length of the route as drawn.')}>{(routeKm[i] ?? 0) > 0 ? formatDistance(routeKm[i] ?? 0, units) : '—'}</span>
              <Btn variant="quiet" className="icon" label={`Delete ${r.name}`} tip="Delete this route." onClick={() => ops.deleteRoute(r.id)}
                disabledReason={doc.routes.length === 1 ? 'The last route cannot be deleted. Clear it instead.' : undefined}>✕</Btn>
            </li>
          ))}
        </ul>
        <div className="btn-row">
          <Btn tip="Start another route, such as a second training run, in its own colour." onClick={ops.addRoute} disabledReason={doc.routes.length >= 6 ? 'Six routes is the most one map can show clearly.' : undefined}>+ New route</Btn>
          <Btn tip="Open a GPX file (from Strava, Garmin or Komoot) or GeoJSON into the selected route." onClick={ops.importRoute}>Import GPX</Btn>
          <Btn tip="Move and zoom the map so every route fits on the page." shortcut="F" onClick={ops.fit} disabledReason={lines.length ? undefined : 'Draw or import a route first.'}>Fit</Btn>
        </div>
      </Group>

      <Group title="Draw" hint={hasMap ? 'Press D, then click the map. Each click adds a point to the selected route.' : 'Download a map first to draw along its roads. Straight lines work any time.'}>
        <Segmented
          label="How clicks join points"
          value={follow ? 'roads' : 'straight'}
          onChange={(v) => setFollow(v === 'roads')}
          options={[
            { value: 'roads', label: 'Along roads and trails', tip: hasMap ? 'Each new point joins the last one along streets, paths and trails.' : 'Needs a downloaded map. Until then, points join with straight lines.' },
            { value: 'straight', label: 'Straight', tip: 'Each new point joins the last one with a straight line. Use it where the map is missing a path.' },
          ]}
        />
        <div className="btn-row">
          <Btn tip="Remove the last point of the selected route." shortcut="⌘Z" onClick={ops.undo} disabledReason={pointsLeft ? undefined : 'The selected route has no points yet.'}>Undo point</Btn>
          <Btn tip="Join the last point back to the first." onClick={ops.closeLoop}
            disabledReason={selected && canClose(selected.route) ? undefined : selected && routeLine(selected.route).length >= 3 ? 'The loop is already closed.' : 'A loop needs at least 3 points.'}>Close loop</Btn>
          <Btn variant="danger" tip="Remove every point of the selected route." onClick={ops.clear} disabledReason={pointsLeft ? undefined : 'The selected route is already empty.'}>Clear</Btn>
        </div>
      </Group>

      <Group title="Landmarks near the routes" hint={!hasMap ? 'Download a map to find cafés, museums, fountains and sights.' : !lines.length ? 'Draw a route to see what is along it.' : `${near.length} within ${maxM} m. Tick the ones to show on the print.`}>
        <div className="chips" role="group" aria-label="Kinds of landmark">
          {KINDS.map((k) => (
            <button key={k.id} type="button" className={kinds.has(k.id) ? 'chip on' : 'chip'} aria-pressed={kinds.has(k.id)}
              onClick={() => setKinds((s) => { const n = new Set(s); if (n.has(k.id)) n.delete(k.id); else n.add(k.id); return n })}
              {...tip(`Show or hide ${k.label.toLowerCase()} in the list.`)}>
              {k.label}
            </button>
          ))}
        </div>
        <Segmented label="How far from the route" value={maxM} onChange={setMaxM} options={[
          { value: '100', label: '100 m', tip: 'Only places right on the route.' },
          { value: '200', label: '200 m', tip: 'Places within a short detour.' },
          { value: '400', label: '400 m', tip: 'Places a block or two away.' },
        ]} />
        {near.length ? (
          <ul className="landmarks">
            {near.map((p: NearPlace) => {
              const on = pinIds.has(p.id)
              const kind = KINDS.find((k) => k.id === p.kind)
              return (
                <li key={p.id}>
                  <label className="landmark" {...tip(on ? 'On the print. Untick to remove it.' : 'Tick to put this on the print as a pin.')}>
                    <span className="icon-svg" dangerouslySetInnerHTML={{ __html: iconSvg(kind?.icon ?? 'dot', doc.style.pinColor, knock, 20) }} />
                    <span className="name">{p.name}</span>
                    <span className="dist">{Math.round(p.distM)} m</span>
                    <input type="checkbox" checked={on} onChange={() => ops.togglePlace(p)} aria-label={`Show ${p.name} on the print`} />
                  </label>
                </li>
              )
            })}
          </ul>
        ) : null}
      </Group>

      <Group title="Pins" hint="Press P and click the map for a pin of your own: a start, a meeting point or a street name.">
        {doc.pins.length ? (
          <ul className="pins">
            {doc.pins.map((p) => (
              <li key={p.id} className="pin-row">
                <span className="icon-svg" dangerouslySetInnerHTML={{ __html: iconSvg(p.icon ?? 'dot', doc.style.pinColor, knock, 20) }} />
                <select className="select" aria-label={`Icon for ${p.label || 'pin'}`} value={p.icon ?? 'dot'} onChange={(e) => ops.updatePin(p.id, { icon: e.target.value as PinIcon })} {...tip('The pin’s icon. Text only shows just the label, for street names.')}>
                  {PIN_ICONS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
                <TextField id={`pin-label-${p.id}`} value={p.label} onChange={(v) => ops.updatePin(p.id, { label: v })} label="Pin label" placeholder="Label" tip="Printed in capitals next to the pin. Leave empty for an icon alone." />
                <Btn variant="quiet" className="icon" label={`Delete pin ${p.label}`} tip="Delete this pin." onClick={() => ops.deletePin(p.id)}>✕</Btn>
              </li>
            ))}
          </ul>
        ) : <p className="hint">No pins yet.</p>}
      </Group>
    </>
  )
}
