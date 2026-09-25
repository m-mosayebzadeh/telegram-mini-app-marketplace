import { describe, expect, it } from 'vitest'
import { deliveryOf, laterOf, placeMessage, withWaiting, type ShownMessage } from './thread'
import { backoffMs } from './live'

function message(id: number, overrides: Partial<ShownMessage> = {}): ShownMessage {
  return {
    id,
    conversation_id: 10,
    chat_session_id: null,
    sender_id: 1,
    type: 'text',
    text: String(id),
    duration_seconds: null,
    created_at: '2026-09-25T10:00:00Z',
    flagged_payment: false,
    client_id: null,
    ...overrides,
  }
}

describe('keeping the thread right', () => {
  it('shows a message once however many ways it arrives', () => {
    // The answer to the send and the live event both carry it.
    const once = placeMessage([], message(1))
    expect(placeMessage(once, message(1))).toHaveLength(1)
  })

  it('replaces the clock-marked copy with the confirmed one', () => {
    const waiting = message(-1, { pending: true, client_id: 'a' })
    const confirmed = message(7, { client_id: 'a' })
    const after = placeMessage([waiting], confirmed)
    expect(after).toEqual([confirmed])
  })

  it('never lets a waiting copy replace a confirmed one', () => {
    const confirmed = message(7, { client_id: 'a' })
    const after = placeMessage([confirmed], message(-1, { pending: true, client_id: 'a' }))
    expect(after).toEqual([confirmed])
  })

  it('puts a message that arrives above the ones still waiting', () => {
    const waiting = message(-1, { pending: true, client_id: 'a' })
    const theirs = message(8, { sender_id: 2 })
    expect(placeMessage([message(1), waiting], theirs).map((m) => m.id)).toEqual([1, 8, -1])
  })

  it('keeps what is still waiting after a fresh fetch', () => {
    const waiting = message(-1, { pending: true, client_id: 'a' })
    const sentMeanwhile = message(-2, { pending: true, client_id: 'b' })
    const server = [message(1), message(9, { client_id: 'b' })]
    expect(withWaiting(server, [waiting, sentMeanwhile]).map((m) => m.id)).toEqual([1, 9, -1])
  })
})

describe('ticks', () => {
  it('a clock until the server has it', () => {
    expect(deliveryOf(message(-1, { pending: true }), null)).toBe('sending')
  })

  it('one tick once it has arrived', () => {
    expect(deliveryOf(message(1), null)).toBe('sent')
    expect(deliveryOf(message(1), '2026-09-25T09:59:00Z')).toBe('sent')
  })

  it('two once the other person has read that far', () => {
    expect(deliveryOf(message(1), '2026-09-25T10:00:00Z')).toBe('seen')
  })

  it('never moves a read receipt backwards', () => {
    expect(laterOf('2026-09-25T10:00:00Z', '2026-09-25T09:00:00Z')).toBe('2026-09-25T10:00:00Z')
    expect(laterOf(null, '2026-09-25T09:00:00Z')).toBe('2026-09-25T09:00:00Z')
  })
})

describe('reconnecting', () => {
  it('waits longer each time, up to a ceiling', () => {
    const top = () => 0.999
    expect(backoffMs(0, top)).toBeLessThanOrEqual(1000)
    expect(backoffMs(3, top)).toBeLessThanOrEqual(8000)
    expect(backoffMs(20, top)).toBeLessThanOrEqual(30_000)
  })

  it('spreads phones out so they do not all return in the same second', () => {
    expect(backoffMs(4, () => 0)).not.toBe(backoffMs(4, () => 0.99))
  })
})
