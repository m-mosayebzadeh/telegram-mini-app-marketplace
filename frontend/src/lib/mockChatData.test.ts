import { describe, expect, it } from 'vitest'
import { generateMockConversation } from './mockChatData'
import type { ChatSession } from './types'

// A minimal but realistic session, matching the enriched ChatSessionOut
// shape from backend/app/chat_session/schemas.py — the viewer (me) is
// the buyer, id 1; the other participant (the provider) is id 2.
function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 7,
    request_id: 1,
    transaction_id: 1,
    status: 'open',
    opened_at: '2026-08-20T10:00:00.000Z',
    closed_at: null,
    closed_by_user_id: null,
    my_role: 'buyer',
    other_participant: { user_id: 2, display_name: 'Sara', username: 'sara', avatar_url: null },
    offer_title: 'Chat with me',
    price_stars: 40,
    display_duration_minutes: 30,
    disputed: false,
    transaction_status: 'pending',
    ...overrides,
  }
}

describe('generateMockConversation', () => {
  it('tags every message with the session id and a plausible sender', () => {
    const session = makeSession()
    const messages = generateMockConversation(session, /* viewerId */ 1)

    for (const message of messages) {
      expect(message.session_id).toBe(session.id)
      // Every message must come from either the viewer or the other
      // participant — never a third, made-up id.
      expect([1, 2]).toContain(message.sender_id)
    }
    // The mock script includes both roles, so both ids must actually
    // appear at least once, not just be "allowed" in principle.
    const senderIds = new Set(messages.map((m) => m.sender_id))
    expect(senderIds).toEqual(new Set([1, 2]))
  })

  it('produces messages in strictly increasing chronological order', () => {
    const messages = generateMockConversation(makeSession(), 1)

    for (let i = 1; i < messages.length; i++) {
      const prev = new Date(messages[i - 1].created_at).getTime()
      const curr = new Date(messages[i].created_at).getTime()
      expect(curr).toBeGreaterThan(prev)
    }
  })

  it('keeps every timestamp within the session\'s opened_at..closed_at window when closed', () => {
    const session = makeSession({ status: 'closed', closed_at: '2026-08-20T11:00:00.000Z' })
    const messages = generateMockConversation(session, 1)

    const openedMs = new Date(session.opened_at).getTime()
    const closedMs = new Date(session.closed_at!).getTime()
    for (const message of messages) {
      const createdMs = new Date(message.created_at).getTime()
      expect(createdMs).toBeGreaterThanOrEqual(openedMs)
      expect(createdMs).toBeLessThanOrEqual(closedMs)
    }
  })

  it('includes at least one message of each mocked type, to exercise every bubble variant', () => {
    const messages = generateMockConversation(makeSession(), 1)
    const types = new Set(messages.map((m) => m.type))

    expect(types.has('text')).toBe(true)
    expect(types.has('photo')).toBe(true)
    expect(types.has('voice')).toBe(true)
  })

  it('sets media_url only for photo messages, and duration_seconds only for voice/video ones', () => {
    const messages = generateMockConversation(makeSession(), 1)

    for (const message of messages) {
      if (message.type === 'photo') {
        expect(message.media_url).not.toBeNull()
      } else {
        expect(message.media_url).toBeNull()
      }
      if (message.type === 'voice' || message.type === 'video') {
        expect(message.duration_seconds).not.toBeNull()
      } else {
        expect(message.duration_seconds).toBeNull()
      }
    }
  })

  it('is deterministic — the same session id always produces the same conversation', () => {
    const a = generateMockConversation(makeSession(), 1)
    const b = generateMockConversation(makeSession(), 1)

    expect(a).toEqual(b)
  })

  it('resolves each message to the same real sender regardless of who is viewing', () => {
    // The real backend returns a self-consistent ChatSessionOut for
    // whoever asks: user 1 (the buyer) sees my_role: 'buyer' with the
    // provider as other_participant, while user 2 (the provider) sees
    // the mirror image. Which of the two real users authored a given
    // message is a fact about the conversation itself — it must come
    // out the same (e.g. "the buyer-role message was sent by user 1")
    // no matter which of the two participants is asking.
    const asBuyerSession = makeSession() // my_role: 'buyer', other_participant: user 2
    const asProviderSession = makeSession({
      my_role: 'provider',
      other_participant: { user_id: 1, display_name: 'Bob', username: 'bob', avatar_url: null },
    })

    const asBuyer = generateMockConversation(asBuyerSession, 1)
    const asProvider = generateMockConversation(asProviderSession, 2)

    expect(asProvider.map((m) => m.sender_id)).toEqual(asBuyer.map((m) => m.sender_id))
  })
})
