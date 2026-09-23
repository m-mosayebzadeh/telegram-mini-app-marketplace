/**
 * Four ways of drawing Echo, so the choice can be made by looking rather
 * than by reading a description.
 *
 * All four obey the set's rules — one stroke weight, circles and arcs
 * only, built outward from one centre, colour taken from the text around
 * them — so the difference between them is the IDEA, not the styling.
 *
 * Delete the three that lose.
 */

interface IconProps {
  size?: number
  className?: string
}

function frame(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    'aria-hidden': true as const,
  }
}

/**
 * A — call and answer.
 *
 * A lit voice, three arcs leaving one side, one short arc returning on
 * the other. The asymmetry is the argument: this is not a broadcast and
 * not a radar sweep, it is one person calling and one answering. The
 * returning arc is short because an answer arrives before it is finished.
 */
export function EchoA({ size = 24, className }: IconProps) {
  return (
    <svg {...frame(size)} className={className}>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8" opacity="0.9" />
      <path d="M18 6a8.5 8.5 0 0 1 0 12" opacity="0.55" />
      <path d="M20.6 3.4a12.1 12.1 0 0 1 0 17.2" opacity="0.25" />
      <path d="M8.6 9.4a4.8 4.8 0 0 0 0 5.2" opacity="0.9" />
    </svg>
  )
}

/**
 * B — two reaching for each other.
 *
 * Mirrored arcs closing on a lit point between them. Says "two strangers
 * meeting in the middle" rather than "a signal" — which is closer to what
 * the feature is actually for, and reads at small sizes because it is
 * almost symmetrical.
 */
export function EchoB({ size = 24, className }: IconProps) {
  return (
    <svg {...frame(size)} className={className}>
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <path d="M7.6 8a5.4 5.4 0 0 1 0 8" opacity="0.9" />
      <path d="M16.4 8a5.4 5.4 0 0 0 0 8" opacity="0.9" />
      <path d="M4.4 5.2a9.6 9.6 0 0 1 0 13.6" opacity="0.35" />
      <path d="M19.6 5.2a9.6 9.6 0 0 0 0 13.6" opacity="0.35" />
    </svg>
  )
}

/**
 * C — the way round.
 *
 * A ring broken at one side, with a lit point travelling it. The sound
 * leaves, goes all the way round, and comes back changed. The single
 * closed shape is the easiest of the four to recognise at 20px, which is
 * the size that actually matters.
 */
export function EchoC({ size = 24, className }: IconProps) {
  return (
    <svg {...frame(size)} className={className}>
      <path d="M12 4.2a7.8 7.8 0 1 1-5.5 2.3" opacity="0.85" />
      <circle cx="12" cy="4.2" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" opacity="0.4" />
    </svg>
  )
}

/**
 * D — a call into the dark.
 *
 * Rings spreading from a point placed off to one side, so the shape has a
 * direction and does not read as the wireless symbol everybody already
 * owns. The most immediately legible of the four, and the least specific
 * to this product — worth weighing against each other.
 */
export function EchoD({ size = 24, className }: IconProps) {
  return (
    <svg {...frame(size)} className={className}>
      <circle cx="7.4" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <path d="M11.4 8.4a5.4 5.4 0 0 1 0 7.2" opacity="0.85" />
      <path d="M14.6 5.6a9.4 9.4 0 0 1 0 12.8" opacity="0.5" />
      <path d="M17.8 2.8a13.4 13.4 0 0 1 0 18.4" opacity="0.22" />
    </svg>
  )
}

export const ECHO_OPTIONS = [
  { id: 'A', Icon: EchoA, idea: 'صدا می‌رود، جواب برمی‌گردد' },
  { id: 'B', Icon: EchoB, idea: 'دو نفر به هم می‌رسند' },
  { id: 'C', Icon: EchoC, idea: 'می‌رود، دور می‌زند، برمی‌گردد' },
  { id: 'D', Icon: EchoD, idea: 'صدا زدن در تاریکی' },
] as const
