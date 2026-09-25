import { getInitData } from './api'
import type { ConversationMessage, Reaction } from './conversationApi'

/**
 * The live connection: how the server tells this phone that something
 * happened, instead of the phone having to keep asking.
 *
 * One socket for the whole app, however many screens are listening. It
 * opens when the first screen subscribes and closes a little after the
 * last one leaves, so moving between screens does not tear it down and
 * build it again.
 *
 * Nothing here is the only copy of anything. An event is a nudge to
 * update what is on screen; the database has the truth. That is why a
 * dropped connection is not a disaster: when it comes back, `ready` says
 * so with `resumed: true`, and each screen asks again for whatever it
 * shows. Screens must do that, or a message sent while the phone was in a
 * tunnel would never appear.
 */

export type LiveEvent =
  | { type: 'ready'; resumed: boolean }
  | { type: 'message'; conversation_id: number; message: ConversationMessage }
  | { type: 'read'; conversation_id: number; user_id: number; read_at: string }
  | { type: 'edited'; conversation_id: number; message: ConversationMessage }
  | { type: 'deleted'; conversation_id: number; message_ids: number[] }
  | { type: 'reactions'; conversation_id: number; message_id: number; reactions: Reaction[] }
  | { type: 'typing'; conversation_id: number; user_id: number }

type Listener = (event: LiveEvent) => void

/** How often the phone says it is still here. Well inside the server's
 *  silence limit (75 seconds), and inside the minute after which many
 *  proxies and mobile networks cut a connection that looks idle. */
const PING_EVERY_MS = 25_000

/** If a ping gets no answer in this long, the line is dead even though
 *  nothing has said so. Mobile networks often fail this silently. */
const PONG_WITHIN_MS = 10_000

/** How long the socket stays open after the last screen stops listening. */
const LINGER_MS = 15_000

/** The longest wait between reconnection attempts. */
const MAX_BACKOFF_MS = 30_000

const listeners = new Set<Listener>()
let socket: WebSocket | null = null
let everConnected = false
let attempt = 0
let retryTimer: number | undefined
let pingTimer: number | undefined
let pongTimer: number | undefined
let lingerTimer: number | undefined

/**
 * How long to wait before reconnection attempt number `attempt`.
 *
 * Doubles each time, up to a ceiling, with a random share taken off. The
 * randomness is what matters at scale: when a server restarts, every
 * phone connected to it drops in the same second. Without it they would
 * all come back in the same second too — and again after the same
 * doubled wait — hammering the server in synchronised waves.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt)
  return Math.round(ceiling * (0.5 + random() * 0.5))
}

function address(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}/api/live`
}

function emit(event: LiveEvent) {
  for (const listener of [...listeners]) listener(event)
}

function clearTimers() {
  window.clearInterval(pingTimer)
  window.clearTimeout(pongTimer)
  pingTimer = undefined
  pongTimer = undefined
}

async function connect() {
  if (socket || listeners.size === 0) return
  window.clearTimeout(retryTimer)

  let credentials: string
  try {
    credentials = await getInitData()
  } catch {
    return
  }
  // Somebody may have subscribed and left, or connected, while waiting.
  if (socket || listeners.size === 0) return

  const opened = new WebSocket(address())
  socket = opened

  opened.onopen = () => {
    opened.send(JSON.stringify({ type: 'hello', credentials }))
  }

  opened.onmessage = (raw) => {
    let event: { type?: string }
    try {
      event = JSON.parse(String(raw.data))
    } catch {
      return
    }
    if (event.type === 'pong') {
      window.clearTimeout(pongTimer)
      return
    }
    if (event.type === 'ready') {
      attempt = 0
      const resumed = everConnected
      everConnected = true
      pingTimer = window.setInterval(() => ping(opened, PONG_WITHIN_MS), PING_EVERY_MS)
      emit({ type: 'ready', resumed })
      return
    }
    emit(event as LiveEvent)
  }

  opened.onclose = () => drop(opened)
}

/**
 * Asks the line whether it is alive, and gives up on it if no answer
 * comes within `within`.
 */
function ping(opened: WebSocket, within: number) {
  try {
    opened.send(JSON.stringify({ type: 'ping' }))
  } catch {
    drop(opened)
    return
  }
  window.clearTimeout(pongTimer)
  pongTimer = window.setTimeout(() => drop(opened), within)
}

/**
 * Stops using a connection at once and starts on a new one.
 *
 * Not the same as closing it and waiting to be told it closed. A line
 * that died without a word — the network under it switched off — is
 * "closed" by the browser only after it gives up waiting for the other
 * end, which can take a minute or more. Waiting for that was the minute in
 * which messages and read receipts silently stopped arriving. So the old
 * socket is cut loose here and left to finish closing on its own time.
 */
function drop(opened: WebSocket) {
  if (socket !== opened) return
  opened.onclose = null
  opened.onmessage = null
  try {
    opened.close()
  } catch {
    // Already closed.
  }
  clearTimers()
  socket = null
  if (listeners.size === 0) return
  window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(() => void connect(), backoffMs(attempt))
  attempt += 1
}

/** How long to wait for an answer when checking on purpose — the network
 *  just came back, or the person just returned to the app. Short, because
 *  those are exactly the moments a dead line is most likely and most
 *  noticed. */
const CHECK_WITHIN_MS = 4000

/**
 * The network is back, or the person has just returned to the app.
 *
 * With no connection, try again now rather than waiting out the backoff.
 * With one, do not trust it: a phone that was asleep or lost its network
 * often still holds a socket that looks open and is dead. Ask it, briefly.
 */
function reconnectNow() {
  if (listeners.size === 0) return
  if (socket) {
    if (socket.readyState === WebSocket.OPEN) ping(socket, CHECK_WITHIN_MS)
    return
  }
  attempt = 0
  void connect()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', reconnectNow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reconnectNow()
  })
}

/** How often "typing…" is said while somebody keeps typing. The other
 *  screen shows it for a little longer than this (TYPING_SHOWN_MS), so a
 *  steady typist reads as one continuous "typing…", not a flicker. */
export const TYPING_EVERY_MS = 3000
export const TYPING_SHOWN_MS = 5000

const lastTyping = new Map<number, number>()

/**
 * Tells the others in a thread that you are typing.
 *
 * Called on every keystroke and sent at most every few seconds. Never
 * queued: if the line is down the signal is simply lost, which is right —
 * by the time it could be delivered it would be a lie.
 */
export function sayTyping(conversationId: number, now = Date.now()): void {
  const last = lastTyping.get(conversationId) ?? 0
  if (now - last < TYPING_EVERY_MS) return
  if (!socket || socket.readyState !== WebSocket.OPEN) return
  lastTyping.set(conversationId, now)
  socket.send(JSON.stringify({ type: 'typing', conversation_id: conversationId }))
}

/** A message was just sent: the next keystroke is a new burst of typing
 *  and should be announced at once. */
export function doneTyping(conversationId: number): void {
  lastTyping.delete(conversationId)
}

/** Start hearing events. Returns the function that stops. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  window.clearTimeout(lingerTimer)
  void connect()
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    lingerTimer = window.setTimeout(() => {
      if (listeners.size > 0) return
      window.clearTimeout(retryTimer)
      socket?.close()
      socket = null
    }, LINGER_MS)
  }
}
