import type { ReactNode } from 'react'

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
}

/**
 * A bottom-sheet modal — used for anything that used to get shoved
 * inline into a page's List (edit-profile, upload-content). Tapping the
 * backdrop or the × closes it; tapping inside the sheet itself never
 * bubbles up to the backdrop's onClick, so a click on a field inside the
 * form doesn't accidentally dismiss it.
 */
export function Sheet({ title, onClose, children }: SheetProps) {
  return (
    <div className="hp-sheet-backdrop" onClick={onClose}>
      <div className="hp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="hp-sheet-handle" />
        <div className="hp-sheet-header">
          <h2 className="hp-sheet-title">{title}</h2>
          <button className="hp-sheet-close" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
