import type { ConversationMessage, Reaction } from './conversationApi'

/**
 * The list of messages on screen, and the few rules about keeping it
 * right while messages arrive from three directions at once: the answer
 * to your own send, the live connection, and a fresh fetch after a
 * reconnect. Any of them can arrive first, and the same message can
 * arrive from all three.
 *
 * Kept apart from the screen so the rules can be tested on their own.
 */

/** A message as the screen shows it: either confirmed by the server, or
 *  still on its way with a clock beside it. */
export interface ShownMessage extends ConversationMessage {
  /** Present only while the server has not confirmed it. */
  pending?: true
  /** For a photograph or voice note not yet sent: the local copy, so it
   *  can be seen and played before it has been uploaded anywhere. */
  localUrl?: string
}

/**
 * Puts `incoming` where it belongs.
 *
 * The same message arriving twice replaces itself rather than appearing
 * twice — matched by id, or by the name the sender's phone gave it, which
 * is how a confirmed message takes the place of its own clock-marked copy.
 *
 * A newly confirmed message goes above anything still waiting to be sent.
 * Waiting messages stay at the bottom, the way every messenger shows them,
 * because they will be the newest thing in the thread once they arrive.
 */
export function placeMessage(list: ShownMessage[], incoming: ShownMessage): ShownMessage[] {
  const same = list.findIndex(
    (shown) =>
      shown.id === incoming.id ||
      (incoming.client_id != null && shown.client_id === incoming.client_id),
  )
  if (same !== -1) {
    const next = [...list]
    // A confirmed copy never gives way to a still-waiting one.
    if (!next[same].pending && incoming.pending) return list
    next[same] = incoming
    return next
  }
  if (incoming.pending) return [...list, incoming]
  const firstWaiting = list.findIndex((shown) => shown.pending)
  if (firstWaiting === -1) return [...list, incoming]
  return [...list.slice(0, firstWaiting), incoming, ...list.slice(firstWaiting)]
}

/**
 * A fresh list from the server, with whatever is still waiting to be sent
 * kept at the bottom. Used after a reconnect, when anything could have
 * happened in between.
 */
export function withWaiting(fromServer: ConversationMessage[], shown: ShownMessage[]): ShownMessage[] {
  const known = new Set(fromServer.map((message) => message.client_id).filter(Boolean))
  const waiting = shown.filter((message) => message.pending && !known.has(message.client_id))
  return [...fromServer, ...waiting]
}

/** A changed message in place. Unlike placeMessage it never adds: an edit
 *  of a message this screen does not have (hidden, or cleared) stays
 *  unseen. */
export function replaceMessage(list: ShownMessage[], changed: ConversationMessage): ShownMessage[] {
  return list.map((shown) => (shown.id === changed.id ? { ...changed, localUrl: shown.localUrl } : shown))
}

export function withoutMessages(list: ShownMessage[], ids: number[]): ShownMessage[] {
  const gone = new Set(ids)
  return list.filter((shown) => !gone.has(shown.id))
}

export function withReactions(list: ShownMessage[], messageId: number, reactions: Reaction[]): ShownMessage[] {
  return list.map((shown) => (shown.id === messageId ? { ...shown, reactions } : shown))
}

/** Reactions gathered for display: each emoji once, with how many chose
 *  it and whether you are one of them, in the order they first appeared. */
export function tallyReactions(
  reactions: Reaction[] | undefined,
  me: number | undefined,
): { emoji: string; count: number; mine: boolean }[] {
  const tally = new Map<string, { emoji: string; count: number; mine: boolean }>()
  for (const reaction of reactions ?? []) {
    const entry = tally.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, mine: false }
    entry.count += 1
    entry.mine = entry.mine || reaction.user_id === me
    tally.set(reaction.emoji, entry)
  }
  return [...tally.values()]
}

/** Your own reaction on a message, if any. */
export function myReaction(message: ShownMessage, me: number | undefined): string | null {
  return message.reactions?.find((reaction) => reaction.user_id === me)?.emoji ?? null
}

/** Where one of your own messages has got to. */
export type Delivery = 'sending' | 'sent' | 'seen'

export function deliveryOf(message: ShownMessage, othersReadAt: string | null): Delivery {
  if (message.pending) return 'sending'
  if (othersReadAt && Date.parse(message.created_at) <= Date.parse(othersReadAt)) return 'seen'
  return 'sent'
}

/** The later of two moments, either of which may be missing. Read
 *  receipts only move forward; an older one arriving late is ignored. */
export function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return Date.parse(b) > Date.parse(a) ? b : a
}

/**
 * A name for a message, chosen before it is sent.
 *
 * randomUUID exists only on secure pages (https or localhost); a phone on
 * the local network over plain http has no such function, so there is a
 * fallback. Uniqueness only has to hold per sender, and the server treats
 * a clash as a retry, so the fallback's weaker randomness is enough.
 */
export function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
