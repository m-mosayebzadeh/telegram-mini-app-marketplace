/**
 * How big an orb is drawn (size means presence; CLAUDE.md, one meaning per
 * visual property).
 *
 * Kept apart from Orb.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/** Presence is kept in a narrow band on purpose. If the range were wide,
 *  a few people would tower over the sky and everybody else would stop
 *  trying — and "who is biggest" is not a competition this product wants
 *  to run. */
export const ORB_MIN_SIZE = 44
export const ORB_MAX_SIZE = 76

/** A presence or trust value held to 0..1, with a broken one read as 0. */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** How big somebody's orb is drawn, from their presence — the one copy of
 *  that arithmetic, for anything placed relative to an orb. */
export function orbSize(presence: number): number {
  return Math.round(ORB_MIN_SIZE + clamp01(presence) * (ORB_MAX_SIZE - ORB_MIN_SIZE))
}
