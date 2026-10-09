/**
 * The Cosmos mark (TECHNICAL_REQUIREMENTS.md section 43; the owner chose
 * the third direction of "Cosmos Logo Directions"): two skies that meet —
 * a warm ring and a cool ring overlapping, and a star where they meet.
 * Friendship starts where two people's worlds touch.
 *
 * Drawn here once, for every place inside the app that shows it; the same
 * shapes are in public/logo.svg and the icon files made from it.
 *
 * Only ever outside the world: on the sign-in page, as Cosmos Team's face,
 * as the app's icon. In the world a ring around a body means "online", so
 * this mark is never drawn around or near a person's body.
 *
 * `arrive` plays the approved motion once: the two rings come in from
 * either side, then the star lights. Reduced motion shows it still.
 */
export function CosmosMark({ size = 24, arrive = false, className }: { size?: number; arrive?: boolean; className?: string }) {
  return (
    <svg
      className={`cos-mark${arrive ? ' is-arriving' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="cos-mark-warm" cx="38" cy="50" r="26" fill="none" stroke="#f2b06a" strokeWidth="5.5" />
      <circle className="cos-mark-cool" cx="62" cy="50" r="26" fill="none" stroke="#7ad7c8" strokeWidth="5.5" />
      <path
        className="cos-mark-star"
        d="M50 40 L52.4 47.6 L60 50 L52.4 52.4 L50 60 L47.6 52.4 L40 50 L47.6 47.6 Z"
        fill="#fff6e8"
      />
    </svg>
  )
}
