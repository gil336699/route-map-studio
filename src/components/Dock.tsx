// The bottom dock: the tools, the status, and the switch between the print and the shirt.
import type { Tool } from './Viewport'
import { Btn } from './Controls'
import { tip } from './tip'

export interface Status {
  text: string
  kind: 'info' | 'warn' | 'busy'
  id: number
}

interface Props {
  tool: Tool
  setTool: (t: Tool) => void
  status: Status | null
  loadingSeconds: number | null
  loadingText: string
  onCancel: () => void
  showDownload: boolean
  onDownload: () => void
  view: 'print' | 'shirt'
  setView: (v: 'print' | 'shirt') => void
}

const TOOLS: { id: Tool; label: string; key: string; tip: string }[] = [
  { id: 'draw', label: 'Draw', key: 'D', tip: 'Click the map to add points to the selected route.' },
  { id: 'pin', label: 'Pin', key: 'P', tip: 'Click the map to drop a pin, then type its label.' },
  { id: 'move', label: 'Move', key: 'M', tip: 'Drag to move the map under the page. Scroll or pinch to zoom.' },
]

export function Dock({ tool, setTool, status, loadingSeconds, loadingText, onCancel, showDownload, onDownload, view, setView }: Props) {
  return (
    <div className="glass dock" role="toolbar" aria-label="Tools">
      <div className="segmented tools" role="radiogroup" aria-label="Tool">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={tool === t.id} className={tool === t.id ? 'on' : ''}
            onClick={() => setTool(t.id)} disabled={view === 'shirt'} {...tip(view === 'shirt' ? 'Switch back to the print to use the tools.' : t.tip, t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className={`status ${status?.kind ?? ''}`} role="status" aria-live="polite">
        {loadingSeconds !== null ? (
          <>
            <span className="spinner small" aria-hidden="true" />
            <span>{loadingText} {loadingSeconds} s</span>
            <Btn variant="quiet" tip="Stop the download. The map you had stays." onClick={onCancel}>Stop</Btn>
          </>
        ) : (
          <>
            <span>{status?.text ?? ''}</span>
            {showDownload ? <Btn variant="primary" tip="Download the map for the area the page now shows." onClick={onDownload}>Download this view</Btn> : null}
          </>
        )}
      </div>
      <div className="segmented view" role="radiogroup" aria-label="View">
        <button type="button" role="radio" aria-checked={view === 'print'} className={view === 'print' ? 'on' : ''} onClick={() => setView('print')} {...tip('Work on the print itself.')}>Print</button>
        <button type="button" role="radio" aria-checked={view === 'shirt'} className={view === 'shirt' ? 'on' : ''} onClick={() => setView('shirt')} {...tip('See the print at its real size on the back of a shirt.')}>On shirt</button>
      </div>
    </div>
  )
}
