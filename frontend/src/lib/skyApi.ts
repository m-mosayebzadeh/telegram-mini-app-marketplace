import { apiFetch } from './api'

/** One person as the world draws them.
 *
 *  Three numbers, each riding on a different visual property so they can
 *  never be confused: presence is size, trust is glow, online is the
 *  ring. Nothing here says anything about money — deliberately (see
 *  TECHNICAL_REQUIREMENTS.md section 26). */
export interface SkyPerson {
  user_id: number
  display_name: string
  username: string | null
  initial: string
  tagline: string | null
  avatar_url: string | null
  presence: number
  trust: number
  online: boolean
  is_new: boolean
}

/**
 * One screen of sky.
 *
 * Order is everything and the numbers are not: a person's place in this
 * list is where they sit in the world, and the day that ordering becomes
 * distance-based instead of presence-based, nothing in the app changes.
 */
export function fetchSky(): Promise<SkyPerson[]> {
  return apiFetch<SkyPerson[]>('/sky')
}
