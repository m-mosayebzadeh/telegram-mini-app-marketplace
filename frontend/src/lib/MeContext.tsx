import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { apiFetch } from './api'
import type { Me } from './types'

interface MeState {
  me: Me | null
  error: string | null
}

const MeContext = createContext<MeState>({ me: null, error: null })

/**
 * Fetches GET /me exactly once for the whole app and shares the result
 * — every screen that needs "who am I" (to tell an offer/request apart
 * as "mine" vs. someone else's) reads it via useMe() instead of each
 * screen fetching it again on its own. /me is also what creates the
 * User row on first login (see backend/app/main.py), so this doubles
 * as the app's single entry point into the backend.
 */
export function MeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MeState>({ me: null, error: null })

  useEffect(() => {
    apiFetch<Me>('/me')
      .then((me) => setState({ me, error: null }))
      .catch((err) => setState({ me: null, error: err instanceof Error ? err.message : String(err) }))
  }, [])

  return <MeContext.Provider value={state}>{children}</MeContext.Provider>
}

/** `me` is null while still loading OR if the fetch failed — check
 * `error` to tell those two cases apart. */
export function useMe(): MeState {
  return useContext(MeContext)
}
