import { useState, type CSSProperties } from 'react'

/**
 * How the world draws a person.
 *
 * Every number here is a meaning, and each one rides on a different visual
 * property so they can never be confused for one another
 * (TECHNICAL_REQUIREMENTS.md section 22):
 *
 *   presence -> SIZE      how alive this person has been lately
 *   trust    -> GLOW      a history of sessions that ended well
 *   online   -> RING      here right now, and nothing else
 *   moons    -> MOONS     up to three: they have something to show
 *
 * Position is not here. Where an orb sits is the sky's decision, because
 * it is about this person's relationship to the VIEWER rather than about
 * the person — and the same person sits somewhere different in somebody
 * else's sky.
 *
 * Money is deliberately absent: an orb never shows that its person sells
 * anything (section 26).
 */

/** Presence is kept in a narrow band on purpose. If the range were wide,
 *  a few people would tower over the sky and everybody else would stop
 *  trying — and "who is biggest" is not a competition this product wants
 *  to run. */
const MIN_SIZE = 44
const MAX_SIZE = 76

/** The colours an orb's body is made of. Not meaningful — two people with
 *  the same colours have nothing in common; it exists so a sky of fifty
 *  people does not read as fifty copies of one thing. */
const BODIES: ReadonlyArray<readonly [string, string]> = [
  ['#2f6f68', '#14403d'],
  ['#3a5a70', '#1a2c3a'],
  ['#7a5238', '#33201a'],
  ['#4a3d57', '#221a2b'],
  ['#2f5a4a', '#152b24'],
  ['#6e3c46', '#2b171d'],
]

export interface OrbProps {
  /** Shown inside the orb: the first letter of a name. Empty for someone
   *  who is not identified — an anonymous galaxy, or a stranger before
   *  you have chosen to look. */
  initial?: string
  /** 0..1 — how present this person has been lately. */
  presence: number
  /** 0..1 — how much history they have behind them. */
  trust: number
  online?: boolean
  /** Brand new: shown as unwritten rather than dim, because dim reads as
   *  rejected and nobody has rejected them. */
  isNew?: boolean
  /** Picks the body colours. Any stable number per person does — an id. */
  seed?: number
  /** Where the light comes from, as a unit vector pointing at the source.
   *  In a galaxy that is its core; on a screen with no galaxy, straight
   *  up. Passing it is what makes a group of orbs read as one lit scene
   *  instead of a row of stickers. */
  lightFrom?: { x: number; y: number }
  /**
   * Their photograph, and whether this orb is near enough to be worth
   * fetching it.
   *
   * Detail arrives with proximity (TECHNICAL_REQUIREMENTS.md section 29):
   * a face is the most expensive thing on the screen and the least useful
   * at the far edge, so a distant orb never asks for one. Nothing is
   * pre-loaded and nothing is waited for — the sky is complete before any
   * photograph exists, and each one fades in over the body it lands on.
   */
  photoUrl?: string | null
  near?: boolean
  /** Seconds for one drift cycle, and how far into it to start. Given per
   *  orb so a sky never breathes in unison. */
  driftSeconds?: number
  driftDelaySeconds?: number
  /** 0 to 3 moons: this person has something to show, content or offers
   *  alike, never "this one sells" (section 29.14). Only drawn when near:
   *  from a distance they would be specks nobody can read, and a hundred
   *  small animations for nothing. */
  moons?: number
  className?: string
}

