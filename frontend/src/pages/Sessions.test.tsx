import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), closeOne: vi.fn(), closeOthers: vi.fn(), navigate: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../lib/sessionsApi', () => ({ fetchSessions: mocks.fetch, closeSession: mocks.closeOne, closeOtherSessions: mocks.closeOthers }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

import Sessions from './Sessions'

const row = (id: number, current = false) => ({ id, provider: 'google', device: `Chrome · ${id}`, created_at: new Date().toISOString(), last_used_at: new Date().toISOString(), current })

/** Signed-in devices (section 32): this one first and marked, the others closable. */
describe('the signed-in devices page', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.fetch.mockReset().mockResolvedValue([row(1, true), row(2), row(3)])
    mocks.closeOne.mockReset().mockResolvedValue(undefined)
    mocks.closeOthers.mockReset().mockResolvedValue({ closed: 2 })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const open = async () => act(async () => root.render(<Sessions />))
  const button = (label: string) => [...host.querySelectorAll('button')].filter((b) => b.textContent === label)

  it('marks this device, and offers to close only the others', async () => {
    await open()
    expect(host.textContent).toContain('sessions.thisDevice')
    expect(button('sessions.close')).toHaveLength(2)
  })

  it('asks before closing one, then closes it', async () => {
    await open()
    await act(async () => button('sessions.close')[0].click())
    expect(mocks.closeOne).not.toHaveBeenCalled()
    // The dialog's own confirm button.
    await act(async () => button('sessions.close').at(-1)!.click())
    expect(mocks.closeOne).toHaveBeenCalledWith(2)
  })

  it('closes all the other devices at once', async () => {
    await open()
    await act(async () => button('sessions.closeOthers')[0].click())
    await act(async () => button('sessions.close').at(-1)!.click())
    expect(mocks.closeOthers).toHaveBeenCalled()
  })

  it('offers no "close all" when only one other device is in', async () => {
    mocks.fetch.mockResolvedValue([row(1, true), row(2)])
    await open()
    expect(button('sessions.closeOthers')).toHaveLength(0)
  })
})
