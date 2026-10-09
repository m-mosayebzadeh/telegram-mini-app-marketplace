import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { SupportBand } from './SupportBand'

const api = vi.hoisted(() => ({
  staff: vi.fn(async () => [{ user_id: 5, display_name: 'Ava' }]),
  hand: vi.fn(async () => {}),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }) }))
vi.mock('../../lib/conversationApi', () => ({ fetchSupportStaff: api.staff, handSupport: api.hand }))

const INFO = { holder_name: null, held_by_me: false, handed: false, can_hand: true, language: 'fa', joined_at: null, last_notice: null }

/** The owner hands a conversation to somebody from the app's own menu. */
describe('the support band', () => {
  it('hands the conversation to who is chosen', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const handed = vi.fn()
    await act(async () => root.render(<SupportBand conversationId={9} info={INFO} heldBy={null} onHanded={handed} />))
    expect(host.querySelector('select')).toBeNull() // never the browser's white box
    await act(async () => (host.querySelector('.cos-support-hand') as HTMLButtonElement).click())
    const ava = [...host.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === 'Ava') as HTMLButtonElement
    await act(async () => ava.click())
    expect(api.hand).toHaveBeenCalledWith(9, 5)
    expect(handed).toHaveBeenCalled()
    act(() => root.unmount())
    host.remove()
  })

  it('offers nothing to hand for anyone but the owner', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<SupportBand conversationId={9} info={{ ...INFO, can_hand: false }} heldBy={null} onHanded={() => {}} />))
    expect(host.querySelector('.cos-support-hand')).toBeNull()
    act(() => root.unmount())
  })
})
