import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ state: vi.fn(), on: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../lib/push', () => ({ pushState: mocks.state, turnPushOn: mocks.on }))

import { offerPush } from '../../lib/pushOffer'
import { PushOffer } from './PushOffer'

/** "Want to know when they answer?" at the moment it explains itself (section 38). */
describe('the notifications offer', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    localStorage.clear()
    mocks.state.mockReset().mockResolvedValue('off')
    mocks.on.mockReset().mockResolvedValue('on')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label)

  it('is quiet until a moment calls for it', async () => {
    await act(async () => root.render(<PushOffer />))
    expect(host.innerHTML).toBe('')
    await act(async () => offerPush('message'))
    expect(host.textContent).toContain('push.offerMessage')
  })

  it('asks the browser only after "yes"', async () => {
    await act(async () => root.render(<PushOffer />))
    await act(async () => offerPush('friend'))
    expect(host.textContent).toContain('push.offerFriend')
    expect(mocks.on).not.toHaveBeenCalled()
    await act(async () => button('push.yes')!.click())
    expect(mocks.on).toHaveBeenCalled()
    expect(host.innerHTML).toBe('')
  })

  it('"not now" waits a week', async () => {
    await act(async () => root.render(<PushOffer />))
    await act(async () => offerPush('message'))
    await act(async () => button('push.later')!.click())
    await act(async () => offerPush('message'))
    expect(host.innerHTML).toBe('')
  })

  it('is not offered where it cannot be turned on, or is on already', async () => {
    await act(async () => root.render(<PushOffer />))
    for (const state of ['unsupported', 'blocked', 'install_first', 'on']) {
      mocks.state.mockResolvedValue(state)
      await act(async () => offerPush('message'))
      expect(host.innerHTML).toBe('')
    }
  })
})