export function Orb({
  initial = '',
  presence,
  trust,
  online = false,
  isNew = false,
  seed = 0,
  photoUrl = null,
  near = false,
  lightFrom = { x: 0, y: -1 },
  driftSeconds,
  driftDelaySeconds = 0,
  moons = 0,
  className,
}: OrbProps) {
  // Only flips once, when the bytes are actually there. Until then the
  // body shows through, which is why nothing ever looks like it is
  // waiting for a network.
  const [arrived, setArrived] = useState(false)
  // Once a face has been asked for it stays in the document forever, and
  // only its opacity follows the camera. Unmounting it on the way out
  // would throw the bytes away, snap it off screen instead of letting it
  // fade, and fetch it all over again on the way back.
  const [asked, setAsked] = useState(false)
  const has = photoUrl !== null && photoUrl !== ''
  if (near && has && !asked) setAsked(true)
  const showPhoto = arrived && near && has

  const clamped = clamp01(presence)
  const size = Math.round(MIN_SIZE + clamped * (MAX_SIZE - MIN_SIZE))
  const light = clamp01(trust)
  const [a, b] = BODIES[Math.abs(Math.trunc(seed)) % BODIES.length]

  const style = {
    '--orb-size': `${size}px`,
    // The highlight sits on the side the light comes from, and the inner
    // shadow on the opposite one. Together they are what turns a flat
    // circle into something round.
    '--orb-hx': `${Math.round(50 + lightFrom.x * 27)}%`,
    '--orb-hy': `${Math.round(50 + lightFrom.y * 27)}%`,
    '--orb-inset-x': `${(-lightFrom.x * 7).toFixed(1)}px`,
    '--orb-inset-y': `${(-lightFrom.y * 7).toFixed(1)}px`,
    '--orb-shine': (0.06 + light * 0.5).toFixed(2),
    // Trust only spills past the edge once there is some, so a newcomer
    // is never surrounded by a halo they have not earned.
    '--orb-glow': light > 0.6 ? light.toFixed(2) : '0',
    '--orb-tint': '122 215 200',
    '--orb-a': a,
    '--orb-b': b,
    ...(driftSeconds
      ? {
          animationDuration: `${driftSeconds}s`,
          animationDelay: `${-driftDelaySeconds}s`,
        }
      : {}),
  } as CSSProperties

  return (
    <div
      className={[
        'cos-orb-wrap',
        driftSeconds ? 'cos-drift' : '',
        isNew ? 'cos-orb-new' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      {online && (
        <>
          <span className="cos-orb-live" aria-hidden="true" />
          <span className="cos-orb-live-pulse" aria-hidden="true" />
        </>
      )}
      {near && moons > 0 && <Moons count={Math.min(3, moons)} size={size} seed={seed} />}
      <span className="cos-orb">
        {/* The letter stays underneath. A photograph that never arrives
            leaves something legible behind rather than a grey disc. */}
        {initial}
        {asked && (
          <img
            className={`cos-orb-photo${showPhoto ? ' is-here' : ''}`}
            src={photoUrl ?? undefined}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setArrived(true)}
          />
        )}
      </span>
    </div>
  )
}

/**
 * The moons, each on its own tilted orbit.
 *
 * Each one travels along an ellipse drawn as a CSS path, so the browser
 * moves it by itself — nothing here is written frame by frame, which keeps
 * the world's rule of seven style writes per frame intact. Half of every
 * orbit passes in front of the body and half behind it, which is what makes
 * three dots read as moons rather than as decoration stuck on top.
 *
 * Radius, speed and starting point differ per moon and per person (from
 * the seed), so two people's moons never move in step.
 */
/** How far off level the orbits lean, in radians. */
const TILT = (-18 * Math.PI) / 180

function Moons({ count, size, seed }: { count: number; size: number; seed: number }) {
  return (
    <span className="cos-moons" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => {
        const rx = size / 2 + 13 + index * 8
        const ry = rx * 0.5
        const seconds = 9 + index * 4.5 + (Math.abs(seed) % 5) * 0.4
        const start = ((Math.abs(seed) * 37 + index * 131) % 100) / 100
        // The tilt is drawn into the path itself. Rotating the whole group
        // instead would make it a stacking layer of its own, and the moons
        // could then never pass in front of the body.
        const ex = Math.round(rx * Math.cos(TILT) * 10) / 10
        const ey = Math.round(rx * Math.sin(TILT) * 10) / 10
        const degrees = ((TILT * 180) / Math.PI).toFixed(1)
        const style = {
          offsetPath: `path('M ${-ex} ${-ey} A ${rx} ${ry.toFixed(1)} ${degrees} 1 0 ${ex} ${ey} A ${rx} ${ry.toFixed(1)} ${degrees} 1 0 ${-ex} ${-ey}')`,
          animationDuration: `${seconds.toFixed(1)}s`,
          animationDelay: `${(-start * seconds).toFixed(2)}s`,
          '--moon-size': `${6 + ((index + Math.abs(seed)) % 3)}px`,
        } as CSSProperties
        return (
          <span className="cos-moon" key={index} style={style}>
            <i />
          </span>
        )
      })}
    </span>
  )
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export const ORB_MIN_SIZE = MIN_SIZE
export const ORB_MAX_SIZE = MAX_SIZE
export const ORB_BODY_COUNT = BODIES.length
