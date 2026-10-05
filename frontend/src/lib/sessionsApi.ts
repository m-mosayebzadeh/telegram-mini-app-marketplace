import { apiFetch } from './api'

/**
 * My signed-in devices (TECHNICAL_REQUIREMENTS.md section 32; the server is
 * backend/app/auth/router.py). The session itself lives in a cookie the app
 * cannot read; this is only the list the server keeps of them.
 */

export interface SignedInSession {
  id: number
  /** The door this session came through: telegram, google, phone, device, dev. */
  provider: string
  /** A short device name, such as "Chrome · Windows". */
  device: string
  created_at: string
  last_used_at: string
  /** This very device. */
  current: boolean
}

export const fetchSessions = () => apiFetch<SignedInSession[]>('/auth/sessions')

export const closeSession = (id: number) => apiFetch<void>(`/auth/sessions/${id}`, { method: 'DELETE' })

export const closeOtherSessions = () => apiFetch<{ closed: number }>('/auth/sessions/close-others', { method: 'POST' })
