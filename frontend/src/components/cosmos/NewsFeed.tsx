import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ANSWERABLE, type NewsItem } from '../../lib/news'
import { Countdown, EdgeFuse } from './Fuse'
import { timeSince } from '../../lib/timeAgo'
import { THANKS_IMAGE, type Thanks } from '../../lib/worldApi'
import {
  ASH_MS, DROP_MS, FLIGHT_MS, FLIP_BACK_MS, GULP_AT_MS, ITEM_H, SETTLE_MS, SLOP, THROW_PX, UNDO_MS,
  clampScroll, edgeFade, emerging, endY, flightPoint, slotY, streamGeometry, swallowed, touchable,
  type StreamGeometry,
} from '../../lib/newsStream'

/**
 * The news region, built exactly as the approved prototype draws it
 * (docs/prototypes/regions.html; TECHNICAL_REQUIREMENTS.md sections 30.19
 * to 30.23 and 31).
 *
 * News comes out of a wormhole near the top and hangs from a line of light
 * that runs down to a black hole. Every item is a pointer to something
 * real (lib/news.ts), so throwing one into the black hole removes only the
 * pointer, never the thing.
 *
 * One kind can be answered here — somebody accepted your offer — and that
 * card has two faces: a tap turns the
 * card over to its three buttons. An answer then takes a few seconds to
 * settle, and the settling IS the way to take it back:
 *
 * - Refusing burns the card to ash from its far edge towards the name, so
 *   who you are refusing stays readable to the last moment, and the ash
 *   falls into the black hole — where the things you throw away go.
 * - Accepting is the opposite, in the world's own physics: the card
 *   gathers itself into the person, warming as it goes, and the person
 *   flies to Sol — your own star — which flares as they arrive.
 * - Touching the card while that is happening runs it backwards to exactly
 *   how it was. There is no undo button to find; you catch the thing itself.
 *
 * Nothing reaches the server until the settling is over, so an answer
 * taken back costs nobody anything: the other person never saw it.
 *
 * Layout is arithmetic, not flow (lib/newsStream.ts), because the cards
 * move as bodies — out of one hole, along the line, into the other — and
 * a list that the browser lays out cannot do that.
 */

interface NewsFeedProps {
  items: NewsItem[]
  loaded: boolean
  /** Remove the pointer (the thing it points at stays where it lives). */
  onDismiss: (key: string) => void
  /** Send an answer, once its settling time has run out. */
  onAnswer: (item: NewsItem, yes: boolean) => Promise<void>
  /** Go where the item points. */
  onOpen: (item: NewsItem) => void
  /** A payment window or a queue ran out: read the state again. */
  onDeadline?: () => void
}

/** A confirmation that has to wait for somebody else is not answerable yet:
 *  its card shows the wait instead of turning over to buttons that could
 *  only fail (TECHNICAL_REQUIREMENTS.md section 16). */
const answerableNow = (item: NewsItem) => ANSWERABLE.includes(item.kind) && !item.queuedBehind

type Settle = 'burn' | 'charge'

/** A card that has left the stream but is still on its way out. */
interface Leaving {
  item: NewsItem
  how: 'drop' | 'burn'
  /** Where it was hanging when it left; a burnt card stays there. */
  y: number
}

/** The running state of one settling answer. Timers own the logic; the
 *  animation frame only paints how far along it is. */
interface Settling {
  kind: Settle
  t0: number
  back: boolean
  from: number
  tb: number
  timer: number
  frame: number
}

const HINT_KEY = 'cos-news-hint-seen'

const nextFrame = (fn: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : window.setTimeout(fn, 16)
const cancelFrame = (id: number) =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id)

function prefersLessMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function NewsFeed({ items, loaded, onDismiss, onAnswer, onOpen, onDeadline }: NewsFeedProps) {
  const { t, i18n } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const srcRef = useRef<HTMLDivElement>(null)
  const sinkRef = useRef<HTMLDivElement>(null)

  const [g, setG] = useState<StreamGeometry | null>(null)
  const [scroll, setScroll] = useState(0)
  const [scrolling, setScrolling] = useState(false)
  const [turned, setTurned] = useState<ReadonlySet<string>>(new Set())
  const [settling, setSettling] = useState<Readonly<Record<string, Settle>>>({})
  const [leaving, setLeaving] = useState<ReadonlyMap<string, Leaving>>(new Map())
  const [arriving, setArriving] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  /** Cards that have left for good: thrown away, or answered and on their
   *  way to the server. Hidden here at once, whatever the parent does with
   *  them; an answer that fails is shown again. */
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set())
  const [held, setHeld] = useState<{ key: string; tx: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const settles = useRef(new Map<string, Settling>())
  const cards = useRef(new Map<string, HTMLElement>())
  /** The flight to Sol happens above everything on the screen, Sol
   *  included, so its pieces live on the page itself; kept here so that
   *  leaving the region mid-flight takes them away too. */
  const flying = useRef(new Set<HTMLElement>())
  const flipTimers = useRef(new Map<string, number>())
  const timers = useRef(new Set<number>())
  const drag = useRef<{ id: number; x0: number; y0: number; moved: boolean; axis: 'x' | 'y' | null; key: string | null; scroll0: number } | null>(null)
  const known = useRef<Set<string> | null>(null)
  const toastTimer = useRef(0)

  /** A timer that is cleared if the region is left before it fires. */
  function later(ms: number, fn: () => void): number {
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
    return id
  }

  // Measured, not assumed: the phone's size, its safe areas (read from a
  // probe that carries them as padding) and the reading direction.
  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current
      const probe = probeRef.current
      if (!root) return
      const pad = probe ? getComputedStyle(probe) : null
      setG(streamGeometry({
        width: root.offsetWidth || innerWidth,
        height: root.offsetHeight || innerHeight,
        safeTop: pad ? parseFloat(pad.paddingTop) || 0 : 0,
        safeBottom: pad ? parseFloat(pad.paddingBottom) || 0 : 0,
        rtl: getComputedStyle(root).direction === 'rtl',
      }))
    }
    measure()
    addEventListener('resize', measure)
    return () => removeEventListener('resize', measure)
  }, [])

  // Everything still pending is dropped when the region is left. An answer
  // that has not settled is NOT sent: sending something the person can no
  // longer see or take back would break the promise the card made.
  useEffect(() => {
    const allTimers = timers.current
    const allSettles = settles.current
    const allFlips = flipTimers.current
    const allFlying = flying.current
    return () => {
      allFlying.forEach((el) => el.remove())
      allTimers.forEach(clearTimeout)
      allSettles.forEach((s) => { clearTimeout(s.timer); cancelFrame(s.frame) })
      allFlips.forEach(clearTimeout)
      clearTimeout(toastTimer.current)
    }
  }, [])

  function say(text: string, ms = 2800) {
    clearTimeout(toastTimer.current)
    setToast(text)
    toastTimer.current = window.setTimeout(() => setToast(null), ms)
  }

  // The first visit explains the two gestures once, as the prototype does.
  useEffect(() => {
    try {
      if (localStorage.getItem(HINT_KEY) === '1') return
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      // Without storage the hint simply shows on every visit.
    }
    say(t('news.hint'), 4200)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** A hole flares — the wormhole as something comes out, the black hole
   *  as it swallows. Restarting a CSS animation needs the class taken off
   *  and put back across a style read. */
  function flare(el: HTMLElement | null, name: string) {
    if (!el) return
    el.classList.remove(name)
    void el.offsetWidth
    el.classList.add(name)
  }

  // Something new arrives while you look: it comes out of the wormhole,
  // not from nowhere. What was already there on arrival simply hangs.
  useLayoutEffect(() => {
    if (!loaded) return
    if (known.current === null) {
      known.current = new Set(items.map((item) => item.key))
      return
    }
    const fresh = items.filter((item) => !known.current!.has(item.key)).map((item) => item.key)
    items.forEach((item) => known.current!.add(item.key))
    if (fresh.length === 0) return
    setArriving(new Set(fresh))
    setScroll(0)
    flare(srcRef.current, 'is-flaring')
    navigator.vibrate?.([12, 40, 12])
  }, [items, loaded])

  // Two frames: the first paints the new cards inside the wormhole, the
  // second lets them go, so they travel out along the line to their place.
  useEffect(() => {
    if (arriving.size === 0) return
    let frame = nextFrame(() => {
      frame = nextFrame(() => setArriving(new Set()))
    })
    return () => cancelFrame(frame)
  }, [arriving])

  useEffect(() => {
    const present = new Set([...items.map((item) => item.key), ...leaving.keys()])
    for (const key of cards.current.keys()) if (!present.has(key)) cards.current.delete(key)
  }, [items, leaving])

  const visible = items.filter((item) => !leaving.has(item.key) && !gone.has(item.key))
  const offset = g ? clampScroll(g, visible.length, scroll) : 0
  const indexOf = (key: string) => visible.findIndex((item) => item.key === key)
  const cardEl = (key: string) => cards.current.get(key) ?? null

  // ------------------------------------------------------------ answers

  /** Paint how far a settling answer has got, every frame until it ends. */
  function paint(key: string) {
    const s = settles.current.get(key)
    if (!s) return
    const now = performance.now()
    const v = Math.max(0, Math.min(1, s.back ? s.from * (1 - (now - s.tb) / UNDO_MS) : (now - s.t0) / SETTLE_MS))
    const el = cardEl(key)
    el?.style.setProperty(s.kind === 'burn' ? '--cos-burn' : '--cos-charge', v.toFixed(3))
    if (el && s.kind === 'burn' && !s.back && Math.random() < 0.7 && !prefersLessMotion()) ember(el, v)
    s.frame = nextFrame(() => paint(key))
  }

  /** A spark off the burning edge, drifting up and cooling to ash. */
  function ember(card: HTMLElement, v: number) {
    const host = card.querySelector('.cos-news-embers')
    if (!host || !g) return
    const spark = document.createElement('span')
    spark.className = 'cos-news-ember'
    const along = `${Math.max(0, (v * 1.1 - 0.1) * card.offsetWidth)}px`
    // The fire starts at the far edge from the name: the left in a
    // right-to-left language, the right otherwise.
    if (g.rtl) spark.style.left = along
    else spark.style.right = along
    spark.style.top = `${8 + Math.random() * (ITEM_H - 16)}px`
    spark.style.setProperty('--dx', `${(g.rtl ? -1 : 1) * (10 + Math.random() * 30)}px`)
    spark.style.setProperty('--dy', `${-20 - Math.random() * 40}px`)
    host.appendChild(spark)
    later(950, () => spark.remove())
  }

  function stopSettling(key: string) {
    const s = settles.current.get(key)
    if (s) {
      clearTimeout(s.timer)
      cancelFrame(s.frame)
    }
    settles.current.delete(key)
    setSettling((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function turnBack(key: string) {
    clearTimeout(flipTimers.current.get(key))
    flipTimers.current.delete(key)
    setTurned((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  function settle(item: NewsItem, kind: Settle) {
    turnBack(item.key)
    setFailed((prev) => {
      const next = new Set(prev)
      next.delete(item.key)
      return next
    })
    const s: Settling = {
      kind, t0: performance.now(), back: false, from: 0, tb: 0, frame: 0,
      timer: window.setTimeout(() => done(item, kind), SETTLE_MS),
    }
    settles.current.set(item.key, s)
    setSettling((prev) => ({ ...prev, [item.key]: kind }))
    navigator.vibrate?.(10)
    paint(item.key)
  }

  /** Touched while settling: run it backwards to exactly how it was. */
  function takeBack(key: string) {
    const s = settles.current.get(key)
    if (!s || s.back) return
    clearTimeout(s.timer)
    const now = performance.now()
    s.from = Math.min(1, (now - s.t0) / SETTLE_MS)
    s.back = true
    s.tb = now
    s.timer = window.setTimeout(() => {
      cardEl(key)?.style.setProperty(s.kind === 'burn' ? '--cos-burn' : '--cos-charge', '0')
      stopSettling(key)
    }, UNDO_MS)
    navigator.vibrate?.([6, 30, 6])
  }

  function done(item: NewsItem, kind: Settle) {
    const k = indexOf(item.key)
    const y = g && k >= 0 ? slotY(g, k, offset) : 0
    // The face is read before anything changes: the card is about to go.
    const face = cardEl(item.key)?.querySelector<HTMLElement>('.is-front .cos-news-face') ?? null
    const from = face?.getBoundingClientRect() ?? null
    stopSettling(item.key)
    setGone((prev) => new Set(prev).add(item.key))
    if (kind === 'burn') {
      setLeaving((prev) => new Map(prev).set(item.key, { item, how: 'burn', y }))
      flare(sinkRef.current, 'is-flaring')
      later(ASH_MS, () => forget(item.key))
    } else {
      flyToSol(item, from)
    }
    onAnswer(item, kind === 'charge').catch(() => {
      // It did not go through: the card comes back, saying so.
      setGone((prev) => {
        const next = new Set(prev)
        next.delete(item.key)
        return next
      })
      setFailed((prev) => new Set(prev).add(item.key))
    })
  }

  function forget(key: string) {
    setLeaving((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }

  /** The person leaves the card as a small warm body, arcs down to Sol with
   *  a trail of light, and Sol flares as they arrive. */
  function flyToSol(item: NewsItem, face: DOMRect | null) {
    const root = rootRef.current
    const sol = document.querySelector<HTMLElement>('[data-sol]')
    const arrive = () => {
      if (sol) {
        flare(sol, 'is-absorbing')
        later(800, () => sol.classList.remove('is-absorbing'))
      }
      navigator.vibrate?.([10, 30, 14])
      say(t(`news.${item.kind}.flown`, { name: item.name }))
    }
    if (!root || !sol || !face || !g || prefersLessMotion()) {
      arrive()
      return
    }
    // In the page's own coordinates: the pieces are fixed to the screen.
    const target = sol.getBoundingClientRect()
    const from = { x: face.left + face.width / 2, y: face.top + face.height / 2 }
    const to = { x: target.left + target.width / 2, y: target.top + target.height / 2 }
    const put = (el: HTMLElement) => {
      document.body.appendChild(el)
      flying.current.add(el)
    }
    const take = (el: HTMLElement) => {
      el.remove()
      flying.current.delete(el)
    }
    const body = document.createElement(item.avatarUrl ? 'img' : 'span')
    body.className = 'cos-news-to-sol'
    if (body instanceof HTMLImageElement && item.avatarUrl) {
      body.src = item.avatarUrl
      body.alt = ''
    } else {
      body.textContent = item.name.slice(0, 1)
    }
    put(body)
    const frames: Keyframe[] = []
    for (let i = 0; i <= 14; i += 1) {
      const u = i / 14
      const p = flightPoint(from, to, u, g.rtl)
      frames.push({ transform: `translate(${(p.x - 20).toFixed(1)}px, ${(p.y - 20).toFixed(1)}px) scale(${(1 - u * 0.65).toFixed(3)})`, offset: u })
      later(u * FLIGHT_MS, () => {
        const dot = document.createElement('span')
        dot.className = 'cos-news-trail'
        dot.style.left = `${p.x}px`
        dot.style.top = `${p.y}px`
        put(dot)
        later(750, () => take(dot))
      })
    }
    const finish = () => {
      take(body)
      arrive()
    }
    if (typeof body.animate !== 'function') {
      later(FLIGHT_MS, finish)
      return
    }
    body.animate(frames, { duration: FLIGHT_MS, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).onfinish = finish
  }

  // ------------------------------------------------------------ gestures

  /** Swiped far enough aside: it falls into the black hole at the bottom. */
  function drop(item: NewsItem) {
    const k = indexOf(item.key)
    setHeld(null)
    setLeaving((prev) => new Map(prev).set(item.key, { item, how: 'drop', y: g && k >= 0 ? slotY(g, k, offset) : 0 }))
    setGone((prev) => new Set(prev).add(item.key))
    onDismiss(item.key)
    later(GULP_AT_MS, () => flare(sinkRef.current, 'is-flaring'))
    later(DROP_MS, () => forget(item.key))
    navigator.vibrate?.([6, 30, 18])
  }

  /** A tap: an answerable card turns over — or, while its answer is still
   *  settling, takes the answer back. Anything else goes where it points,
   *  and having been opened, it is no longer news. */
  function tap(item: NewsItem) {
    if (settles.current.has(item.key)) {
      takeBack(item.key)
      return
    }
    if (answerableNow(item)) {
      navigator.vibrate?.(6)
      if (turned.has(item.key)) {
        turnBack(item.key)
        return
      }
      setTurned((prev) => new Set(prev).add(item.key))
      clearTimeout(flipTimers.current.get(item.key))
      flipTimers.current.set(item.key, window.setTimeout(() => turnBack(item.key), FLIP_BACK_MS))
      return
    }
    onDismiss(item.key)
    onOpen(item)
  }

  const canThrow = (key: string | null): key is string =>
    key !== null && !settles.current.has(key) && visible.some((item) => item.key === key)

  function onPointerDown(event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest('button')) return
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-news-key]')
    drag.current = {
      id: event.pointerId, x0: event.clientX, y0: event.clientY, moved: false, axis: null,
      key: card?.dataset.newsKey ?? null, scroll0: offset,
    }
    rootRef.current?.setPointerCapture?.(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
    const d = drag.current
    if (!d || event.pointerId !== d.id || !g) return
    const tx = event.clientX - d.x0
    const ty = event.clientY - d.y0
    if (!d.moved && Math.abs(tx) + Math.abs(ty) > SLOP) {
      d.moved = true
      d.axis = Math.abs(tx) > Math.abs(ty) ? 'x' : 'y'
    }
    if (!d.moved) return
    if (d.axis === 'x' && canThrow(d.key)) setHeld({ key: d.key, tx })
    else if (d.axis === 'y') {
      setScrolling(true)
      setScroll(clampScroll(g, visible.length, d.scroll0 - ty))
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    const d = drag.current
    if (!d || event.pointerId !== d.id) return
    drag.current = null
    setScrolling(false)
    const item = visible.find((it) => it.key === d.key)
    if (d.moved && d.axis === 'x' && item && canThrow(d.key)) {
      if (Math.abs(event.clientX - d.x0) > THROW_PX) drop(item)
      else setHeld(null)
      return
    }
    if (!d.moved && item) tap(item)
  }

  // ------------------------------------------------------------ drawing

  // Numbers in the reader's own digits: «۱۲۰ فوتون», as the prototype writes it.
  const v = (item: NewsItem) => ({
    name: item.name,
    offer: item.offerTitle ?? '',
    photons: (item.photons ?? 0).toLocaleString(i18n.language),
  })
  const titleOf = (item: NewsItem) => t(`news.${item.kind}.title`, v(item))
  const bodyOf = (item: NewsItem) => (item.kind === 'message' ? item.text ?? '' : t(`news.${item.kind}.body`, v(item)))
  const pictureOf = (item: NewsItem) =>
    item.kind === 'thanks' && item.reaction && item.reaction in THANKS_IMAGE ? THANKS_IMAGE[item.reaction as Thanks] : item.avatarUrl

  function face(item: NewsItem) {
    const picture = pictureOf(item)
    return (
      <span className="cos-news-face">
        {picture ? <img src={picture} alt="" draggable={false} /> : <span>{item.name.slice(0, 1)}</span>}
      </span>
    )
  }

  /** Each card's element, for the painting that happens outside React.
   *  Pruned below once a card is gone for good. */
  const keep = (key: string) => (el: HTMLElement | null) => {
    if (el) cards.current.set(key, el)
  }

  function card(item: NewsItem, y: number, gone?: Leaving['how']) {
    if (!g) return null
    const key = item.key
    const answerable = answerableNow(item)
    const kind = gone === 'burn' ? 'burn' : settling[key]
    const isHeld = held?.key === key
    const fade = edgeFade(g, y)
    let transform = `translate3d(0, ${y}px, 0)`
    let opacity = fade
    if (arriving.has(key)) {
      transform = emerging(g)
      opacity = 0
    } else if (gone === 'drop') {
      transform = swallowed(g)
      opacity = 0
    } else if (isHeld) {
      transform = `translate3d(${held.tx}px, ${y}px, 0) rotate(${held.tx * 0.03}deg)`
      opacity = Math.max(0.25, 1 - Math.abs(held.tx) / 260)
    }
    const style = {
      left: g.cardLeft,
      width: g.cardWidth,
      transform,
      opacity,
      pointerEvents: gone || !touchable(fade) ? 'none' : undefined,
    } as React.CSSProperties
    const className = [
      'cos-news-card',
      answerable && 'is-turnable',
      turned.has(key) && 'is-turned',
      kind === 'burn' && 'is-burning',
      kind === 'charge' && 'is-gathering',
      isHeld && 'is-held',
      gone === 'drop' && 'is-falling',
      arriving.has(key) && 'is-emerging',
    ].filter(Boolean).join(' ')
    const when = <span className="cos-news-when">{timeSince(item.at, i18n.language)}</span>

    if (!answerable) {
      const queued = item.kind === 'confirm' && item.queuedBehind
      // The countdown takes the body line — news cards keep one height —
      // and the fuse is the card's own lower edge burning away.
      let body: React.ReactNode = bodyOf(item)
      if (queued) {
        body = item.freesAt
          ? <Countdown deadline={item.freesAt} label="news.confirm.queuedTimed" values={{ name: item.queuedBehind ?? '' }} onDone={onDeadline} />
          : t('news.confirm.queuedNoTime', { name: item.queuedBehind })
      } else if (item.kind === 'pay' && item.payBy) {
        body = <Countdown deadline={item.payBy} label="news.pay.within" onDone={onDeadline} />
      }
      return (
        <article key={key} className={className} style={style} data-news-key={key} aria-label={titleOf(item)} ref={keep(key)}>
          {face(item)}
          <span className="cos-news-text">
            <b>{titleOf(item)}</b>
            {body && <span className={queued || item.kind === 'pay' ? 'is-timed' : undefined}>{body}</span>}
          </span>
          {when}
          {item.kind === 'pay' && item.payBy && <EdgeFuse deadline={item.payBy} start={item.confirmedAt} />}
        </article>
      )
    }

    const isTurned = turned.has(key)
    const sub = kind
      ? t(kind === 'burn' ? 'news.youRefused' : 'news.youConfirmed')
      : failed.has(key)
        ? t('news.failed')
        : bodyOf(item)
    return (
      <article key={key} className={className} style={style} data-news-key={key} aria-label={titleOf(item)} ref={keep(key)}>
        <div className="cos-news-turn">
          <div className="cos-news-side is-front" aria-hidden={isTurned}>
            {face(item)}
            <span className="cos-news-text">
              <b>{titleOf(item)}</b>
              <span className={failed.has(key) && !kind ? 'is-failed' : undefined}>{sub}</span>
            </span>
            {when}
          </div>
          <div className="cos-news-side is-back" aria-hidden={!isTurned}>
            <button type="button" className="cos-news-act is-yes" tabIndex={isTurned ? 0 : -1} onClick={() => settle(item, 'charge')}>
              {t('news.confirm.yes')}
            </button>
            <button type="button" className="cos-news-act" tabIndex={isTurned ? 0 : -1} onClick={() => settle(item, 'burn')}>
              {t('news.refuse')}
            </button>
            <button
              type="button"
              className="cos-news-act is-talk"
              tabIndex={isTurned ? 0 : -1}
              onClick={() => onOpen(item)}
            >
              {t('news.talk')}
            </button>
          </div>
        </div>
        <span className="cos-news-burn-edge" aria-hidden="true" />
        <span className="cos-news-embers" aria-hidden="true" />
        <span className="cos-news-undo" aria-hidden={!kind}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="7" opacity=".6" />
            <circle cx="12" cy="12" r="10.5" opacity=".3" />
          </svg>
          {t('news.touchToUndo')}
        </span>
      </article>
    )
  }

  const ey = g ? endY(g, visible.length, offset) : 0
  return (
    <div
      className={`cos-news-stream${scrolling ? ' is-scrolling' : ''}`}
      ref={rootRef}
      data-chrome
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
        setScrolling(false)
        setHeld(null)
      }}
      onWheel={(event) => {
        if (g) setScroll(clampScroll(g, visible.length, offset + event.deltaY))
      }}
    >
      <span className="cos-news-safe" ref={probeRef} aria-hidden="true" />
      {g && (
        <>
          <div className="cos-news-hole" ref={srcRef} style={{ left: g.spineX, top: g.srcY }} aria-hidden="true">
            <span className="cos-news-swirl" />
            <span className="cos-news-core" />
          </div>
          <div className="cos-news-spine" style={{ left: g.spineX, top: g.srcY, height: g.sinkY - g.srcY }} aria-hidden="true" />
          <div className="cos-news-hole is-sink" ref={sinkRef} style={{ left: g.spineX, top: g.sinkY }} aria-hidden="true">
            <span className="cos-news-swirl" />
            <span className="cos-news-core" />
          </div>
          {/* One list, so a card that leaves the stream keeps its element —
              and with it the fall, or the burn, it is in the middle of. */}
          {[
            ...visible.map((item, k) => card(item, slotY(g, k, offset))),
            ...[...leaving.values()].map((l) => card(l.item, l.y, l.how)),
          ]}
          {loaded && (
            <p className="cos-news-end" style={{ transform: `translate3d(0, ${ey}px, 0)`, opacity: ey < g.bottom + 20 ? 1 : 0 }}>
              {t(visible.length ? 'news.end' : 'news.allSeen')}
            </p>
          )}
        </>
      )}
      {toast && (
        <p className="cos-news-toast" role="status" key={toast}>
          {toast}
        </p>
      )}
    </div>
  )
}
