import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getMyAdminAccess } from './adminApi'
import { apiFetch } from './api'
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
}

const MeContext = createContext<MeState>({ me: null, error: null, adminAccess: null, refreshMe: () => {} })

/**
 * Fetches GET /me exactly once for the whole app and shares the result
 * — every screen that needs "who am I" (to tell an offer/request apart
 * as "mine" vs. someone else's) reads it via useMe() instead of each
 * screen fetching it again on its own. /me is also what creates the
 * User row on first login (see backend/app/main.py), so this doubles
 * as the app's single entry point into the backend.
 */
export function MeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<MeState, 'refreshMe'>>({ me: null, error: null, adminAccess: null })

  function fetchMe() {
    apiFetch<Me>('/me')
      .then((me) => setState((s) => ({ ...s, me, error: null })))
      .catch((err) => setState((s) => ({ ...s, me: null, error: err instanceof Error ? err.message : String(err) })))
  }

  useEffect(() => {
    apiFetch<Me>('/me')
      .then((me) => {
        setState((s) => ({ ...s, me, error: null }))
        getMyAdminAccess()
          .then((adminAccess) => setState((s) => ({ ...s, adminAccess })))
          .catch(() => setState((s) => ({ ...s, adminAccess: { is_owner: false, scopes: [] } })))
      })
      .catch((err) => setState((s) => ({ ...s, me: null, error: err instanceof Error ? err.message : String(err) })))
  }, [])

  return <MeContext.Provider value={{ ...state, refreshMe: fetchMe }}>{children}</MeContext.Provider>
}

/** `me` is null while still loading OR if the fetch failed — check
 * `error` to tell those two cases apart. */
export function useMe(): MeState {
  return useContext(MeContext)
}
