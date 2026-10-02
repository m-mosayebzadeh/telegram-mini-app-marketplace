import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ friends: vi.fn(), requests: vi.fn(), accept: vi.fn(), end: vi.fn(), navigate: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../lib/friendsApi', () => ({
  fetchFriends: mocks.friends,
  fetchFriendRequests: mocks.requests,
  acceptFriend: mocks.accept,
  endFriend: mocks.end,
}))
vi.mock('../lib/live', () => ({ subscribe: () => () => {} }))
vi.mock('../lib/MeContext', () => ({ useMe: () => ({ refreshMe: vi.fn() }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

import Friends from './Friends'

const person = (user_id: number, display_name: string) => ({ user_id, display_name, avatar_url: null, note: null, mutual: false })

/** Your friends: plain first, a constellation on request (section 32). */
describe('the friends page', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    localStorage.clear()
    mocks.friends.mockReset().mockResolvedValue([person(5, 'Arash'), person(6, 'Lena')])
    mocks.requests.mockReset().mockResolvedValue([person(9, 'Soheil')])
    mocks.accept.mockReset().mockResolvedValue({ status: 'friends' })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const open = async () => act(async () => root.render(<Friends />))
  const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement

  it('is a plain list first: the requests, then your friends', async () => {
    await open()
    expect(host.querySelector('svg.cos-sky')).toBeNull()
    expect(host.textContent).toContain('Soheil')
    expect(host.textContent).toContain('Arash')
    await act(async () => button('friends.accept').click())
    expect(mocks.accept).toHaveBeenCalledWith(9)
  })

  it('shows your constellation on request, and remembers it', async () => {
    await open()
    await act(async () => button('friends.asSky').click())
    expect(host.querySelector('svg.cos-sky')).not.toBeNull()
    // The request is a star that says yes when tapped.
    const star = host.querySelector('.cos-star-asking') as SVGGElement
    await act(async () => star.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(mocks.accept).toHaveBeenCalledWith(9)
    expect(localStorage.getItem('cos-friends-view')).toBe('sky')
  })
})
