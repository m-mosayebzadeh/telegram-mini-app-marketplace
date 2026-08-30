/**
 * The one place this app talks to the backend. Every request needs the
 * same two things — the "/api" prefix (see vite.config.ts's proxy) and
 * the X-Telegram-Init-Data header the backend uses to authenticate
 * (see backend/app/auth/telegram.py) — so every screen calls apiFetch()
 * instead of using fetch() directly.
 */

import { retrieveRawInitData } from '@telegram-apps/sdk-react'
import { getDevUserChoice } from './session'

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

/**
 * The standard "turn a caught error into on-screen text" used by every
 * page's .catch() handler. Exists because that logic used to be
 * duplicated inline (`err instanceof ApiError ? JSON.stringify(err.body)
 * : String(err)`) in 14 different files, and every one of them had the
 * same latent bug: when the server's error response isn't valid JSON —
 * e.g. an ngrok tunnel's own HTML warning page standing in for the real
 * response (see docs/LOCAL_DEV.md), or any other non-JSON error page —
 * apiFetch() sets `body` to `null` (see its `.catch(() => null)`), and
 * `JSON.stringify(null)` is the literal string "null", which then
 * rendered on screen as if it were a real error message instead of
 * something a person could act on.
 */
export function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.body != null ? JSON.stringify(err.body) : `Request failed (HTTP ${err.status})`
  }
  return String(err)
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
 *      retrieve, so we use whichever test user was chosen on the Login
 *      screen (see lib/session.ts and pages/Login.tsx) — signed by the
 *      backend's dev-only endpoint, the exact same trick the Bruno
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

  const stored = getDevUserChoice()
  if (!stored) {
    // Should be unreachable in practice: App.tsx checks needsDevLogin()
    // and shows the Login screen before rendering anything that could
    // call apiFetch(). Kept as a clear failure instead of silently
    // picking some default user, in case that invariant is ever broken.
    throw new Error('No Telegram launch data and no test user chosen — log in first.')
  }
  cachedInitData = stored
  return stored
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

  // A FormData body (content upload — see lib/contentApi.ts) must NOT
  // get an explicit Content-Type: the browser sets one itself, with the
  // multipart boundary the body was actually encoded with. Setting it
  // by hand here would produce a header with no boundary, which the
  // server can't parse at all.
  const isFormData = options.body instanceof FormData

  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'X-Telegram-Init-Data': initData,
      // Harmless outside a tunnel (the real backend just ignores an
      // unknown header) — see the matching header on apiFetchBlob()
      // below for why it's needed at all when testing through ngrok.
      'ngrok-skip-browser-warning': 'true',
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
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

/**
 * Like apiFetch(), but for an endpoint whose response is raw bytes, not
 * JSON — right now just GET /content/{id}/file (see lib/contentApi.ts).
 * A plain <img src="..."> can't be used for that route directly: this
 * backend authenticates via the X-Telegram-Init-Data header, and a
 * browser's own image-loading request has no way to attach one — so the
 * bytes have to be fetched here (where the header can be set) and handed
 * to the <img> as an in-memory object URL instead.
 *
 * On a non-2xx response, still throws ApiError with the parsed JSON
 * error body (e.g. the 402 payment-required shape), exactly like
 * apiFetch() — only the success path returns a Blob instead of JSON.
 */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const initData = await getInitData()

  const response = await fetch(`/api${path}`, {
    headers: {
      'X-Telegram-Init-Data': initData,
      // ngrok's free tier serves an HTML "you are about to visit..."
      // interstitial (see the first screenshot in the chat that led
      // here) to any request that doesn't look like a normal browser
      // navigation — Telegram's WebView doesn't, so every proxied
      // request needs this header to actually reach the backend instead
      // of getting that warning page back as if it were the real
      // response (see docs/LOCAL_DEV.md for the rest of the tunnel setup).
      'ngrok-skip-browser-warning': 'true',
    },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, body)
  }
  return response.blob()
}
