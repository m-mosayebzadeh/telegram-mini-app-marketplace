import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { formatApiError } from '../lib/api'
import { getPricingConfig } from '../lib/pricing'
import {
  createTopUpRequest,
  getTopUpCardInfo,
  listMyTopUpRequests,
} from '../lib/topupApi'
import { IconExternalLink } from '../components/icons'
import type { TopUpCardInfo, TopUpRequest } from '../lib/types'

type Tab = 'direct' | 'stars' | 'intermediaries'

const INTERMEDIARY_SITES = [
  { key: 'intermediarySiteIranicard', url: 'https://www.iranicard.ir/payments/foreign-services/telegram-stars/' },
  { key: 'intermediarySiteNumberland', url: 'https://numberland.ir/account/telegram-stars' },
  { key: 'intermediarySiteSubtg', url: 'https://subtg.com/telegram-stars' },
] as const

function statusLabel(status: TopUpRequest['status']): string {
  return status === 'pending' ? 'statusPending' : status === 'approved' ? 'statusApproved' : 'statusRejected'
}

/**
 * The three ways to add wallet balance — see
 * TECHNICAL_REQUIREMENTS.md, "شارژ کارت‌به‌کارت". Only "direct"
 * (manual card-to-card, reviewed by an admin — see
 * backend/app/topup/router.py + app/admin/router.py) and
 * "intermediaries" (plain external links) are real; "stars" (paying
 * with real Telegram Stars) is a placeholder until that separate,
 * bigger integration exists.
 */
