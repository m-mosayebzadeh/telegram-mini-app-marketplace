import { useTranslation } from 'react-i18next'
import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { useMe } from '../lib/MeContext'

export default function Profile() {
  const { t, i18n } = useTranslation()
  const { me, error } = useMe()

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
        <Cell subtitle={t('common.language')} onClick={toggleLanguage}>
          {i18n.language === 'fa' ? 'فارسی' : 'English'}
        </Cell>
      </Section>
    </List>
  )
}
