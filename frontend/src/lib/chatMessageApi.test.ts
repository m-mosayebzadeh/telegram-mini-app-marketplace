import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// chatMessageApi.ts only ever talks to the backend through these two
// functions — mocking them (instead of global fetch) keeps these tests
// focused on chatMessageApi's own request-shaping/response-mapping
// logic, the same way api.test.ts owns testing apiFetch itself.
vi.mock('./api', () => ({
  apiFetch: vi.fn(),
  apiFetchBlob: vi.fn(),
}))

import { apiFetch, apiFetchBlob } from './api'
import { composeMessage, deliverMessage, listMessages } from './chatMessageApi'
import type { ChatSession } from './types'

const mockApiFetch = vi.mocked(apiFetch)
const mockApiFetchBlob = vi.mocked(apiFetchBlob)

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 7,
    request_id: 1,
    transaction_id: 1,
    status: 'open',
    opened_at: '2026-08-20T10:00:00.000Z',
    closed_at: null,
    closed_by_user_id: null,
    my_role: 'buyer',
    other_participant: { user_id: 2, display_name: 'Sara', username: 'sara', avatar_url: null },
    offer_title: 'Chat with me',
    price_stars: 40,
    display_duration_minutes: 30,
    disputed: false,
    transaction_status: 'pending',
    archived: false,
    ...overrides,
  }
}

