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
  /** Everything listening on the live connection. More than one part of
   *  the screen listens (the thread, and what is going on with the person
   *  besides talking), as with the real connection. */
  listeners: new Set<(event: unknown) => void>(),
  /** Push an event to every listener, as the real connection does. */
  live: null as null | ((event: unknown) => void),
}))
mocks.live = (event) => mocks.listeners.forEach((listener) => listener(event))
// The paid session inside a conversation is hidden in this version
// (lib/paidLayer.ts), but its band is kept working for when it returns:
// these tests run with the paid layer switched on.
vi.mock('../lib/paidLayer', () => ({ PAID_LAYER: true }))
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
vi.mock('../lib/live', () => ({
  subscribe: (listener: (event: unknown) => void) => {
    mocks.listeners.add(listener)
    return () => mocks.listeners.delete(listener)
  },
  sayTyping: vi.fn(),
  doneTyping: vi.fn(),
  TYPING_SHOWN_MS: 5000,
}))
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

/**
 * Doing things to a message: a tap opens its menu, a held finger starts
 * selecting, and "also delete for Sara" is offered only for your own
 * messages, since anybody else's can only ever leave your own view.
 */
describe('doing things to a message', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    mocks.api.mockReset()
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
    await act(async () => {})
    await act(async () => {})
  }

  function row(index: number) {
    return host.querySelectorAll('.cos-talk-row')[index] as HTMLElement
  }

  async function press(target: HTMLElement, holdFor = 0) {
    await act(async () => {
      target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    })
    if (holdFor) await act(() => new Promise((done) => setTimeout(done, holdFor)))
    await act(async () => {
      target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }))
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    })
  }

  it('opens the menu on a tap', async () => {
    await open([message(1, SARA, 'hi')])
    await press(row(0).querySelector('.cos-bubble') as HTMLElement)
    const actions = [...document.querySelectorAll('.cos-menu-action')].map((a) => a.textContent)
    expect(actions).toEqual(['talk.actions.reply', 'talk.actions.copy', 'talk.actions.delete'])
  })

  it('offers edit only on your own text', async () => {
    await open([message(1, ME, 'mine')])
    await press(row(0).querySelector('.cos-bubble') as HTMLElement)
    const actions = [...document.querySelectorAll('.cos-menu-action')].map((a) => a.textContent)
    expect(actions).toContain('talk.actions.edit')
  })

  it('never offers forward or pin', async () => {
    await open([message(1, ME, 'mine')])
    await press(row(0).querySelector('.cos-bubble') as HTMLElement)
    const text = document.querySelector('.cos-menu')?.textContent ?? ''
    expect(text).not.toMatch(/forward|pin/i)
  })

  it('starts selecting after half a second of holding', async () => {
    await open([message(1, SARA, 'a'), message(2, SARA, 'b')])
    await press(row(0), 550)
    expect(row(0).classList.contains('is-selected')).toBe(true)
    expect(host.querySelector('.cos-select-count')?.textContent).toBe('talk.selected')
    // While selecting, a tap picks another rather than opening a menu.
    await press(row(1))
    expect(row(1).classList.contains('is-selected')).toBe(true)
    expect(document.querySelector('.cos-menu')).toBeNull()
  })

  it('asks "also for Sara" only for your own messages', async () => {
    await open([message(1, ME, 'mine'), message(2, SARA, 'theirs')])

    await press(row(0).querySelector('.cos-bubble') as HTMLElement)
    await act(async () => {
      ;(document.querySelector('.cos-menu-action.is-danger') as HTMLButtonElement).click()
    })
    expect(document.querySelector('.cos-delete-also')).not.toBeNull()
    await act(async () => {
      ;(document.querySelector('.ui-scrim') as HTMLElement).click()
    })

    await press(row(1).querySelector('.cos-bubble') as HTMLElement)
    await act(async () => {
      ;(document.querySelector('.cos-menu-action.is-danger') as HTMLButtonElement).click()
    })
    expect(document.querySelector('.cos-delete-also')).toBeNull()
  })
})

describe('on a computer', () => {
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
      if (path === '/conversations/10/messages') return Promise.resolve([message(1, SARA, 'hi')])
      return Promise.resolve(undefined)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  function mouse(type: string, button = 0) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    return event
  }

  it('leaves a left click alone, so text can be selected', async () => {
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
    const bubble = host.querySelector('.cos-bubble') as HTMLElement

    await act(async () => {
      bubble.dispatchEvent(mouse('pointerdown'))
      bubble.dispatchEvent(mouse('pointerup'))
      bubble.dispatchEvent(mouse('click'))
    })
    expect(document.querySelector('.cos-menu')).toBeNull()

    await act(async () => {
      bubble.dispatchEvent(mouse('contextmenu', 2))
    })
    expect(document.querySelector('.cos-menu')).not.toBeNull()
  })
})

describe('typing', () => {
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

  it('shows "typing" under the name, and drops it when their message arrives', async () => {
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

    await act(async () => {
      mocks.live?.({ type: 'typing', conversation_id: 10, user_id: SARA })
    })
    expect(host.querySelector('.cos-talk-typing')?.textContent).toBe('talk.typing')

    await act(async () => {
      mocks.live?.({ type: 'message', conversation_id: 10, message: message(5, SARA, 'hey') })
    })
    expect(host.querySelector('.cos-talk-typing')).toBeNull()
  })

  it('ignores typing from another conversation', async () => {
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
    await act(async () => {
      mocks.live?.({ type: 'typing', conversation_id: 99, user_id: SARA })
    })
    expect(host.querySelector('.cos-talk-typing')).toBeNull()
  })
})

