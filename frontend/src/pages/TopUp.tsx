import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatApiError } from '../lib/api'
import { getPricingConfig } from '../lib/pricing'
import { createTopUpRequest, getTopUpCardInfo, listMyTopUpRequests } from '../lib/topupApi'
import { PageHeader, ErrorState, useToast } from '../components/ui'
import { TopUpDirect } from '../components/topup/TopUpDirect'
import type { TopUpCardInfo, TopUpRequest } from '../lib/types'

/**
 * Adding wallet balance: a card-to-card transfer with a receipt, which an
 * admin reviews before anything is credited.
 *
 * Telegram Stars and the third-party seller links used to sit here as two more
 * tabs. Both are gone — Stars because the money side of this app must not
 * depend on Telegram, and the outbound links because they sold the same thing
 * for more while never touching the wallet at all.
 */
export default function TopUp() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  // Arriving from the offer page's "insufficient balance" dialog carries
  // exactly how much is missing, so this screen opens with the amount
  // already filled in rather than making someone work it out again.
  const navState = location.state as { prefillStars?: number; from?: string } | null
  const prefillStars = navState?.prefillStars ?? null
  const from = navState?.from
  const back = from && /^\/offers\/\d+$/.test(from) ? from : '/wallet'

  const [rate, setRate] = useState<number | null>(null)
  const [cardInfo, setCardInfo] = useState<TopUpCardInfo | null>(null)
  const [history, setHistory] = useState<TopUpRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // --- card-to-card ---
  const [receipt, setReceipt] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [directAmount, setDirectAmount] = useState(prefillStars ? String(prefillStars) : '')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function load() {
    setError(null)
    getPricingConfig()
      .then((config) => setRate(config.drop_to_toman_rate))
      .catch((err) => setError(formatApiError(err)))
    getTopUpCardInfo()
      .then(setCardInfo)
      .catch((err) => setError(formatApiError(err)))
    loadHistory()
  }

  function loadHistory() {
    listMyTopUpRequests()
      .then(setHistory)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(load, [])

  useEffect(() => {
    // Object URLs are held by the browser until revoked; without this a
    // few receipt previews leak the images themselves.
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function pickReceipt(picked: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setReceipt(picked)
    setPreviewUrl(picked ? URL.createObjectURL(picked) : null)
  }

  async function submitReceipt() {
    const amount = Number(directAmount)
    if (!receipt || !amount) {
      setSubmitError(t('topup.starsAmountMustBePositive'))
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await createTopUpRequest(receipt, amount)
      toast.success(t('topup.submitSuccessBody'))
      pickReceipt(null)
      setDirectAmount('')
      loadHistory()
    } catch (err) {
      setSubmitError(formatApiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function copyCard() {
    if (!cardInfo?.card_number) return
    try {
      await navigator.clipboard.writeText(cardInfo.card_number)
      toast.success(t('topup.cardCopied'))
    } catch {
      // Clipboard access can be denied; copying is a convenience.
    }
  }

  return (
    <div className="ui-page">
      <PageHeader title={t('topup.pageTitle')} onBack={() => navigate(back)} />

      <div className="ui-page-body ui-page-body-action">
        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : (
          <TopUpDirect
            cardInfo={cardInfo}
            rate={rate}
            amount={directAmount}
            onAmountChange={setDirectAmount}
            receipt={receipt}
            previewUrl={previewUrl}
            onPickReceipt={pickReceipt}
            onCopyCard={copyCard}
            onSubmit={submitReceipt}
            submitting={submitting}
            submitError={submitError}
            history={history}
          />
        )}
      </div>
    </div>
  )
}
