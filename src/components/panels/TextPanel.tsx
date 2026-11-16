// Text: the club name, a subtitle, the distance (as a line or a huge number), a key for the icons, and
// the scale bar, compass and coordinates.
import type { Doc } from '../../lib/doc'
import { coordsAt, formatCoords } from '../../map/furniture'
import { ICONS, type BadgeIcon } from '../../map/icons'
import { applyInks } from '../../map/inks'
import { compassPreviewSvg, formatDistance, legendIcons, legendName, scalePreviewSvg } from '../../map/scene'
import type { CompassStyle, CoordFormat, Furniture, ScaleStyle, TextStyle } from '../../map/types'
import { ColorField, Group, Row, Segmented, Switch, TextField } from '../Controls'
import { PlacePicker, StylePicker } from '../FurnitureControls'

interface Props {
  doc: Doc
  edit: (fn: (d: Doc) => Doc) => void
  firstKm: number
}

const LABEL = new Map(ICONS.map((i) => [i.id, `${i.label} icon`]))
const iconLabel = (k: BadgeIcon) => LABEL.get(k) ?? 'Icon'

const SCALES: { value: ScaleStyle; label: string; tip: string }[] = [
  { value: 'bracket', label: 'Bracket', tip: 'One round length between two ticks, such as 1 MILE. The quietest, like a city poster.' },
  { value: 'ruler', label: 'Ruler', tip: 'Ticks along the length, with 0, half way and the end numbered. Like a track ruler.' },
  { value: 'checker', label: 'Checkered', tip: 'The classic atlas bar: parts filled and empty in turn.' },
  { value: 'dual', label: 'Miles and km', tip: 'Kilometres above the line and miles below, for runners who think in both.' },
]
const COMPASSES: { value: CompassStyle; label: string; tip: string }[] = [
  { value: 'arrow', label: 'Arrow', tip: 'A bold N over a slim arrow. Simple and small.' },
  { value: 'split', label: 'Split', tip: 'A half-filled arrowhead: the classic map north arrow.' },
  { value: 'badge', label: 'Badge', tip: 'A round badge in the pin colour with the N knocked out, like the pins.' },
  { value: 'rose', label: 'Rose', tip: 'A compass rose with N, E, S and W. The decorative, vintage choice.' },
]
const FORMATS: { value: CoordFormat; name: string }[] = [
  { value: 'dm', name: 'Degrees and minutes, the usual poster style' },
  { value: 'decimal', name: 'Decimal degrees, as a phone shows them' },
  { value: 'dms', name: 'Degrees, minutes and seconds' },
]

