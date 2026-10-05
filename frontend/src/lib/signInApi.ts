import { apiFetch } from './api'

/**
 * The ways in (TECHNICAL_REQUIREMENTS.md section 32; the server is
 * backend/app/auth/router.py). Every one ends with the server setting the
 * session cookie; the app never holds the session itself (lib/auth.ts).
 */

export interface WaysIn {
  /** Google sign-in is set up on the server. */
  google: boolean
  /** Signing in through our Telegram bot is set up. */
  telegram: boolean
  /** Development sign-in is open (local development only). */
  dev: boolean
}

export const fetchWays = () => apiFetch<WaysIn>('/auth/ways')

/**
 * Where the Google button leads. Not a request the page makes: the browser
 * goes there, the server sends it on to Google's account chooser, and
 * Google sends it back, signed in (backend/app/auth/google.py). Going there
 * and back is what lets the button be our own, within Google's brand rules.
 */
export const googleStartAddress = (language: string) =>
  `/api/auth/google/start?lang=${encodeURIComponent(language)}`

// --- another phone --------------------------------------------------------

export interface DeviceRequest {
  /** What this device shows: in the picture, and as letters to type. */
  code: string
  /** Only this device has it; it collects the session with it. */
  secret: string
  expires_at: string
}

export type DeviceStatus = 'pending' | 'approved' | 'refused' | 'expired' | 'used'

export const startDeviceRequest = () => apiFetch<DeviceRequest>('/auth/device/start', { method: 'POST' })

/**
 * Held open by the server up to half a minute, until there is news: an
 * answer, or — told once — that a phone has opened the code (`seen`). The
 * phone's answer wakes the server at once; nothing here asks on a clock.
 */
export const waitForApproval = (request: DeviceRequest, seen: boolean) =>
  apiFetch<{ status: DeviceStatus; seen: boolean }>('/auth/device/wait', {
    method: 'POST',
    body: JSON.stringify({ code: request.code, secret: request.secret, seen }),
  })

export const claimDeviceSession = (request: DeviceRequest) =>
  apiFetch<void>('/auth/device/claim', {
    method: 'POST',
    body: JSON.stringify({ code: request.code, secret: request.secret }),
  })

// --- Telegram, through our bot ----------------------------------------------

export interface BotRequest extends DeviceRequest {
  /** Opens our bot with this request's code: in the Telegram app, or on the web. */
  link: string
}

export const startBotSignIn = () => apiFetch<BotRequest>('/auth/telegram/start', { method: 'POST' })

/** The same held-open wait as another phone's, woken by the bot. */
export const waitForTelegram = (request: BotRequest, seen: boolean) =>
  apiFetch<{ status: DeviceStatus; seen: boolean }>('/auth/telegram/wait', {
    method: 'POST',
    body: JSON.stringify({ code: request.code, secret: request.secret, seen }),
  })

export const claimBotSession = (request: BotRequest) =>
  apiFetch<void>('/auth/telegram/claim', {
    method: 'POST',
    body: JSON.stringify({ code: request.code, secret: request.secret }),
  })

/** On the phone that is signed in: which device is asking. */
export interface DeviceRequestSeen {
  code: string
  device: string
  created_at: string
  status: DeviceStatus
}

export const seeDeviceRequest = (code: string) => apiFetch<DeviceRequestSeen>(`/auth/device/${encodeURIComponent(code)}`)
export const approveDeviceRequest = (code: string) =>
  apiFetch<void>(`/auth/device/${encodeURIComponent(code)}/approve`, { method: 'POST' })
export const refuseDeviceRequest = (code: string) =>
  apiFetch<void>(`/auth/device/${encodeURIComponent(code)}/refuse`, { method: 'POST' })

/** "K7Q29MXA" → "K7Q2 9MXA": easier to read off one screen and type into another. */
export function spacedCode(code: string): string {
  return code.length > 4 ? `${code.slice(0, 4)} ${code.slice(4)}` : code
}

/** What a typed code is, whatever spaces or small letters it was typed with. */
export function cleanCode(typed: string): string {
  return typed.replace(/[^a-z0-9]/gi, '').toUpperCase()
}