describe('chatMessageApi', () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    mockApiFetch.mockReset()
    mockApiFetchBlob.mockReset()
    // jsdom doesn't implement createObjectURL/revokeObjectURL at all —
    // stub both directly on the real URL constructor (rather than
    // replacing the whole global) so resolveMediaUrl() doesn't throw.
    URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  describe('composeMessage', () => {
    it('builds a message in the sending state, from the given sender', () => {
      const session = makeSession()
      const message = composeMessage(session, 1, { type: 'text', text: 'hi there' })

      expect(message.session_id).toBe(session.id)
      expect(message.sender_id).toBe(1)
      expect(message.type).toBe('text')
      expect(message.text).toBe('hi there')
      expect(message.status).toBe('sending')
    })

    it('gives every composed message a unique id, even composed back-to-back', () => {
      const session = makeSession()
      const a = composeMessage(session, 1, { type: 'text', text: 'a' })
      const b = composeMessage(session, 1, { type: 'text', text: 'b' })

      expect(a.id).not.toBe(b.id)
    })

    it('leaves fields irrelevant to the message type null', () => {
      const session = makeSession()
      const voice = composeMessage(session, 1, { type: 'voice', duration_seconds: 12 })

      expect(voice.text).toBeNull()
      expect(voice.media_url).toBeNull()
      expect(voice.duration_seconds).toBe(12)
    })
  })

  describe('listMessages', () => {
    it('fetches the session\'s messages and maps them to ChatMessage, marked as sent', async () => {
      const session = makeSession()
      mockApiFetch.mockResolvedValueOnce([
        {
          id: 101,
          chat_session_id: 7,
          sender_id: 2,
          type: 'text',
          text: 'hello',
          duration_seconds: null,
          created_at: '2026-08-20T10:05:00.000Z',
        },
      ])

      const messages = await listMessages(session, 1)

      expect(mockApiFetch).toHaveBeenCalledWith('/chat-sessions/7/messages')
      expect(messages).toEqual([
        {
          id: '101',
          session_id: 7,
          sender_id: 2,
          type: 'text',
          text: 'hello',
          media_url: null,
          duration_seconds: null,
          status: 'sent',
          created_at: '2026-08-20T10:05:00.000Z',
        },
      ])
      // A text message has no file — never fetched.
      expect(mockApiFetchBlob).not.toHaveBeenCalled()
    })

    it('resolves a photo message\'s media_url via an authenticated blob fetch', async () => {
      const session = makeSession()
      mockApiFetch.mockResolvedValueOnce([
        {
          id: 202,
          chat_session_id: 7,
          sender_id: 2,
          type: 'photo',
          text: null,
          duration_seconds: null,
          created_at: '2026-08-20T10:05:00.000Z',
        },
      ])
      mockApiFetchBlob.mockResolvedValueOnce(new Blob(['fake image bytes']))

      const messages = await listMessages(session, 1)

      expect(mockApiFetchBlob).toHaveBeenCalledWith('/chat-sessions/7/messages/202/file')
      expect(messages[0].media_url).toBe('blob:mock-url')
    })

    it('reuses a cached blob URL instead of re-fetching the same message twice', async () => {
      const session = makeSession()
      const row = {
        id: 303,
        chat_session_id: 7,
        sender_id: 2,
        type: 'photo' as const,
        text: null,
        duration_seconds: null,
        created_at: '2026-08-20T10:05:00.000Z',
      }
      mockApiFetch.mockResolvedValueOnce([row]).mockResolvedValueOnce([row])
      mockApiFetchBlob.mockResolvedValueOnce(new Blob(['fake image bytes']))

      await listMessages(session, 1)
      await listMessages(session, 1) // a second "poll" of the same message

      expect(mockApiFetchBlob).toHaveBeenCalledTimes(1)
    })
  })

  describe('deliverMessage', () => {
    it('posts a text message as form data and resolves with the real server id', async () => {
      const session = makeSession()
      const message = composeMessage(session, 1, { type: 'text', text: 'hello' })
      mockApiFetch.mockResolvedValueOnce({
        id: 55,
        chat_session_id: 7,
        sender_id: 1,
        type: 'text',
        text: 'hello',
        duration_seconds: null,
        created_at: '2026-08-20T10:06:00.000Z',
      })

      const result = await deliverMessage(session, message)

      expect(result.status).toBe('sent')
      expect(result.resolved?.id).toBe('55')
      expect(result.resolved?.status).toBe('sent')

      const [path, options] = mockApiFetch.mock.calls[0]
      expect(path).toBe('/chat-sessions/7/messages')
      expect(options?.method).toBe('POST')
      const body = options?.body as FormData
      expect(body.get('type')).toBe('text')
      expect(body.get('text')).toBe('hello')
    })

    it('uploads the raw file for a photo message', async () => {
      const session = makeSession()
      const file = new File(['bytes'], 'pic.jpg', { type: 'image/jpeg' })
      const message = composeMessage(session, 1, { type: 'photo', media_url: 'blob:local-preview', file })
      mockApiFetch.mockResolvedValueOnce({
        id: 56,
        chat_session_id: 7,
        sender_id: 1,
        type: 'photo',
        text: null,
        duration_seconds: null,
        created_at: '2026-08-20T10:06:00.000Z',
      })

      const result = await deliverMessage(session, message)

      const body = mockApiFetch.mock.calls[0][1]?.body as FormData
      expect(body.get('type')).toBe('photo')
      expect(body.get('file')).toBe(file)
      // The local preview URL carries over rather than being re-fetched.
      expect(result.resolved?.media_url).toBe('blob:local-preview')
    })

    it('resolves to "failed" when the request rejects, without throwing', async () => {
      const session = makeSession()
      const message = composeMessage(session, 1, { type: 'text', text: 'hello' })
      mockApiFetch.mockRejectedValueOnce(new Error('network down'))

      const result = await deliverMessage(session, message)

      expect(result.status).toBe('failed')
      expect(result.resolved).toBeUndefined()
    })

    it('can be retried after a failure, reusing the same original content', async () => {
      const session = makeSession()
      const message = composeMessage(session, 1, { type: 'text', text: 'hello' })
      mockApiFetch.mockRejectedValueOnce(new Error('network down'))
      await deliverMessage(session, message) // first attempt fails

      mockApiFetch.mockResolvedValueOnce({
        id: 57,
        chat_session_id: 7,
        sender_id: 1,
        type: 'text',
        text: 'hello',
        duration_seconds: null,
        created_at: '2026-08-20T10:07:00.000Z',
      })
      const retryResult = await deliverMessage(session, message) // retry, same message id

      expect(retryResult.status).toBe('sent')
      expect(retryResult.resolved?.text).toBe('hello')
    })

    it('fails closed for a message with no pending content (e.g. already delivered)', async () => {
      const session = makeSession()
      const message = composeMessage(session, 1, { type: 'text', text: 'hello' })
      mockApiFetch.mockResolvedValueOnce({
        id: 58,
        chat_session_id: 7,
        sender_id: 1,
        type: 'text',
        text: 'hello',
        duration_seconds: null,
        created_at: '2026-08-20T10:06:00.000Z',
      })
      await deliverMessage(session, message) // delivers successfully, clears pending content

      const result = await deliverMessage(session, message) // called again on the same draft id

      expect(result.status).toBe('failed')
      // No second network call — it failed before ever reaching apiFetch.
      expect(mockApiFetch).toHaveBeenCalledTimes(1)
    })
  })
})