export function TextPanel({ doc, edit, firstKm }: Props) {
  const t = doc.style.text
  const limited = doc.style.inkLimit > 0
  const set = (patch: Partial<TextStyle>) => edit((d) => ({ ...d, style: { ...d.style, text: { ...d.style.text, ...patch } } }))
  const units = doc.style.distance.units
  const auto = firstKm > 0 ? (units === 'mi' ? firstKm / 1.609344 : firstKm).toFixed(1) : ''
  const icons = legendIcons(doc.pins)
  const fu = doc.style.furniture
  const setFu = (patch: Partial<Furniture>) => edit((d) => ({ ...d, style: { ...d.style, furniture: { ...d.style.furniture, ...patch } } }))
  // The pickers show each style in the colours it prints in, inks and all.
  const printed = applyInks(doc.style, doc.routes).style
  const knock = printed.transparent ? printed.shirt : printed.background
  const hasStart = doc.routes.some((r) => r.route.points.length > 0)
  const at = coordsAt(doc.frame, doc.routes, fu.coordsOf)

  return (
    <>
      <Group title="Words">
        <Switch label="Show text" checked={t.show} onChange={(v) => set({ show: v })} tip="Show the title block on the print." />
        <Row label="Title"><TextField value={t.title} onChange={(v) => set({ title: v })} label="Title" placeholder="Club name" tip="The club or route name. Long titles shrink to fit." /></Row>
        <Row label="Subtitle"><TextField value={t.subtitle} onChange={(v) => set({ subtitle: v })} label="Subtitle" placeholder="City, day, year" tip="A line under the title, such as the city or Est. 2026." /></Row>
        {!limited ? <Row label="Colour"><ColorField value={t.color} onChange={(c) => set({ color: c })} label="Text colour" /></Row> : null}
      </Group>

      <Group title="Distance">
        <Switch label="Big number" checked={t.hero} onChange={(v) => set({ hero: v })} tip="Show the distance as a huge number with the title beside it, like the 13.1 on a half-marathon shirt." />
        {t.hero ? (
          <Row label="Number" tip="Type the official distance, or leave empty to use the first route's length.">
            <TextField value={t.heroValue} onChange={(v) => set({ heroValue: v })} label="Big number" placeholder={auto ? `${auto} (from the route)` : 'such as 13.1'} tip="Leave empty to use the first route's length." />
          </Row>
        ) : (
          <Switch label="Distance line" checked={t.stats} onChange={(v) => set({ stats: v })} tip={`A line with each route's distance${firstKm > 0 ? `, such as ${formatDistance(firstKm, units)}` : ''}.`} />
        )}
      </Group>

      <Group title="Key" hint={icons.length ? 'Name each icon used on the print.' : 'Add pins with icons (in the Route tab) to give them a key.'}>
        <Switch label="Show a key" checked={t.legend} onChange={(v) => set({ legend: v })} tip="A small key that names the pin icons, such as a cup for coffee stops." />
        {t.legend
          ? icons.map((k) => (
              <Row key={k} label={iconLabel(k)}>
                <TextField value={legendName(doc.style, k)} onChange={(v) => edit((d) => ({ ...d, style: { ...d.style, legendNames: { ...d.style.legendNames, [k]: v } } }))} label={`Name for the ${iconLabel(k).toLowerCase()}`} tip="Printed in capitals in the key." />
              </Row>
            ))
          : null}
      </Group>

      <Group title="Scale, compass and position" hint="Printed in the text colour, so they add no ink.">
        <Switch label="Scale bar" checked={fu.scale} onChange={(v) => setFu({ scale: v })}
          tip="A round distance, such as 1 mile, drawn at the map's true scale. It picks a new length as you zoom." />
        {fu.scale ? (
          <StylePicker label="Scale bar style" value={fu.scaleStyle} onChange={(v) => setFu({ scaleStyle: v })} shirt={knock} wide
            options={SCALES.map((o) => ({ ...o, svg: scalePreviewSvg(o.value, units, printed.text.color, 150, 34) }))} />
        ) : null}
        <Switch label="Compass" checked={fu.compass} onChange={(v) => setFu({ compass: v })} tip="A north arrow. North is always at the top of this map." />
        {fu.compass ? (
          <StylePicker label="Compass style" value={fu.compassStyle} onChange={(v) => setFu({ compassStyle: v })} shirt={knock}
            options={COMPASSES.map((o) => ({ ...o, svg: compassPreviewSvg(o.value, printed.text.color, printed.pinColor, knock, 60, 40) }))} />
        ) : null}
        {fu.scale || fu.compass || (fu.coords && !t.show) ? (
          <Row label="Where" tip="Pick a corner of the map, or the text band.">
            <PlacePicker value={fu.place} onChange={(v) => setFu({ place: v })} band={t.show} />
          </Row>
        ) : null}
        <Switch label="Coordinates" checked={fu.coords} onChange={(v) => setFu({ coords: v })}
          tip={`The map's position as a line of text, such as ${formatCoords(at, fu.coordFormat)}. It goes in the text band, or with the scale bar when the text is off.`} />
        {fu.coords ? (
          <>
            <Segmented label="Coordinates format" value={fu.coordFormat} onChange={(v) => setFu({ coordFormat: v })}
              options={FORMATS.map((f) => {
                const text = formatCoords(at, f.value)
                return { value: f.value, label: text.slice(0, text.search(/ [NS] /) + 2), tip: `${f.name}: ${text}.` }
              })} />
            <Segmented label="Coordinates of" value={fu.coordsOf} onChange={(v) => setFu({ coordsOf: v })} options={[
              { value: 'center', label: 'Map centre', tip: 'The middle of the map. It moves as you move the map.' },
              { value: 'start', label: 'Route start', tip: hasStart ? "Where the first route starts, such as the club's meeting spot." : 'Draw a route first. Until then this gives the map centre.' },
            ]} />
          </>
        ) : null}
      </Group>

      <Group title="Layout">
        <Segmented label="Where the text goes" value={t.placement} onChange={(v) => set({ placement: v })} options={[
          { value: 'below', label: 'Below the map', tip: 'A band under the map, so nothing covers the streets.' },
          { value: 'over', label: 'Over the map', tip: 'Over the bottom of the map, on a plate in the shirt colour (prints as no ink).' },
        ]} />
        {!t.hero ? (
          <Segmented label="Text alignment" value={t.align} onChange={(v) => set({ align: v })} options={[
            { value: 'left', label: 'Left', tip: 'Line the text up on the left.' },
            { value: 'center', label: 'Centre', tip: 'Centre the text, good with a circle frame.' },
          ]} />
        ) : null}
      </Group>
    </>
  )
}
