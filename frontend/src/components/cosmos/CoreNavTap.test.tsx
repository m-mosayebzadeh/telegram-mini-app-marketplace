import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { CoreNav, type CoreSection } from './CoreNav'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fa' } }),
}))

/**
 * Sol by tap (TECHNICAL_REQUIREMENTS.md section 30.12): a tap is always one
 * step closer to the menu, and once the menu is open by a tap, a second tap
 * on a place goes there. Holding and sweeping stays the fast way.
 */
describe('Sol, opened by a tap', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    Element.prototype.setPointerCapture = () => {}
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  function sections(chosen: string[]): CoreSection[] {
    return ['talk', 'news', 'echo', 'me'].map((id) => ({ id, label: id, onChoose: () => chosen.push(id) }))
  }

  /** A press on Sol that never moves: a tap. */
  function tapSol() {
    const sol = host.querySelector('.cos-core') as HTMLElement
    // Press and release as two moments, the way a finger does: the screen
    // updates in between, and the release reads what the press set.
    for (const type of ['pointerdown', 'pointerup']) {
      act(() => {
        const e = new Event(type, { bubbles: true, cancelable: true })
        Object.assign(e, { pointerId: 1, clientX: 0, clientY: 0 })
        sol.dispatchEvent(e)
      })
    }
  }

  it('opens the menu when the owner says a tap should', () => {
    const chosen: string[] = []
    act(() => root.render(<CoreNav sections={sections(chosen)} onTap={() => 'menu'} />))
    tapSol()
    expect(host.querySelector('.cos-core-area')?.classList.contains('is-tapmode')).toBe(true)
    expect(host.querySelectorAll('button.cos-sat')).toHaveLength(4)
  })

  it('does whatever else the tap means when it does not open the menu', () => {
    let taps = 0
    act(() => root.render(<CoreNav sections={sections([])} onTap={() => { taps += 1 }} />))
    tapSol()
    expect(taps).toBe(1)
    expect(host.querySelector('.cos-core-area')?.classList.contains('is-tapmode')).toBe(false)
  })

  it('goes to a place with a second tap, and closes', () => {
    const chosen: string[] = []
    act(() => root.render(<CoreNav sections={sections(chosen)} onTap={() => 'menu'} />))
    tapSol()
    const news = [...host.querySelectorAll('button.cos-sat')].find((b) => b.textContent?.includes('news')) as HTMLElement
    act(() => news.click())
    expect(chosen).toEqual(['news'])
    expect(host.querySelector('.cos-core-area')?.classList.contains('is-open')).toBe(false)
  })

  it('closes when Sol is tapped again', () => {
    act(() => root.render(<CoreNav sections={sections([])} onTap={() => 'menu'} />))
    tapSol()
    tapSol()
    expect(host.querySelector('.cos-core-area')?.classList.contains('is-open')).toBe(false)
  })

  it('does not answer clicks on a place while the menu is only held, not tapped open', () => {
    const chosen: string[] = []
    act(() => root.render(<CoreNav sections={sections(chosen)} onTap={() => {}} />))
    expect(host.querySelectorAll('button.cos-sat')).toHaveLength(0)
    expect(chosen).toEqual([])
  })

  it('has no flare any more', () => {
    act(() => root.render(<CoreNav sections={sections([])} onTap={() => 'menu'} />))
    tapSol()
    expect(host.querySelector('.cos-beam')).toBeNull()
  })
})

describe('news gathered beside Sol', () => {
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

  it('shows the count and opens the news', () => {
    let opened = 0
    act(() => root.render(<CoreNav sections={[]} badge={{ count: 6, label: 'news', onOpen: () => { opened += 1 } }} />))
    const badge = host.querySelector('.cos-news-badge') as HTMLElement
    expect(badge.textContent).toContain('۶') // in the reader's digits, as in the prototype
    act(() => badge.click())
    expect(opened).toBe(1)
  })

  it('is not there when nothing is waiting', () => {
    act(() => root.render(<CoreNav sections={[]} badge={{ count: 0, label: 'news', onOpen: () => {} }} />))
    expect(host.querySelector('.cos-news-badge')).toBeNull()
  })
})
