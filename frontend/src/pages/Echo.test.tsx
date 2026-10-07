import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Echo from './Echo'
import type { EchoStatus } from '../lib/echoApi'
import { resetEchoStore } from '../lib/echoStore'

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
  // The status is shared across screens; each test starts from nothing.
  resetEchoStore()
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

describe('Echo, the first time', () => {
  it('asks "eighteen or over" and nothing else', async () => {
    mocks.api.mockResolvedValue(status({ missing: ['adult'] }))
    await render()
    expect(container.textContent).toContain('adult.title')
    expect(container.textContent).not.toContain('echo.missingGender')
  })

  it('goes back to the world on "no", to be asked again next time', async () => {
    mocks.api.mockResolvedValue(status({ missing: ['adult'] }))
    await render()
    await click(buttonsWith('adult.no')[0])
    expect(mocks.navigate).toHaveBeenCalledWith('/sky')
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
  friend_status: 'none' as const,
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
    // No line under the button: it fell behind Sol and the bar, and the owner
    // removed it.
    expect(container.textContent).not.toContain('seek.online')
  })

  /** Opens an interest's group (the interests live in groups now) and
   *  returns its button. */
  async function inGroup(tag: string, group: string) {
    const back = buttonsWith('seek.allGroups')[0]
    if (back) await click(back)
    await click(buttonsWith(`echo.group.${group}`)[0])
    return buttonsWith(`echo.tag.${tag}`)[0]
  }

  it('names the button after the interests once some are chosen', async () => {
    mocks.api.mockResolvedValue(status())
    await render()
    await click(await inGroup('music', 'fun'))
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
    await click(await inGroup('music', 'fun'))
    await click(buttonsWith('echo.tag.film')[0])
    await click(await inGroup('books', 'learning'))
    expect((await inGroup('games', 'fun')).disabled).toBe(true)
    // What you chose stays above, and can still be taken off.
    expect(buttonsWith('echo.tag.music')[0].disabled).toBe(false)
  })

  it('searches for anyone, at any age, with the chosen interests and the clock', async () => {
    mocks.api.mockResolvedValue(status())
    await render()
    await click(await inGroup('film', 'fun'))
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
    // Three searching with you: two lights, you are the middle.
    expect(container.querySelectorAll('.cos-seek-orbit > i')).toHaveLength(2)
    expect(container.textContent).toContain('۹')
    expect(container.textContent).toContain('seek.factWaiting')
    expect(buttonsWith('echo.stop')).toHaveLength(1)
  })

  it('shows no numbers when the panel switched them off, only the time', async () => {
    mocks.api.mockResolvedValue(
      status({ waiting: true, waiting_since: new Date().toISOString(), online_now: 9, waiting_now: 3, show_counts: false }),
    )
    await render()

    expect(container.textContent).not.toContain('seek.factOnline')
    expect(container.textContent).not.toContain('seek.factWaiting')
    expect(container.textContent).toContain('seek.factTime')
    expect(container.querySelectorAll('.cos-seek-orbit > i')).toHaveLength(2)
  })

  it('after a long wait with nobody, says so and offers to change the interests', async () => {
    const since = new Date(Date.now() - 60_000).toISOString()
    mocks.api.mockResolvedValue(status({ waiting: true, waiting_since: since }))
    await render()

    expect(container.textContent).toContain('seek.long')
    expect(buttonsWith('seek.change')).toHaveLength(1)
    // No "I will wait": the search goes on regardless, so it did nothing.
    expect(buttonsWith('seek.keepWaiting')).toHaveLength(0)
  })

  it('does not keep asking the server while it waits', async () => {
    // Section 32: the server's heartbeat sends the numbers when they change,
    // and a card arrives as a live event; nothing asks on a clock.
    vi.useFakeTimers()
    mocks.api.mockResolvedValue(status({ waiting: true, waiting_since: new Date().toISOString() }))
    await render()
    const afterFirstLoad = mocks.api.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(mocks.api.mock.calls.length).toBe(afterFirstLoad)
  })
})

describe('Echo, after meeting somebody', () => {
  // Somebody found is a card on any screen now (EchoOffer), and a meeting
  // both started opens its conversation from there — so a meeting, new or
  // old, never takes over this screen: it simply offers a new search.
  it('offers a new search rather than showing the last meeting', async () => {
    mocks.api.mockResolvedValue(status({ matched: match() }))
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
