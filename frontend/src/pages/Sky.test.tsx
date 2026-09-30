import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Sky, { regionOf } from './Sky'
import type { World } from '../lib/worldApi'

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
      loaded: true, error: null, hasMore: false, loadMore: async () => {}, relations: [], news: [], sessions: [], liveSession: null,
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
            <Route path="/sky/:region?" element={<><Sky /><Where /><Nav /></>} />
          </Routes>
        </MemoryRouter>,
      ),
    )
  }

  /** Travel as the bar does: by address. */
  let go: (to: string) => void = () => {}
  function Nav() {
    const navigate = useNavigate()
    go = (to) => navigate(to)
    return null
  }

  it('reads only the regions it knows from the address', () => {
    expect(regionOf('talk')).toBe('talk')
    expect(regionOf('news')).toBe('news')
    expect(regionOf(undefined)).toBe('world')
    expect(regionOf('nonsense')).toBe('world')
  })

  it('opens the conversations straight from their address, as a list', async () => {
    await open('/sky/talk')
    expect(host.querySelector('.cos-talklist')).not.toBeNull()
    expect(host.querySelector('.cos-stair')).toBeNull()
    expect(host.querySelector('.cos-screen')?.classList.contains('is-region-talk')).toBe(true)
  })

  it('goes back to the world as a journey', async () => {
    await open('/sky/news')
    expect(host.querySelector('.cos-news-stream')).not.toBeNull()
    // In the news, the world is another place, not a backdrop.
    expect(host.querySelector('.cos-world')?.classList.contains('is-away')).toBe(true)
    act(() => go('/sky'))
    expect(path).toBe('/sky')
    // First the news rushes past and the stars streak…
    expect(host.querySelector('.cos-region-layer')?.classList.contains('is-leaving')).toBe(true)
    expect(host.querySelector('.cos-screen')?.classList.contains('is-warping')).toBe(true)
    // …then the world settles in.
    act(() => { vi.advanceTimersByTime(400) })
    expect(host.querySelector('.cos-news-stream')).toBeNull()
    act(() => { vi.advanceTimersByTime(100) })
    expect(host.querySelector('.cos-world')?.className).toBe('cos-world')
  })

  it('leaves the conversations for the world as a journey, like any place', async () => {
    await open('/sky/talk')
    act(() => go('/sky'))
    expect(host.querySelector('.cos-region-layer')?.classList.contains('is-leaving')).toBe(true)
    act(() => { vi.advanceTimersByTime(400) })
    expect(host.querySelector('.cos-talklist')).toBeNull()
  })

  // Behind "the news region shows nothing": the frame that ends an arrival
  // was cancelled by the journey's own clean-up, so a place reached by a
  // journey stayed small and invisible for good. This keeps the arrival's
  // ending itself from going missing.
  it('lets a place reached by a journey finish arriving', async () => {
    await open('/sky/talk')
    act(() => go('/sky/news'))
    act(() => { vi.advanceTimersByTime(400) })
    expect(host.querySelector('.cos-news-stream')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(100) })
    const layer = host.querySelector('.cos-region-layer') as HTMLElement
    expect(layer.classList.contains('is-arriving')).toBe(false)
    expect(layer.classList.contains('is-leaving')).toBe(false)
  })

  // Section 32: the hold-and-sweep menu on Sol is gone; the bar's five doors
  // are the way around, and Sol there always means the world.
  it('has no menu of its own any more', async () => {
    await open('/sky')
    expect(host.querySelector('.cos-core')).toBeNull()
    expect(host.querySelector('.cos-news-badge')).toBeNull()
  })

  it('tells a newcomer the one thing to do, in the world', async () => {
    localStorage.removeItem('cos-world-hint-seen')
    await open('/sky')
    expect(host.querySelector('.cos-sol-hint')?.textContent).toBe('sky.worldHint')
  })

  it('takes Sol, tapped in the world, as "home" without falling over', async () => {
    await open('/sky')
    act(() => { window.dispatchEvent(new Event('cos:home')) })
    expect(path).toBe('/sky')
  })
})
