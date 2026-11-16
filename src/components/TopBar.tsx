// The top bar: open, save and export, with the unsaved-changes dot, and help.
import { Btn } from './Controls'

interface Props {
  dirty: boolean
  exportReason: string | undefined
  onOpen: () => void
  onSave: () => void
  onExport: () => void
  onHelp: () => void
}

export function TopBar({ dirty, exportReason, onOpen, onSave, onExport, onHelp }: Props) {
  return (
    <div className="glass topbar" role="toolbar" aria-label="File">
      <Btn tip="Open a saved project." shortcut="⌘O" onClick={onOpen}>Open</Btn>
      <Btn tip={dirty ? 'Save the project. There are unsaved changes.' : 'Save the project. Everything is saved.'} shortcut="⌘S" onClick={onSave}>
        {dirty ? <span className="dirty-dot" aria-label="Unsaved changes" /> : null}
        Save project
      </Btn>
      <Btn variant="primary" tip="Export the print as a layered SVG for Illustrator." shortcut="⌘E" onClick={onExport} disabledReason={exportReason}>Export SVG</Btn>
      <Btn variant="quiet" className="icon" label="Help" tip="Quick start and keyboard shortcuts." shortcut="?" onClick={onHelp}>?</Btn>
    </div>
  )
}
