import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const mocks = vi.hoisted(() => ({
  fetchPrivacy: vi.fn(),
  savePrivacy: vi.fn(),
  deleteAccount: vi.fn(),
  markDeleted: vi.fn(),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', changeLanguage: vi.fn() } }),
}))
vi.mock('../lib/accountApi', () => ({
  fetchPrivacy: mocks.fetchPrivacy,
  savePrivacy: mocks.savePrivacy,
  deleteAccount: mocks.deleteAccount,
}))
vi.mock('../lib/MeContext', () => ({
  useMe: () => ({ me: { pending_follow_requests_count: 0 }, markDeleted: mocks.markDeleted }),
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
    mocks.markDeleted.mockReset()
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
  const button = (label: string) =>
    [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement

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
