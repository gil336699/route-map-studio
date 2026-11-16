// Export: page size and units, then the files: layered SVG for Illustrator, PNG, and the project.
import type { Doc } from '../../lib/doc'
import { SIZE_PRESETS, UNITS, formatUnit, fromMm, toMm, type Unit } from '../../lib/units'
import type { TextStyle } from '../../map/types'
import { Btn, Group, NumberBox, Row, Segmented, Switch } from '../Controls'
import { tip } from '../tip'

interface Props {
  doc: Doc
  edit: (fn: (d: Doc) => Doc) => void
  ready: string | undefined
  busy: string | undefined
  onExportSvg: () => void
  onExportPng: (dpi: number) => void
  onSave: () => void
  onOpen: () => void
}

const UNIT_TIPS: Record<Unit, string> = {
  mm: 'Millimetres.',
  in: 'Inches, as printers quote shirt prints.',
  pt: 'Points, 72 to the inch.',
  px: 'Pixels as Illustrator counts them, 72 to the inch.',
}

export function ExportPanel({ doc, edit, ready, busy, onExportSvg, onExportPng, onSave, onOpen }: Props) {
  const f = doc.frame
  const u = doc.unit
  const preset = SIZE_PRESETS.find((p) => Math.abs(p.widthMm - f.widthMm) < 0.05 && Math.abs(p.heightMm - f.heightMm) < 0.05)
  const setSize = (widthMm: number, heightMm: number) => edit((d) => ({ ...d, frame: { ...d.frame, widthMm, heightMm } }))
  const setText = (patch: Partial<TextStyle>) => edit((d) => ({ ...d, style: { ...d.style, text: { ...d.style.text, ...patch } } }))
  const max = { mm: 1500, in: 59, pt: 4252, px: 4252 }[u]
  const min = { mm: 25, in: 1, pt: 72, px: 72 }[u]
  const why = ready ?? busy

  return (
    <>
      <Group title="Print size" hint="The map keeps its width on the ground, so a taller page shows more to the north and south.">
        <select className="select wide" aria-label="Print size" value={preset?.id ?? 'custom'} onChange={(e) => {
          const p = SIZE_PRESETS.find((x) => x.id === e.target.value)
          if (p) setSize(p.widthMm, p.heightMm)
        }} {...tip('Common print sizes. The back of an adult shirt is usually 12 × 14 in.')}>
          {SIZE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          <option value="custom" disabled>Custom size</option>
        </select>
        <Row label="Width">
          <NumberBox value={Number(formatUnit(f.widthMm, u))} onCommit={(v) => setSize(toMm(v, u), f.heightMm)} min={min} max={max} decimals={u === 'in' ? 2 : 1} label="Print width" tip={`Width of the print in ${u}.`} suffix={u} />
        </Row>
        <Row label="Height">
          <NumberBox value={Number(formatUnit(f.heightMm, u))} onCommit={(v) => setSize(f.widthMm, toMm(v, u))} min={min} max={max} decimals={u === 'in' ? 2 : 1} label="Print height" tip={`Height of the print in ${u}.`} suffix={u} />
        </Row>
        <Segmented label="Units" value={u} onChange={(v) => edit((d) => ({ ...d, unit: v }))} options={UNITS.map((x) => ({ value: x, label: x, tip: UNIT_TIPS[x] }))} />
        <p className="hint">{`${formatUnit(f.widthMm, 'in')} × ${formatUnit(f.heightMm, 'in')} in, ${Math.round(f.widthMm)} × ${Math.round(f.heightMm)} mm, ${Math.round(fromMm(f.widthMm, 'pt'))} × ${Math.round(fromMm(f.heightMm, 'pt'))} pt.`}</p>
      </Group>

      <Group title="Files" hint="The SVG opens in Illustrator at real size, one group per layer, with live text.">
        <div className="btn-col">
          <Btn variant="primary" tip="Save the print as a layered SVG for Illustrator." shortcut="⌘E" onClick={onExportSvg} disabledReason={why}>Export SVG</Btn>
          <Btn tip="Save a 300 dpi PNG, for a mock-up or a DTG printer." onClick={() => onExportPng(300)} disabledReason={why}>Export PNG, 300 dpi</Btn>
          <Btn tip="Save the routes, pins and settings to open again later." shortcut="⌘S" onClick={onSave}>Save project</Btn>
          <Btn tip="Open a saved project. Its map downloads again." shortcut="⌘O" onClick={onOpen}>Open project</Btn>
        </div>
        <Switch label="OpenStreetMap credit" checked={doc.style.text.credit} onChange={(v) => setText({ credit: v })}
          tip="OpenStreetMap's licence asks for credit. It prints small up the right edge; turn it off if the credit goes on the shirt's tag instead." />
      </Group>

      <Group title="In Illustrator">
        <ul className="notes">
          <li>Each layer arrives as a named group: Water, Streets, Main roads, Route 1, Pins, Text.</li>
          <li>A circle or rounded frame is a clipping mask you can edit.</li>
          <li>Knockouts (route outlines, icon cut-outs, the text plate) are filled with the shirt colour. Tell the printer they print as no ink.</li>
          <li>Text stays live, set in Helvetica Neue. Swap in the club’s font there.</li>
        </ul>
      </Group>
    </>
  )
}
