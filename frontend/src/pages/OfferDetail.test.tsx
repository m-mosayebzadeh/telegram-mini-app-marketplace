import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import OfferDetail from './OfferDetail'
import { ToastProvider } from '../components/ui'
import { ApiError } from '../lib/api'
import type { IncomingRequest, Offer } from '../lib/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  me: { id: 1 },
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
vi.mock('../lib/pricing', () => ({
  getPricingConfig: () => Promise.resolve({ star_to_toman_rate: 500, chat_commission_percent: 10 }),
}))
// PriceBreakdown runs its own pricing fetch and is covered by its own
// tests; this page only has to place it.
vi.mock('../components/PriceBreakdown', () => ({ PriceBreakdown: () => null }))
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 5,
    provider_id: 2,
    service_type: 'chat',
    price_stars: 250,
    display_duration_minutes: 30,
    title: 'Chat with me',
    description: 'A nice long chat about books',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    request_count: null,
    my_request_status: null,
    provider: {
      user_id: 2,
      display_name: 'Alice',
      username: 'alice',
      avatar_url: null,
      bio: 'Books and long walks',
      is_trusted: true,
      interests: ['books'],
    },
    ...overrides,
  }
}

function request(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    id: 11,
    offer_id: 5,
    buyer_id: 9,
    buyer_display_name: 'Bob',
    buyer_username: 'bob',
    buyer_avatar_url: null,
    status: 'pending',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as IncomingRequest
}

const RICH_BALANCE = { balance_stars_equivalent: 9999 }
const POOR_BALANCE = { balance_stars_equivalent: 10 }

/** Answers each of the page's endpoints; `over` replaces any of them. */
function respond(over: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    '/offers/5': offer(),
    '/wallet/balance': RICH_BALANCE,
    '/requests?offer_id=5': [],
    '/chat-sessions/mine': [],
    ...over,
  }
  mocks.api.mockImplementation((path: string) => {
    const value = table[path]
    if (value instanceof Error) return Promise.reject(value)
    return Promise.resolve(value)
  })
}

let root: Root
let container: HTMLDivElement

async function render() {
  await act(async () => {
    root.render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/offers/5']}>
          <Routes>
            <Route path="/offers/:id" element={<OfferDetail />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    )
  })
}

function text(selector: string) {
  return container.querySelector(selector)?.textContent?.trim()
}

function buttonWith(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.textContent?.trim() === label,
  )
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.api.mockReset()
  mocks.navigate.mockReset()
  mocks.me = { id: 1 }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('OfferDetail — buyer', () => {
  it('leads with the person and pins one request button', async () => {
    respond()

    await render()

    expect(text('.of-person-name')).toContain('Alice')
    expect(text('.of-person-bio')).toBe('Books and long walks')
    const action = container.querySelector('.of-action .ui-btn-primary')
    expect(action?.textContent).toBe('offers.requestButton')
    expect(container.querySelectorAll('.ui-btn-primary')).toHaveLength(1)
  })

  it('sends the request and says so', async () => {
    respond()
    await render()

    await act(async () => buttonWith('offers.requestButton')!.click())

    expect(mocks.api).toHaveBeenCalledWith('/requests', {
      method: 'POST',
      body: JSON.stringify({ offer_id: 5 }),
    })
    expect(text('.ui-toast')).toContain('offers.requestSent')
  })

  it('disables the button once a request is already live', async () => {
    respond({ '/offers/5': offer({ my_request_status: 'pending' }) })

    await render()

    const action = container.querySelector<HTMLButtonElement>('.of-action .ui-btn')
    expect(action?.disabled).toBe(true)
    expect(action?.textContent).toBe('offers.requestSent')
  })

  it('warns about a short balance BEFORE creating a doomed request', async () => {
    respond({ '/wallet/balance': POOR_BALANCE })
    await render()

    await act(async () => buttonWith('offers.requestButton')!.click())

    expect(text('.ui-dialog-title')).toBe('offers.insufficientBalanceTitle')
    // The whole point: no request was created.
    expect(mocks.api).not.toHaveBeenCalledWith('/requests', expect.anything())
  })

  it('turns the daily-cap refusal into its own dialog', async () => {
    respond()
    await render()
    mocks.api.mockRejectedValueOnce(
      new ApiError(400, { detail: { reason: 'daily_cap_reached', limit: 3 } }),
    )

    await act(async () => buttonWith('offers.requestButton')!.click())

    expect(text('.ui-dialog-title')).toBe('offers.dailyCapTitle')
  })

  it('sends a live-conflict refusal to the requests list', async () => {
    respond()
    await render()
    mocks.api.mockRejectedValueOnce(
      new ApiError(400, { detail: { reason: 'live_request_with_provider' } }),
    )
    await act(async () => buttonWith('offers.requestButton')!.click())

    await act(async () => buttonWith('offers.viewMyRequestsButton')!.click())

    expect(mocks.navigate).toHaveBeenCalledWith('/activity', {
      state: { segment: 'requests' },
    })
  })
})

describe('OfferDetail — owner', () => {
  beforeEach(() => {
    mocks.me = { id: 2 }
  })

  it('shows the incoming requests instead of a request button', async () => {
    respond({ '/requests?offer_id=5': [request()] })

    await render()

    expect(container.querySelector('.of-action')).toBeNull()
    expect(text('.ui-row-title')).toBe('Bob')
    expect(buttonWith('requests.acceptButton')).toBeTruthy()
  })

  it('says why the list is empty rather than only that it is', async () => {
    respond()

    await render()

    expect(text('.ui-state-title')).toBe('offers.noIncomingRequests')
    expect(text('.ui-state-text')).toBe('offers.noIncomingRequestsHint')
  })

  it('asks for a rejection reason in a sheet, not a browser prompt', async () => {
    respond({ '/requests?offer_id=5': [request()] })
    await render()

    await act(async () => buttonWith('requests.rejectButton')!.click())

    const field = container.querySelector<HTMLTextAreaElement>('#reject-reason')
    expect(field).toBeTruthy()
    // An empty reason is not a rejection the other person can act on.
    const confirm = container.querySelector<HTMLButtonElement>('.ui-sheet-footer .ui-btn')
    expect(confirm?.disabled).toBe(true)
  })

  it('rejects with the reason that was typed', async () => {
    respond({ '/requests?offer_id=5': [request()] })
    await render()
    await act(async () => buttonWith('requests.rejectButton')!.click())

    const field = container.querySelector<HTMLTextAreaElement>('#reject-reason')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(field, 'Not available that week')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ui-sheet-footer .ui-btn')!.click()
    })

    expect(mocks.api).toHaveBeenCalledWith('/requests/11/reject', {
      method: 'POST',
      body: JSON.stringify({ reason: 'Not available that week' }),
    })
  })

  it('accepts a request', async () => {
    respond({ '/requests?offer_id=5': [request()] })
    await render()

    await act(async () => buttonWith('requests.acceptButton')!.click())

    expect(mocks.api).toHaveBeenCalledWith('/requests/11/accept', { method: 'POST' })
  })
})
