/**
 * The order of the conversation list (section 32).
 *
 * Kept apart from TalkList.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/** Pinned first, the first pinned highest; then the newest. */
export function talkOrder<T extends { pinnedRank?: number | null; lastAt: string }>(rows: T[]): T[] {
  return [...rows].sort((x, y) => {
    const px = x.pinnedRank ?? null
    const py = y.pinnedRank ?? null
    if (px !== null || py !== null) {
      if (px === null) return 1
      if (py === null) return -1
      return px - py
    }
    return y.lastAt > x.lastAt ? 1 : y.lastAt < x.lastAt ? -1 : 0
  })
}
