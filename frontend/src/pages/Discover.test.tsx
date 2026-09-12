import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Discover from './Discover'
import type { Offer } from '../lib/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
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

function offer(overrides: Partial<Offer> & Pick<Offer, 'id'>): Offer {
  return {
    provider_id: overrides.id,
    service_type: 'chat',
    price_stars: 100,
    display_duration_minutes: 30,
    title: 'Chat with me',
    description: 'A nice chat',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    request_count: null,
    my_request_status: null,
    provider: {
      user_id: overrides.id,
      display_name: `User ${overrides.id}`,
      username: null,
      avatar_url: null,
      bio: null,
      is_trusted: false,
      interests: [],
    },
    ...overrides,
  }
}

const balance = {
  balance_toman: 250000,
  balance_stars_equivalent: 1240,
  pending_toman: 0,
  withdrawal_pending_toman: 0,
  in_flight_toman: 0,
  withdrawable_toman: 0,
}

/** Routes both of the page's requests off one mock, so a test only has
 *  to say what the showcase itself returns. */
function respond(offers: Offer[] | Error) {
  mocks.api.mockImplementation((path: string) => {
    if (path === '/wallet/balance') return Promise.resolve(balance)
    if (offers instanceof Error) return Promise.reject(offers)
    return Promise.resolve(offers)
  })
}

let root: Root
let container: HTMLDivElement

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Discover />
      </MemoryRouter>,
    )
  })
}

function cardNames() {
  return [...container.querySelectorAll('.ui-person-name')].map((el) => el.textContent?.trim())
}

function chip(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('.ui-chip')].find(
    (el) => el.textContent?.trim() === label,
  )
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.api.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Discover', () => {
  it('shows a card per offer, newest first', async () => {
    respond([
      offer({ id: 1, created_at: '2026-01-01T00:00:00Z' }),
      offer({ id: 2, created_at: '2026-03-01T00:00:00Z' }),
    ])

    await render()

    expect(cardNames()).toEqual(['User 2', 'User 1'])
  })

  it('reorders by price when the cheapest chip is picked', async () => {
    respond([
      offer({ id: 1, price_stars: 500, created_at: '2026-03-01T00:00:00Z' }),
      offer({ id: 2, price_stars: 120, created_at: '2026-01-01T00:00:00Z' }),
    ])
    await render()

    await act(async () => {
      chip('discover.sortCheapest')!.click()
    })

    expect(cardNames()).toEqual(['User 2', 'User 1'])
  })

  it('builds its interest chips from the feed and filters on them', async () => {
    respond([
      offer({
        id: 1,
        provider: { ...offer({ id: 1 }).provider!, display_name: 'Reader', interests: ['books'] },
      }),
      offer({
        id: 2,
        provider: { ...offer({ id: 2 }).provider!, display_name: 'Runner', interests: ['sport'] },
      }),
    ])
    await render()

    expect(chip('books')).toBeTruthy()
    await act(async () => {
      chip('books')!.click()
    })

    expect(cardNames()).toEqual(['Reader'])
  })

  it('clears the filter when its own chip is tapped again', async () => {
    respond([
      offer({
        id: 1,
        provider: { ...offer({ id: 1 }).provider!, display_name: 'Reader', interests: ['books'] },
      }),
      offer({ id: 2 }),
    ])
    await render()

    await act(async () => {
      chip('books')!.click()
    })
    expect(cardNames()).toEqual(['Reader'])

    await act(async () => {
      chip('books')!.click()
    })
    expect(cardNames()).toHaveLength(2)
  })

  it('says why the showcase is empty and what to do about it', async () => {
    respond([])

    await render()

    expect(container.querySelector('.ui-state-title')?.textContent).toBe('discover.emptyTitle')
    expect(container.querySelector('.ui-state-action')?.textContent).toBe('offers.createNew')
  })

  it('offers a retry when the feed fails', async () => {
    respond(new Error('network down'))

    await render()

    const retry = container.querySelector('.ui-state-action button')
    expect(retry?.textContent).toBe('common.retry')

    respond([offer({ id: 1 })])
    await act(async () => {
      ;(retry as HTMLButtonElement).click()
    })

    expect(cardNames()).toEqual(['User 1'])
  })

  it('still renders the showcase when the balance request fails', async () => {
    mocks.api.mockImplementation((path: string) =>
      path === '/wallet/balance'
        ? Promise.reject(new Error('nope'))
        : Promise.resolve([offer({ id: 1 })]),
    )

    await render()

    expect(cardNames()).toEqual(['User 1'])
    // The card's own price chip is also a .ui-drop, so this has to ask
    // about the header's one specifically.
    expect(container.querySelector('.ui-header .ui-drop')).toBeNull()
  })
})
