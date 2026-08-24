import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Cell, Input, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, ApiError } from '../lib/api'
import type { Balance } from '../lib/types'

export default function WalletPage() {
  const { t } = useTranslation()
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [topUpAmount, setTopUpAmount] = useState('1000000')
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(() => {
    apiFetch<Balance>('/wallet/balance')
      .then(setBalance)
      .catch((err) => setError(err instanceof ApiError ? JSON.stringify(err.body) : String(err)))
  }, [])

  useEffect(load, [load])

  async function topUp() {
    setMessage(null)
    try {
      // Dev-only route (see backend/app/dev/router.py) — only reachable
      // when the backend runs with ENABLE_DEV_TOOLS=true, and only from
      // localhost. Real top-up rails (Stars, manual card transfer) are
      // phase 2 (TECHNICAL_REQUIREMENTS.md section 10) and don't exist
      // yet — this button is what stands in for them during development.
      await apiFetch('/dev/wallet-topup', {
        method: 'POST',
        body: JSON.stringify({ amount_toman: Number(topUpAmount) }),
      })
      setMessage(t('wallet.topUpSuccess'))
      load()
    } catch (err) {
      setMessage(err instanceof ApiError ? JSON.stringify(err.body) : String(err))
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!balance) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <List>
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
      <Section header={t('wallet.topUpButton')}>
        <Cell>
          <Input
            header={t('wallet.topUpAmountLabel')}
            type="number"
            value={topUpAmount}
            onChange={(e) => setTopUpAmount(e.target.value)}
          />
        </Cell>
        <Cell>
          <Button stretched onClick={topUp}>
            {t('wallet.topUpButton')}
          </Button>
        </Cell>
        {message && <Cell>{message}</Cell>}
      </Section>
    </List>
  )
}
