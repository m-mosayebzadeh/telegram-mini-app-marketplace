import { useMemo } from 'react'
import type { CSSProperties } from 'react'

/**
 * The sky behind everything.
 *
 * Two jobs. The gradient stops the screen reading as a flat dark
 * rectangle — light comes from the middle of the sky, the way it would if
 * there were something out there. And three layers of dust move at
 * different rates while the world is dragged, which is most of what makes
 * the space feel like a space rather than a picture of one.
 *
 * Parallax is done by the PAGE, not here: this component lays the dust
 * out once and never touches it again. The screen that owns the camera
 * moves the three layers with one style write each, which is what keeps a
 * cheap phone smooth.
 */

/** Near, middle, far. The factors are how much each layer moves relative
 *  to the camera; the far one barely moves, which is what reads as
 *  distance. */
export const DUST_LAYERS = [0.55, 0.3, 0.14] as const

const DOTS_PER_LAYER = [26, 34, 44] as const
const FIELD = 2600

export interface SpaceGroundProps {
  /** Same seed, same sky. Fixed by default so the world someone comes
   *  back to is the world they left. */
  seed?: number
}

export function SpaceGround({ seed = 7 }: SpaceGroundProps) {
  const layers = useMemo(() => buildLayers(seed), [seed])

  return (
    <>
      <div className="cos-ground" />
      {layers.map((dots, index) => (
        <div
          className="cos-dust"
          data-dust-layer={index}
          data-parallax={DUST_LAYERS[index]}
          key={index}
        >
          {dots.map((dot, dotIndex) => (
            <i key={dotIndex} style={dot} />
          ))}
        </div>
      ))}
    </>
  )
}

function buildLayers(seed: number): CSSProperties[][] {
  const random = seededRandom(seed)
  return DOTS_PER_LAYER.map((count, layer) =>
    Array.from({ length: count }, () => {
      // Nearer dust is bigger and brighter. It is the same trick the orbs
      // use, and it is why the two read as being in the same space.
      const nearness = 1 - layer * 0.32
      const size = (0.9 + random() * 1.7) * nearness
      return {
        left: `${(random() - 0.5) * FIELD}px`,
        top: `${(random() - 0.5) * FIELD}px`,
        width: `${size.toFixed(2)}px`,
        height: `${size.toFixed(2)}px`,
        opacity: (0.1 + random() * 0.4 * nearness).toFixed(2),
      } as CSSProperties
    }),
  )
}

/**
 * A small deterministic generator.
 *
 * Deliberately not Math.random: the sky has to be the same on every visit
 * and on every device, or the world stops being a place. Mulberry32 —
 * short, fast, and good enough for scattering dust.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
