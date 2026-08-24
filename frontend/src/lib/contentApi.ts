/**
 * All calls to the backend's /content routes (backend/app/content/router.py)
 * live here, kept separate from lib/api.ts's generic apiFetch() the same
 * way lib/requestActions.ts groups the request-lifecycle calls.
 */

import { apiFetch, apiFetchBlob } from './api'
import type { Content } from './types'

/** What ProfileContentGrid (and the upload form) send when creating a
 * new content item — mirrors the multipart form fields
 * upload_content() in backend/app/content/router.py accepts. */
export interface UploadContentInput {
  file: File
  contentType: 'photo' | 'short_video'
  durationSeconds?: number
  isPaid: boolean
  priceStars?: number
  hasSpoiler: boolean
  audienceType: 'public' | 'followers' | 'user' | 'group'
  audienceUserId?: number
  audienceGroupId?: number
}

export function listContent(userId: number): Promise<Content[]> {
  return apiFetch<Content[]>(`/content?user_id=${userId}`)
}

export function getContent(id: number): Promise<Content> {
  return apiFetch<Content>(`/content/${id}`)
}

/**
 * Loads a content item's actual bytes as an in-memory object URL — for
 * an <img>/<video> `src`. A plain <img src="/api/content/{id}/file">
 * can't be used directly: this backend authenticates via the
 * X-Telegram-Init-Data header, which a browser's own image-loading
 * request has no way to attach (see lib/api.ts's apiFetchBlob()).
 *
 * Callers must revoke the returned URL (URL.revokeObjectURL) once
 * they're done with it (e.g. on unmount), or it leaks memory for the
 * life of the page — see components/ContentTile.tsx for the pattern.
 */
export async function fetchContentFileBlobUrl(id: number): Promise<string> {
  const blob = await apiFetchBlob(`/content/${id}/file`)
  return URL.createObjectURL(blob)
}

export async function uploadContent(input: UploadContentInput): Promise<Content> {
  const form = new FormData()
  form.append('file', input.file)
  form.append('content_type', input.contentType)
  if (input.durationSeconds != null) form.append('duration_seconds', String(input.durationSeconds))
  form.append('is_paid', String(input.isPaid))
  if (input.priceStars != null) form.append('price_stars', String(input.priceStars))
  form.append('has_spoiler', String(input.hasSpoiler))
  form.append('audience_type', input.audienceType)
  if (input.audienceUserId != null) form.append('audience_user_id', String(input.audienceUserId))
  if (input.audienceGroupId != null) form.append('audience_group_id', String(input.audienceGroupId))

  return apiFetch<Content>('/content', { method: 'POST', body: form })
}

export function pinContent(id: number): Promise<Content> {
  return apiFetch<Content>(`/content/${id}/pin`, { method: 'POST' })
}

export function unpinContent(id: number): Promise<Content> {
  return apiFetch<Content>(`/content/${id}/unpin`, { method: 'POST' })
}

export function likeContent(id: number): Promise<Content> {
  return apiFetch<Content>(`/content/${id}/like`, { method: 'POST' })
}

export function unlikeContent(id: number): Promise<Content> {
  return apiFetch<Content>(`/content/${id}/like`, { method: 'DELETE' })
}

export function purchaseContent(id: number): Promise<{ unlocked: boolean }> {
  return apiFetch<{ unlocked: boolean }>(`/content/${id}/purchase`, { method: 'POST' })
}

export function deleteContent(id: number): Promise<void> {
  return apiFetch<void>(`/content/${id}`, { method: 'DELETE' })
}
