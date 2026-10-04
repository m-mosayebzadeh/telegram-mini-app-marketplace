import type { EchoStatus } from './echoApi'

/**
 * What the newcomer's invitation on "me" says about Echo (section 32).
 *
 * Kept apart from pages/ProfileTab.tsx so that file exports only the
 * component: the development server can then swap it in place on save.
 */

/**
 * The newcomer's invitation, in Echo's real state (the owner's choice:
 * "three people are waiting in Echo right now" invites better than a
 * general sentence). The number only when Echo is open, somebody is
 * waiting and the panel lets numbers be shown; a closed Echo is said
 * plainly rather than promised.
 */
export function inviteLine(echo: EchoStatus | null): { key: string; count?: number } {
  if (!echo || !echo.open_now) return { key: 'week.emptyShut' }
  const waiting = echo.waiting_now ?? 0
  if (echo.show_counts !== false && waiting > 0) return { key: 'week.emptyWaiting', count: waiting }
  return { key: 'week.emptyText' }
}
