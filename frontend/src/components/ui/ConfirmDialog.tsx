import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'

interface ConfirmDialogProps {
  title: string
  /** One sentence saying what will happen. If it needs a paragraph, the
   *  action needs a screen, not a dialog. */
  text: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  /** Marks the confirm action as irreversible. It then takes the danger
   *  variant and, deliberately, is NOT the visually dominant button. */
  destructive?: boolean
  loading?: boolean
}

/**
 * Confirm dialog — docs/design-system/02-components.md#دیالوگ-تأیید
 *
 * Only for a decision with consequences: delete, cancel a request, pay.
 * Telling the user that something succeeded is a toast's job — a dialog
 * for that is an interruption asking to be dismissed.
 */
export function ConfirmDialog({
  title,
  text,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation()

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Escape cancels. There is deliberately no Enter-confirms: this
      // dialog only appears for things worth a deliberate tap.
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  return (
    <div className="ui-scrim ui-scrim-dialog" onClick={onCancel} role="presentation">
      <div
        className="ui-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="ui-dialog-title">{title}</h2>
        <p className="ui-dialog-text">{text}</p>
        <div className="ui-dialog-actions">
          {/* Cancel comes first, so the destructive action is not the one
              sitting where the thumb lands by default. */}
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
