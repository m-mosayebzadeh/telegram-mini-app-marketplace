import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { acceptEchoProposal, declineEchoProposal, type EchoProposal, type EchoStatus } from '../../lib/echoApi'
import { setEcho, useEcho } from '../../lib/echoStore'

/**
 * Somebody found in Echo — the card that reaches you on any screen
 * (TECHNICAL_REQUIREMENTS.md section 32).
 *
 * Searching no longer keeps you on Echo's screen, so when the matcher puts
 * two people in front of each other, this rises from the bottom wherever
 * each of them is. Both are held for each other for a few seconds (the
 * panel's setting, 30 by default); a thin ring around the card empties as
 * the time goes. "Start talking" from both makes the conversation; "no",
 * or throwing the card to either side, or the time running out, lets it
 * fade and the search goes on — and nobody is ever told which it was.
 *
 * The card shows no name and no photo, only the other person's own line
 * and what you both chose: the one thing it lets you judge is whether
 * there is something to talk about. Everything leans towards "start" —
 * a big button, a small "no".
 */

/** How far the card has to be thrown to count as "no". */
const THROW_PX = 90
/** A meeting this recent was made from this card, so it is opened. */
const JUST_STARTED_MS = 2 * 60 * 1000
/** How long "looking for the next person" stays before the card goes. */
const NEXT_NOTE_MS = 1600

type Phase = 'in' | 'thrown' | 'next'

function justStarted(status: EchoStatus | null): boolean {
  const started = status?.matched?.started_at
  return !!started && Date.now() - new Date(started).getTime() < JUST_STARTED_MS
}

/** The thin ring that empties around the card, drawn to the card's own
 *  size so it follows its rounded corners exactly. */
function TimeRing({ proposal }: { proposal: EchoProposal }) {
  const ref = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const element = ref.current?.parentElement
    if (!element) return
    const measure = () => setSize({ w: element.offsetWidth, h: element.offsetHeight })
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  // One CSS animation for the whole hold, started part-way through when
  // the card arrived late: no timer writes anything while it drains.
  // Worked out ONCE, when the card arrives. It used to be worked out on
  // every render, and the card re-renders every second for its countdown,
  // so the animation was restarted each second and the ring jumped.
  const [style] = useState(() => {
    const total = proposal.seconds * 1000
    const left = Math.max(0, new Date(proposal.expires_at).getTime() - Date.now())
    return { animationDuration: `${total}ms`, animationDelay: `${-(total - left)}ms` } as React.CSSProperties
  })
  return (
    <svg ref={ref} className="cos-offer-ring" width={size.w + 6} height={size.h + 6} aria-hidden="true">
      {size.w > 0 && (
        <rect
          x="3"
          y="3"
          width={size.w}
          height={size.h}
          rx="26"
          pathLength={100}
          style={style}
        />
      )}
    </svg>
  )
}

