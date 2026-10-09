import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from '../components/ui'
import { IconShieldLock } from '../components/icons'
import { apiFetch, formatApiError } from '../lib/api'
import { useMe } from '../lib/MeContext'

/**
 * "Management → analytics" (TECHNICAL_REQUIREMENTS.md section 43): the
 * list the owner approved, every part of it, over the last 7 or 30 days.
 *
 * A list of labelled numbers rather than charts: these are read, a few at
 * a time, by somebody deciding what to work on next. The one number comes
 * first, with the same days before it beside it; everything else follows
 * in the order a person meets the app — coming in, the first day, coming
 * back, friendship, Echo, safety, notifications, the app itself.
 *
 * Counts only (backend/app/analytics/metrics.py): nothing here comes from
 * what anybody wrote.
 */

export interface Analytics {
  days: number
  answered: { now: number; before: number }
  joining: { people: number; ways: Record<string, number>; steps: Record<string, number> }
  first_day: { people: number; profile: number | null; approached: number | null; wrote: number | null; answered: number | null }
  coming_back: { today: number; week: number; month: number; day1: number | null; day7: number | null; day30: number | null }
  friendship: { asked: number; accepted: number; talked_after: number | null }
  echo: { proposals: number; outcomes: Record<string, number>; met: number; ended_early: number | null; kept: number | null }
  safety: {
    conversations: number
    reports: number
    blocks: number
    reports_per_1000: number | null
    blocks_per_1000: number | null
    team_answer_minutes: number | null
  }
  notifications: { people_with: number; share_of_month: number | null; sent: number; opened: number; opened_share: number | null }
  app: {
    load_ms_median: number | null
    load_ms_slow: number | null
    errors: Record<string, number>
    fps_normal: number | null
    fps_light: number | null
    fps_slow_phones: number | null
  }
}

export const fetchAnalytics = (days: number) => apiFetch<Analytics>(`/admin/analytics?days=${days}`)

