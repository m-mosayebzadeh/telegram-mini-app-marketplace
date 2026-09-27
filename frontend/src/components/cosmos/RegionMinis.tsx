/**
 * A small living piece of each region, standing in its place on Sol's arc.
 *
 * These replace the spheres that stood there before: a sphere is how a
 * PERSON is drawn in this world, and anything that is not a person must
 * never look like one (the orb principle, TECHNICAL_REQUIREMENTS.md section
 * 30.1). Each preview moves its own way — threads that tremble, a hole that
 * turns, two lights looking for each other, a light that breathes — so the
 * places differ in motion as well as in colour, and never by colour alone
 * (section 30.4).
 */

/** Conversations: people held by trembling threads. */
export function MiniTalk() {
  return (
    <span className="cos-mini" aria-hidden="true">
      <svg viewBox="-29 -29 58 58" width="58" height="58">
        <g className="cos-mini-tremble" stroke="#8fe8ff" strokeWidth="1.4" fill="none" strokeLinecap="round">
          <path d="M-14 8 L-3 -1 L2 -12" />
          <path d="M-3 -1 L14 6" />
          <path d="M-3 -1 L-16 -10" />
        </g>
        <g fill="#e7dcff">
          <circle cx="2" cy="-12" r="3" />
          <circle cx="14" cy="6" r="3" />
          <circle cx="-16" cy="-10" r="3" />
          <circle cx="-14" cy="8" r="2.4" />
          <circle cx="-3" cy="-1" r="3.6" fill="#ffe2a6" />
        </g>
      </svg>
    </span>
  )
}

/** News: a small turning wormhole, with how many things came out of it. */
export function MiniNews({ count }: { count: number }) {
  return (
    <span className="cos-mini" aria-hidden="true">
      <span className="cos-mini-hole" />
      <span className="cos-mini-core" />
      {count > 0 && <span className="cos-mini-count">{count}</span>}
    </span>
  )
}

/** Echo: two lights that keep almost finding each other. */
export function MiniEcho() {
  return (
    <span className="cos-mini" aria-hidden="true">
      <span className="cos-mini-dot is-a" />
      <span className="cos-mini-dot is-b" />
    </span>
  )
}

/** You: your own light, breathing inside a quiet ring. */
export function MiniMe() {
  return (
    <span className="cos-mini" aria-hidden="true">
      <span className="cos-mini-ring" />
      <span className="cos-mini-gold" />
    </span>
  )
}
