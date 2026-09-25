import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Sol, and the places in its system.
 *
 * Hold Sol, sweep towards a place, let go. One continuous gesture rather
 * than tap-then-tap (TECHNICAL_REQUIREMENTS.md section 22): the thumb is
 * already down, and asking it to land twice is two chances to miss.
 *
 * The idea the whole thing is built on is that these are bodies orbiting
 * a star, so **light is the interface**. A beam leaves Sol towards
 * wherever the thumb is pointing, and whatever it reaches is lit from the
 * side facing Sol — the way a planet is. Nothing glows from a halo bolted
 * around its outside; the light arrives, enters, and comes back out
 * through the mark.
 *
 * Two deliberate absences:
 *
 * - **No floating label in the middle of the screen.** Every place is
 *   named where it sits, so a second copy hovering over the world was one
 *   thing too many — it explained what the thumb was already touching.
 * - **Gaps that mean nothing.** Between one body and the next there is a
 *   band where the beam reaches empty space and letting go does nothing.
 *   Without it, every possible direction belongs to some destination and
 *   there is no way to change your mind mid-sweep except by coming all
 *   the way back to Sol.
 */

export interface CoreSection {
  id: string
  /** What it does, in the reader's language. */
  label: string
  /** The product's own name, written in the reader's script — "Echo" in
   *  English, "اِکو" in Persian. A name people say out loud has to be
   *  spellable in the language they say it in, or it stays a logo. */
  name?: string
  /** One quiet word under the name, saying what it is. Only for places
   *  whose name does not explain itself. */
  sub?: string
  icon?: ReactNode
  /** Something new is waiting in this place.
   *
   *  It shows as a single lit point on Sol's own ring, which is the one
   *  thing on this screen that is always visible — so "is anything
   *  waiting for me?" is answered without a tap, a trip to the top of the
   *  screen, or a bell (section 29.8). */
  alert?: boolean
  onChoose: () => void
}

interface CoreNavProps {
  sections: CoreSection[]
  /**
   * A press that never leaves Sol.
   *
   * This is why the world is not one of the places in the system: it is
   * one touch away from anywhere instead of one sweep, which makes it the
   * most reachable thing in the app rather than the fifth item on a dial.
   * On the world itself it brings the camera home to you; anywhere else
   * it brings you back to the world.
   */
  onTap?: () => void
}

/** How far the thumb must travel before anything can be picked. Below
 *  this the beam has not left Sol, which is what makes the gesture safe
 *  to start by accident. */
const COMMIT_DISTANCE = 46

/** How far out the bodies sit, in px. Far enough to clear Sol's corona,
 *  close enough that the far ones stay inside a thumb's arc. */
const ORBIT = 126
/** The ring in cosmos.css opens to exactly twice this. If one moves the
 *  other has to, or the bodies stop standing on their own orbit and the
 *  gesture loses the only thing that explains it. */

/**
 * The span they occupy, in degrees, where 0 points right and 90 points
 * straight up.
 *
 * Pulled in from 164–16. At almost-horizontal the two end bodies sat at
 * very nearly Sol's own height, which on a phone means jammed into the
 * bottom corners with their names falling off the bottom edge — which is
 * exactly what happened to the last one in the row. Thirty degrees lifts
 * every body and every name clear of the edge, and costs nothing: a thumb
 * sweeps this range more comfortably than the wider one anyway.
 */
const ARC_START = 150
const ARC_END = 30

/** How close the beam has to come before a body catches it. Deliberately
 *  narrower than half the distance between two bodies, which is what
 *  leaves a real gap between them rather than a boundary. */
const CATCH_DEGREES = 15

/**
 * The path the light takes from Sol to whatever it is reaching.
 *
 * A bowed curve rather than a straight line, and the bow is what makes it
 * read as something thrown by a star rather than as a pointer drawn on
 * top of one. Light from a rotating body leaves along a curve; a ruled
 * line is a diagram of a connection, a curve is the connection happening.
 *
 * The bow always falls on the same side of the direction of travel, so
 * sweeping from one body to the next makes the arc swing across rather
 * than flip, which would read as a glitch.
 */
