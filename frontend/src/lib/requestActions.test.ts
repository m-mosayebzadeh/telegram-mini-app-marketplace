import { describe, expect, it } from 'vitest'
import { getRequestAction } from './requestActions'
import type { ChatSession, Request } from './types'

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: 1,
    buyer_id: 10,
    offer_id: 100,
    status: 'pending',
    reason: null,
    created_at: '2026-01-01T00:00:00Z',
    responded_at: null,
    ...overrides,
  }
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 1,
    request_id: 1,
    transaction_id: 1,
    status: 'open',
    opened_at: '2026-01-01T00:00:00Z',
    closed_at: null,
    closed_by_user_id: null,
    // Enrichment fields (see TECHNICAL_REQUIREMENTS.md section 12) —
    // getRequestAction() itself never looks at these, they're only here
    // to satisfy ChatSession's shape.
    my_role: 'buyer',
    other_participant: { user_id: 2, display_name: 'Provider', username: null, avatar_url: null },
    offer_title: 'An offer',
    price_stars: 40,
    display_duration_minutes: 30,
    disputed: false,
    transaction_status: 'pending',
    archived: false,
    ...overrides,
  }
}

describe('getRequestAction', () => {
  it('is "waiting" while pending', () => {
    expect(getRequestAction(makeRequest({ status: 'pending' }), [])).toEqual({ type: 'waiting' })
  })

  it('carries the reason through for a rejected request', () => {
    const request = makeRequest({ status: 'rejected', reason: 'Not available' })
    expect(getRequestAction(request, [])).toEqual({ type: 'rejected', reason: 'Not available' })
  })

  it('carries the reason through for a cancelled request', () => {
    const request = makeRequest({ status: 'cancelled', reason: 'Offer was deleted' })
    expect(getRequestAction(request, [])).toEqual({
      type: 'cancelled',
      reason: 'Offer was deleted',
    })
  })

  it('is "pay" when accepted but no chat session exists for it yet', () => {
    const request = makeRequest({ status: 'accepted' })
    // A session for some OTHER request shouldn't be mistaken for this one.
    const unrelatedSession = makeSession({ request_id: 999 })
    expect(getRequestAction(request, [unrelatedSession])).toEqual({ type: 'pay' })
  })

  it('is "session" (carrying the matching session) once paid', () => {
    const request = makeRequest({ id: 42, status: 'accepted' })
    const session = makeSession({ request_id: 42, status: 'open' })
    expect(getRequestAction(request, [session])).toEqual({ type: 'session', session })
  })
})
