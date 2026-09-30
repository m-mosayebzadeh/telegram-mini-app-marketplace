import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { getEchoSchedule, updateEchoSchedule, type EchoSchedule } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { Button, EmptyState, ErrorState, PageHeader, SkeletonRows, useToast } from '../components/ui'
import { IconShieldLock } from '../components/icons'
import { useMe } from '../lib/MeContext'

/**
 * "مدیریت → Echo": whether Echo is on, and when it is open
 * (TECHNICAL_REQUIREMENTS.md section 32, step 3).
 *
 * Three decisions, in the order they apply: the master switch (Echo held
 * shut until the community is big enough); "always open", which ignores
 * the hours without losing them; and the nightly hours themselves, on each
 * person's own clock. The server had all three; nothing in the panel could
 * set them until now.
 */

/** "22:30" ⇄ minutes past midnight. 1440 is written "24:00". */
export function toClock(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
export function fromClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= 0 && minutes <= 1440 ? minutes : null
}

export default function AdminEcho() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const { adminAccess } = useMe()
  const hasAccess = !!adminAccess && (adminAccess.is_owner || adminAccess.scopes.includes('moderation.random_chat'))

  const [schedule, setSchedule] = useState<EchoSchedule | null>(null)
  const [opens, setOpens] = useState('')
  const [closes, setCloses] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!hasAccess) return
    setLoadError(null)
    getEchoSchedule()
      .then((s) => {
        setSchedule(s)
        setOpens(toClock(s.opens_at_minute))
        setCloses(toClock(s.closes_at_minute))
      })
      .catch((err) => setLoadError(formatApiError(err)))
  }, [hasAccess])
  useEffect(load, [load])

  if (!hasAccess) {
    return (
      <div className="ui-page">
        <PageHeader title={t('adminEcho.title')} onBack={() => navigate('/admin')} />
        <div className="ui-page-body">
          {adminAccess ? (
            <EmptyState icon={<IconShieldLock size={24} />} title={t('admin.noAccess')} text={t('admin.noAccessHint')} />
          ) : (
            <SkeletonRows count={3} />
          )}
        </div>
      </div>
    )
  }

  if (!schedule) {
    return (
      <div className="ui-page">
        <PageHeader title={t('adminEcho.title')} onBack={() => navigate('/admin')} />
        <div className="ui-page-body">{loadError ? <ErrorState text={loadError} onRetry={load} /> : <SkeletonRows count={3} />}</div>
      </div>
    )
  }

  const opensAt = fromClock(opens)
  const closesAt = fromClock(closes)
  const valid = schedule.always_open || (opensAt !== null && closesAt !== null && opensAt !== closesAt)

  async function save() {
    if (!schedule) return
    setBusy(true)
    try {
      const saved = await updateEchoSchedule({
        ...schedule,
        opens_at_minute: opensAt ?? schedule.opens_at_minute,
        closes_at_minute: closesAt ?? schedule.closes_at_minute,
      })
      setSchedule(saved)
      toast.success(t('adminEcho.saved'))
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (key: 'enabled' | 'always_open') => setSchedule({ ...schedule, [key]: !schedule[key] })

  return (
    <div className="ui-page">
      <PageHeader title={t('adminEcho.title')} onBack={() => navigate('/admin')} />
      <div className="ui-page-body ui-page-body-action">
        <section className="ui-section">
          <div className="ui-list">
            <button type="button" className="ui-row" role="switch" aria-checked={schedule.enabled} onClick={() => toggle('enabled')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('adminEcho.enabled')}</span>
                <span className="ui-row-subtitle">{t('adminEcho.enabledHint')}</span>
              </span>
              <span className="ui-row-trailing"><span className="ui-switch" aria-hidden="true" aria-checked={schedule.enabled} /></span>
            </button>
            <button
              type="button"
              className="ui-row"
              role="switch"
              aria-checked={schedule.always_open}
              disabled={!schedule.enabled}
              onClick={() => toggle('always_open')}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">{t('adminEcho.alwaysOpen')}</span>
                <span className="ui-row-subtitle">{t('adminEcho.alwaysOpenHint')}</span>
              </span>
              <span className="ui-row-trailing"><span className="ui-switch" aria-hidden="true" aria-checked={schedule.always_open} /></span>
            </button>
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('adminEcho.hours')}</h2>
          {/* Greyed rather than hidden while "always open" is on: the hours
              are still there, and come back when it is switched off. */}
          <div className="co-form">
            <label className="ui-field" htmlFor="echo-opens">
              <span className="ui-field-label">{t('adminEcho.from')}</span>
              <input id="echo-opens" className="ui-input" type="time" value={opens} disabled={schedule.always_open || !schedule.enabled} onChange={(e) => setOpens(e.target.value)} />
            </label>
            <label className="ui-field" htmlFor="echo-closes">
              <span className="ui-field-label">{t('adminEcho.to')}</span>
              <input id="echo-closes" className="ui-input" type="time" value={closes} disabled={schedule.always_open || !schedule.enabled} onChange={(e) => setCloses(e.target.value)} />
            </label>
            <span className="ui-field-help">{t('adminEcho.hoursHint')}</span>
          </div>
        </section>
      </div>

      <div className="ui-action-bar">
        <Button variant="primary" size="lg" block disabled={!valid} loading={busy} onClick={() => void save()}>
          {t('adminEcho.save')}
        </Button>
      </div>
    </div>
  )
}
