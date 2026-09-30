import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Echo from './Echo'
import type { EchoStatus } from '../lib/echoApi'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  t: (key: string, args?: Record<string, unknown>) =>
    args ? `${key} ${JSON.stringify(args)}` : key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'fa' } }),
}))
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  apiFetch: mocks.api,
}))
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

function status(overrides: Partial<EchoStatus> = {}): EchoStatus {
  return {
    open_now: true,
    minutes_until_open: null,
    missing: [],
    suspended: false,
    waiting: false,
    waiting_since: null,
    matched: null,
    last_search: null,
    remaining_today: null,
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Echo />
      </MemoryRouter>,
    )
  })
}

/** Every button whose visible text matches, since the whole screen is
 *  buttons and the test should not care about class names. */
function buttonsWith(text: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) =>
    (b.textContent ?? '').includes(text),
  ) as HTMLButtonElement[]
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

beforeEach(() => {
  mocks.api.mockReset()
  mocks.navigate.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('Echo, when the door is shut', () => {
  it('counts down instead of saying no', async () => {
    // A closed door is not an error and not an empty state. The countdown
    // is the whole reason somebody comes back at ten at night.
    mocks.api.mockResolvedValue(status({ open_now: false, minutes_until_open: 260 }))
    await render()

    expect(container.textContent).toContain('echo.opensIn')
    expect(container.textContent).toContain('4')
    expect(container.textContent).toContain('20')
  })

  it('offers no way to search', async () => {
    mocks.api.mockResolvedValue(status({ open_now: false, minutes_until_open: 30 }))
    await render()

    expect(buttonsWith('seek.go')).toHaveLength(0)
  })
})

describe('Echo, when the profile is missing something', () => {
  it('names only what is actually missing', async () => {
    mocks.api.mockResolvedValue(status({ missing: ['gender'] }))
    await render()

    expect(container.textContent).toContain('echo.missingGender')
    expect(container.textContent).not.toContain('echo.missingBirthday')
  })

  it('answers the question where it is asked', async () => {
    // Walking somebody to their profile for a single field is three
    // screens for one answer, and most people do not come back.
    mocks.api.mockResolvedValue(status({ missing: ['gender'] }))
    await render()

    await click(buttonsWith('echo.missingGender')[0])

    expect(container.textContent).toContain('echo.genderTitle')
    expect(buttonsWith('echo.gender.female')).toHaveLength(1)
  })

  it('keeps the rest of the profile when it saves one field', async () => {
    // The endpoint replaces the whole profile, so sending only the answer
    // given here would quietly erase somebody's bio and interests.
    mocks.api.mockResolvedValue(status({ missing: ['gender'] }))
    await render()
    await click(buttonsWith('echo.missingGender')[0])

    mocks.api.mockClear()
    mocks.api.mockImplementation((path: string) =>
      path === '/profile/me'
        ? Promise.resolve({ bio: 'hello', interests: ['music'], birthday_year: 1995 })
        : Promise.resolve(status()),
    )
    await click(buttonsWith('echo.gender.female')[0])

    const put = mocks.api.mock.calls.find((call) => call[1]?.method === 'PUT')
    expect(put).toBeDefined()
    const body = JSON.parse(put![1].body)
    expect(body.gender).toBe('female')
    expect(body.bio).toBe('hello')
    expect(body.interests).toEqual(['music'])
    expect(body.birthday_year).toBe(1995)
  })

  it('still offers the profile for somebody who would rather go there', async () => {
    mocks.api.mockResolvedValue(status({ missing: ['gender', 'birth_year'] }))
    await render()

    await click(buttonsWith('echo.gateGo')[0])

    expect(mocks.navigate).toHaveBeenCalledWith('/profile/edit')
  })
})

const match = (over: Record<string, unknown> = {}) => ({
  session_id: 42,
  conversation_id: 7,
  other_user_id: 3,
  display_name: 'Sara',
  username: null,
  avatar_url: null,
  shared_tags: ['music'],
  gender_as_asked: true,
  age_as_asked: true,
  follow_status: 'none' as const,
  tagline: 'Up at night.',
  started_at: new Date().toISOString(),
  ...over,
})

describe('Echo, when it is open', () => {
  // The approved prototype (section 32): one big button, interests optional.
  it('offers one big button and the interests, and asks nothing else', async () => {
    mocks.api.mockResolvedValue(status({ online_now: 12 }))
    await render()

    expect(buttonsWith('seek.go')).toHaveLength(1)
    expect(buttonsWith('echo.tag.music')).toHaveLength(1)
    expect(container.textContent).not.toContain('echo.whoLabel')
    expect(container.textContent).not.toContain('echo.ageLabel')
    expect(container.textContent).toContain('seek.online {"n":"۱۲"}')
  })

  it('names the button after the interests once some are chosen', async () => {
    mocks.api.mockResolvedValue(status())
    await render()
    await click(buttonsWith('echo.tag.music')[0])
    expect(buttonsWith('seek.goWith')).toHaveLength(1)
  })

  it('remembers the last interests but still shows them', async () => {
    mocks.api.mockResolvedValue(
      status({ last_search: { wants_gender: 'female', wants_age_min: 25, wants_age_max: 35, tags: ['music'] } }),
    )
    await render()
    expect(buttonsWith('echo.tag.music')[0].getAttribute('aria-pressed')).toBe('true')
  })

  it('stops at three interests and disables the rest', async () => {
    mocks.api.mockResolvedValue(status())
    await render()
    for (const tag of ['music', 'film', 'books']) {
      await click(buttonsWith(`echo.tag.${tag}`)[0])
    }
    expect(buttonsWith('echo.tag.games')[0].disabled).toBe(true)
    expect(buttonsWith('echo.tag.music')[0].disabled).toBe(false)
  })

  it('searches for anyone, at any age, with the chosen interests and the clock', async () => {
    mocks.api.mockResolvedValue(status())
    await render()
    await click(buttonsWith('echo.tag.film')[0])
    mocks.api.mockClear()
    mocks.api.mockResolvedValue(status({ waiting: true, waiting_since: '2026-01-01T00:00:00Z' }))

    await click(buttonsWith('seek.goWith')[0])

    const body = JSON.parse(mocks.api.mock.calls[0][1].body)
    expect(body.wants_gender).toBe('anyone')
    expect(body.wants_age_min).toBeNull()
    expect(body.wants_age_max).toBeNull()
    expect(body.tags).toEqual(['film'])
    expect(body.local_minute).toBeGreaterThanOrEqual(0)
    expect(body.local_minute).toBeLessThan(1440)
  })
})

describe('Echo, while waiting', () => {
  it('shows the real people waiting as lights, the numbers, and a way out', async () => {
    mocks.api.mockResolvedValue(
      status({ waiting: true, waiting_since: new Date().toISOString(), online_now: 9, waiting_now: 3 }),
    )
    await render()

    expect(container.textContent).toContain('seek.searching')
    expect(container.querySelectorAll('.cos-seek-orbit > i')).toHaveLength(3)
    expect(container.textContent).toContain('۹')
    expect(buttonsWith('echo.stop')).toHaveLength(1)
  })

  it('after a long wait with nobody, says so and offers to change the interests', async () => {
    const since = new Date(Date.now() - 60_000).toISOString()
    mocks.api.mockResolvedValue(status({ waiting: true, waiting_since: since }))
    await render()

    expect(container.textContent).toContain('seek.long')
    expect(buttonsWith('seek.change')).toHaveLength(1)
    await click(buttonsWith('seek.keepWaiting')[0])
    expect(container.textContent).not.toContain('seek.long')
  })

  it('asks the server again while it waits', async () => {
    vi.useFakeTimers()
    mocks.api.mockResolvedValue(status({ waiting: true, waiting_since: new Date().toISOString() }))
    await render()
    const afterFirstLoad = mocks.api.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600)
    })
    expect(mocks.api.mock.calls.length).toBeGreaterThan(afterFirstLoad)
  })
})

