import { apiFetch } from './api'

/**
 * Writing the note of the day (section 32; backend/app/profile/note.py).
 *
 * Kept apart from NoteBubble.tsx so that file exports only the component: the
 * development server can then swap the component in place on every save
 * instead of reloading the whole app.
 */

/** The same limit as the server (app/profile/note.py). */
export const MAX_NOTE = 60

export function saveNote(text: string): Promise<{ note: string | null }> {
  return apiFetch<{ note: string | null }>('/profile/me/note', {
    method: 'PUT',
    body: JSON.stringify({ text }),
  })
}
