import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import WalletPage from './Wallet'

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

const emptyBalance = {
  balance_toman: 250000,
  balance_stars_equivalent: 100,
  pending_toman: 0,
  withdrawal_pending_toman: 0,
  in_flight_toman: 0,
  withdrawable_toman: 0,
}

let root: Root
let container: HTMLDivElement

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <WalletPage />
      </MemoryRouter>,
    )
  })
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

describe('wallet screen', () => {
  it('shows a single figure when nothing is in progress', async () => {
    // A buyer who has never sold anything must not be shown a column of
    // zeroes — the whole point of folding four figures into one.
    mocks.api.mockResolvedValue(emptyBalance)

    await render()

    expect(container.textContent).toContain('wallet.spendable')
    expect(container.textContent).not.toContain('wallet.inFlight')
  })

  it('adds one line when money is tied up, whatever the reason', async () => {
    mocks.api.mockResolvedValue({ ...emptyBalance, in_flight_toman: 300000 })

    await render()

    expect(container.textContent).toContain('wallet.inFlight')
    expect(container.textContent).toContain('300,000')
  })

  it('never shows the withdrawal ceiling here — it belongs on the withdraw screen', async () => {
    mocks.api.mockResolvedValue({ ...emptyBalance, withdrawable_toman: 120000 })

    await render()

    expect(container.textContent).not.toContain('120,000')
  })
})
