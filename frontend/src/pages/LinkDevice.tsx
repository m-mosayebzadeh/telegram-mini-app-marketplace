import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, ErrorState, PageHeader, SkeletonRows } from '../components/ui'
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

  return (
    <div className="ui-page">
      <PageHeader title={t('link.title')} onBack={() => navigate('/settings')} />
      <div className={`ui-page-body${request && !done ? ' ui-page-body-action' : ''}`}>
        {done ? (
          <section className="cos-link-done">
            <p className="cos-link-big">{done === 'approved' ? t('link.approved') : t('link.refused')}</p>
            <Button variant="secondary" size="lg" block onClick={() => navigate('/sky')}>
              {t('link.toWorld')}
            </Button>
          </section>
        ) : !code ? (
          // Reached from Settings: type the letters the other device shows.
          <form
            className="co-form"
            onSubmit={(e) => {
              e.preventDefault()
              const clean = cleanCode(typed)
              if (clean.length >= 6) setCode(clean)
            }}
          >
            <p className="cos-link-hint">{t('link.typeHint')}</p>
            <label className="ui-field" htmlFor="link-code">
              <span className="ui-field-label">{t('link.codeLabel')}</span>
              <input
                id="link-code"
                className="ui-input cos-link-input"
                dir="ltr"
                autoCapitalize="characters"
                autoComplete="off"
                value={typed}
                maxLength={10}
                placeholder="K7Q2 9MXA"
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
            <Button variant="primary" size="lg" block type="submit" disabled={cleanCode(typed).length < 6}>
              {t('link.find')}
            </Button>
          </form>
        ) : error ? (
          <ErrorState text={error} onRetry={() => { setCode(''); setRequest(null); setError('') }} />
        ) : !request ? (
          <SkeletonRows count={2} />
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
      </div>

      {request && !done && !error && (
        <div className="ui-action-bar cos-link-actions">
          <Button variant="primary" size="lg" block loading={busy} onClick={() => void answer(true)}>
            {t('link.yes')}
          </Button>
          <Button variant="ghost" size="lg" block disabled={busy} onClick={() => void answer(false)}>
            {t('link.no')}
          </Button>
        </div>
      )}
    </div>
  )
}
