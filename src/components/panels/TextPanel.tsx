// Text: the club name, a subtitle, the distance (as a line or a huge number) and a key for the icons.
import type { Doc } from '../../lib/doc'
import { formatDistance } from '../../map/scene'
import type { Pin, Style, TextStyle } from '../../map/types'
import { ColorField, Group, Row, Segmented, Switch, TextField } from '../Controls'

interface Props {
  doc: Doc
  edit: (fn: (d: Doc) => Doc) => void
  firstKm: number
}

type LegendKey = keyof Style['legendNames']
const LEGEND_LABELS: Record<LegendKey, string> = { coffee: 'Coffee icon', museum: 'Museum icon', water: 'Water icon', star: 'Star icon', flag: 'Flag icon' }

function usedIcons(pins: Pin[]): LegendKey[] {
  const out: LegendKey[] = []
  for (const p of pins) {
    const i = p.icon ?? 'dot'
    if (i !== 'dot' && i !== 'label' && !out.includes(i)) out.push(i)
  }
  return out
}

export function TextPanel({ doc, edit, firstKm }: Props) {
  const t = doc.style.text
  const limited = doc.style.inkLimit > 0
  const set = (patch: Partial<TextStyle>) => edit((d) => ({ ...d, style: { ...d.style, text: { ...d.style.text, ...patch } } }))
  const units = doc.style.distance.units
  const auto = firstKm > 0 ? (units === 'mi' ? firstKm / 1.609344 : firstKm).toFixed(1) : ''
  const icons = usedIcons(doc.pins)

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
              <Row key={k} label={LEGEND_LABELS[k]}>
                <TextField value={doc.style.legendNames[k]} onChange={(v) => edit((d) => ({ ...d, style: { ...d.style, legendNames: { ...d.style.legendNames, [k]: v } } }))} label={`Name for the ${LEGEND_LABELS[k].toLowerCase()}`} tip="Printed in capitals in the key." />
              </Row>
            ))
          : null}
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
