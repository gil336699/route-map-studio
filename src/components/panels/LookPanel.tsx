// Look: a starting look, the ink limit, the shirt, the map layers, the route line and the detail level.
import type { Doc } from '../../lib/doc'
import { lookIdOf } from '../../lib/doc'
import { LOOKS, LOOK_ROUTE_COLOR, type Look } from '../../lib/presets'
import { INK_ROLES } from '../../map/inks'
import { LAYER_NAMES, LAYER_ORDER, type LayerId, type Shape, type Style } from '../../map/types'
import { ColorField, Group, NumberBox, Row, Segmented, Slider, Switch, Term } from '../Controls'
import { tip } from '../tip'

interface Props {
  doc: Doc
  edit: (fn: (d: Doc) => Doc) => void
  onApplyLook: (look: Look) => void
}

const AREAS: LayerId[] = ['parks', 'water', 'buildings']
/** Which ink colour slot each ink role edits, by limit. */
const SLOTS: Record<1 | 2 | 3, number[]> = { 1: [0], 2: [2, 1], 3: [0, 1, 2] }

export function LookPanel({ doc, edit, onApplyLook }: Props) {
  const s = doc.style
  const set = (patch: Partial<Style>) => edit((d) => ({ ...d, style: { ...d.style, ...patch } }))
  const setLayer = (id: LayerId, patch: Partial<Style['layers'][LayerId]>) =>
    edit((d) => ({ ...d, style: { ...d.style, layers: { ...d.style.layers, [id]: { ...d.style.layers[id], ...patch } } } }))
  const current = lookIdOf(s, LOOKS)
  const limited = s.inkLimit > 0
  const n = s.inkLimit as 1 | 2 | 3

  return (
    <>
      <Group title="Starting look" hint="Sets every colour and the layout. Your words, routes and pins stay.">
        <div className="looks">
          {LOOKS.map((l) => (
            <button key={l.id} type="button" className={l.id === current ? 'look on' : 'look'} aria-pressed={l.id === current} onClick={() => onApplyLook(l)} {...tip(l.note)}>
              <span className="look-swatch" style={{ background: l.style.shirt }} aria-hidden="true">
                <i style={{ background: l.style.layers.minor.color }} />
                <i style={{ background: l.style.layers.major.color }} />
                <i style={{ background: LOOK_ROUTE_COLOR[l.id] ?? '#e4572e' }} className="thick" />
              </span>
              <span className="look-name">{l.label}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Inks" hint={limited ? `Every colour is mapped onto ${n} ink${n > 1 ? 's' : ''}. The shirt shows through as the background.` : 'Any number of colours. Hold the design to 1, 2 or 3 inks for a cheaper screen print.'}>
        <Segmented label="Ink limit" value={String(s.inkLimit) as '0' | '1' | '2' | '3'} onChange={(v) => set({ inkLimit: Number(v) as Style['inkLimit'] })} options={[
          { value: '0', label: 'Any', tip: 'Use every colour in the look. Best for DTG printing.' },
          { value: '1', label: '1 ink', tip: 'One screen: the cheapest screen print. The route stands out by weight.' },
          { value: '2', label: '2 inks', tip: 'The map in one ink, the route, pins and type in another.' },
          { value: '3', label: '3 inks', tip: 'Main roads and type, the route and pins, and a quiet ink for streets and water.' },
        ]} />
        {limited ? (
          <div className="inks">
            {INK_ROLES[n].map((role, i) => {
              const slot = SLOTS[n][i] as number
              return (
                <Row key={role} label={`Ink ${i + 1}: ${role.toLowerCase()}`}>
                  <ColorField value={s.inkColors[slot] as string} label={`Ink ${i + 1}`} onChange={(c) => {
                    const next = [...s.inkColors] as Style['inkColors']
                    next[slot] = c
                    set({ inkColors: next })
                  }} />
                </Row>
              )
            })}
          </div>
        ) : null}
      </Group>

      <Group title="Shirt and frame">
        <Row label="Shirt colour" tip="For the preview and the print check. It is never printed.">
          <ColorField value={s.shirt} onChange={(c) => set({ shirt: c })} label="Shirt colour" />
        </Row>
        <Switch label="Print a background" checked={!s.transparent} onChange={(v) => set({ transparent: !v })}
          tip={limited ? 'With an ink limit the shirt is always the background.' : 'Print a solid background behind the map. It costs an ink; leave it off to let the shirt show through.'} />
        {!s.transparent && !limited ? (
          <Row label="Background colour"><ColorField value={s.background} onChange={(c) => set({ background: c })} label="Background colour" /></Row>
        ) : null}
        <Segmented label="Frame" value={s.shape} onChange={(v) => set({ shape: v as Shape })} options={[
          { value: 'rect', label: 'Full', tip: 'The map fills the print to its edges.' },
          { value: 'rounded', label: 'Rounded', tip: 'A panel with soft corners, like a patch.' },
          { value: 'circle', label: 'Circle', tip: 'The map inside a circle, as a clipping mask in Illustrator.' },
        ]} />
      </Group>

      <Group title="Map layers" hint={limited ? 'Colours come from the inks above. Widths are in points; 1 pt is 0.35 mm.' : 'Widths are in points; 1 pt is 0.35 mm.'}>
        {LAYER_ORDER.slice().reverse().map((id) => {
          const ls = s.layers[id]
          const area = AREAS.includes(id)
          return (
            <div className="layer" key={id}>
              <input type="checkbox" role="switch" className="switch" checked={ls.show} onChange={(e) => setLayer(id, { show: e.target.checked })} aria-label={`Show ${LAYER_NAMES[id]}`} {...tip(`Show or hide ${LAYER_NAMES[id].toLowerCase()}.`)} />
              <span className="layer-name">{LAYER_NAMES[id]}</span>
              {!limited ? <ColorField value={ls.color} onChange={(c) => setLayer(id, { color: c })} label={`${LAYER_NAMES[id]} colour`} /> : null}
              {area && id === 'water' ? (
                <button type="button" className={ls.outline ? 'chip on' : 'chip'} aria-pressed={!!ls.outline} onClick={() => setLayer(id, { outline: !ls.outline })} {...tip('Draw the river by its banks instead of filling it.')}>Banks</button>
              ) : null}
              {!area || ls.outline ? (
                <NumberBox value={ls.widthPt} onCommit={(v) => setLayer(id, { widthPt: v })} min={0.25} max={12} decimals={2} label={`${LAYER_NAMES[id]} line width`} tip="Line width in points." suffix="pt" />
              ) : null}
            </div>
          )
        })}
        <Switch label="Keep each road separate" checked={s.separatePaths} onChange={(v) => set({ separatePaths: v })}
          tip="Exports every street and shape as its own path, for editing one by one in Illustrator. Off makes one compound path per layer: a smaller, faster file." />
      </Group>

      <Group title="Route line">
        <Row label="Width" tip="Route line width in points.">
          <NumberBox value={s.route.widthPt} onCommit={(v) => set({ route: { ...s.route, widthPt: v } })} min={1} max={20} decimals={1} label="Route width" tip="In points." suffix="pt" />
        </Row>
        <Switch label="Knockout outline" checked={s.route.outline} onChange={(v) => set({ route: { ...s.route, outline: v } })}
          tip="A gap in the shirt colour around the route, so it lifts off the streets. Prints as no ink." />
        <Switch label="Dashed" checked={s.route.dashed} onChange={(v) => set({ route: { ...s.route, dashed: v } })} tip="Draw the route as a dashed line." />
        <Switch label="Start and finish dots" checked={s.route.markers} onChange={(v) => set({ route: { ...s.route, markers: v } })} tip="A filled dot at the start and a ring at the finish. A loop gets the start dot only." />
        <Switch label="Distance markers" checked={s.distance.markers} onChange={(v) => set({ distance: { ...s.distance, markers: v } })} tip="A numbered marker along each route at a steady distance." />
        {s.distance.markers ? (
          <Row label="Every">
            <NumberBox value={s.distance.every} onCommit={(v) => set({ distance: { ...s.distance, every: v } })} min={0.1} max={50} decimals={2} label="Marker spacing" tip="Distance between markers." suffix={s.distance.units} />
          </Row>
        ) : null}
        <Segmented label="Distance units" value={s.distance.units} onChange={(v) => set({ distance: { ...s.distance, units: v } })} options={[
          { value: 'mi', label: 'Miles', tip: 'Show distances in miles.' },
          { value: 'km', label: 'Kilometres', tip: 'Show distances in kilometres.' },
        ]} />
      </Group>

      <Group title="Detail" hint="Less detail reads better at arm’s length and makes a lighter file.">
        <Row label="Smooth lines" tip="How far a smoothed line may stray from the real one, on the print.">
          <Slider value={doc.detail.simplifyMm} min={0} max={1} step={0.05} onChange={(v) => edit((d) => ({ ...d, detail: { ...d.detail, simplifyMm: v } }))} label="Smoothing" tip={`${doc.detail.simplifyMm.toFixed(2)} mm`} />
        </Row>
        <Row label="Shortest line" tip="Lines shorter than this on the print are left out.">
          <NumberBox value={doc.detail.minLengthMm} onCommit={(v) => edit((d) => ({ ...d, detail: { ...d.detail, minLengthMm: v } }))} min={0} max={50} decimals={1} label="Shortest line" tip="In mm on the print." suffix="mm" />
        </Row>
        <Row label="Smallest shape" tip="Parks, ponds and buildings smaller than this on the print are left out.">
          <NumberBox value={doc.detail.minAreaMm2} onCommit={(v) => edit((d) => ({ ...d, detail: { ...d.detail, minAreaMm2: v } }))} min={0} max={500} decimals={1} label="Smallest shape" tip="In square mm on the print." suffix="mm²" />
        </Row>
        <p className="hint"><Term tip="Each colour is a separate screen at the printer, so the ink count is the cost.">Inks</Term> and line weights are checked on the right.</p>
      </Group>
    </>
  )
}
