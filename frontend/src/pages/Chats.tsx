import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiFetch, formatApiError } from '../lib/api'
import {
  PageHeader,
  EmptyState,
  ErrorState,
  Segments,
  SkeletonRows,
  useToast,
} from '../components/ui'
import { Sheet } from '../components/ui/Sheet'
import { DropAmount } from '../components/ui/Drop'
import { IconChat, IconMore, IconPersonFallback } from '../components/icons'
import type { ChatSession } from '../lib/types'

type Segment = 'active' | 'archived'

/**
 * The Chats tab: every chat session the user is part of, as buyer or as
 * provider — GET /chat-sessions/mine returns both directions at once.
 *
 * Archiving is per-viewer and reversible: it takes a session out of YOUR
 * main list and does nothing to the other person's view of it, and
 * nothing to the session itself.
 */
export default function Chats() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()

  const [segment, setSegment] = useState<Segment>('active')
  const [sessions, setSessions] = useState<ChatSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [managing, setManaging] = useState<ChatSession | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    setError(null)
    apiFetch<ChatSession[]>('/chat-sessions/mine')
      .then(setSessions)
      .catch((err) => setError(formatApiError(err)))
  }, [])

  useEffect(load, [load])

  async function toggleArchive(session: ChatSession) {
    setBusyId(session.id)
    try {
      await apiFetch(`/chat-sessions/${session.id}/${session.archived ? 'unarchive' : 'archive'}`, {
        method: 'POST',
      })
      load()
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      setBusyId(null)
    }
  }

  const shown = (sessions ?? [])
    .filter((s) => (segment === 'archived' ? s.archived : !s.archived))
    // Newest first — a chat you opened today is the one you are looking
    // for, not the one from three weeks ago.
    .sort((a, b) => (a.opened_at < b.opened_at ? 1 : -1))

  const activeCount = (sessions ?? []).filter((s) => !s.archived && s.status === 'open').length

  return (
    <div className="ui-page">
      <PageHeader title={t('tabs.chats')} />

      <div className="ui-page-body">
        <Segments
          label={t('tabs.chats')}
          value={segment}
          onChange={setSegment}
          options={[
            { id: 'active', label: t('chatsPage.activeTab'), count: activeCount },
            { id: 'archived', label: t('chatsPage.archivedTab') },
          ]}
        />

        {error ? (
          <ErrorState text={error} onRetry={load} />
        ) : sessions === null ? (
          <SkeletonRows count={4} />
        ) : shown.length === 0 ? (
          segment === 'active' ? (
            <EmptyState
              icon={<IconChat size={24} />}
              title={t('chatsPage.activeEmpty')}
              text={t('chatsPage.activeEmptyHint')}
              actionLabel={t('activityPage.browseShowcase')}
              onAction={() => navigate('/offers')}
            />
          ) : (
            <EmptyState
              icon={<IconChat size={24} />}
              title={t('chatsPage.archivedEmpty')}
              text={t('chatsPage.archivedEmptyHint')}
            />
          )
        ) : (
          <div className="ui-list">
            {shown.map((session) => (
              <div className="ch-row" key={session.id}>
                <button
                  type="button"
                  className="ui-row ui-row-avatar ch-row-main"
                  onClick={() => navigate(`/chat-sessions/${session.id}`)}
                >
                  <span className="ui-row-media ch-avatar">
                    {session.other_participant.avatar_url ? (
                      <img src={session.other_participant.avatar_url} alt="" />
                    ) : (
                      <IconPersonFallback size={22} />
                    )}
                  </span>

                  <span className="ui-row-main">
                    <span className="ui-row-title" dir="auto">
                      {session.other_participant.display_name}
                    </span>
                    {/* The offer is what this conversation is FOR, so it
                        is the subtitle. Which side you are on is a chip
                        rather than a third clause in a run-on line. */}
                    <span className="ui-row-subtitle ch-offer">
                      <span className="ch-offer-title" dir="auto">
                        {session.offer_title}
                      </span>
                      <DropAmount amount={session.price_stars} locale={i18n.language} size={16} />
                    </span>
                  </span>

                  <span className="ui-row-trailing ch-trailing">
                    {session.disputed ? (
                      <span className="ui-status ui-status-warning">
                        {t('chatSession.statusDisputed')}
                      </span>
                    ) : session.status === 'open' ? (
                      <span className="ui-status ui-status-success">
                        {t('chatSession.statusOpen')}
                      </span>
                    ) : (
                      <span className="ui-status ui-status-neutral">
                        {t('chatSession.statusClosed')}
                      </span>
                    )}
                    <span className="ch-role">
                      {session.my_role === 'buyer'
                        ? t('chatsPage.roleBuyer')
                        : t('chatsPage.roleProvider')}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  className="ui-btn ui-btn-icon ch-manage"
                  onClick={() => setManaging(session)}
                  aria-label={t('chatsPage.manageChat')}
                >
                  <IconMore size={20} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {managing && (
        <Sheet
          title={managing.other_participant.display_name}
          onClose={() => setManaging(null)}
        >
          <div className="ui-list">
            <button
              className="ui-row"
              onClick={() => {
                toggleArchive(managing)
                setManaging(null)
              }}
              disabled={busyId === managing.id}
            >
              <span className="ui-row-main">
                <span className="ui-row-title">
                  {managing.archived
                    ? t('chatsPage.unarchiveButton')
                    : t('chatsPage.archiveButton')}
                </span>
                {/* Archiving reads as deleting unless the row says
                    otherwise — and it is neither destructive nor visible
                    to the other person. */}
                <span className="ui-row-subtitle">
                  {managing.archived
                    ? t('chatsPage.unarchiveHint')
                    : t('chatsPage.archiveHint')}
                </span>
              </span>
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}
