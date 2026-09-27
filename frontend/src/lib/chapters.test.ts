import { describe, it, expect } from 'vitest'
import { chaptersOf } from './chapters'

const m = (id: number, at: string, session: number | null = null) => ({ id, created_at: at, chat_session_id: session })

describe('a conversation told in chapters', () => {
  it('keeps free talk together and dates each new day', () => {
    const chapters = chaptersOf([m(1, '2026-09-20T10:00:00'), m(2, '2026-09-20T11:00:00'), m(3, '2026-09-21T09:00:00')])
    expect(chapters).toHaveLength(1)
    expect(chapters[0].kind).toBe('free')
    if (chapters[0].kind !== 'free') return
    expect(chapters[0].messages.map((x) => x.newDay)).toEqual([true, false, true])
  })

  it('puts a paid session in a band of its own', () => {
    const chapters = chaptersOf([
      m(1, '2026-09-20T10:00:00'),
      m(2, '2026-09-20T10:05:00', 7),
      m(3, '2026-09-20T10:06:00', 7),
      m(4, '2026-09-20T10:40:00'),
    ])
    expect(chapters.map((c) => c.kind)).toEqual(['free', 'session', 'free'])
    expect(chapters[1]).toMatchObject({ kind: 'session', sessionId: 7 })
    if (chapters[1].kind === 'session') expect(chapters[1].messages.map((x) => x.id)).toEqual([2, 3])
  })

  it('dates the talk that follows a session again', () => {
    const chapters = chaptersOf([m(1, '2026-09-20T10:05:00', 7), m(2, '2026-09-20T10:40:00')])
    if (chapters[1].kind !== 'free') throw new Error('expected free talk')
    expect(chapters[1].messages[0].newDay).toBe(true)
  })

  it('keeps two sessions apart even when one follows the other', () => {
    const chapters = chaptersOf([m(1, '2026-09-20T10:05:00', 7), m(2, '2026-09-20T11:05:00', 8)])
    expect(chapters.map((c) => (c.kind === 'session' ? c.sessionId : 0))).toEqual([7, 8])
  })
})
