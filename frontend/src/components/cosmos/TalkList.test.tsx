import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { TalkList } from './TalkList'
import type { Relation } from '../../lib/relations'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
const api = vi.hoisted(() => ({
  pin: vi.fn(async () => {}),
  mute: vi.fn(async () => {}),
  archived: vi.fn(async () => [] as unknown[]),
}))
vi.mock('../../lib/conversationApi', () => ({
  clearConversationHistory: vi.fn(async () => {}),
  deleteConversation: vi.fn(async () => {}),
  fetchArchivedConversations: api.archived,
  markRead: vi.fn(async () => {}),
  setConversationArchived: vi.fn(async () => {}),
  setConversationMuted: api.mute,
  setConversationPinned: api.pin,
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

  /** A tap as a finger makes it: down, up, then the click. */
  function tap(element: HTMLElement) {
    act(() => {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' }))
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
      element.click()
    })
  }
  /** A finger held on a row for the hold time. */
  function hold(element: HTMLElement) {
    vi.useFakeTimers()
    act(() => {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch' }))
      vi.advanceTimersByTime(600)
      element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
    })
    vi.useRealTimers()
  }
  const names = () => rows().map((r) => r.querySelector('b')?.textContent)

  it('orders by date, not unread first — and never by a paid step', () => {
    render([
      relation(1, { stage: 'received', lastAt: '2026-09-30T12:00:00Z' }),
      relation(2, { unread: true, unreadCount: 1, lastAt: '2026-09-29T12:00:00Z' }),
      relation(3, { lastAt: '2026-09-30T13:00:00Z' }),
    ])
    expect(names()).toEqual(['P3', 'P1', 'P2'])
  })

  it('puts the pinned first, the first pinned highest', () => {
    render([
      relation(1, { lastAt: '2026-09-30T12:00:00Z' }),
      relation(2, { lastAt: '2026-09-28T12:00:00Z', pinnedRank: 1 }),
      relation(3, { lastAt: '2026-09-29T12:00:00Z', pinnedRank: 0 }),
    ])
    expect(names()).toEqual(['P3', 'P2', 'P1'])
  })

  it('opens the conversation with one tap', () => {
    const opened: number[] = []
    render([relation(1, { lastAt: '2026-09-30T12:00:00Z' }), relation(2, { lastAt: '2026-09-29T12:00:00Z' })], opened)
    tap(rows()[1])
    expect(opened).toEqual([2])
  })

  it('selects with a hold, and then a tap picks more instead of opening', () => {
    const opened: number[] = []
    render([relation(1, { lastAt: '2026-09-30T12:00:00Z' }), relation(2, { lastAt: '2026-09-29T12:00:00Z' })], opened)
    hold(rows()[0])
    expect(host.querySelector('.cos-talklist-select')).not.toBeNull()
    tap(rows()[1])
    expect(opened).toEqual([])
    expect(host.querySelector('.cos-select-count')?.textContent).toBe('2')
  })

  it('pins what is selected from the bar', async () => {
    render([relation(1, { lastAt: '2026-09-30T12:00:00Z' })])
    hold(rows()[0])
    const pin = host.querySelector('[aria-label="talkList.select.pin"]') as HTMLButtonElement
    await act(async () => pin.click())
    expect(api.pin).toHaveBeenCalledWith(10, true)
    expect(host.querySelector('.cos-talklist-select')).toBeNull()
  })

  it('says something even when the last thing was not text', () => {
    render([relation(1, { lastText: null })])
    expect(rows()[0].textContent).toContain('talkList.noPreview')
  })
})
