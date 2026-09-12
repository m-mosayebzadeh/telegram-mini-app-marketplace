import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { getPlatformRates, updatePlatformRates } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import {
  PageHeader,
  Button,
  EmptyState,
  ErrorState,
  SkeletonRows,
  useToast,
} from '../components/ui'
import { IconShieldLock } from '../components/icons'
import { useMe } from '../lib/MeContext'

/** "مالی → کارمزدها" — edit the platform's Star-to-Toman rate and every
 * commission percentage (see backend/app/models/platform_rates.py).
 * Access (owner or "finance.rates") comes from the session-wide check
 * in MeContext, not a fetch of its own. */
export default function AdminRates() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!hasAccess) return
    setLoadError(null)
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
      .catch((err) => setLoadError(formatApiError(err)))
  }, [hasAccess])

  useEffect(load, [load])

  async function submit() {
    setBusy(true)
    try {
      await updatePlatformRates({
        star_to_toman_rate: Number(starRate),
        chat_commission_percent: Number(chatPercent),
        content_commission_percent: Number(contentPercent),
        minimum_withdrawal_toman: Number(minimum),
        withdrawal_commission_percent: Number(withdrawalPercent),
        complaint_commission_percent: Number(complaintPercent),
      })
      toast.success(t('admin.ratesSaved'))
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const percentInRange = (value: string) =>
    value !== '' && Number(value) >= 0 && Number(value) <= 100

  const valid =
    percentInRange(chatPercent) &&
    percentInRange(contentPercent) &&
    percentInRange(withdrawalPercent) &&
    percentInRange(complaintPercent) &&
    minimum !== '' &&
    Number(minimum) > 0 &&
    Number(starRate) > 0

  if (!adminAccess || (!loaded && hasAccess)) {
    return (
      <div className="ui-page">
        <PageHeader title={t('admin.ratesTitle')} onBack={() => navigate('/admin/finance')} />
        <div className="ui-page-body">
          {loadError ? <ErrorState text={loadError} onRetry={load} /> : <SkeletonRows count={4} />}
        </div>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="ui-page">
        <PageHeader title={t('admin.ratesTitle')} onBack={() => navigate('/admin')} />
        <div className="ui-page-body">
          <EmptyState
            icon={<IconShieldLock size={24} />}
            title={t('admin.noAccess')}
            text={t('admin.noAccessHint')}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="ui-page">
      <PageHeader title={t('admin.ratesTitle')} onBack={() => navigate('/admin/finance')} />

      <div className="ui-page-body ui-page-body-action">
        {/* These numbers decide what every person on the platform pays
            and earns. The warning is not decoration: there is no undo,
            and a wrong figure here is wrong for everyone at once. */}
        <p className="ba-warning">{t('admin.ratesWarning')}</p>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('admin.ratesGroupPricing')}</h2>
          <div className="co-form">
            <RateField
              id="rate-star"
              label={t('admin.ratesStarLabel')}
              unit={t('finance.tomanUnit')}
              value={starRate}
              onChange={setStarRate}
              hint={t('admin.ratesStarHint')}
            />
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('admin.ratesGroupCommission')}</h2>
          <div className="co-form">
            {/* A chat's cut is taken only when its transaction is
                released, after the session closed cleanly; content is
                delivered instantly, so its cut is taken at purchase. */}
            <RateField
              id="rate-chat"
              label={t('admin.ratesChatCommissionLabel')}
              unit="%"
              value={chatPercent}
              onChange={setChatPercent}
              hint={t('admin.ratesChatCommissionHint')}
              invalid={!percentInRange(chatPercent)}
            />
            <RateField
              id="rate-content"
              label={t('admin.ratesContentCommissionLabel')}
              unit="%"
              value={contentPercent}
              onChange={setContentPercent}
              hint={t('admin.ratesContentCommissionHint')}
              invalid={!percentInRange(contentPercent)}
            />
          </div>
        </section>

        <section className="ui-section">
          <h2 className="ui-section-title">{t('admin.ratesGroupWithdrawal')}</h2>
          <div className="co-form">
            {/* Deliberately 0: a provider is not charged for collecting
                money they already earned. The lever stays for later. */}
            <RateField
              id="rate-withdrawal"
              label={t('finance.withdrawalFee')}
              unit="%"
              value={withdrawalPercent}
              onChange={setWithdrawalPercent}
              hint={t('admin.ratesWithdrawalFeeHint')}
              invalid={!percentInRange(withdrawalPercent)}
            />
            <RateField
              id="rate-complaint"
              label={t('finance.complaintFee')}
              unit="%"
              value={complaintPercent}
              onChange={setComplaintPercent}
              invalid={!percentInRange(complaintPercent)}
            />
            <RateField
              id="rate-minimum"
              label={t('finance.minimumSetting')}
              unit={t('finance.tomanUnit')}
              value={minimum}
              onChange={setMinimum}
            />
          </div>
        </section>
      </div>

      <div className="ui-action-bar">
        <Button variant="primary" size="lg" block disabled={!valid} loading={busy} onClick={submit}>
          {t('admin.ratesSaveButton')}
        </Button>
      </div>
    </div>
  )
}

interface RateFieldProps {
  id: string
  label: string
  /** The unit, shown inside the field — "%" or "Toman". A number whose
   *  unit is only in the label is a number people get wrong. */
  unit: string
  value: string
  onChange: (digits: string) => void
  hint?: string
  invalid?: boolean
}

function RateField({ id, label, unit, value, onChange, hint, invalid }: RateFieldProps) {
  return (
    <label className={`ui-field${invalid ? ' ui-field-invalid' : ''}`} htmlFor={id}>
      <span className="ui-field-label">{label}</span>
      <div className="ui-input-group">
        <input
          id={id}
          className="ui-input ui-input-numeric"
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(event) =>
            onChange(event.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''))
          }
          placeholder="0"
          aria-invalid={invalid || undefined}
        />
        <span className="ui-input-group-addon">{unit}</span>
      </div>
      {hint && <span className="ui-field-help">{hint}</span>}
    </label>
  )
}
