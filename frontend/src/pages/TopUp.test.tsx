import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import TopUp from './TopUp'
import { ToastProvider } from '../components/ui'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  openInvoice: vi.fn(),
  createStarInvoice: vi.fn(),
  createTopUpRequest: vi.fn(),
  getTopUpCardInfo: vi.fn(),
  listMyTopUpRequests: vi.fn(),
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
vi.mock('../lib/pricing', () => ({
  getPricingConfig: () => Promise.resolve({ star_to_toman_rate: 500, chat_commission_percent: 10 }),
}))
vi.mock('../lib/topupApi', () => ({
  createStarInvoice: mocks.createStarInvoice,
  createTopUpRequest: mocks.createTopUpRequest,
  getTopUpCardInfo: mocks.getTopUpCardInfo,
  listMyTopUpRequests: mocks.listMyTopUpRequests,
}))
vi.mock('@telegram-apps/sdk-react', () => ({ openInvoice: mocks.openInvoice }))
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

let root: Root
let container: HTMLDivElement

async function render(state: Record<string, unknown> | null = null) {
  await act(async () => {
    root.render(
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: '/wallet/topup', state }]}>
          <TopUp />
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

function type(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(selector)!
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!
  setter.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  sessionStorage.clear()
  for (const fn of [
    mocks.api,
    mocks.navigate,
    mocks.openInvoice,
    mocks.createStarInvoice,
    mocks.createTopUpRequest,
  ]) {
    fn.mockReset()
  }
  mocks.getTopUpCardInfo.mockReset().mockResolvedValue({
    card_number: '6037997200001234',
    card_holder_name: 'Alice',
  })
  mocks.listMyTopUpRequests.mockReset().mockResolvedValue([])
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('TopUp — card to card', () => {
  it('shows the card number grouped in fours, left to right', async () => {
    await render()

    const number = container.querySelector('.tu-card-number')
    expect(number?.textContent).toBe('6037 9972 0000 1234')
  })

  it('computes the Toman line from the Drop amount and never asks for it', async () => {
    await render()

    type('#topup-direct-amount', '250')

    // 250 Drop at 500 Toman each.
    expect(container.textContent).toContain('125,000')
    // Exactly one amount field: Toman is derived, never typed.
    expect(container.querySelectorAll('#topup-direct-amount')).toHaveLength(1)
  })

  it('strips leading zeros so the field never lies about its value', async () => {
    await render()

    type('#topup-direct-amount', '00100')

    expect(container.querySelector<HTMLInputElement>('#topup-direct-amount')!.value).toBe('100')
  })

  it('will not submit without both an amount and a receipt', async () => {
    await render()

    const submit = container.querySelector<HTMLButtonElement>('.ui-action-bar .ui-btn')!
    expect(submit.disabled).toBe(true)

    type('#topup-direct-amount', '250')
    expect(container.querySelector<HTMLButtonElement>('.ui-action-bar .ui-btn')!.disabled).toBe(
      true,
    )
  })

  it('opens with the amount the offer page said was missing', async () => {
    await render({ prefillStars: 400 })

    expect(container.querySelector<HTMLInputElement>('#topup-direct-amount')!.value).toBe('400')
    expect(container.textContent).toContain('200,000')
  })

  it('goes back to the offer it was sent from, not to the wallet', async () => {
    await render({ prefillStars: 400, from: '/offers/5' })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ui-header-back')!.click()
    })

    expect(mocks.navigate).toHaveBeenCalledWith('/offers/5')
  })

  it('ignores a "from" that is not an offer page', async () => {
    await render({ from: 'https://evil.example/' })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ui-header-back')!.click()
    })

    expect(mocks.navigate).toHaveBeenCalledWith('/wallet')
  })
})

describe('TopUp — Telegram Stars', () => {
  async function openStars() {
    await act(async () => buttonWith('topup.tabStars')!.click())
  }

  it('records the purchase before anything else once payment goes through', async () => {
    mocks.createStarInvoice.mockResolvedValue({ invoice_link: 'x', purchase_id: 42 })
    mocks.openInvoice.mockResolvedValue('paid')
    // The poll that follows.
    mocks.api.mockResolvedValue({ status: 'pending' })
    await render()
    await openStars()
    type('#topup-stars-amount', '500')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ui-action-bar .ui-btn')!.click()
    })

    // Survives a reload: the payment sheet can take the app out of the
    // foreground, and coming back must not lose money already paid.
    expect(sessionStorage.getItem('pending-star-purchase')).toBe('42')
  })

  it('blocks a second purchase while one is still being confirmed', async () => {
    sessionStorage.setItem('pending-star-purchase', '42')
    mocks.api.mockResolvedValue({ status: 'pending' })
    await render()
    await openStars()

    expect(container.querySelector<HTMLButtonElement>('.ui-action-bar .ui-btn')!.disabled).toBe(
      true,
    )
    expect(container.querySelector('.tu-awaiting')).toBeTruthy()
  })

  it('clears the pending purchase once the wallet is credited', async () => {
    sessionStorage.setItem('pending-star-purchase', '42')
    mocks.api.mockResolvedValue({ status: 'paid' })

    await render()

    expect(sessionStorage.getItem('pending-star-purchase')).toBeNull()
    expect(container.textContent).toContain('topup.starsPurchaseSuccess')
  })

  it('does not record anything when the sheet is cancelled', async () => {
    mocks.createStarInvoice.mockResolvedValue({ invoice_link: 'x', purchase_id: 42 })
    mocks.openInvoice.mockResolvedValue('cancelled')
    await render()
    await openStars()
    type('#topup-stars-amount', '500')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ui-action-bar .ui-btn')!.click()
    })

    expect(sessionStorage.getItem('pending-star-purchase')).toBeNull()
    // Cancelling is not a failure, so it says nothing.
    expect(container.textContent).not.toContain('topup.starsPurchaseFailed')
  })
})

describe('TopUp — third-party sellers', () => {
  it('marks every link as leaving the app, and opens none of them itself', async () => {
    await render()

    await act(async () => buttonWith('topup.tabIntermediaries')!.click())

    const links = [...container.querySelectorAll<HTMLAnchorElement>('.ui-row')]
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link.target).toBe('_blank')
      expect(link.rel).toBe('noreferrer')
    }
    // No pinned action: there is nothing to do here but leave.
    expect(container.querySelector('.ui-action-bar')).toBeNull()
  })
})
