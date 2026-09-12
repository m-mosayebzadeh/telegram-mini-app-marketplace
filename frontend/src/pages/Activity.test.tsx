import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Activity from './Activity'
import { ToastProvider } from '../components/ui'
import type { ChatSession, Offer, RequestActivity } from '../lib/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  me: { id: 1, unseen_sent_request_updates_count: 0 },
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
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 7,
    provider_id: 1,
    service_type: 'chat',
    price_stars: 250,
    display_duration_minutes: 30,
    title: 'Chat with me',
    description: 'x',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    request_count: 0,
    my_request_status: null,
    provider: null,
    ...overrides,
  }
}

function activity(overrides: Partial<RequestActivity> = {}): RequestActivity {
  return {
    id: 21,
    offer_id: 7,
    offer_title: 'Chat with me',
    offer_price_stars: 250,
    direction: 'sent',
    status: 'pending',
    reason: null,
    counterpart_user_id: 3,
    counterpart_display_name: 'Alice',
    counterpart_username: 'alice',
    counterpart_avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as RequestActivity
}

function respond(over: Record<string, unknown> = {}) {
  const table: Record<string, unknown> = {
    '/offers?provider_id=1': [offer()],
    '/requests/activity': [activity()],
    '/chat-sessions/mine': [] as ChatSession[],
    '/wallet/balance': { balance_stars_equivalent: 1240 },
    ...over,
  }
  mocks.api.mockImplementation((path: string) => {
    if (path in table) {
      const value = table[path]
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
    }
    return Promise.resolve(undefined)
  })
}

let root: Root
let container: HTMLDivElement

async function render() {
  await act(async () => {
    root.render(
      <ToastProvider>
        <MemoryRouter>
          <Activity />
        </MemoryRouter>
      </ToastProvider>,
    )
  })
}

function buttonWith(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.textContent?.trim() === label,
  )
}

/** A list row's own label. Rows in a sheet carry a subtitle too, so the
 *  button's whole textContent is not the label. */
function rowWith(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('.ui-row')].find(
    (el) => el.querySelector('.ui-row-title')?.textContent?.trim() === label,
  )
}

async function openRequests() {
  await act(async () => buttonWith('activityPage.requestsTab')!.click())
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.api.mockReset()
  mocks.navigate.mockReset()
  mocks.me = { id: 1, unseen_sent_request_updates_count: 0 }
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Activity — offers', () => {
  it('opens on the offers segment and lists what you sell', async () => {
    respond()

    await render()

    expect(container.querySelector('.ac-segment-active')?.textContent).toContain(
      'activityPage.offersTab',
    )
    expect(container.querySelector('.ui-row-title')?.textContent).toBe('Chat with me')
  })

  it('shows no badge when nothing is unseen', async () => {
    respond()
    await render()
    expect(container.querySelector('.ac-segments .ui-badge')).toBeNull()

    await act(async () => root.unmount())
    root = createRoot(container)
    respond({ '/offers?provider_id=1': [offer({ request_count: 4 })] })
    await render()
    expect(container.querySelector('.ac-segments .ui-badge')?.textContent).toBe('4')
  })

  it('puts activate and delete behind one overflow, not on the row', async () => {
    respond()
    await render()

    // The row itself carries no management buttons.
    expect(rowWith('offers.deactivate')).toBeUndefined()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ac-offer-manage')!.click()
    })

    expect(rowWith('offers.deactivate')).toBeTruthy()
    expect(rowWith('offers.delete')).toBeTruthy()
  })

  it('confirms a delete in a dialog instead of window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    respond()
    await render()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ac-offer-manage')!.click()
    })
    await act(async () => rowWith('offers.delete')!.click())

    expect(container.querySelector('.ui-dialog-title')?.textContent).toBe('offers.delete')
    expect(confirmSpy).not.toHaveBeenCalled()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ui-dialog-actions .ui-btn-danger')!.click()
    })
    expect(mocks.api).toHaveBeenCalledWith('/offers/7', { method: 'DELETE' })
    confirmSpy.mockRestore()
  })

  it('says what to do when you sell nothing yet', async () => {
    respond({ '/offers?provider_id=1': [] })

    await render()

    expect(container.querySelector('.ui-state-title')?.textContent).toBe(
      'activityPage.offersEmpty',
    )
    await act(async () => buttonWith('offers.createNew')!.click())
    expect(mocks.navigate).toHaveBeenCalledWith('/offers/new')
  })
})

describe('Activity — requests', () => {
  it('gives each request exactly one action', async () => {
    respond()
    await render()
    await openRequests()

    expect(container.querySelectorAll('.ac-request-action .ui-btn')).toHaveLength(1)
    expect(buttonWith('requests.cancelButton')).toBeTruthy()
  })

  it('offers payment on an accepted request with no session yet', async () => {
    respond({ '/requests/activity': [activity({ status: 'accepted' })] })
    await render()
    await openRequests()

    await act(async () => buttonWith('requests.payButton')!.click())

    expect(mocks.api).toHaveBeenCalledWith('/requests/21/pay', { method: 'POST' })
  })

  it('offers the chat once a session exists', async () => {
    respond({
      '/requests/activity': [activity({ status: 'accepted' })],
      '/chat-sessions/mine': [{ id: 55, request_id: 21, status: 'open' }],
    })
    await render()
    await openRequests()

    expect(buttonWith('requests.payButton')).toBeUndefined()
    await act(async () => buttonWith('requests.openSession')!.click())
    expect(mocks.navigate).toHaveBeenCalledWith('/chat-sessions/55')
  })

  it('gives a rejection its reason its own line, and no action', async () => {
    respond({
      '/requests/activity': [activity({ status: 'rejected', reason: 'Busy that week' })],
    })
    await render()
    await openRequests()

    expect(container.querySelector('.ac-request-reason')?.textContent).toBe('Busy that week')
    expect(container.querySelector('.ac-request-action')).toBeNull()
  })

  it('hides requests other people sent to you', async () => {
    respond({
      '/requests/activity': [
        activity({ id: 21, direction: 'sent' }),
        activity({ id: 22, direction: 'received', counterpart_display_name: 'Bob' }),
      ],
    })
    await render()
    await openRequests()

    const names = [...container.querySelectorAll('.ui-row-title')].map((el) => el.textContent)
    expect(names).toEqual(['Alice'])
  })

  it('points at the showcase when you have asked for nothing', async () => {
    respond({ '/requests/activity': [] })
    await render()
    await openRequests()

    await act(async () => buttonWith('activityPage.browseShowcase')!.click())

    expect(mocks.navigate).toHaveBeenCalledWith('/offers')
  })
})
