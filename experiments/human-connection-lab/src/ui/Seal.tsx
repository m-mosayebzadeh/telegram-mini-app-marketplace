/**
 * The seal — Halfway's one signature object.
 *
 * Two half-discs on the seam: the start half is yours, the end half is theirs.
 * A written half is filled; an unwritten half is a dashed outline. When both
 * are filled the halves close the gap between them and the seal is whole —
 * ready to open. Opened, the halves part and become thin outlines.
 *
 * Fill versus outline carries the meaning, so it reads without colour; the
 * accessible label says it in words.
 */

export type SealState = 'none' | 'mine' | 'theirs' | 'whole' | 'open';

const LABELS: Record<SealState, string> = {
  none: 'Neither half written',
  mine: 'Your half sealed, theirs not yet',
  theirs: 'Their half sealed, yours not yet',
  whole: 'Both halves sealed, ready to open',
  open: 'Opened',
};

interface Props {
  state: SealState;
  size?: 16 | 28 | 56;
  /** When the seal stands next to text that already says the same thing. */
  decorative?: boolean;
  className?: string;
}

export function Seal({ state, size = 28, decorative = false, className = '' }: Props) {
  const mineFilled = state === 'mine' || state === 'whole';
  const theirsFilled = state === 'theirs' || state === 'whole';
  return (
    <svg
      className={`seal seal--${state} seal--s${size} ${className}`}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : LABELS[state]}
    >
      <path className={`seal__half seal__half--mine ${mineFilled ? 'is-filled' : ''}`} d="M15 3 A13 13 0 0 0 15 29 Z" />
      <path className={`seal__half seal__half--theirs ${theirsFilled ? 'is-filled' : ''}`} d="M17 3 A13 13 0 0 1 17 29 Z" />
    </svg>
  );
}
