import { useEffect, type ReactNode } from 'react'

/**
 * A sheet, in the world's language.
 *
 * The old `ui-*` sheet exists and works, but a screen reads one visual
 * language or the other and never both (see cosmos.css) — a pale card
 * rising out of a night sky is two products in one screenshot.
 *
 * Everything a sheet owes the person using it:
 * a handle so it reads as draggable, a backdrop that dismisses on tap,
 * its own title, and a height that fits its contents rather than always
 * filling the screen. A sheet that always covers everything should have
 * been a pushed screen.
 */

interface CosSheetProps {
  title: string
  onClose: () => void
  children: ReactNode
  /** For a sheet whose picture says what it is (the note, written above
   *  your own orb): the title stays for screen readers only. */
  titleHidden?: boolean
  /** A variant of the sheet's own frame, such as "is-note". */
  className?: string
}

export function CosSheet({ title, onClose, children, titleHidden, className }: CosSheetProps) {
  // Escape closes it, because a sheet with no keyboard exit is a trap on
  // the desktop where this is also opened during development.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="cos-sheet-layer">
      <button
        type="button"
        className="cos-sheet-veil"
        onClick={onClose}
        aria-label={title}
      />
      <div className={`cos-sheet${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <span className="cos-sheet-grab" aria-hidden="true" />
        <h2 className={titleHidden ? 'cos-visually-hidden' : 'cos-sheet-title'}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
