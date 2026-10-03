import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { DUST_LAYERS, seededRandom } from './spaceDust'

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
      // Same draws in the same order as always, so the sky stays the sky.
      const x = (random() - 0.5) * FIELD
      const y = (random() - 0.5) * FIELD
      return {
        left: `${x}px`,
        top: `${y}px`,
        width: `${size.toFixed(2)}px`,
        height: `${size.toFixed(2)}px`,
        opacity: (0.1 + random() * 0.4 * nearness).toFixed(2),
        // For a journey between places: which way this speck streaks
        // (straight out from the middle) and how far — further out and
        // nearer streaks longer, as the prototype's stars do.
        '--cos-streak-angle': `${((Math.atan2(y, x) * 180) / Math.PI).toFixed(1)}deg`,
        '--cos-streak-length': (1 + Math.min(14, Math.hypot(x, y) * 0.012 * nearness)).toFixed(2),
      } as CSSProperties
    }),
  )
}
