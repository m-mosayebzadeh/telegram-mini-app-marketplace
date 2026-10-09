import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listeners: new Set<(event: { type: string }) => void>(),
  access: vi.fn(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  apiFetch: vi.fn().mockResolvedValue({ id: 1, language: 'fa' }),
}))
vi.mock('./adminApi', () => ({ getMyAdminAccess: mocks.access }))
vi.mock('./live', () => ({
  subscribe: (fn: (event: { type: string }) => void) => {
    mocks.listeners.add(fn)
    return () => mocks.listeners.delete(fn)
  },
}))
vi.mock('./languageSync', () => ({ keepServerLanguage: () => undefined }))

import { MeProvider, useMe } from './MeContext'

/** A role given or taken away reaches the screen at once (section 43). */
describe('admin access', () => {
  it('is read again when the server says it changed', async () => {
    mocks.access.mockResolvedValueOnce({ is_owner: false, scopes: ['support.conversations'] })
    mocks.access.mockResolvedValueOnce({ is_owner: false, scopes: [] })
    const seen: (string[] | undefined)[] = []
    function Probe() {
      seen.push(useMe().adminAccess?.scopes)
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<MeProvider><Probe /></MeProvider>))
    expect(seen[seen.length - 1]).toEqual(['support.conversations'])
    await act(async () => mocks.listeners.forEach((fn) => fn({ type: 'access' })))
    expect(seen[seen.length - 1]).toEqual([])
    act(() => root.unmount())
  })
})
