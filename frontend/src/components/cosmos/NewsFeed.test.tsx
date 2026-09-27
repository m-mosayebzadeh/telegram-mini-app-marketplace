import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { NewsFeed, TAKE_BACK_MS } from './NewsFeed'
import type { NewsItem } from '../../lib/news'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

/**
 * The news region (TECHNICAL_REQUIREMENTS.md sections 30.19–30.23): a tap
 * goes where an item points, a swipe throws the pointer away, and an answer
 * waits out a take-back window before anything reaches the server.
 */
describe('news', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    Element.prototype.setPointerCapture = () => {}
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  const item = (over: Partial<NewsItem>): NewsItem => ({
    key: 'k', kind: 'message', userId: 2, name: 'Sara', avatarUrl: null,
    at: new Date().toISOString(), conversationId: 7, text: 'hello', ...over,
  })

  function render(items: NewsItem[], handlers: Partial<Parameters<typeof NewsFeed>[0]> = {}) {
    const calls = { open: [] as string[], dismiss: [] as string[], answer: [] as Array<[string, boolean]> }
    act(() =>
      root.render(
        <NewsFeed
          items={items}
          loaded
          onOpen={(i, where) => calls.open.push(`${i.key}${where ? `:${where}` : ''}`)}
          onDismiss={(key) => calls.dismiss.push(key)}
          onAnswer={async (i, yes) => { calls.answer.push([i.key, yes]) }}
          {...handlers}
        />,
      ),
    )
    return calls
  }

  function pointer(el: Element, type: string, x: number, y = 0) {
    act(() => {
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(e, { pointerId: 1, clientX: x, clientY: y })
      el.dispatchEvent(e)
    })
  }

  const click = (el: Element | null) => act(() => { (el as HTMLElement).click() })

  it('says so when there is nothing', () => {
    render([])
    expect(host.textContent).toContain('news.empty')
  })

  it('goes where a plain item points when tapped', () => {
    const calls = render([item({ key: 'm1' })])
    const card = host.querySelector('.cos-feed-card')!
    pointer(card, 'pointerdown', 10)
    pointer(card, 'pointerup', 10)
    expect(calls.open).toEqual(['m1'])
  })

  it('throws an item away when swiped far enough, and not when nudged', () => {
    const calls = render([item({ key: 'm1' })])
    const card = host.querySelector('.cos-feed-card')!
    pointer(card, 'pointerdown', 100)
    pointer(card, 'pointermove', 130)
    pointer(card, 'pointerup', 130)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(calls.dismiss).toEqual([])

    pointer(card, 'pointerdown', 100)
    pointer(card, 'pointermove', 250)
    pointer(card, 'pointerup', 250)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(calls.dismiss).toEqual(['m1'])
    expect(calls.open).toEqual([])
  })

  it('does not open an answerable card on tap — its buttons are the way in', () => {
    const calls = render([item({ key: 'c1', kind: 'confirm', requestId: 5 })])
    const card = host.querySelector('.cos-feed-card')!
    pointer(card, 'pointerdown', 10)
    pointer(card, 'pointerup', 10)
    expect(calls.open).toEqual([])
    expect(host.querySelectorAll('.cos-feed-act')).toHaveLength(3)
  })

  it('sends an answer only once the take-back time has run out', async () => {
    const calls = render([item({ key: 'c1', kind: 'confirm', requestId: 5 })])
    click(host.querySelector('.cos-feed-act.is-yes'))
    expect(host.textContent).toContain('news.doneYes')
    act(() => { vi.advanceTimersByTime(TAKE_BACK_MS - 100) })
    expect(calls.answer).toEqual([])
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(calls.answer).toEqual([['c1', true]])
  })

  it('sends nothing at all when the answer is taken back', () => {
    const calls = render([item({ key: 'f1', kind: 'follow', followerId: 2 })])
    click(host.querySelectorAll('.cos-feed-act')[1])
    click(host.querySelector('.cos-feed-act.is-undo'))
    act(() => { vi.advanceTimersByTime(TAKE_BACK_MS * 2) })
    expect(calls.answer).toEqual([])
    // And the card is answerable again.
    expect(host.querySelector('.cos-feed-act.is-yes')).not.toBeNull()
  })

  it('sends a follow request’s third button to the profile', () => {
    const calls = render([item({ key: 'f1', kind: 'follow', followerId: 2 })])
    click(host.querySelector('.cos-feed-act.is-quiet'))
    expect(calls.open).toEqual(['f1:profile'])
  })

  it('says so when a settled answer fails, and offers it again', async () => {
    render([item({ key: 'c1', kind: 'confirm', requestId: 5 })], {
      onAnswer: () => Promise.reject(new Error('no')),
    })
    click(host.querySelector('.cos-feed-act.is-yes'))
    await act(async () => { vi.advanceTimersByTime(TAKE_BACK_MS + 10) })
    expect(host.textContent).toContain('news.failed')
    expect(host.querySelector('.cos-feed-act.is-yes')).not.toBeNull()
  })
})
