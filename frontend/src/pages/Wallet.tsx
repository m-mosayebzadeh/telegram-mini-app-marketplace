import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { NumberField } from '../components/NumberField'
import { apiFetch, formatApiError } from '../lib/api'
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
      .catch((err) => setError(formatApiError(err)))
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
      setMessage(formatApiError(err))
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
    <div className="hp-page">
      <div className="hp-page-header">{t('wallet.title')}</div>

      <div className="hp-card">
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('wallet.spendable')}</span>
          <span className="hp-kv-value">
            {t('wallet.spendableValue', {
              toman: balance.balance_toman.toLocaleString('en-US'),
              stars: balance.balance_stars_equivalent.toLocaleString('en-US'),
            })}
          </span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('wallet.pending')}</span>
          <span className="hp-kv-value">
            {t('wallet.pendingValue', { toman: balance.pending_toman.toLocaleString('en-US') })}
          </span>
        </div>
      </div>

      <div className="hp-card">
        <h2 className="hp-card-title">{t('wallet.topUpButton')}</h2>
        <div className="hp-field">
          <NumberField header={t('wallet.topUpAmountLabel')} value={topUpAmount} onChange={setTopUpAmount} />
        </div>
        <div className="hp-field">
          <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} onClick={topUp}>
            {t('wallet.topUpButton')}
          </button>
        </div>
        {message && <p className="hp-hint">{message}</p>}
      </div>
    </div>
  )
}
