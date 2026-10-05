import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button, ConfirmDialog, ErrorState, PageHeader, SkeletonRows, useToast } from '../components/ui'
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
  const navigate = useNavigate()
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

  return (
    <div className="ui-page">
      <PageHeader title={t('sessions.title')} onBack={() => navigate('/settings')} />
      <div className={`ui-page-body${others.length > 1 ? ' ui-page-body-action' : ''}`}>
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : rows === null ? (
          <SkeletonRows count={3} />
        ) : (
          // Never empty: the device asking is always one of them.
          <section className="ui-section">
            <p className="cos-sessions-hint">{t('sessions.hint')}</p>
            <div className="ui-list">
              {rows.map((row) => (
                <div key={row.id} className="ui-row is-wrap">
                  <span className="ui-row-main">
                    <span className="ui-row-title">
                      {row.device === '?' ? t('sessions.unknownDevice') : row.device}
                      {row.current && <span className="cos-sessions-here">{t('sessions.thisDevice')}</span>}
                    </span>
                    <span className="ui-row-subtitle">
                      {t('sessions.line', { door: door(row.provider), when: row.current ? t('sessions.now') : timeAgo(row.last_used_at, i18n.language) })}
                    </span>
                  </span>
                  {!row.current && (
                    <span className="ui-row-trailing">
                      <Button variant="ghost" size="sm" onClick={() => setClosing(row)}>
                        {t('sessions.close')}
                      </Button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {others.length > 1 && (
        <div className="ui-action-bar">
          <Button variant="secondary" size="lg" block onClick={() => setClosing('others')}>
            {t('sessions.closeOthers')}
          </Button>
        </div>
      )}

      {closing && (
        <ConfirmDialog
          title={closing === 'others' ? t('sessions.closeOthersTitle') : t('sessions.closeTitle', { device: closing.device === '?' ? t('sessions.unknownDevice') : closing.device })}
          text={t('sessions.closeText')}
          confirmLabel={t('sessions.close')}
          loading={busy}
          onCancel={() => setClosing(null)}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  )
}
