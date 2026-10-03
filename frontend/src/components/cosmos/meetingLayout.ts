/**
 * Where each star sits in "where two skies meet" (section 32).
 *
 * Kept apart from Constellation.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/** The sky is drawn on a fixed 360-wide canvas and scales to the screen. */
export const SKY_WIDTH = 360

export interface Point {
  x: number
  y: number
}

/** How many of each side the meeting picture shows. */
export const MEET_SIDE = 4

export const MEET_SHARED = 4

/**
 * Their sky on the right (the page runs right to left, and it is their
 * page), yours on the left, the shared ones down the middle.
 */
export function meetingLayout(theirs: number, mine: number, shared: number) {
  const t = Math.min(theirs, MEET_SIDE)
  const m = Math.min(mine, MEET_SIDE)
  const s = Math.min(shared, MEET_SHARED)
  const rows = Math.max(t, m, s, 1)
  const step = 74
  const height = 40 + (rows - 1) * step + 70
  const column = (count: number, x: number, swing: number): Point[] =>
    Array.from({ length: count }, (_, i) => ({
      x: x + (i % 2 === 0 ? 0 : swing),
      y: 40 + i * step + ((rows - count) * step) / 2,
    }))
  return {
    theirs: column(t, 318, -36),
    mine: column(m, 42, 36),
    shared: column(s, SKY_WIDTH / 2, 0),
    height,
  }
}
