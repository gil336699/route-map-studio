// Pickers for the scale bar, compass and where they go: tiles that show each style as it prints, and a
// small page with its four map corners and the text band.
import type { FurniturePlace } from '../map/types'
import { tip } from './tip'

export interface StyleOption<T extends string> {
  value: T
  label: string
  tip: string
  /** The style drawn small, as SVG markup made by the scene code. */
  svg: string
}

/** A row of tiles, each a picture of one style on the shirt colour. */
export function StylePicker<T extends string>({ label, value, options, onChange, shirt, wide }: {
  label: string
  value: T
  options: StyleOption<T>[]
  onChange: (v: T) => void
  shirt: string
  /** Two tiles a row instead of four, for long shapes such as scale bars. */
  wide?: boolean
}) {
  return (
    <div className={wide ? 'style-pick wide' : 'style-pick'} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'style-tile on' : 'style-tile'}
          onClick={() => onChange(o.value)} {...tip(o.tip)}>
          <span className="style-art" style={{ background: shirt }} dangerouslySetInnerHTML={{ __html: o.svg }} />
          <span className="style-name">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

const CORNERS: { value: Exclude<FurniturePlace, 'band'>; label: string }[] = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
]

/**
 * Where the scale bar and compass go, picked on a small page: one of the map's four corners, or the text
 * band under it. Without text there is no band, so that choice says why it is off.
 */
export function PlacePicker({ value, onChange, band }: { value: FurniturePlace; onChange: (v: FurniturePlace) => void; band: boolean }) {
  // With the text off, a band choice waits, and the corner it falls back to shows as picked.
  const shown = value === 'band' && !band ? 'bottom-right' : value
  return (
    <div className="place-pick" role="radiogroup" aria-label="Where the scale bar and compass go">
      <div className="place-map">
        {CORNERS.map((c) => (
          <button key={c.value} type="button" role="radio" aria-checked={shown === c.value} aria-label={`${c.label} corner of the map`}
            className={`spot ${c.value}`} onClick={() => onChange(c.value)} {...tip(`In the ${c.label.toLowerCase()} corner of the map, with a knockout halo so they read over the streets.`)}>
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      <button type="button" role="radio" aria-checked={shown === 'band'} aria-disabled={!band || undefined} className="place-band"
        onClick={() => { if (band) onChange('band') }}
        {...tip(band ? 'In the text band, under the title line, so nothing covers the map.' : 'Turn on Show text to use the text band. Until then they sit in the bottom-right corner.')}>
        Text band
      </button>
    </div>
  )
}
