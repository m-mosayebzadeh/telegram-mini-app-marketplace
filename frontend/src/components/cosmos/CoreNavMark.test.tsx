import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { CoreNav, type CoreSection } from './CoreNav'

const mocks = vi.hoisted(() => ({
  t: (key: string) => key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'fa' } }),
}))

/**
 * The mark that says something is waiting.
 *
 * It is a point standing on Sol's own ring rather than a badge or a bell,
 * and the thing worth protecting is that it belongs to a PLACE: it sits
 * at that destination's angle, so opening the system carries it outwards
 * and sets it down on the body it was always about.
 */
describe("the mark on Sol's ring", () => {
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

  function sections(alertOn?: string): CoreSection[] {
    return ['chats', 'echo', 'activity', 'me'].map((id) => ({
      id,
      label: id,
      alert: id === alertOn,
      onChoose: () => {},
    }))
  }

  function show(alertOn?: string) {
    act(() => {
      root.render(<CoreNav sections={sections(alertOn)} />)
    })
  }

  it('shows nothing at all when nothing is waiting', () => {
    show()
    expect(host.querySelectorAll('.cos-core-mark').length).toBe(0)
  })

  it('shows exactly one point for the place that has news', () => {
    show('activity')
    expect(host.querySelectorAll('.cos-core-mark').length).toBe(1)
  })

  it('stands at that place own angle, not at a fixed corner', () => {
    // Four destinations are spread from 150 down to 30 degrees, so the
    // third of them sits at 70. The mark has to agree, or it would drift
    // away from its body the moment the ring opens.
    show('activity')
    const mark = host.querySelector('.cos-core-mark') as HTMLElement
    expect(mark.style.getPropertyValue('--mark-angle')).toBe('70deg')
  })

  it('follows whichever place the news is in', () => {
    show('chats')
    const mark = host.querySelector('.cos-core-mark') as HTMLElement
    expect(mark.style.getPropertyValue('--mark-angle')).toBe('150deg')
  })
})
