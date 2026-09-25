import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import Conversation from './Conversation'
import type { Conversation as Thread, ConversationMessage } from '../lib/conversationApi'

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  blob: vi.fn(),
  t: (key: string) => key,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t, i18n: { language: 'fa' } }),
}))
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof import('../lib/api')>()),
  apiFetch: mocks.api,
  apiFetchBlob: mocks.blob,
}))
// The live connection is exercised on its own (lib/thread.test.ts); here
// it only has to stay out of the way.
vi.mock('../lib/live', () => ({ subscribe: () => () => {} }))
vi.mock('../lib/MeContext', () => ({
  useMe: () => ({ me: { id: 1 } }),
}))

const ME = 1
const SARA = 2

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 10,
    kind: 'direct',
    created_at: '2026-09-20T10:00:00Z',
    last_message_at: null,
    others: [{ user_id: SARA, display_name: 'Sara', username: null, avatar_url: null }],
    capabilities: ['text', 'sticker', 'voice', 'photo'],
    active_session_id: null,
    archived: false,
    unread: false,
    last_text: null,
    others_read_at: null,
    ...overrides,
  }
}

function message(id: number, sender: number, text: string, flagged = false): ConversationMessage {
  return {
    id,
    conversation_id: 10,
    chat_session_id: null,
    sender_id: sender,
    type: 'text',
    text,
    duration_seconds: null,
    created_at: '2026-09-20T10:00:00Z',
    flagged_payment: flagged,
    client_id: null,
  }
}

/**
 * The warning under a card number, from the point of view of the two
 * people in the conversation.
 *
 * It is written to protect, not to accuse — two friends settling a bill
 * are doing nothing wrong — and it has to be seen by the person being
 * asked to pay, because that is usually the one who gets hurt.
 */
describe('a conversation where a card number was sent', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    mocks.api.mockReset()
    mocks.blob.mockReset()
    // jsdom has no layout, so the scroll-to-bottom call has nothing to do.
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function open(messages: ConversationMessage[]) {
    mocks.api.mockImplementation((path: string) => {
      if (path === '/conversations/10') return Promise.resolve(thread())
      if (path === '/conversations/10/messages') return Promise.resolve(messages)
      return Promise.resolve(undefined)
    })
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/conversations/10']}>
          <Routes>
            <Route path="/conversations/:id" element={<Conversation />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    // Two rounds: the thread, then its messages.
    await act(async () => {})
    await act(async () => {})
  }

  it('shows nothing when no payment detail was sent', async () => {
    await open([message(1, SARA, 'سلام')])
    expect(host.querySelector('.cos-talk-warning')).toBeNull()
  })

  it('shows the warning under the message that carried it', async () => {
    await open([message(1, SARA, 'سلام'), message(2, SARA, '6037991234567893', true)])
    const rows = host.querySelectorAll('.cos-talk-row')
    expect(rows[0].querySelector('.cos-talk-warning')).toBeNull()
    expect(rows[1].querySelector('.cos-talk-warning')).not.toBeNull()
  })

  it('shows it once, not under every such message', async () => {
    // A warning that repeats stops being read, and the second copy is what
    // teaches people to ignore the first.
    await open([
      message(1, SARA, '6037991234567893', true),
      message(2, SARA, 'بریز دیگه', false),
      message(3, SARA, '6037991234567893', true),
    ])
    expect(host.querySelectorAll('.cos-talk-warning').length).toBe(1)
  })

  it('offers the person being asked a way to report it', async () => {
    await open([message(1, SARA, '6037991234567893', true)])
    expect(host.querySelector('.cos-talk-warning-report')).not.toBeNull()
  })

  it('warns the sender too, but does not ask them to report themselves', async () => {
    await open([message(1, ME, '6037991234567893', true)])
    expect(host.querySelector('.cos-talk-warning')).not.toBeNull()
    expect(host.querySelector('.cos-talk-warning-report')).toBeNull()
  })

  it('opens the report with the right reason already chosen', async () => {
    // Somebody pressing for payment outside the app is exactly who should
    // be reported, so that is what is selected when the sheet opens.
    await open([message(1, SARA, '6037991234567893', true)])
    await act(async () => {
      ;(host.querySelector('.cos-talk-warning-report') as HTMLButtonElement).click()
    })
    const chosen = document.querySelector('.cos-report-reason.is-on')
    expect(chosen?.textContent).toBe('report.reasons.off_app_payment')
  })
})

describe('writing a message', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    mocks.api.mockReset()
    Element.prototype.scrollIntoView = vi.fn()
    mocks.api.mockImplementation((path: string) => {
      if (path === '/conversations/10') return Promise.resolve(thread())
      if (path === '/conversations/10/messages') return Promise.resolve([])
      return Promise.resolve(undefined)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function openEmpty() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/conversations/10']}>
          <Routes>
            <Route path="/conversations/:id" element={<Conversation />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    await act(async () => {})
    await act(async () => {})
    return host.querySelector('.cos-talk-field') as HTMLTextAreaElement
  }

  /** Pretend to be a computer (a precise pointer that hovers) or a phone. */
  function onDevice(kind: 'computer' | 'phone') {
    window.matchMedia = ((query: string) => ({
      matches: kind === 'computer',
      media: query,
    })) as unknown as typeof window.matchMedia
  }

  /** Types into the box the way React sees typing: through the native
   *  value setter, then an input event. */
  async function type(field: HTMLTextAreaElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(field, text)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function press(field: HTMLTextAreaElement, shiftKey = false) {
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true }))
    })
  }

  function sends() {
    return mocks.api.mock.calls.filter(
      ([path, options]) => path === '/conversations/10/messages' && options?.method === 'POST',
    )
  }

  it('sends on Enter at a computer', async () => {
    onDevice('computer')
    const field = await openEmpty()
    await type(field, 'سلام')
    await press(field)
    expect(sends()).toHaveLength(1)
  })

  it('keeps Shift+Enter for a new line at a computer', async () => {
    onDevice('computer')
    const field = await openEmpty()
    await type(field, 'سلام')
    await press(field, true)
    expect(sends()).toHaveLength(0)
  })

  it('treats Enter as a new line on a phone', async () => {
    // A phone keyboard has no Shift+Enter, so if Enter sent there would be
    // no way at all to write a second line.
    onDevice('phone')
    const field = await openEmpty()
    await type(field, 'سلام')
    await press(field)
    expect(sends()).toHaveLength(0)
  })

  it('offers the microphone whenever voice is allowed', async () => {
    // Hidden, a missing microphone reads as a missing feature. Shown, it
    // can at least say why it cannot record.
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/conversations/10']}>
          <Routes>
            <Route path="/conversations/:id" element={<Conversation />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    await act(async () => {})
    await act(async () => {})
    const send = host.querySelector('.cos-talk-send') as HTMLButtonElement
    expect(send.getAttribute('aria-label')).toBe('talk.voice')
  })
})
