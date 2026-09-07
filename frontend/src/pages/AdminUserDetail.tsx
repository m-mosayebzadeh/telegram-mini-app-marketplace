import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Avatar, Placeholder, Spinner } from '@telegram-apps/telegram-ui'
import {
  blockUser,
  deleteContentAdmin,
  deleteOfferAdmin,
  getUserDetail,
  listUserChatSessionsAdmin,
  listUserContentAdmin,
  listUserOffersAdmin,
  listUserRequestsAdmin,
  listUserTransactionsAdmin,
  unblockUser,
} from '../lib/adminApi'
import { formatApiError } from '../lib/api'
import { IconArrowNarrowLeft } from '../components/icons'
import type {
  AdminChatSession,
  AdminUserDetail as AdminUserDetailType,
  Content,
  Offer,
  RequestActivity,
  Transaction,
} from '../lib/types'

type DeleteTarget = { kind: 'offer' | 'content'; id: number }

/**
 * "کاربران" — one user's full admin-facing picture: profile basics,
 * account status + wallet, and every one of their offers/content/
 * requests/chat sessions/transactions, each fetched independently so
 * one slow/empty section never blocks the rest of the page. Every
 * sub-list reuses the exact same *Out shape its own normal, non-admin
 * endpoint already returns (see backend/app/admin/router.py).
 */
