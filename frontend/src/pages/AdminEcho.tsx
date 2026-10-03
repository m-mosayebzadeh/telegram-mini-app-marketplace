import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { getEchoSchedule, updateEchoSchedule, type EchoSchedule } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { Button, EmptyState, ErrorState, PageHeader, SkeletonRows, useToast } from '../components/ui'
import { IconShieldLock } from '../components/icons'
import { useMe } from '../lib/MeContext'
import { refreshEcho } from '../lib/echoStore'
import { toClock, fromClock } from '../lib/clock'

/**
 * "مدیریت → Echo": whether Echo is on, and when it is open
 * (TECHNICAL_REQUIREMENTS.md section 32, step 3).
 *
 * Echo is either off or on. On, it has hours — on each person's own
 * clock — or is open all day, which keeps the hours without using them.
 * The hours are shown only while Echo is on (the owner's report: "always
 * open" greyed out under a switched-off Echo read as a broken switch). The server had all three; nothing in the panel could
 * set them until now.
 */

const DEFAULT_OPENS = 22 * 60
const DEFAULT_CLOSES = 23 * 60

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
    getEchoSchedule()
      .then((s) => {
        // Cleared on the answer, not before asking (a synchronous clear in the effect rendered twice).
        setLoadError(null)
        setSchedule(s)
        // Never set (the whole day, 00:00 to 00:00, which the server would
        // read as never open): start from the hours section 32 talks about,
        // ten to eleven at night, instead of an empty field.
        const unset = s.opens_at_minute === 0 && s.closes_at_minute === 1440
        setOpens(toClock(unset ? DEFAULT_OPENS : s.opens_at_minute))
        setCloses(toClock(unset ? DEFAULT_CLOSES : s.closes_at_minute))
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
  // Off, the hours do not matter and are not shown, so they cannot block
  // saving.
  const hoursValid = !schedule.enabled || schedule.always_open || (opensAt !== null && closesAt !== null && opensAt !== closesAt)
  // The server takes 5 to 120 seconds; anything else would only come back
  // as an error after pressing save.
  const holdValid = Number.isInteger(schedule.proposal_seconds) && schedule.proposal_seconds >= 5 && schedule.proposal_seconds <= 120
  const valid = hoursValid && holdValid

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
      // Your own bar changes at once; everybody else's hears it live.
      void refreshEcho()
      toast.success(t('adminEcho.saved'))
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (key: 'enabled' | 'always_open' | 'show_counts' | 'ask_adult') => setSchedule({ ...schedule, [key]: !schedule[key] })

  return (
    <div className="ui-page">
      <PageHeader title={t('adminEcho.title')} onBack={() => navigate('/admin')} />
      <div className="ui-page-body ui-page-body-action">
        <section className="ui-section">
          <div className="ui-list">
            <button type="button" className="ui-row is-wrap" role="switch" aria-checked={schedule.enabled} onClick={() => toggle('enabled')}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t('adminEcho.enabled')}</span>
                <span className="ui-row-subtitle">{t('adminEcho.enabledHint')}</span>
              </span>
              <span className="ui-row-trailing"><span className="ui-switch" aria-hidden="true" aria-checked={schedule.enabled} /></span>
            </button>
          </div>
        </section>

        {/* Echo is either off or on (the owner's words); the hours belong to
            "on", so they are shown only then. Off, they are kept as they
            were, for when it is switched back on. */}
        {schedule.enabled && (
          <section className="ui-section">
            <h2 className="ui-section-title">{t('adminEcho.hours')}</h2>
            <div className="ui-list">
              <button
                type="button"
                className="ui-row is-wrap"
                role="switch"
                aria-checked={schedule.always_open}
                onClick={() => toggle('always_open')}
              >
                <span className="ui-row-main">
                  <span className="ui-row-title">{t('adminEcho.alwaysOpen')}</span>
                  <span className="ui-row-subtitle">{t('adminEcho.alwaysOpenHint')}</span>
                </span>
                <span className="ui-row-trailing"><span className="ui-switch" aria-hidden="true" aria-checked={schedule.always_open} /></span>
              </button>
            </div>
            {!schedule.always_open && (
              <div className="co-form ui-echo-hours">
                <label className="ui-field" htmlFor="echo-opens">
                  <span className="ui-field-label">{t('adminEcho.from')}</span>
                  <input id="echo-opens" className="ui-input" type="time" value={opens} onChange={(e) => setOpens(e.target.value)} />
                </label>
                <label className="ui-field" htmlFor="echo-closes">
                  <span className="ui-field-label">{t('adminEcho.to')}</span>
                  <input id="echo-closes" className="ui-input" type="time" value={closes} onChange={(e) => setCloses(e.target.value)} />
                </label>
                <span className="ui-field-help">{t('adminEcho.hoursHint')}</span>
              </div>
            )}
          </section>
        )}

        <section className="ui-section">
          <h2 className="ui-section-title">{t('adminEcho.holdTitle')}</h2>
          <div className="co-form">
            <label className="ui-field" htmlFor="echo-hold">
              <span className="ui-field-label">{t('adminEcho.holdLabel')}</span>
              <input
                id="echo-hold"
                className="ui-input"
                type="number"
                inputMode="numeric"
                min={5}
                max={120}
                value={schedule.proposal_seconds}
                onChange={(e) => setSchedule({ ...schedule, proposal_seconds: Number(e.target.value) })}
              />
            </label>
            <span className="ui-field-help">{t('adminEcho.holdHint')}</span>
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('adminEcho.adultTitle')}</h2>
          <div className="ui-list">
            <button
              type="button"
              className="ui-row is-wrap"
              role="switch"
              aria-checked={schedule.ask_adult}
              onClick={() => toggle('ask_adult')}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">{t('adminEcho.adultLabel')}</span>
                <span className="ui-row-subtitle">{t('adminEcho.adultHint')}</span>
              </span>
              <span className="ui-row-trailing"><span className="ui-switch" aria-hidden="true" aria-checked={schedule.ask_adult} /></span>
            </button>
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('adminEcho.countsTitle')}</h2>
          <div className="ui-list">
            <button
              type="button"
              className="ui-row is-wrap"
              role="switch"
              aria-checked={schedule.show_counts}
              onClick={() => toggle('show_counts')}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">{t('adminEcho.countsLabel')}</span>
                <span className="ui-row-subtitle">{t('adminEcho.countsHint')}</span>
              </span>
              <span className="ui-row-trailing"><span className="ui-switch" aria-hidden="true" aria-checked={schedule.show_counts} /></span>
            </button>
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
