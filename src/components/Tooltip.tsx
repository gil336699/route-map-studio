// One tooltip layer for the whole app. Any element with data-tip gets a tooltip on hover (after a short
// pause, then at once while moving along a row) and when the keyboard moves focus to it. Native title
// tooltips are slow.
import { useEffect, useState } from 'react'

interface Shown {
  text: string
  shortcut?: string
  x: number
  y: number
  above: boolean
}

export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null)

  useEffect(() => {
    let timer = 0
    let current: HTMLElement | null = null
    let lastShown = 0
    // Whether the keyboard was used since the last press of a mouse, pen or finger. A click focuses what
    // it clicks too, and a tooltip popping up under the pointer on every click is noise, so focus shows a
    // tooltip only after a key. (:focus-visible would not do: text fields match it after a click.)
    let keyboard = false

    const hide = () => {
      window.clearTimeout(timer)
      if (current) current.removeAttribute('aria-describedby')
      current = null
      setShown(null)
    }
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip
      if (!text) return
      const r = el.getBoundingClientRect()
      const above = r.bottom + 70 > window.innerHeight
      const x = Math.min(window.innerWidth - 140, Math.max(140, r.left + r.width / 2))
      el.setAttribute('aria-describedby', 'app-tooltip')
      lastShown = Date.now()
      setShown({ text, shortcut: el.dataset.shortcut, x, y: above ? r.top - 8 : r.bottom + 8, above })
    }
    const target = (e: Event) => (e.target instanceof Element ? (e.target.closest('[data-tip]') as HTMLElement | null) : null)
    const schedule = (el: HTMLElement, delay: number) => {
      hide()
      current = el
      timer = window.setTimeout(() => show(el), delay)
    }
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      const el = target(e)
      if (el === current) return
      if (!el) return hide()
      schedule(el, Date.now() - lastShown < 500 ? 0 : 500)
    }
    const onFocus = (e: FocusEvent) => {
      if (!keyboard) return
      const el = target(e)
      if (el) schedule(el, 0)
    }
    const onDown = () => {
      keyboard = false
      hide()
    }
    const onKey = (e: KeyboardEvent) => {
      keyboard = true
      if (e.key === 'Escape') hide()
    }
    // Focus the browser puts back when the window comes to the front again is not the keyboard moving it.
    const onLeave = () => {
      keyboard = false
      hide()
    }
    // Presses and keys are seen on the way down, before any handler can stop them or move focus.
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', onKey, true)
    // A tooltip left behind after the window moves under it would point at nothing.
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('resize', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', onLeave)
      hide()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [])

  if (!shown) return null
  return (
    <div
      id="app-tooltip"
      role="tooltip"
      className={`tooltip${shown.above ? ' above' : ''}`}
      style={{ left: shown.x, top: shown.y }}
    >
      {shown.text}
      {shown.shortcut ? <kbd>{shown.shortcut}</kbd> : null}
    </div>
  )
}

