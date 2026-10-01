import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Relation } from '../../lib/relations'
import { timeAgo } from '../../lib/timeAgo'
import { useHold } from '../../lib/useHold'
import { apiReason } from '../../lib/api'
import {
  clearConversationHistory,
  deleteConversation,
  fetchArchivedConversations,
  markRead,
  setConversationArchived,
  setConversationMuted,
  setConversationPinned,
  type Conversation,
} from '../../lib/conversationApi'
import { DeleteDialog } from './DeleteDialog'

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
 */

interface TalkListProps {
  relations: Relation[]
  loaded: boolean
  hasMore: boolean
  onNearEnd: () => void
  onOpen: (relation: Relation) => void
  /** Something was changed from the selection bar: read the list again. */
  onChanged?: () => void
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
}

/** A face colour that is always the same for the same person. */
const BODIES = [['#3e8f86', '#1c3f52'], ['#8a4f7d', '#2d1a3c'], ['#a8753a', '#3d2410'], ['#4f6fa8', '#1a2540'], ['#6f8f3e', '#243312'], ['#a84f4f', '#3c1a1a']]

/** Pinned first, the first pinned highest; then the newest. */
export function talkOrder<T extends { pinnedRank?: number | null; lastAt: string }>(rows: T[]): T[] {
  return [...rows].sort((x, y) => {
    const px = x.pinnedRank ?? null
    const py = y.pinnedRank ?? null
    if (px !== null || py !== null) {
      if (px === null) return 1
      if (py === null) return -1
      return px - py
    }
    return y.lastAt > x.lastAt ? 1 : y.lastAt < x.lastAt ? -1 : 0
  })
}

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
  }
}

export function TalkList({ relations, loaded, hasMore, onNearEnd, onOpen, onChanged }: TalkListProps) {
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

  const readArchive = useCallback(() => {
    fetchArchivedConversations()
      .then((list) => setArchive(list.map(fromConversation).filter((row): row is Row => row !== null)))
      .catch(() => {})
  }, [])
  useEffect(() => readArchive(), [readArchive])

  const threads = talkOrder(relations.filter((r) => r.conversationId !== null).map(fromRelation))
  const rows = inArchive ? talkOrder(archive ?? []) : threads
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

  return (
    <div className="cos-talklist" data-chrome>
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

      {inArchive ? (
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

      {loaded && rows.length === 0 && (
        <p className="cos-talklist-empty">{inArchive ? t('talkList.archiveEmpty') : t('talkList.empty')}</p>
      )}
      <ul className="cos-talklist-rows">
        {rows.map((row) => (
          <TalkRow
            key={row.conversationId}
            row={row}
            selecting={selecting}
            selected={selected.has(row.conversationId)}
            onOpen={() => {
              const relation = relations.find((r) => r.conversationId === row.conversationId)
              if (relation) onOpen(relation)
              else onOpen({ userId: row.userId } as Relation)
            }}
            onToggle={() => toggle(row.conversationId)}
          />
        ))}
      </ul>
      <div ref={endRef} className="cos-talklist-end" aria-hidden="true" />
    </div>
  )
}

/** One row: a tap opens the chat (or, while selecting, picks it); a hold
 *  picks it and starts selecting. */
function TalkRow({ row, selecting, selected, onOpen, onToggle }: {
  row: Row
  selecting: boolean
  selected: boolean
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
        className={`cos-talklist-row${row.unread ? ' is-unread' : ''}${row.muted ? ' is-muted' : ''}${selected ? ' is-selected' : ''}`}
        aria-pressed={selecting ? selected : undefined}
        {...hold}
      >
        {/* The tick sits beside the face, not inside it: the face clips to
            its circle, and a tick inside it was cut in half. */}
        <span className="cos-talklist-facewrap">
          <span className="cos-talklist-face" style={{ '--a': a, '--b': b } as React.CSSProperties}>
            {row.avatarUrl ? <img src={row.avatarUrl} alt="" draggable={false} /> : row.name.slice(0, 1)}
          </span>
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
          <span className="cos-talklist-origin">{t(`talkList.from.${row.origin}`)}</span>
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
