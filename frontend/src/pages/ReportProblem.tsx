import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/ui'
import { QuietPage, QuietSection } from '../components/cosmos/Quiet'
import { formatApiError } from '../lib/api'
import { sendFeedback } from '../lib/accountApi'

/** Longest message, the same as the server's. */
const MAX = 1000

/**
 * "Report a problem" (section 32, step 4; drawn as the approved prototype,
 * section 42): a few words about the app itself — something broken,
 * something confusing, an idea. Read by the team in the admin panel. A
 * report about a person is a different thing, made from their profile or
 * a conversation. The send button stays faint until there is something to
 * send, then warms.
 */
export default function ReportProblem() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    setBusy(true)
    try {
      // Where they came from, so "this does not work" has a place.
      const from = (window.history.state as { usr?: { from?: string } } | null)?.usr?.from ?? null
      await sendFeedback(text.trim(), from)
      toast.success(t('report.sent'))
      navigate(-1)
    } catch (err) {
      toast.error(formatApiError(err))
      setBusy(false)
    }
  }

  return (
    <QuietPage
      title={t('settings.report')}
      onBack={() => navigate(-1)}
      foot={
        <button type="button" className="cos-q-primary" disabled={text.trim() === '' || busy} onClick={() => void send()}>
          {t('report.send')}
        </button>
      }
    >
      <QuietSection className="is-tight">
        <div className="cos-q-field">
          <label htmlFor="report-text">{t('report.label')}</label>
          <textarea
            id="report-text"
            className="cos-q-input"
            dir="auto"
            maxLength={MAX}
            value={text}
            placeholder={t('report.placeholder')}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <p className="cos-q-help is-under">{t('report.hint')}</p>
      </QuietSection>
    </QuietPage>
  )
}
