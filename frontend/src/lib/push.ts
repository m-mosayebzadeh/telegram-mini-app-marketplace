import { apiFetch } from './api'

/**
 * Notifications when the app is closed (TECHNICAL_REQUIREMENTS.md section
 * 38; the server is backend/app/push).
 *
 * Where they work: Android and computers in any major browser; an iPhone
 * only once the app has been added to the home screen; never inside the
 * browsers of other apps (Instagram, Telegram). Each case is told apart
 * here so the screens can say the right thing instead of failing quietly.
 *
 * The browser's permission is asked only when somebody chooses to turn
 * notifications on — never on arrival (see pushOffer.ts for when the app
 * offers it).
 */

export type PushState =
  /** This browser cannot do it at all (or the server has it switched off). */
  | 'unsupported'
  /** An iPhone in Safari: possible once added to the home screen. */
  | 'install_first'
  /** Not decided yet: can be offered. */
  | 'off'
  /** On, on this browser. */
  | 'on'
  /** The person said no in the browser; only the browser's settings undo it. */
  | 'blocked'

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

function browserCan(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

let serverKey: Promise<string | null> | null = null
/** The server's public key, asked once per page load; null when switched off. */
function keyOfServer(): Promise<string | null> {
  serverKey ??= apiFetch<{ key: string | null }>('/push/key')
    .then((answer) => answer.key)
    .catch(() => {
      serverKey = null
      return null
    })
  return serverKey
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js')
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isInstalled()) return 'install_first'
  if (!browserCan() || !(await keyOfServer())) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  const existing = await (await registration()).pushManager.getSubscription()
  return existing ? 'on' : 'off'
}

/** The server's key in the form the browser wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Asks the browser (its own permission prompt), subscribes, and tells the
 *  server. Resolves to the state it ended in. */
export async function turnPushOn(): Promise<PushState> {
  const key = await keyOfServer()
  if (!browserCan() || !key) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off'
  const worker = await registration()
  const subscription =
    (await worker.pushManager.getSubscription()) ??
    (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }))
  const json = subscription.toJSON()
  await apiFetch<void>('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  })
  return 'on'
}

/** Off on this browser: unsubscribed here and forgotten by the server. */
/** Whether notifications show the message itself, for this person on every device. */
export const setPushPreview = (show: boolean) =>
  apiFetch<void>('/push/preview', { method: 'PUT', body: JSON.stringify({ show }) })

export async function turnPushOff(): Promise<PushState> {
  if (!browserCan()) return 'unsupported'
  const subscription = await (await registration()).pushManager.getSubscription()
  if (subscription) {
    await apiFetch<void>('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {})
    await subscription.unsubscribe()
  }
  return 'off'
}
