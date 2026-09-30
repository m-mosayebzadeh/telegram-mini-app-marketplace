import { describe, it, expect } from 'vitest'
import { buildNews } from './news'
import type { Relation } from './relations'
import type { ChatSession, IncomingFollowRequest, RequestActivity } from './types'

function relation(userId: number, over: Partial<Relation> = {}): Relation {
  return {
    userId, name: `P${userId}`, avatarUrl: null, stage: 'chat', conversationId: 100 + userId,
    lastText: 'hi', lastAt: '2026-09-01T10:00:00Z', unread: false, unreadCount: 0, origin: 'world', request: null, session: null, ...over,
  }
}

const request = (id: number, over: Partial<RequestActivity> = {}): RequestActivity => ({
  id, offer_id: 1, offer_title: 'Books', offer_price_photons: 120, status: 'pending', reason: null,
  created_at: '2026-09-01T11:00:00Z', responded_at: null, direction: 'received',
  counterpart_user_id: 1, counterpart_display_name: 'P1', counterpart_username: null,
  counterpart_avatar_url: null, ...over,
})

const closed = (id: number, over: Partial<ChatSession> = {}): ChatSession => ({
  id, request_id: 1, transaction_id: 5, status: 'closed', opened_at: '2026-09-01T12:00:00Z',
  closed_at: '2026-09-01T12:30:00Z', closed_by_user_id: null, my_role: 'buyer',
  other_participant: { user_id: 9, display_name: 'P9', username: null, avatar_url: null },
  offer_title: 'Talk', price_photons: 240, session_duration_seconds: 1800, reserved_blocks: 4,
  block_duration_seconds: 450, block_price_photons: 60, started_at: '2026-09-01T12:00:00Z',
  ends_at: '2026-09-01T12:30:00Z', close_at_block_end_by_user_id: null, i_asked_to_stop: false,
  can_stop_at_block_end: false, extension_pending: false, can_request_extension: false,
  consumed_blocks: 4, end_reason: 'completed', i_confirmed_settlement: false,
  they_confirmed_settlement: false, disputed: false, transaction_status: 'pending', archived: false, ...over,
}) as ChatSession

const follow = (id: number, status: 'pending' | 'accepted' = 'pending'): IncomingFollowRequest => ({
  follow_id: id, status, requested_at: '2026-09-01T09:00:00Z', responded_at: null, i_follow_them_back: false,
  requester: { user_id: 50 + id, display_name: `F${id}`, username: null, avatar_url: null } as IncomingFollowRequest['requester'],
})

const none = new Set<string>()

describe('what the news points at', () => {
  it('a payment to make carries its deadline, for the fuse', () => {
    const r = relation(2, { stage: 'accepted', request: request(8, { direction: 'sent', status: 'accepted', pay_by: '2026-09-01T10:15:00Z', responded_at: '2026-09-01T10:00:00Z' }) })
    const [item] = buildNews([r], [], [], none)
    expect(item.payBy).toBe('2026-09-01T10:15:00Z')
    expect(item.confirmedAt).toBe('2026-09-01T10:00:00Z')
  })

  it('a confirmation queued behind somebody says who, and until when', () => {
    const r = relation(1, { stage: 'received', request: request(7, { queued_behind_name: 'Arash', frees_at: '2026-09-01T10:15:00Z' }) })
    const [item] = buildNews([r], [], [], none)
    expect(item.queuedBehind).toBe('Arash')
    expect(item.freesAt).toBe('2026-09-01T10:15:00Z')
  })

  it('an offer somebody accepted, waiting for your confirmation — answerable', () => {
    const [item] = buildNews([relation(1, { stage: 'received', request: request(7) })], [], [], none)
    expect(item.kind).toBe('confirm')
    expect(item.requestId).toBe(7)
    expect(item.photons).toBe(120)
  })

  it('a confirmed acceptance of yours, waiting for your payment', () => {
    const r = relation(2, { stage: 'accepted', request: request(8, { direction: 'sent', status: 'accepted' }) })
    expect(buildNews([r], [], [], none)[0].kind).toBe('pay')
  })

  it('nothing for requests that wait on the other person', () => {
    const r = relation(3, { stage: 'sent', request: request(9, { direction: 'sent' }) })
    expect(buildNews([r], [], [], none)).toHaveLength(0)
  })

  it('an unread conversation, whatever else is going on with that person', () => {
    const r = relation(4, { stage: 'received', request: request(10), unread: true })
    expect(buildNews([r], [], [], none).map((i) => i.kind).sort()).toEqual(['confirm', 'message'])
  })

  it('a pending follow request — answerable', () => {
    expect(buildNews([], [follow(1)], [], none)[0].kind).toBe('follow')
    expect(buildNews([], [follow(1, 'accepted')], [], none)).toHaveLength(0)
  })

  it('a finished session whose Photons wait for your release, with the amount held', () => {
    const [item] = buildNews([], [], [closed(3)], none)
    expect(item.kind).toBe('settle')
    expect(item.photons).toBe(240)
  })

  it('no release item once you released, disputed, or if nothing was used', () => {
    expect(buildNews([], [], [closed(3, { i_confirmed_settlement: true })], none)).toHaveLength(0)
    expect(buildNews([], [], [closed(3, { disputed: true })], none)).toHaveLength(0)
    expect(buildNews([], [], [closed(3, { consumed_blocks: 0 })], none)).toHaveLength(0)
    // The provider never releases their own pay.
    expect(buildNews([], [], [closed(3, { my_role: 'provider' })], none)).toHaveLength(0)
  })

  it('a thank-you after you released', () => {
    const [item] = buildNews([], [], [closed(3, { transaction_status: 'succeeded', thanks_reaction: 'heart' })], none)
    expect(item.kind).toBe('thanks')
    expect(item.reaction).toBe('heart')
  })
})

describe('dismissing is only removing the pointer', () => {
  it('hides a dismissed item', () => {
    const r = relation(1, { stage: 'received', request: request(7) })
    expect(buildNews([r], [], [], new Set(['confirm:7']))).toHaveLength(0)
  })

  it('brings back a NEW message even after the previous one was dismissed', () => {
    const old = relation(4, { unread: true, lastAt: '2026-09-01T10:00:00Z' })
    const key = buildNews([old], [], [], none)[0].key
    const newer = relation(4, { unread: true, lastAt: '2026-09-01T11:00:00Z' })
    expect(buildNews([newer], [], [], new Set([key]))).toHaveLength(1)
  })
})

it('orders the newest first', () => {
  const items = buildNews(
    [relation(1, { unread: true, lastAt: '2026-09-01T08:00:00Z' }), relation(2, { unread: true, lastAt: '2026-09-01T14:00:00Z' })],
    [], [], none,
  )
  expect(items.map((i) => i.userId)).toEqual([2, 1])
})
