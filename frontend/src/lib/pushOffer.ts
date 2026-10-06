/**
 * When the app offers notifications (section 38): at a moment that explains
 * itself — right after somebody sent a first message in a conversation, or
 * asked somebody to be friends: "want to know when they answer?". Never on
 * arrival, where a prompt with no reason is the one people learn to refuse.
 *
 * "Not now" is respected for a week. The browser's own prompt appears only
 * after "yes", so a "not now" here never spends the browser's one chance.
 */

const KEY = 'cos-push-offer-later'
const WEEK = 7 * 24 * 60 * 60 * 1000

export function offerWaiting(now = Date.now()): boolean {
  try {
    const later = Number(localStorage.getItem(KEY) ?? 0)
    return !later || now - later > WEEK
  } catch {
    return true
  }
}

export function offerLater(now = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(now))
  } catch {
    // Without storage it is simply offered again next time.
  }
}

const EVENT = 'cos:offer-push'

/** A moment that explains notifications just happened ("you sent a first
 *  message", "you asked to be friends"). Whether anything is shown is the
 *  offer card's decision (components/cosmos/PushOffer.tsx). */
export function offerPush(reason: 'message' | 'friend'): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: reason }))
}

export function onPushOffer(listener: (reason: 'message' | 'friend') => void): () => void {
  const heard = (event: Event) => listener((event as CustomEvent<'message' | 'friend'>).detail)
  window.addEventListener(EVENT, heard)
  return () => window.removeEventListener(EVENT, heard)
}
