import { useCallback, useEffect, useState } from 'react'
import { useGoBack } from '../lib/goBack'
import { useTranslation } from 'react-i18next'
import { useToast } from '../components/ui'
import { QuietConfirm, QuietError, QuietPage, QuietSection, QuietWaiting } from '../components/cosmos/Quiet'
import { QDevice, QTwoDevices } from '../components/cosmos/quietIcons'
import { formatApiError } from '../lib/api'
import { closeOtherSessions, closeSession, fetchSessions, type SignedInSession } from '../lib/sessionsApi'
import { timeAgo } from '../lib/timeAgo'

/**
 * "Settings → Signed-in devices" (TECHNICAL_REQUIREMENTS.md section 32).
 *
 * Every device signed in to this account: what it is, how it came in, when
 * it was last used — this one first and marked. Any other can be closed,
 * one at a time or all at once; a closed device is sent to the sign-in
 * page at once. It is the answer to "somebody else is in my account":
 * seeing a device you do not recognise and closing it.
 */
export default function Sessions() {
  const { t, i18n } = useTranslation()
  const back = useGoBack('/settings')
  const toast = useToast()
  const [rows, setRows] = useState<SignedInSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState<SignedInSession | 'others' | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetchSessions()
      .then((value) => {
        // Cleared on the answer, not before asking (a synchronous clear in the effect rendered twice).
        setError(null)
        setRows(value)
      })
      .catch((err) => setError(formatApiError(err)))
  }, [])
  useEffect(load, [load])

  async function confirm() {
    if (!closing) return
    setBusy(true)
    try {
      if (closing === 'others') await closeOtherSessions()
      else await closeSession(closing.id)
      toast.success(t('sessions.closed'))
      load()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
      setClosing(null)
    }
  }

  const others = (rows ?? []).filter((r) => !r.current)
  const door = (provider: string) => t(`sessions.via.${provider}`, { defaultValue: provider })

  const name = (row: SignedInSession) => (row.device === '?' ? t('sessions.unknownDevice') : row.device)

  return (
    <QuietPage title={t('sessions.title')} onBack={back}>
      {error ? (
        <QuietError text={error} onRetry={load} />
      ) : rows === null ? (
        <QuietWaiting />
      ) : (
        // Never empty: the device asking is always one of them.
        <>
          <p className="cos-q-lead">{t('sessions.hint')}</p>
          <QuietSection>
            <div className="cos-q-rows">
              {rows.map((row) => (
                <div key={row.id} className="cos-q-person">
                  {/* A device that came in through another phone shows two. */}
                  <span className="cos-q-ico">{row.provider === 'device' ? <QTwoDevices /> : <QDevice />}</span>
                  <span className="cos-q-txt">
                    <span className="cos-q-t">
                      {name(row)}
                      {row.current && <span className="cos-q-tag">{t('sessions.thisDevice')}</span>}
                    </span>
                    <span className="cos-q-h">
                      {t('sessions.line', { door: door(row.provider), when: row.current ? t('sessions.now') : timeAgo(row.last_used_at, i18n.language) })}
                    </span>
                  </span>
                  {!row.current && (
                    <button type="button" className="cos-q-quiet" onClick={() => setClosing(row)}>
                      {t('sessions.close')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </QuietSection>
          {/* The one dangerous act on the page, and the only red thing. */}
          {others.length > 1 && (
            <QuietSection>
              <button type="button" className="cos-q-text is-danger" onClick={() => setClosing('others')}>
                {t('sessions.closeOthers')}
              </button>
            </QuietSection>
          )}
        </>
      )}

      {closing && (
        <QuietConfirm
          title={closing === 'others' ? t('sessions.closeOthersTitle') : t('sessions.closeTitle', { device: name(closing) })}
          text={t('sessions.closeText')}
          confirmLabel={t('sessions.close')}
          busy={busy}
          onCancel={() => setClosing(null)}
          onConfirm={() => void confirm()}
        />
      )}
    </QuietPage>
  )
}
