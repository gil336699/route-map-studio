// A pin's icon, picked from a grid grouped by kind, each icon drawn the way it prints. The grid opens
// on the page itself (not inside the scrolling panel), below the button or above it, wherever it fits.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ICON_GROUPS, ICONS } from '../map/icons'
import { iconSvg } from '../map/scene'
import type { PinIcon } from '../map/types'
import { tip } from './tip'

const PLAIN: { id: PinIcon; label: string }[] = [{ id: 'dot', label: 'Dot' }, { id: 'label', label: 'Text only' }]
const GROUPS: { name: string; items: { id: PinIcon; label: string }[] }[] = [
  { name: 'Plain', items: PLAIN },
  ...ICON_GROUPS.map((g) => ({ name: g, items: ICONS.filter((i) => i.group === g) })),
]
const COLUMNS = 7
const WIDTH = 290
const TALL = 430

const iconLabel = (id: PinIcon) => ICONS.find((i) => i.id === id)?.label ?? PLAIN.find((p) => p.id === id)?.label ?? 'Dot'

interface Props {
  value: PinIcon
  onChange: (v: PinIcon) => void
  /** The pin ink and the knockout colour, so the icons look as they will print. */
  color: string
  knock: string
  label: string
}

type Place = { left: number; top?: number; bottom?: number; maxHeight: number }

export function IconPicker({ value, onChange, color, knock, label }: Props) {
  const [place, setPlace] = useState<Place | null>(null)
  const open = place !== null
  const trigger = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = (refocus: boolean) => {
    setPlace(null)
    if (refocus) trigger.current?.focus()
  }

  /** Open below the button if the grid fits there, else wherever there is more room. */
  const toggle = () => {
    if (open) return close(false)
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom - 12
    const above = r.top - 12
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8))
    setPlace(below >= Math.min(TALL, 320) || below >= above
      ? { left, top: r.bottom + 6, maxHeight: Math.min(TALL, below) }
      : { left, bottom: window.innerHeight - r.top + 6, maxHeight: Math.min(TALL, above) })
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!pop.current?.contains(t) && !trigger.current?.contains(t)) setPlace(null)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setPlace(null)
      trigger.current?.focus()
    }
    // The grid is placed for where the button is now; when the panel scrolls or the window changes, it closes.
    const onMove = (e: Event) => {
      if (pop.current && e.target instanceof Node && pop.current.contains(e.target)) return
      setPlace(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    // Start on the icon the pin has now.
    const raf = requestAnimationFrame(() => pop.current?.querySelector<HTMLElement>('.icon-cell[aria-pressed="true"]')?.focus())
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
      cancelAnimationFrame(raf)
    }
  }, [open])

  const pick = (v: PinIcon) => {
    onChange(v)
    close(true)
  }

  // Arrow keys move through the icons: across one at a time, up and down a row.
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[e.key]
    if (!step) return
    const cells = [...(pop.current?.querySelectorAll<HTMLElement>('.icon-cell') ?? [])]
    const at = cells.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    e.preventDefault()
    cells[Math.max(0, Math.min(cells.length - 1, at + step))]?.focus()
  }

  return (
    <div className="icon-picker">
      <button ref={trigger} type="button" className="icon-pick" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-label={`${label}: ${iconLabel(value)}`} onClick={toggle} {...tip(`${iconLabel(value)}. Click to choose another icon.`)}>
        <span className="icon-svg" dangerouslySetInnerHTML={{ __html: iconSvg(value, color, knock, 22) }} />
        <span className="chev" aria-hidden="true">▾</span>
      </button>
      {place ? createPortal(
        <div ref={pop} className="glass icon-pop" role="dialog" id={id} aria-label={label} onKeyDown={onGridKey}
          style={{ left: place.left, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}>
          {GROUPS.map((g) => (
            <div key={g.name} className="icon-group" role="group" aria-label={g.name}>
              <div className="icon-group-name">{g.name}</div>
              <div className="icon-grid">
                {g.items.map((it) => (
                  <button key={it.id} type="button" className={it.id === value ? 'icon-cell on' : 'icon-cell'} aria-pressed={it.id === value}
                    aria-label={it.label} data-tip={it.label} onClick={() => pick(it.id)}>
                    <span dangerouslySetInnerHTML={{ __html: iconSvg(it.id, color, knock, 24) }} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  )
}
