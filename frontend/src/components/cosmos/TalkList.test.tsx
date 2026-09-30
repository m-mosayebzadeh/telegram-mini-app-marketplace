import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { TalkList } from './TalkList'
import type { Relation } from '../../lib/relations'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

/**
 * Conversations as an ordinary list (TECHNICAL_REQUIREMENTS.md section 32,
 * step 2): one row per real thread, with how you met, and one tap in.
 */
describe('the list of conversations', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  const relation = (userId: number, over: Partial<Relation> = {}): Relation => ({
    userId, name: `P${userId}`, avatarUrl: null, stage: 'chat', conversationId: userId * 10,
    lastText: 'hi', lastAt: new Date().toISOString(), unread: false, unreadCount: 0, origin: 'world',
    request: null, session: null, ...over,
  })

  function render(relations: Relation[], opened: number[] = []) {
    act(() =>
      root.render(<TalkList relations={relations} loaded hasMore={false} onNearEnd={() => {}} onOpen={(r) => opened.push(r.userId)} />),
    )
  }
  const rows = () => [...host.querySelectorAll('.cos-talklist-row')] as HTMLElement[]

  it('says what to do when there is nobody yet', () => {
    render([])
    expect(host.textContent).toContain('talkList.empty')
  })

  it('shows each conversation with its last words and how you met', () => {
    render([relation(1, { lastText: 'see you tonight', origin: 'echo', lastAt: '2026-09-30T12:00:00Z' }), relation(2, { lastAt: '2026-09-29T12:00:00Z' })])
    expect(rows()).toHaveLength(2)
    expect(rows()[0].textContent).toContain('see you tonight')
    expect(rows()[0].textContent).toContain('talkList.from.echo')
    expect(rows()[1].textContent).toContain('talkList.from.world')
  })

  it('counts what is unread and marks the row', () => {
    render([relation(1, { unread: true, unreadCount: 3 })])
    expect(rows()[0].classList.contains('is-unread')).toBe(true)
    expect(host.querySelector('.cos-talklist-count')?.textContent).toBe('3')
  })

  it('leaves out people with a request but no conversation — the paid layer is not in this version', () => {
    render([relation(1), relation(2, { conversationId: null, stage: 'received' })])
    expect(rows()).toHaveLength(1)
    // And never shows a paid step's wording, only the last thing said.
    expect(host.textContent).not.toContain('world.stage')
  })

  it('puts what is unread first, then the newest — never a paid step', () => {
    render([
      relation(1, { stage: 'received', lastAt: '2026-09-30T12:00:00Z' }),
      relation(2, { unread: true, unreadCount: 1, lastAt: '2026-09-29T12:00:00Z' }),
      relation(3, { lastAt: '2026-09-30T13:00:00Z' }),
    ])
    expect(rows().map((r) => r.querySelector('b')?.textContent)).toEqual(['P2', 'P3', 'P1'])
  })

  it('opens the conversation with one tap', () => {
    const opened: number[] = []
    render([relation(1, { lastAt: '2026-09-30T12:00:00Z' }), relation(2, { lastAt: '2026-09-29T12:00:00Z' })], opened)
    act(() => rows()[1].click())
    expect(opened).toEqual([2])
  })

  it('says something even when the last thing was not text', () => {
    render([relation(1, { lastText: null })])
    expect(rows()[0].textContent).toContain('talkList.noPreview')
  })
})
