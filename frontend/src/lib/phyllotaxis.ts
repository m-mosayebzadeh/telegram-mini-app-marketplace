/**
 * Where each person stands in the sky.
 *
 * The arrangement is the sunflower-seed pattern: each place is one golden
 * angle around from the last, at a radius that grows with the square root
 * of the index. Three things fall out of that one formula, and the world
 * needs all three (TECHNICAL_REQUIREMENTS.md section 23.3):
 *
 *   - even spacing, with no crowding at the middle or gaps at the edge
 *   - nothing ever overlaps, at any count
 *   - the screen is always full, whether ten people are here or a
 *     thousand
 *
 * What it does NOT encode is distance. Position is RANK — first in the
 * list stands nearest — which is what makes the world safe to draw: you
 * cannot work out where anybody is from where they sit, because the
 * answer is "first, second, third" and nothing else.
 */

/** The golden angle. Any other angle produces visible spokes and rings;
 *  this one is the reason the pattern looks organic. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** How far apart the places are. Tuned against the orb sizes so the
 *  nearest few have room to breathe and nothing collides. */
// Raised from 96: at the old value a field of thirty orbs read as a
// crowd with their names running into each other's bodies. Space is what
// makes a group of things look arranged rather than spilled.
const SPACING = 124

/** A small offset so the first person is not exactly on top of the
 *  viewer's own position at the centre. */
const INNER = 1.7

export interface Placed {
  x: number
  y: number
  /** 0 nearest, rising outwards. The depth layer is chosen from this, so
   *  depth adds no new meaning — it is the same nearness, seen from the
   *  side. */
  rank: number
  layer: number
}

/** Ranks 0-7 are the near layer, 8-17 the middle, the rest far. The
 *  boundaries are where the prototype settled: near enough that the
 *  closest faces move convincingly, far enough that the back of the sky
 *  stays calm. */
export function layerOf(rank: number): number {
  if (rank < 8) return 0
  if (rank < 18) return 1
  return 2
}

/** How much each layer moves relative to the camera. Greater than one
 *  for the near layer: things close to you sweep PAST you when you move,
 *  which is the whole illusion. */
export const LAYER_DEPTH = [1.09, 1.0, 0.93] as const

export function place(count: number): Placed[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = index * GOLDEN_ANGLE
    const radius = SPACING * Math.sqrt(index + INNER)
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      rank: index,
      layer: layerOf(index),
    }
  })
}

/**
 * The unit vector from a point towards the middle of the sky.
 *
 * Every orb is lit from the centre rather than from a fixed angle, which
 * is the single thing that turns a scattering of circles into objects in
 * one lit scene.
 */
export function lightTowardsCentre(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y) || 1
  return { x: -x / length, y: -y / length }
}
