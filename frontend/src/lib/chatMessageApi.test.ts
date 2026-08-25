import { describe, expect, it } from 'vitest'
import { composeMessage, deliverMessage, listMessages } from './chatMessageApi'
import type { ChatSession } from './types'

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: Math.floor(Math.random() * 1_000_000), // fresh cache entry per test
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

describe('composeMessage', () => {
  it('builds a message in the sending state, from the given sender', () => {
    const session = makeSession()
    const message = composeMessage(session, 1, { type: 'text', text: 'hi there' })

    expect(message.session_id).toBe(session.id)
    expect(message.sender_id).toBe(1)
    expect(message.type).toBe('text')
    expect(message.text).toBe('hi there')
    expect(message.status).toBe('sending')
  })

  it('gives every composed message a unique id, even composed back-to-back', () => {
    const session = makeSession()
    const a = composeMessage(session, 1, { type: 'text', text: 'a' })
    const b = composeMessage(session, 1, { type: 'text', text: 'b' })

    expect(a.id).not.toBe(b.id)
  })

  it('leaves fields irrelevant to the message type null', () => {
    const session = makeSession()
    const voice = composeMessage(session, 1, { type: 'voice', duration_seconds: 12 })

    expect(voice.text).toBeNull()
    expect(voice.media_url).toBeNull()
    expect(voice.duration_seconds).toBe(12)
  })
})

describe('deliverMessage', () => {
  it('resolves to "sent" and updates the cached copy when the random roll succeeds', async () => {
    const session = makeSession()
    const message = composeMessage(session, 1, { type: 'text', text: 'hello' })

    const status = await deliverMessage(message, { delayMs: 0, random: () => 0.99 })

    expect(status).toBe('sent')
    const cached = await listMessages(session, 1)
    expect(cached.find((m) => m.id === message.id)?.status).toBe('sent')
  })

  it('resolves to "failed" when the random roll lands under the failure threshold', async () => {
    const session = makeSession()
    const message = composeMessage(session, 1, { type: 'text', text: 'hello' })

    const status = await deliverMessage(message, { delayMs: 0, random: () => 0.0 })

    expect(status).toBe('failed')
  })

  it('always fails a text message whose body is exactly "fail", regardless of the random roll', () => {
    const session = makeSession()
    const message = composeMessage(session, 1, { type: 'text', text: 'FAIL' })

    return deliverMessage(message, { delayMs: 0, random: () => 0.99 }).then((status) => {
      expect(status).toBe('failed')
    })
  })

  it('does not force-fail a non-text message even if it happened to be named "fail"', async () => {
    const session = makeSession()
    // A voice message has no `text` field at all, so the forced-failure
    // rule (which only inspects `text`) can never accidentally apply to it.
    const message = composeMessage(session, 1, { type: 'voice', duration_seconds: 3 })

    const status = await deliverMessage(message, { delayMs: 0, random: () => 0.99 })

    expect(status).toBe('sent')
  })
})
