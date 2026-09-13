import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import TopUp from './TopUp'
import { ToastProvider } from '../components/ui'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
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
  getPricingConfig: () => Promise.resolve({ drop_to_toman_rate: 500, chat_commission_percent: 10 }),
}))
vi.mock('../lib/topupApi', () => ({
  createTopUpRequest: mocks.createTopUpRequest,
  getTopUpCardInfo: mocks.getTopUpCardInfo,
  listMyTopUpRequests: mocks.listMyTopUpRequests,
}))
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

    // 250 Drop at 500 Toman each. The mock renders the interpolation
    // object verbatim; the real t() formats and localises it.
    expect(container.textContent).toContain('"amount":125000')
    expect(container.textContent).toContain('topup.transferLabel')
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
    await render({ prefillDrops: 400 })

    expect(container.querySelector<HTMLInputElement>('#topup-direct-amount')!.value).toBe('400')
    expect(container.textContent).toContain('"amount":200000')
  })

  it('goes back to the offer it was sent from, not to the wallet', async () => {
    await render({ prefillDrops: 400, from: '/offers/5' })

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
