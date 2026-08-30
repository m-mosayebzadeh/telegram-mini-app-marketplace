/**
 * User-facing calls to backend/app/topup/router.py — the manual
 * card-to-card top-up flow. Admin-side review lives in lib/adminApi.ts
 * instead, matching the same router split on the backend.
 */

import { apiFetch, apiFetchBlob } from './api'
import type { TopUpCardInfo, TopUpRequest } from './types'

export function getTopUpCardInfo(): Promise<TopUpCardInfo> {
  return apiFetch<TopUpCardInfo>('/topup/card-info')
}

export function listMyTopUpRequests(): Promise<TopUpRequest[]> {
  return apiFetch<TopUpRequest[]>('/topup/requests/mine')
}

export function createTopUpRequest(file: File, requestedStars: number): Promise<TopUpRequest> {
  const form = new FormData()
  form.append('file', file)
  form.append('requested_stars', String(requestedStars))
  return apiFetch<TopUpRequest>('/topup/requests', { method: 'POST', body: form })
}

/** Same blob-fetch pattern as lib/contentApi.ts's fetchContentFileBlobUrl
 * — the receipt route is access-checked, so a plain <img src> can't be
 * used (no way to attach the auth header to a browser-initiated image
 * request). Caller must URL.revokeObjectURL() when done. */
export async function fetchTopUpReceiptBlobUrl(requestId: number): Promise<string> {
  const blob = await apiFetchBlob(`/topup/requests/${requestId}/receipt`)
  return URL.createObjectURL(blob)
}
