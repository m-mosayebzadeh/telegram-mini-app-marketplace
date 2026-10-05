import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ways: vi.fn(),
  start: vi.fn(),
  wait: vi.fn(),
  claim: vi.fn(),
  tgStart: vi.fn(),
  tgWait: vi.fn(),
  tgClaim: vi.fn(),
  changeLanguage: vi.fn(),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fa', dir: () => 'rtl', changeLanguage: mocks.changeLanguage } }),
}))
vi.mock('../lib/signInApi', async (original) => ({
  ...(await original<typeof import('../lib/signInApi')>()),
  fetchWays: mocks.ways,
  startDeviceRequest: mocks.start,
  waitForApproval: mocks.wait,
  claimDeviceSession: mocks.claim,
  startBotSignIn: mocks.tgStart,
  waitForTelegram: mocks.tgWait,
  claimBotSession: mocks.tgClaim,
}))
vi.mock('qrcode', () => ({ default: { toString: vi.fn(async () => '<svg data-qr="1"></svg>') } }))

import SignIn from './SignIn'

/** The sign-in page (section 32): the ways in, each ending in a session. */
describe('the sign-in page', () => {
  let host: HTMLDivElement
  let root: Root
  const reload = vi.fn()
  beforeEach(() => {
    mocks.ways.mockReset().mockResolvedValue({ google: true, telegram: true, dev: false })
    mocks.start.mockReset().mockResolvedValue({ code: 'K7Q29MXA', secret: 's', expires_at: new Date().toISOString() })
    mocks.wait.mockReset().mockResolvedValue({ status: 'approved', seen: true })
    mocks.claim.mockReset().mockResolvedValue(undefined)
    mocks.tgStart.mockReset().mockResolvedValue({
      code: 'abc_DEF-123', secret: 's', expires_at: new Date().toISOString(), link: 'https://t.me/cosmos_bot?start=abc_DEF-123',
    })
    mocks.tgWait.mockReset().mockResolvedValue({ status: 'pending', seen: false })
    mocks.tgClaim.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload, origin: 'http://localhost:5174', search: '', pathname: '/' },
      writable: true,
    })
    reload.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const open = async () => {
    await act(async () => root.render(<SignIn />))
    await act(async () => {})
  }
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label))

  const googleLink = () => host.querySelector('a.cos-signin-way-google') as HTMLAnchorElement | null

  it('offers Google when it is set up, and another phone', async () => {
    await open()
    // A plain link, in the page's language: off to Google and back.
    expect(googleLink()!.getAttribute('href')).toBe('/api/auth/google/start?lang=fa')
    expect(googleLink()!.textContent).toContain('signIn.google')
    expect(button('signIn.withPhone')).toBeDefined()
    expect(button('signIn.test')).toBeUndefined() // development only
  })

  it('leaves Google out when it is not set up', async () => {
    mocks.ways.mockResolvedValue({ google: false, telegram: false, dev: true })
    await open()
    expect(googleLink()).toBeNull()
    expect(button('signIn.test')).toBeDefined()
  })

  it('takes one tap on Google, not two', async () => {
    await open()
    const first = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => googleLink()!.dispatchEvent(first))
    expect(googleLink()!.getAttribute('aria-disabled')).toBe('true')
    const second = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => googleLink()!.dispatchEvent(second))
    expect(second.defaultPrevented).toBe(true)
  })

  it('says so when coming back from Google without signing in, and wipes it from the address', async () => {
    const replace = vi.spyOn(window.history, 'replaceState')
    window.location.search = '?signin=google_failed'
    await open()
    expect(host.textContent).toContain('signIn.googleFailed')
    expect(replace).toHaveBeenCalledWith(null, '', '/')
    replace.mockRestore()
  })

  it('says nothing when the person simply closed Google', async () => {
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    window.location.search = '?signin=google_cancelled'
    await open()
    expect(host.querySelector('.cos-signin-error')).toBeNull()
    replace.mockRestore()
  })

  it('shows a code for another phone, and comes in once it is approved', async () => {
    await open()
    await act(async () => button('signIn.withPhone')!.click())
    await act(async () => {})
    await act(async () => {})
    expect(mocks.start).toHaveBeenCalled()
    expect(mocks.claim).toHaveBeenCalled()
    expect(reload).toHaveBeenCalled()
  })

  it('gives a step the whole page, with the way back at the top', async () => {
    await open()
    await act(async () => button('signIn.withPhone')!.click())
    // The greeting and the other ways are gone; the step starts from the top.
    expect(host.textContent).not.toContain('signIn.title')
    expect(host.querySelector('.cos-signin-top .cos-signin-back')).not.toBeNull()
    await act(async () => (host.querySelector('.cos-signin-back') as HTMLButtonElement).click())
    expect(host.textContent).toContain('signIn.title')
  })

  it('says so when the phone refused', async () => {
    mocks.wait.mockResolvedValue({ status: 'refused' })
    await open()
    await act(async () => button('signIn.withPhone')!.click())
    await act(async () => {})
    await act(async () => {})
    expect(host.textContent).toContain('K7Q2 9MXA')
    expect(button('signIn.device.refused')).toBeDefined()
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('says when the phone has opened the code, and waits for its answer', async () => {
    let answer: (a: { status: string; seen: boolean }) => void = () => {}
    mocks.wait
      .mockResolvedValueOnce({ status: 'pending', seen: true })
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    await open()
    await act(async () => button('signIn.withPhone')!.click())
    await act(async () => {})
    await act(async () => {})
    expect(host.textContent).toContain('signIn.device.seen')
    // Told once: from here on the device says it already knows.
    expect(mocks.wait).toHaveBeenLastCalledWith(expect.anything(), true)
    await act(async () => answer({ status: 'approved', seen: true }))
    await act(async () => {})
    expect(mocks.claim).toHaveBeenCalled()
  })

  it('renews a code that ran out once, then goes back to the ways in, instead of renewing it for ever', async () => {
    mocks.wait.mockResolvedValue({ status: 'expired', seen: false })
    await open()
    await act(async () => button('signIn.withPhone')!.click())
    await act(async () => {})
    await act(async () => {})
    await act(async () => {})
    await act(async () => {})
    await act(async () => {})
    // Two codes, two minutes each: four minutes, then back.
    expect(mocks.start).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('signIn.title')
    expect(host.textContent).toContain('signIn.device.expired')
  })

  it('says "too many tries" and goes back when this place has made too many codes', async () => {
    const { ApiError } = await import('../lib/api')
    mocks.start.mockRejectedValue(new ApiError(429, { detail: { reason: 'too_many_tries' } }))
    await open()
    await act(async () => button('signIn.withPhone')!.click())
    await act(async () => {})
    expect(host.textContent).toContain('signIn.tooMany')
    expect(host.textContent).toContain('signIn.title')
  })

  it('leaves Telegram out when the bot is not set up', async () => {
    mocks.ways.mockResolvedValue({ google: true, telegram: false, dev: false })
    await open()
    expect(button('signIn.telegram')).toBeUndefined()
  })

  it('opens our bot, says when Start was tapped, and comes in on "yes"', async () => {
    let answer: (a: { status: string; seen: boolean }) => void = () => {}
    mocks.tgWait
      .mockResolvedValueOnce({ status: 'pending', seen: true })
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    await open()
    await act(async () => button('signIn.telegram')!.click())
    await act(async () => {})
    await act(async () => {})
    const link = host.querySelector('a.cos-signin-open') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://t.me/cosmos_bot?start=abc_DEF-123')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(host.textContent).toContain('signIn.tg.seen')
    await act(async () => answer({ status: 'approved', seen: true }))
    await act(async () => {})
    expect(mocks.tgClaim).toHaveBeenCalled()
    expect(reload).toHaveBeenCalled()
  })

  it('goes back to the first page when the Telegram link runs out, without renewing it', async () => {
    mocks.tgWait.mockResolvedValue({ status: 'expired', seen: false })
    await open()
    await act(async () => button('signIn.telegram')!.click())
    await act(async () => {})
    await act(async () => {})
    expect(mocks.tgStart).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('signIn.tg.expired')
  })

  it('keeps waiting when a wait is lost while Telegram was in front', async () => {
    vi.useFakeTimers()
    mocks.tgWait.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ status: 'approved', seen: true })
    await open()
    await act(async () => button('signIn.telegram')!.click())
    await act(async () => {})
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    await act(async () => {})
    expect(mocks.tgWait).toHaveBeenCalledTimes(2)
    expect(mocks.tgClaim).toHaveBeenCalled()
    vi.useRealTimers()
  })
})
