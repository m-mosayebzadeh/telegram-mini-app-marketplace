import { useTranslation } from 'react-i18next'
import { Sheet } from '../Sheet'

interface EndSessionConfirmSheetProps {
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
}

/**
 * The confirmation step before actually closing a session — per the
 * spec, closing must be a deliberate, confirmed action (not a single
 * accidental tap) since it turns the conversation read-only. The actual
 * close call (backend/app/chat_session/router.py's close_session) only
 * fires once the user confirms here; cancelling changes nothing.
 */
export function EndSessionConfirmSheet({ onCancel, onConfirm, busy }: EndSessionConfirmSheetProps) {
  const { t } = useTranslation()

  return (
    <Sheet title={t('chatSession.endConfirmTitle')} onClose={onCancel}>
      <p className="hp-bio">{t('chatSession.endConfirmBody')}</p>
      <div className="hp-actions-row">
        <button className="hp-btn hp-btn-outline hp-btn-wide" onClick={onCancel} disabled={busy}>
          {t('chatSession.endConfirmCancel')}
        </button>
        <button className="hp-btn hp-btn-gradient" onClick={onConfirm} disabled={busy}>
          {busy ? t('common.loading') : t('chatSession.endConfirmConfirm')}
        </button>
      </div>
    </Sheet>
  )
}
