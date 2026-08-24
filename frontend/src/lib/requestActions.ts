import type { ChatSession, Request } from './types'

export type RequestAction =
  | { type: 'waiting' }
  | { type: 'rejected'; reason: string | null }
  | { type: 'cancelled'; reason: string | null }
  | { type: 'pay' }
  | { type: 'session'; session: ChatSession }

/**
 * What a buyer should be able to DO about one of their own requests,
 * given its status and the chat sessions they're part of. Kept as a
 * plain function — not inline conditionals inside a screen component —
 * because this branching has real business meaning (see
 * TECHNICAL_REQUIREMENTS.md's request/chat-session lifecycle), not just
 * display logic, so it's worth testing on its own (see
 * requestActions.test.ts) without needing to render any UI at all.
 */
export function getRequestAction(request: Request, sessions: ChatSession[]): RequestAction {
  if (request.status === 'pending') return { type: 'waiting' }
  if (request.status === 'rejected') return { type: 'rejected', reason: request.reason }
  if (request.status === 'cancelled') return { type: 'cancelled', reason: request.reason }

  // status === 'accepted': whether it's been paid for yet is decided by
  // whether a chat session exists for it, not by any field on the
  // request itself — the backend creates the session in the same
  // breath as the payment (see backend/app/request/router.py's
  // pay_for_request), so "a session exists" and "this was paid for"
  // are the same fact.
  const session = sessions.find((s) => s.request_id === request.id)
  return session ? { type: 'session', session } : { type: 'pay' }
}
