import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Sky, { regionOf } from './Sky'
import type { World } from '../lib/worldApi'
import type { NewsItem } from '../lib/news'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../lib/skyApi', () => ({ fetchSky: vi.fn(async () => []) }))

const world = vi.hoisted(() => ({ current: null as unknown as World }))
vi.mock('../lib/worldApi', async (original) => ({
  ...(await original<typeof import('../lib/worldApi')>()),
  useWorld: () => world.current,
}))

/**
 * The world and its regions on one screen (TECHNICAL_REQUIREMENTS.md
 * sections 30.5–30.8 and 30.12): each region has an address so the back
 * button leaves it, and a tap on Sol is always one step closer to where
 * you want to be.
 */
describe('regions of the world', () => {
  let host: HTMLDivElement
  let root: Root
  let path = ''

  function Where() {
    path = useLocation().pathname
    return null
  }

  beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    Element.prototype.setPointerCapture = () => {}
    world.current = {
      loaded: true, error: null, relations: [], news: [], sessions: [], liveSession: null,
      reload: async () => {}, dismiss: () => {},
    }
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  async function open(at: string) {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="/sky/:region?" element={<><Sky /><Where /></>} />
          </Routes>
        </MemoryRouter>,
      ),
    )
  }

  function tapSol() {
    const sol = host.querySelector('.cos-core') as HTMLElement
    for (const type of ['pointerdown', 'pointerup']) {
      act(() => {
        const e = new Event(type, { bubbles: true, cancelable: true })
        Object.assign(e, { pointerId: 1, clientX: 0, clientY: 0 })
        sol.dispatchEvent(e)
      })
    }
  }

  it('reads only the regions it knows from the address', () => {
    expect(regionOf('talk')).toBe('talk')
    expect(regionOf('news')).toBe('news')
    expect(regionOf(undefined)).toBe('world')
    expect(regionOf('nonsense')).toBe('world')
  })

  it('opens a region straight from its address', async () => {
    await open('/sky/talk')
    expect(host.querySelector('.cos-stair')).not.toBeNull()
    expect(host.querySelector('.cos-screen')?.classList.contains('is-region-talk')).toBe(true)
  })

  it('brings you back to the world when Sol is tapped in a region, as a journey', async () => {
    await open('/sky/news')
    expect(host.querySelector('.cos-feed')).not.toBeNull()
    // In the news, the world is another place, not a backdrop.
    expect(host.querySelector('.cos-world')?.classList.contains('is-away')).toBe(true)
    tapSol()
    expect(path).toBe('/sky')
    // First the news rushes past and the stars streak…
    expect(host.querySelector('.cos-region-layer')?.classList.contains('is-leaving')).toBe(true)
    expect(host.querySelector('.cos-screen')?.classList.contains('is-warping')).toBe(true)
    // …then the world settles in.
    act(() => { vi.advanceTimersByTime(400) })
    expect(host.querySelector('.cos-feed')).toBeNull()
    act(() => { vi.advanceTimersByTime(100) })
    expect(host.querySelector('.cos-world')?.className).toBe('cos-world')
  })

  it('lets the people on the stair fly home before it goes', async () => {
    await open('/sky/talk')
    tapSol()
    expect(host.querySelector('.cos-stair')?.classList.contains('is-leaving')).toBe(true)
    // The prototype's timing: 950 ms, and 45 more for each person.
    act(() => { vi.advanceTimersByTime(900) })
    expect(host.querySelector('.cos-stair')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(100) })
    expect(host.querySelector('.cos-stair')).toBeNull()
  })

  it('opens the menu when Sol is tapped at home', async () => {
    await open('/sky')
    tapSol()
    expect(host.querySelector('.cos-core-area')?.classList.contains('is-tapmode')).toBe(true)
  })

  it('shows waiting news beside Sol, and takes you to it', async () => {
    const item: NewsItem = { key: 'm', kind: 'message', userId: 2, name: 'Sara', avatarUrl: null, at: new Date().toISOString(), conversationId: 3 }
    world.current = { ...world.current, news: [item] }
    await open('/sky')
    const badge = host.querySelector('.cos-news-badge') as HTMLElement
    expect(badge.textContent).toContain('1')
    act(() => badge.click())
    expect(path).toBe('/sky/news')
  })
})
