import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), conversations: vi.fn() }))
vi.mock('./api', () => ({ apiFetch: mocks.apiFetch }))
vi.mock('./conversationApi', () => ({ fetchConversations: mocks.conversations }))
vi.mock('./live', () => ({ subscribe: () => () => {} }))
vi.mock('./onReturn', () => ({ onReturn: () => () => {} }))

import { useDeal, useWorld } from './worldApi'

/**
 * While the paid layer is off (lib/paidLayer.ts, section 32), the world and
 * the conversation screen ask only for conversations: no requests, no
 * sessions, and no follow requests (friendship replaced following).
 */
describe('what the world asks the server for', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.apiFetch.mockReset().mockResolvedValue([])
    mocks.conversations.mockReset().mockResolvedValue([])
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('asks the world for conversations only', async () => {
    function World() {
      useWorld()
      return null
    }
    await act(async () => root.render(<World />))
    expect(mocks.conversations).toHaveBeenCalledTimes(1)
    expect(mocks.apiFetch).not.toHaveBeenCalled()
  })

  it('asks nothing about a deal inside a conversation', async () => {
    function Deal() {
      useDeal(7)
      return null
    }
    await act(async () => root.render(<Deal />))
    expect(mocks.apiFetch).not.toHaveBeenCalled()
  })
})
