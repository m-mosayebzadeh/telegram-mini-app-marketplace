/**
 * What the app counts about itself (TECHNICAL_REQUIREMENTS.md section 43,
 * "analytics"). A handful of named events — never text, never anything
 * typed — sent to our own server, not to an outside analytics service.
 *
 * Nothing is sent on a clock and nothing waits on it: events queue here
 * and leave together when the page is hidden or closed (sendBeacon, which
 * the browser delivers even as the page goes away), or once ten have
 * gathered. The server drops anything not on its list
 * (backend/app/analytics/events.py), so this file is a convenience, not
 * the guarantee.
 */

export type AppEventName = 'signin_step' | 'app_load' | 'app_error' | 'frame_rate' | 'push_opened'

interface Pending {
  name: AppEventName
  value?: number
  detail?: string
}

const ADDRESS = '/api/analytics/events'
/** Sent once this many have gathered, so a long visit is not one big report. */
const SEND_AT = 10
/** A broken screen can throw in a loop; a few reports say as much as a thousand. */
const MAX_ERRORS = 5

let queue: Pending[] = []
let errors = 0
let listening = false

export function track(name: AppEventName, value?: number, detail?: string): void {
  if (typeof window === 'undefined') return
  queue.push({ name, ...(value !== undefined ? { value: Math.round(value) } : {}), ...(detail ? { detail } : {}) })
  listen()
  if (queue.length >= SEND_AT) send()
}

/** Sends whatever is queued. */
export function send(): void {
  if (queue.length === 0) return
  const body = JSON.stringify({ events: queue.slice(0, 20) })
  queue = queue.slice(20)
  try {
    const beacon = typeof navigator !== 'undefined' && navigator.sendBeacon?.(ADDRESS, new Blob([body], { type: 'application/json' }))
    if (!beacon) void fetch(ADDRESS, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'include' }).catch(() => {})
  } catch {
    /* counting must never break the app */
  }
}

function listen() {
  if (listening) return
  listening = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') send()
  })
  window.addEventListener('pagehide', send)
}

/** From the app's start: how long it took to show something, errors, and
 *  whether it was opened from a notification. Called once, in main.tsx. */
export function startCounting(): void {
  requestAnimationFrame(() => track('app_load', performance.now()))
  window.addEventListener('error', () => {
    if (errors++ < MAX_ERRORS) track('app_error', undefined, 'script')
  })
  window.addEventListener('unhandledrejection', () => {
    if (errors++ < MAX_ERRORS) track('app_error', undefined, 'promise')
  })
  // A tapped notification opens its page with ?from=push (public/sw.js).
  const here = new URL(window.location.href)
  if (here.searchParams.get('from') === 'push') {
    track('push_opened')
    here.searchParams.delete('from')
    window.history.replaceState(window.history.state, '', here.pathname + here.search + here.hash)
  }
}

const MEASURED_KEY = 'cosmos.fps.measured'

/** The world's frames per second, measured once a visit over a few
 *  seconds — "measured on real cheap phones, not guessed" (CLAUDE.md). */
export function measureFrameRate(light: boolean, seconds = 5): () => void {
  try {
    if (sessionStorage.getItem(MEASURED_KEY)) return () => {}
    sessionStorage.setItem(MEASURED_KEY, '1')
  } catch {
    return () => {}
  }
  let frames = 0
  let first = 0
  let handle = 0
  const step = (now: number) => {
    if (!first) first = now
    frames++
    if (now - first >= seconds * 1000) {
      // Only a page in view draws frames; hidden halfway, it says nothing true.
      if (document.visibilityState === 'visible') track('frame_rate', (frames * 1000) / (now - first), light ? 'light' : 'normal')
      return
    }
    handle = requestAnimationFrame(step)
  }
  handle = requestAnimationFrame(step)
  return () => cancelAnimationFrame(handle)
}
