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

/** The duration is a stepper and a row of presets now, not a text field:
 *  it can only ever produce a legal value, so there is nothing to type
 *  and nothing to reject. */
function setDuration(minutes: number) {
  const more = [...container.querySelectorAll<HTMLButtonElement>('.df-step')].at(-1)!
  // First tap lands on the minimum, then one step at a time. Each click
  // gets its own act() — batched into one, they would all read the same
  // pre-click state and the value would move by a single step.
  const steps = Math.round((minutes - 20) / 5)
  for (let i = 0; i <= steps; i += 1) act(() => more.click())
}

function fill({ price, duration }: { price: string; duration: number }) {
  type('#offer-title', 'Chat with me')
  type('#offer-price', price)
  setDuration(duration)
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
    // A session is settled one block at a time, so 42 Photons would leave a
    // half Photon in every single settlement.
    fill({ price: '42', duration: 30 })

    expect(container.textContent).toContain('offers.priceMustFitBlocks')
    expect(submitButton().disabled).toBe(true)
  })

  it('names the nearest workable prices instead of only complaining', () => {
    fill({ price: '42', duration: 30 })

    expect(container.textContent).toContain('40')
    expect(container.textContent).toContain('44')
  })

  it('spells out what a buyer is actually buying', () => {
    fill({ price: '100', duration: 30 })

    // Four blocks of 7 minutes 30 seconds at 25 Photons each. The length is
    // said in minutes AND seconds rather than as "7.5 minutes", which is
    // not a number anyone thinks in.
    expect(container.textContent).toContain('offers.blockBreakdown')
    // The mock nests one JSON blob inside another, so the inner quotes
    // arrive escaped; the regex is tolerant of that rather than encoding
    // the mock's own formatting into the expectation.
    expect(container.textContent).toMatch(/minutes.{1,3}:7,.{1,3}seconds.{1,3}:30/)
    expect(container.textContent).toContain('"price":25')
  })

  it('offers lengths whose blocks are whole minutes', () => {
    // Every preset divides into four whole-minute blocks — 60 minutes is
    // four 15-minute blocks, which reads as something a person chose.
    const presets = [...container.querySelectorAll('.df-presets .ui-chip')]
    expect(presets.length).toBeGreaterThan(0)
    act(() => (presets[2] as HTMLButtonElement).click())

    expect(container.textContent).toMatch(/minutes.{1,3}:15/)
  })

  it('cannot be stepped below the shortest session it sells', () => {
    const less = container.querySelector<HTMLButtonElement>('.df-step')!
    act(() => less.click())

    expect(less.disabled).toBe(true)
  })

  it('sends the duration in seconds, which is what makes blocks exact', async () => {
    fill({ price: '100', duration: 30 })

    await act(async () => submitButton().click())

    const body = JSON.parse(mocks.api.mock.calls[0][1].body)
    expect(body.session_duration_seconds).toBe(1800)
    expect(body.price_photons).toBe(100)
  })
})
