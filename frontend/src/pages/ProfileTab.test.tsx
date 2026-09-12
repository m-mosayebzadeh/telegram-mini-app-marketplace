import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import ProfileTab from './ProfileTab'
import { ToastProvider } from '../components/ui'
import type { PublicProfile } from '../lib/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  me: { id: 1, pending_follow_requests_count: 0, avatar_url: null },
  t: (key: string, args?: Record<string, unknown>) =>
    args ? `${key} ${JSON.stringify(args)}` : key,
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
// The content grid runs its own fetches and is not what these tests are
// about; the profile only has to place it.
vi.mock('../components/ContentGrid', () => ({
  ContentGrid: () => <div data-testid="content-grid" />,
}))
vi.mock('../components/ContentUploadForm', () => ({
  ContentUploadForm: () => <div />,
}))
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

function profile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    user_id: 1,
    display_name: 'Alice',
    username: null,
    avatar_url: null,
    bio: null,
    location: null,
    interests: [],
    is_trusted: false,
    birthday_month: null,
    birthday_day: null,
    birthday_year: null,
    followers_count: 3,
    following_count: 7,
    follow_status: 'not_following',
    ...overrides,
  }
}

let root: Root
let container: HTMLDivElement

/** `path` decides which of the two shapes renders: `/profile` is the tab
 *  root, `/profiles/2` is a visited profile. */
async function render(path: string) {
  await act(async () => {
    root.render(
      // ToastProvider is part of the app shell (see main.tsx); the page
      // reads it for its own success and failure messages.
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/profile" element={<ProfileTab />} />
            <Route path="/profiles/:id" element={<ProfileTab />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )
  })
}

function byLabel(label: string) {
  return container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.api.mockReset()
  mocks.navigate.mockReset()
  mocks.me = { id: 1, pending_follow_requests_count: 0, avatar_url: null }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('ProfileTab', () => {
  it('is a tab root on your own profile: no back arrow, a settings action', async () => {
    mocks.api.mockResolvedValue(profile())

    await render('/profile')

    expect(container.querySelector('.ui-header-back')).toBeNull()
    expect(container.querySelector('.ui-header-root')).toBeTruthy()
    byLabel('settings.title')!.click()
    expect(mocks.navigate).toHaveBeenCalledWith('/settings')
  })

  it("is an inner page on someone else's: a back arrow and their name", async () => {
    mocks.api.mockResolvedValue(profile({ user_id: 2, display_name: 'Bob' }))

    await render('/profiles/2')

    expect(container.querySelector('.ui-header-back')).toBeTruthy()
    expect(container.querySelector('.ui-header-title')?.textContent).toBe('Bob')
  })

  it('offers exactly one primary action on a visited profile', async () => {
    mocks.api.mockResolvedValue(profile({ user_id: 2 }))

    await render('/profiles/2')

    const primaries = container.querySelectorAll('.ui-btn-primary')
    expect(primaries).toHaveLength(1)
    expect(primaries[0].textContent).toBe('profilePage.follow')
  })

  it('shows no follow button on your own profile', async () => {
    mocks.api.mockResolvedValue(profile())

    await render('/profile')

    expect(container.querySelector('.pf-actions')).toBeNull()
  })

  it('only offers the upload button on your own profile', async () => {
    mocks.api.mockResolvedValue(profile({ user_id: 2 }))
    await render('/profiles/2')
    expect(container.querySelector('.pf-fab')).toBeNull()

    await act(async () => root.unmount())
    root = createRoot(container)
    mocks.api.mockResolvedValue(profile())
    await render('/profile')
    expect(container.querySelector('.pf-fab')).toBeTruthy()
  })

  it('retries the profile when the fetch fails', async () => {
    mocks.api.mockRejectedValue(new Error('offline'))
    await render('/profile')

    const retry = container.querySelector<HTMLButtonElement>('.ui-state-action button')
    expect(retry?.textContent).toBe('common.retry')

    mocks.api.mockResolvedValue(profile())
    await act(async () => retry!.click())

    expect(container.querySelector('.pf-name')?.textContent).toBe('Alice')
  })

  it('keeps the trust badge off a profile that does not have one', async () => {
    mocks.api.mockResolvedValue(profile({ is_trusted: false }))
    await render('/profile')
    expect(container.querySelector('.pf-trusted')).toBeNull()

    await act(async () => root.unmount())
    root = createRoot(container)
    mocks.api.mockResolvedValue(profile({ is_trusted: true }))
    await render('/profile')
    expect(container.querySelector('.pf-trusted')).toBeTruthy()
  })
})
