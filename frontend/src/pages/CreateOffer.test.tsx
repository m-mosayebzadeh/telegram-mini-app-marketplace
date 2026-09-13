import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import CreateOffer from './CreateOffer'
import { ToastProvider } from '../components/ui'

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
// The price caption runs its own pricing fetch; it has its own tests.
vi.mock('../components/PriceBreakdown', () => ({ PriceBreakdown: () => null }))

let root: Root
let container: HTMLDivElement

function type(selector: string, value: string) {
  const field = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  const setter = Object.getOwnPropertyDescriptor(
    field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )!.set!
  act(() => {
    setter.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function fill({ price, duration }: { price: string; duration: string }) {
  type('#offer-title', 'Chat with me')
  type('#offer-price', price)
  type('#offer-duration', duration)
  type('#offer-description', 'A nice chat')
}

const submitButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('offers.createButton')) ??
  [...container.querySelectorAll('button')].at(-1)!

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.api.mockReset().mockResolvedValue({})
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ToastProvider>
          <CreateOffer />
        </ToastProvider>
      </MemoryRouter>,
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('creating an offer', () => {
  it('refuses a price that will not split into whole blocks', () => {
    // A session is settled one block at a time, so 42 Drops would leave a
    // half Drop in every single settlement.
    fill({ price: '42', duration: '30' })

    expect(container.textContent).toContain('offers.priceMustFitBlocks')
    expect(submitButton().disabled).toBe(true)
  })

  it('names the nearest workable prices instead of only complaining', () => {
    fill({ price: '42', duration: '30' })

    expect(container.textContent).toContain('40')
    expect(container.textContent).toContain('44')
  })

  it('spells out what a buyer is actually buying', () => {
    fill({ price: '100', duration: '30' })

    // Four blocks of 7.5 minutes at 25 Drops each.
    expect(container.textContent).toContain('offers.blockBreakdown')
    expect(container.textContent).toContain('7.5')
    expect(container.textContent).toContain('25')
  })

  it('sends the duration in seconds, which is what makes blocks exact', async () => {
    fill({ price: '100', duration: '30' })

    await act(async () => submitButton().click())

    const body = JSON.parse(mocks.api.mock.calls[0][1].body)
    expect(body.session_duration_seconds).toBe(1800)
    expect(body.price_drops).toBe(100)
  })
})
