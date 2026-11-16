// In-app dialog. Traps Tab, closes on Esc, focuses the intended button and returns focus afterwards.
// (Native confirm() is blocked in the Code tab and looks out of place, so the app uses its own.)
import { useEffect, useRef, type ReactNode } from 'react'

const FOCUSABLE = 'button:not([aria-disabled="true"]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const box = ref.current
    if (box) {
      const first = box.querySelector<HTMLElement>('[data-autofocus]') ?? box.querySelector<HTMLElement>(FOCUSABLE)
      first?.focus()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !box) return
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) return
      const first = items[0] as HTMLElement
      const last = items[items.length - 1] as HTMLElement
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus()
    }
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
