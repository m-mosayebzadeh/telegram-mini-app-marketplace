import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mocked before importing api.ts, so the module under test gets the
// mock instead of the real SDK function (which would try to read a
// real Telegram launch environment that doesn't exist in this test).
vi.mock('@telegram-apps/sdk-react', () => ({
  retrieveRawInitData: vi.fn(),
}))

import { retrieveRawInitData } from '@telegram-apps/sdk-react'

const mockRetrieve = vi.mocked(retrieveRawInitData)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// api.ts caches the resolved init data at module scope on purpose (see
// its comment — it's only supposed to be resolved once per page load).
// That's exactly what we DON'T want between tests, so every test
// re-imports a fresh module instance via resetModules() + a dynamic
// import, instead of one shared top-level import.
async function freshApi() {
  vi.resetModules()
  return import('./api')
}

describe('apiFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockRetrieve.mockReset()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('uses the real Telegram init data when available, without hitting the dev fallback', async () => {
    mockRetrieve.mockReturnValue('real-init-data-from-telegram')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { apiFetch } = await freshApi()

    const result = await apiFetch<{ ok: boolean }>('/me')

    expect(result).toEqual({ ok: true })
    // Exactly one fetch: the real endpoint, never /api/dev/test-init-data.
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/me')
    expect((options?.headers as Record<string, string>)['X-Telegram-Init-Data']).toBe(
      'real-init-data-from-telegram',
    )
  })

  it('falls back to the chosen test user when retrieveRawInitData throws (plain browser, no Telegram)', async () => {
    // This is the real behavior outside Telegram — see the comment in
    // src/lib/api.ts's getInitData(). The choice itself is made on the
    // Login screen (see pages/Login.tsx), which stores it via
    // lib/session.ts's setDevUserChoice() — here we just simulate that
    // having already happened.
    mockRetrieve.mockImplementation(() => {
      throw new Error('no launch params found')
    })
    sessionStorage.setItem('devInitData', 'chosen-test-user-init-data')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { apiFetch } = await freshApi()

    await apiFetch('/me')

    // Exactly one fetch: the real endpoint — no separate call to mint a
    // fresh dev initData, since a choice was already stored.
    expect(fetch).toHaveBeenCalledTimes(1)
    const options = vi.mocked(fetch).mock.calls[0][1]
    expect((options?.headers as Record<string, string>)['X-Telegram-Init-Data']).toBe(
      'chosen-test-user-init-data',
    )
  })

  it('throws instead of guessing when neither real Telegram nor a stored choice exists', async () => {
    mockRetrieve.mockImplementation(() => {
      throw new Error('no launch params found')
    })
    const { apiFetch } = await freshApi()

    await expect(apiFetch('/me')).rejects.toThrow(/log in first/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws ApiError with the parsed body on a non-2xx response', async () => {
    mockRetrieve.mockReturnValue('real-init-data')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ detail: 'not found' }, 404))
    const { apiFetch, ApiError } = await freshApi()

    await expect(apiFetch('/offers/999')).rejects.toMatchObject(
      new ApiError(404, { detail: 'not found' }),
    )
  })

  it('does not set Content-Type on a FormData body, leaving the browser to add its own boundary', async () => {
    mockRetrieve.mockReturnValue('real-init-data')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { apiFetch } = await freshApi()

    const body = new FormData()
    body.append('file', new Blob(['x']), 'test.jpg')
    await apiFetch('/content', { method: 'POST', body })

    const options = vi.mocked(fetch).mock.calls[0][1]
    expect((options?.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('sets Content-Type: application/json on a plain object body', async () => {
    mockRetrieve.mockReturnValue('real-init-data')
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ok: true }))
    const { apiFetch } = await freshApi()

    await apiFetch('/profile/me', { method: 'PUT', body: JSON.stringify({ bio: 'hi' }) })

    const options = vi.mocked(fetch).mock.calls[0][1]
    expect((options?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('resolves init data only once and reuses it across multiple calls', async () => {
    mockRetrieve.mockReturnValue('real-init-data')
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ n: 1 }))
      .mockResolvedValueOnce(jsonResponse({ n: 2 }))
    const { apiFetch } = await freshApi()

    await apiFetch('/one')
    await apiFetch('/two')

    // retrieveRawInitData should only ever be consulted once per
    // module lifetime, not once per request.
    expect(mockRetrieve).toHaveBeenCalledTimes(1)
  })
})
