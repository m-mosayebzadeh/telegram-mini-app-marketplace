/**
 * The Assistants search box's own "when do we actually search" rule —
 * pulled out as a plain function (rather than left inline inside
 * AdminAssistantSearch.tsx's debounce effect) so the business rule
 * itself ("wait for at least 3 real characters") is unit-testable
 * without needing to render a component or fake timers.
 *
 * Per the product decision behind this: searching on every keystroke
 * would hit the backend far too often, and a 1-2 character query is
 * rarely useful anyway — so the search box stays paused (showing the
 * default assistants list) until the user has typed at least this many
 * non-whitespace characters.
 */
export const ADMIN_SEARCH_MIN_LENGTH = 3

export function shouldRunAdminSearch(query: string): boolean {
  return query.trim().length >= ADMIN_SEARCH_MIN_LENGTH
}
