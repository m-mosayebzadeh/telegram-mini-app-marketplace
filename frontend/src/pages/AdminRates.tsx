import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { getPlatformRates, updatePlatformRates } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { NumberField } from '../components/NumberField'
import { useMe } from '../lib/MeContext'

/** "مالی → کارمزدها" — edit the platform's Star-to-Toman rate and every
 * commission percentage (see backend/app/models/platform_rates.py).
 * Access (owner or "finance.rates") comes from the session-wide check
 * in MeContext, not a fetch of its own. */
export default function AdminRates() {
  const { t } = useTranslation()
  const { adminAccess } = useMe()
  const hasAccess =
    !!adminAccess &&
    (adminAccess.is_owner || adminAccess.scopes.includes('finance.rates'))

  const [starRate, setStarRate] = useState('')
  const [chatPercent, setChatPercent] = useState('')
  const [contentPercent, setContentPercent] = useState('')
  const [withdrawalPercent, setWithdrawalPercent] = useState('')
  const [complaintPercent, setComplaintPercent] = useState('')
  const [minimum, setMinimum] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!hasAccess) return
    getPlatformRates()
      .then((r) => {
        setStarRate(String(r.star_to_toman_rate))
        setChatPercent(String(r.chat_commission_percent))
        setContentPercent(String(r.content_commission_percent))
        setWithdrawalPercent(String(r.withdrawal_commission_percent))
        setComplaintPercent(String(r.complaint_commission_percent))
        setMinimum(String(r.minimum_withdrawal_toman))
        setLoaded(true)
      })
      .catch((err) => setError(formatApiError(err)))
  }, [hasAccess])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await updatePlatformRates({
        star_to_toman_rate: Number(starRate),
        chat_commission_percent: Number(chatPercent),
        content_commission_percent: Number(contentPercent),
        minimum_withdrawal_toman: Number(minimum),
        withdrawal_commission_percent: Number(withdrawalPercent),
        complaint_commission_percent: Number(complaintPercent),
      })
      setToast(t('admin.ratesSaved'))
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!adminAccess) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }
  if (!hasAccess) return <Placeholder header={t('admin.noAccess')} />

  const percentInRange = (value: string) =>
    value !== '' && Number(value) >= 0 && Number(value) <= 100

  const valid =
    percentInRange(chatPercent) &&
    percentInRange(contentPercent) &&
    minimum !== '' &&
    Number(minimum) > 0 &&
    withdrawalPercent !== '' &&
    complaintPercent !== '' &&
    Number(starRate) > 0 &&
    Number(withdrawalPercent) >= 0 &&
    Number(withdrawalPercent) <= 100 &&
    Number(complaintPercent) >= 0 &&
    Number(complaintPercent) <= 100

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('admin.ratesTitle')}</div>

      {error && !loaded && <p className="hp-error">{error}</p>}
      {!loaded ? (
        <Placeholder>
          <Spinner size="m" />
        </Placeholder>
      ) : (
        <>
          <div className="hp-field">
            <NumberField
              header={t('admin.ratesStarLabel')}
              value={starRate}
              onChange={setStarRate}
            />
          </div>
          {/* Commission on a purchase — the platform's actual revenue. A chat's
              cut is taken only when its transaction is released, after the
              session closed cleanly; content is delivered instantly, so its cut
              is taken at purchase time. */}
          <div className="hp-field">
            <NumberField
              header={t('admin.ratesChatCommissionLabel')}
              value={chatPercent}
              onChange={setChatPercent}
            />
          </div>
          <div className="hp-field">
            <NumberField
              header={t('admin.ratesContentCommissionLabel')}
              value={contentPercent}
              onChange={setContentPercent}
            />
          </div>
          {/* Kept at 0 deliberately: a provider is not charged for collecting
              money they already earned. The lever stays here for later. */}
          <div className="hp-field">
            <NumberField
              header={t('finance.withdrawalFee')}
              value={withdrawalPercent}
              onChange={setWithdrawalPercent}
            />
          </div>
          <div className="hp-field">
            <NumberField
              header={t('finance.complaintFee')}
              value={complaintPercent}
              onChange={setComplaintPercent}
            />
          </div>
          <div className="hp-field">
            <NumberField
              header={t('finance.minimumSetting')}
              value={minimum}
              onChange={setMinimum}
            />
          </div>
          {error && (
            <p className="hp-error" style={{ margin: '0 12px' }}>
              {error}
            </p>
          )}
          <div className="hp-field">
            <button
              className="hp-btn hp-btn-gradient"
              style={{ width: 'calc(100% - 24px)', margin: '0 12px' }}
              disabled={!valid || busy}
              onClick={submit}
            >
              {busy ? t('common.loading') : t('admin.ratesSaveButton')}
            </button>
          </div>
        </>
      )}

      {toast && <div className="hp-toast">{toast}</div>}
    </div>
  )
}
