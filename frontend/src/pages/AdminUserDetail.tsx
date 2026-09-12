import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import {
  PageHeader,
  Button,
  ConfirmDialog,
  ErrorState,
  SkeletonRows,
  StatList,
  useToast,
} from '../components/ui'
import { IconBan, IconPersonFallback } from '../components/icons'
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
  const { t, i18n } = useTranslation()
  const toast = useToast()
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
      toast.error(formatApiError(err))
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
      toast.error(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  if (error || !user) {
    return (
      <div className="ui-page">
        <PageHeader title={t('admin.usersTitle')} onBack={() => navigate(-1)} />
        <div className="ui-page-body">
          {error ? <ErrorState text={error} onRetry={loadUser} /> : <SkeletonRows count={5} />}
        </div>
      </div>
    )
  }

  const blocked = user.status !== 'active'

  return (
    <div className="ui-page">
      <PageHeader title={user.display_name} onBack={() => navigate(-1)} />

      <div className="ui-page-body">
        {/* Who this is, large enough to be sure before acting on their
            account. */}
        <header className="au-identity">
          <span className="au-avatar">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" />
            ) : (
              <IconPersonFallback size={28} />
            )}
          </span>
          <span className="au-identity-main">
            <span className="au-name" dir="auto">
              {user.display_name}
            </span>
            {user.username && <span className="au-username">@{user.username}</span>}
          </span>
          {blocked && (
            <span className="ui-status ui-status-danger">{t('account.statusBlocked')}</span>
          )}
        </header>

        <StatList
          stats={[
            { label: t('admin.userDetailTelegramId'), value: String(user.telegram_id) },
            {
              label: t('admin.userDetailJoinedAt'),
              value: new Date(user.joined_at).toLocaleDateString(i18n.language),
            },
            {
              label: t('admin.userDetailBalance'),
              value: t('wallet.tomanAmount', {
                amount: user.balance_toman.toLocaleString(i18n.language),
              }),
            },
            {
              label: t('admin.userDetailPending'),
              value: t('wallet.tomanAmount', {
                amount: user.pending_toman.toLocaleString(i18n.language),
              }),
            },
          ]}
        />

        <AdminSection title={t('admin.usersSectionOffers')} rows={offers} empty={t('offers.none')}>
          {(offers ?? []).map((offer) => (
            <div className="ui-row" key={offer.id}>
              <span className="ui-row-main">
                <span className="ui-row-title">{offer.title}</span>
                <span className="ui-row-subtitle">
                  {t('offers.priceLine', {
                    price: offer.price_stars,
                    minutes: offer.display_duration_minutes,
                  })}
                </span>
              </span>
              <span className="ui-row-trailing">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteTarget({ kind: 'offer', id: offer.id })}
                >
                  {t('common.delete')}
                </Button>
              </span>
            </div>
          ))}
        </AdminSection>

        <AdminSection
          title={t('admin.usersSectionContent')}
          rows={content}
          empty={t('profilePage.contentEmpty')}
        >
          {(content ?? []).map((item) => (
            <div className="ui-row" key={item.id}>
              <span className="ui-row-main">
                <span className="ui-row-title">{t(`content.type_${item.content_type}`)}</span>
                <span className="ui-row-subtitle">
                  {new Date(item.created_at).toLocaleDateString(i18n.language)}
                </span>
              </span>
              <span className="ui-row-trailing">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteTarget({ kind: 'content', id: item.id })}
                >
                  {t('common.delete')}
                </Button>
              </span>
            </div>
          ))}
        </AdminSection>

        <AdminSection
          title={t('admin.usersSectionRequests')}
          rows={requests}
          empty={t('activityPage.requestsEmpty')}
        >
          {(requests ?? []).map((request) => (
            <div className="ui-row" key={request.id}>
              <span className="ui-row-main">
                <span className="ui-row-title">{request.offer_title}</span>
                <span className="ui-row-subtitle">
                  {t(
                    request.direction === 'sent'
                      ? 'activityPage.sentTo'
                      : 'activityPage.receivedFrom',
                    { name: request.counterpart_display_name },
                  )}
                </span>
              </span>
              <span className="ui-row-trailing">
                <span className="ui-status ui-status-neutral">{request.status}</span>
              </span>
            </div>
          ))}
        </AdminSection>

        <AdminSection
          title={t('admin.usersSectionChatSessions')}
          rows={chatSessions}
          empty={t('chatsPage.activeEmpty')}
        >
          {(chatSessions ?? []).map((session) => (
            <div className="ui-row" key={session.id}>
              <span className="ui-row-main">
                <span className="ui-row-title">{session.offer_title}</span>
                <span className="ui-row-subtitle">{session.other_display_name}</span>
              </span>
              <span className="ui-row-trailing">
                <span
                  className={`ui-status ${
                    session.status === 'open' ? 'ui-status-success' : 'ui-status-neutral'
                  }`}
                >
                  {session.status === 'open'
                    ? t('chatSession.statusOpen')
                    : t('chatSession.statusClosed')}
                </span>
              </span>
            </div>
          ))}
        </AdminSection>

        <AdminSection
          title={t('admin.usersSectionTransactions')}
          rows={transactions}
          empty={t('topup.historyEmpty')}
        >
          {(transactions ?? []).map((tx) => (
            <div className="ui-row" key={tx.id}>
              <span className="ui-row-main">
                <span className="ui-row-title tabular">
                  {t('wallet.tomanAmount', {
                    amount: tx.gross_price_toman.toLocaleString(i18n.language),
                  })}
                </span>
                <span className="ui-row-subtitle">{tx.kind}</span>
              </span>
              <span className="ui-row-trailing">
                <span className="ui-status ui-status-neutral">{tx.status}</span>
              </span>
            </div>
          ))}
        </AdminSection>

        {/* Blocking is the heaviest thing on this page, so it sits at the
            bottom, past everything there is to read first — not at the
            top where a thumb lands while scrolling in. */}
        <section className="ui-section au-danger">
          <Button
            variant={blocked ? 'secondary' : 'danger'}
            size="md"
            block
            icon={blocked ? undefined : <IconBan size={18} />}
            onClick={() => setConfirmingStatusChange(true)}
          >
            {t(blocked ? 'admin.unblockButton' : 'admin.blockButton')}
          </Button>
        </section>
      </div>

      {confirmingStatusChange && (
        <ConfirmDialog
          title={t(blocked ? 'admin.unblockButton' : 'admin.blockButton')}
          text={t(blocked ? 'admin.unblockConfirmBody' : 'admin.blockConfirmBody')}
          confirmLabel={t(blocked ? 'admin.unblockButton' : 'admin.blockButton')}
          destructive={!blocked}
          loading={busy}
          onCancel={() => setConfirmingStatusChange(false)}
          onConfirm={confirmStatusChange}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t('common.delete')}
          text={t(
            deleteTarget.kind === 'offer'
              ? 'admin.deleteOfferConfirmBody'
              : 'admin.deleteContentConfirmBody',
          )}
          confirmLabel={t('common.delete')}
          destructive
          loading={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}

interface AdminSectionProps {
  title: string
  /** null while loading — a skeleton, not an empty list. */
  rows: unknown[] | null
  empty: string
  children: React.ReactNode
}

/**
 * One titled block of this page. Five of them, all the same shape, so
 * the page reads as one record rather than five different screens
 * stacked — which is what five differently-built cards would have been.
 */
function AdminSection({ title, rows, empty, children }: AdminSectionProps) {
  return (
    <section className="ui-section">
      <h2 className="ui-section-title">{title}</h2>
      {rows === null ? (
        <SkeletonRows count={2} />
      ) : rows.length === 0 ? (
        <p className="au-empty">{empty}</p>
      ) : (
        <div className="ui-list">{children}</div>
      )}
    </section>
  )
}