export default function AdminUserDetail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams()
  const userId = Number(id)

  const [user, setUser] = useState<AdminUserDetailType | null>(null)
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [content, setContent] = useState<Content[] | null>(null)
  const [requests, setRequests] = useState<RequestActivity[] | null>(null)
  const [chatSessions, setChatSessions] = useState<AdminChatSession[] | null>(null)
  const [transactions, setTransactions] = useState<Transaction[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [confirmingStatusChange, setConfirmingStatusChange] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [busy, setBusy] = useState(false)

  function loadUser() {
    getUserDetail(userId)
      .then(setUser)
      .catch((err) => setError(formatApiError(err)))
  }

  useEffect(() => {
    loadUser()
    listUserOffersAdmin(userId).then(setOffers).catch((err) => setError(formatApiError(err)))
    listUserContentAdmin(userId).then(setContent).catch((err) => setError(formatApiError(err)))
    listUserRequestsAdmin(userId).then(setRequests).catch((err) => setError(formatApiError(err)))
    listUserChatSessionsAdmin(userId).then(setChatSessions).catch((err) => setError(formatApiError(err)))
    listUserTransactionsAdmin(userId).then(setTransactions).catch((err) => setError(formatApiError(err)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function confirmStatusChange() {
    if (!user) return
    setBusy(true)
    try {
      if (user.status === 'active') await blockUser(userId)
      else await unblockUser(userId)
      setConfirmingStatusChange(false)
      loadUser()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setBusy(true)
    try {
      if (deleteTarget.kind === 'offer') {
        await deleteOfferAdmin(deleteTarget.id)
        setOffers((prev) => prev?.filter((o) => o.id !== deleteTarget.id) ?? prev)
      } else {
        await deleteContentAdmin(deleteTarget.id)
        setContent((prev) => prev?.filter((c) => c.id !== deleteTarget.id) ?? prev)
      }
      setDeleteTarget(null)
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <Placeholder header={t('common.error')}>{error}</Placeholder>
  if (!user) {
    return (
      <Placeholder>
        <Spinner size="l" />
      </Placeholder>
    )
  }

  return (
    <div className="hp-page">
      <div className="hp-page-back-header">
        <button className="hp-chat-back" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconArrowNarrowLeft size={20} />
        </button>
        <span className="hp-page-back-title">{user.display_name}</span>
      </div>

      <div className="hp-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <Avatar size={48} src={user.avatar_url ?? undefined} acronym={user.display_name.slice(0, 1).toUpperCase()} />
          <span>
            <span className="hp-card-title" style={{ display: 'block', margin: 0 }} dir="auto">
              {user.display_name}
            </span>
            {user.username && <span className="hp-list-subtitle">@{user.username}</span>}
          </span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('admin.userDetailTelegramId')}</span>
          <span className="hp-kv-value">{user.telegram_id}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('admin.userDetailJoinedAt')}</span>
          <span className="hp-kv-value">{new Date(user.joined_at).toLocaleDateString()}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('account.status')}</span>
          <span className="hp-kv-value">
            {user.status === 'active' ? t('account.statusActive') : t('account.statusBlocked')}
          </span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('admin.userDetailBalance')}</span>
          <span className="hp-kv-value">{user.balance_toman.toLocaleString('en-US')}</span>
        </div>
        <div className="hp-kv-row">
          <span className="hp-kv-label">{t('admin.userDetailPending')}</span>
          <span className="hp-kv-value">{user.pending_toman.toLocaleString('en-US')}</span>
        </div>
        <div className="hp-field" style={{ margin: '12px 0 0' }}>
          <button className="hp-btn hp-btn-gradient" style={{ width: '100%' }} onClick={() => setConfirmingStatusChange(true)}>
            {t(user.status === 'active' ? 'admin.blockButton' : 'admin.unblockButton')}
          </button>
        </div>
      </div>

      <div className="hp-card">
        <p className="hp-card-title">{t('admin.usersSectionOffers')}</p>
        {offers == null ? (
          <Spinner size="s" />
        ) : offers.length === 0 ? (
          <p className="hp-empty">{t('offers.none')}</p>
        ) : (
          <div className="hp-list">
            {offers.map((offer) => (
              <div key={offer.id} className="hp-list-row">
                <span className="hp-list-row-main">
                  <span className="hp-list-title">{offer.title}</span>
                  <span className="hp-list-subtitle">
                    {t('offers.priceLine', { price: offer.price_stars, minutes: offer.display_duration_minutes })}
                  </span>
                </span>
                <button className="hp-btn-sm" onClick={() => setDeleteTarget({ kind: 'offer', id: offer.id })}>
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hp-card">
        <p className="hp-card-title">{t('admin.usersSectionContent')}</p>
        {content == null ? (
          <Spinner size="s" />
        ) : content.length === 0 ? (
          <p className="hp-empty">{t('profilePage.contentEmpty')}</p>
        ) : (
          <div className="hp-list">
            {content.map((item) => (
              <div key={item.id} className="hp-list-row">
                <span className="hp-list-row-main">
                  <span className="hp-list-title">{item.content_type}</span>
                  <span className="hp-list-subtitle">{new Date(item.created_at).toLocaleDateString()}</span>
                </span>
                <button className="hp-btn-sm" onClick={() => setDeleteTarget({ kind: 'content', id: item.id })}>
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hp-card">
        <p className="hp-card-title">{t('admin.usersSectionRequests')}</p>
        {requests == null ? (
          <Spinner size="s" />
        ) : requests.length === 0 ? (
          <p className="hp-empty">{t('activityPage.requestsEmpty')}</p>
        ) : (
          <div className="hp-list">
            {requests.map((request) => (
              <div key={request.id} className="hp-list-row">
                <span className="hp-list-row-main">
                  <span className="hp-list-title">{request.offer_title}</span>
                  <span className="hp-list-subtitle">
                    {t(request.direction === 'sent' ? 'activityPage.sentTo' : 'activityPage.receivedFrom', {
                      name: request.counterpart_display_name,
                    })}{' '}
                    — {request.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hp-card">
        <p className="hp-card-title">{t('admin.usersSectionChatSessions')}</p>
        {chatSessions == null ? (
          <Spinner size="s" />
        ) : chatSessions.length === 0 ? (
          <p className="hp-empty">{t('chatsPage.activeEmpty')}</p>
        ) : (
          <div className="hp-list">
            {chatSessions.map((session) => (
              <div key={session.id} className="hp-list-row">
                <span className="hp-list-row-main">
                  <span className="hp-list-title">{session.offer_title}</span>
                  <span className="hp-list-subtitle">
                    {session.other_display_name} —{' '}
                    {session.status === 'open' ? t('chatSession.statusOpen') : t('chatSession.statusClosed')}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hp-card">
        <p className="hp-card-title">{t('admin.usersSectionTransactions')}</p>
        {transactions == null ? (
          <Spinner size="s" />
        ) : transactions.length === 0 ? (
          <p className="hp-empty">{t('topup.historyEmpty')}</p>
        ) : (
          <div className="hp-list">
            {transactions.map((tx) => (
              <div key={tx.id} className="hp-list-row">
                <span className="hp-list-row-main">
                  <span className="hp-list-title">{tx.gross_price_toman.toLocaleString('en-US')} تومان</span>
                  <span className="hp-list-subtitle">
                    {tx.kind} — {tx.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmingStatusChange && (
        <div className="hp-confirm-backdrop" onClick={() => setConfirmingStatusChange(false)}>
          <div className="hp-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p className="hp-confirm-title">
              {t(user.status === 'active' ? 'admin.blockButton' : 'admin.unblockButton')}
            </p>
            <p className="hp-confirm-message">
              {t(user.status === 'active' ? 'admin.blockConfirmBody' : 'admin.unblockConfirmBody')}
            </p>
            <div className="hp-confirm-actions">
              <button className="hp-confirm-btn" onClick={() => setConfirmingStatusChange(false)}>
                {t('common.cancel')}
              </button>
              <button className="hp-confirm-btn hp-confirm-btn-danger" disabled={busy} onClick={confirmStatusChange}>
                {t(user.status === 'active' ? 'admin.blockButton' : 'admin.unblockButton')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="hp-confirm-backdrop" onClick={() => setDeleteTarget(null)}>
          <div className="hp-confirm-box" onClick={(e) => e.stopPropagation()}>
            <p className="hp-confirm-title">{t('common.delete')}</p>
            <p className="hp-confirm-message">
              {t(deleteTarget.kind === 'offer' ? 'admin.deleteOfferConfirmBody' : 'admin.deleteContentConfirmBody')}
            </p>
            <div className="hp-confirm-actions">
              <button className="hp-confirm-btn" onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </button>
              <button className="hp-confirm-btn hp-confirm-btn-danger" disabled={busy} onClick={confirmDelete}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
