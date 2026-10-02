import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, PageHeader, useToast } from '../components/ui'
import { formatApiError } from '../lib/api'
import { sendFeedback } from '../lib/accountApi'

/** Longest message, the same as the server's. */
const MAX = 1000

/**
 * "Report a problem" (section 32, step 4): a few words about the app
 * itself — something broken, something confusing, an idea. Read by the
 * team in the admin panel. A report about a person is a different thing,
 * made from their profile or a conversation.
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
    <div className="ui-page">
      <PageHeader title={t('settings.report')} onBack={() => navigate(-1)} />
      <div className="ui-page-body ui-page-body-action">
        <div className="co-form">
          <label className="ui-field" htmlFor="report-text">
            <span className="ui-field-label">{t('report.label')}</span>
            <textarea
              id="report-text"
              className="ui-input ui-textarea"
              rows={6}
              maxLength={MAX}
              value={text}
              placeholder={t('report.placeholder')}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <span className="ui-field-help">{t('report.hint')}</span>
        </div>
      </div>
      <div className="ui-action-bar">
        <Button variant="primary" size="lg" block disabled={text.trim() === ''} loading={busy} onClick={() => void send()}>
          {t('report.send')}
        </Button>
      </div>
    </div>
  )
}
