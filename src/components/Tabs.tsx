// ARIA tabs with arrow, Home and End keys.
import type { KeyboardEvent } from 'react'
import { tip } from './tip'

export function Tabs<T extends string>({
  tabs, value, onChange, label,
}: { tabs: { id: T; label: string; tip: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === value)
    const moves: Record<string, number> = {
      ArrowRight: (i + 1) % tabs.length,
      ArrowLeft: (i - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }
    const next = moves[e.key]
    if (next === undefined) return
    e.preventDefault()
    const t = tabs[next]
    if (!t) return
    onChange(t.id)
    requestAnimationFrame(() => document.getElementById(`tab-${t.id}`)?.focus())
  }
  return (
    <div className="tabs segmented" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          aria-controls={`panel-${t.id}`}
          tabIndex={t.id === value ? 0 : -1}
          className={t.id === value ? 'on' : ''}
          onClick={() => onChange(t.id)}
          {...tip(t.tip)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
