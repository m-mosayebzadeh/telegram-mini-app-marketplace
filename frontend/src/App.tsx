import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from './lib/api'
import type { Balance, Me } from './lib/types'

/**
 * The first real screen of the app — deliberately minimal. Its only
 * job right now is to prove the whole chain actually works end to end:
 * Telegram launch -> initData -> backend auth -> real data back. Every
 * other screen (offers, requests, chat) gets built on top of this same
 * apiFetch() plumbing next.
 */
function App() {
  const { t, i18n } = useTranslation()
  const [me, setMe] = useState<Me | null>(null)
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        // Both calls need the caller to already be a known user — /me
        // is what creates the User row on first login (see
        // backend/app/main.py), so it must resolve before the wallet
        // call, not run in parallel with it.
        const meResult = await apiFetch<Me>('/me')
        setMe(meResult)
        const balanceResult = await apiFetch<Balance>('/wallet/balance')
        setBalance(balanceResult)
      } catch (err) {
        if (err instanceof ApiError) {
          setError(`${err.status}: ${JSON.stringify(err.body)}`)
        } else {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    }
    load()
  }, [])

  // A single toggle between the two supported languages — just enough
  // to prove the bilingual setup actually works end to end. A real
  // language picker (and the right-to-left layout work that goes with
  // it) is final-UI polish, not this stage (see
  // docs/TECHNICAL_REQUIREMENTS.md section 11).
  function toggleLanguage() {
    i18n.changeLanguage(i18n.language === 'fa' ? 'en' : 'fa')
  }

  if (error) {
    return <Placeholder header={t('common.error')}>{error}</Placeholder>
  }

  if (!me || !balance) {
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
      <Section header={t('wallet.title')}>
        <Cell subtitle={t('wallet.spendable')}>
          {t('wallet.spendableValue', {
            toman: balance.balance_toman.toLocaleString('en-US'),
            stars: balance.balance_stars_equivalent.toLocaleString('en-US'),
          })}
        </Cell>
        <Cell subtitle={t('wallet.pending')}>
          {t('wallet.pendingValue', { toman: balance.pending_toman.toLocaleString('en-US') })}
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

export default App
