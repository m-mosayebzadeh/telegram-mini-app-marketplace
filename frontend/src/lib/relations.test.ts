import { describe, it, expect } from 'vitest'
import { buildRelations, minutesLeft, orderRelations, stageOfRequest, type Relation } from './relations'
import type { Conversation } from './conversationApi'
import type { ChatSession, RequestActivity } from './types'

const person = (id: number) => ({ user_id: id, display_name: `P${id}`, username: null, avatar_url: null })

function conversation(id: number, userId: number, over: Partial<Conversation> = {}): Conversation {
  return {
    id, kind: 'direct', created_at: '2026-09-01T10:00:00Z', last_message_at: '2026-09-01T10:00:00Z',
    others: [person(userId)], capabilities: [], active_session_id: null, archived: false, unread: false,
    last_text: 'hi', others_read_at: null, ...over,
  }
}

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

const stageOf = (list: Relation[], userId: number) => list.find((r) => r.userId === userId)?.stage

describe('what stage a request puts a relationship in', () => {
  it('names each step by who has to act next', () => {
    expect(stageOfRequest(request(1, 2, { direction: 'received' }), [])).toBe('received')
    expect(stageOfRequest(request(1, 2, { direction: 'sent' }), [])).toBe('sent')
    expect(stageOfRequest(request(1, 2, { direction: 'sent', status: 'accepted' }), [])).toBe('accepted')
    expect(stageOfRequest(request(1, 2, { direction: 'received', status: 'accepted' }), [])).toBe('awaitpay')
  })

  it('drops requests that are over', () => {
    expect(stageOfRequest(request(1, 2, { status: 'rejected' }), [])).toBeNull()
    expect(stageOfRequest(request(1, 2, { status: 'cancelled' }), [])).toBeNull()
    // Paid: it is a session now, not a request.
    expect(stageOfRequest(request(1, 2, { status: 'accepted', direction: 'sent' }), [session(1, 2, { request_id: 1 })])).toBeNull()
  })
})

describe('one entry per person', () => {
  it('folds a conversation, a request and a session with the same person into one', () => {
    const list = buildRelations([conversation(5, 2)], [request(1, 2)], [session(1, 2)])
    expect(list).toHaveLength(1)
    expect(list[0].stage).toBe('session')
    expect(list[0].conversationId).toBe(5)
  })

  it('keeps a request with somebody you have never written to', () => {
    const list = buildRelations([], [request(1, 7)], [])
    expect(stageOf(list, 7)).toBe('received')
    expect(list[0].conversationId).toBeNull()
  })

  it('lets the most urgent request set the stage when there are several', () => {
    // You are waiting on them for one, and they are waiting on you for the
    // other: what matters is the one you can act on.
    const list = buildRelations([], [
      request(1, 3, { direction: 'sent' }),
      request(2, 3, { direction: 'received' }),
    ], [])
    expect(stageOf(list, 3)).toBe('received')
  })

  it('ignores group conversations — a group is not a person', () => {
    const group = conversation(9, 4, { kind: 'group', others: [person(4), person(5)] })
    expect(buildRelations([group], [], [])).toHaveLength(0)
  })
})

describe('the order on the stair', () => {
  it('session first, then what waits on you, then unread, then the rest newest first', () => {
    const list = buildRelations(
      [
        conversation(1, 10, { unread: true, last_message_at: '2026-09-01T09:00:00Z' }),
        conversation(2, 11, { last_message_at: '2026-09-01T13:00:00Z' }),
      ],
      [
        request(1, 12, { direction: 'sent', created_at: '2026-09-01T14:00:00Z' }),
        request(2, 13, { direction: 'received', created_at: '2026-09-01T08:00:00Z' }),
      ],
      [session(1, 14)],
    )
    expect(orderRelations(list).map((r) => r.userId)).toEqual([14, 13, 10, 12, 11])
  })

  it('does not let a request waiting on the other person jump ahead of an unread message', () => {
    const list = buildRelations(
      [conversation(1, 20, { unread: true, last_message_at: '2026-09-01T09:00:00Z' })],
      [request(1, 21, { direction: 'sent', created_at: '2026-09-01T15:00:00Z' })],
      [],
    )
    expect(orderRelations(list)[0].userId).toBe(20)
  })
})

describe('time left in a running session', () => {
  const s = session(1, 2)
  const at = (iso: string) => new Date(iso).getTime()

  it('counts to the planned end', () => {
    expect(minutesLeft(s, at('2026-09-01T12:20:00Z'))).toBe(10)
  })

  it('counts to the end of THIS block once someone asked to stop there', () => {
    // Blocks are 7.5 minutes: 12:20 is inside the third block, which ends
    // at 12:22:30.
    const stopping = { ...s, close_at_block_end_by_user_id: 2 }
    expect(minutesLeft(stopping, at('2026-09-01T12:20:00Z'))).toBe(3)
  })

  it('has nothing to count before the session starts', () => {
    expect(minutesLeft({ ...s, started_at: null }, at('2026-09-01T12:20:00Z'))).toBeNull()
  })
})

describe('how many are unread', () => {
  it('carries the number from the conversation, for the row', () => {
    const [r] = buildRelations([conversation(1, 2, { unread: true, unread_count: 3 })], [], [])
    expect(r.unreadCount).toBe(3)
  })

  it('shows at least one when the server only says there is something', () => {
    const [r] = buildRelations([conversation(1, 2, { unread: true })], [], [])
    expect(r.unreadCount).toBe(1)
  })

  it('shows none when everything is read', () => {
    const [r] = buildRelations([conversation(1, 2, { unread: false, unread_count: 0 })], [], [])
    expect(r.unreadCount).toBe(0)
  })
})
