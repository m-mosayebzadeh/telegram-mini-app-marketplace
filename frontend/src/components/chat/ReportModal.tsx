import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../Sheet'

const REPORT_REASONS = ['inappropriateContent', 'spamOrScam', 'harassment', 'other'] as const

interface ReportModalProps {
  onClose: () => void
}

/**
 * The "report a problem with this conversation" flow — UI ONLY, per the
 * spec: a real reviewer/moderation backend for reports doesn't exist yet
 * (TECHNICAL_REQUIREMENTS.md already lists report/complaint handling as
 * an open, unbuilt item elsewhere in the app — see ProfileHeader's own
 * inert Report menu entry for the same reason). Picking a reason and
 * submitting here only shows a local acknowledgement; nothing is sent
 * anywhere. This is deliberately a real, usable form (not just a
 * disabled placeholder) because the spec explicitly calls for a reasons
 * list and a submit step to exist — just not a working backend yet.
 */
export function ReportModal({ onClose }: ReportModalProps) {
  const { t } = useTranslation()
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number] | null>(null)
  const [details, setDetails] = useState('')
  const [submitted, setSubmitted] = useState(false)

  if (submitted) {
    return (
      <Sheet title={t('chatSession.reportTitle')} onClose={onClose}>
        <p className="hp-bio">{t('chatSession.reportSubmitted')}</p>
        <div className="hp-field">
          <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={t('chatSession.reportTitle')} onClose={onClose}>
      <div className="hp-field">
        <span className="hp-field-label">{t('chatSession.reportReasonLabel')}</span>
        <div className="hp-menu">
          {REPORT_REASONS.map((key) => (
            <button
              key={key}
              className="hp-menu-item"
              style={reason === key ? { background: 'var(--hp-grad-soft)' } : undefined}
              onClick={() => setReason(key)}
            >
              {reason === key ? '● ' : '○ '}
              {t(`chatSession.reportReason.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="hp-field">
        <span className="hp-field-label">{t('chatSession.reportDetailsLabel')}</span>
        <textarea
          className="hp-chat-text-input"
          style={{ width: '100%', minHeight: 72, borderRadius: 14, resize: 'vertical' }}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={t('chatSession.reportDetailsPlaceholder')}
        />
      </div>

      <div className="hp-field">
        <button
          className="hp-btn hp-btn-gradient"
          style={{ width: '100%' }}
          disabled={!reason}
          onClick={() => setSubmitted(true)}
        >
          {t('chatSession.reportSubmitButton')}
        </button>
      </div>
    </Sheet>
  )
}
