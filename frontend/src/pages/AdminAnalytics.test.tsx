import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminAnalytics, { type Analytics } from './AdminAnalytics'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  access: { is_owner: false, scopes: ['analytics.view'] } as { is_owner: boolean; scopes: string[] },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../lib/api', async (original) => ({ ...(await original<typeof import('../lib/api')>()), apiFetch: mocks.api }))
vi.mock('../lib/MeContext', () => ({ useMe: () => ({ adminAccess: mocks.access }) }))

const DATA: Analytics = {
  days: 7,
  answered: { now: 42, before: 30 },
  joining: { people: 10, ways: { google: 7, telegram: 3 }, steps: { ways: 25, google: 9 } },
  first_day: { people: 8, profile: 0.5, approached: 0.75, wrote: 0.5, answered: 0.25 },
  coming_back: { today: 5, week: 20, month: 40, day1: 0.4, day7: 0.2, day30: null },
  friendship: { asked: 6, accepted: 4, talked_after: 0.5 },
  echo: { proposals: 3, outcomes: { accepted: 2 }, met: 2, ended_early: 0.5, kept: 0 },
  safety: { conversations: 100, reports: 1, blocks: 2, reports_per_1000: 10, blocks_per_1000: 20, team_answer_minutes: 12.5 },
  notifications: { people_with: 9, share_of_month: 0.225, sent: 50, opened: 10, opened_share: 0.2 },
  app: { load_ms_median: 1800, load_ms_slow: 4200, errors: { script: 2 }, fps_normal: 58, fps_light: 60, fps_slow_phones: 31 },
}

/** The analytics page (section 43): the approved list, as numbers. */
describe('the analytics page', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    mocks.api.mockReset()
    mocks.api.mockResolvedValue(DATA)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function open() {
    await act(async () => root.render(<MemoryRouter><AdminAnalytics /></MemoryRouter>))
  }

  it('opens on the last seven days, the one number first', async () => {
    await open()
    expect(mocks.api).toHaveBeenCalledWith('/admin/analytics?days=7')
    const first = host.querySelector('.ui-section')!
    expect(first.textContent).toContain('analytics.answered')
    expect(first.textContent).toContain('42')
    // Every part of the approved list is there.
    expect(host.querySelectorAll('.ui-section')).toHaveLength(9)
    expect(host.textContent).toContain('—') // a share that cannot be known yet says so
  })

  it('reads thirty days when asked', async () => {
    await open()
    const thirty = [...host.querySelectorAll('[role="tab"]')][1] as HTMLButtonElement
    await act(async () => thirty.click())
    expect(mocks.api).toHaveBeenLastCalledWith('/admin/analytics?days=30')
  })

  it('is closed without the permission', async () => {
    mocks.access = { is_owner: false, scopes: [] }
    await open()
    expect(mocks.api).not.toHaveBeenCalled()
    expect(host.textContent).toContain('admin.noAccess')
    mocks.access = { is_owner: false, scopes: ['analytics.view'] }
  })
})
