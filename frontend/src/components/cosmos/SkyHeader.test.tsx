import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { SkyHeader } from './SkyHeader'

const mocks = vi.hoisted(() => ({
  t: (key: string, args?: Record<string, unknown>) =>
    args ? `${key} ${JSON.stringify(args)}` : key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'fa' } }),
}))

/**
 * The header gives the world a top without giving it a title bar.
 * Everything below is really one question asked four ways: is this still
 * text written on the sky, or has it started turning into a bar?
 */
describe('the sky header', () => {
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

  function show(around: number, present: number) {
    act(() => {
      root.render(<SkyHeader around={around} present={present} />)
    })
  }

  it('says how many people are around you', () => {
    show(28, 9)
    expect(host.textContent).toContain('sky.peopleAround')
    expect(host.textContent).toContain('28')
  })

  it('says how many of them are here right now', () => {
    show(28, 9)
    const live = host.querySelector('.cos-header-live')
    expect(live?.textContent).toContain('9')
  })

  it('leaves the live line out entirely when nobody is here', () => {
    // Rather than writing "0 here right now", which is a sentence about
    // an absence and reads as something being wrong.
    show(28, 0)
    expect(host.querySelector('.cos-header-live')).toBeNull()
  })

  it('contains nothing that can be pressed', () => {
    // This is the rule the whole element depends on. A bottom tab bar was
    // rejected so that the screen would have exactly one navigation
    // system; something tappable up here would quietly give it a second.
    show(28, 9)
    expect(host.querySelectorAll('button, a, input, [role="button"]').length).toBe(0)
  })
})
