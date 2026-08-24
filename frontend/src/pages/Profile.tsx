import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch } from '../lib/api'
import { useMe } from '../lib/MeContext'
import { clearDevUserChoice, isRealTelegramLaunch } from '../lib/session'
import type { PublicProfile } from '../lib/types'

export default function Profile() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { me, error } = useMe()
  // Follower/following counts aren't part of /me (that's just the raw
  // account record) -- they come from the same public-profile endpoint
  // anyone else's profile uses, just pointed at your own id.
  const [counts, setCounts] = useState<PublicProfile | null>(null)

  useEffect(() => {
    if (!me) return
    apiFetch<PublicProfile>(`/profiles/${me.id}`).then(setCounts)
  }, [me])

  // A single toggle between the two supported languages — just enough
  // to prove the bilingual setup works end to end. A real language
  // picker (and the right-to-left layout work that goes with it) is
  // final-UI polish, not this stage (see TECHNICAL_REQUIREMENTS.md
  // section 11).
  function toggleLanguage() {
    i18n.changeLanguage(i18n.language === 'fa' ? 'en' : 'fa')
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!me) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <List>
      <Section header={t('account.title')}>
        <Cell subtitle={t('account.displayName')}>{me.display_name}</Cell>
        <Cell subtitle={t('account.username')}>{me.username ?? '—'}</Cell>
        <Cell subtitle={t('account.status')}>
          {me.status === 'active' ? t('account.statusActive') : t('account.statusBlocked')}
        </Cell>
      </Section>
      <Section>
        {counts === null ? (
          <Cell>
            <Spinner size="s" />
          </Cell>
        ) : (
          <>
            <Cell onClick={() => navigate(`/profiles/${me.id}/followers`)}>
              {t('profilePage.followersCount', { count: counts.followers_count })}
            </Cell>
            <Cell onClick={() => navigate(`/profiles/${me.id}/following`)}>
              {t('profilePage.followingCount', { count: counts.following_count })}
            </Cell>
          </>
        )}
      </Section>
      <Section>
        {/* The badge is the only "notification" for a new follow
            request right now — checked on every /me call (see
            backend/app/main.py), since there's no push-notification
            system yet (TECHNICAL_REQUIREMENTS.md section 9). */}
        <Cell onClick={() => navigate('/follow-requests')}>
          {me.pending_follow_requests_count > 0
            ? t('followRequests.linkWithCount', { count: me.pending_follow_requests_count })
            : t('followRequests.link')}
        </Cell>
      </Section>
      <Section>
        <Cell subtitle={t('common.language')} onClick={toggleLanguage}>
          {i18n.language === 'fa' ? 'فارسی' : 'English'}
        </Cell>
      </Section>
      {/* Dev-only escape hatch back to the Login screen (see
          pages/Login.tsx) — meaningless inside real Telegram, where
          there's no "test user" to switch away from. */}
      {!isRealTelegramLaunch() && (
        <Section>
          <Cell
            onClick={() => {
              clearDevUserChoice()
              window.location.reload()
            }}
          >
            {t('login.switchUser')}
          </Cell>
        </Section>
      )}
    </List>
  )
}
