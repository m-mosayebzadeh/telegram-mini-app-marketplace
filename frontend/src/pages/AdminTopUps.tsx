import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { approveTopUpRequest, listTopUpRequestsForAdmin, rejectTopUpRequest } from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import {
  PageHeader,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Segments,
  SkeletonRows,
} from '../components/ui'
import { IconDrop, IconPersonFallback, IconShieldLock } from '../components/icons'
import { Sheet } from '../components/ui/Sheet'
import { fetchTopUpReceiptBlobUrl } from '../lib/topupApi'
import { useMe } from '../lib/MeContext'
import type { AdminTopUpRequest } from '../lib/types'

type StatusFilter = 'pending' | 'approved' | 'rejected'

/** "مالی → شارژها" — review card-to-card top-up requests. Access
 * (owner or "finance.topups") comes from the session-wide check in
 * MeContext, not a fetch of its own — see lib/MeContext.tsx. */
export default function AdminTopUps() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
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

  const STATUS_TONE = {
    pending: 'ui-status-neutral',
    approved: 'ui-status-success',
    rejected: 'ui-status-danger',
  } as const
  const STATUS_KEY = {
    pending: 'statusPending',
    approved: 'statusApproved',
    rejected: 'statusRejected',
  } as const

  if (!adminAccess) {
    return (
      <div className="ui-page">
        <PageHeader title={t('admin.topupsTitle')} onBack={() => navigate('/admin/finance')} />
        <div className="ui-page-body">
          <SkeletonRows count={3} />
        </div>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="ui-page">
        <PageHeader title={t('admin.topupsTitle')} onBack={() => navigate('/admin')} />
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
      <PageHeader title={t('admin.topupsTitle')} onBack={() => navigate('/admin/finance')} />

      <div className="ui-page-body">
        <Segments
          label={t('admin.topupsTitle')}
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'pending', label: t('admin.filterPending') },
            { id: 'approved', label: t('admin.filterApproved') },
            { id: 'rejected', label: t('admin.filterRejected') },
          ]}
        />

        {error ? (
          <ErrorState text={error} onRetry={loadRequests} />
        ) : requests == null ? (
          <SkeletonRows count={3} />
        ) : requests.length === 0 ? (
          <EmptyState
            title={t('topup.historyEmpty')}
            text={
              filter === 'pending'
                ? t('admin.topupsNothingPending')
                : t('admin.topupsNothingHere')
            }
          />
        ) : (
          <div className="ui-list">
            {requests.map((r) => (
              <div className="fr-row" key={r.id}>
                <div className="ui-row ui-row-avatar">
                  <span className="ui-row-media">
                    <IconPersonFallback size={22} />
                  </span>
                  <span className="ui-row-main">
                    <span className="ui-row-title" dir="auto">
                      {r.requester.display_name}
                    </span>
                    {/* The two figures that have to match the receipt:
                        what they asked for, and what that costs. */}
                    <span className="ui-row-subtitle tu-history-amount tabular">
                      <IconDrop size={16} />
                      {r.requested_stars.toLocaleString(i18n.language)}
                      <span className="of-own-dot" aria-hidden="true" />
                      {t('wallet.tomanAmount', {
                        amount: r.requested_toman_amount.toLocaleString(i18n.language),
                      })}
                    </span>
                  </span>
                  <span className="ui-row-trailing">
                    <span className={`ui-status ${STATUS_TONE[r.status]}`}>
                      {t(`topup.${STATUS_KEY[r.status]}`)}
                    </span>
                  </span>
                </div>

                <div className="ui-btn-row fr-actions">
                  <Button variant="secondary" size="sm" onClick={() => openReceipt(r.id)}>
                    {t('admin.viewReceipt')}
                  </Button>
                  {r.status === 'pending' && (
                    <>
                      <Button variant="danger" size="sm" onClick={() => openReview(r, 'reject')}>
                        {t('admin.rejectButton')}
                      </Button>
                      <Button variant="primary" size="sm" onClick={() => openReview(r, 'approve')}>
                        {t('admin.approveButton')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The receipt itself, full screen. This is the whole job of the
          page: read the number off the photo, check it against the two
          above, decide. */}
      {receiptUrl && (
        <div
          className="ui-scrim at-receipt"
          onClick={() => {
            URL.revokeObjectURL(receiptUrl)
            setReceiptUrl(null)
          }}
          role="presentation"
        >
          <img src={receiptUrl} alt="" />
        </div>
      )}

      {reviewing && (
        <Sheet
          title={t(reviewing.mode === 'approve' ? 'admin.approveButton' : 'admin.rejectButton')}
          onClose={() => setReviewing(null)}
          dismissible={!busy}
          footer={
            reviewing.mode === 'approve' ? (
              <Button
                variant="primary"
                size="lg"
                block
                loading={busy}
                disabled={!Number(finalAmount)}
                onClick={submitApprove}
              >
                {t('admin.approveSubmit')}
              </Button>
            ) : (
              <Button
                variant="danger"
                size="lg"
                block
                loading={busy}
                disabled={!reason.trim()}
                onClick={submitReject}
              >
                {t('admin.rejectSubmit')}
              </Button>
            )
          }
        >
          <div className="co-form">
            {reviewing.mode === 'approve' ? (
              <>
                <label className="ui-field" htmlFor="topup-final-amount">
                  <span className="ui-field-label">{t('admin.approveAmountLabel')}</span>
                  <div className="ui-input-group">
                    <input
                      id="topup-final-amount"
                      className="ui-input ui-input-numeric"
                      type="text"
                      inputMode="numeric"
                      value={finalAmount}
                      onChange={(e) =>
                        setFinalAmount(e.target.value.replace(/[^\d]/g, '').replace(/^0+(?=\d)/, ''))
                      }
                    />
                    <span className="ui-input-group-addon">{t('finance.tomanUnit')}</span>
                  </div>
                  {/* What they asked for, so the field can be checked
                      against it without leaving the sheet. */}
                  <span className="ui-field-help tabular">
                    {t('admin.approveRequestedHint', {
                      amount: reviewing.request.requested_toman_amount.toLocaleString(i18n.language),
                    })}
                  </span>
                </label>

                <label className="ui-field" htmlFor="topup-reference">
                  <span className="ui-field-label">{t('admin.approveRefLabel')}</span>
                  <input
                    id="topup-reference"
                    className="ui-input"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <label className="ui-field" htmlFor="topup-reject-reason">
                <span className="ui-field-label">{t('admin.rejectReasonPrompt')}</span>
                <textarea
                  id="topup-reject-reason"
                  className="ui-textarea"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
                {/* The requester reads this, so an empty one is not a
                    rejection they can act on. */}
                <span className="ui-field-help">{t('admin.rejectReasonHint')}</span>
              </label>
            )}

            {reviewError && <p className="ui-field-error">{reviewError}</p>}
          </div>
        </Sheet>
      )}

      {/* Approving a different amount than was asked for is legitimate —
          the transfer really can differ — but it is also exactly how a
          typo becomes money. */}
      {confirmMismatch && reviewing && (
        <ConfirmDialog
          title={t('admin.amountMismatchTitle')}
          text={t('admin.amountMismatchBody', {
            requested: reviewing.request.requested_toman_amount.toLocaleString(i18n.language),
            final: Number(finalAmount).toLocaleString(i18n.language),
          })}
          confirmLabel={t('admin.amountMismatchConfirm')}
          destructive
          loading={busy}
          onCancel={() => setConfirmMismatch(false)}
          onConfirm={submitApprove}
        />
      )}
    </div>
  )
}
