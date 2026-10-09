import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TeamMark } from './TeamMark'
import { useTranslation } from 'react-i18next'
import { useMe } from '../../lib/MeContext'
import { subscribe } from '../../lib/live'
import type { Relation } from '../../lib/relations'
import { timeAgo } from '../../lib/timeAgo'
import { useHold } from '../../lib/useHold'
import { apiReason } from '../../lib/api'
import {
  clearConversationHistory,
  deleteConversation,
  fetchArchivedConversations,
  fetchSupportConversations,
  fetchSupportUnread,
  markRead,
  setConversationArchived,
  setConversationMuted,
  setConversationPinned,
  type Conversation,
} from '../../lib/conversationApi'
import { DeleteDialog } from './DeleteDialog'
import { talkOrder } from './talkOrder'

/**
 * Your conversations, as an ordinary list (TECHNICAL_REQUIREMENTS.md
 * section 32, step 2).
 *
 * It replaces the stair of conversations: the stair was beautiful, and one
 * more way of working to learn before you could find somebody you were
 * talking to. A list everybody already knows how to read, under the
 * conversations region's own sky.
 *
 * Each row: their face, their name, the last thing said, when, how many
 * unread, and how you met. Ordered by date — never unread first, because
 * somebody may not want to look at one message for days — with the pinned
 * ones above, the first pinned highest (the owner's rules).
 *
 * Holding a row selects it, as in Telegram, and a bar of what can be done
 * to all of them comes up at the top: pin, mute, delete, and under the
 * three dots archive, mark as read and clear the history. Deleting and
 * clearing here are for you alone; "for them too" is only offered inside
 * one chat, where it is plain whose chat it is.
 *
 * Staff who answer for Cosmos Team (section 43) get two tabs at the top:
 * their own conversations, and "support" — the conversations people have
 * with the team, in exactly the same rows, opened in the same screen.
 */

/** Which tab, remembered for the visit so coming back from a support chat
 *  lands on support again. */
const SECTION_KEY = 'cosmos.talk.section'
function rememberedSection(): 'mine' | 'support' {
  try {
    return sessionStorage.getItem(SECTION_KEY) === 'support' ? 'support' : 'mine'
  } catch {
    return 'mine'
  }
}

interface TalkListProps {
  relations: Relation[]
  loaded: boolean
  hasMore: boolean
  onNearEnd: () => void
  onOpen: (relation: Relation) => void
  /** Opens one of the team's conversations by its id (support, section 43). */
  onOpenSupport?: (conversationId: number) => void
  /** Something was changed from the selection bar: read the list again. */
  onChanged?: () => void
  /** On a computer, the conversation open beside the list (TalkColumn). */
  current?: { conversationId?: number; userId?: number }
  /** How many of your own conversations have something new, over all of
   *  them (from the server): the number on the "conversations" tab. */
  mineUnread?: number
  /** Which tab is open and what is in it, for the line under the
   *  region's name: it speaks of the tab in view, not of both at once. */
  onSummary?: (summary: { tab: 'mine' | 'support'; count: number; unread: number } | null) => void
}

/** One row, whichever list it is in (the conversations or the archive). */
interface Row {
  conversationId: number
  userId: number
  name: string
  avatarUrl: string | null
  lastText: string | null
  lastAt: string
  unread: boolean
  unreadCount: number
  origin: 'world' | 'echo'
  muted: boolean
  pinnedRank: number | null
  team: boolean
}

/** A face colour that is always the same for the same person. */
const BODIES = [['#3e8f86', '#1c3f52'], ['#8a4f7d', '#2d1a3c'], ['#a8753a', '#3d2410'], ['#4f6fa8', '#1a2540'], ['#6f8f3e', '#243312'], ['#a84f4f', '#3c1a1a']]

function fromRelation(r: Relation): Row {
  return {
    conversationId: r.conversationId as number,
    userId: r.userId,
    name: r.name,
    avatarUrl: r.avatarUrl,
    lastText: r.lastText,
    lastAt: r.lastAt,
    unread: r.unread,
    unreadCount: r.unreadCount,
    origin: r.origin,
    muted: r.muted ?? false,
    pinnedRank: r.pinnedRank ?? null,
    team: r.team ?? false,
  }
}

function fromConversation(c: Conversation): Row | null {
  const other = c.others[0]
  if (c.kind !== 'direct' || !other) return null
  return {
    conversationId: c.id,
    userId: other.user_id,
    name: other.display_name,
    avatarUrl: other.avatar_url,
    lastText: c.last_text,
    lastAt: c.last_message_at ?? c.created_at,
    unread: c.unread,
    unreadCount: c.unread ? Math.max(1, c.unread_count ?? 1) : 0,
    origin: c.origin === 'echo' ? 'echo' : 'world',
    muted: c.muted ?? false,
    pinnedRank: null,
    team: other.team ?? false,
  }
}

