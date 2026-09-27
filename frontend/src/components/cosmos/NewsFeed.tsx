import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ANSWERABLE, type NewsItem } from '../../lib/news'
import { timeAgo } from '../../lib/timeAgo'
import { THANKS_IMAGE, type Thanks } from '../../lib/worldApi'

/**
 * The news region (TECHNICAL_REQUIREMENTS.md sections 30.6 and 30.19–30.23).
 *
 * News arrives out of a wormhole at the top and hangs from a line of light
 * that runs down to a black hole. Every item is a pointer to something real
 * (lib/news.ts), so swiping one aside removes only the pointer.
 *
 * Two kinds can be answered right here: somebody accepted your offer
 * (confirm or refuse) and somebody wants to follow you (accept or refuse).
 * An answer is not sent at once. For a few seconds the card says what you
 * chose and offers to take it back; only when that time runs out does the
 * answer reach the server. Changing your mind therefore costs nobody
 * anything — the other person never sees an answer you took back.
 *
 * This is the lighter first build of the region. The richer motion from the
 * prototype (cards turning over, burning, flying to Sol) is listed as still
 * to come in section 31.
 */

interface NewsFeedProps {
  items: NewsItem[]
  loaded: boolean
  onDismiss: (key: string) => void
  /** Send an answer once its take-back time has run out. */
  onAnswer: (item: NewsItem, yes: boolean) => Promise<void>
  /** Go where the item points (the profile, for a follow request's third button). */
  onOpen: (item: NewsItem, where?: 'profile') => void
}

/** How long an answer can still be taken back. */
export const TAKE_BACK_MS = 4000
/** A sideways movement past this throws the item into the black hole. */
const THROW_PX = 88
/** Smaller movements than this are still a tap. */
const SLOP = 9

export function NewsFeed({ items, loaded, onDismiss, onAnswer, onOpen }: NewsFeedProps) {
  const { t } = useTranslation()
  return (
    <div className="cos-feed" data-chrome>
      <span className="cos-feed-hole is-top" aria-hidden="true" />
      <span className="cos-feed-line" aria-hidden="true" />
      <span className="cos-feed-hole is-bottom" aria-hidden="true" />
      <div className="cos-feed-list">
        {loaded && items.length === 0 && <p className="cos-feed-empty">{t('news.empty')}</p>}
        {items.map((item, k) => (
          <NewsCard key={item.key} item={item} order={k} onDismiss={onDismiss} onAnswer={onAnswer} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

interface NewsCardProps extends Omit<NewsFeedProps, 'items' | 'loaded'> {
  item: NewsItem
  order: number
}

type Pending = { yes: boolean; timer: number }

function NewsCard({ item, order, onDismiss, onAnswer, onOpen }: NewsCardProps) {
  const { t, i18n } = useTranslation()
  const [dx, setDx] = useState(0)
  const [gone, setGone] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [failed, setFailed] = useState(false)
  const press = useRef<{ x: number; y: number; sideways: boolean | null } | null>(null)
  const answerable = ANSWERABLE.includes(item.kind)

  // An answer still waiting to be sent is dropped if the card goes away
  // (the region was left): sending something the person could no longer
  // see or take back would break the promise the card made.
  useEffect(() => () => { if (pending) clearTimeout(pending.timer) }, [pending])

  function throwAway() {
    setGone(true)
    navigator.vibrate?.([6, 30, 18])
    window.setTimeout(() => onDismiss(item.key), 420)
  }

  function answer(yes: boolean) {
    setFailed(false)
    navigator.vibrate?.(10)
    const timer = window.setTimeout(() => {
      setPending(null)
      onAnswer(item, yes).then(
        () => { setGone(true); window.setTimeout(() => onDismiss(item.key), 420) },
        () => setFailed(true),
      )
    }, TAKE_BACK_MS)
    setPending({ yes, timer })
  }

  function takeBack() {
    if (!pending) return
    clearTimeout(pending.timer)
    setPending(null)
    navigator.vibrate?.([6, 30, 6])
  }

  // Sideways drags are handled here; vertical ones are left to the list's
  // own scrolling, which is why the card declares touch-action: pan-y.
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || pending) return
    press.current = { x: e.clientX, y: e.clientY, sideways: null }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current
    if (!p) return
    const mx = e.clientX - p.x
    const my = e.clientY - p.y
    if (p.sideways === null && Math.abs(mx) + Math.abs(my) > SLOP) {
      p.sideways = Math.abs(mx) > Math.abs(my)
      if (p.sideways) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    }
    if (p.sideways) setDx(mx)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.sideways) {
      if (Math.abs(e.clientX - p.x) > THROW_PX) throwAway()
      else setDx(0)
      return
    }
    // A tap on an item that cannot be answered here goes where it points.
    if (p.sideways === null && !answerable) onOpen(item)
  }

  const v = { name: item.name, offer: item.offerTitle ?? '', photons: item.photons ?? 0 }
  const title = t(`news.${item.kind}.title`, v)
  const body = item.kind === 'message' ? item.text ?? '' : t(`news.${item.kind}.body`, v)
  const picture =
    item.kind === 'thanks' && item.reaction && item.reaction in THANKS_IMAGE
      ? THANKS_IMAGE[item.reaction as Thanks]
      : item.avatarUrl

  const style = {
    '--cos-feed-dx': `${dx}px`,
    '--cos-feed-delay': `${Math.min(order, 8) * 60}ms`,
    opacity: dx ? Math.max(0.3, 1 - Math.abs(dx) / 260) : undefined,
  } as React.CSSProperties

  return (
    <article
      className={`cos-feed-card${answerable ? ' is-answerable' : ''}${dx ? ' is-held' : ''}${gone ? ' is-gone' : ''}${pending ? ' is-pending' : ''}`}
      style={style}
      aria-label={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { press.current = null; setDx(0) }}
    >
      <div className="cos-feed-main">
        <span className="cos-feed-face">
          {picture ? <img src={picture} alt="" draggable={false} /> : <span>{item.name.slice(0, 1)}</span>}
        </span>
        <span className="cos-feed-text">
          <b>{title}</b>
          {body && <span>{body}</span>}
        </span>
        <span className="cos-feed-when">{timeAgo(item.at, i18n.language)}</span>
      </div>

      {answerable && !pending && (
        <div className="cos-feed-actions">
          <button type="button" className="cos-feed-act is-yes" onClick={() => answer(true)}>
            {t(item.kind === 'follow' ? 'news.accept' : 'news.confirm.yes')}
          </button>
          <button type="button" className="cos-feed-act" onClick={() => answer(false)}>
            {t('news.refuse')}
          </button>
          <button
            type="button"
            className="cos-feed-act is-quiet"
            onClick={() => onOpen(item, item.kind === 'follow' ? 'profile' : undefined)}
          >
            {t(item.kind === 'follow' ? 'news.profile' : 'news.talk')}
          </button>
        </div>
      )}

      {pending && (
        <div className="cos-feed-actions is-pending" role="status">
          <span className={`cos-feed-chosen${pending.yes ? ' is-yes' : ''}`}>
            {t(pending.yes ? 'news.doneYes' : 'news.doneNo')}
          </span>
          <button type="button" className="cos-feed-act is-undo" onClick={takeBack}>
            {t('news.undo')}
          </button>
          <span className="cos-feed-timer" style={{ animationDuration: `${TAKE_BACK_MS}ms` }} aria-hidden="true" />
        </div>
      )}

      {failed && <p className="cos-feed-failed" role="alert">{t('news.failed')}</p>}
    </article>
  )
}
