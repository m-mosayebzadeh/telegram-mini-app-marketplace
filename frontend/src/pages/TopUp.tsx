import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { openInvoice } from '@telegram-apps/sdk-react'
import { apiFetch, formatApiError } from '../lib/api'
import { getPricingConfig } from '../lib/pricing'
import {
  createStarInvoice,
  createTopUpRequest,
  getTopUpCardInfo,
  listMyTopUpRequests,
} from '../lib/topupApi'
import { PageHeader, ErrorState, Segments, useToast } from '../components/ui'
import { TopUpDirect } from '../components/topup/TopUpDirect'
import { TopUpStars } from '../components/topup/TopUpStars'
import { TopUpIntermediaries } from '../components/topup/TopUpIntermediaries'
import type { TopUpCardInfo, TopUpRequest } from '../lib/types'

type Tab = 'direct' | 'stars' | 'intermediaries'

/** Survives a reload: the Telegram payment sheet can take the app out of
 *  the foreground, and coming back must not lose track of money already
 *  paid. */
const PENDING_KEY = 'pending-star-purchase'

/**
 * The three ways to add wallet balance.
 *
 * "direct" (card-to-card, reviewed by an admin) and "intermediaries"
 * (outbound links to third-party sellers) never touch the wallet
 * themselves. "stars" — real Telegram Stars through Telegram's own
 * invoice sheet — credits it automatically the instant Telegram
 * confirms (see backend/app/telegram_webhook/router.py).
 *
 * This file owns the data and the money; each tab's rendering lives in
 * components/topup/.
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

  const [tab, setTab] = useState<Tab>('direct')
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

  // --- Telegram Stars ---
  const [starsAmount, setStarsAmount] = useState('')
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState<string | null>(null)
  const [pendingPurchase, setPendingPurchase] = useState<number | null>(
    () => Number(sessionStorage.getItem(PENDING_KEY)) || null,
  )
  const [recheck, setRecheck] = useState(0)

  function load() {
    setError(null)
    getPricingConfig()
      .then((config) => setRate(config.star_to_toman_rate))
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

  // Telegram has taken the payment; the wallet is credited by a webhook,
  // so the only way to know it landed is to ask. Polls for about 30
  // seconds, then stops rather than hammering forever.
  useEffect(() => {
    if (!pendingPurchase) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    let attempts = 0

    async function check() {
      try {
        const purchase = await apiFetch<{ status: string }>(
          `/topup/stars/purchases/${pendingPurchase}`,
        )
        if (!active) return
        if (purchase.status === 'paid') {
          sessionStorage.removeItem(PENDING_KEY)
          setPendingPurchase(null)
          setStarsAmount('')
          toast.success(t('topup.starsPurchaseSuccess'))
          return
        }
      } catch (err) {
        if (active) setBuyError(formatApiError(err))
      }
      if (active && ++attempts < 15) timer = setTimeout(check, 2000)
    }

    void check()
    return () => {
      active = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `recheck` is the manual "check now" trigger; toast/t are stable enough not to restart polling
  }, [pendingPurchase, recheck])

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

  async function buyStars() {
    const amount = Number(starsAmount)
    if (!amount) return
    setBuying(true)
    setBuyError(null)
    try {
      const { invoice_link, purchase_id } = await createStarInvoice(amount)
      const result = await openInvoice(invoice_link, 'url')
      if (result === 'paid' || result === 'pending') {
        // Recorded before anything else: from here on the wallet may be
        // credited whether or not this screen is still open.
        sessionStorage.setItem(PENDING_KEY, String(purchase_id))
        setPendingPurchase(purchase_id)
      } else if (result !== 'cancelled') {
        setBuyError(t('topup.starsPurchaseFailed'))
      }
    } catch (err) {
      // openInvoice() throws outside a real Telegram client — e.g. a
      // plain dev browser. Explain it rather than crashing.
      setBuyError(formatApiError(err))
    } finally {
      setBuying(false)
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

      {/* Every tab ends in a pinned action except the third, which is
          only links out. */}
      <div className={`ui-page-body${tab === 'intermediaries' ? '' : ' ui-page-body-action'}`}>
        <Segments
          label={t('topup.pageTitle')}
          value={tab}
          onChange={setTab}
          options={[
            { id: 'direct', label: t('topup.tabDirect') },
            { id: 'stars', label: t('topup.tabStars') },
            { id: 'intermediaries', label: t('topup.tabIntermediaries') },
          ]}
        />

        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : tab === 'direct' ? (
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
        ) : tab === 'stars' ? (
          <TopUpStars
            amount={starsAmount}
            onAmountChange={setStarsAmount}
            onBuy={buyStars}
            buying={buying}
            error={buyError}
            awaitingCredit={pendingPurchase != null}
            onCheckNow={() => setRecheck((n) => n + 1)}
          />
        ) : (
          <TopUpIntermediaries />
        )}
      </div>
    </div>
  )
}
