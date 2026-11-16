// One tooltip layer for the whole app. Any element with data-tip gets a tooltip on hover (after a short
// pause, then at once while moving along a row) and on keyboard focus. Native title tooltips are slow.
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
      const el = target(e)
      if (el) schedule(el, 0)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerdown', hide)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', onKey)
    // A tooltip left behind after the window moves under it would point at nothing.
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('resize', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      hide()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerdown', hide)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', onKey)
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

