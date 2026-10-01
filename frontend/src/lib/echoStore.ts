import { useSyncExternalStore } from 'react'
import { fetchEchoStatus, type EchoStatus } from './echoApi'
import { subscribe as subscribeLive } from './live'

/**
 * Echo's status, shared by everything that shows it: the door in the bar
 * (open, shut, searching), the Echo screen, and the card that reaches you
 * on any screen when somebody is found (section 32).
 *
 * One copy, so three places never ask the server three times, and never
 * disagree. It asks again:
 *
 * - when the server nudges (the live "echo" event: somebody was put in
 *   front of you, somebody answered, or it was settled);
 * - when a card's time runs out — asking is what settles it on the server,
 *   since nothing there keeps a clock;
 * - every few seconds while you are searching, in case the live
 *   connection dropped a nudge;
 * - once a minute otherwise, so the door notices Echo opening or closing.
 *
 * It only runs while something on screen is listening.
 */

const SEARCHING_MS = 4000
const IDLE_MS = 60_000
/** A little past the deadline, so the server agrees it has passed. */
const PAST_DEADLINE_MS = 400
/** Over how long the apps spread out their asking after a change made for
 *  everybody at once. Short enough that the bar still changes "at once". */
const EVERYONE_SPREAD_MS = 3000

let current: EchoStatus | null = null
const listeners = new Set<() => void>()
let timer = 0
let unsubscribeLive: (() => void) | null = null

function nextDelay(status: EchoStatus | null): number {
  const proposal = status?.proposal
  if (proposal) {
    return Math.max(500, new Date(proposal.expires_at).getTime() - Date.now() + PAST_DEADLINE_MS)
  }
  return status?.waiting ? SEARCHING_MS : IDLE_MS
}

function schedule() {
  window.clearTimeout(timer)
  if (listeners.size === 0) return
  timer = window.setTimeout(() => void refreshEcho(), nextDelay(current))
}

/** Put a fresh status in, from wherever it came (a search, an answer). */
export function setEcho(status: EchoStatus): void {
  current = status
  listeners.forEach((listener) => listener())
  schedule()
}

/** Ask the server now. Failures keep the last known status: a door that
 *  flickers to "shut" on one lost request would be worse than a stale one. */
export async function refreshEcho(): Promise<EchoStatus | null> {
  try {
    const status = await fetchEchoStatus()
    setEcho(status)
    return status
  } catch {
    schedule()
    return null
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    unsubscribeLive = subscribeLive((event) => {
      if (event.type === 'echo' && event.everyone) {
        // The panel changed Echo for everybody at once: each app waits a
        // moment of its own, so the whole crowd does not ask in one instant.
        window.setTimeout(() => void refreshEcho(), Math.random() * EVERYONE_SPREAD_MS)
      } else if (event.type === 'echo' || event.type === 'ready') void refreshEcho()
    })
    void refreshEcho()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      window.clearTimeout(timer)
      unsubscribeLive?.()
      unsubscribeLive = null
    }
  }
}

/** The latest Echo status, or null until the first answer. */
export function useEcho(): EchoStatus | null {
  return useSyncExternalStore(subscribe, () => current)
}

/** For tests: forget everything. */
export function resetEchoStore(): void {
  current = null
  window.clearTimeout(timer)
}
