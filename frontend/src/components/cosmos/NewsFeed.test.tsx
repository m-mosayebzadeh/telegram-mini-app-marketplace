import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { NewsFeed } from './NewsFeed'
import { FLIP_BACK_MS, SETTLE_MS, UNDO_MS, DROP_MS } from '../../lib/newsStream'
import type { NewsItem } from '../../lib/news'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

/**
 * The news region, as the approved prototype behaves (TECHNICAL_REQUIREMENTS.md
 * sections 30.19–30.23 and 31): a tap goes where a plain item points, a
 * swipe throws the pointer into the black hole, an answerable card turns
 * over to its buttons, and an answer settles for a few seconds — during
 * which a touch takes it back — before anything reaches the server.
 */
describe('news', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
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

  type Props = Parameters<typeof NewsFeed>[0]
  function render(items: NewsItem[], handlers: Partial<Props> = {}) {
    const calls = { open: [] as string[], dismiss: [] as string[], answer: [] as Array<[string, boolean]> }
    const draw = (list: NewsItem[]) =>
      act(() =>
        root.render(
          <NewsFeed
            items={list}
            loaded
            onOpen={(i, where) => calls.open.push(`${i.key}${where ? `:${where}` : ''}`)}
            onDismiss={(key) => calls.dismiss.push(key)}
            onAnswer={async (i, yes) => { calls.answer.push([i.key, yes]) }}
            {...handlers}
          />,
        ),
      )
    draw(items)
    return { calls, draw }
  }

  function pointer(el: Element, type: string, x: number, y = 0) {
    act(() => {
      const e = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(e, { pointerId: 1, clientX: x, clientY: y })
      el.dispatchEvent(e)
    })
  }
  const tap = (el: Element) => { pointer(el, 'pointerdown', 10, 10); pointer(el, 'pointerup', 10, 10) }
  const click = (el: Element | null) => act(() => { (el as HTMLElement).click() })
  const card = (key: string) => host.querySelector(`[data-news-key="${key}"]`)
  const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

  it('draws the wormhole, the line and the black hole, and says when there is nothing', () => {
    render([])
    expect(host.querySelectorAll('.cos-news-hole')).toHaveLength(2)
    expect(host.querySelector('.cos-news-hole.is-sink')).not.toBeNull()
    expect(host.querySelector('.cos-news-spine')).not.toBeNull()
    expect(host.querySelector('.cos-news-end')?.textContent).toBe('news.allSeen')
  })

  it('hangs the cards one step apart and ends the stream with a line', () => {
    render([item({ key: 'a' }), item({ key: 'b' })])
    const [a, b] = [card('a') as HTMLElement, card('b') as HTMLElement]
    const y = (el: HTMLElement) => Number(/translate3d\(0, ([\d.]+)px/.exec(el.style.transform)?.[1])
    expect(y(b) - y(a)).toBe(76)
    expect(host.querySelector('.cos-news-end')?.textContent).toBe('news.end')
  })

  it('explains the gestures on the first visit only', () => {
    render([])
    expect(host.querySelector('.cos-news-toast')?.textContent).toBe('news.hint')
    act(() => root.unmount())
    root = createRoot(host)
    render([])
    expect(host.querySelector('.cos-news-toast')).toBeNull()
  })

  it('goes where a plain item points when tapped, and it is no longer news', () => {
    const { calls } = render([item({ key: 'm1' })])
    tap(card('m1')!)
    expect(calls.open).toEqual(['m1'])
    expect(calls.dismiss).toEqual(['m1'])
  })

  it('throws an item into the black hole when swiped far enough, and not when nudged', () => {
    const { calls } = render([item({ key: 'm1' })])
    pointer(card('m1')!, 'pointerdown', 100)
    pointer(card('m1')!, 'pointermove', 130)
    expect(card('m1')!.classList.contains('is-held')).toBe(true)
    pointer(card('m1')!, 'pointerup', 130)
    expect(calls.dismiss).toEqual([])
    expect(card('m1')!.classList.contains('is-held')).toBe(false)

    pointer(card('m1')!, 'pointerdown', 100)
    pointer(card('m1')!, 'pointermove', 250)
    pointer(card('m1')!, 'pointerup', 250)
    expect(calls.dismiss).toEqual(['m1'])
    expect(calls.open).toEqual([])
    // It falls towards the black hole, and is gone once it has.
    expect(card('m1')!.classList.contains('is-falling')).toBe(true)
    wait(DROP_MS + 10)
    expect(card('m1')).toBeNull()
  })

  it('scrolls on an upward drag instead of opening or throwing', () => {
    const many = Array.from({ length: 12 }, (_, k) => item({ key: `m${k}` }))
    const { calls } = render(many)
    const before = (card('m0') as HTMLElement).style.transform
    pointer(card('m0')!, 'pointerdown', 50, 400)
    pointer(card('m0')!, 'pointermove', 50, 300)
    pointer(card('m0')!, 'pointerup', 50, 300)
    expect((card('m0') as HTMLElement).style.transform).not.toBe(before)
    expect(calls.open).toEqual([])
    expect(calls.dismiss).toEqual([])
  })

  it('turns an answerable card over on a tap instead of opening it, and back again', () => {
    const { calls } = render([item({ key: 'c1', kind: 'confirm', requestId: 5 })])
    expect(card('c1')!.classList.contains('is-turnable')).toBe(true)
    tap(card('c1')!)
    expect(calls.open).toEqual([])
    expect(card('c1')!.classList.contains('is-turned')).toBe(true)
    expect(host.querySelectorAll('.cos-news-act')).toHaveLength(3)
    tap(card('c1')!)
    expect(card('c1')!.classList.contains('is-turned')).toBe(false)
  })

  it('turns a card left over back by itself after a while', () => {
    render([item({ key: 'c1', kind: 'confirm', requestId: 5 })])
    tap(card('c1')!)
    wait(FLIP_BACK_MS + 10)
    expect(card('c1')!.classList.contains('is-turned')).toBe(false)
  })

  it('gathers a confirmed card and sends the answer only once it has settled', async () => {
    const { calls } = render([item({ key: 'c1', kind: 'confirm', requestId: 5 })])
    tap(card('c1')!)
    click(host.querySelector('.cos-news-act.is-yes'))
    expect(card('c1')!.classList.contains('is-gathering')).toBe(true)
    expect(card('c1')!.classList.contains('is-turned')).toBe(false)
    expect(card('c1')!.textContent).toContain('news.youConfirmed')
    expect(card('c1')!.textContent).toContain('news.touchToUndo')
    wait(SETTLE_MS - 100)
    expect(calls.answer).toEqual([])
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(calls.answer).toEqual([['c1', true]])
    // The person has left the card for Sol: the card is gone.
    expect(card('c1')).toBeNull()
  })

  it('burns a refused card to ash and lets it fall into the black hole', async () => {
    const { calls } = render([item({ key: 'c1', kind: 'confirm', requestId: 5 })])
    tap(card('c1')!)
    click(host.querySelectorAll('.cos-news-act')[1])
    expect(card('c1')!.classList.contains('is-burning')).toBe(true)
    expect(card('c1')!.textContent).toContain('news.youRefused')
    await act(async () => { vi.advanceTimersByTime(SETTLE_MS + 10) })
    expect(calls.answer).toEqual([['c1', false]])
    wait(400)
    expect(card('c1')).toBeNull()
  })

  it('takes the answer back when the settling card is touched, and sends nothing', () => {
    const { calls } = render([item({ key: 'f1', kind: 'follow', followerId: 2 })])
    tap(card('f1')!)
    click(host.querySelectorAll('.cos-news-act')[1])
    wait(SETTLE_MS / 2)
    tap(card('f1')!)
    wait(UNDO_MS + 10)
    wait(SETTLE_MS * 2)
    expect(calls.answer).toEqual([])
    // Exactly as it was: calm, saying what it said, answerable again.
    expect(card('f1')!.classList.contains('is-burning')).toBe(false)
    expect(card('f1')!.textContent).toContain('news.follow.body')
    tap(card('f1')!)
    expect(card('f1')!.classList.contains('is-turned')).toBe(true)
  })

  it('offers a follow request’s profile rather than a conversation', () => {
    const { calls } = render([item({ key: 'f1', kind: 'follow', followerId: 2 })])
    tap(card('f1')!)
    expect(host.querySelector('.cos-news-act.is-yes')?.textContent).toBe('news.accept')
    click(host.querySelector('.cos-news-act.is-talk'))
    expect(calls.open).toEqual(['f1:profile'])
  })

  it('brings the card back, saying so, when a settled answer fails', async () => {
    render([item({ key: 'c1', kind: 'confirm', requestId: 5 })], {
      onAnswer: () => Promise.reject(new Error('no')),
    })
    tap(card('c1')!)
    click(host.querySelector('.cos-news-act.is-yes'))
    await act(async () => { vi.advanceTimersByTime(SETTLE_MS + 10) })
    expect(card('c1')!.textContent).toContain('news.failed')
    expect(card('c1')!.classList.contains('is-gathering')).toBe(false)
  })

  it('sends nothing if the region is left while an answer is settling', () => {
    const { calls } = render([item({ key: 'c1', kind: 'confirm', requestId: 5 })])
    tap(card('c1')!)
    click(host.querySelector('.cos-news-act.is-yes'))
    act(() => root.unmount())
    root = createRoot(host)
    wait(SETTLE_MS * 2)
    expect(calls.answer).toEqual([])
  })

  it('brings something new out of the wormhole, and leaves what was there hanging', () => {
    const first = item({ key: 'a' })
    const { draw } = render([first])
    expect(card('a')!.classList.contains('is-emerging')).toBe(false)
    draw([item({ key: 'b' }), first])
    expect(card('b')!.classList.contains('is-emerging')).toBe(true)
    expect(card('a')!.classList.contains('is-emerging')).toBe(false)
    // A couple of frames later it has been let go, towards its place.
    wait(100)
    expect(card('b')!.classList.contains('is-emerging')).toBe(false)
  })
})
