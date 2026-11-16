// The print check, always in view: the inks the print needs, the ink limit, and any warnings.
import type { PrintCheck } from '../lib/printcheck'
import type { SceneStats, Style } from '../map/types'
import { formatUnit } from '../lib/units'
import { luminance } from '../lib/printcheck'
import { Segmented } from './Controls'
import { tip } from './tip'

interface Props {
  check: PrintCheck | null
  stats: SceneStats | null
  widthMm: number
  heightMm: number
  shirt: string
  inkLimit: Style['inkLimit']
  setInkLimit: (n: Style['inkLimit']) => void
}

export function PrintCheckCard({ check, stats, widthMm, heightMm, shirt, inkLimit, setInkLimit }: Props) {
  const inks = check?.inks ?? []
  return (
    <section className="glass checkcard" aria-label="Print check">
      <div className="check-head">
        <strong>Print check</strong>
        <span className="ink-count" {...tip('Each ink is a separate screen at the printer. The shirt colour is not counted.')}>{inks.length} ink{inks.length === 1 ? '' : 's'}</span>
      </div>
      <Segmented label="Ink limit" value={String(inkLimit) as '0' | '1' | '2' | '3'} onChange={(v) => setInkLimit(Number(v) as Style['inkLimit'])} options={[
        { value: '1', label: '1', tip: 'Hold the print to one ink.' },
        { value: '2', label: '2', tip: 'Hold the print to two inks.' },
        { value: '3', label: '3', tip: 'Hold the print to three inks.' },
        { value: '0', label: 'Any', tip: 'Any number of colours.' },
      ]} />
      <div className="swatches" aria-label="Inks">
        <span className={luminance(shirt) > 0.45 ? 'swatch shirt light' : 'swatch shirt'} style={{ background: shirt }} {...tip(`Shirt ${shirt}, not printed.`)}>shirt</span>
        {inks.map((c) => <span key={c} className="swatch" style={{ background: c }} {...tip(`Ink ${c}`)} />)}
      </div>
      {check ? (
        check.warnings.length ? (
          <ul className="warnings">{check.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        ) : (
          <p className="ok">Lines and text are thick enough to print.</p>
        )
      ) : null}
      <p className="meta">
        {formatUnit(widthMm, 'in')} × {formatUnit(heightMm, 'in')} in
        {stats ? ` · ${stats.paths} paths · ${Math.round(stats.bytes / 1024)} KB` : ''}
      </p>
    </section>
  )
}
