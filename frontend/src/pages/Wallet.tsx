import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { apiFetch, formatApiError } from '../lib/api'
import type { Balance } from '../lib/types'

export default function WalletPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    apiFetch<Balance>('/wallet/balance')
      .then(setBalance)
      .catch((err) => setError(formatApiError(err)))
  }, [])

  useEffect(load, [load])

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

      <div className="hp-field">
        <button
          className="hp-btn hp-btn-gradient"
          style={{ width: 'calc(100% - 24px)', margin: '0 12px' }}
          onClick={() => navigate('/wallet/topup')}
        >
          {t('wallet.topUpButton')}
        </button>
      </div>
    </div>
  )
}
