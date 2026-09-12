import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClose } from '../icons'

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
  /**
   * The sheet's own primary action, pinned to its bottom edge. A form
   * whose submit button scrolls out of reach is a form people abandon,
   * so this is where it belongs — not at the end of the content.
   */
  footer?: ReactNode
  /**
   * Set for anything that would be painful to lose by accident — a
   * half-written message, a payment. It turns off both dismiss gestures
   * (backdrop tap and Escape) and leaves only the explicit close.
   */
  dismissible?: boolean
}

/**
 * Bottom sheet — docs/design-system/02-components.md#شیت
 *
 * The interface's workhorse: short forms, choices, confirmations. The
 * page stays visible behind it, which is the whole reason to use one
 * instead of pushing a screen.
 */
export function Sheet({ title, onClose, children, footer, dismissible = true }: SheetProps) {
  const { t } = useTranslation()

  useEffect(() => {
    // A sheet that lets the page scroll behind it feels broken the
    // moment a finger lands slightly off the panel.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    if (!dismissible) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    // Escape matters on Telegram Desktop, where the mini app runs in a
    // window with a real keyboard.
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismissible, onClose])

  return (
    <div
      className="ui-scrim ui-scrim-sheet"
      onClick={dismissible ? onClose : undefined}
      role="presentation"
    >
      <div
        className="ui-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // A tap on a field inside the form must not reach the backdrop
        // and dismiss the sheet the user is filling in.
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ui-sheet-handle" />
        <div className="ui-sheet-header">
          <h2 className="ui-sheet-title">{title}</h2>
          <button className="ui-btn ui-btn-icon" onClick={onClose} aria-label={t('common.close')}>
            <IconClose size={20} />
          </button>
        </div>
        <div className="ui-sheet-body">{children}</div>
        {footer && <div className="ui-sheet-footer">{footer}</div>}
      </div>
    </div>
  )
}