export default function TopUp() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('direct')
  const [rate, setRate] = useState<number | null>(null)
  const [cardInfo, setCardInfo] = useState<TopUpCardInfo | null>(null)
  const [history, setHistory] = useState<TopUpRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [starsText, setStarsText] = useState('')
  const [tomanText, setTomanText] = useState('')
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function loadHistory() {
    listMyTopUpRequests()
      .then(setHistory)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(() => {
    getPricingConfig()
      .then((config) => setRate(config.star_to_toman_rate))
      .catch((err) => setError(formatApiError(err)))
    getTopUpCardInfo()
      .then(setCardInfo)
      .catch((err) => setError(formatApiError(err)))
    loadHistory()
  }, [])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    if (toast == null) return
    const timer = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(timer)
  }, [toast])

  function pickFile(picked: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(picked)
    setPreviewUrl(picked ? URL.createObjectURL(picked) : null)
  }

  // Stars is the only field the backend actually stores
  // (TopUpRequest.requested_stars) — Toman is purely a computed,
  // read-only display, never a second thing to type into (see
  // .hp-converter's comment in theme.css for why: a typed Toman amount
  // that doesn't divide evenly by the rate used to silently round to a
  // Star count that didn't match what the user thought they entered).
  function onStarsChange(raw: string) {
    const digits = raw.replace(/[^\d]/g, '')
    setStarsText(digits)
    setTomanText(rate && digits ? String(Number(digits) * rate) : '')
  }

  async function copyCardNumber() {
    if (!cardInfo?.card_number) return
    try {
      await navigator.clipboard.writeText(cardInfo.card_number)
      setToast(t('topup.cardCopied'))
    } catch {
      // Clipboard access can be denied — not worth surfacing as an error.
    }
  }

  async function submit() {
    const stars = Number(starsText)
    if (!file || !stars || stars <= 0) {
      setSubmitError(t('topup.starsAmountMustBePositive'))
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      await createTopUpRequest(file, stars)
      setToast(t('topup.submitSuccessBody'))
      pickFile(null)
      setStarsText('')
      setTomanText('')
      loadHistory()
    } catch (err) {
      setSubmitError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (rate == null || cardInfo == null || history == null) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('topup.pageTitle')}</div>

      <div className="hp-tabs">
        <button className={`hp-tab ${tab === 'direct' ? 'hp-tab-active' : ''}`} onClick={() => setTab('direct')}>
          {t('topup.tabDirect')}
        </button>
        <button className={`hp-tab ${tab === 'stars' ? 'hp-tab-active' : ''}`} onClick={() => setTab('stars')}>
          {t('topup.tabStars')}
        </button>
        <button
          className={`hp-tab ${tab === 'intermediaries' ? 'hp-tab-active' : ''}`}
          onClick={() => setTab('intermediaries')}
        >
          {t('topup.tabIntermediaries')}
        </button>
      </div>

      {tab === 'direct' && (
        <>
          <div className="hp-tab-body">
            <div className="hp-proscons">
              <div className="hp-proscons-row hp-proscons-row-pro">
                <span className="hp-proscons-icon">✓</span>
                <span>{t('topup.directPro1')}</span>
              </div>
              <div className="hp-proscons-row hp-proscons-row-pro">
                <span className="hp-proscons-icon">✓</span>
                <span>{t('topup.directPro2')}</span>
              </div>
              <div className="hp-proscons-row hp-proscons-row-pro">
                <span className="hp-proscons-icon">✓</span>
                <span>{t('topup.directPro3')}</span>
              </div>
              <div className="hp-proscons-row hp-proscons-row-con">
                <span className="hp-proscons-icon">✕</span>
                <span>{t('topup.directCon1')}</span>
              </div>
            </div>

            <div className="hp-bank-card">
              <div className="hp-bank-card-chip" />
              <div>
                <div className="hp-bank-card-number">{cardInfo.card_number || '—'}</div>
                <div className="hp-bank-card-holder">{cardInfo.card_holder_name || '—'}</div>
              </div>
              <button className="hp-bank-card-copy" onClick={copyCardNumber}>
                {t('topup.cardCopy')}
              </button>
            </div>

            <div className="hp-converter">
              <span className="hp-field-label">{t('topup.converterStarsLabel')}</span>
              <input
                className="hp-segmented-btn hp-converter-input"
                type="text"
                inputMode="numeric"
                value={starsText}
                onChange={(e) => onStarsChange(e.target.value)}
                placeholder="0"
              />
              {tomanText && (
                <p className="hp-converter-toman-line">
                  ≈ {Number(tomanText).toLocaleString('en-US')} {t('topup.converterTomanLabel')}
                </p>
              )}
              <p className="hp-converter-rate-hint">
                {t('topup.converterRateHint', { rate: rate.toLocaleString('en-US') })}
              </p>
            </div>

            <div className="hp-field">
              <span className="hp-field-label">{t('topup.receiptLabel')}</span>
              <label
                className="hp-dropzone"
                onClick={() => fileInputRef.current?.click()}
                style={previewUrl ? { padding: 0 } : undefined}
              >
                {previewUrl ? (
                  <>
                    <img className="hp-dropzone-preview" src={previewUrl} alt="" />
                    <span className="hp-dropzone-preview-overlay">{t('topup.changeReceiptFile')}</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 26 }}>🧾</span>
                    <span>{t('topup.chooseReceiptFile')}</span>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                />
              </label>
            </div>

            {submitError && <p className="hp-error">{submitError}</p>}

            <div className="hp-field">
              <button
                className="hp-btn hp-btn-gradient"
                style={{ width: '100%' }}
                disabled={!file || !starsText || busy}
                onClick={submit}
              >
                {busy ? t('common.loading') : t('topup.submitButton')}
              </button>
            </div>
          </div>

          <div className="hp-page-header" style={{ marginTop: 24 }}>
            {t('topup.historyTitle')}
          </div>
          {history.length === 0 ? (
            <p className="hp-empty">{t('topup.historyEmpty')}</p>
          ) : (
            <div className="hp-list">
              {history.map((r) => (
                <div key={r.id} className="hp-list-row">
                  <div className="hp-list-row-main">
                    <span className="hp-list-title">
                      {r.requested_stars} ⭐ · {r.requested_toman_amount.toLocaleString('en-US')} تومان
                    </span>
                    {r.status === 'approved' && r.final_toman_amount != null && (
                      <span className="hp-list-subtitle">
                        {t('topup.finalAmountLabel')}: {r.final_toman_amount.toLocaleString('en-US')}
                      </span>
                    )}
                    {r.status === 'rejected' && r.rejection_reason && (
                      <span className="hp-list-subtitle">
                        {t('topup.rejectionReasonLabel')}: {r.rejection_reason}
                      </span>
                    )}
                  </div>
                  <span className={`hp-status-pill hp-status-${r.status}`}>{t(`topup.${statusLabel(r.status)}`)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'stars' && (
        <>
          <div className="hp-tab-body hp-proscons">
            <div className="hp-proscons-row hp-proscons-row-pro">
              <span className="hp-proscons-icon">✓</span>
              <span>{t('topup.starsPro1')}</span>
            </div>
            <div className="hp-proscons-row hp-proscons-row-con">
              <span className="hp-proscons-icon">✕</span>
              <span>{t('topup.starsCon1')}</span>
            </div>
          </div>
          <p className="hp-empty">{t('topup.starsComingSoon')}</p>
        </>
      )}

      {tab === 'intermediaries' && (
        <>
          <div className="hp-tab-body hp-proscons">
            <div className="hp-proscons-row hp-proscons-row-con">
              <span className="hp-proscons-icon">✕</span>
              <span>{t('topup.intermediariesCon1')}</span>
            </div>
            <div className="hp-proscons-row hp-proscons-row-con">
              <span className="hp-proscons-icon">✕</span>
              <span>{t('topup.intermediariesCon2')}</span>
            </div>
          </div>
          <div className="hp-list">
            {INTERMEDIARY_SITES.map((site) => (
              <a
                key={site.key}
                className="hp-list-row"
                href={site.url}
                target="_blank"
                rel="noreferrer"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <span className="hp-list-title">{t(`topup.${site.key}`)}</span>
                <span className="hp-external-link-icon">
                  <IconExternalLink size={18} />
                </span>
              </a>
            ))}
          </div>
        </>
      )}

      {toast && <div className="hp-toast">{toast}</div>}
    </div>
  )
}
