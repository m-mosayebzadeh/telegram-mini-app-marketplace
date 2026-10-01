import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EchoProposal, EchoStatus } from '../../lib/echoApi'
import { resetEchoStore, setEcho } from '../../lib/echoStore'
import { EchoOffer } from './EchoOffer'
import { echoDoorOf } from './WorldBar'

const mocks = vi.hoisted(() => ({
  accept: vi.fn(),
  decline: vi.fn(),
  status: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, args?: Record<string, unknown>) => (args ? `${key} ${JSON.stringify(args)}` : key),
    i18n: { language: 'en' },
  }),
}))
vi.mock('../../lib/echoApi', () => ({
  acceptEchoProposal: mocks.accept,
  declineEchoProposal: mocks.decline,
  fetchEchoStatus: mocks.status,
}))
vi.mock('../../lib/live', () => ({ subscribe: () => () => {} }))
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
    waiting: true,
    waiting_since: new Date().toISOString(),
    matched: null,
    last_search: null,
    remaining_today: null,
    proposal: null,
    ...overrides,
  }
}

function card(overrides: Partial<EchoProposal> = {}): EchoProposal {
  return {
    id: 5,
    tagline: 'Up at night, reading.',
    shared_tags: ['books'],
    expires_at: new Date(Date.now() + 15_000).toISOString(),
    seconds: 15,
    accepted: false,
    ...overrides,
  }
}

/** A meeting both have just started. */
function started(): EchoStatus {
  return status({
    waiting: false,
    matched: {
      session_id: 1,
      conversation_id: 42,
      other_user_id: 9,
      display_name: 'Sara',
      username: null,
      avatar_url: null,
      shared_tags: ['books'],
      gender_as_asked: true,
      age_as_asked: true,
      follow_status: 'none',
      started_at: new Date().toISOString(),
    },
  })
}

/** Somebody found in Echo, on any screen (section 32). */
describe('the card when somebody is found', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    resetEchoStore()
    Object.values(mocks).forEach((mock) => mock.mockReset())
    mocks.status.mockImplementation(async () => status())
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  async function show(value: EchoStatus) {
    mocks.status.mockImplementation(async () => value)
    await act(async () =>
      root.render(
        <MemoryRouter>
          <EchoOffer />
        </MemoryRouter>,
      ),
    )
    await act(async () => setEcho(value))
  }
  const text = () => host.textContent ?? ''
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement

  it('shows nothing while nobody is found', async () => {
    await show(status())
    expect(host.querySelector('.cos-offer')).toBeNull()
  })

  it('shows their line and what you share, but no name and no photo', async () => {
    await show(status({ proposal: card() }))
    expect(text()).toContain('echoOffer.found')
    expect(text()).toContain('«Up at night, reading.»')
    expect(text()).toContain('echo.tag.books')
    expect(host.querySelector('img')).toBeNull()
    expect(button('echoOffer.start')).toBeTruthy()
    expect(button('echoOffer.decline')).toBeTruthy()
    // The ring that empties around it.
    expect(host.querySelector('.cos-offer-ring')).not.toBeNull()
  })

  it('says the group you share when there is no interest in common', async () => {
    await show(status({ proposal: card({ shared_tags: [], shared_groups: ['learning'] }) }))
    expect(text()).toContain('echoOffer.sharedGroups')
    expect(text()).not.toContain('echoOffer.shared ')
  })

  it('opens the conversation once both have said start', async () => {
    await show(status({ proposal: card() }))
    mocks.accept.mockResolvedValue(started())
    await act(async () => button('echoOffer.start').click())
    expect(mocks.accept).toHaveBeenCalledWith(5)
    expect(mocks.navigate).toHaveBeenCalledWith('/conversations/42')
  })

  it('waits for the other person after saying start, without a way to take it back', async () => {
    await show(status({ proposal: card({ accepted: true }) }))
    expect(text()).toContain('echoOffer.waitingOther')
    expect(button('echoOffer.decline')).toBeUndefined()
  })

  it('opens the conversation when the other person says start second', async () => {
    await show(status({ proposal: card({ accepted: true }) }))
    await act(async () => setEcho(started()))
    expect(mocks.navigate).toHaveBeenCalledWith('/conversations/42')
  })

  it('says no from the small button', async () => {
    await show(status({ proposal: card() }))
    mocks.decline.mockResolvedValue(status())
    await act(async () => button('echoOffer.decline').click())
    expect(mocks.decline).toHaveBeenCalledWith(5)
  })

  it('fades with a word about the next person when it ends without a meeting', async () => {
    vi.useFakeTimers()
    await show(status({ proposal: card() }))
    await act(async () => setEcho(status()))
    expect(text()).toContain('echoOffer.next')
    expect(mocks.navigate).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1700)
    })
    expect(host.querySelector('.cos-offer')).toBeNull()
  })
})

/** Echo's door says what Echo is doing by motion and shape (section 32). */
describe("Echo's door", () => {
  const base = {
    minutes_until_open: null,
    missing: [],
    suspended: false,
    waiting_since: null,
    matched: null,
    last_search: null,
    remaining_today: null,
  }
  it('is still when shut', () => {
    expect(echoDoorOf(null)).toBe('shut')
    expect(echoDoorOf({ ...base, open_now: false, waiting: false })).toBe('shut')
  })
  it('turns when open, and turns faster when somebody is waiting now', () => {
    expect(echoDoorOf({ ...base, open_now: true, waiting: false, waiting_now: 0 })).toBe('open')
    expect(echoDoorOf({ ...base, open_now: true, waiting: false, waiting_now: 2 })).toBe('busy')
  })
  it('circles you while you are searching, wherever you are', () => {
    expect(echoDoorOf({ ...base, open_now: true, waiting: true, waiting_now: 3 })).toBe('seeking')
  })
})
