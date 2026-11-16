// Small reusable controls in the app's Liquid Glass style.
import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { tip } from './tip'

interface BtnProps {
  children: ReactNode
  onClick?: () => void
  tip: string
  shortcut?: string
  /** When set, the button looks and acts disabled, and its tooltip says why. */
  disabledReason?: string
  variant?: 'primary' | 'quiet' | 'danger'
  pressed?: boolean
  label?: string
  className?: string
}

export function Btn({ children, onClick, tip: text, shortcut, disabledReason, variant, pressed, label, className }: BtnProps) {
  const off = !!disabledReason
  return (
    <button
      type="button"
      className={`btn${variant ? ` ${variant}` : ''}${pressed ? ' pressed' : ''}${off ? ' off' : ''}${className ? ` ${className}` : ''}`}
      aria-disabled={off || undefined}
      aria-pressed={pressed}
      aria-label={label}
      onClick={off ? undefined : onClick}
      {...tip(off ? (disabledReason as string) : text, off ? undefined : shortcut)}
    >
      {children}
    </button>
  )
}

export function Switch({ checked, onChange, label, tip: text }: { checked: boolean; onChange: (v: boolean) => void; label: string; tip: string }) {
  return (
    <label className="row switch-row" {...tip(text)}>
      <span>{label}</span>
      <input type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function Segmented<T extends string>({
  value, options, onChange, label,
}: { value: T; options: { value: T; label: string; tip: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          {...tip(o.tip)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A number box that lets people type freely. The value applies on Enter or when the box loses focus. */
export function NumberBox({
  value, onCommit, min, max, decimals = 2, label, tip: text, suffix,
}: { value: number; onCommit: (v: number) => void; min: number; max: number; decimals?: number; label: string; tip: string; suffix?: string }) {
  const show = (v: number) => String(Number(v.toFixed(decimals)))
  const [text_, setText] = useState(show(value))
  const [prev, setPrev] = useState(value)
  if (value !== prev) {
    setPrev(value)
    setText(show(value))
  }
  const commit = () => {
    const n = Number(text_)
    if (!Number.isFinite(n) || text_.trim() === '') return setText(show(value))
    const clamped = Math.min(max, Math.max(min, n))
    setText(show(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setText(show(value))
  }
  return (
    <span className="numbox" {...tip(text)}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={text_}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
      />
      {suffix ? <span className="suffix">{suffix}</span> : null}
    </span>
  )
}

export function Slider({
  value, min, max, step, onChange, label, tip: text,
}: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string; tip: string }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <input
      type="range"
      className="slider"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      {...tip(text)}
    />
  )
}

export function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="color"
      className="color"
      aria-label={label}
      value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
      onChange={(e) => onChange(e.target.value)}
      {...tip(`${label}: ${value}`)}
    />
  )
}

export function Group({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  const id = useId()
  return (
    <section className="group" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </section>
  )
}

/** A technical word with a dotted underline that explains itself on hover. */
export function Term({ children, tip: text }: { children: ReactNode; tip: string }) {
  return (
    <span className="term" tabIndex={0} {...tip(text)}>
      {children}
    </span>
  )
}

export function TextField({
  value, onChange, label, placeholder, tip: text, id, onEnter,
}: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; tip: string; id?: string; onEnter?: () => void }) {
  return (
    <input
      id={id}
      className="textfield"
      type="text"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter()
      }}
      {...tip(text)}
    />
  )
}

/** A row with a label on the left and controls on the right. */
export function Row({ label, children, tip: text }: { label: string; children: ReactNode; tip?: string }) {
  return (
    <div className="row" {...(text ? tip(text) : {})}>
      <span className="row-label">{label}</span>
      <span className="row-controls">{children}</span>
    </div>
  )
}
