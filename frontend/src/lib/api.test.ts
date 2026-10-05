import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiFetch } from './api'
import { checkSignedIn, SIGNED_OUT_EVENT } from './auth'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Requests are known by the sign-in session's cookie, which the browser
 * sends by itself (TECHNICAL_REQUIREMENTS.md section 32): the app never
 * attaches who it is, and a request refused as "signed out" sends the
 * person to the sign-in page.
 */
describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attaches nothing about who is asking: the cookie travels by itself', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }))
    expect(await apiFetch<{ ok: boolean }>('/me')).toEqual({ ok: true })
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/me')
    expect((options!.headers as Record<string, string>)['X-Telegram-Init-Data']).toBeUndefined()
  })

  it('throws ApiError with the parsed body on a non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: 'nope' }, 400))
    await expect(apiFetch('/me')).rejects.toMatchObject({ status: 400, body: { detail: 'nope' } })
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: 'nope' }, 400))
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiError)
  })

  it('sends the person to the sign-in page when the session is gone', async () => {
    const heard = vi.fn()
    window.addEventListener(SIGNED_OUT_EVENT, heard)
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: { reason: 'signed_out' } }, 401))
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiError)
    window.removeEventListener(SIGNED_OUT_EVENT, heard)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('does not treat other refusals as signed out', async () => {
    const heard = vi.fn()
    window.addEventListener(SIGNED_OUT_EVENT, heard)
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: { reason: 'not_allowed' } }, 403))
    await expect(apiFetch('/me')).rejects.toBeInstanceOf(ApiError)
    window.removeEventListener(SIGNED_OUT_EVENT, heard)
    expect(heard).not.toHaveBeenCalled()
  })

  it('does not set Content-Type on a FormData body, leaving the browser to add its own boundary', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }))
    await apiFetch('/upload', { method: 'POST', body: new FormData() })
    const options = vi.mocked(fetch).mock.calls[0][1]
    expect((options!.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('sets Content-Type: application/json on a plain object body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }))
    await apiFetch('/thing', { method: 'POST', body: JSON.stringify({ a: 1 }) })
    const options = vi.mocked(fetch).mock.calls[0][1]
    expect((options!.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})

describe('checking whether this device is signed in', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is signed in when the server knows the session', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ id: 1 }))
    expect(await checkSignedIn()).toBe(true)
  })

  it('is signed out with no session', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: { reason: 'signed_out' } }, 401))
    expect(await checkSignedIn()).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
