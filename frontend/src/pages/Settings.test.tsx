import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const mocks = vi.hoisted(() => ({
  fetchPrivacy: vi.fn(),
  savePrivacy: vi.fn(),
  deleteAccount: vi.fn(),
  fetchBlocked: vi.fn(),
  markDeleted: vi.fn(),
  pushState: vi.fn(),
  setPushPreview: vi.fn(),
  refreshMe: vi.fn(),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}))
vi.mock('../lib/accountApi', () => ({
  fetchPrivacy: mocks.fetchPrivacy,
  savePrivacy: mocks.savePrivacy,
  deleteAccount: mocks.deleteAccount,
  fetchBlocked: mocks.fetchBlocked,
}))
vi.mock('../lib/friendsApi', () => ({ fetchFriendsViewers: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/MeContext', () => ({
  useMe: () => ({ me: { display_name: 'Mina', avatar_url: null, push_preview: false }, markDeleted: mocks.markDeleted, refreshMe: mocks.refreshMe }),
}))
vi.mock('../lib/push', () => ({
  pushState: mocks.pushState,
  setPushPreview: mocks.setPushPreview,
  turnPushOn: vi.fn(),
  turnPushOff: vi.fn(),
}))
vi.mock('../lib/auth', () => ({ signOut: vi.fn() }))
vi.mock('../components/ui', async (original) => ({
  ...(await original<typeof import('../components/ui')>()),
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

/** Settings for "me" (section 32, step 4). */
describe('settings', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.fetchPrivacy.mockReset().mockResolvedValue({ chat_door: 'open', hide_online: false })
    mocks.savePrivacy.mockReset().mockImplementation(async (p) => p)
    mocks.deleteAccount.mockReset().mockResolvedValue(undefined)
    mocks.fetchBlocked.mockReset().mockResolvedValue([])
    mocks.markDeleted.mockReset()
    mocks.pushState.mockReset().mockResolvedValue('unsupported')
    mocks.setPushPreview.mockReset().mockResolvedValue(undefined)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    localStorage.clear()
    document.documentElement.classList.remove('cos-lite')
  })

  async function open() {
    await act(async () => root.render(<MemoryRouter><Settings /></MemoryRouter>))
  }
  // A switch is named by its row's title rather than holding the words.
  const button = (label: string) =>
    [...document.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').includes(label) || b.getAttribute('aria-label') === label,
    ) as HTMLButtonElement

  it('has no theme choice and no wallet any more', async () => {
    await open()
    expect(host.textContent).not.toContain('profilePage.themeLabel')
    expect(host.textContent).not.toContain('wallet.title')
  })

  it('starts at the freest privacy, and saves a change at once', async () => {
    await open()
    expect(button('settings.doorOpen').getAttribute('aria-pressed')).toBe('true')
    await act(async () => button('settings.doorFriends').click())
    expect(mocks.savePrivacy).toHaveBeenCalledWith({ chat_door: 'friends', hide_online: false })
    await act(async () => button('settings.hideOnline').click())
    expect(mocks.savePrivacy).toHaveBeenLastCalledWith({ chat_door: 'friends', hide_online: true })
  })

  it('offers to show message text only once notifications are on, off at first', async () => {
    await open()
    expect(host.textContent).not.toContain('push.preview.title')
    act(() => root.unmount())
    root = createRoot(host)
    mocks.pushState.mockResolvedValue('on')
    await open()
    await act(async () => {})
    const row = button('push.preview.title')
    expect(row.getAttribute('aria-checked')).toBe('false')
    expect(row.closest('.cos-q-row')!.textContent).toContain('push.preview.off')
    await act(async () => row.click())
    expect(mocks.setPushPreview).toHaveBeenCalledWith(true)
    expect(button('push.preview.title').getAttribute('aria-checked')).toBe('true')
  })

  it('shows you as others see you, and the settings change it as they are tapped', async () => {
    await open()
    const mini = host.querySelector('.cos-q-mini')!
    expect(mini.classList.contains('is-hidden')).toBe(false)
    expect(host.querySelector('.cos-q-seen')!.textContent).toContain('settings.seenOnline')
    expect(host.querySelector('.cos-q-seen')!.textContent).toContain('settings.seenAll')
    await act(async () => button('settings.hideOnline').click())
    // The ring, the world's sign of "here now", goes.
    expect(mini.classList.contains('is-hidden')).toBe(true)
    expect(host.querySelector('.cos-q-seen')!.textContent).toContain('settings.seenHidden')
    await act(async () => button('settings.doorFriends').click())
    expect(host.querySelector('.cos-q-seen')!.textContent).toContain('settings.seenFriends')
  })

  it('says how many people are blocked', async () => {
    mocks.fetchBlocked.mockResolvedValue([{ user_id: 1 }, { user_id: 2 }])
    await open()
    expect(button('settings.blocked').textContent).toContain('settings.people')
  })

  it('turns light graphics on for this phone', async () => {
    await open()
    await act(async () => button('settings.lite').click())
    expect(document.documentElement.classList.contains('cos-lite')).toBe(true)
    expect(localStorage.getItem('cos-light-graphics')).toBe('1')
  })

  it('asks twice before deleting the account', async () => {
    await open()
    await act(async () => button('settings.delete').click())
    expect(document.body.textContent).toContain('settings.deleteText')
    await act(async () => button('settings.deleteNext').click())
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('settings.deleteSureText')
    await act(async () => button('settings.deleteConfirm').click())
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
    expect(mocks.markDeleted).toHaveBeenCalled()
  })
})
