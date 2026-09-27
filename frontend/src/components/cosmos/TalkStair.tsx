import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NEEDS_YOU, PENDING, WAITS_ON_THEM, minutesLeft, type Relation } from '../../lib/relations'
import { timeAgo } from '../../lib/timeAgo'
import { SessionClock } from './SessionClock'

/**
 * Conversations, by gravity (TECHNICAL_REQUIREMENTS.md sections 30.8 and
 * 30.11).
 *
 * Not a separate place and not a list: the real people you deal with are
 * pulled out of the world towards you and settle on a stair that runs back
 * into the sky — the most urgent nearest your thumb, older ones smaller and
 * further away. Each one leaves its own body in the world as it flies, so
 * nobody is ever in two places at once (the orb principle), and the card
 * around them forms only once they arrive.
 */

interface TalkStairProps {
  relations: Relation[]
  loaded: boolean
  /** Where this person's body is on screen right now, if they are in the
   *  sky — the point they fly out from and back to. */
  originOf: (userId: number) => { x: number; y: number } | null
  /** Flying home: the stair is being left. */
  leaving: boolean
  onOpen: (relation: Relation) => void
}

type Filter = 'all' | 'wait'

/** A movement bigger than this is a scroll along the stair, not a tap. */
const SLOP = 9
/** How much smaller and closer each step back is. */
const DEPTH = 0.83
const ROW_H = 70

