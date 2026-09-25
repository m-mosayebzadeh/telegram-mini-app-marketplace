import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '../ui/Sheet'
import { Button } from '../ui/Button'
import { formatApiError } from '../../lib/api'
import {
  MAX_REPORT_NOTE,
  REPORT_REASONS,
  sendReport,
  type ReportReason,
} from '../../lib/conversationApi'

interface ReportSheetProps {
  reportedUserId: number
  name: string
  conversationId?: number
  /** Which reason to have selected when it opens. The warning under a card
   *  number opens this with "asked me to pay outside the app" already
   *  chosen, because that is almost certainly why somebody tapped it. */
  initialReason?: ReportReason
  onClose: () => void
  onSent: () => void
}

/**
 * Telling staff somebody behaved badly.
 *
 * A reason with one tap, and a few optional words beside it. The reason
 * is a choice rather than a text box because staff sort and act on it; a
 * free box would produce reports nobody can triage. The words are there
 * for what a list cannot say.
 *
 * Nothing about the outcome is promised back. Telling the reporter what
 * happened next would either be a lie or a leak about somebody else.
 */
export function ReportSheet({
  reportedUserId,
  name,
  conversationId,
  initialReason,
  onClose,
  onSent,
}: ReportSheetProps) {
  const { t } = useTranslation()
  const [reason, setReason] = useState<ReportReason | null>(initialReason ?? null)
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!reason || sending) return
    setSending(true)
    setError(null)
    try {
      await sendReport({ reportedUserId, reason, note, conversationId })
      onSent()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <Sheet
      title={t('report.title', { name })}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" block disabled={!reason} loading={sending} onClick={send}>
          {t('report.send')}
        </Button>
      }
    >
      <div className="cos-report-reasons" role="radiogroup" aria-label={t('report.why')}>
        {REPORT_REASONS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={reason === option}
            className={`cos-report-reason${reason === option ? ' is-on' : ''}`}
            onClick={() => setReason(option)}
          >
            {t(`report.reasons.${option}`)}
          </button>
        ))}
      </div>

      <label className="ui-field" htmlFor="report-note">
        <span className="ui-field-label">
          {t('report.noteLabel')}
          <span className="ui-field-counter">
            {note.length} / {MAX_REPORT_NOTE}
          </span>
        </span>
        <textarea
          id="report-note"
          className="ui-textarea cos-report-note"
          value={note}
          maxLength={MAX_REPORT_NOTE}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('report.notePlaceholder')}
        />
      </label>

      {error && <p className="ui-field-error">{error}</p>}
    </Sheet>
  )
}
