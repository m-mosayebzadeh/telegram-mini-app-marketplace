/**
 * Admin-only calls to backend/app/admin/router.py — role & assistant
 * management, browsing/moderating any user's account (both owner-only),
 * and top-up review / platform rates (owner, or anyone granted the
 * matching scope). The backend enforces every one of these for real;
 * getMyAdminAccess() only exists so the frontend can decide whether to
 * show admin UI at all, without treating a 403 as the signal.
 */

import { apiFetch } from './api'
import type {
  AdminChatSession,
  AdminTopUpRequest,
  AdminUserDetail,
  AdminUserSummary,
  Content,
  MyAdminAccess,
  Offer,
  PlatformRates,
  RequestActivity,
  Role,
  Transaction,
  UserRole,
} from './types'

export function getMyAdminAccess(): Promise<MyAdminAccess> {
  return apiFetch<MyAdminAccess>('/admin/me')
}

// --- roles ("نقش و دسترسی") ---------------------------------------------

export function listRoles(): Promise<Role[]> {
  return apiFetch<Role[]>('/admin/roles')
}

export function createRole(name: string, scopes: string[]): Promise<Role> {
  return apiFetch<Role>('/admin/roles', { method: 'POST', body: JSON.stringify({ name, scopes }) })
}

export function getRole(roleId: number): Promise<Role> {
  return apiFetch<Role>(`/admin/roles/${roleId}`)
}

export function updateRole(roleId: number, changes: { name?: string; scopes?: string[] }): Promise<Role> {
  return apiFetch<Role>(`/admin/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(changes) })
}

export function activateRole(roleId: number): Promise<Role> {
  return apiFetch<Role>(`/admin/roles/${roleId}/activate`, { method: 'POST' })
}

export function deactivateRole(roleId: number): Promise<Role> {
  return apiFetch<Role>(`/admin/roles/${roleId}/deactivate`, { method: 'POST' })
}

export function deleteRole(roleId: number): Promise<void> {
  return apiFetch<void>(`/admin/roles/${roleId}`, { method: 'DELETE' })
}

export function listRoleMembers(roleId: number): Promise<AdminUserSummary[]> {
  return apiFetch<AdminUserSummary[]>(`/admin/roles/${roleId}/members`)
}

// --- assistants & user search ("دستیاران") ------------------------------

export function listAssistants(): Promise<AdminUserSummary[]> {
  return apiFetch<AdminUserSummary[]>('/admin/assistants')
}

export function searchUsers(query: string, limit = 5): Promise<AdminUserSummary[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  return apiFetch<AdminUserSummary[]>(`/admin/users/search?${params.toString()}`)
}

export function listUserRoles(userId: number): Promise<UserRole[]> {
  return apiFetch<UserRole[]>(`/admin/users/${userId}/roles`)
}

export function assignRole(userId: number, roleId: number): Promise<UserRole> {
  return apiFetch<UserRole>(`/admin/users/${userId}/roles`, {
    method: 'POST',
    body: JSON.stringify({ role_id: roleId }),
  })
}

export function revokeRole(userId: number, roleId: number): Promise<void> {
  return apiFetch<void>(`/admin/users/${userId}/roles/${roleId}`, { method: 'DELETE' })
}

// --- users ("کاربران") ---------------------------------------------------

export function getUserDetail(userId: number): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/admin/users/${userId}`)
}

export function blockUser(userId: number): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/admin/users/${userId}/block`, { method: 'POST' })
}

export function unblockUser(userId: number): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/admin/users/${userId}/unblock`, { method: 'POST' })
}

export function listUserOffersAdmin(userId: number): Promise<Offer[]> {
  return apiFetch<Offer[]>(`/admin/users/${userId}/offers`)
}

export function deleteOfferAdmin(offerId: number): Promise<void> {
  return apiFetch<void>(`/admin/offers/${offerId}`, { method: 'DELETE' })
}

export function listUserContentAdmin(userId: number): Promise<Content[]> {
  return apiFetch<Content[]>(`/admin/users/${userId}/content`)
}

export function deleteContentAdmin(contentId: number): Promise<void> {
  return apiFetch<void>(`/admin/content/${contentId}`, { method: 'DELETE' })
}

export function listUserRequestsAdmin(userId: number): Promise<RequestActivity[]> {
  return apiFetch<RequestActivity[]>(`/admin/users/${userId}/requests`)
}

export function listUserChatSessionsAdmin(userId: number): Promise<AdminChatSession[]> {
  return apiFetch<AdminChatSession[]>(`/admin/users/${userId}/chat-sessions`)
}

export function listUserTransactionsAdmin(userId: number): Promise<Transaction[]> {
  return apiFetch<Transaction[]>(`/admin/users/${userId}/transactions`)
}

// --- top-up review & platform rates --------------------------------------

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

export function getPlatformRates(): Promise<PlatformRates> {
  return apiFetch<PlatformRates>('/admin/rates')
}

export function updatePlatformRates(rates: {
  star_to_toman_rate: number
  withdrawal_commission_percent: number
  complaint_commission_percent: number
  minimum_withdrawal_toman: number
}): Promise<PlatformRates> {
  return apiFetch<PlatformRates>('/admin/rates', { method: 'PUT', body: JSON.stringify(rates) })
}
