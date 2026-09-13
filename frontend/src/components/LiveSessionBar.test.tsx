import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { LiveSessionBar } from './LiveSessionBar'

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

const liveSession = {
  id: 7,
  other_participant: { user_id: 2, display_name: 'Mahtab', username: null, avatar_url: null },
  started_at: '2026-09-13T10:00:00Z',
  ends_at: new Date(Date.now() + 12 * 60_000).toISOString(),
}

let root: Root
let container: HTMLDivElement

async function render(path = '/wallet') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <LiveSessionBar />
      </MemoryRouter>,
    )
  })
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

describe('the live session bar', () => {
  it('shows nothing when no session is running', async () => {
    mocks.api.mockResolvedValue(null)

    await render()

    expect(container.querySelector('.lv-bar')).toBeNull()
  })

  it('names who you are talking to and how long is left', async () => {
    mocks.api.mockResolvedValue(liveSession)

    await render()

    expect(container.textContent).toContain('Mahtab')
    expect(container.textContent).toContain('liveSession.minutesLeft')
  })

  it('says it is still waiting when the provider has not arrived', async () => {
    mocks.api.mockResolvedValue({ ...liveSession, started_at: null, ends_at: null })

    await render()

    expect(container.textContent).toContain('liveSession.waitingToStart')
  })

  it('takes one tap to get back into the conversation', async () => {
    mocks.api.mockResolvedValue(liveSession)
    await render()

    await act(async () => container.querySelector<HTMLButtonElement>('.lv-bar')!.click())

    expect(mocks.navigate).toHaveBeenCalledWith('/chat-sessions/7')
  })

  it('hides itself on the chat screen, where it would be pointless', async () => {
    mocks.api.mockResolvedValue(liveSession)

    await render('/chat-sessions/7')

    expect(container.querySelector('.lv-bar')).toBeNull()
    // It does not even ask: you are already there.
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('stays out of the way when it cannot load', async () => {
    // A bar that fails must never take the screen it sits on down with it.
    mocks.api.mockRejectedValue(new Error('offline'))

    await render()

    expect(container.querySelector('.lv-bar')).toBeNull()
  })
})
