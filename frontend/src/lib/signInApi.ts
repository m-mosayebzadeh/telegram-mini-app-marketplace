import { apiFetch } from './api'

/**
 * The ways in (TECHNICAL_REQUIREMENTS.md section 32; the server is
 * backend/app/auth/router.py). Every one ends with the server setting the
 * session cookie; the app never holds the session itself (lib/auth.ts).
 */

export interface WaysIn {
  /** Google's Client ID, or null when Google sign-in is not set up. */
  google_client_id: string | null
  /** Development sign-in is open (local development only). */
  dev: boolean
}

export const fetchWays = () => apiFetch<WaysIn>('/auth/ways')

/** Hands the server the token Google's button gave the page. */
export const signInWithGoogle = (credential: string) =>
  apiFetch<{ new: boolean }>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) })

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

/** Held open by the server up to half a minute, until there is an answer. */
export const waitForApproval = (request: DeviceRequest) =>
  apiFetch<{ status: DeviceStatus }>('/auth/device/wait', {
    method: 'POST',
    body: JSON.stringify({ code: request.code, secret: request.secret }),
  })

export const claimDeviceSession = (request: DeviceRequest) =>
  apiFetch<void>('/auth/device/claim', {
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
