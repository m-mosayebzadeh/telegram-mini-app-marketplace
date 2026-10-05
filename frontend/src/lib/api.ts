/**
 * The one place this app talks to the backend: the "/api" prefix (see
 * vite.config.ts's proxy), and one shared answer to "signed out".
 *
 * Nothing here says who is asking. The browser sends the sign-in
 * session's cookie with every request by itself (lib/auth.ts says why the
 * app never touches it), and a request refused as "signed out" tells the
 * app to go to the sign-in page.
 */

import { announceSignedOut, isSignedOutResponse } from './auth'

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
/** The machine-readable reason a request was refused, when the server gave
 *  one — so a screen can say it in words instead of showing raw JSON. */
export function apiReason(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined
  const detail = (err.body as { detail?: unknown } | null)?.detail
  return detail && typeof detail === 'object' ? ((detail as { reason?: string }).reason ?? undefined) : undefined
}

export function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    return err.body != null ? JSON.stringify(err.body) : `Request failed (HTTP ${err.status})`
  }
  return String(err)
}

/**
 * Calls the backend at `path` (e.g. "/me", "/wallet/balance") and returns
 * the parsed JSON body.
 *
 * Throws ApiError on any non-2xx response — callers only ever get
 * either a successful, typed result or a thrown ApiError, never a
 * response object they have to check `.ok` on themselves.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // A FormData body (content upload — see lib/contentApi.ts) must NOT
  // get an explicit Content-Type: the browser sets one itself, with the
  // multipart boundary the body was actually encoded with. Setting it
  // by hand here would produce a header with no boundary, which the
  // server can't parse at all.
  const isFormData = options.body instanceof FormData

  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
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
    if (isSignedOutResponse(response.status, body)) announceSignedOut()
    throw new ApiError(response.status, body)
  }
  return body as T
}

/**
 * Like apiFetch(), but for an endpoint whose response is raw bytes, not
 * JSON — right now just GET /content/{id}/file (see lib/contentApi.ts).
 Fetched here rather than by a plain <img src> so a refused request is
 * handled like every other (a JSON error body, "signed out"), and handed
 * to the <img> as an in-memory object URL.
 *
 * On a non-2xx response, still throws ApiError with the parsed JSON
 * error body (e.g. the 402 payment-required shape), exactly like
 * apiFetch() — only the success path returns a Blob instead of JSON.
 */
export async function apiFetchBlob(path: string): Promise<Blob> {
  const response = await fetch(`/api${path}`, {
    headers: {
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
    if (isSignedOutResponse(response.status, body)) announceSignedOut()
    throw new ApiError(response.status, body)
  }
  return response.blob()
}
