import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ see: vi.fn(), approve: vi.fn(), refuse: vi.fn(), navigate: vi.fn(), search: '' }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../lib/signInApi', async (original) => ({
  ...(await original<typeof import('../lib/signInApi')>()),
  seeDeviceRequest: mocks.see,
  approveDeviceRequest: mocks.approve,
  refuseDeviceRequest: mocks.refuse,
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(mocks.search)],
}))

import LinkDevice from './LinkDevice'

/** Approving another device (section 32): says which device, asks if it is you. */
describe('signing in another device from the phone', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.search = 'c=k7q29mxa'
    mocks.see.mockReset().mockResolvedValue({ code: 'K7Q29MXA', device: 'Chrome · Windows', created_at: new Date().toISOString(), status: 'pending' })
    mocks.approve.mockReset().mockResolvedValue(undefined)
    mocks.refuse.mockReset().mockResolvedValue(undefined)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const open = async () => {
    await act(async () => root.render(<LinkDevice />))
    await act(async () => {})
  }
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement

  it('says which device is asking before anything happens', async () => {
    await open()
    expect(mocks.see).toHaveBeenCalledWith('K7Q29MXA')
    expect(host.textContent).toContain('Chrome · Windows')
    expect(host.textContent).toContain('link.warning')
    expect(mocks.approve).not.toHaveBeenCalled()
  })

  it('approves when it is you', async () => {
    await open()
    await act(async () => button('link.yes').click())
    expect(mocks.approve).toHaveBeenCalledWith('K7Q29MXA')
    expect(host.textContent).toContain('link.approved')
  })

  it('refuses when it is not', async () => {
    await open()
    await act(async () => button('link.no').click())
    expect(mocks.refuse).toHaveBeenCalledWith('K7Q29MXA')
  })

  it('asks for the letters when opened from Settings', async () => {
    mocks.search = ''
    await open()
    const input = host.querySelector('#link-code') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'k7q2 9mxa')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => (host.querySelector('form') as HTMLFormElement).requestSubmit())
    await act(async () => {})
    expect(mocks.see).toHaveBeenCalledWith('K7Q29MXA')
  })
})