export default function AdminAnalytics() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { adminAccess } = useMe()
  const hasAccess = !!adminAccess && (adminAccess.is_owner || adminAccess.scopes.includes('analytics.view'))
  const [days, setDays] = useState(7)
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    if (!hasAccess) return
    fetchAnalytics(days)
      .then((value) => {
        setError(null)
        setData(value)
      })
      .catch((err) => setError(formatApiError(err)))
  }, [hasAccess, days])
  useEffect(() => load(), [load])

  const n = (value: number | null | undefined) => (value == null ? '—' : value.toLocaleString(i18n.language))
  const pct = (value: number | null | undefined) =>
    value == null ? '—' : value.toLocaleString(i18n.language, { style: 'percent', maximumFractionDigits: 0 })
  const ms = (value: number | null | undefined) =>
    value == null ? '—' : t('analytics.seconds', { n: (value / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 1 }) })
  const sum = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0)

  return (
    <div className="ui-page">
      <PageHeader title={t('analytics.title')} onBack={() => navigate('/admin')} />
      <div className="ui-page-body">
        {!hasAccess ? (
          adminAccess ? (
            <EmptyState icon={<IconShieldLock size={24} />} title={t('admin.noAccess')} text={t('admin.noAccessHint')} />
          ) : (
            <SkeletonRows count={3} />
          )
        ) : (
          <>
            <div className="ui-segments" role="tablist">
              {[7, 30].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={days === value}
                  className={`ui-segment${days === value ? ' ui-segment-active' : ''}`}
                  onClick={() => {
                    setData(null)
                    setDays(value)
                  }}
                >
                  {t('analytics.lastDays', { n: value.toLocaleString(i18n.language) })}
                </button>
              ))}
            </div>

            {error ? (
              <ErrorState text={error} onRetry={load} />
            ) : data === null ? (
              <SkeletonRows count={6} />
            ) : (
              <>
                <Section title={t('analytics.oneNumber')}>
                  <Row
                    title={t('analytics.answered')}
                    hint={t('analytics.answeredHint', { before: n(data.answered.before) })}
                    value={n(data.answered.now)}
                    strong
                  />
                </Section>

                <Section title={t('analytics.joining')}>
                  <Row title={t('analytics.newPeople')} value={n(data.joining.people)} />
                  {Object.entries(data.joining.ways).map(([way, count]) => (
                    <Row key={way} title={t(`analytics.way.${way}`, { defaultValue: way })} value={n(count)} sub />
                  ))}
                  <Row title={t('analytics.sawSignIn')} hint={t('analytics.sawSignInHint')} value={n(data.joining.steps.ways ?? 0)} />
                  {['google', 'telegram', 'device'].map((way) => (
                    <Row key={way} title={t('analytics.chose', { way: t(`analytics.way.${way}`) })} value={n(data.joining.steps[way] ?? 0)} sub />
                  ))}
                </Section>

                <Section title={t('analytics.firstDay')}>
                  <Row title={t('analytics.firstDayPeople')} value={n(data.first_day.people)} />
                  <Row title={t('analytics.completedProfile')} value={pct(data.first_day.profile)} sub />
                  <Row title={t('analytics.approached')} value={pct(data.first_day.approached)} sub />
                  <Row title={t('analytics.wrote')} value={pct(data.first_day.wrote)} sub />
                  <Row title={t('analytics.gotAnswer')} value={pct(data.first_day.answered)} sub />
                </Section>

                <Section title={t('analytics.comingBack')}>
                  <Row title={t('analytics.today')} value={n(data.coming_back.today)} />
                  <Row title={t('analytics.week')} value={n(data.coming_back.week)} />
                  <Row title={t('analytics.month')} value={n(data.coming_back.month)} />
                  <Row title={t('analytics.backDay1')} value={pct(data.coming_back.day1)} />
                  <Row title={t('analytics.backDay7')} value={pct(data.coming_back.day7)} />
                  <Row title={t('analytics.backDay30')} value={pct(data.coming_back.day30)} />
                </Section>

                <Section title={t('analytics.friendship')}>
                  <Row title={t('analytics.friendAsked')} value={n(data.friendship.asked)} />
                  <Row title={t('analytics.friendAccepted')} value={n(data.friendship.accepted)} />
                  <Row title={t('analytics.talkedAfter')} value={pct(data.friendship.talked_after)} />
                </Section>

                <Section title={t('analytics.echo')}>
                  <Row title={t('analytics.echoProposals')} value={n(data.echo.proposals)} />
                  <Row title={t('analytics.echoMet')} value={n(data.echo.met)} />
                  <Row title={t('analytics.echoEarly')} value={pct(data.echo.ended_early)} />
                  <Row title={t('analytics.echoKept')} value={pct(data.echo.kept)} />
                </Section>

                <Section title={t('analytics.safety')}>
                  <Row title={t('analytics.reports')} hint={t('analytics.per1000', { n: n(data.safety.reports_per_1000) })} value={n(data.safety.reports)} />
                  <Row title={t('analytics.blocks')} hint={t('analytics.per1000', { n: n(data.safety.blocks_per_1000) })} value={n(data.safety.blocks)} />
                  <Row
                    title={t('analytics.teamAnswer')}
                    value={data.safety.team_answer_minutes == null ? '—' : t('analytics.minutes', { n: n(data.safety.team_answer_minutes) })}
                  />
                </Section>

                <Section title={t('analytics.notifications')}>
                  <Row title={t('analytics.pushPeople')} hint={t('analytics.pushShare', { share: pct(data.notifications.share_of_month) })} value={n(data.notifications.people_with)} />
                  <Row title={t('analytics.pushSent')} value={n(data.notifications.sent)} />
                  <Row title={t('analytics.pushOpened')} hint={pct(data.notifications.opened_share)} value={n(data.notifications.opened)} />
                </Section>

                <Section title={t('analytics.app')}>
                  <Row title={t('analytics.load')} hint={t('analytics.loadSlow', { time: ms(data.app.load_ms_slow) })} value={ms(data.app.load_ms_median)} />
                  <Row title={t('analytics.errors')} value={n(sum(data.app.errors))} />
                  <Row title={t('analytics.fps')} value={n(data.app.fps_normal)} />
                  <Row title={t('analytics.fpsLight')} value={n(data.app.fps_light)} sub />
                  <Row title={t('analytics.fpsSlow')} hint={t('analytics.fpsSlowHint')} value={n(data.app.fps_slow_phones)} sub />
                </Section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ui-section">
      <h2 className="ui-section-title">{title}</h2>
      <div className="ui-list">{children}</div>
    </section>
  )
}

/** One labelled number. `sub` sits under the row before it (a part of it). */
function Row({ title, hint, value, strong, sub }: { title: string; hint?: string; value: string; strong?: boolean; sub?: boolean }) {
  return (
    <div className={`ui-row${sub ? ' an-sub' : ''}`}>
      <span className="ui-row-main">
        <span className="ui-row-title">{title}</span>
        {hint && <span className="ui-row-subtitle">{hint}</span>}
      </span>
      <span className={`ui-row-trailing an-value${strong ? ' is-strong' : ''}`}>{value}</span>
    </div>
  )
}
