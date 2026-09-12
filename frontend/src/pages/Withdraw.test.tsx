import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Withdraw from './Withdraw'
import AdminWithdrawals from './AdminWithdrawals'
import { ApiError } from '../lib/api'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  quote: vi.fn(),
  banks: vi.fn(),
  rows: vi.fn(),
  t: (key: string, args?: Record<string, unknown>) =>
    args
      ? `${key} ${JSON.stringify(args)}`
      : key.startsWith('finance.errors.')
        ? `translated:${key}`
        : key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'en' } }),
}))
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  apiFetch: mocks.api,
}))
vi.mock('../lib/withdrawalApi', async (original) => ({
  ...(await original<typeof import('../lib/withdrawalApi')>()),
  quoteWithdrawal: mocks.quote,
  bankAccounts: mocks.banks,
  withdrawals: mocks.rows,
}))
vi.mock('../lib/MeContext', () => ({
  useMe: () => ({ me: { id: 9 }, adminAccess: { is_owner: true, scopes: [] } }),
}))

const quote = {
  stars: 200,
  star_rate: 2500,
  fee_percent: 10,
  minimum_toman: 500000,
  gross_toman: 500000,
  fee_toman: 50000,
  net_toman: 450000,
  quote_token: 'a'.repeat(64),
}
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.resetAllMocks()
  sessionStorage.clear()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  mocks.banks.mockResolvedValue([
    {
      id: 1,
      holder_name: 'Test Owner',
      card_number: '6037991234567890',
      iban: 'IR123456789012345678901234',
    },
  ])
  mocks.rows.mockResolvedValue([])
  mocks.quote.mockResolvedValue(quote)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(<MemoryRouter>{node}</MemoryRouter>)
  })
}
async function edit(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLSelectElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      element,
      value,
    )
    element.dispatchEvent(
      new Event(element instanceof HTMLInputElement ? 'input' : 'change', {
        bubbles: true,
      }),
    )
  })
}
function button(label: string) {
  return Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === label,
  )!
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function prepare() {
  await mount(<Withdraw />)
  await edit(host.querySelector('input')!, '200')
  await edit(host.querySelector('select')!, '1')
  await click('finance.preview')
}

describe('withdrawal confirmation', () => {
  it('rejects fractional input before preview and accepts Persian digits', async () => {
    await mount(<Withdraw />)
    await edit(host.querySelector('select')!, '1')
    await edit(host.querySelector('input')!, '200.5')
    expect(button('finance.preview').disabled).toBe(true)
    await edit(host.querySelector('input')!, '۲۰۰')
    expect(button('finance.preview').disabled).toBe(false)
  })
  it('requires a second explicit confirmation after the server changes a quote', async () => {
    await prepare()
    const updated = {
      ...quote,
      fee_percent: 20,
      fee_toman: 100000,
      net_toman: 400000,
      quote_token: 'b'.repeat(64),
    }
    mocks.api
      .mockRejectedValueOnce(
        new ApiError(409, {
          detail: { reason: 'quote_changed', quote: updated },
        }),
      )
      .mockResolvedValueOnce({ id: 1 })
    await click('finance.confirmWithdrawal')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('finance.errors.quote_changed')
    expect(host.textContent).toContain('400,000')
    await click('finance.confirmWithdrawal')
    expect(mocks.api).toHaveBeenCalledTimes(2)
    const first = JSON.parse(mocks.api.mock.calls[0][1].body)
    const second = JSON.parse(mocks.api.mock.calls[1][1].body)
    expect(first.idempotency_key).toBe(second.idempotency_key)
    expect(second.quote_token).toBe(updated.quote_token)
  })
  it('reuses the operation key after an ambiguous network failure', async () => {
    await prepare()
    mocks.api
      .mockRejectedValueOnce(new Error('Network failed'))
      .mockResolvedValueOnce({ id: 1 })
    await click('finance.confirmWithdrawal')
    await click('finance.confirmWithdrawal')
    expect(JSON.parse(mocks.api.mock.calls[0][1].body).idempotency_key).toBe(
      JSON.parse(mocks.api.mock.calls[1][1].body).idempotency_key,
    )
  })
})

it('requires a bank reference before staff can mark a withdrawal paid', async () => {
  mocks.api.mockResolvedValue([
    {
      ...quote,
      id: 1,
      user_id: 1,
      holder_name: 'Holder',
      card_number: '6037991234567890',
      iban: 'IR123456789012345678901234',
      status: 'processing',
      assigned_to_user_id: 9,
      reference: null,
      reason: null,
      created_at: '2026-09-12T12:00:00Z',
      updated_at: '2026-09-12T12:00:00Z',
    },
  ])
  await mount(<AdminWithdrawals />)
  await click('finance.markPaid')
  expect(button('finance.confirm').disabled).toBe(true)
  await edit(host.querySelector('input')!, 'BANK-123')
  expect(button('finance.confirm').disabled).toBe(false)
})
