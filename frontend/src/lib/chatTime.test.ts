import { describe, expect, it } from 'vitest'
import { formatElapsedTime, groupMessagesByDate } from './chatTime'
import type { ChatMessage } from './chatMessageTypes'

describe('formatElapsedTime', () => {
  it('shows MM:SS for zero elapsed time', () => {
    const openedAt = '2026-08-20T10:00:00.000Z'
    const now = new Date('2026-08-20T10:00:00.000Z')
    expect(formatElapsedTime(openedAt, now)).toBe('00:00')
  })

  it('shows MM:SS under an hour', () => {
    const openedAt = '2026-08-20T10:00:00.000Z'
    const now = new Date('2026-08-20T10:05:09.000Z')
    expect(formatElapsedTime(openedAt, now)).toBe('05:09')
  })

  it('switches to H:MM:SS past one hour', () => {
    const openedAt = '2026-08-20T10:00:00.000Z'
    const now = new Date('2026-08-20T11:02:03.000Z')
    expect(formatElapsedTime(openedAt, now)).toBe('1:02:03')
  })

  it('clamps to zero instead of going negative on clock skew', () => {
    const openedAt = '2026-08-20T10:00:00.000Z'
    const now = new Date('2026-08-20T09:59:00.000Z') // "now" before opened_at
    expect(formatElapsedTime(openedAt, now)).toBe('00:00')
  })
})

describe('groupMessagesByDate', () => {
  function makeMessage(id: string, createdAt: string): ChatMessage {
    return {
      id,
      session_id: 1,
      sender_id: 1,
      type: 'text',
      text: 'hi',
      media_url: null,
      duration_seconds: null,
      status: 'sent',
      created_at: createdAt,
    }
  }

  it('returns one group for messages all on the same day', () => {
    const messages = [
      makeMessage('a', '2026-08-20T09:00:00.000Z'),
      makeMessage('b', '2026-08-20T10:00:00.000Z'),
      makeMessage('c', '2026-08-20T23:59:00.000Z'),
    ]

    const groups = groupMessagesByDate(messages)

    expect(groups).toHaveLength(1)
    expect(groups[0].dateKey).toBe('2026-08-20')
    expect(groups[0].messages).toHaveLength(3)
  })

  it('splits into separate groups when the date changes, preserving order', () => {
    const messages = [
      makeMessage('a', '2026-08-20T09:00:00.000Z'),
      makeMessage('b', '2026-08-21T00:05:00.000Z'),
      makeMessage('c', '2026-08-21T10:00:00.000Z'),
    ]

    const groups = groupMessagesByDate(messages)

    expect(groups.map((g) => g.dateKey)).toEqual(['2026-08-20', '2026-08-21'])
    expect(groups[0].messages.map((m) => m.id)).toEqual(['a'])
    expect(groups[1].messages.map((m) => m.id)).toEqual(['b', 'c'])
  })

  it('re-splits correctly when the date goes back and forth across the list', () => {
    // Not realistic for real chronological data, but confirms the
    // function groups by CONSECUTIVE runs, not by collecting every
    // message that ever shared a date into one bucket.
    const messages = [
      makeMessage('a', '2026-08-20T09:00:00.000Z'),
      makeMessage('b', '2026-08-21T09:00:00.000Z'),
      makeMessage('c', '2026-08-20T09:00:00.000Z'),
    ]

    const groups = groupMessagesByDate(messages)

    expect(groups).toHaveLength(3)
  })

  it('returns an empty array for an empty message list', () => {
    expect(groupMessagesByDate([])).toEqual([])
  })
})
