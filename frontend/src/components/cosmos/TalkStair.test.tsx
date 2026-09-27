import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { TalkStair } from './TalkStair'
import type { Relation } from '../../lib/relations'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

/**
 * Conversations by gravity (TECHNICAL_REQUIREMENTS.md sections 30.8 and
 * 30.11): one row per person, a filter for what is waiting, and the card
 * forming only once the person has arrived from their place in the world.
 */
describe('the stair of conversations', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  const relation = (userId: number, over: Partial<Relation> = {}): Relation => ({
    userId, name: `P${userId}`, avatarUrl: null, stage: 'chat', conversationId: userId * 10,
    lastText: 'hi', lastAt: new Date().toISOString(), unread: false, unreadCount: 0, request: null, session: null, ...over,
  })

  function render(relations: Relation[], opened: number[] = [], originOf = () => ({ x: 100, y: 100 })) {
    act(() =>
      root.render(
        <TalkStair relations={relations} loaded originOf={originOf} leaving={false} onOpen={(r) => opened.push(r.userId)} />,
      ),
    )
  }
  const rows = () => [...host.querySelectorAll('.cos-stair-row')] as HTMLElement[]

  it('says so when there is nobody yet', () => {
    render([])
    expect(host.textContent).toContain('world.stairEmpty')
  })

  it('forms each card only after the person has arrived', () => {
    render([relation(1)])
    expect(rows()[0].classList.contains('is-here')).toBe(false)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(rows()[0].classList.contains('is-here')).toBe(true)
  })

  it('starts each person at their own place in the world', () => {
    render([relation(1)], [], () => ({ x: 300, y: 222 }))
    // Before take-off the row sits where the body is: y minus half a row.
    expect(rows()[0].style.transform).toContain('187.0px')
  })

  it('shows what waits on you as solid, and what waits on them as a ghost', () => {
    render([relation(1, { stage: 'received' }), relation(2, { stage: 'sent' })])
    act(() => { vi.advanceTimersByTime(1000) })
    expect(rows()[0].classList.contains('needs')).toBe(true)
    expect(rows()[1].classList.contains('ghost')).toBe(true)
    expect(host.textContent).toContain('world.stage.received')
  })

  it('filters down to what is waiting', () => {
    render([relation(1), relation(2, { stage: 'sent' })])
    act(() => { vi.advanceTimersByTime(1000) })
    const wait = [...host.querySelectorAll('.cos-stair-filter button')][1] as HTMLElement
    act(() => wait.click())
    expect(wait.getAttribute('aria-pressed')).toBe('true')
    // The plain conversation is hidden, not removed: it flies back when
    // the filter is lifted.
    expect(rows()[0].style.opacity).toBe('0')
    expect(rows()[1].style.opacity).not.toBe('0')
  })

  it('opens the conversation with whoever is tapped', () => {
    const opened: number[] = []
    render([relation(1), relation(2)], opened)
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => rows()[1].click())
    expect(opened).toEqual([2])
  })
})
