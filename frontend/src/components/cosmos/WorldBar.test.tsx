import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { HOME_EVENT, WorldBar } from './WorldBar'
import { doorOf } from './worldBarDoors'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
const conversations = vi.hoisted(() => ({ list: [] as Array<{ unread: boolean }> }))
// The server counts over every conversation; here the count is the list's.
vi.mock('../../lib/conversationApi', () => ({
  fetchUnreadCount: vi.fn(async () => conversations.list.filter((c) => c.unread).length),
}))
vi.mock('../../lib/live', () => ({ subscribe: () => () => {} }))

/**
 * The five doors (TECHNICAL_REQUIREMENTS.md section 32): one plain tap to
 * each place, and Sol in the middle always meaning the world.
 */
describe('the bar along the bottom', () => {
  let host: HTMLDivElement
  let root: Root
  let path = ''
  // Reported from an effect, not while rendering: rendering must not
  // change anything outside the component.
  function Where() {
    const { pathname } = useLocation()
    useEffect(() => {
      path = pathname
    }, [pathname])
    return null
  }

  beforeEach(() => {
    conversations.list = []
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  async function open(at: string) {
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[at]}>
          <Routes>
            <Route path="*" element={<><WorldBar /><Where /></>} />
          </Routes>
        </MemoryRouter>,
      ),
    )
  }
  const door = (name: string) => host.querySelector(`.cos-worldbar-door.is-${name}`) as HTMLElement

  it('knows which door each page is behind, and where it is not shown', () => {
    expect(doorOf('/sky')).toBe('world')
    expect(doorOf('/sky/talk')).toBe('talk')
    expect(doorOf('/echo')).toBe('echo')
    expect(doorOf('/events')).toBe('events')
    expect(doorOf('/profile')).toBe('me')
    expect(doorOf('/friends')).toBe('me')
    // A conversation owns the whole screen; somebody else's page is reached
    // from the world, so the world's door is the lit one there.
    expect(doorOf('/conversations/3')).toBeNull()
    expect(doorOf('/profiles/7')).toBe('world')
  })

  it('shows five doors, marking the one you are behind', async () => {
    await open('/echo')
    expect(host.querySelectorAll('.cos-worldbar-door')).toHaveLength(4)
    expect(host.querySelector('.cos-worldbar-sol')).not.toBeNull()
    expect(door('echo').getAttribute('aria-current')).toBe('page')
    expect(door('talk').getAttribute('aria-current')).toBeNull()
  })

  it('goes to each place with one tap', async () => {
    await open('/sky')
    act(() => door('talk').click())
    expect(path).toBe('/sky/talk')
    act(() => door('events').click())
    expect(path).toBe('/events')
    act(() => door('me').click())
    expect(path).toBe('/profile')
  })

  it('takes Sol to the world from anywhere', async () => {
    await open('/events')
    act(() => (host.querySelector('.cos-worldbar-sol') as HTMLElement).click())
    expect(path).toBe('/sky')
  })

  it('in the world, takes Sol as "home" rather than going anywhere', async () => {
    await open('/sky')
    const heard = vi.fn()
    window.addEventListener(HOME_EVENT, heard)
    act(() => (host.querySelector('.cos-worldbar-sol') as HTMLElement).click())
    window.removeEventListener(HOME_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(path).toBe('/sky')
  })

  it('counts the conversations with something unread on their door', async () => {
    conversations.list = [{ unread: true }, { unread: false }, { unread: true }]
    await open('/sky')
    expect(host.querySelector('.cos-worldbar-count')?.textContent).toBe('2')
  })

  it('shows no count when everything is read', async () => {
    conversations.list = [{ unread: false }]
    await open('/sky')
    expect(host.querySelector('.cos-worldbar-count')).toBeNull()
  })
})
