import type { CSSProperties } from 'react'

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
  /** Seconds for one drift cycle, and how far into it to start. Given per
   *  orb so a sky never breathes in unison. */
  driftSeconds?: number
  driftDelaySeconds?: number
  className?: string
}

export function Orb({
  initial = '',
  presence,
  trust,
  online = false,
  isNew = false,
  seed = 0,
  lightFrom = { x: 0, y: -1 },
  driftSeconds,
  driftDelaySeconds = 0,
  className,
}: OrbProps) {
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
      <span className="cos-orb">{initial}</span>
    </div>
  )
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

export const ORB_MIN_SIZE = MIN_SIZE
export const ORB_MAX_SIZE = MAX_SIZE
export const ORB_BODY_COUNT = BODIES.length
