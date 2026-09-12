import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Chats from './Chats'
import { ToastProvider } from '../components/ui'
import type { ChatSession } from '../lib/types'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
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
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 1,
    request_id: 10,
    transaction_id: 100,
    status: 'open',
    opened_at: '2026-01-01T00:00:00Z',
    closed_at: null,
    closed_by_user_id: null,
    my_role: 'buyer',
    other_participant: {
      user_id: 3,
      display_name: 'Alice',
      username: 'alice',
      avatar_url: null,
    },
    offer_title: 'Chat with me',
    price_stars: 250,
    display_duration_minutes: 30,
    disputed: false,
    transaction_status: 'succeeded',
    archived: false,
    ...overrides,
  } as ChatSession
}

let root: Root
let container: HTMLDivElement

async function render() {
  await act(async () => {
    root.render(
      <ToastProvider>
        <MemoryRouter>
          <Chats />
        </MemoryRouter>
      </ToastProvider>,
    )
  })
}

function names() {
  return [...container.querySelectorAll('.ui-row-title')].map((el) => el.textContent?.trim())
}

function buttonWith(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (el) => el.textContent?.trim() === label,
  )
}

function rowWith(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('.ui-row')].find(
    (el) => el.querySelector('.ui-row-title')?.textContent?.trim() === label,
  )
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mocks.api.mockReset()
  mocks.navigate.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('Chats', () => {
  it('opens on active chats, newest first', async () => {
    mocks.api.mockResolvedValue([
      session({ id: 1, opened_at: '2026-01-01T00:00:00Z' }),
      session({
        id: 2,
        opened_at: '2026-03-01T00:00:00Z',
        other_participant: { user_id: 4, display_name: 'Bob', username: null, avatar_url: null },
      }),
    ])

    await render()

    expect(names()).toEqual(['Bob', 'Alice'])
  })

  it('keeps archived chats out of the active list, and vice versa', async () => {
    mocks.api.mockResolvedValue([
      session({ id: 1 }),
      session({
        id: 2,
        archived: true,
        other_participant: { user_id: 4, display_name: 'Bob', username: null, avatar_url: null },
      }),
    ])
    await render()
    expect(names()).toEqual(['Alice'])

    await act(async () => buttonWith('chatsPage.archivedTab')!.click())

    expect(names()).toEqual(['Bob'])
  })

  it('counts only open, unarchived chats on the active segment', async () => {
    mocks.api.mockResolvedValue([
      session({ id: 1, status: 'open' }),
      session({ id: 2, status: 'closed' }),
      session({ id: 3, status: 'open', archived: true }),
    ])

    await render()

    expect(container.querySelector('.ui-segments .ui-badge')?.textContent).toBe('1')
  })

  it('marks a disputed chat as disputed rather than open', async () => {
    mocks.api.mockResolvedValue([session({ disputed: true, status: 'open' })])

    await render()

    expect(container.querySelector('.ui-status')?.textContent).toBe('chatSession.statusDisputed')
  })

  it('archives from the overflow sheet, and says what archiving does', async () => {
    mocks.api.mockResolvedValue([session()])
    await render()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ch-manage')!.click()
    })
    const row = rowWith('chatsPage.archiveButton')
    expect(row?.textContent).toContain('chatsPage.archiveHint')

    await act(async () => row!.click())

    expect(mocks.api).toHaveBeenCalledWith('/chat-sessions/1/archive', { method: 'POST' })
  })

  it('points an empty active list at the showcase', async () => {
    mocks.api.mockResolvedValue([])
    await render()

    await act(async () => buttonWith('activityPage.browseShowcase')!.click())

    expect(mocks.navigate).toHaveBeenCalledWith('/offers')
  })

  it('offers a retry instead of replacing the tab when loading fails', async () => {
    mocks.api.mockRejectedValue(new Error('offline'))
    await render()

    // The segments are still there — the page is not a dead end.
    expect(container.querySelector('.ui-segments')).toBeTruthy()

    mocks.api.mockResolvedValue([session()])
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.ui-state-action button')!.click()
    })

    expect(names()).toEqual(['Alice'])
  })
})
