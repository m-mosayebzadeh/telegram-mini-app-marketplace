import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('./api', () => ({ apiFetch: mocks.apiFetch }))

import i18n from '../i18n/config' // sets up the instance languageSync listens to
import { keepServerLanguage } from './languageSync'

/** The server learns the app's language once, and again on a change (section 37). */
describe('telling the server the language', () => {
  afterEach(async () => {
    mocks.apiFetch.mockReset()
    await i18n.changeLanguage('fa')
  })

  it('says nothing when the server already knows it', async () => {
    mocks.apiFetch.mockResolvedValue(undefined)
    await i18n.changeLanguage('fa')
    const stop = keepServerLanguage('fa')
    expect(mocks.apiFetch).not.toHaveBeenCalled()
    stop()
  })

  it('says it once when it differs, and again when the language changes', async () => {
    mocks.apiFetch.mockResolvedValue(undefined)
    await i18n.changeLanguage('fa')
    const stop = keepServerLanguage(null)
    expect(mocks.apiFetch).toHaveBeenCalledWith('/me/language', { method: 'PUT', body: JSON.stringify({ language: 'fa' }) })
    await i18n.changeLanguage('en')
    expect(mocks.apiFetch).toHaveBeenLastCalledWith('/me/language', { method: 'PUT', body: JSON.stringify({ language: 'en' }) })
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2)
    stop()
    await i18n.changeLanguage('fa')
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2) // stopped listening
  })
})
