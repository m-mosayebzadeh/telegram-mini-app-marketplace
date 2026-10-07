import type { EchoStatus } from '../../lib/echoApi'

/**
 * Which door of the bar along the bottom a page belongs to, and what
 * Echo's door says (TECHNICAL_REQUIREMENTS.md section 32).
 *
 * Kept apart from WorldBar.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

export type Door = 'talk' | 'echo' | 'world' | 'events' | 'me'

/** Which door a path belongs to, or null where the bar is not shown. */
export function doorOf(pathname: string): Door | null {
  if (pathname === '/sky/talk') return 'talk'
  if (pathname === '/sky' || pathname.startsWith('/sky/')) return 'world'
  if (pathname === '/echo') return 'echo'
  if (pathname === '/events') return 'events'
  // Your page and your friends are "me"; somebody else's page is reached
  // from the world, so the world's door stays lit there. Settings and
  // everything under it, editing your profile and signing in another
  // device are yours too (section 42): they used to show the marketplace's
  // old bar, a second app inside this one.
  if (pathname === '/profile' || pathname === '/friends') return 'me'
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'me'
  if (pathname === '/profile/edit' || pathname === '/link') return 'me'
  if (pathname.startsWith('/profiles/')) return 'world'
  return null
}

/**
 * What Echo's door says without a word (section 32, the owner's design):
 *
 * - shut — the two lights still, faint, a little apart;
 * - open — the two turn slowly round each other: Echo's world is alive;
 * - busy — the same, a little quicker: somebody is waiting right now for
 *   a new person, an invitation rather than an alarm;
 * - seeking — you are searching: one light (you) stays in the middle and
 *   the other circles it, looking for you. A different motion from "open",
 *   not only a faster one, so the two states never read as each other.
 *
 * Told apart by motion and shape, never by colour alone.
 */
export type EchoDoor = 'shut' | 'open' | 'busy' | 'seeking'

export function echoDoorOf(status: EchoStatus | null): EchoDoor {
  if (!status || !status.open_now) return status?.waiting ? 'seeking' : 'shut'
  if (status.waiting) return 'seeking'
  return (status.waiting_now ?? 0) > 0 ? 'busy' : 'open'
}