describe('Echo, when somebody arrives', () => {
  it('shows who arrived, and starts the conversation on a tap', async () => {
    mocks.api.mockResolvedValue(status({ matched: match() }))
    await render()

    expect(container.textContent).toContain('seek.found {"name":"Sara"}')
    expect(container.textContent).toContain('Up at night.')
    expect(mocks.navigate).not.toHaveBeenCalled()
    await click(buttonsWith('seek.start')[0])
    expect(mocks.navigate).toHaveBeenCalledWith('/conversations/7')
  })

  it('offers somebody new right away, which is a new search', async () => {
    mocks.api.mockResolvedValue(status({ matched: match() }))
    await render()
    mocks.api.mockClear()
    mocks.api.mockResolvedValue(status({ waiting: true, waiting_since: new Date().toISOString() }))
    await click(buttonsWith('seek.another')[0])
    expect(mocks.api.mock.calls[0][0]).toBe('/random-chat/search')
  })

  it('does not show somebody met long ago as if they had just arrived', async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    mocks.api.mockResolvedValue(status({ matched: match({ started_at: old }) }))
    await render()
    expect(container.textContent).not.toContain('seek.found')
    expect(buttonsWith('seek.go')).toHaveLength(1)
  })
})

describe('Echo, when the account is suspended', () => {
  it('says so and offers nothing else', async () => {
    mocks.api.mockResolvedValue(status({ suspended: true }))
    await render()

    expect(container.textContent).toContain('echo.suspended')
    expect(buttonsWith('seek.go')).toHaveLength(0)
  })
})
