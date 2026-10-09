import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import EditProfile from './EditProfile'
import { ToastProvider } from '../components/ui'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  me: { id: 1, first_name: 'Sara', last_name: null, username: 'sara' },
  t: (key: string) => key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'en' } }),
}))
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  apiFetch: mocks.api,
}))
vi.mock('../lib/MeContext', () => ({
  useMe: () => ({ me: mocks.me, refreshMe: vi.fn() }),
}))
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

// The public profile, as anyone (the owner included) gets it: no year.
const publicProfile = {
  user_id: 1,
  display_name: 'Sara',
  username: 'sara',
  avatar_url: null,
  bio: 'hi',
  location: null,
  interests: [],
  is_trusted: false,
  birthday_month: 3,
  birthday_day: 14,
  gender: null,
}
// The owner's own profile still carries it.
const ownProfile = { id: 9, avatar_url: null, bio: 'hi', location: null, interests: [], is_trusted: false, birthday_month: 3, birthday_day: 14, birthday_year: 1995 }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.api.mockReset()
  mocks.api.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/profiles/1') return Promise.resolve(publicProfile)
    if (path === '/profile/me' && !init) return Promise.resolve(ownProfile)
    return Promise.resolve(undefined)
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('EditProfile and the birth year (section 43)', () => {
  it('keeps the year on save, though the public profile never carries it', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ToastProvider>
            <EditProfile />
          </ToastProvider>
        </MemoryRouter>,
      )
    })
    const save = container.querySelector<HTMLButtonElement>('[aria-label="profilePage.saveButton"]')!
    await act(async () => save.click())

    const put = mocks.api.mock.calls.find(([path, init]) => path === '/profile/me' && init?.method === 'PUT')
    expect(put).toBeDefined()
    const body = JSON.parse(put![1].body as string)
    expect(body.birthday_year).toBe(1995)
    expect(body).not.toHaveProperty('hide_birth_year')
  })
})
