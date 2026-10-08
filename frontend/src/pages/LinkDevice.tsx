import { useCallback, useEffect, useState } from 'react'
import { useGoBack } from '../lib/goBack'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { QuietError, QuietPage, QuietSection, QuietWaiting } from '../components/cosmos/Quiet'
import { apiReason, formatApiError } from '../lib/api'
import {
  approveDeviceRequest,
  cleanCode,
  refuseDeviceRequest,
  seeDeviceRequest,
  spacedCode,
  type DeviceRequestSeen,
} from '../lib/signInApi'
import { timeAgo } from '../lib/timeAgo'

/**
 * "Sign in another device" (TECHNICAL_REQUIREMENTS.md section 32), on the
 * phone that is already signed in.
 *
 * Reached by scanning the code on the other device with the phone's camera
 * (the code is an address to here, carrying the request), or from Settings
 * by typing the letters it shows. Before anything happens it says which
 * device is asking and when, and asks whether it is yours: a code somebody
 * else put in front of you would otherwise sign THEM in to your account.
 */
export default function LinkDevice() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const back = useGoBack('/settings')
  const [params] = useSearchParams()
  const [code, setCode] = useState(() => cleanCode(params.get('c') ?? ''))
  const [typed, setTyped] = useState('')
  const [request, setRequest] = useState<DeviceRequestSeen | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'approved' | 'refused' | null>(null)

  const look = useCallback((asked: string) => {
    seeDeviceRequest(asked)
      .then((seen) => {
        // Cleared on the answer, not before asking (a synchronous clear in the effect rendered twice).
        setError('')
        setRequest(seen)
      })
      .catch((err) => setError(apiReason(err) === 'expired' ? t('link.expired') : formatApiError(err)))
  }, [t])

  useEffect(() => {
    if (code) look(code)
  }, [code, look])

  async function answer(yes: boolean) {
    if (!request) return
    setBusy(true)
    try {
      if (yes) await approveDeviceRequest(request.code)
      else await refuseDeviceRequest(request.code)
      setDone(yes ? 'approved' : 'refused')
    } catch (err) {
      setError(apiReason(err) === 'expired' ? t('link.expired') : formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const asking = request && !done && !error
  return (
    <QuietPage
      title={t('link.title')}
      onBack={back}
      foot={
        asking && (
          <div className="cos-link-actions">
            <button type="button" className="cos-q-primary" disabled={busy} onClick={() => void answer(true)}>
              {t('link.yes')}
            </button>
            <button type="button" className="cos-q-text" disabled={busy} onClick={() => void answer(false)}>
              {t('link.no')}
            </button>
          </div>
        )
      }
    >
      <QuietSection className="is-tight">
        {done ? (
          <section className="cos-link-done">
            <p className="cos-link-big">{done === 'approved' ? t('link.approved') : t('link.refused')}</p>
            <button type="button" className="cos-q-primary" onClick={() => navigate('/sky')}>
              {t('link.toWorld')}
            </button>
          </section>
        ) : !code ? (
          // Reached from Settings: type the letters the other device shows.
          <form
            className="cos-link-done"
            onSubmit={(e) => {
              e.preventDefault()
              const clean = cleanCode(typed)
              if (clean.length >= 6) setCode(clean)
            }}
          >
            <p className="cos-link-hint">{t('link.typeHint')}</p>
            <div className="cos-q-field">
              <label htmlFor="link-code">{t('link.codeLabel')}</label>
              <input
                id="link-code"
                className="cos-q-input cos-link-input"
                dir="ltr"
                autoCapitalize="characters"
                autoComplete="off"
                value={typed}
                maxLength={10}
                placeholder="K7Q2 9MXA"
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>
            <button type="submit" className="cos-q-primary" disabled={cleanCode(typed).length < 6}>
              {t('link.find')}
            </button>
          </form>
        ) : error ? (
          <QuietError text={error} onRetry={() => { setCode(''); setRequest(null); setError('') }} />
        ) : !request ? (
          <QuietWaiting rows={2} />
        ) : (
          <section className="cos-link-ask">
            <p className="cos-link-big">{t('link.question')}</p>
            <div className="cos-link-device">
              <b>{request.device === '?' ? t('sessions.unknownDevice') : request.device}</b>
              <span>{t('link.asked', { when: timeAgo(request.created_at, i18n.language) })}</span>
              <span dir="ltr">{spacedCode(request.code)}</span>
            </div>
            <p className="cos-link-hint">{t('link.warning')}</p>
          </section>
        )}
      </QuietSection>
    </QuietPage>
  )
}
