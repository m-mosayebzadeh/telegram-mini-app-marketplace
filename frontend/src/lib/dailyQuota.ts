/**
 * The buyer's daily request quota (see backend/app/request/router.py's
 * MAX_DAILY_REQUESTS_PER_BUYER) resets at midnight UTC, not the
 * viewer's own local midnight — this app never collects a user's time
 * zone, so there's no per-user boundary to reset against instead.
 *
 * This computes that fixed instant so Activity.tsx's quota-refresh hint
 * can render it with the browser's own `toLocaleTimeString()` — which
 * is what actually makes it read correctly for everyone: the SAME
 * instant shows as "03:30" for someone in Iran and a different local
 * hour for someone elsewhere, without this app ever needing to know
 * which time zone either of them is in.
 */
export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0))
}
