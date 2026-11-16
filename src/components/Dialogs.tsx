// The quick start, the help dialog and the confirm dialog.
import { Modal } from './Modal'

export function QuickStart({ onExample, onClose }: { onExample: () => void; onClose: () => void }) {
  return (
    <Modal title="Route Map Studio" onClose={onClose}>
      <p className="lead">Turn a running route into a print-ready map for a shirt, layered for Illustrator.</p>
      <ol className="steps">
        <li><b>Find the place.</b> Search in the Place tab. The map downloads from OpenStreetMap.</li>
        <li><b>Draw the route.</b> Press D and click along it, or import a GPX from Strava. Tick the cafés and landmarks along the way.</li>
        <li><b>Pick a look and export.</b> Hold it to 1–3 inks if it will be screen printed, then export the SVG.</li>
      </ol>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>Start from scratch</button>
        <button type="button" className="btn primary" data-autofocus onClick={onExample}>Show me an example</button>
      </div>
    </Modal>
  )
}

const SHORTCUTS: [string, string][] = [
  ['D', 'Draw: click to add route points, drag a point or the line to edit'],
  ['P', 'Pin: click to drop a pin'],
  ['M', 'Move: drag the map'],
  ['[  ]', 'Draw: pick the previous or next point'],
  ['Delete', 'Draw: remove the picked point'],
  ['Esc', 'Let a picked point go, back to Move, or close a dialog'],
  ['F', 'Fit the map to the routes'],
  ['⌘Z', 'Undo the last change to a route or pin'],
  ['⇧⌘Z', 'Redo'],
  ['⌘S', 'Save the project'],
  ['⌘O', 'Open a project'],
  ['⌘E', 'Export SVG'],
  ['?', 'This help'],
]

export function HelpDialog({ onClose, onQuickStart }: { onClose: () => void; onQuickStart: () => void }) {
  return (
    <Modal title="Help" onClose={onClose} wide>
      <div className="help-grid">
        <section>
          <h3>Keyboard shortcuts</h3>
          <table className="keys"><tbody>
            {SHORTCUTS.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}
          </tbody></table>
          <p className="hint">Scroll or pinch on the print to zoom. With two fingers on a touch screen, pinch and drag.</p>
        </section>
        <section>
          <h3>Tips</h3>
          <ul className="notes">
            <li>Ask the club for a GPX of each route. In Strava on the web, open the run, then the ⋯ menu, then Export GPX.</li>
            <li>To change a drawn route, press D. Drag a point to move it, drag the line or a + to add a detour, and click a point to remove it. Only the stretch beside the point is drawn again.</li>
            <li>If drawing along roads takes a long way round, the map is missing a path there. Undo, switch to Straight, and click again.</li>
            <li>Screen printers need lines of at least 1 pt, 2 pt for light ink on a dark shirt, and text of at least 8 pt. The print check watches for both.</li>
            <li>Map data © OpenStreetMap contributors, under the Open Database License. Keep the credit on the print or the shirt’s tag.</li>
          </ul>
        </section>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onQuickStart}>Show the quick start</button>
        <button type="button" className="btn primary" data-autofocus onClick={onClose}>Done</button>
      </div>
    </Modal>
  )
}

export interface ConfirmState {
  title: string
  body: string
  confirm: string
  danger?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  return (
    <Modal title={state.title} onClose={onClose}>
      <p>{state.body}</p>
      <div className="modal-actions">
        <button type="button" className="btn" data-autofocus onClick={onClose}>Cancel</button>
        <button type="button" className={state.danger ? 'btn danger' : 'btn primary'} onClick={() => { onClose(); state.onConfirm() }}>{state.confirm}</button>
      </div>
    </Modal>
  )
}
