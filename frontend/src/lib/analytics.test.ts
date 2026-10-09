import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** What the app counts about itself (section 43): queued, sent together,
 *  never on a clock. */
describe('counting', () => {
  let beacon: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true })
    sessionStorage.clear()
  })
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  async function sentBodies(): Promise<unknown[]> {
    const bodies = beacon.mock.calls.map(([, blob]) => (blob as Blob).text())
    return (await Promise.all(bodies)).map((text) => JSON.parse(text))
  }

  it('sends nothing until the page is left, then everything at once', async () => {
    const { track } = await import('./analytics')
    track('signin_step', undefined, 'ways')
    track('app_load', 1234.6)
    expect(beacon).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(beacon).toHaveBeenCalledTimes(1)
    expect(beacon.mock.calls[0][0]).toBe('/api/analytics/events')
    expect(await sentBodies()).toEqual([{ events: [{ name: 'signin_step', detail: 'ways' }, { name: 'app_load', value: 1235 }] }])
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('sends on its own once ten have gathered', async () => {
    const { track } = await import('./analytics')
    for (let i = 0; i < 10; i++) track('push_opened')
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('counts a tapped notification and takes the mark off the address', async () => {
    window.history.replaceState(null, '', '/conversations/10?from=push')
    const { startCounting, send } = await import('./analytics')
    startCounting()
    send()
    expect(window.location.pathname + window.location.search).toBe('/conversations/10')
    expect(JSON.stringify(await sentBodies())).toContain('push_opened')
  })

  it('measures the frame rate only once a visit', async () => {
    const { measureFrameRate } = await import('./analytics')
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    measureFrameRate(false)
    measureFrameRate(false)
    expect(frames).toHaveBeenCalledTimes(1)
    frames.mockRestore()
  })
})
