/**
 * Being signed in (TECHNICAL_REQUIREMENTS.md section 32, "signing in
 * without Telegram"; the server side is backend/app/auth/sessions.py).
 *
 * Every way in ends in a session the server keeps, held by the browser in
 * a cookie this code cannot read — on purpose: a piece of bad script that
 * ever got into the page could not steal it. So the app never handles the
 * session itself. It only asks "am I signed in?", and listens for the one
 * answer that matters: "signed out", which sends the person to the sign-in
 * page (the owner's instruction) — whether it comes from a refused request
 * or from the live connection when another device closed this session.
 */

/** Sent when this device turns out to be signed out. */
export const SIGNED_OUT_EVENT = 'cos:signed-out'

export function announceSignedOut(): void {
  window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
}

/** Back to the world's address once signed out, so signing in again opens
 *  the world rather than whatever page was open when the session ended
 *  (the owner found themselves back in Settings after signing out from
 *  there). The sign-in screen itself has no address of its own. */
export function forgetWhereYouWere(): void {
  if (window.location.pathname !== '/') window.history.replaceState(null, '', '/')
}

/** Whether a refused request means "nobody is signed in on this device". */
export function isSignedOutResponse(status: number, body: unknown): boolean {
  if (status !== 401) return false
  const detail = (body as { detail?: { reason?: string } } | null)?.detail
  return typeof detail === 'object' && detail?.reason === 'signed_out'
}

/** Is anybody signed in on this device? Asked once when the app starts.
 *  The app is not opened inside Telegram any more (the owner's decision):
 *  the session's cookie is the only way anybody is known. */
export async function checkSignedIn(): Promise<boolean> {
  const me = await fetch('/api/me')
  return me.ok
}

/** Signs this device out. Never fails: the cookie is cleared either way. */
export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/sign-out', { method: 'POST' })
  } finally {
    announceSignedOut()
  }
}