export function TalkList({ relations, loaded, hasMore, onNearEnd, onOpen, onOpenSupport, onChanged, current, mineUnread = 0, onSummary }: TalkListProps) {
  const { t, i18n } = useTranslation()
  const n = (value: number) => value.toLocaleString(i18n.language)
  const endRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [more, setMore] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'clear' | null>(null)
  const [notice, setNotice] = useState('')
  /** The archive: shown instead of the list while open. */
  const [archive, setArchive] = useState<Row[] | null>(null)
  const [inArchive, setInArchive] = useState(false)

  const { adminAccess } = useMe()
  const canSupport = !!adminAccess && (adminAccess.is_owner || adminAccess.scopes.includes('support.conversations'))
  const [section, setSection] = useState<'mine' | 'support'>(rememberedSection)
  const inSupport = canSupport && section === 'support'
  const [supportRows, setSupportRows] = useState<Row[] | null>(null)
  const [supportWaiting, setSupportWaiting] = useState(0)

  function choose(next: 'mine' | 'support') {
    setSection(next)
    setSelected(new Set())
    setInArchive(false)
    try {
      sessionStorage.setItem(SECTION_KEY, next)
    } catch {
      /* private window: the tab is simply not remembered */
    }
  }

  // The support list and its number, read again whenever a team
  // conversation moves (the server sends staff those events) — never on
  // a clock.
  const readSupport = useCallback(() => {
    if (!canSupport) return
    fetchSupportUnread().then(setSupportWaiting).catch(() => {})
    fetchSupportConversations({ limit: 50 })
      .then((list) => setSupportRows(list.map(fromConversation).filter((row): row is Row => row !== null)))
      .catch(() => {})
  }, [canSupport])
  useEffect(() => {
    if (!canSupport) return
    readSupport()
    return subscribe((event) => {
      if (event.type === 'message' || event.type === 'read') readSupport()
    })
  }, [canSupport, readSupport])

  const readArchive = useCallback(() => {
    fetchArchivedConversations()
      .then((list) => setArchive(list.map(fromConversation).filter((row): row is Row => row !== null)))
      .catch(() => {})
  }, [])
  useEffect(() => readArchive(), [readArchive])

  const threads = talkOrder(relations.filter((r) => r.conversationId !== null).map(fromRelation))
  const rows = inSupport ? (supportRows ?? []) : inArchive ? talkOrder(archive ?? []) : threads

  // The line under the region's name follows the tab in view. Nothing is
  // said while on your own conversations: the region already says that.
  useEffect(() => {
    onSummary?.(inSupport ? { tab: 'support', count: supportRows?.length ?? 0, unread: supportWaiting } : null)
  }, [inSupport, supportRows, supportWaiting, onSummary])
  const selecting = selected.size > 0
  const chosen = rows.filter((row) => selected.has(row.conversationId))

  // The next page when the end of the list comes near. Where the browser
  // cannot watch for that, the list simply stays at what it has.
  useEffect(() => {
    const end = endRef.current
    if (!end || !hasMore || inArchive || typeof IntersectionObserver === 'undefined') return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onNearEnd()
    }, { rootMargin: '200px' })
    watcher.observe(end)
    return () => watcher.disconnect()
  }, [hasMore, onNearEnd, threads.length, inArchive])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3200)
    return () => window.clearTimeout(timer)
  }, [notice])

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Do something to every chosen chat, then read the lists again. */
  async function each(work: (row: Row) => Promise<unknown>) {
    const rowsNow = chosen
    setSelected(new Set())
    setMore(false)
    for (const row of rowsNow) {
      try {
        await work(row)
      } catch (err) {
        if (apiReason(err) === 'pin_limit') setNotice(t('talkList.select.pinLimit', { n: n(5) }))
      }
    }
    onChanged?.()
    readArchive()
  }

  const allPinned = chosen.length > 0 && chosen.every((row) => row.pinnedRank !== null)
  const allMuted = chosen.length > 0 && chosen.every((row) => row.muted)

  // The selection bar, its menu, the dialog and the notice are put on the
  // page itself, not inside the list: the list fades out at its top and
  // foot (so rows slip softly under the title and the doors), and that
  // fade swallowed the bar whole — it sits exactly where the fade is.
  //
  // `data-chrome` keeps them part of the interface: the world takes hold of
  // any touch that is not inside one (to drag the sky), and outside the
  // list they had lost that mark — every tap on the bar went to the world.
  const overlays = (
    <div className="cos-talklist-overlays" data-chrome>
      {selecting && (
        <div className="cos-talklist-select" role="toolbar" aria-label={t('talkList.select.count', { n: n(selected.size) })}>
          <button type="button" className="cos-talk-tool" aria-label={t('talkList.select.cancel')} onClick={() => setSelected(new Set())}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
          </button>
          <span className="cos-select-count">{n(selected.size)}</span>
          <span className="cos-select-actions">
            {!inArchive && (
              <button
                type="button"
                className="cos-talk-tool"
                aria-label={allPinned ? t('talkList.select.unpin') : t('talkList.select.pin')}
                onClick={() => void each((row) => (allPinned ? setConversationPinned(row.conversationId, false) : row.pinnedRank === null ? setConversationPinned(row.conversationId, true) : Promise.resolve()))}
              >
                <PinIcon off={allPinned} />
              </button>
            )}
            <button
              type="button"
              className="cos-talk-tool"
              aria-label={allMuted ? t('talkList.select.unmute') : t('talkList.select.mute')}
              onClick={() => void each((row) => setConversationMuted(row.conversationId, !allMuted))}
            >
              <MuteIcon off={allMuted} />
            </button>
            <button type="button" className="cos-talk-tool is-danger" aria-label={t('talkList.select.delete')} onClick={() => setConfirm('delete')}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10.2 10.5v5.5M13.8 10.5v5.5" /></svg>
            </button>
            <button type="button" className="cos-talk-tool" aria-label={t('talkList.select.more')} aria-haspopup="menu" onClick={() => setMore(true)}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><circle cx="12" cy="5.5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="18.5" r="1.7" /></svg>
            </button>
          </span>
        </div>
      )}

      {more && (
        <div className="cos-chatmenu-scrim" onClick={() => setMore(false)} role="presentation">
          <div className="cos-chatmenu" role="menu" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              role="menuitem"
              className="cos-chatmenu-item"
              onClick={() => void each((row) => setConversationArchived(row.conversationId, !inArchive))}
            >
              <ArchiveIcon />
              <span>{inArchive ? t('talkList.select.unarchive') : t('talkList.select.archive')}</span>
            </button>
            <button type="button" role="menuitem" className="cos-chatmenu-item" onClick={() => void each((row) => markRead(row.conversationId))}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 12.5 4 4 8-9M12.5 16.5l8-9" /></svg>
              <span>{t('talkList.select.read')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="cos-chatmenu-item"
              onClick={() => {
                setMore(false)
                setConfirm('clear')
              }}
            >
              <ClearIcon />
              <span>{t('talkList.select.clear')}</span>
            </button>
          </div>
        </div>
      )}

      {confirm && (
        // For you alone: nothing to tick here.
        <DeleteDialog
          count={chosen.length}
          alsoFor={null}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const action = confirm
            setConfirm(null)
            void each((row) =>
              action === 'delete' ? deleteConversation(row.conversationId, false) : clearConversationHistory(row.conversationId, false),
            )
          }}
          words={{
            title: t(confirm === 'delete' ? 'talkList.deleteMany.title' : 'talkList.clearMany.title', { n: n(chosen.length) }),
            sure: t(confirm === 'delete' ? 'talkList.deleteMany.sure' : 'talkList.clearMany.sure'),
            alsoFor: '',
            confirm: t(confirm === 'delete' ? 'talkList.deleteMany.confirm' : 'talkList.clearMany.confirm'),
          }}
        />
      )}

      {notice && <p className="cos-talklist-notice" role="status">{notice}</p>}
    </div>
  )

  return (
    <div className="cos-talklist" data-chrome>
      {typeof document === 'undefined' ? overlays : createPortal(overlays, document.body)}

      {canSupport && !selecting && !inArchive && (
        <div className="cos-talklist-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!inSupport} className="cos-talklist-tab" onClick={() => choose('mine')}>
            {t('support.tabMine')}
            {mineUnread > 0 && <i>{n(mineUnread)}</i>}
          </button>
          <button type="button" role="tab" aria-selected={inSupport} className="cos-talklist-tab" onClick={() => choose('support')}>
            {t('support.tab')}
            {supportWaiting > 0 && <i>{n(supportWaiting)}</i>}
          </button>
        </div>
      )}

      {inSupport ? null : inArchive ? (
        <button type="button" className="cos-talklist-archive" onClick={() => { setInArchive(false); setSelected(new Set()) }}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5 8 12l7 7" /></svg>
          <span>{t('talkList.archiveBack')}</span>
        </button>
      ) : (
        archive && archive.length > 0 && (
          // The archive, at the top of the list as in Telegram — there only
          // when something is in it.
          <button type="button" className="cos-talklist-archive" onClick={() => { setInArchive(true); setSelected(new Set()) }}>
            <ArchiveIcon />
            <span>{t('talkList.archive')}</span>
            <i>{n(archive.length)}</i>
          </button>
        )
      )}

      {(inSupport ? supportRows !== null : loaded) && rows.length === 0 && (
        <p className="cos-talklist-empty">
          {inSupport ? t('support.empty') : inArchive ? t('talkList.archiveEmpty') : t('talkList.empty')}
        </p>
      )}
      <ul className="cos-talklist-rows">
        {rows.map((row) => (
          <TalkRow
            key={row.conversationId}
            row={row}
            selecting={selecting}
            selected={selected.has(row.conversationId)}
            open={!!current && (current.conversationId === row.conversationId || (!inSupport && current.userId === row.userId))}
            onOpen={() => {
              // A support chat is the team's, opened by its own id: opening
              // "the conversation with this person" would open the staff
              // member's own one instead.
              if (inSupport) {
                onOpenSupport?.(row.conversationId)
                return
              }
              const relation = relations.find((r) => r.conversationId === row.conversationId)
              if (relation) onOpen(relation)
              else onOpen({ userId: row.userId } as Relation)
            }}
            // Nothing to select in support: pinning, muting and deleting
            // are the team's own view, not one staff member's.
            onToggle={() => {
              if (!inSupport) toggle(row.conversationId)
            }}
          />
        ))}
      </ul>
      <div ref={endRef} className="cos-talklist-end" aria-hidden="true" />
    </div>
  )
}

