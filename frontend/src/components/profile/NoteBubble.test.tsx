import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../../lib/api', () => ({ apiFetch: mocks.apiFetch, formatApiError: String }))

import { NoteBubble } from './NoteBubble'

/** The note of the day in place of a bio (section 32, step 4). */
describe('the note of the day', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.apiFetch.mockReset().mockResolvedValue({ note: 'hi' })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('shows nothing on somebody else\'s profile without a note', async () => {
    await act(async () => root.render(<NoteBubble note={null} isOwn={false} onSaved={vi.fn()} />))
    expect(host.textContent).toBe('')
  })

  it('shows their note when there is one', async () => {
    await act(async () => root.render(<NoteBubble note="Up late tonight" isOwn={false} onSaved={vi.fn()} />))
    expect(host.textContent).toBe('Up late tonight')
  })

  it('invites you to write your own, and saves it', async () => {
    const saved = vi.fn()
    await act(async () => root.render(<NoteBubble note={null} isOwn onSaved={saved} />))
    await act(async () => (host.querySelector('.pf-note-own') as HTMLButtonElement).click())
    const input = document.getElementById('note-text') as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Looking for a film')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const post = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('note.save'))!
    await act(async () => post.click())
    expect(mocks.apiFetch).toHaveBeenCalledWith('/profile/me/note', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ text: 'Looking for a film' }) }))
    expect(saved).toHaveBeenCalled()
  })
})
