import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  navigate: vi.fn(),
  params: {} as { id?: string },
  friends: vi.fn(),
  requests: vi.fn(),
  theirs: vi.fn(),
  ask: vi.fn(),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../lib/api', () => ({ apiFetch: mocks.apiFetch, formatApiError: String }))
vi.mock('../lib/MeContext', () => ({ useMe: () => ({ me: { id: 1 }, refreshMe: vi.fn() }) }))
vi.mock('../lib/live', () => ({ subscribe: () => () => {} }))
vi.mock('../lib/friendsApi', () => ({
  fetchFriends: mocks.friends,
  fetchFriendRequests: mocks.requests,
  fetchTheirFriends: mocks.theirs,
  askFriend: mocks.ask,
  acceptFriend: vi.fn(),
  endFriend: vi.fn(),
}))
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
  useLocation: () => ({ state: null }),
}))
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

import ProfileTab from './ProfileTab'

const person = (user_id: number, display_name: string, mutual = false) => ({ user_id, display_name, avatar_url: null, note: null, mutual })
const profile = (over: Record<string, unknown> = {}) => ({
  user_id: 1, display_name: 'Maryam', username: 'maryam', avatar_url: null, note: null, friend_status: 'none', ...over,
})

/** "Me", and somebody else's page (section 32, step 4). */
describe('the me page', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.params = {}
    mocks.apiFetch.mockReset().mockResolvedValue(profile())
    mocks.friends.mockReset().mockResolvedValue([person(5, 'Arash'), person(6, 'Lena')])
    mocks.requests.mockReset().mockResolvedValue([])
    mocks.theirs.mockReset().mockResolvedValue({ visible: true, people: [] })
    mocks.ask.mockReset().mockResolvedValue({ status: 'requested' })
    mocks.navigate.mockReset()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const open = async () => act(async () => root.render(<ProfileTab />))
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label) || b.getAttribute('aria-label') === label) as HTMLButtonElement | undefined

  it('on your own: an invitation to write today\'s note, your friends as faces, and settings', async () => {
    await open()
    expect(host.querySelector('.cos-me-note.is-empty')?.textContent).toBe('note.add')
    expect(host.querySelectorAll('.cos-me-stack > span')).toHaveLength(2)
    expect(host.textContent).not.toContain('followers')
    await act(async () => button('friends.title')!.click())
    expect(mocks.navigate).toHaveBeenCalledWith('/friends')
  })

  it('shows a badge for friend requests waiting', async () => {
    mocks.requests.mockResolvedValue([person(9, 'Soheil')])
    await open()
    expect(host.querySelector('.cos-me-badge')?.textContent).toBe('1')
    expect(host.textContent).toContain('friends.newRequest')
  })

  it('on somebody else\'s: say hello, and ask to be friends', async () => {
    mocks.params = { id: '2' }
    mocks.apiFetch.mockResolvedValue(profile({ user_id: 2, display_name: 'Niloofar', note: 'A good book?' }))
    await open()
    expect(host.querySelector('.cos-me-note')?.textContent).toBe('A good book?')
    await act(async () => button('friends.ask')!.click())
    expect(mocks.ask).toHaveBeenCalledWith(2)
    await act(async () => button('friends.hello')!.click())
    expect(mocks.navigate).toHaveBeenCalledWith('/conversations/with/2')
  })

  it('draws where your skies meet, with the shared friends first and marked', async () => {
    mocks.params = { id: '2' }
    mocks.apiFetch.mockResolvedValue(profile({ user_id: 2, display_name: 'Niloofar' }))
    mocks.theirs.mockResolvedValue({ visible: true, people: [person(5, 'Arash', true), person(7, 'Tara')] })
    await open()
    expect(host.querySelector('svg.cos-sky')).not.toBeNull()
    const rows = [...host.querySelectorAll('.cos-me-list .cos-me-person')]
    expect(rows[0].textContent).toContain('Arash')
    expect(rows[0].textContent).toContain('friends.both')
    expect(rows[1].textContent).not.toContain('friends.both')
  })

  it('says only that the list is closed when it is', async () => {
    mocks.params = { id: '2' }
    mocks.apiFetch.mockResolvedValue(profile({ user_id: 2, display_name: 'Niloofar' }))
    mocks.theirs.mockResolvedValue({ visible: false, people: [] })
    await open()
    expect(host.textContent).toContain('friends.closed')
    expect(host.querySelector('svg.cos-sky')).toBeNull()
  })
})
