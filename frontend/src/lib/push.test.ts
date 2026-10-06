import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('./api', () => ({ apiFetch: mocks.apiFetch }))

import { pushState } from './push'

/** Each case told apart, so the screens say the right thing (section 38). */
describe('whether notifications can be turned on here', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a browser without push cannot', async () => {
    expect(await pushState()).toBe('unsupported')
  })

  it('an iPhone in Safari needs the app on the home screen first', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)' })
    expect(await pushState()).toBe('install_first')
  })
})
