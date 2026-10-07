import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BlockedPeople from './BlockedPeople'

const mocks = vi.hoisted(() => ({ fetchBlocked: vi.fn(), unblockPerson: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, v?: Record<string, string>) => (v?.date ? `${key}:${v.date}` : key), i18n: { language: 'en' } }),
}))
vi.mock('../lib/accountApi', () => ({ fetchBlocked: mocks.fetchBlocked, unblockPerson: mocks.unblockPerson }))
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

/** The people you blocked (section 42, drawn as the approved prototype). */
describe('blocked people', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.fetchBlocked.mockReset().mockResolvedValue([
      { user_id: 2, display_name: 'Ramin', username: null, avatar_url: null, blocked_at: '2026-09-25T10:00:00Z' },
    ])
    mocks.unblockPerson.mockReset().mockResolvedValue(undefined)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })
  const open = async () => act(async () => root.render(<MemoryRouter><BlockedPeople /></MemoryRouter>))

  it('lists each with since when, and empties into a far, soft body', async () => {
    await open()
    const row = host.querySelector('.cos-q-person')!
    expect(row.textContent).toContain('Ramin')
    expect(row.textContent).toContain('blocked.since:September 25')
    await act(async () => row.querySelector('button')!.click())
    expect(mocks.unblockPerson).toHaveBeenCalledWith(2)
    expect(host.querySelector('.cos-q-person')).toBeNull()
    expect(host.querySelector('.cos-q-far')).not.toBeNull()
    expect(host.textContent).toContain('blocked.empty')
  })
})
