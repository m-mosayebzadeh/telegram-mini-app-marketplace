import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import { approveTopUpRequest, listTopUpRequestsForAdmin, rejectTopUpRequest } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { NumberField } from '../components/NumberField'
import { Sheet } from '../components/Sheet'
import { fetchTopUpReceiptBlobUrl } from '../lib/topupApi'
import { useMe } from '../lib/MeContext'
import type { AdminTopUpRequest } from '../lib/types'

type StatusFilter = 'pending' | 'approved' | 'rejected'

/** "مالی → شارژها" — review card-to-card top-up requests. Access
 * (owner or "finance.topups") comes from the session-wide check in
 * MeContext, not a fetch of its own — see lib/MeContext.tsx. */
export default function AdminTopUps() {
  const { t } = useTranslation()
  const { adminAccess } = useMe()
  const [filter, setFilter] = useState<StatusFilter>('pending')
  const [requests, setRequests] = useState<AdminTopUpRequest[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<{ request: AdminTopUpRequest; mode: 'approve' | 'reject' } | null>(null)
  const [finalAmount, setFinalAmount] = useState('')
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [confirmMismatch, setConfirmMismatch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const hasAccess = !!adminAccess && (adminAccess.is_owner || adminAccess.scopes.includes('finance.topups'))

  function loadRequests() {
    setRequests(null)
    listTopUpRequestsForAdmin(filter)
      .then(setRequests)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(() => {
    if (hasAccess) loadRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess, filter])

  function openReview(request: AdminTopUpRequest, mode: 'approve' | 'reject') {
    setReviewing({ request, mode })
    setFinalAmount(String(request.requested_toman_amount))
    setReference('')
    setReason('')
    setConfirmMismatch(false)
    setReviewError(null)
  }

  async function openReceipt(requestId: number) {
    try {
      setReceiptUrl(await fetchTopUpReceiptBlobUrl(requestId))
    } catch (err) {
      setError(formatApiError(err))
    }
  }

  async function submitApprove() {
    if (!reviewing) return
    const amount = Number(finalAmount)
    if (!amount || amount <= 0 || !reference.trim()) {
      setReviewError(t('topup.starsAmountMustBePositive'))
      return
    }
    if (amount !== reviewing.request.requested_toman_amount && !confirmMismatch) {
      setConfirmMismatch(true)
      return
    }
    setBusy(true)
    setReviewError(null)
    try {
      await approveTopUpRequest(reviewing.request.id, amount, reference.trim())
      setReviewing(null)
      loadRequests()
    } catch (err) {
      setReviewError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitReject() {
    if (!reviewing || !reason.trim()) return
    setBusy(true)
    setReviewError(null)
    try {
      await rejectTopUpRequest(reviewing.request.id, reason.trim())
      setReviewing(null)
      loadRequests()
    } catch (err) {
      setReviewError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!adminAccess) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }
  if (!hasAccess) return <Placeholder header={t('admin.noAccess')} />

  return (
    <div className="hp-page">
      <div className="hp-page-header">{t('admin.topupsTitle')}</div>

      <div className="hp-segmented" style={{ margin: '0 12px 12px' }}>
        {(['pending', 'approved', 'rejected'] as const).map((s) => (
          <button
            key={s}
            className={`hp-segmented-btn ${filter === s ? 'hp-segmented-active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {t(`admin.filter${s.charAt(0).toUpperCase()}${s.slice(1)}`)}
          </button>
        ))}
      </div>

      {requests == null ? (
        <Placeholder>
          <Spinner size="m" />
        </Placeholder>
      ) : requests.length === 0 ? (
        <p className="hp-empty">{t('topup.historyEmpty')}</p>
      ) : (
        <div className="hp-list">
          {requests.map((r) => (
            <div key={r.id} className="hp-list-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <div className="hp-list-row-main">
                  <span className="hp-list-title">
                    {r.requester.display_name}
                    {r.requester.username ? ` (@${r.requester.username})` : ''}
                  </span>
                  <span className="hp-list-subtitle">
                    {r.requested_stars} ⭐ · {r.requested_toman_amount.toLocaleString('en-US')} تومان
                  </span>
                </div>
                <span className={`hp-status-pill hp-status-${r.status}`}>
                  {t(`topup.${r.status === 'pending' ? 'statusPending' : r.status === 'approved' ? 'statusApproved' : 'statusRejected'}`)}
                </span>
              </div>
              <div className="hp-list-row-actions" style={{ marginTop: 8 }}>
                <button className="hp-btn-sm" onClick={() => openReceipt(r.id)}>
                  {t('admin.viewReceipt')}
                </button>
                {r.status === 'pending' && (
                  <>
                    <button className="hp-btn-sm" onClick={() => openReview(r, 'approve')}>
                      {t('admin.approveButton')}
                    </button>
                    <button className="hp-btn-sm" onClick={() => openReview(r, 'reject')}>
                      {t('admin.rejectButton')}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {receiptUrl && (
        <div
          className="hp-avatar-preview-backdrop"
          onClick={() => {
            URL.revokeObjectURL(receiptUrl)
            setReceiptUrl(null)
          }}
        >
          <img className="hp-avatar-preview-img" src={receiptUrl} alt="" />
        </div>
      )}

      {reviewing && (
        <Sheet
          title={t(reviewing.mode === 'approve' ? 'admin.approveButton' : 'admin.rejectButton')}
          onClose={() => setReviewing(null)}
        >
          {reviewing.mode === 'approve' ? (
            <>
              <div className="hp-field">
                <NumberField header={t('admin.approveAmountLabel')} value={finalAmount} onChange={setFinalAmount} />
              </div>
              <div className="hp-field">
                <span className="hp-field-label">{t('admin.approveRefLabel')}</span>
                <input
                  className="hp-segmented-btn"
                  style={{ width: '100%' }}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
              {reviewError && <p className="hp-error">{reviewError}</p>}
              <div className="hp-field">
                <button
                  className="hp-btn hp-btn-gradient"
                  style={{ width: '100%' }}
                  disabled={busy}
                  onClick={submitApprove}
                >
                  {busy ? t('common.loading') : t('admin.approveSubmit')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="hp-field">
                <span className="hp-field-label">{t('admin.rejectReasonPrompt')}</span>
                <input
                  className="hp-segmented-btn"
                  style={{ width: '100%' }}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              {reviewError && <p className="hp-error">{reviewError}</p>}
              <div className="hp-field">
                <button
                  className="hp-btn hp-btn-gradient"
                  style={{ width: '100%' }}
                  disabled={busy || !reason.trim()}
                  onClick={submitReject}
                >
                  {busy ? t('common.loading') : t('admin.rejectSubmit')}
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}

      {confirmMismatch && reviewing && (
        <div className="hp-confirm-backdrop" onClick={() => setConfirmMismatch(false)}>
          <div className="hp-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p className="hp-confirm-title">{t('admin.amountMismatchTitle')}</p>
            <p className="hp-confirm-message">
              {t('admin.amountMismatchBody', {
                requested: reviewing.request.requested_toman_amount.toLocaleString('en-US'),
                final: Number(finalAmount).toLocaleString('en-US'),
              })}
            </p>
            <div className="hp-confirm-actions">
              <button className="hp-confirm-btn" onClick={() => setConfirmMismatch(false)}>
                {t('common.cancel')}
              </button>
              <button className="hp-confirm-btn hp-confirm-btn-danger" onClick={submitApprove}>
                {t('admin.amountMismatchConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
