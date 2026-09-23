/**
 * The world's own icons.
 *
 * Drawn here rather than taken from a set, because a borrowed icon set is
 * a second visual identity arguing with the first one — and because the
 * things this app names (Echo, Photon) do not exist in anybody's set.
 *
 * Four rules, so that six icons look like six of the same thing:
 *
 * 1. **One stroke weight, never a fill.** 1.8 at 24, scaled with the box.
 *    Filled shapes read as heavier than the type around them, and this
 *    interface is built out of thin light.
 *
 *    A fifth rule, learned the hard way: **nothing inside an icon goes
 *    below 0.6 opacity.** These were drawn with faint outer rings meant to
 *    read as depth. At thirty pixels on a night sky there is no depth to
 *    read — a shape at a third of its colour simply looks like a shape
 *    that failed to print, and the whole mark reads as washed out. The
 *    mark you have not chosen still has to be recognisable.
 * 2. **Circles and arcs only.** No corners anywhere. The whole language is
 *    bodies and orbits; a rectangle in it looks imported.
 * 3. **One centre.** Every icon is built outward from the middle of its
 *    box, so a row of them sits on one optical line without nudging.
 * 4. **Colour comes from the text around them** — `currentColor`, always.
 *    An icon that carries its own colour is a second accent nobody asked
 *    for, and this system has exactly three lights.
 *
 * Each icon is also a drawing of what the thing DOES, never a metaphor
 * borrowed from somewhere else. Echo is a call going out and one coming
 * back; that is the feature, not a picture of a speaker.
 */

interface IconProps {
  /** Box size in px. 24 is the drawn size; anything else scales the
   *  stroke with it so the weight stays optically the same. */
  size?: number
  className?: string
}

/**
 * Echo — two reaching for each other.
 *
 * Mirrored arcs closing on a lit point between them. Not a broadcast and
 * not a radar sweep: this is two strangers meeting in the middle, which
 * is what the feature is actually for. The near-symmetry is why it still
 * reads when it is small, and the lit point is why it is not just a pair
 * of brackets.
 *
 * Chosen over three alternatives by looking at all four at real size on a
 * real phone (the comparison page, /echo-icons, is deletable now).
 */
export function IconEcho({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
      className={className} aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <path d="M7.6 8a5.4 5.4 0 0 1 0 8" />
      <path d="M16.4 8a5.4 5.4 0 0 0 0 8" />
      <path d="M4.4 5.2a9.6 9.6 0 0 1 0 13.6" opacity="0.62" />
      <path d="M19.6 5.2a9.6 9.6 0 0 0 0 13.6" opacity="0.62" />
    </svg>
  )
}

/**
 * Conversations — two voices, overlapping.
 *
 * Two rings that cross, with the shared part left open. Not two speech
 * bubbles: a bubble has a tail and a corner, and neither belongs in a
 * world made of bodies and orbits.
 */
export function IconChats({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
      className={className} aria-hidden="true"
    >
      <circle cx="9.2" cy="12" r="6.2" />
      <circle cx="14.8" cy="12" r="6.2" opacity="0.72" />
    </svg>
  )
}

/**
 * Activity — what has happened around you, as rings of time.
 *
 * Three arcs at growing radius, all opening the same way, with one lit
 * point sitting on the middle one. The point is the event; the rings are
 * how long ago. It is the same idea the world itself uses, which is why
 * it reads without being taught.
 */
export function IconActivity({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
      className={className} aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 7.6a4.4 4.4 0 1 1-4.4 4.4" />
      <path d="M12 3.6a8.4 8.4 0 1 1-8.4 8.4" opacity="0.62" />
      <circle cx="16.4" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * You — a light with one closed orbit around it.
 *
 * Deliberately the only icon in the set whose ring is unbroken. Echo's
 * arcs are open because a call is going somewhere; yours is closed
 * because it is where you already are.
 */
export function IconMe({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
      className={className} aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="7.8" />
    </svg>
  )
}

/**
 * The world — bodies at different distances.
 *
 * Four points of different sizes around an unmarked centre, which is the
 * sky's own arrangement in miniature: nothing at the middle, because the
 * middle is wherever you are standing.
 */
export function IconWorld({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8}
      className={className} aria-hidden="true"
    >
      <circle cx="12" cy="6.4" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="14" r="1.6" fill="currentColor" stroke="none" opacity="0.85" />
      <circle cx="7" cy="15.4" r="2.8" fill="currentColor" stroke="none" opacity="0.7" />
      <circle cx="15" cy="19.6" r="1.2" fill="currentColor" stroke="none" opacity="0.6" />
    </svg>
  )
}