export function EchoOffer() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const status = useEcho()
  const live = status?.proposal ?? null

  // The card on screen. Kept after the server's proposal has gone, so it
  // can fade out rather than vanish.
  const [card, setCard] = useState<EchoProposal | null>(null)
  const [phase, setPhase] = useState<Phase>('in')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(0)
  const start = useRef<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  // A new card arrives, or the one on screen is settled.
  useEffect(() => {
    if (live && live.id !== card?.id) {
      setCard(live)
      setPhase('in')
      setDrag(0)
      navigator.vibrate?.([10, 40, 10])
      return
    }
    if (live && card && live.accepted !== card.accepted) {
      setCard(live)
      return
    }
    if (!live && card && phase === 'in') {
      if (justStarted(status) && status?.matched) {
        // Both said "start": straight into the conversation.
        setCard(null)
        navigate(`/conversations/${status.matched.conversation_id}`)
        return
      }
      setPhase('next')
    }
  }, [live, card, phase, status, navigate])

  // "Looking for the next person", then the card goes.
  useEffect(() => {
    if (phase !== 'next' && phase !== 'thrown') return
    const timer = window.setTimeout(() => setCard(null), phase === 'next' ? NEXT_NOTE_MS : 420)
    return () => window.clearTimeout(timer)
  }, [phase])

  // The seconds, for whoever cannot see the ring.
  useEffect(() => {
    if (!card) return
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(card.expires_at).getTime() - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [card])

  if (!card) return null

  async function answer(yes: boolean) {
    if (!card || busy) return
    setBusy(true)
    try {
      const next = await (yes ? acceptEchoProposal(card.id) : declineEchoProposal(card.id))
      if (yes && !next.proposal && justStarted(next) && next.matched) {
        setCard(null)
        navigate(`/conversations/${next.matched.conversation_id}`)
      }
      setEcho(next)
    } catch {
      // The card stays; its time running out settles it either way.
    } finally {
      setBusy(false)
    }
  }

  function throwAway(direction: number) {
    setDrag(direction * 480)
    setPhase('thrown')
    void answer(false)
  }

  const shared = card.shared_tags.map((tag) => t(`echo.tag.${tag}`)).join('، ')
  // No interest in common, but interests in the same group: "both into
  // science" (section 32) — still something to talk about.
  const groups = (card.shared_groups ?? []).map((group) => t(`echo.group.${group}`)).join('، ')
  const leaving = phase !== 'in'

  return (
    <div className="cos-offer-slot">
      <section
        className={`cos-offer${leaving ? ` is-${phase}` : ''}${card.accepted ? ' is-accepted' : ''}${secondsLeft <= 3 && !leaving ? ' is-last' : ''}`}
        role="dialog"
        aria-label={t('echoOffer.label')}
        style={{ '--drag': drag } as React.CSSProperties}
        onPointerDown={(event) => {
          if (leaving || card.accepted || (event.target as HTMLElement).closest('button')) return
          start.current = event.clientX
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (start.current === null) return
          setDrag(event.clientX - start.current)
        }}
        onPointerUp={() => {
          if (start.current === null) return
          start.current = null
          if (Math.abs(drag) > THROW_PX) throwAway(Math.sign(drag))
          else setDrag(0)
        }}
        onPointerCancel={() => {
          start.current = null
          setDrag(0)
        }}
      >
        {!leaving && <TimeRing key={card.id} proposal={card} />}
        <div className="cos-offer-lights" aria-hidden="true">
          <i className="is-a" />
          <i className="is-b" />
        </div>
        {phase === 'next' ? (
          <p className="cos-offer-next" role="status">{t('echoOffer.next')}</p>
        ) : (
          <>
            <p className="cos-offer-kicker">{t('echoOffer.found')}</p>
            {/* Their line is in whatever language they wrote it, so it takes
                its direction from itself: an English line in a Persian app
                otherwise loses its full stop to the wrong end. */}
            <p className="cos-offer-line" dir={card.tagline ? 'auto' : undefined}>
              {card.tagline ? `«${card.tagline}»` : t('echoOffer.fallback')}
            </p>
            {shared !== '' && <p className="cos-offer-shared">{t('echoOffer.shared', { tags: shared })}</p>}
            {shared === '' && groups !== '' && <p className="cos-offer-shared">{t('echoOffer.sharedGroups', { groups })}</p>}
            <span className="cos-visually-hidden" aria-live="polite">{t('echoOffer.secondsLeft', { n: secondsLeft })}</span>
            <button
              type="button"
              className="cos-offer-start"
              disabled={busy || card.accepted}
              onClick={() => void answer(true)}
            >
              {card.accepted ? t('echoOffer.waitingOther') : t('echoOffer.start')}
            </button>
            {!card.accepted && (
              <button type="button" className="cos-offer-no" disabled={busy} onClick={() => throwAway(1)}>
                {t('echoOffer.decline')}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}
