import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ways: vi.fn(),
  start: vi.fn(),
  wait: vi.fn(),
  claim: vi.fn(),
  google: vi.fn(),
  render: vi.fn(),
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
  signInWithGoogle: mocks.google,
}))
vi.mock('../lib/googleButton', () => ({ renderGoogleButton: mocks.render }))
vi.mock('qrcode', () => ({ default: { toString: vi.fn(async () => '<svg data-qr="1"></svg>') } }))

import SignIn from './SignIn'

/** The sign-in page (section 32): the ways in, each ending in a session. */
describe('the sign-in page', () => {
  let host: HTMLDivElement
  let root: Root
  const reload = vi.fn()
  beforeEach(() => {
    mocks.ways.mockReset().mockResolvedValue({ google_client_id: 'id.apps.googleusercontent.com', dev: false })
    mocks.start.mockReset().mockResolvedValue({ code: 'K7Q29MXA', secret: 's', expires_at: new Date().toISOString() })
    mocks.wait.mockReset().mockResolvedValue({ status: 'approved' })
    mocks.claim.mockReset().mockResolvedValue(undefined)
    mocks.render.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(window, 'location', { value: { ...window.location, reload, origin: 'http://localhost:5174' }, writable: true })
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

  it('offers Google when it is set up, and another phone', async () => {
    await open()
    expect(mocks.render).toHaveBeenCalledWith(expect.any(HTMLElement), 'id.apps.googleusercontent.com', 'fa', expect.any(Function))
    expect(button('signIn.withPhone')).toBeDefined()
    expect(button('signIn.test')).toBeUndefined() // development only
  })

  it('leaves Google out when it is not set up', async () => {
    mocks.ways.mockResolvedValue({ google_client_id: null, dev: true })
    await open()
    expect(mocks.render).not.toHaveBeenCalled()
    expect(button('signIn.test')).toBeDefined()
  })

  it('signs in with the token Google hands back, then starts clean', async () => {
    mocks.google.mockResolvedValue({ new: true })
    await open()
    const onCredential = mocks.render.mock.calls[0][3] as (c: string) => Promise<void>
    await act(async () => onCredential('google-token'))
    expect(mocks.google).toHaveBeenCalledWith('google-token')
    expect(reload).toHaveBeenCalled()
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

  it('marks our Google button ready only once Google has drawn its own over it', async () => {
    let drawn: () => void = () => {}
    mocks.render.mockReturnValue(new Promise<void>((resolve) => (drawn = resolve)))
    await open()
    const google = host.querySelector('.cos-signin-google') as HTMLElement
    expect(google.dataset.ready).toBeUndefined()
    await act(async () => drawn())
    expect(google.dataset.ready).toBe('true')
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
})
