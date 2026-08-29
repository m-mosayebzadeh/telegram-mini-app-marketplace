/**
 * Admin-only calls to backend/app/admin/router.py — grants management
 * (owner-only) and top-up review (owner, or anyone granted the
 * "wallet_topups" scope). The backend enforces every one of these for
 * real; getMyAdminAccess() only exists so the frontend can decide
 * whether to show admin UI at all, without treating a 403 as the signal.
 */

import { apiFetch } from './api'
import type { AdminGrant, AdminTopUpRequest, MyAdminAccess } from './types'

export function getMyAdminAccess(): Promise<MyAdminAccess> {
  return apiFetch<MyAdminAccess>('/admin/me')
}

export function listAdminGrants(): Promise<AdminGrant[]> {
  return apiFetch<AdminGrant[]>('/admin/grants')
}

export function createAdminGrant(telegramId: number, scopes: string[]): Promise<AdminGrant> {
  return apiFetch<AdminGrant>('/admin/grants', {
    method: 'POST',
    body: JSON.stringify({ telegram_id: telegramId, scopes }),
  })
}

export function deleteAdminGrant(grantId: number): Promise<void> {
  return apiFetch<void>(`/admin/grants/${grantId}`, { method: 'DELETE' })
}

export function listTopUpRequestsForAdmin(statusFilter?: string): Promise<AdminTopUpRequest[]> {
  const query = statusFilter ? `?status_filter=${statusFilter}` : ''
  return apiFetch<AdminTopUpRequest[]>(`/admin/topup-requests${query}`)
}

export function approveTopUpRequest(
  requestId: number,
  finalTomanAmount: number,
  transactionReference: string,
): Promise<AdminTopUpRequest> {
  return apiFetch<AdminTopUpRequest>(`/admin/topup-requests/${requestId}/approve`, {
    method: 'POST',
    body: JSON.stringify({
      final_toman_amount: finalTomanAmount,
      transaction_reference: transactionReference,
    }),
  })
}

export function rejectTopUpRequest(requestId: number, reason: string): Promise<AdminTopUpRequest> {
  return apiFetch<AdminTopUpRequest>(`/admin/topup-requests/${requestId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
}
