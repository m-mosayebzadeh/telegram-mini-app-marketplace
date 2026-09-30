import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import AdminEcho, { fromClock, toClock } from './AdminEcho'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  access: { is_owner: true, scopes: [] as string[] } as { is_owner: boolean; scopes: string[] } | null,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../lib/adminApi', () => ({ getEchoSchedule: mocks.get, updateEchoSchedule: mocks.put }))
vi.mock('../lib/MeContext', () => ({ useMe: () => ({ adminAccess: mocks.access }) }))
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

/**
 * Echo's switch and hours in the panel (TECHNICAL_REQUIREMENTS.md section
 * 32, step 3): "always open" keeps Echo open round the clock and greys the
 * hours out without losing them.
 */
describe('Echo in the admin panel', () => {
  let host: HTMLDivElement
  let root: Root
  const schedule = { enabled: true, always_open: false, opens_at_minute: 22 * 60, closes_at_minute: 23 * 60, daily_quota: 10, daily_quota_unlimited: true }

  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue(schedule)
    mocks.put.mockReset().mockImplementation(async (s) => s)
    mocks.access = { is_owner: true, scopes: [] }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function open() {
    await act(async () => root.render(<MemoryRouter><AdminEcho /></MemoryRouter>))
  }
  const switches = () => [...host.querySelectorAll('[role="switch"]')] as HTMLButtonElement[]

  it('turns minutes into a clock and back', () => {
    expect(toClock(22 * 60 + 5)).toBe('22:05')
    expect(toClock(1440)).toBe('24:00')
    expect(fromClock('07:30')).toBe(450)
    expect(fromClock('nonsense')).toBeNull()
    expect(fromClock('25:00')).toBeNull()
  })

  it('shows the hours, and greys them out once "always open" is on', async () => {
    await open()
    const opens = host.querySelector('#echo-opens') as HTMLInputElement
    expect(opens.value).toBe('22:00')
    expect(opens.disabled).toBe(false)
    await act(async () => switches()[1].click())
    expect(switches()[1].getAttribute('aria-checked')).toBe('true')
    expect((host.querySelector('#echo-opens') as HTMLInputElement).disabled).toBe(true)
  })

  it('saves "always open" without losing the hours', async () => {
    await open()
    await act(async () => switches()[1].click())
    await act(async () => (host.querySelector('.ui-action-bar button') as HTMLButtonElement).click())
    expect(mocks.put).toHaveBeenCalledWith(expect.objectContaining({ always_open: true, opens_at_minute: 22 * 60, closes_at_minute: 23 * 60 }))
  })

  it('is closed to somebody without the right', async () => {
    mocks.access = { is_owner: false, scopes: ['finance.rates'] }
    await open()
    expect(host.textContent).toContain('admin.noAccess')
    expect(mocks.get).not.toHaveBeenCalled()
  })
})
