/**
 * The dust of the night sky: its three depths, and the generator that
 * scatters it the same way on every visit.
 *
 * Kept apart from SpaceGround.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/** Near, middle, far. The factors are how much each layer moves relative
 *  to the camera; the far one barely moves, which is what reads as
 *  distance. */
export const DUST_LAYERS = [0.55, 0.3, 0.14] as const

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
