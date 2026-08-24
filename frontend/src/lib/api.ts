/**
 * The one place this app talks to the backend. Every request needs the
 * same two things — the "/api" prefix (see vite.config.ts's proxy) and
 * the X-Telegram-Init-Data header the backend uses to authenticate
 * (see backend/app/auth/telegram.py) — so every screen calls apiFetch()
 * instead of using fetch() directly.
 */

import { retrieveRawInitData } from '@telegram-apps/sdk-react'

/** Thrown by apiFetch() for any non-2xx response. Carries the parsed
 * JSON body (usually FastAPI's {"detail": ...}) so a screen can show a
 * real error message instead of just "something went wrong". */
export class ApiError extends Error {
  // Declared explicitly (not as constructor parameter properties) —
  // this project's TypeScript config runs with erasableSyntaxOnly,
  // which disallows the shorthand `constructor(public readonly x)`
  // because it isn't purely type-level syntax (it has real assignment
  // behavior baked in), so the assignment has to be written out below.
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`)
    this.status = status
    this.body = body
  }
}

// Resolved once per page load, then reused — neither path (a real
// Telegram launch, or the dev fallback below) changes mid-session.
let cachedInitData: string | null = null

/**
 * The raw, signed initData string to send as X-Telegram-Init-Data.
 *
 * Two paths:
 *   1. Running inside real Telegram: retrieveRawInitData() reads it
 *      straight from the WebView launch parameters — this is the real
 *      thing, and it's what the backend actually validates in
 *      production.
 *   2. Running in a plain browser during local development (no
 *      Telegram WebView around it at all): there's no real initData to
 *      retrieve, so we ask the backend's dev-only endpoint to mint a
 *      validly-signed fake one — the exact same trick the Bruno
 *      collection uses (see backend/app/dev/router.py). This only
 *      works when the backend is running with ENABLE_DEV_TOOLS=true;
 *      inside real Telegram this branch is never reached at all.
 *
 * retrieveRawInitData() THROWS (not returns undefined/null) when there
 * are no launch params to find anywhere — window.location, navigation
 * entries, or localStorage — which is exactly what "plain browser, no
 * Telegram" looks like, so that throw is what triggers the fallback.
 */
async function getInitData(): Promise<string> {
  if (cachedInitData) return cachedInitData

  try {
    const real = retrieveRawInitData()
    if (real) {
      cachedInitData = real
      return real
    }
  } catch {
    // No Telegram launch params available — fall through to the dev
    // fallback below, exactly as if retrieveRawInitData() had
    // returned nothing.
  }

  const response = await fetch('/api/dev/test-init-data')
  if (!response.ok) {
    throw new Error(
      'No real Telegram launch data, and the dev fallback failed — is the ' +
        'backend running with ENABLE_DEV_TOOLS=true?',
    )
  }
  const { init_data: devInitData } = (await response.json()) as { init_data: string }
  cachedInitData = devInitData
  return devInitData
}

/**
 * Calls the backend at `path` (e.g. "/me", "/wallet/balance") with the
 * init-data header attached, and returns the parsed JSON body.
 *
 * Throws ApiError on any non-2xx response — callers only ever get
 * either a successful, typed result or a thrown ApiError, never a
 * response object they have to check `.ok` on themselves.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const initData = await getInitData()

  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'X-Telegram-Init-Data': initData,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  // 204 No Content (e.g. DELETE endpoints) has no body to parse.
  const body = response.status === 204 ? null : await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(response.status, body)
  }
  return body as T
}