/** One row: a tap opens the chat (or, while selecting, picks it); a hold
 *  picks it and starts selecting. */
function TalkRow({ row, selecting, selected, open, onOpen, onToggle }: {
  row: Row
  selecting: boolean
  selected: boolean
  /** Open beside the list, on a computer. */
  open?: boolean
  onOpen: () => void
  onToggle: () => void
}) {
  const { t, i18n } = useTranslation()
  const hold = useHold({
    onTap: () => (selecting ? onToggle() : onOpen()),
    onHold: onToggle,
    onSecondary: onToggle,
  })
  const [a, b] = BODIES[row.userId % BODIES.length]
  return (
    <li>
      <button
        type="button"
        className={`cos-talklist-row${row.unread ? ' is-unread' : ''}${row.muted ? ' is-muted' : ''}${selected ? ' is-selected' : ''}${open ? ' is-open' : ''}`}
        aria-pressed={selecting ? selected : undefined}
        aria-current={open ? 'page' : undefined}
        {...hold}
      >
        {/* The tick sits beside the face, not inside it: the face clips to
            its circle, and a tick inside it was cut in half. */}
        <span className="cos-talklist-facewrap">
          {row.team ? (
            <TeamMark className="cos-talklist-face" />
          ) : (
            <span className="cos-talklist-face" style={{ '--a': a, '--b': b } as React.CSSProperties}>
              {row.avatarUrl ? <img src={row.avatarUrl} alt="" draggable={false} /> : row.name.slice(0, 1)}
            </span>
          )}
          {selected && <span className="cos-talklist-check" aria-hidden="true" />}
        </span>
        <span className="cos-talklist-text">
          <b>
            {row.name}
            {row.muted && (
              <svg className="cos-talklist-muted" viewBox="0 0 24 24" aria-label={t('talk.menu.mutedLabel')} role="img">
                <path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" fill="currentColor" />
                <path d="m15.5 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            )}
          </b>
          <span className="cos-talklist-last">{row.lastText ?? t('talkList.noPreview')}</span>
          <span className="cos-talklist-origin">{row.team ? t('team.line') : t(`talkList.from.${row.origin}`)}</span>
        </span>
        <span className="cos-talklist-meta">
          <i>{row.lastAt ? timeAgo(row.lastAt, i18n.language) : ''}</i>
          {row.unread ? (
            <span className="cos-talklist-count" aria-label={t('world.unread', { count: row.unreadCount })}>
              {row.unreadCount.toLocaleString(i18n.language)}
            </span>
          ) : (
            row.pinnedRank !== null && (
              <span className="cos-talklist-pin" role="img" aria-label={t('talkList.pinned')}>
                <PinIcon />
              </span>
            )
          )}
        </span>
      </button>
    </li>
  )
}

function PinIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 3.5 20.5 9.5l-3 1-3.5 3.5-.5 4.5-9-9 4.5-.5L12.5 6.5z" />
      <path d="m8 16-4.5 4.5" />
      {off && <path d="M3.5 3.5l17 17" />}
    </svg>
  )
}

function MuteIcon({ off }: { off?: boolean }) {
  // What pressing it will do: a speaker with sound to unmute, crossed out
  // to mute.
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6.5 9H3.5v6h3L11 19V5Z" />
      {off ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="m15.5 9.5 5 5m0-5-5 5" />}
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V8.5M12 11.5v5M9.5 14l2.5 2.5 2.5-2.5" />
    </svg>
  )
}

/** Clearing the history: a message bubble being wiped empty. */
export function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4.5 19.5l1.4-4A7.5 7.5 0 1 1 20 11.5z" />
      <path d="M9.5 11.5h5" />
    </svg>
  )
}
