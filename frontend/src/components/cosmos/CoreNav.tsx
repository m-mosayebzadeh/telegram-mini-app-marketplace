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

/** Screen offset from Sol's centre.
 *  `sin` is negated exactly once, here: screen coordinates grow downwards,
 *  so a positive sine has to become a negative offset to point up. */
function offsetFor(degrees: number, radius: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180
  return { x: Math.cos(radians) * radius, y: -Math.sin(radians) * radius }
}

export function CoreNav({ sections, onTap }: CoreNavProps) {
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

  // The beam stops short of a body it is lighting, so the light looks
  // like it is entering rather than crossing over the top of it.
  const beam = aim === null ? null : offsetFor(aim, hot === null ? ORBIT + 18 : ORBIT - 30)

  return (
    <div className={`cos-core-area${held ? ' is-open' : ''}`} data-chrome>
      {held && (
        <>
          <div className="cos-core-veil" aria-hidden="true" />

          {/* The light on its way. Under the bodies, so it arrives at
              them rather than passing over them. */}
          <svg className="cos-beam" viewBox="-170 -170 340 340" aria-hidden="true">
            <defs>
              <linearGradient id="cos-beam-fade" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--cos-warm)" stopOpacity="0" />
                <stop offset="100%" stopColor="var(--cos-warm)" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            {beam && (
              <line
                x1="0"
                y1="0"
                x2={beam.x}
                y2={beam.y}
                stroke="url(#cos-beam-fade)"
                strokeWidth={hot === null ? 1.5 : 2.5}
                strokeLinecap="round"
                opacity={hot === null ? 0.45 : 1}
              />
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
        <span className="cos-core-surface" aria-hidden="true" />
        <span className="cos-core-corona" aria-hidden="true" />
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