function flarePath(degrees: number, reach: number): string {
  const end = offsetFor(degrees, reach)
  const length = Math.hypot(end.x, end.y) || 1
  // Perpendicular to the direction of travel, one consistent way round.
  const acrossX = -end.y / length
  const acrossY = end.x / length
  // Shallower on a short throw, or a near body gets a loop instead of an
  // arc; proportional to the distance, so it looks like one gesture at
  // every angle.
  const bow = length * 0.22
  const bendX = end.x / 2 + acrossX * bow
  const bendY = end.y / 2 + acrossY * bow
  return `M0 0 Q ${bendX.toFixed(1)} ${bendY.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
}

/** Screen offset from Sol's centre.
 *  `sin` is negated exactly once, here: screen coordinates grow downwards,
 *  so a positive sine has to become a negative offset to point up. */
function offsetFor(degrees: number, radius: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180
  return { x: Math.cos(radians) * radius, y: -Math.sin(radians) * radius }
}

export function CoreNav({ sections, onTap }: CoreNavProps) {
  /* The point rides the ring rather than floating beside it, so when the
     ring opens outwards it travels with it and comes to rest ON the body
     it belongs to. The notification does not disappear and get replaced
     by a badge somewhere else — it turns out to have been sitting on that
     body's orbit the whole time. */
  const { t } = useTranslation()
  const [held, setHeld] = useState(false)
  const [hot, setHot] = useState<number | null>(null)
  /** Where the beam points, in degrees, or null while it is still inside
   *  Sol. Kept apart from `hot` so the beam can reach into a gap and
   *  light nothing — which is the whole point of having gaps. */
  const [aim, setAim] = useState<number | null>(null)
  const coreRef = useRef<HTMLDivElement>(null)
  const origin = useRef({ x: 0, y: 0 })
  /** Whether the thumb ever left Sol. A press that did not is a tap, and
   *  a tap means something different from a sweep that chose nothing. */
  const travelled = useRef(false)

  function angleFor(index: number): number {
    if (sections.length === 1) return 90
    return ARC_START + (index * (ARC_END - ARC_START)) / (sections.length - 1)
  }

  function pick(degrees: number): number | null {
    let best: number | null = null
    let bestGap = CATCH_DEGREES
    sections.forEach((_, index) => {
      const gap = Math.abs(shortestAngle(degrees, angleFor(index)))
      if (gap < bestGap) {
        bestGap = gap
        best = index
      }
    })
    return best
  }

  function onPointerDown(event: React.PointerEvent) {
    event.stopPropagation()
    const box = coreRef.current?.getBoundingClientRect()
    if (!box) return
    origin.current = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    setHeld(true)
    setHot(null)
    setAim(null)
    travelled.current = false
    navigator.vibrate?.(10)
    coreRef.current?.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!held) return
    event.stopPropagation()
    const dx = event.clientX - origin.current.x
    const dy = event.clientY - origin.current.y

    if (Math.hypot(dx, dy) >= COMMIT_DISTANCE) travelled.current = true

    if (Math.hypot(dx, dy) < COMMIT_DISTANCE) {
      setAim(null)
      if (hot !== null) setHot(null)
      return
    }

    // Same convention as offsetFor: y is flipped once and never again.
    const degrees = (Math.atan2(-dy, dx) * 180) / Math.PI
    setAim(degrees)

    const next = pick(degrees)
    if (next !== hot) {
      setHot(next)
      // A tick as the beam lands, so the choice can be felt without
      // looking. Nothing when it leaves into a gap: silence is the
      // feedback there.
      if (next !== null) navigator.vibrate?.(8)
    }
  }

  function onPointerUp(event: React.PointerEvent) {
    if (!held) return
    event.stopPropagation()
    setHeld(false)
    setAim(null)
    const chosen = hot
    setHot(null)
    if (chosen !== null) {
      navigator.vibrate?.(14)
      sections[chosen].onChoose()
      return
    }
    // Never left Sol: a tap. Letting go out in a gap is a different
    // thing and deliberately does nothing at all.
    if (!travelled.current) {
      navigator.vibrate?.(10)
      onTap?.()
    }
  }

  // The flare stops short of a body it is lighting, so the light looks
  // like it is entering rather than crossing over the top of it. Reaching
  // into a gap it overshoots instead, which is how empty space is made to
  // feel empty rather than broken.
  const flare = aim === null ? null : flarePath(aim, hot === null ? ORBIT + 20 : ORBIT - 34)

  return (
    <div className={`cos-core-area${held ? ' is-open' : ''}`} data-chrome>
      {/* The orbit. Outside the held-only block on purpose: it is visible
          at rest as a close halo, and opening it out to where the bodies
          stand is the whole explanation of what holding Sol does. */}
      <div className="cos-core-ring" aria-hidden="true" />

      {sections.map((section, index) =>
        section.alert ? (
          <span
            className="cos-core-mark"
            key={`mark-${section.id}`}
            aria-hidden="true"
            style={
              {
                // The angle is the body's own. The radius is a variable
                // the stylesheet changes when the ring opens, which is
                // what carries the point outwards with it.
                '--mark-angle': `${angleFor(index)}deg`,
              } as React.CSSProperties
            }
          />
        ) : null,
      )}

      {held && (
        <>
          <div className="cos-core-veil" aria-hidden="true" />

          {/* The light on its way. Under the bodies, so it arrives at
              them rather than passing over them.

              Three strokes of the same curve: a wide blurred one that is
              the glow in the air, a mid one that is the body of the
              flare, and a hairline of near-white that is its hot core.
              One stroke cannot be both soft and sharp, and a flare that
              is only one of those is either a smear or a wire. */}
          <svg className="cos-beam" viewBox="-190 -190 380 380" aria-hidden="true">
            <defs>
              <linearGradient id="cos-flare" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ffd9a2" stopOpacity="0" />
                <stop offset="42%" stopColor="#ffc987" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#fff3dc" stopOpacity="1" />
              </linearGradient>
              <filter id="cos-flare-air" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="5" />
              </filter>
            </defs>
            {flare && (
              <g opacity={hot === null ? 0.4 : 1}>
                <path
                  d={flare}
                  fill="none"
                  stroke="url(#cos-flare)"
                  strokeWidth={hot === null ? 5 : 9}
                  strokeLinecap="round"
                  filter="url(#cos-flare-air)"
                  opacity="0.75"
                />
                <path
                  d={flare}
                  fill="none"
                  stroke="url(#cos-flare)"
                  strokeWidth={hot === null ? 1.6 : 2.8}
                  strokeLinecap="round"
                />
                {hot !== null && (
                  <path
                    d={flare}
                    fill="none"
                    stroke="#fffaf0"
                    strokeWidth="1"
                    strokeLinecap="round"
                    opacity="0.8"
                  />
                )}
              </g>
            )}
          </svg>

          <div className="cos-core-orbit" aria-hidden="true">
            {sections.map((section, index) => {
              const degrees = angleFor(index)
              const at = offsetFor(degrees, ORBIT)
              // Which side of this body faces Sol, as a background
              // position. That is where its light enters from, so a body
              // on the left is lit on its right and the system reads as
              // one star lighting four things rather than four lamps.
              const towardsSol = offsetFor(degrees + 180, 1)
              return (
                <span
                  key={section.id}
                  className={`cos-sat${hot === index ? ' is-lit' : ''}`}
                  style={
                    {
                      left: `${at.x}px`,
                      top: `${at.y}px`,
                      '--lit-x': `${50 + towardsSol.x * 42}%`,
                      '--lit-y': `${50 + towardsSol.y * 42}%`,
                    } as React.CSSProperties
                  }
                >
                  <span className="cos-sat-body">{section.icon}</span>
                  <span className="cos-sat-tag">
                    {section.name ?? section.label}
                    {section.sub && <i className="cos-sat-sub">({section.sub})</i>}
                  </span>
                </span>
              )
            })}
          </div>
        </>
      )}

      <div
        className={`cos-core${held ? ' is-held' : ''}`}
        ref={coreRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          setHeld(false)
          setHot(null)
          setAim(null)
        }}
        role="button"
        aria-label={t('sky.chooseHint')}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onTap?.()
        }}
        tabIndex={0}
      >
        <span className="cos-core-corona" aria-hidden="true" />
        <span className="cos-core-surface" aria-hidden="true" />
        <span className="cos-core-rim" aria-hidden="true" />
        <span className="cos-core-eye" aria-hidden="true" />
      </div>
    </div>
  )
}

/** The signed distance between two angles, the short way round. Without
 *  it, 350 and 10 degrees look 340 apart instead of 20. */
function shortestAngle(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180
}
