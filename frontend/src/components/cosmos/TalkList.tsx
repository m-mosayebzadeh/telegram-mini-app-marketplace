import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Relation } from '../../lib/relations'
import { timeAgo } from '../../lib/timeAgo'

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
 * unread, and how you met. Only real threads are listed — people with a
 * request but no conversation belong to the paid layer, which is not part
 * of this version. The newest arrive fifteen at a time, the next page
 * asked for as the end of the list comes into view.
 */

interface TalkListProps {
  relations: Relation[]
  loaded: boolean
  hasMore: boolean
  onNearEnd: () => void
  onOpen: (relation: Relation) => void
}

/** A face colour that is always the same for the same person. */
const BODIES = [['#3e8f86', '#1c3f52'], ['#8a4f7d', '#2d1a3c'], ['#a8753a', '#3d2410'], ['#4f6fa8', '#1a2540'], ['#6f8f3e', '#243312'], ['#a84f4f', '#3c1a1a']]

export function TalkList({ relations, loaded, hasMore, onNearEnd, onOpen }: TalkListProps) {
  const { t, i18n } = useTranslation()
  const endRef = useRef<HTMLDivElement>(null)
  // Something unread first, then the newest. Nothing from the paid layer
  // decides the order any more — it is not part of this version.
  const threads = relations
    .filter((r) => r.conversationId !== null)
    .sort((x, y) => Number(y.unread) - Number(x.unread) || (y.lastAt > x.lastAt ? 1 : y.lastAt < x.lastAt ? -1 : 0))

  // The next page when the end of the list comes near. Where the browser
  // cannot watch for that, the list simply stays at what it has.
  useEffect(() => {
    const end = endRef.current
    if (!end || !hasMore || typeof IntersectionObserver === 'undefined') return
    const watcher = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onNearEnd()
    }, { rootMargin: '200px' })
    watcher.observe(end)
    return () => watcher.disconnect()
  }, [hasMore, onNearEnd, threads.length])

  return (
    <div className="cos-talklist" data-chrome>
      {loaded && threads.length === 0 && <p className="cos-talklist-empty">{t('talkList.empty')}</p>}
      <ul className="cos-talklist-rows">
        {threads.map((r) => {
          const [a, b] = BODIES[r.userId % BODIES.length]
          return (
            <li key={r.userId}>
              <button type="button" className={`cos-talklist-row${r.unread ? ' is-unread' : ''}`} onClick={() => onOpen(r)}>
                <span className="cos-talklist-face" style={{ '--a': a, '--b': b } as React.CSSProperties}>
                  {r.avatarUrl ? <img src={r.avatarUrl} alt="" draggable={false} /> : r.name.slice(0, 1)}
                </span>
                <span className="cos-talklist-text">
                  <b>{r.name}</b>
                  <span className="cos-talklist-last">{r.lastText ?? t('talkList.noPreview')}</span>
                  <span className="cos-talklist-origin">{t(`talkList.from.${r.origin}`)}</span>
                </span>
                <span className="cos-talklist-meta">
                  <i>{r.lastAt ? timeAgo(r.lastAt, i18n.language) : ''}</i>
                  {r.unread && (
                    <span className="cos-talklist-count" aria-label={t('world.unread', { count: r.unreadCount })}>
                      {r.unreadCount.toLocaleString(i18n.language)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div ref={endRef} className="cos-talklist-end" aria-hidden="true" />
    </div>
  )
}