/**
 * A paid session is a stretch of the one conversation (section 30.9): its
 * messages are marked where they begin and end, and a thank-you stays at
 * the end of them like a reaction, for as long as the conversation does.
 */
describe('a paid session inside the conversation', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    mocks.api.mockReset()
    mocks.blob.mockReset()
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  const inSession = (id: number, sender: number, text: string): ConversationMessage => ({
    ...message(id, sender, text),
    chat_session_id: 7,
  })

  async function open(messages: ConversationMessage[], session: Record<string, unknown>) {
    mocks.api.mockImplementation((path: string) => {
      if (path === '/conversations/10') return Promise.resolve(thread())
      if (path === '/conversations/10/messages') return Promise.resolve(messages)
      if (path === '/chat-sessions/mine') return Promise.resolve([session])
      if (path === '/requests/activity') return Promise.resolve([])
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
    for (let i = 0; i < 4; i += 1) await act(async () => {})
  }

  const session = {
    id: 7, request_id: 1, status: 'closed', my_role: 'buyer', offer_title: 'Books',
    other_participant: { user_id: SARA, display_name: 'Sara', username: null, avatar_url: null },
    transaction_status: 'succeeded', thanks_reaction: 'heart', consumed_blocks: 2, reserved_blocks: 2,
    block_price_photons: 60, closed_at: '2026-09-20T11:00:00Z', disputed: false,
  }

  it('holds the session in a warm band, with how it ended and its thank-you at the foot', async () => {
    await open([message(1, SARA, 'hi'), inSession(2, ME, 'q'), inSession(3, SARA, 'a'), message(4, ME, 'thanks!')], session)
    const band = host.querySelector('.cos-talk-session')!
    // Only the session's own messages are inside it.
    expect(band.querySelectorAll('.cos-talk-row')).toHaveLength(2)
    expect(band.querySelector('.cos-talk-session-head')?.textContent).toContain('deal.bandHead.done')
    expect(band.querySelector('.cos-talk-session-foot')?.textContent).toContain('deal.bandFoot.paid')
    expect(band.querySelector('.cos-deal-keepsake')?.getAttribute('aria-label')).toBe('deal.thanked')
  })

  it('leaves a session still running open-ended', async () => {
    await open([inSession(2, ME, 'q')], { ...session, status: 'open', thanks_reaction: null })
    const band = host.querySelector('.cos-talk-session')!
    expect(band.classList.contains('is-running')).toBe(true)
    expect(band.querySelector('.cos-talk-session-foot')).toBeNull()
  })
})

/**
 * Answering somebody's note of the day (section 32): the conversation opens
 * with the note in the bar above the box, the first message carries it,
 * and a message that answered a note shows it quoted.
 */
describe('answering a note of the day', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    mocks.api.mockReset()
    Element.prototype.scrollIntoView = vi.fn()
    window.matchMedia = ((query: string) => ({ matches: true, media: query })) as unknown as typeof window.matchMedia
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function open(messages: ConversationMessage[], state?: unknown) {
    mocks.api.mockImplementation((path: string, options?: { method?: string; body?: FormData }) => {
      if (path === '/conversations/10' && !options) return Promise.resolve(thread())
      if (path === '/conversations/10/messages' && !options) return Promise.resolve(messages)
      if (path === '/conversations/10/messages' && options?.method === 'POST') {
        const body = options.body as FormData
        return Promise.resolve({
          ...message(50, ME, String(body.get('text'))),
          client_id: String(body.get('client_id')),
          note_quote: body.get('to_note') ? 'anyone for a walk?' : null,
        })
      }
      return Promise.resolve(undefined)
    })
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[{ pathname: '/conversations/10', state }]}>
          <Routes>
            <Route path="/conversations/:id" element={<Conversation />} />
          </Routes>
        </MemoryRouter>,
      )
    })
    await act(async () => {})
    await act(async () => {})
  }

  it('opens with the note above the box, and the first message answers it', async () => {
    await open([], { noteReply: { note: 'anyone for a walk?' } })
    expect(host.querySelector('.cos-talk-context')?.textContent).toContain('anyone for a walk?')
    const field = host.querySelector('.cos-talk-field') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(field, 'me!')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => {})
    const sent = mocks.api.mock.calls.find(([path, options]) => path === '/conversations/10/messages' && options?.method === 'POST')
    expect((sent![1]!.body as FormData).get('to_note')).toBe('true')
    // Only the first message answers it.
    expect(host.querySelector('.cos-talk-context')).toBeNull()
  })

  it('can let the note go, like a reply', async () => {
    await open([], { noteReply: { note: 'anyone for a walk?' } })
    await act(async () => (host.querySelector('.cos-talk-context .cos-talk-tool') as HTMLElement).click())
    expect(host.querySelector('.cos-talk-context')).toBeNull()
  })

  it('shows the note a message answered, quoted above it', async () => {
    await open([{ ...message(1, SARA, 'me!'), note_quote: 'anyone for a walk?' }])
    const quote = host.querySelector('.cos-bubble-quote.is-note')
    expect(quote?.textContent).toContain('talk.aboutNote')
    expect(quote?.textContent).toContain('anyone for a walk?')
  })
})
