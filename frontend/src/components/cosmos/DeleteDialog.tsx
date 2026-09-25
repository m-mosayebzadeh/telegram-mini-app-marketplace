import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'

interface DeleteDialogProps {
  count: number
  /** The other person's name, for "also delete for Sara". Null when the
   *  choice is not on offer — somebody else's message, or a paid-session
   *  message that can no longer be taken back — and the dialog is then a
   *  plain "are you sure". */
  alsoFor: string | null
  onConfirm: (forEveryone: boolean) => void
  onCancel: () => void
}

/**
 * Deleting messages, in the shape the owner asked for: your own ones offer
 * "also delete for Sara"; anybody else's are only ever removed from your
 * own view, so the dialog just asks whether you are sure.
 *
 * Built on the same dialog as every other confirmation in the app, with
 * the one extra line of the choice. The box starts unticked: deleting for
 * the other person is the bigger act and should be chosen, not defaulted.
 */
export function DeleteDialog({ count, alsoFor, onConfirm, onCancel }: DeleteDialogProps) {
  const { t } = useTranslation()
  const [forEveryone, setForEveryone] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="ui-scrim ui-scrim-dialog" onClick={onCancel} role="presentation">
      <div
        className="ui-dialog cos-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={t('talk.delete.title', { count })}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="ui-dialog-title">{t('talk.delete.title', { count })}</h2>
        <p className="ui-dialog-text">{t('talk.delete.sure', { count })}</p>

        {alsoFor && (
          <label className="cos-delete-also">
            <input
              type="checkbox"
              checked={forEveryone}
              onChange={(event) => setForEveryone(event.target.checked)}
            />
            <span className="cos-delete-box" aria-hidden="true" />
            {t('talk.delete.alsoFor', { name: alsoFor })}
          </label>
        )}

        <div className="ui-dialog-actions">
          <Button variant="secondary" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={() => onConfirm(alsoFor !== null && forEveryone)}>
            {t('talk.delete.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
