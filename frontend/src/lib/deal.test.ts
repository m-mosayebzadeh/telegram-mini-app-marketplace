import { describe, it, expect } from 'vitest'
import { blockNow, dealWith, requestWaitsOn } from './deal'
import type { ChatSession, RequestActivity } from './types'

const person = (id: number) => ({ user_id: id, display_name: `P${id}`, username: null, avatar_url: null })

function request(id: number, userId: number, over: Partial<RequestActivity> = {}): RequestActivity {
  return {
    id, offer_id: 1, offer_title: 'Talk', offer_price_photons: 120, status: 'pending', reason: null,
    created_at: '2026-09-01T11:00:00Z', responded_at: null, direction: 'received',
    counterpart_user_id: userId, counterpart_display_name: `P${userId}`, counterpart_username: null,
    counterpart_avatar_url: null, ...over,
  }
}

function session(id: number, userId: number, over: Partial<ChatSession> = {}): ChatSession {
  return {
    id, request_id: 900 + id, transaction_id: null, status: 'open', opened_at: '2026-09-01T12:00:00Z',
    closed_at: null, closed_by_user_id: null, my_role: 'buyer', other_participant: person(userId),
    offer_title: 'Talk', price_photons: 240, session_duration_seconds: 1800, reserved_blocks: 4,
    block_duration_seconds: 450, block_price_photons: 60, started_at: '2026-09-01T12:00:00Z',
    ends_at: '2026-09-01T12:30:00Z', close_at_block_end_by_user_id: null, i_asked_to_stop: false,
    can_stop_at_block_end: true, extension_pending: false, can_request_extension: false,
    consumed_blocks: 0, end_reason: null, i_confirmed_settlement: false, they_confirmed_settlement: false,
    disputed: false, transaction_status: null, archived: false, ...over,
  } as ChatSession
}

const closed = (id: number, userId: number, over: Partial<ChatSession> = {}) =>
  session(id, userId, { status: 'closed', closed_at: '2026-09-01T12:30:00Z', consumed_blocks: 3, transaction_status: 'pending', ...over })

describe('what the conversation with one person shows', () => {
  it('shows nothing when you only talk', () => {
    expect(dealWith(2, [], [])).toBeNull()
  })

  it('puts a running session before everything else', () => {
    const deal = dealWith(2, [request(1, 2)], [session(5, 2), closed(4, 2)])
    expect(deal?.kind).toBe('session')
  })

  it('shows the request that needs you before one that waits on them', () => {
    const deal = dealWith(2, [request(1, 2, { direction: 'sent' }), request(2, 2, { direction: 'received' })], [])
    expect(deal).toMatchObject({ kind: 'request', stage: 'received' })
  })

  it('ignores other people', () => {
    expect(dealWith(2, [request(1, 3)], [session(5, 3)])).toBeNull()
  })

  it('tells a finished session what it held and what came back', () => {
    const deal = dealWith(2, [], [closed(4, 2)])
    // Three of four blocks used at 60 each: 180 held, 60 already refunded.
    expect(deal).toMatchObject({ kind: 'ending', held: 180, refunded: 60 })
  })

  it('only looks at the latest finished session', () => {
    const older = closed(3, 2, { closed_at: '2026-08-01T10:00:00Z' })
    const newer = closed(4, 2, { transaction_status: 'succeeded', closed_at: '2026-09-01T12:30:00Z', my_role: 'provider' })
    expect(dealWith(2, [], [older, newer])).toMatchObject({ kind: 'thank', session: { id: 4 } })
  })

  it('has nothing to release when nothing was used, or when it is disputed', () => {
    expect(dealWith(2, [], [closed(4, 2, { consumed_blocks: 0 })])).toBeNull()
    expect(dealWith(2, [], [closed(4, 2, { disputed: true })])).toBeNull()
  })

  it('lets only the offerer say thank you, and only once', () => {
    const released = { transaction_status: 'succeeded' as const }
    expect(dealWith(2, [], [closed(4, 2, { ...released, my_role: 'provider' })])?.kind).toBe('thank')
    expect(dealWith(2, [], [closed(4, 2, { ...released, my_role: 'provider', thanks_reaction: 'heart' })])).toBeNull()
    expect(dealWith(2, [], [closed(4, 2, { ...released, my_role: 'buyer' })])).toBeNull()
  })

  it('leaves a thank-you already sent to the conversation itself, not to a card', () => {
    // It stays at the end of that session's messages like a reaction, for
    // as long as the conversation does — so there is nothing left to do.
    const thanked = { transaction_status: 'succeeded' as const, thanks_reaction: 'pray' }
    expect(dealWith(2, [], [closed(4, 2, { ...thanked, my_role: 'buyer' })])).toBeNull()
    expect(dealWith(2, [], [closed(4, 2, { ...thanked, my_role: 'provider' })])).toBeNull()
  })
})

describe('who a request waits on', () => {
  it('follows who has to act next', () => {
    expect(requestWaitsOn('received')).toBe('you')
    expect(requestWaitsOn('accepted')).toBe('you')
    expect(requestWaitsOn('sent')).toBe('them')
    expect(requestWaitsOn('awaitpay')).toBe('them')
    expect(requestWaitsOn('chat')).toBeNull()
  })
})

describe('which block a session is in', () => {
  const s = session(1, 2)
  const at = (minutes: number) => new Date('2026-09-01T12:00:00Z').getTime() + minutes * 60_000

  it('counts blocks from one and knows the last', () => {
    expect(blockNow(s, at(1))).toEqual({ block: 1, of: 4, last: false })
    expect(blockNow(s, at(8))).toEqual({ block: 2, of: 4, last: false })
    expect(blockNow(s, at(23))).toEqual({ block: 4, of: 4, last: true })
    // Past the end it stays on the last block rather than inventing a fifth.
    expect(blockNow(s, at(40))).toEqual({ block: 4, of: 4, last: true })
  })

  it('has no block before the session starts', () => {
    expect(blockNow(session(1, 2, { started_at: null }), at(1))).toBeNull()
  })
})
