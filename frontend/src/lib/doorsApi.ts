import { apiFetch } from './api'
import type { BotRequest, DeviceStatus } from './signInApi'

/**
 * "Settings -> ways in" (TECHNICAL_REQUIREMENTS.md section 36; the server is
 * backend/app/auth/doors.py, with the trips through Google in
 * auth/router.py and through the bot in auth/telegram_router.py).
 */

export type DoorProvider = 'google' | 'telegram'

export interface Door {
  provider: DoorProvider
  /** The Google address half hidden, or the Telegram @name. */
  label: string | null
}

export interface Doors {
  doors: Door[]
  /** This session confirmed through one of its ways in, recently enough to change them. */
  confirmed: boolean
  /** Which ways can be connected on this server at all. */
  google: boolean
  telegram: boolean
}

export type DoorPurpose = 'confirm' | 'link'

export const fetchDoors = () => apiFetch<Doors>('/auth/doors')

export const takeDoorAway = (provider: DoorProvider) => apiFetch<void>(`/auth/doors/${provider}`, { method: 'DELETE' })

/**
 * Off to Google and back, from inside the account: to confirm with the
 * Google account connected here, or to connect one. The browser goes
 * there; Google sends it back to this page, which reads the outcome.
 */
export const googleTripAddress = (purpose: DoorPurpose, language: string) =>
  `/api/auth/google/start?purpose=${purpose}&lang=${encodeURIComponent(language)}`

export const startDoorTelegram = (purpose: DoorPurpose) =>
  apiFetch<BotRequest>('/auth/doors/telegram/start', { method: 'POST', body: JSON.stringify({ purpose }) })

/** The same held-open wait as signing in through the bot; `problem` says why the bot refused on its own. */
export const waitForDoorTelegram = (request: BotRequest, seen: boolean) =>
  apiFetch<{ status: DeviceStatus; seen: boolean; problem?: string }>('/auth/telegram/wait', {
    method: 'POST',
    body: JSON.stringify({ code: request.code, secret: request.secret, seen }),
  })

export const claimDoorTelegram = (request: BotRequest) =>
  apiFetch<{ done: 'confirmed' | 'linked' }>('/auth/doors/telegram/claim', {
    method: 'POST',
    body: JSON.stringify({ code: request.code, secret: request.secret }),
  })
