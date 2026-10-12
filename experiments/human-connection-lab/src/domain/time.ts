/**
 * Calendar arithmetic for the daily question.
 *
 * Days are counted in the visitor's own local calendar — the question changes
 * at their midnight, not at a server's. Rounding absorbs the 23- and 25-hour
 * days that daylight-saving changes produce.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

export function localMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function nextLocalMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/** How many calendar days `later` is after `earlier` (0 = same day). */
export function dayIndexBetween(earlier: number, later: number): number {
  return Math.round((localMidnight(later) - localMidnight(earlier)) / DAY_MS);
}
