import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { confirmAdult, startOver } from '../../lib/accountApi'
import { formatApiError } from '../../lib/api'

/**
 * Two screens that stand in front of the whole app (section 32, step 4).
 *
 * AdultGate: "eighteen or over", the first time Echo opens — Echo is where
 * strangers meet, and the rest of the app does not need it (the owner's
 * decision). Yes, and it is never asked again; no, and you are back in the
 * world, asked again the next time you open Echo.
 *
 * AccountGone: after the account was deleted. The app asks the server
 * nothing else from here (each background question would otherwise make a
 * new empty account that shows up in the world); "start again" is the one
 * way on, and it is a deliberate step.
 */

export function AdultGate({ onDone, onNo }: { onDone: () => void; onNo: () => void }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function yes() {
    setBusy(true)
    setError('')
    try {
      await confirmAdult()
      onDone()
    } catch (err) {
      setError(formatApiError(err))
      setBusy(false)
    }
  }

  return (
    <div className="cos-door-screen" role="dialog" aria-modal="true" aria-labelledby="adult-title">
      <div className="cos-door-lights" aria-hidden="true">
        <i />
        <i />
      </div>
      <h1 id="adult-title" className="cos-door-title">{t('adult.title')}</h1>
      <p className="cos-door-text">{t('adult.text')}</p>
      {error !== '' && <p className="cos-echo-error">{error}</p>}
      <button type="button" className="cos-seek-go" disabled={busy} onClick={() => void yes()}>
        {t('adult.yes')}
      </button>
      <button type="button" className="cos-seek-again" onClick={onNo}>
        {t('adult.no')}
      </button>
    </div>
  )
}

export function AccountGone() {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function again() {
    setBusy(true)
    setError('')
    try {
      await startOver()
      window.location.assign('/')
    } catch (err) {
      setError(formatApiError(err))
      setBusy(false)
    }
  }

  return (
    <div className="cos-door-screen" role="dialog" aria-modal="true" aria-labelledby="gone-title">
      <h1 id="gone-title" className="cos-door-title">{t('gone.title')}</h1>
      <p className="cos-door-text">{t('gone.text')}</p>
      {error !== '' && <p className="cos-echo-error">{error}</p>}
      <button type="button" className="cos-seek-go" disabled={busy} onClick={() => void again()}>
        {t('gone.again')}
      </button>
    </div>
  )
}
