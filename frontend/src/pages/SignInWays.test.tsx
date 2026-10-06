import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  remove: vi.fn(),
  start: vi.fn(),
  wait: vi.fn(),
  claim: vi.fn(),
  navigate: vi.fn(),
  assign: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => (o?.defaultValue && key.includes('missing') ? o.defaultValue : key), i18n: { language: 'fa' } }),
}))
vi.mock('../lib/doorsApi', async (original) => ({
  ...(await original<typeof import('../lib/doorsApi')>()),
  fetchDoors: mocks.fetch,
  takeDoorAway: mocks.remove,
  startDoorTelegram: mocks.start,
  waitForDoorTelegram: mocks.wait,
  claimDoorTelegram: mocks.claim,
}))
vi.mock('../lib/qrPicture', () => ({ useQrPicture: () => '' }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  useToast: () => ({ success: mocks.success, error: mocks.error }),
}))

import SignInWays from './SignInWays'

const both = (confirmed: boolean) => ({
  doors: [
    { provider: 'google', label: 'm.m***h@gmail.com' },
    { provider: 'telegram', label: '@arash_t' },
  ],
  confirmed,
  google: true,
  telegram: true,
})

/** "Settings -> ways in" (section 36): never the last one, only after confirming. */
describe('the ways-in page', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.fetch.mockReset().mockResolvedValue(both(true))
    mocks.remove.mockReset().mockResolvedValue(undefined)
    mocks.start.mockReset().mockResolvedValue({ code: 'c', secret: 's', expires_at: '', link: 'https://t.me/bot?start=c' })
    mocks.wait.mockReset().mockResolvedValue({ status: 'approved', seen: true })
    mocks.claim.mockReset().mockResolvedValue({ done: 'linked' })
    mocks.assign.mockReset()
    mocks.success.mockReset()
    mocks.error.mockReset()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/settings/ways', search: '', assign: mocks.assign },
      writable: true,
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const open = async () => {
    await act(async () => root.render(<SignInWays />))
    await act(async () => {})
  }
  const buttons = (label: string) => [...document.querySelectorAll('button')].filter((b) => b.textContent === label)

  it('shows each way by its half-hidden name, marked as confirmed', async () => {
    await open()
    expect(host.textContent).toContain('m.m***h@gmail.com')
    expect(host.textContent).toContain('@arash_t')
    expect(host.textContent?.match(/ways\.verified/g)).toHaveLength(2)
  })

  it('will not take the last way away', async () => {
    mocks.fetch.mockResolvedValue({ ...both(true), doors: [{ provider: 'google', label: 'x' }] })
    await open()
    expect(buttons('ways.remove')[0].disabled).toBe(true)
    expect(host.textContent).toContain('ways.lastWay')
  })

  it('asks to confirm first when this session has not, through a way connected now', async () => {
    mocks.fetch.mockResolvedValue(both(false))
    await open()
    await act(async () => buttons('ways.remove')[0].click())
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('ways.confirmTitle')
    await act(async () => buttons('ways.confirmWith.google')[0].click())
    expect(mocks.assign).toHaveBeenCalledWith('/api/auth/google/start?purpose=confirm&lang=fa')
  })

  it('takes a way away after asking, when confirmed', async () => {
    await open()
    await act(async () => buttons('ways.remove')[1].click())
    await act(async () => buttons('ways.remove').at(-1)!.click())
    expect(mocks.remove).toHaveBeenCalledWith('telegram')
  })

  it('swaps Google by going to Google', async () => {
    await open()
    await act(async () => buttons('ways.swap')[0].click())
    expect(mocks.assign).toHaveBeenCalledWith('/api/auth/google/start?purpose=link&lang=fa')
  })

  it('connects Telegram through the bot, then says so', async () => {
    mocks.fetch.mockResolvedValue({ ...both(true), doors: [{ provider: 'google', label: 'x' }] })
    await open()
    await act(async () => buttons('ways.connect')[0].click())
    await act(async () => {})
    expect(mocks.start).toHaveBeenCalledWith('link')
    expect(mocks.claim).toHaveBeenCalled()
    expect(mocks.success).toHaveBeenCalledWith('ways.done.linked')
  })

  it('says why the bot refused on its own', async () => {
    mocks.fetch.mockResolvedValue({ ...both(true), doors: [{ provider: 'google', label: 'x' }] })
    mocks.wait.mockResolvedValue({ status: 'refused', seen: true, problem: 'taken' })
    await open()
    await act(async () => buttons('ways.connect')[0].click())
    await act(async () => {})
    expect(document.body.textContent).toContain('ways.problem.taken')
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('says how the trip to Google went, once', async () => {
    window.location.search = '?google=taken'
    const replace = vi.spyOn(window.history, 'replaceState')
    await open()
    expect(mocks.error).toHaveBeenCalledWith('ways.problem.taken')
    expect(replace).toHaveBeenCalled()
  })
})
