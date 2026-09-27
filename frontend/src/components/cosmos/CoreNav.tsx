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
  /** The region's own light, as a CSS colour. Its preview glows in it and
   *  its name takes it when chosen — one colour per place, never the only
   *  thing that tells places apart (each preview also moves its own way). */
  tone?: string
  onChoose: () => void
}

/** News gathered beside Sol: a small red galaxy with a count. */
export interface CoreBadge {
  count: number
  label: string
  onOpen: () => void
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
   * it brings you back to the world. Once you are already home, a tap opens
   * the menu instead — return 'menu' for that — and a second tap on a place
   * goes there (section 30.12). A tap is always one step closer to the
   * menu, and holding and sweeping stays the fast way for whoever learned it.
   */
  onTap?: () => 'menu' | void
  /** News waiting, shown beside Sol as a small red galaxy with a count. */
  badge?: CoreBadge
}

/** How far the thumb must travel before anything can be picked. Below
 *  this the beam has not left Sol, which is what makes the gesture safe
 *  to start by accident. */
const COMMIT_DISTANCE = 46

/** How far out the bodies sit, in px. Far enough to clear Sol's corona,
 *  close enough that the far ones stay inside a thumb's arc. */
const ORBIT = 122
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

/** Screen offset from Sol's centre.
 *  `sin` is negated exactly once, here: screen coordinates grow downwards,
 *  so a positive sine has to become a negative offset to point up. */
function offsetFor(degrees: number, radius: number): { x: number; y: number } {
  const radians = (degrees * Math.PI) / 180
  return { x: Math.cos(radians) * radius, y: -Math.sin(radians) * radius }
}

export function CoreNav({ sections, onTap, badge }: CoreNavProps) {
  /* The point rides the ring rather than floating beside it, so when the
     ring opens outwards it travels with it and comes to rest ON the body
     it belongs to. The notification does not disappear and get replaced
     by a badge somewhere else — it turns out to have been sitting on that
     body's orbit the whole time. */
  const { t } = useTranslation()
  const [held, setHeld] = useState(false)
  const [hot, setHot] = useState<number | null>(null)
  /** Opened by a tap rather than a hold: the places become buttons. */
  const [menuOpen, setMenuOpen] = useState(false)
  /** Whether this press began with the menu already open — then a tap on
   *  Sol closes it rather than doing anything else. */
  const openedBefore = useRef(false)
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
    travelled.current = false
    openedBefore.current = menuOpen
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
      if (hot !== null) setHot(null)
      return
    }

    // Same convention as offsetFor: y is flipped once and never again.
    const degrees = (Math.atan2(-dy, dx) * 180) / Math.PI

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
    const chosen = hot
    setHot(null)
    if (chosen !== null) {
      navigator.vibrate?.(14)
      setMenuOpen(false)
      sections[chosen].onChoose()
      return
    }
    // Never left Sol: a tap. Letting go out in a gap is a different
    // thing and deliberately does nothing at all.
    if (!travelled.current) {
      navigator.vibrate?.(10)
      if (openedBefore.current) { setMenuOpen(false); return }
      if (onTap?.() === 'menu') setMenuOpen(true)
    } else {
      setMenuOpen(false)
    }
  }

  const open = held || menuOpen

  return (
    <div className={`cos-core-area${open ? ' is-open' : ''}${menuOpen ? ' is-tapmode' : ''}`} data-chrome>
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

      {open && (
        <>
          {/* A tap on the dark closes a menu opened by a tap. */}
          <div className="cos-core-veil" aria-hidden="true" onClick={() => setMenuOpen(false)} />

          <div className="cos-core-orbit" aria-hidden={!menuOpen}>
            {sections.map((section, index) => {
              const degrees = angleFor(index)
              const at = offsetFor(degrees, ORBIT)
              // Which side of this body faces Sol, as a background
              // position. That is where its light enters from, so a body
              // on the left is lit on its right and the system reads as
              // one star lighting four things rather than four lamps.
              const towardsSol = offsetFor(degrees + 180, 1)
              return (
                <button
                  type="button"
                  key={section.id}
                  className={`cos-sat${hot === index ? ' is-lit' : ''}`}
                  tabIndex={menuOpen ? 0 : -1}
                  aria-label={section.name ?? section.label}
                  onClick={() => {
                    // Only a menu opened by a tap answers clicks; a held
                    // menu chooses by letting go.
                    if (!menuOpen) return
                    navigator.vibrate?.(14)
                    setMenuOpen(false)
                    section.onChoose()
                  }}
                  style={
                    {
                      left: `${at.x}px`,
                      top: `${at.y}px`,
                      '--lit-x': `${50 + towardsSol.x * 42}%`,
                      '--lit-y': `${50 + towardsSol.y * 42}%`,
                      '--tone': section.tone ?? 'var(--cos-warm)',
                    } as React.CSSProperties
                  }
                >
                  <span className="cos-sat-body">{section.icon}</span>
                  <span className="cos-sat-tag">
                    {section.name ?? section.label}
                    {section.sub && <i className="cos-sat-sub">({section.sub})</i>}
                  </span>
                </button>
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

      {badge && badge.count > 0 && !open && (
        <button type="button" className="cos-news-badge" onClick={badge.onOpen} aria-label={badge.label}>
          <span className="cos-news-badge-hole" aria-hidden="true" />
          <span className="cos-news-badge-count">{badge.count}</span>
        </button>
      )}
    </div>
  )
}

/** The signed distance between two angles, the short way round. Without
 *  it, 350 and 10 degrees look 340 apart instead of 20. */
function shortestAngle(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180
}
