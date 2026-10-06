import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getMyAdminAccess } from './adminApi'
import { apiFetch, ApiError } from './api'
import { keepServerLanguage } from './languageSync'
import { subscribe } from './live'
import type { Me, MyAdminAccess } from './types'

interface MeState {
  me: Me | null
  error: string | null
  // Fetched once alongside `me` (GET /admin/me never 403s — see
  // backend/app/admin/router.py) so the bottom nav's admin tab (see
  // App.tsx) is a single per-session check, not something re-fetched
  // on every page. null while still loading; {is_owner:false,
  // scopes:[]} for the overwhelming majority of users who aren't admins.
  adminAccess: MyAdminAccess | null
  // Re-fetches just `me` (not adminAccess, which never changes mid-session)
  // — for a screen that just did something which could change one of
  // /me's own live fields, most importantly `has_unseen_requests` (see
  // pages/OfferDetail.tsx, which calls this right after loading an
  // offer's own request list, so the bottom nav's dot updates within
  // the same session instead of only on the next full app load).
  refreshMe: () => void
  /** The account was deleted (section 32, step 4): the app shows only the
   *  way to start again, and asks the server nothing else. */
  deleted: boolean
  /** Called right after deleting, so the app stops at once. */
  markDeleted: () => void
}

const MeContext = createContext<MeState>({
  me: null,
  error: null,
  adminAccess: null,
  refreshMe: () => {},
  deleted: false,
  markDeleted: () => {},
})

/**
 * Fetches GET /me exactly once for the whole app and shares the result
 * — every screen that needs "who am I" (to tell an offer/request apart
 * as "mine" vs. someone else's) reads it via useMe() instead of each
 * screen fetching it again on its own. /me is also what creates the
 * User row on first login (see backend/app/main.py), so this doubles
 * as the app's single entry point into the backend.
 */
export function MeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<MeState, 'refreshMe' | 'markDeleted'>>({
    me: null,
    error: null,
    adminAccess: null,
    deleted: false,
  })
  // The server answers 410 for an account that was deleted.
  const failed = (err: unknown) =>
    setState((s) => ({
      ...s,
      me: null,
      deleted: err instanceof ApiError && err.status === 410,
      error: err instanceof Error ? err.message : String(err),
    }))

  function fetchMe() {
    apiFetch<Me>('/me')
      .then((me) => setState((s) => ({ ...s, me, error: null })))
      .catch(failed)
  }

  useEffect(() => {
    apiFetch<Me>('/me')
      .then((me) => {
        setState((s) => ({ ...s, me, error: null }))
        getMyAdminAccess()
          .then((adminAccess) => setState((s) => ({ ...s, adminAccess })))
          .catch(() => setState((s) => ({ ...s, adminAccess: { is_owner: false, scopes: [] } })))
      })
      .catch(failed)
  }, [])

  // A friend request arrived or was answered: the badge on the "me" door
  // reads from here, so it is asked again — told live, never on a clock.
  useEffect(() => subscribe((event) => { if (event.type === 'friends') fetchMe() }), [])

  // The server writes to this person in the app's language (section 37).
  const meId = state.me?.id
  const meLanguage = state.me?.language
  useEffect(() => (meId ? keepServerLanguage(meLanguage) : undefined),
    // Once per signed-in person; later changes are heard by the listener itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meId])

  const markDeleted = () => setState((s) => ({ ...s, me: null, deleted: true }))
  return <MeContext.Provider value={{ ...state, refreshMe: fetchMe, markDeleted }}>{children}</MeContext.Provider>
}

/** `me` is null while still loading OR if the fetch failed — check
 * `error` to tell those two cases apart. */
// The hook lives beside its provider on purpose: they share one private
// context, and splitting them would make every caller and every test mock
// reach into two modules for one thing.
// oxlint-disable-next-line react/only-export-components
export function useMe(): MeState {
  return useContext(MeContext)
}
