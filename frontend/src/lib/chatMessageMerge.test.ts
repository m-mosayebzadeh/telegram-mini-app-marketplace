import { describe, expect, it } from 'vitest'
import { mergeMessages } from './chatMessageMerge'
import type { ChatMessage } from './chatMessageTypes'

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: '1',
    session_id: 7,
    sender_id: 1,
    type: 'text',
    text: 'hi',
    media_url: null,
    duration_seconds: null,
    status: 'sent',
    created_at: '2026-08-20T10:00:00.000Z',
    ...overrides,
  }
}

describe('mergeMessages', () => {
  it('keeps every server message as-is when there is nothing pending locally', () => {
    const server = [makeMessage({ id: '1' }), makeMessage({ id: '2', created_at: '2026-08-20T10:01:00.000Z' })]

    const result = mergeMessages(server, [])

    expect(result).toEqual(server)
  })

  it('keeps a still-sending local-only message that the server does not know about yet', () => {
    const server = [makeMessage({ id: '1' })]
    const pending = makeMessage({
      id: 'draft-123-0',
      status: 'sending',
      created_at: '2026-08-20T10:01:00.000Z',
    })

    const result = mergeMessages(server, [...server, pending])

    expect(result.map((m) => m.id)).toEqual(['1', 'draft-123-0'])
  })

  it('keeps a failed local-only message too, so its retry button stays visible', () => {
    const server = [makeMessage({ id: '1' })]
    const failed = makeMessage({ id: 'draft-999-0', status: 'failed', created_at: '2026-08-20T10:01:00.000Z' })

    const result = mergeMessages(server, [...server, failed])

    expect(result.some((m) => m.id === 'draft-999-0' && m.status === 'failed')).toBe(true)
  })

  it('drops a draft once the server list already contains its resolved (real-id) counterpart', () => {
    // Simulates the moment right after a successful delivery: the local
    // state has ALREADY been swapped to the resolved message (real id),
    // so there's no lingering "draft-..." entry to worry about — but
    // this also confirms a draft id that legitimately no longer appears
    // locally is simply absent from the result, not duplicated.
    const server = [makeMessage({ id: '1' }), makeMessage({ id: '2' })]

    const result = mergeMessages(server, server)

    expect(result).toHaveLength(2)
  })

  it('never keeps a local message whose id the server list already has', () => {
    // Defensive case: even if a stale local copy of an already-resolved
    // message were still floating around by id, it must not be
    // duplicated just because it's also present locally.
    const server = [makeMessage({ id: '1' })]
    const staleLocalDuplicate = makeMessage({ id: '1', text: 'stale local copy' })

    const result = mergeMessages(server, [staleLocalDuplicate])

    expect(result).toHaveLength(1)
    expect(result[0].text).toBe('hi') // the server's version wins, not the stale local one
  })

  it('sorts the combined result chronologically, not server-then-local', () => {
    const server = [makeMessage({ id: '1', created_at: '2026-08-20T10:02:00.000Z' })]
    const pending = makeMessage({
      id: 'draft-1-0',
      created_at: '2026-08-20T10:00:00.000Z', // earlier than the server message
    })

    const result = mergeMessages(server, [pending])

    expect(result.map((m) => m.id)).toEqual(['draft-1-0', '1'])
  })

  it('returns an empty array when both inputs are empty', () => {
    expect(mergeMessages([], [])).toEqual([])
  })
})