export function TalkStair({ relations, loaded, originOf, leaving, onOpen }: TalkStairProps) {
  const { t, i18n } = useTranslation()
  const [filter, setFilter] = useState<Filter>('all')
  const [scroll, setScroll] = useState(0)
  const [dragging, setDragging] = useState(false)
  /** Who has arrived — their card forms only then. */
  const [arrived, setArrived] = useState<ReadonlySet<number>>(new Set())
  /** Who has left their place in the world and is in the air or here. */
  const [launched, setLaunched] = useState<ReadonlySet<number>>(new Set())
  const drag = useRef<{ y0: number; s0: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  const shown = useMemo(
    () => (filter === 'all' ? relations : relations.filter((r) => PENDING.includes(r.stage))),
    [relations, filter],
  )

  // Each person takes off in turn and forms their card on arrival — with
  // the approved prototype's timing: the k-th leaves 60 + 60k ms in, and
  // its card forms 620 ms after it leaves. Keyed on who is here, so a
  // relationship that appears later flies in on its own.
  const ids = relations.map((r) => r.userId).join(',')
  useEffect(() => {
    const timers: number[] = []
    relations.forEach((r, k) => {
      if (launched.has(r.userId)) return
      timers.push(window.setTimeout(() => setLaunched((prev) => new Set(prev).add(r.userId)), 60 + k * 60))
      timers.push(window.setTimeout(() => setArrived((prev) => new Set(prev).add(r.userId)), 60 + k * 60 + 620))
    })
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  const width = typeof window === 'undefined' ? 360 : window.innerWidth - 40
  const nearestY = typeof window === 'undefined' ? 600 : window.innerHeight - 205

  function slot(index: number) {
    const d = index - scroll
    if (d < 0) return { y: nearestY - d * 150, scale: 1 - d * 0.12, opacity: Math.max(0, 1 + d * 2.2), z: 200 }
    return {
      y: nearestY - ((1 - DEPTH ** d) / (1 - DEPTH)) * 80,
      scale: Math.max(0.4, DEPTH ** d),
      opacity: Math.max(0, 1 - d * 0.11),
      z: 100 - Math.round(d * 10),
    }
  }

  const clamp = (v: number) => Math.max(0, Math.min(Math.max(0, shown.length - 1), v))

  function lineFor(r: Relation): string {
    if (r.stage === 'session' && r.session) {
      const left = minutesLeft(r.session)
      return left === null ? t('world.stage.sessionWaiting') : t('world.stage.session', { minutes: left })
    }
    if (r.stage !== 'chat') return t(`world.stage.${r.stage}`)
    return r.lastText ?? ''
  }

  return (
    <div
      className={`cos-stair${dragging ? ' is-dragging' : ''}${leaving ? ' is-leaving' : ''}`}
      data-chrome
      onPointerDown={(e) => {
        drag.current = { y0: e.clientY, s0: scroll, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dy = e.clientY - d.y0
        if (!d.moved && Math.abs(dy) > SLOP) {
          d.moved = true
          setDragging(true)
        }
        // Pulling up brings older conversations forward.
        if (d.moved) setScroll(clamp(d.s0 - dy / 90))
      }}
      onPointerUp={() => {
        if (drag.current?.moved) {
          suppressClick.current = true
          setScroll((s) => clamp(Math.round(s)))
        }
        drag.current = null
        setDragging(false)
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false) }}
      onWheel={(e) => setScroll((s) => clamp(Math.round(s) + Math.sign(e.deltaY)))}
    >
      <div className="cos-stair-filter" role="group" aria-label={t('world.filterLabel')}>
        {(['all', 'wait'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => { setFilter(f); setScroll(0) }}
          >
            {t(`world.filter.${f}`)}
          </button>
        ))}
      </div>

      {loaded && shown.length === 0 && (
        <p className="cos-stair-empty">{t(filter === 'all' ? 'world.stairEmpty' : 'world.stairEmptyWaiting')}</p>
      )}

      {relations.map((r, order) => {
        const index = shown.indexOf(r)
        const visible = index >= 0 && !leaving
        const here = arrived.has(r.userId) && visible
        const origin = originOf(r.userId)
        const home = origin
          ? `translate3d(${(origin.x - (width - 40)).toFixed(1)}px, ${(origin.y - ROW_H / 2).toFixed(1)}px, 0) scale(1)`
          : `translate3d(20px, -120px, 0) scale(.6)`
        const s = slot(Math.max(0, index))
        const placed = launched.has(r.userId) && visible
        // Leaving, everyone flies home whole and visible, one after another
        // (45 ms apart), as in the prototype — they are people going back
        // to their places, not cards fading out.
        const flyingHome = leaving && index >= 0
        const style = {
          width: `${width}px`,
          transform: placed ? `translate3d(20px, ${(s.y - ROW_H / 2).toFixed(1)}px, 0) scale(${s.scale.toFixed(3)})` : home,
          opacity: placed ? s.opacity : flyingHome ? 1 : !visible ? 0 : 1,
          zIndex: placed ? s.z : 100 - order,
          transitionDelay: flyingHome ? `${order * 45}ms` : undefined,
          pointerEvents: placed && s.opacity > 0.35 ? ('auto' as const) : ('none' as const),
        }
        const kind = NEEDS_YOU.includes(r.stage) ? ' needs' : WAITS_ON_THEM.includes(r.stage) ? ' ghost' : ''
        const lineKind = r.stage === 'session' || NEEDS_YOU.includes(r.stage) ? ' warm' : WAITS_ON_THEM.includes(r.stage) ? ' waiting' : ''
        return (
          <button
            key={r.userId}
            type="button"
            className={`cos-stair-row${kind}${here ? ' is-here' : ''}`}
            style={style}
            onClick={() => {
              if (suppressClick.current) { suppressClick.current = false; return }
              onOpen(r)
            }}
          >
            <span className="cos-stair-face">
              <span className="cos-stair-img">
                {r.avatarUrl ? <img src={r.avatarUrl} alt="" draggable={false} /> : <span>{r.name.slice(0, 1)}</span>}
              </span>
              {r.session && <SessionClock session={r.session} />}
            </span>
            <span className="cos-stair-text">
              <b>{r.name}</b>
              <span className={`cos-stair-line${lineKind}`}>{lineFor(r)}</span>
            </span>
            <span className="cos-stair-meta">
              <i>{r.lastAt ? timeAgo(r.lastAt, i18n.language) : ''}</i>
              {r.unread && (
                <span className="cos-stair-unread" aria-label={t('world.unread', { count: r.unreadCount })}>
                  {r.unreadCount.toLocaleString(i18n.language)}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
